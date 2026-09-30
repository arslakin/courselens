"""RojAnda transcription API handler (upload-url + start + status).

Routes (all AWS_IAM authed; userId derived from the verified Cognito identity):
  POST /transcribe/upload-url  -> presigned POST (S3-enforced 150 MB max), server key
  POST /transcribe/start       -> head_object size verify + daily 120-min quota
                                  + tr-TR Transcribe job (server-named); no fabrication
  GET  /transcribe/status      -> job status/transcript; FAILED preserves audio, retry ok

Security-critical rules, all enforced here:
  * identity comes only from requestContext (never the body)
  * S3 keys are server-generated and regex+ownership validated (no path injection,
    no cross-user access)
  * uploads capped by S3 content-length-range AND server head_object check
  * per-identity daily minutes quota via a conditional DynamoDB UpdateItem
  * transcript text is only ever what Transcribe returns — never invented
"""
from __future__ import annotations

import json
import urllib.request

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError as BotoClientError

from .core import (
    ClientError,
    Config,
    authoritative_seconds,
    end_of_day_ttl,
    get_identity_id,
    job_name_for,
    job_record_ttl,
    job_usage_pk,
    new_audio_key,
    provisional_minutes_from_size,
    seconds_to_billable_minutes,
    transcript_key_for,
    usage_pk,
    validate_audio_key,
)

# Presigned POST + head_object need SigV4; region pinned via Lambda env.
_s3 = boto3.client("s3", config=BotoConfig(signature_version="s3v4"))
_transcribe = boto3.client("transcribe")
_dynamodb = boto3.client("dynamodb")


# ---------------------------------------------------------------------------
# Route: POST /transcribe/upload-url
# ---------------------------------------------------------------------------
def _upload_url(cfg: Config, identity_id: str, body: dict) -> dict:
    audio_key = new_audio_key(identity_id)  # server-generated; client picks nothing
    presigned = _s3.generate_presigned_post(
        Bucket=cfg.media_bucket,
        Key=audio_key,
        Fields={"Content-Type": "audio/m4a"},
        Conditions=[
            {"Content-Type": "audio/m4a"},
            # S3-ENFORCED max upload size (approved: presigned POST, not PUT).
            ["content-length-range", 1, cfg.max_upload_bytes],
        ],
        ExpiresIn=900,
    )
    return {"uploadUrl": presigned["url"], "fields": presigned["fields"], "audioKey": audio_key}


# ---------------------------------------------------------------------------
# Route: POST /transcribe/start
# ---------------------------------------------------------------------------
def _head_object_size(cfg: Config, key: str) -> int:
    try:
        head = _s3.head_object(Bucket=cfg.media_bucket, Key=key)
    except BotoClientError:
        raise ClientError(404, "not_found", "Ses dosyası bulunamadı.")
    return int(head["ContentLength"])


def _add_day_minutes(cfg: Config, identity_id: str, delta: int) -> None:
    """Unconditionally add `delta` (may be negative) to today's counter, floored
    at 0. Used for reconcile/release where the quota gate already passed."""
    if delta == 0:
        return
    _dynamodb.update_item(
        TableName=cfg.usage_table,
        Key={"pk": {"S": usage_pk(identity_id)}},
        UpdateExpression="SET #ttl = :ttl ADD #m :d",
        ExpressionAttributeNames={"#m": "minutes", "#ttl": "ttl"},
        ExpressionAttributeValues={
            ":d": {"N": str(delta)},
            ":ttl": {"N": str(end_of_day_ttl())},
        },
    )
    # Floor at 0 in case a release would drive it negative (defensive). The
    # conditional write is a no-op when minutes >= 0 (DynamoDB raises
    # ConditionalCheckFailed, which we intentionally swallow).
    try:
        _dynamodb.update_item(
            TableName=cfg.usage_table,
            Key={"pk": {"S": usage_pk(identity_id)}},
            UpdateExpression="SET #m = :zero",
            ConditionExpression="#m < :zero",
            ExpressionAttributeNames={"#m": "minutes"},
            ExpressionAttributeValues={":zero": {"N": "0"}},
        )
    except _dynamodb.exceptions.ConditionalCheckFailedException:
        pass


