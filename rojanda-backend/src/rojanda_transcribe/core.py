"""Pure, dependency-light helpers: config, identity, key construction/validation.

Kept free of boto3 so they are trivially unit-testable and so the security-
critical logic (identity derivation, key validation) has no I/O side effects.
"""
from __future__ import annotations

import os
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone


class ClientError(Exception):
    """A request-level error mapped to an HTTP status. Never leaks internals."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Config:
    media_bucket: str
    usage_table: str
    max_audio_seconds: int
    max_upload_bytes: int
    daily_minutes_allowance: int
    language_code: str

    @staticmethod
    def from_env() -> "Config":
        return Config(
            media_bucket=os.environ["ROJANDA_MEDIA_BUCKET"],
            usage_table=os.environ["ROJANDA_USAGE_TABLE"],
            max_audio_seconds=int(os.environ.get("ROJANDA_MAX_AUDIO_SECONDS", "5400")),
            max_upload_bytes=int(os.environ.get("ROJANDA_MAX_UPLOAD_BYTES", "157286400")),
            daily_minutes_allowance=int(os.environ.get("ROJANDA_DAILY_MINUTES_ALLOWANCE", "120")),
            # tr-TR is the approved default; env can localize later, never English by accident.
            language_code=os.environ.get("ROJANDA_TRANSCRIBE_LANGUAGE", "tr-TR"),
        )


# Identity ids from Cognito look like "us-east-1:<uuid>". We allow the region
# prefix + a uuid-ish body. This is ONLY used to build/validate our own key
# prefix; the authoritative value always comes from the verified request
# context (never the request body).
_IDENTITY_RE = re.compile(r"^[a-z]{2}-[a-z]+-\d:[0-9a-fA-F-]{36}$")

# Audio object keys we will ever accept/produce. Fixed shape, allow-list charset,
# no "..", no nested paths beyond the fixed segments.
_AUDIO_KEY_RE = re.compile(r"^users/([a-z]{2}-[a-z]+-\d:[0-9a-fA-F-]{36})/audio/[A-Za-z0-9._-]+\.m4a$")


def get_identity_id(event: dict) -> str:
    """Return the caller's Cognito identity id from the VERIFIED request context.

    For an IAM-authorized HTTP API (payload v2) the identity that signed the
    request appears under requestContext.authorizer.iam.cognitoIdentity.identityId
    (and, defensively, requestContext.identity.cognitoIdentityId on some shapes).
    We NEVER read identity from the body/query/headers.
    """
    rc = (event or {}).get("requestContext", {}) or {}

    # HTTP API (v2) IAM authorizer shape.
    iam = (((rc.get("authorizer") or {}).get("iam")) or {})
    cognito = (iam.get("cognitoIdentity") or {})
    identity_id = cognito.get("identityId")

    # Defensive fallbacks for alternate/proxy shapes.
    if not identity_id:
        identity_id = (rc.get("identity") or {}).get("cognitoIdentityId")

    if not identity_id or not _IDENTITY_RE.match(identity_id):
        raise ClientError(401, "unauthorized", "Kimlik doğrulanamadı.")
    return identity_id


def new_audio_key(identity_id: str) -> str:
    """Server-generated audio key under the caller's own prefix. Client never
    chooses any part of the path."""
    return f"users/{identity_id}/audio/{uuid.uuid4().hex}.m4a"


def validate_audio_key(identity_id: str, key: str) -> str:
    """Accept `key` only if it is well-formed AND owned by `identity_id`.

    Blocks path injection (regex allow-list, no "..") and cross-user access
    (the embedded identity must equal the caller's verified identity).
    """
    if not isinstance(key, str):
        raise ClientError(400, "bad_key", "Geçersiz ses anahtarı.")
    m = _AUDIO_KEY_RE.match(key)
    if not m:
        raise ClientError(400, "bad_key", "Geçersiz ses anahtarı.")
    if m.group(1) != identity_id:
        # The key belongs to a different identity -> cross-user attempt.
        raise ClientError(403, "forbidden", "Bu kayda erişim izniniz yok.")
    return key


def transcript_key_for(audio_key: str) -> str:
    """Deterministic per-user output key alongside the audio, same prefix."""
    # users/<id>/audio/<name>.m4a -> users/<id>/transcript/<name>.json
    return audio_key.replace("/audio/", "/transcript/", 1).rsplit(".", 1)[0] + ".json"


def job_name_for(identity_id: str, audio_key: str) -> str:
    """Server-generated, per-identity-namespaced Transcribe job name.

    Transcribe job names allow [0-9a-zA-Z._-] and must be <=200 chars. We embed
    a sanitized identity fragment + a fresh uuid so a client can neither choose
    a name nor collide with / read another user's job.
    """
    ident_frag = re.sub(r"[^0-9a-zA-Z]", "-", identity_id)
    return f"rojanda-{ident_frag}-{uuid.uuid4().hex}"[:200]


def today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def usage_pk(identity_id: str, day: str | None = None) -> str:
    """Partition key for the per-identity, per-DAY quota counter."""
    return f"{identity_id}#{day or today_utc()}"


def job_usage_pk(identity_id: str, job_name: str) -> str:
    """Partition key for a per-JOB accounting record (idempotency + reconcile).

    Kept separate from the day counter so repeated /status polls, retries, and
    failures can be reconciled exactly once per job without touching other jobs.
    """
    return f"{identity_id}#job#{job_name}"


def ttl_days(days: int) -> int:
    return int(datetime.now(timezone.utc).timestamp()) + days * 24 * 3600


def end_of_day_ttl() -> int:
    """Epoch seconds ~2 days out, so the per-day counter row self-expires."""
    return ttl_days(2)


def job_record_ttl() -> int:
    """Per-job accounting rows live longer than the day counter (~35 days) so
    late status polls after midnight still find the record and stay idempotent.
    Still self-expires — this is beta usage metering, not a billing ledger."""
    return ttl_days(35)


# --- Provisional (abuse-guard) minutes -------------------------------------
# AAC ~128 kbps => ~16 KB/s => ~960 KB/min. This is a SIZE-DERIVED PROVISIONAL
# estimate used ONLY as an up-front quota/abuse guard. It is NEVER recorded or
# exposed as actual student usage — actual usage comes from Transcribe (below).
_BYTES_PER_MINUTE_AAC = 128_000 / 8 * 60  # ~960,000 bytes/min


def provisional_minutes_from_size(size_bytes: int, cap_minutes: int) -> int:
    """Rounded-up minutes derived from file size, clamped to the recording cap.
    PROVISIONAL ONLY (abuse protection); not authoritative usage."""
    import math

    if size_bytes <= 0:
        return 1
    est = math.ceil(size_bytes / _BYTES_PER_MINUTE_AAC)
    return max(1, min(cap_minutes, est))


# --- Authoritative duration from Amazon Transcribe output ------------------
def authoritative_seconds(items: list) -> float:
    """Authoritative processed-audio duration = max(end_time) across transcript
    items, produced by Amazon Transcribe (server-side, never client-supplied).

    IMPORTANT SEMANTICS: this is the recognized-transcription duration THROUGH
    THE FINAL RECOGNIZED TOKEN, not the exact media-container wall-clock length.
    Audio with trailing silence after the last word will measure slightly SHORT
    of raw file duration. That is intentional for the MVP (student-favorable,
    no ffprobe/Lambda layer) and is documented for pricing/analytics use.
    """
    ends: list[float] = []
    for it in items or []:
        # Only timed tokens carry end_time (pronunciation; punctuation may not).
        try:
            ends.append(float(it.get("end_time")))
        except (TypeError, ValueError):
            continue
    return max(ends) if ends else 0.0


def seconds_to_billable_minutes(seconds: float) -> int:
    """Rounded-UP whole minutes, used ONLY where the quota system needs minutes.
    Second-level precision is preserved separately (durationSeconds)."""
    import math

    return int(math.ceil(seconds / 60)) if seconds > 0 else 0
