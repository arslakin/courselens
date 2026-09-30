"""Single-table persistence for RojAnda (`rojanda-app`).

Every item is partitioned by the authenticated owner:
    PK = OWNER#<sub>
    SK = PROFILE
       | COURSE#<courseId>
       | COURSE#<courseId>#LESSON#<lessonId>
       | SOURCE#<lessonId>#<sourceId>
       | TRANSCRIPT#<lessonId>
       | TRANSCRIBE_JOB#<jobName>
       | USAGE#<yyyy-mm-dd>

Access is ONLY GetItem / PutItem / UpdateItem / DeleteItem / Query — never Scan.
All reads/writes take `owner_id` (the verified Cognito sub) and build the PK from
it, so a caller can only ever touch its own partition. courseId/lessonId/etc.
identify resources but are never trusted as proof of ownership: the owner is the
partition, and nested-entity ownership is validated (e.g. a lesson op checks the
course exists under the same owner).

boto3 is used at module import so the handlers stay thin; unit tests inject a
fake client via `set_client`.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import boto3

from .core import ClientError

_dynamodb = boto3.client("dynamodb")


def set_client(client) -> None:
    """Test seam: replace the DynamoDB client with a fake."""
    global _dynamodb
    _dynamodb = client


def _table() -> str:
    return os.environ.get("ROJANDA_APP_TABLE", "rojanda-app")


def owner_pk(owner_id: str) -> str:
    return f"OWNER#{owner_id}"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    """Server-generated resource id (clients never choose ids)."""
    return f"{prefix}_{uuid.uuid4().hex}"


# --- DynamoDB attribute (un)marshalling — minimal, string/number/bool/map ----
def _to_attr(v: Any) -> dict:
    if isinstance(v, bool):
        return {"BOOL": v}
    if isinstance(v, (int, float)):
        return {"N": str(v)}
    if isinstance(v, str):
        return {"S": v}
    if v is None:
        return {"NULL": True}
    if isinstance(v, dict):
        return {"M": {k: _to_attr(x) for k, x in v.items()}}
    if isinstance(v, list):
        return {"L": [_to_attr(x) for x in v]}
    return {"S": str(v)}


def _from_attr(a: dict) -> Any:
    if "S" in a:
        return a["S"]
    if "N" in a:
        n = a["N"]
        return int(n) if n.lstrip("-").isdigit() else float(n)
    if "BOOL" in a:
        return a["BOOL"]
    if "NULL" in a:
        return None
    if "M" in a:
        return {k: _from_attr(x) for k, x in a["M"].items()}
    if "L" in a:
        return [_from_attr(x) for x in a["L"]]
    return None


def _item_to_dict(item: dict) -> dict:
    return {k: _from_attr(v) for k, v in item.items()}


def _dict_to_item(d: dict) -> dict:
    return {k: _to_attr(v) for k, v in d.items()}


# --- Generic single-partition operations (owner-scoped) ----------------------
def put(owner_id: str, sk: str, attrs: dict) -> dict:
    item = {"pk": owner_pk(owner_id), "sk": sk, **attrs}
    _dynamodb.put_item(TableName=_table(), Item=_dict_to_item(item))
    return item


def get(owner_id: str, sk: str) -> Optional[dict]:
    resp = _dynamodb.get_item(
        TableName=_table(), Key={"pk": _to_attr(owner_pk(owner_id)), "sk": _to_attr(sk)}
    )
    item = resp.get("Item")
    return _item_to_dict(item) if item else None


def delete(owner_id: str, sk: str) -> None:
    _dynamodb.delete_item(
        TableName=_table(), Key={"pk": _to_attr(owner_pk(owner_id)), "sk": _to_attr(sk)}
    )


def query_prefix(owner_id: str, sk_prefix: str) -> list[dict]:
    """Query one owner's partition for items whose SK begins with a prefix."""
    resp = _dynamodb.query(
        TableName=_table(),
        KeyConditionExpression="pk = :pk AND begins_with(sk, :p)",
        ExpressionAttributeValues={":pk": _to_attr(owner_pk(owner_id)), ":p": _to_attr(sk_prefix)},
    )
    return [_item_to_dict(i) for i in resp.get("Items", [])]


# --- SK builders -------------------------------------------------------------
def sk_profile() -> str:
    return "PROFILE"


def sk_course(course_id: str) -> str:
    return f"COURSE#{course_id}"


def sk_lesson(course_id: str, lesson_id: str) -> str:
    return f"COURSE#{course_id}#LESSON#{lesson_id}"


def sk_lesson_prefix(course_id: str) -> str:
    return f"COURSE#{course_id}#LESSON#"


def sk_source(lesson_id: str, source_id: str) -> str:
    return f"SOURCE#{lesson_id}#{source_id}"


def sk_source_prefix(lesson_id: str) -> str:
    return f"SOURCE#{lesson_id}#"


# Transcript identity is SOURCE-specific so multiple recordings on one lesson
# never overwrite each other: TRANSCRIPT#<lessonId>#<sourceId>.
def sk_transcript(lesson_id: str, source_id: str) -> str:
    return f"TRANSCRIPT#{lesson_id}#{source_id}"


def sk_transcript_prefix(lesson_id: str) -> str:
    return f"TRANSCRIPT#{lesson_id}#"


def sk_job(job_name: str) -> str:
    return f"TRANSCRIBE_JOB#{job_name}"


def sk_usage(day: str) -> str:
    return f"USAGE#{day}"


# --- Ownership helpers -------------------------------------------------------
def require_course(owner_id: str, course_id: str) -> dict:
    """Return the owner's course or 404. Proves the course belongs to the owner
    before any nested (lesson/source) operation — courseId alone is never trust
    -ed as ownership."""
    course = get(owner_id, sk_course(course_id))
    if not course:
        raise ClientError(404, "not_found", "Ders bulunamadı.")
    return course


def require_lesson(owner_id: str, course_id: str, lesson_id: str) -> dict:
    lesson = get(owner_id, sk_lesson(course_id, lesson_id))
    if not lesson:
        raise ClientError(404, "not_found", "Ders kaydı bulunamadı.")
    return lesson