def _reserve_daily_quota_provisional(
    cfg: Config, identity_id: str, job_name: str, provisional_minutes: int
) -> None:
    """Up-front ABUSE GUARD: atomically add the PROVISIONAL (size-derived)
    minutes to today's counter, rejecting if it would exceed the allowance.

    This provisional value is never exposed as actual usage; it is reconciled to
    the authoritative Transcribe duration on completion (and released on
    failure). Also writes a per-job accounting record so reconcile/release are
    idempotent and retry-safe.
    """
    limit = cfg.daily_minutes_allowance
    try:
        _dynamodb.update_item(
            TableName=cfg.usage_table,
            Key={"pk": {"S": usage_pk(identity_id)}},
            UpdateExpression="SET #ttl = :ttl ADD #m :inc",
            ConditionExpression="attribute_not_exists(#m) OR #m <= :room",
            ExpressionAttributeNames={"#m": "minutes", "#ttl": "ttl"},
            ExpressionAttributeValues={
                ":inc": {"N": str(provisional_minutes)},
                ":ttl": {"N": str(end_of_day_ttl())},
                ":room": {"N": str(max(0, limit - provisional_minutes))},
            },
        )
    except _dynamodb.exceptions.ConditionalCheckFailedException:
        raise ClientError(429, "daily_quota", "Günlük transkript sınırına ulaşıldı.")

    # Per-job record: provisional reserved, not yet settled. Created once.
    _dynamodb.update_item(
        TableName=cfg.usage_table,
        Key={"pk": {"S": job_usage_pk(identity_id, job_name)}},
        UpdateExpression="SET provisional = :p, settled = :false, #ttl = :ttl",
        ExpressionAttributeNames={"#ttl": "ttl"},
        ExpressionAttributeValues={
            ":p": {"N": str(provisional_minutes)},
            ":false": {"BOOL": False},
            ":ttl": {"N": str(job_record_ttl())},
        },
    )


