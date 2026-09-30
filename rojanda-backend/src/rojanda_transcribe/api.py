"""RojAnda authenticated API handler (Phase 1C).

Routes (all JWT-authed via the API Gateway Cognito User Pool authorizer;
ownerId = verified JWT `sub`, via auth.get_owner_id — never from the request
body/query/headers/path):

  GET    /profile                                   -> student profile
  PUT    /profile                                   -> update editable profile
  GET    /courses                                   -> list courses
  POST   /courses                                   -> create course
  GET    /courses/{courseId}                        -> get course
  PUT    /courses/{courseId}                         -> update course
  DELETE /courses/{courseId}                         -> delete course (+ lessons)
  GET    /courses/{courseId}/lessons                -> list lessons
  POST   /courses/{courseId}/lessons                -> create lesson
  GET/PUT/DELETE /courses/{courseId}/lessons/{lessonId}
  POST   /transcribe/upload-url                     -> presigned POST (150 MB)
  POST   /transcribe/start                          -> tr-TR job (server-named)
  GET    /transcribe/status                         -> status/transcript

Security-critical rules:
  * ownerId comes only from verified JWT claims (never the body/query/path)
  * every DynamoDB item is under PK=OWNER#<sub>; nested ownership is validated
  * S3 keys are server-generated + regex+ownership validated (no path injection,
    no cross-user access); uploads capped by S3 content-length-range + head_object
  * per-owner daily minutes quota via conditional single-table writes
  * transcript text is only ever what Transcribe returns — never invented
  * usage metering: provisional reserve -> authoritative settle -> failure release,
    idempotent + retry-safe, preserved verbatim on the single table
"""
from __future__ import annotations

import json
import urllib.request

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError as BotoClientError

from . import resources, store
from .auth import get_owner_id
from .core import (
    ClientError,
    Config,
    authoritative_seconds,
    end_of_day_ttl,
    job_name_for,
    job_record_ttl,
    new_audio_key,
    provisional_minutes_from_size,
    seconds_to_billable_minutes,
    today_utc,
    transcript_key_for,
    validate_audio_key,
)

# Presigned POST + head_object need SigV4; region pinned via Lambda env. This is
# S3's OWN server-side signing — not client API auth (which is the JWT).
_s3 = boto3.client("s3", config=BotoConfig(signature_version="s3v4"))
_transcribe = boto3.client("transcribe")


def _dynamodb():
    """Use the same DynamoDB client the store module uses (test seam)."""
    return store._dynamodb


# ---------------------------------------------------------------------------
# Usage metering on the single table (PK=OWNER#<sub>, SK=USAGE#<day> / JOB).
# Reconciliation semantics are UNCHANGED from the pre-single-table version.
# ---------------------------------------------------------------------------
def _usage_key(owner_id: str) -> dict:
    return {"pk": {"S": store.owner_pk(owner_id)}, "sk": {"S": store.sk_usage(today_utc())}}


def _job_key(owner_id: str, job_name: str) -> dict:
    return {"pk": {"S": store.owner_pk(owner_id)}, "sk": {"S": store.sk_job(job_name)}}


def _add_day_minutes(cfg: Config, owner_id: str, delta: int) -> None:
    if delta == 0:
        return
    db = _dynamodb()
    db.update_item(
        TableName=cfg.app_table,
        Key=_usage_key(owner_id),
        UpdateExpression="SET #ttl = :ttl ADD #m :d",
        ExpressionAttributeNames={"#m": "minutes", "#ttl": "ttl"},
        ExpressionAttributeValues={":d": {"N": str(delta)}, ":ttl": {"N": str(end_of_day_ttl())}},
    )
    try:
        db.update_item(
            TableName=cfg.app_table,
            Key=_usage_key(owner_id),
            UpdateExpression="SET #m = :zero",
            ConditionExpression="#m < :zero",
            ExpressionAttributeNames={"#m": "minutes"},
            ExpressionAttributeValues={":zero": {"N": "0"}},
        )
    except db.exceptions.ConditionalCheckFailedException:
        pass


