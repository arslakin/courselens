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
    # Also delete the lesson's sources + transcripts (all under this owner).
    for s in store.query_prefix(owner_id, store.sk_source_prefix(lesson_id)):
        store.delete(owner_id, s["sk"])
    for t in store.query_prefix(owner_id, store.sk_transcript_prefix(lesson_id)):
        store.delete(owner_id, t["sk"])
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


def _public(item: dict) -> dict:
    return {k: v for k, v in item.items() if k not in ("pk", "sk")}
