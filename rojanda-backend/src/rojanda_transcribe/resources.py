"""Authenticated profile / course / lesson handlers (Phase 1C).

Every handler receives the verified `owner_id` (Cognito sub) — never a client-
supplied ownerId — and scopes all storage to that owner's OWNER#<sub> partition.
courseId/lessonId identify resources; ownership is proven by the partition +
require_course/require_lesson checks, so User A cannot touch User B's data even
with a known id.
"""
from __future__ import annotations

from .core import ClientError
from . import store


# --- Profile ----------------------------------------------------------------
DEFAULT_PREFERENCES = {"quizLength": 10, "podcastLength": "short", "largeText": False, "reduceMotion": False}

# Profile fields the student may edit. Authorization identity (owner/sub) is NOT
# in this list and can never be changed via the API.
_EDITABLE_PROFILE_FIELDS = {"displayName", "locale", "school", "grade", "avatarColor", "preferences"}


def get_profile(owner_id: str) -> dict:
    prof = store.get(owner_id, store.sk_profile())
    if not prof:
        # Lazily create a default profile on first authenticated access.
        prof = store.put(
            owner_id,
            store.sk_profile(),
            {"displayName": "Öğrenci", "locale": "tr", "preferences": DEFAULT_PREFERENCES, "createdAt": store.now_iso()},
        )
    return _public_profile(prof)


def update_profile(owner_id: str, body: dict) -> dict:
    prof = store.get(owner_id, store.sk_profile()) or {
        "displayName": "Öğrenci",
        "locale": "tr",
        "preferences": DEFAULT_PREFERENCES,
        "createdAt": store.now_iso(),
    }
    # Apply only editable fields; silently ignore anything else (e.g. a client
    # trying to set pk/sk/ownerId/sub).
    for k, v in (body or {}).items():
        if k in _EDITABLE_PROFILE_FIELDS:
            prof[k] = v
    prof["updatedAt"] = store.now_iso()
    store.put(owner_id, store.sk_profile(), prof)
    return _public_profile(prof)


def _public_profile(prof: dict) -> dict:
    # Never expose internal keys.
    return {k: v for k, v in prof.items() if k not in ("pk", "sk")}


# --- Courses ----------------------------------------------------------------
def list_courses(owner_id: str) -> dict:
    items = store.query_prefix(owner_id, "COURSE#")
    # Exclude lesson rows (SK begins COURSE#..#LESSON#..). Keep only direct courses.
    courses = [_public(c) for c in items if "#LESSON#" not in c["sk"]]
    return {"courses": courses}


def create_course(owner_id: str, body: dict) -> dict:
    title = (body or {}).get("title")
    if not isinstance(title, str) or not title.strip():
        raise ClientError(400, "bad_request", "Ders adı gerekli.")
    course_id = store.new_id("course")
    item = store.put(
        owner_id,
        store.sk_course(course_id),
        {"courseId": course_id, "title": title.strip(), "color": (body or {}).get("color"), "createdAt": store.now_iso()},
    )
    return _public(item)


def get_course(owner_id: str, course_id: str) -> dict:
    return _public(store.require_course(owner_id, course_id))


def update_course(owner_id: str, course_id: str, body: dict) -> dict:
    course = store.require_course(owner_id, course_id)
    for k in ("title", "color"):
        if k in (body or {}):
            course[k] = body[k]
    course["updatedAt"] = store.now_iso()
    store.put(owner_id, store.sk_course(course_id), course)
    return _public(course)


def delete_course(owner_id: str, course_id: str) -> dict:
    store.require_course(owner_id, course_id)
    # Delete the course + its lessons (all under this owner's partition).
    store.delete(owner_id, store.sk_course(course_id))
    for lesson in store.query_prefix(owner_id, store.sk_lesson_prefix(course_id)):
        store.delete(owner_id, lesson["sk"])
    return {"deleted": True}


# --- Lessons ----------------------------------------------------------------
def list_lessons(owner_id: str, course_id: str) -> dict:
    store.require_course(owner_id, course_id)  # ownership of the course
    items = store.query_prefix(owner_id, store.sk_lesson_prefix(course_id))
    return {"lessons": [_public(l) for l in items]}


def create_lesson(owner_id: str, course_id: str, body: dict) -> dict:
    store.require_course(owner_id, course_id)  # do not trust courseId alone
    title = (body or {}).get("title")
    if not isinstance(title, str) or not title.strip():
        raise ClientError(400, "bad_request", "Ders kaydı başlığı gerekli.")
    lesson_id = store.new_id("lesson")
    item = store.put(
        owner_id,
        store.sk_lesson(course_id, lesson_id),
        {
            "lessonId": lesson_id,
            "courseId": course_id,
            "title": title.strip(),
            "status": "draft",
            "createdAt": store.now_iso(),
        },
    )
    return _public(item)