def _reserve_daily_quota_provisional(cfg: Config, owner_id: str, job_name: str, provisional_minutes: int) -> None:
    db = _dynamodb()
    limit = cfg.daily_minutes_allowance
    try:
        db.update_item(
            TableName=cfg.app_table,
            Key=_usage_key(owner_id),
            UpdateExpression="SET #ttl = :ttl ADD #m :inc",
            ConditionExpression="attribute_not_exists(#m) OR #m <= :room",
            ExpressionAttributeNames={"#m": "minutes", "#ttl": "ttl"},
            ExpressionAttributeValues={
                ":inc": {"N": str(provisional_minutes)},
                ":ttl": {"N": str(end_of_day_ttl())},
                ":room": {"N": str(max(0, limit - provisional_minutes))},
            },
        )
    except db.exceptions.ConditionalCheckFailedException:
        raise ClientError(429, "daily_quota", "Günlük transkript sınırına ulaşıldı.")

    db.update_item(
        TableName=cfg.app_table,
        Key=_job_key(owner_id, job_name),
        UpdateExpression="SET provisional = :p, settled = :false, #ttl = :ttl",
        ExpressionAttributeNames={"#ttl": "ttl"},
        ExpressionAttributeValues={
            ":p": {"N": str(provisional_minutes)},
            ":false": {"BOOL": False},
            ":ttl": {"N": str(job_record_ttl())},
        },
    )


def _settle_job(cfg: Config, owner_id: str, job_name: str, actual_minutes: int, duration_seconds: float) -> None:
    db = _dynamodb()
    try:
        db.update_item(
            TableName=cfg.app_table,
            Key=_job_key(owner_id, job_name),
            UpdateExpression="SET settled = :true, actualMinutes = :am, durationSeconds = :ds, #ttl = :ttl",
            ConditionExpression="attribute_exists(provisional) AND settled = :false",
            ExpressionAttributeNames={"#ttl": "ttl"},
            ExpressionAttributeValues={
                ":true": {"BOOL": True},
                ":false": {"BOOL": False},
                ":am": {"N": str(actual_minutes)},
                ":ds": {"N": repr(round(duration_seconds, 3))},
                ":ttl": {"N": str(job_record_ttl())},
            },
            ReturnValues="UPDATED_OLD",
        )
    except db.exceptions.ConditionalCheckFailedException:
        return  # already settled -> idempotent no-op
    rec = db.get_item(TableName=cfg.app_table, Key=_job_key(owner_id, job_name)).get("Item", {})
    provisional = int(rec.get("provisional", {}).get("N", "0"))
    _add_day_minutes(cfg, owner_id, actual_minutes - provisional)


def _release_job(cfg: Config, owner_id: str, job_name: str) -> None:
    db = _dynamodb()
    try:
        db.update_item(
            TableName=cfg.app_table,
            Key=_job_key(owner_id, job_name),
            UpdateExpression="SET settled = :true, actualMinutes = :zero, durationSeconds = :zerof, #ttl = :ttl",
            ConditionExpression="attribute_exists(provisional) AND settled = :false",
            ExpressionAttributeNames={"#ttl": "ttl"},
            ExpressionAttributeValues={
                ":true": {"BOOL": True},
                ":false": {"BOOL": False},
                ":zero": {"N": "0"},
                ":zerof": {"N": "0"},
                ":ttl": {"N": str(job_record_ttl())},
            },
        )
    except db.exceptions.ConditionalCheckFailedException:
        return
    rec = db.get_item(TableName=cfg.app_table, Key=_job_key(owner_id, job_name)).get("Item", {})
    provisional = int(rec.get("provisional", {}).get("N", "0"))
    _add_day_minutes(cfg, owner_id, -provisional)


# ---------------------------------------------------------------------------
# Transcription routes
# ---------------------------------------------------------------------------
def _head_object_size(cfg: Config, key: str) -> int:
    try:
        head = _s3.head_object(Bucket=cfg.media_bucket, Key=key)
    except BotoClientError:
        raise ClientError(404, "not_found", "Ses dosyası bulunamadı.")
    return int(head["ContentLength"])


def _upload_url(cfg: Config, owner_id: str, body: dict) -> dict:
    # course + lesson must belong to the authenticated owner (never trust ids).
    course_id = (body or {}).get("courseId", "")
    lesson_id = (body or {}).get("lessonId", "")
    store.require_course(owner_id, course_id)
    store.require_lesson(owner_id, course_id, lesson_id)

    source_id = store.new_id("src")
    audio_key = new_audio_key(owner_id, course_id, lesson_id, source_id)  # server-generated
    presigned = _s3.generate_presigned_post(
        Bucket=cfg.media_bucket,
        Key=audio_key,
        Fields={"Content-Type": "audio/m4a"},
        Conditions=[
            {"Content-Type": "audio/m4a"},
            ["content-length-range", 1, cfg.max_upload_bytes],
        ],
        ExpiresIn=900,
    )
    return {"uploadUrl": presigned["url"], "fields": presigned["fields"], "audioKey": audio_key, "sourceId": source_id}