def _settle_job(cfg: Config, identity_id: str, job_name: str, actual_minutes: int,
                duration_seconds: float) -> None:
    """Idempotently settle a job's usage to the AUTHORITATIVE actual minutes.

    Marks the per-job record settled (conditional on not-yet-settled), records
    authoritative durationSeconds for future pricing/analytics, and adjusts the
    day counter by (actual - provisional). Repeated calls are no-ops.
    """
    try:
        _dynamodb.update_item(
            TableName=cfg.usage_table,
            Key={"pk": {"S": job_usage_pk(identity_id, job_name)}},
            UpdateExpression=(
                "SET settled = :true, actualMinutes = :am, "
                "durationSeconds = :ds, #ttl = :ttl"
            ),
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
    except _dynamodb.exceptions.ConditionalCheckFailedException:
        # Already settled (or no record) -> idempotent no-op; never double-count.
        return

    # Read back the provisional to compute the day-counter delta.
    rec = _dynamodb.get_item(
        TableName=cfg.usage_table,
        Key={"pk": {"S": job_usage_pk(identity_id, job_name)}},
    ).get("Item", {})
    provisional = int(rec.get("provisional", {}).get("N", "0"))
    _add_day_minutes(cfg, identity_id, actual_minutes - provisional)


def _start(cfg: Config, identity_id: str, body: dict) -> dict:
    audio_key = validate_audio_key(identity_id, body.get("audioKey"))

    # Hard upload-size limit: enforced by S3 at upload time via the presigned
    # POST content-length-range condition, AND re-verified here server-side.
    size = _head_object_size(cfg, audio_key)
    if size <= 0 or size > cfg.max_upload_bytes:
        raise ClientError(413, "too_large", "Ses dosyası çok büyük.")

    cap_minutes = cfg.max_audio_seconds // 60
    # PROVISIONAL, size-derived minutes — abuse/quota guard ONLY. Never recorded
    # or exposed as actual usage; reconciled to the authoritative Transcribe
    # duration on completion (released on failure).
    provisional = provisional_minutes_from_size(size, cap_minutes)
    if provisional > cap_minutes:
        raise ClientError(413, "too_long", "Kayıt en fazla 90 dakika olabilir.")

    # Each start (including a retry) gets its OWN job + accounting record, so a
    # failed attempt can be released without affecting a later successful one.
    job_name = job_name_for(identity_id, audio_key)
    _reserve_daily_quota_provisional(cfg, identity_id, job_name, provisional)

    out_key = transcript_key_for(audio_key)
    media_uri = f"s3://{cfg.media_bucket}/{audio_key}"
    try:
        _transcribe.start_transcription_job(
            TranscriptionJobName=job_name,
            LanguageCode=cfg.language_code,  # tr-TR
            MediaFormat="mp4",  # .m4a AAC container — accepted natively, no conversion
            Media={"MediaFileUri": media_uri},
            OutputBucketName=cfg.media_bucket,
            OutputKey=out_key,
        )
    except BotoClientError:
        # Failed to even start -> release the provisional reservation so a failed
        # job is never charged, then surface a retryable error.
        _release_job(cfg, identity_id, job_name)
        raise ClientError(502, "start_failed", "Transkripsiyon başlatılamadı. Tekrar deneyin.")
    return {"jobId": job_name, "status": "IN_PROGRESS"}


def _release_job(cfg: Config, identity_id: str, job_name: str) -> None:
    """Idempotently release a job's PROVISIONAL reservation (failed/cancelled).

    Subtracts the provisional minutes from the day counter exactly once and marks
    the per-job record settled with zero actual usage. Repeated calls are no-ops,
    so a failed job never remains permanently charged as usage."""
    try:
        _dynamodb.update_item(
            TableName=cfg.usage_table,
            Key={"pk": {"S": job_usage_pk(identity_id, job_name)}},
            UpdateExpression=(
                "SET settled = :true, actualMinutes = :zero, "
                "durationSeconds = :zerof, #ttl = :ttl"
            ),
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
    except _dynamodb.exceptions.ConditionalCheckFailedException:
        return  # already settled -> idempotent no-op

    rec = _dynamodb.get_item(
        TableName=cfg.usage_table,
        Key={"pk": {"S": job_usage_pk(identity_id, job_name)}},
    ).get("Item", {})
    provisional = int(rec.get("provisional", {}).get("N", "0"))
    _add_day_minutes(cfg, identity_id, -provisional)


# ---------------------------------------------------------------------------
# Route: GET /transcribe/status
# ---------------------------------------------------------------------------
def _fetch_transcript_output(uri: str) -> tuple[str, float | None, list]:
    """Download the Transcribe output JSON -> (text, avg_confidence, items).

    Returns the real transcript only — never fabricated. On any parse issue we
    surface empty text/items, not invented content. `items` carry end_time and
    are the authoritative source for processed-audio duration.
    """
    with urllib.request.urlopen(uri, timeout=10) as resp:  # nosec - AWS-signed URL from Transcribe
        data = json.loads(resp.read().decode("utf-8"))
    results = (data.get("results") or {})
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
    # Return ALL items (pronunciation carries end_time; punctuation may too).
    return text, avg, all_items


def _ownership_ok(identity_id: str, job_name: str) -> bool:
    import re

    frag = re.sub(r"[^0-9a-zA-Z]", "-", identity_id)
    return job_name.startswith(f"rojanda-{frag}-")


def _status(cfg: Config, identity_id: str, params: dict) -> dict:
    job_name = (params or {}).get("jobId", "")
    if not job_name or not _ownership_ok(identity_id, job_name):
        # Either missing, or belongs to another identity — never reveal it.
        raise ClientError(403, "forbidden", "Bu işe erişim izniniz yok.")
    try:
        resp = _transcribe.get_transcription_job(TranscriptionJobName=job_name)
    except BotoClientError:
        raise ClientError(404, "not_found", "İş bulunamadı.")
    job = resp["TranscriptionJob"]
    state = job["TranscriptionJobStatus"]  # QUEUED | IN_PROGRESS | COMPLETED | FAILED

    if state in ("QUEUED", "IN_PROGRESS"):
        return {"status": "IN_PROGRESS"}
    if state == "FAILED":
        # Release the provisional reservation (idempotent) so a failed job is
        # never charged as usage. Audio is preserved; the client may retry.
        _release_job(cfg, identity_id, job_name)
        return {"status": "FAILED", "error": job.get("FailureReason") or "transcription_failed"}

    # COMPLETED
    uri = (job.get("Transcript") or {}).get("TranscriptFileUri")
    text, avg, items = _fetch_transcript_output(uri) if uri else ("", None, [])
    # AUTHORITATIVE duration from Transcribe (max end_time). Second-level
    # precision is preserved; minutes (rounded up) are used only for the quota.
    duration_seconds = authoritative_seconds(items)
    actual_minutes = seconds_to_billable_minutes(duration_seconds)
    _settle_job(cfg, identity_id, job_name, actual_minutes, duration_seconds)
    return {
        "status": "COMPLETED",
        "transcript": text,
        "confidenceAvg": avg,
        "durationSeconds": round(duration_seconds, 3),
    }


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
def _route_key(event: dict) -> tuple[str, str]:
    rc = event.get("requestContext", {}) or {}
    http = rc.get("http", {}) or {}
    method = http.get("method") or event.get("httpMethod") or ""
    path = http.get("path") or event.get("rawPath") or event.get("path") or ""
    return method.upper(), path


def _parse_body(event: dict) -> dict:
    raw = event.get("body") or "{}"
    try:
        return json.loads(raw) if isinstance(raw, str) else (raw or {})
    except json.JSONDecodeError:
        raise ClientError(400, "bad_json", "Geçersiz istek.")


def _response(status: int, payload: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(payload),
    }


def handler(event, _context=None):
    cfg = Config.from_env()
    try:
        identity_id = get_identity_id(event)  # verified identity or 401
        method, path = _route_key(event)

        if method == "POST" and path.endswith("/transcribe/upload-url"):
            return _response(200, _upload_url(cfg, identity_id, _parse_body(event)))
        if method == "POST" and path.endswith("/transcribe/start"):
            return _response(200, _start(cfg, identity_id, _parse_body(event)))
        if method == "GET" and path.endswith("/transcribe/status"):
            return _response(200, _status(cfg, identity_id, event.get("queryStringParameters") or {}))

        raise ClientError(404, "no_route", "Bulunamadı.")
    except ClientError as e:
        return _response(e.status, {"error": {"code": e.code, "message": e.message}})
    except Exception:  # noqa: BLE001 - never leak internals to the client
        return _response(500, {"error": {"code": "internal", "message": "Beklenmeyen bir hata oluştu."}})