def get_lesson(owner_id: str, course_id: str, lesson_id: str) -> dict:
    store.require_course(owner_id, course_id)
    return _public(store.require_lesson(owner_id, course_id, lesson_id))


def update_lesson(owner_id: str, course_id: str, lesson_id: str, body: dict) -> dict:
    store.require_course(owner_id, course_id)
    lesson = store.require_lesson(owner_id, course_id, lesson_id)
    for k in ("title", "status", "durationSec"):
        if k in (body or {}):
            lesson[k] = body[k]
    lesson["updatedAt"] = store.now_iso()
    store.put(owner_id, store.sk_lesson(course_id, lesson_id), lesson)
    return _public(lesson)


def delete_lesson(owner_id: str, course_id: str, lesson_id: str) -> dict:
    store.require_course(owner_id, course_id)
    store.require_lesson(owner_id, course_id, lesson_id)
    store.delete(owner_id, store.sk_lesson(course_id, lesson_id))
    # Also delete the lesson's sources + transcripts + study materials.
    for s in store.query_prefix(owner_id, store.sk_source_prefix(lesson_id)):
        store.delete(owner_id, s["sk"])
    for t in store.query_prefix(owner_id, store.sk_transcript_prefix(lesson_id)):
        store.delete(owner_id, t["sk"])
    for sm in store.query_prefix(owner_id, store.sk_study_prefix(lesson_id)):
        store.delete(owner_id, sm["sk"])
    return {"deleted": True}


# --- Sources & transcripts (cross-device retrieval; no raw S3 exposure) -----
def list_sources(owner_id: str, course_id: str, lesson_id: str) -> dict:
    store.require_course(owner_id, course_id)
    store.require_lesson(owner_id, course_id, lesson_id)
    items = store.query_prefix(owner_id, store.sk_source_prefix(lesson_id))
    # Do NOT expose the raw S3 key to the client; keep only safe metadata.
    return {"sources": [_source_public(s) for s in items]}


def list_transcripts(owner_id: str, course_id: str, lesson_id: str) -> dict:
    store.require_course(owner_id, course_id)
    store.require_lesson(owner_id, course_id, lesson_id)
    items = store.query_prefix(owner_id, store.sk_transcript_prefix(lesson_id))
    return {"transcripts": [_public(t) for t in items]}


def _source_public(s: dict) -> dict:
    # Expose only safe fields; the raw audioKey stays server-side.
    return {
        k: v
        for k, v in s.items()
        if k in ("sourceId", "courseId", "lessonId", "kind", "jobName", "createdAt")
    }


# --- Study materials (Phase 2) ----------------------------------------------
# Generated study content lives at STUDY#<lessonId>#<sourceId>, grounded to the
# transcript of that source. Each item carries provenance + the transcript
# fingerprint it was built from, so staleness is detectable without a model
# call. Ownership is proven by the OWNER# partition + require_course/lesson.
import time  # noqa: E402

from . import study as study_mod  # noqa: E402  (local import to keep core thin)
from . import jobs as jobs_mod  # noqa: E402

# A claim held for longer than this (seconds) without finishing is considered
# abandoned (e.g. a crashed/timed-out worker) and may be reclaimed by a new
# request. Must comfortably exceed worst-case generation time for a supported
# ~50-min lesson. Not a per-chunk value — the whole run.
STUDY_CLAIM_TTL_SECONDS = 15 * 60


def _pick_transcript(owner_id: str, lesson_id: str, source_id: str | None) -> dict | None:
    """Return the transcript item to ground on: the requested source's, or the
    newest ready transcript for the lesson when source_id is not given."""
    items = [t for t in store.query_prefix(owner_id, store.sk_transcript_prefix(lesson_id))
             if (t.get("text") or "").strip()]
    if not items:
        return None
    if source_id:
        for t in items:
            if t.get("sourceId") == source_id:
                return t
        return None
    items.sort(key=lambda t: t.get("createdAt", ""), reverse=True)
    return items[0]