def _start(cfg: Config, owner_id: str, body: dict) -> dict:
    audio_key = validate_audio_key(owner_id, (body or {}).get("audioKey"))
    course_id = (body or {}).get("courseId", "")
    lesson_id = (body or {}).get("lessonId", "")
    source_id = (body or {}).get("sourceId", "")
    store.require_course(owner_id, course_id)
    store.require_lesson(owner_id, course_id, lesson_id)

    size = _head_object_size(cfg, audio_key)
    if size <= 0 or size > cfg.max_upload_bytes:
        raise ClientError(413, "too_large", "Ses dosyası çok büyük.")

    cap_minutes = cfg.max_audio_seconds // 60
    provisional = provisional_minutes_from_size(size, cap_minutes)
    if provisional > cap_minutes:
        raise ClientError(413, "too_long", "Kayıt en fazla 90 dakika olabilir.")

    job_name = job_name_for(owner_id, audio_key)
    _reserve_daily_quota_provisional(cfg, owner_id, job_name, provisional)

    # Preserve the source (original audio) associated with course+lesson+job.
    store.put(
        owner_id,
        store.sk_source(lesson_id, source_id or job_name),
        {
            "sourceId": source_id or job_name,
            "courseId": course_id,
            "lessonId": lesson_id,
            "kind": "recording",
            "audioKey": audio_key,
            "jobName": job_name,
            "createdAt": store.now_iso(),
        },
    )

    out_key = transcript_key_for(audio_key)
    media_uri = f"s3://{cfg.media_bucket}/{audio_key}"
    try:
        _transcribe.start_transcription_job(
            TranscriptionJobName=job_name,
            LanguageCode=cfg.language_code,  # tr-TR
            MediaFormat="mp4",
            Media={"MediaFileUri": media_uri},
            OutputBucketName=cfg.media_bucket,
            OutputKey=out_key,
        )
    except BotoClientError:
        _release_job(cfg, owner_id, job_name)
        raise ClientError(502, "start_failed", "Transkripsiyon başlatılamadı. Tekrar deneyin.")
    return {"jobId": job_name, "status": "IN_PROGRESS", "sourceId": source_id or job_name}


def _fetch_transcript_output(uri: str) -> tuple[str, float | None, list]:
    with urllib.request.urlopen(uri, timeout=10) as resp:  # nosec - AWS-signed URL
        data = json.loads(resp.read().decode("utf-8"))
    results = data.get("results") or {}
    transcripts = results.get("transcripts") or []
    text = (transcripts[0].get("transcript") if transcripts else "") or ""
    all_items = results.get("items") or []
    pron = [i for i in all_items if i.get("type") == "pronunciation"]
    confs = []
    for it in pron:
        alt = (it.get("alternatives") or [{}])[0]
        try:
            confs.append(float(alt.get("confidence")))
        except (TypeError, ValueError):
            pass
    avg = round(sum(confs) / len(confs), 4) if confs else None
    return text, avg, all_items


def _job_owner_ok(owner_id: str, job_name: str) -> bool:
    import re

    frag = re.sub(r"[^0-9a-zA-Z]", "-", owner_id)
    return job_name.startswith(f"rojanda-{frag}-")


def _persist_transcript(owner_id: str, job_name: str, text: str, avg, duration_seconds: float) -> None:
    """Persist a transcript entity linked to owner + course + lesson + source +
    job, with metadata. Provenance preserved via the source row's ids."""
    # Find the source row for this job to recover course/lesson linkage.
    src = None
    for s in store.query_prefix(owner_id, "SOURCE#"):
        if s.get("jobName") == job_name:
            src = s
            break
    if not src:
        return  # nothing to link (job not started via our flow) — do not fabricate
    lesson_id = src.get("lessonId", "")
    source_id = src.get("sourceId", "")
    store.put(
        owner_id,
        # Source-specific key: multiple recordings on one lesson never overwrite.
        store.sk_transcript(lesson_id, source_id),
        {
            "lessonId": lesson_id,
            "courseId": src.get("courseId"),
            "sourceId": source_id,
            "jobName": job_name,
            "text": text,
            "language": "tr-TR",
            "confidenceAvg": avg,
            "durationSeconds": round(duration_seconds, 3),
            "editedByUser": False,
            "status": "ready",
            "createdAt": store.now_iso(),
        },
    )
    # Mark the lesson ready (best-effort; keyed by course+lesson).
    if src.get("courseId"):
        lesson = store.get(owner_id, store.sk_lesson(src["courseId"], lesson_id))
        if lesson:
            lesson["status"] = "ready"
            lesson["durationSec"] = round(duration_seconds, 3)
            store.put(owner_id, store.sk_lesson(src["courseId"], lesson_id), lesson)