def list_study(owner_id: str, course_id: str, lesson_id: str) -> dict:
    """Return the lesson's study materials with a computed staleness flag.

    Read-only; never triggers generation. `stale` is true when the stored
    fingerprint no longer matches the current transcript for that source.
    """
    store.require_course(owner_id, course_id)
    store.require_lesson(owner_id, course_id, lesson_id)
    out = []
    transcripts = {t.get("sourceId"): t for t in store.query_prefix(owner_id, store.sk_transcript_prefix(lesson_id))}
    for sm in store.query_prefix(owner_id, store.sk_study_prefix(lesson_id)):
        pub = _study_public(sm)
        cur = transcripts.get(sm.get("sourceId"))
        cur_fp = study_mod.transcript_fingerprint(cur.get("text", "")) if cur else None
        pub["stale"] = bool(cur_fp and sm.get("transcriptFingerprint") and cur_fp != sm.get("transcriptFingerprint"))
        out.append(pub)
    return {"study": out}


def generate_study(cfg_language: str, owner_id: str, course_id: str, lesson_id: str, body: dict) -> dict:
    """Generate (or return existing, idempotently) grounded study material.

    IDEMPOTENCY (anti duplicate-spend): three layers, in order —
      1. A READY, fingerprint-matching item is returned WITHOUT any model call
         (unless {"force": true}). Safe for repeated taps once a result exists.
      2. A FRESH `generating` claim (started < STUDY_CLAIM_TTL_SECONDS ago) is
         treated as already-in-progress: we return that status instead of
         starting a second run. This is what protects against a retry after an
         API Gateway 30s timeout or a mobile network drop re-spending on a model.
      3. The claim is written with a CONDITIONAL put (`store.put_claim`), so two
         concurrent requests cannot both start — exactly one wins the claim.

    SYNC vs ASYNC: when a background queue is configured (`jobs.is_async_enabled`
    — production with a paid provider), we claim + enqueue + return a
    `generating` item fast (the worker finishes it). When no queue is configured
    (local dev / tests / the deterministic local provider), we generate inline:
    the local provider is offline and sub-second, so no HTTP timeout risk.
    """
    store.require_course(owner_id, course_id)
    store.require_lesson(owner_id, course_id, lesson_id)
    body = body or {}
    requested_source = body.get("sourceId") if isinstance(body.get("sourceId"), str) else None
    force = body.get("force") is True

    transcript = _pick_transcript(owner_id, lesson_id, requested_source)
    if not transcript:
        raise ClientError(409, "no_transcript", "Önce transkript gerekli. Çalışma içeriği transkriptten üretilir.")
    source_id = transcript["sourceId"]
    text = transcript.get("text", "") or ""
    fingerprint = study_mod.transcript_fingerprint(text)

    sk = store.sk_study(lesson_id, source_id)
    existing = store.get(owner_id, sk)

    # Layer 1 — idempotent fast-path: a ready, fingerprint-matching item needs
    # no model call.
    if existing and not force and existing.get("status") == "ready" \
            and existing.get("transcriptFingerprint") == fingerprint:
        return _study_public(existing)

    # Layer 2 — a fresh in-flight generation for the SAME fingerprint is already
    # running: return its status rather than starting a duplicate (no re-spend).
    # This guard applies ONLY to a genuine in-progress run; a `failed` row is
    # always immediately retryable, and a changed fingerprint must regenerate.
    now_epoch = int(time.time())
    if existing and not force and existing.get("status") == "generating" \
            and existing.get("transcriptFingerprint") == fingerprint \
            and int(existing.get("startedAtEpoch") or 0) > now_epoch - STUDY_CLAIM_TTL_SECONDS:
        return _study_public(existing)

    language = "tr" if (cfg_language or "tr-TR").lower().startswith("tr") else "en"
    claim_token = store.new_id("studyclaim")
    base = {
        "lessonId": lesson_id,
        "courseId": course_id,
        "sourceId": source_id,
        "status": "generating",
        "schemaVersion": study_mod.STUDY_SCHEMA_VERSION,
        "transcriptFingerprint": fingerprint,
        "provenance": "Kaynaklarından",
        "claimToken": claim_token,
        "startedAtEpoch": now_epoch,
        "createdAt": (existing or {}).get("createdAt") or store.now_iso(),
        "updatedAt": store.now_iso(),
    }

    # Decide whether we may take over unconditionally, or must contend for the
    # claim. We take over directly (overwrite) when there is NOTHING in progress
    # to protect: no existing row, an explicit force, a previous `failed`, or a
    # changed fingerprint (the old run is for different content). The CONDITIONAL
    # claim is reserved for the one race that matters — two concurrent requests
    # against the same fresh target — so neither can start a duplicate run.
    may_take_over = (
        not existing
        or force
        or existing.get("status") == "failed"
        or existing.get("transcriptFingerprint") != fingerprint
    )
    if may_take_over:
        store.put(owner_id, sk, base)
    else:
        try:
            store.put_claim(owner_id, sk, base, fresh_before_epoch=now_epoch - STUDY_CLAIM_TTL_SECONDS)
        except store.ClaimConflict:
            current = store.get(owner_id, sk)
            return _study_public(current or base)

    # ASYNC: hand off to the background worker and return fast (well under the
    # API Gateway 30s window). The worker reads the authoritative transcript and
    # persists ready/failed; the mobile client polls GET .../study.
    if jobs_mod.is_async_enabled():
        try:
            jobs_mod.enqueue_study_job(owner_id, course_id, lesson_id, source_id,
                                       fingerprint, claim_token, language)
        except ClientError:
            raise
        except Exception as e:  # noqa: BLE001 - enqueue failed; mark retryable
            failed = {**base, "status": "failed", "error": "enqueue_failed", "updatedAt": store.now_iso()}
            store.put(owner_id, sk, failed)
            raise ClientError(502, "enqueue_failed",
                              "Çalışma içeriği kuyruğa alınamadı. Lütfen tekrar deneyin.") from e
        return _study_public(base)

    # SYNC (local provider): run inline. Deterministic + offline, so no timeout
    # risk and no paid model call.
    provider = study_mod.make_provider()
    try:
        result = study_mod.generate_study(text, source_id, language, provider)
    except ClientError as e:
        failed = {**base, "status": "failed", "error": e.code, "updatedAt": store.now_iso()}
        store.put(owner_id, sk, failed)
        raise

    item = _ready_item(base, result, provider.name, language)
    store.put(owner_id, sk, item)
    return _study_public(item)


def _ready_item(base: dict, result: dict, provider_name: str, language: str) -> dict:
    """Assemble the persisted READY study item from a generation result. Shared
    by the synchronous path and the background worker so the shape is identical."""
    return {
        **base,
        "status": "ready",
        "summary": result["summary"],
        "concepts": result["concepts"],
        "flashcards": result["flashcards"],
        "quiz": result["quiz"],
        "chunkCount": result.get("chunkCount", 1),
        "provider": provider_name,
        "language": language,
        "updatedAt": store.now_iso(),
    }


def run_study_job(owner_id: str, course_id: str, lesson_id: str, source_id: str,
                  fingerprint: str, claim_token: str, language: str,
                  provider_client=None) -> None:
    """Background-worker entry point: perform the grounded MAP/REDUCE and persist
    the result. Invoked by the worker Lambda for each queued job.

    IDEMPOTENT + no duplicate spend:
      * If the stored claim token no longer matches, another run superseded this
        one (e.g. a `force` regenerate) — skip silently.
      * If a READY item for the same fingerprint already exists, skip (the work
        is done).
      * On provider error, persist `failed` (retryable) — never fabricate.
    The worker re-reads the AUTHORITATIVE transcript from the store (the queue
    message carries only ids), so it can never act on stale/forged content.
    """
    sk = store.sk_study(lesson_id, source_id)
    current = store.get(owner_id, sk)
    if not current:
        return  # claim row vanished (e.g. lesson deleted) — nothing to do
    if current.get("claimToken") != claim_token:
        return  # superseded by a newer claim
    if current.get("status") == "ready" and current.get("transcriptFingerprint") == fingerprint:
        return  # already completed

    transcript = _pick_transcript(owner_id, lesson_id, source_id)
    text = (transcript or {}).get("text", "") or ""
    cur_fp = study_mod.transcript_fingerprint(text)
    if not transcript or cur_fp != fingerprint:
        # The transcript changed (or vanished) after the job was queued; this
        # job's grounding target is gone. Mark failed/retryable rather than
        # generating against a mismatched source.
        failed = {**current, "status": "failed", "error": "transcript_changed", "updatedAt": store.now_iso()}
        store.put(owner_id, sk, failed)
        return

    provider = study_mod.make_provider(client=provider_client)
    try:
        result = study_mod.generate_study(text, source_id, language, provider)
    except ClientError as e:
        failed = {**current, "status": "failed", "error": e.code, "updatedAt": store.now_iso()}
        store.put(owner_id, sk, failed)
        return

    item = _ready_item(current, result, provider.name, language)
    store.put(owner_id, sk, item)


def _study_public(item: dict) -> dict:
    # Strip internal keys + the idempotency-claim bookkeeping (never client-facing).
    return {k: v for k, v in item.items() if k not in ("pk", "sk", "claimToken", "startedAtEpoch")}


def _public(item: dict) -> dict:
    return {k: v for k, v in item.items() if k not in ("pk", "sk")}