def _status(cfg: Config, owner_id: str, params: dict) -> dict:
    job_name = (params or {}).get("jobId", "")
    if not job_name or not _job_owner_ok(owner_id, job_name):
        raise ClientError(403, "forbidden", "Bu işe erişim izniniz yok.")
    try:
        resp = _transcribe.get_transcription_job(TranscriptionJobName=job_name)
    except BotoClientError:
        raise ClientError(404, "not_found", "İş bulunamadı.")
    job = resp["TranscriptionJob"]
    state = job["TranscriptionJobStatus"]

    if state in ("QUEUED", "IN_PROGRESS"):
        return {"status": "IN_PROGRESS"}
    if state == "FAILED":
        _release_job(cfg, owner_id, job_name)
        return {"status": "FAILED", "error": job.get("FailureReason") or "transcription_failed"}

    uri = (job.get("Transcript") or {}).get("TranscriptFileUri")
    text, avg, items = _fetch_transcript_output(uri) if uri else ("", None, [])
    duration_seconds = authoritative_seconds(items)
    actual_minutes = seconds_to_billable_minutes(duration_seconds)
    _settle_job(cfg, owner_id, job_name, actual_minutes, duration_seconds)
    _persist_transcript(owner_id, job_name, text, avg, duration_seconds)
    return {
        "status": "COMPLETED",
        "transcript": text,
        "confidenceAvg": avg,
        "durationSeconds": round(duration_seconds, 3),
    }


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
def _method_path(event: dict) -> tuple[str, str]:
    rc = event.get("requestContext", {}) or {}
    http = rc.get("http", {}) or {}
    method = (http.get("method") or event.get("httpMethod") or "").upper()
    path = http.get("path") or event.get("rawPath") or event.get("path") or ""
    return method, path


def _path_params(event: dict) -> dict:
    return event.get("pathParameters") or {}


def _parse_body(event: dict) -> dict:
    raw = event.get("body") or "{}"
    try:
        return json.loads(raw) if isinstance(raw, str) else (raw or {})
    except json.JSONDecodeError:
        raise ClientError(400, "bad_json", "Geçersiz istek.")


def _response(status: int, payload: dict) -> dict:
    return {"statusCode": status, "headers": {"Content-Type": "application/json"}, "body": json.dumps(payload)}


def _route(cfg: Config, owner_id: str, event: dict):
    method, path = _method_path(event)
    p = _path_params(event)
    body = None

    # --- profile ---
    if path.endswith("/profile"):
        if method == "GET":
            return resources.get_profile(owner_id)
        if method == "PUT":
            return resources.update_profile(owner_id, _parse_body(event))

    # --- transcription (check specific paths before the generic course paths) ---
    if path.endswith("/transcribe/upload-url") and method == "POST":
        return _upload_url(cfg, owner_id, _parse_body(event))
    if path.endswith("/transcribe/start") and method == "POST":
        return _start(cfg, owner_id, _parse_body(event))
    if path.endswith("/transcribe/status") and method == "GET":
        return _status(cfg, owner_id, event.get("queryStringParameters") or {})

    course_id = p.get("courseId")
    lesson_id = p.get("lessonId")

    # --- sources / transcripts for a lesson (cross-device retrieval) ---
    if lesson_id is not None and course_id is not None and method == "GET":
        if path.endswith("/sources"):
            return resources.list_sources(owner_id, course_id, lesson_id)
        if path.endswith("/transcripts"):
            return resources.list_transcripts(owner_id, course_id, lesson_id)

    # --- lessons (nested) ---
    if lesson_id is not None:
        if method == "GET":
            return resources.get_lesson(owner_id, course_id, lesson_id)
        if method == "PUT":
            return resources.update_lesson(owner_id, course_id, lesson_id, _parse_body(event))
        if method == "DELETE":
            return resources.delete_lesson(owner_id, course_id, lesson_id)
    if course_id is not None and path.endswith("/lessons"):
        if method == "GET":
            return resources.list_lessons(owner_id, course_id)
        if method == "POST":
            return resources.create_lesson(owner_id, course_id, _parse_body(event))

    # --- courses ---
    if course_id is not None:
        if method == "GET":
            return resources.get_course(owner_id, course_id)
        if method == "PUT":
            return resources.update_course(owner_id, course_id, _parse_body(event))
        if method == "DELETE":
            return resources.delete_course(owner_id, course_id)
    if path.endswith("/courses"):
        if method == "GET":
            return resources.list_courses(owner_id)
        if method == "POST":
            return resources.create_course(owner_id, _parse_body(event))

    raise ClientError(404, "no_route", "Bulunamadı.")


def handler(event, _context=None):
    cfg = Config.from_env()
    try:
        owner_id = get_owner_id(event)  # verified sub or 401
        return _response(200, _route(cfg, owner_id, event))
    except ClientError as e:
        return _response(e.status, {"error": {"code": e.code, "message": e.message}})
    except Exception:  # noqa: BLE001 - never leak internals
        return _response(500, {"error": {"code": "internal", "message": "Beklenmeyen bir hata oluştu."}})
