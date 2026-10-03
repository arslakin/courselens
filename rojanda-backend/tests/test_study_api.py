"""API-level tests for Phase 2 grounded study materials.

Exercises the full GET/POST /courses/{courseId}/lessons/{lessonId}/study path
through api.handler with the single-table store + S3/Transcribe faked (no AWS,
no network, no paid model — the default local grounded provider is used).

Covers:
  * generate -> ready -> list round trip (grounded content persisted)
  * idempotency (repeat POST returns the SAME item, no new generation)
  * force regeneration (force:true re-runs even when fingerprint matches)
  * staleness (editing the transcript marks stored study stale on list)
  * no transcript -> 409 no_transcript (never fabricates)
  * owner isolation (SUB_B cannot GET/POST SUB_A's study -> 404)
  * failed status persisted + retryable when the provider errors
  * _study_public strips internal pk/sk
  * existing API tests remain unaffected (shared Base/event harness)

Run:
    PYTHONPATH=src:tests python -m unittest test_study_api -v
"""
import json
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("ROJANDA_MEDIA_BUCKET", "rojanda-media-test")
os.environ.setdefault("ROJANDA_APP_TABLE", "rojanda-app-test")
os.environ.setdefault("ROJANDA_MAX_UPLOAD_BYTES", "157286400")
os.environ.setdefault("ROJANDA_MAX_AUDIO_SECONDS", "5400")
os.environ.setdefault("ROJANDA_DAILY_MINUTES_ALLOWANCE", "120")

from rojanda_transcribe import api, resources, store, study as study_mod  # noqa: E402
from conftest_fakes import FakeDynamo, FakeS3, FakeTranscribe  # noqa: E402
from test_api import Base, event, SUB_A, SUB_B  # noqa: E402

TR_TEXT = (
    "Fotosentez bitkilerin ışığı kullanarak besin üretmesidir. "
    "Kloroplast fotosentezin gerçekleştiği organeldir. "
    "Klorofil ışığı emen yeşil pigmenttir. "
    "Fotosentez sonucunda oksijen açığa çıkar. "
    "Karbondioksit ve su fotosentezin girdileridir."
)


class StudyBase(Base):
    """Base that also seeds a course + lesson + a persisted transcript source."""

    def seed_lesson_with_transcript(self, sub=SUB_A, text=TR_TEXT, source_id="src_api_1"):
        course_id = self.make_course(sub=sub)
        lesson_id = self.make_lesson(course_id, sub=sub)
        # Persist a transcript item exactly as the Phase 1 pipeline would.
        store.put(
            sub,
            store.sk_transcript(lesson_id, source_id),
            {
                "lessonId": lesson_id,
                "courseId": course_id,
                "sourceId": source_id,
                "jobName": "job_x",
                "text": text,
                "language": "tr-TR",
                "status": "ready",
                "createdAt": store.now_iso(),
            },
        )
        return course_id, lesson_id, source_id

    def study_path(self, course_id, lesson_id):
        return f"/courses/{course_id}/lessons/{lesson_id}/study"

    def post_study(self, course_id, lesson_id, sub=SUB_A, body=None):
        return api.handler(event(
            "POST", self.study_path(course_id, lesson_id), sub=sub, body=body or {},
            path_params={"courseId": course_id, "lessonId": lesson_id},
        ))

    def get_study(self, course_id, lesson_id, sub=SUB_A):
        return api.handler(event(
            "GET", self.study_path(course_id, lesson_id), sub=sub,
            path_params={"courseId": course_id, "lessonId": lesson_id},
        ))


class GenerateAndListTests(StudyBase):
    def test_generate_then_ready_then_list(self):
        cid, lid, sid = self.seed_lesson_with_transcript()

        r = self.post_study(cid, lid)
        self.assertEqual(r["statusCode"], 200)
        item = self.body(r)
        self.assertEqual(item["status"], "ready")
        self.assertEqual(item["sourceId"], sid)
        self.assertTrue(item["summary"])
        self.assertTrue(item["concepts"])
        self.assertTrue(item["flashcards"])
        self.assertTrue(item["quiz"])
        self.assertEqual(item["provenance"], "Kaynaklarından")
        self.assertEqual(item["provider"], "local-grounded-v2")
        self.assertTrue(item["transcriptFingerprint"].startswith("sha256:"))
        self.assertEqual(item["schemaVersion"], study_mod.STUDY_SCHEMA_VERSION)
        # No internal keys leaked.
        self.assertNotIn("pk", item)
        self.assertNotIn("sk", item)

        # Every quiz answer is grounded in the transcript.
        norm = study_mod._norm(TR_TEXT)
        for q in item["quiz"]:
            self.assertTrue(study_mod._grounded_in(q["options"][q["correctIndex"]], norm))

        # List returns the persisted study with a (false) stale flag.
        lst = self.body(self.get_study(cid, lid))
        self.assertEqual(len(lst["study"]), 1)
        self.assertEqual(lst["study"][0]["status"], "ready")
        self.assertFalse(lst["study"][0]["stale"])

    def test_list_empty_before_generation(self):
        cid, lid, _ = self.seed_lesson_with_transcript()
        lst = self.body(self.get_study(cid, lid))
        self.assertEqual(lst["study"], [])


class IdempotencyTests(StudyBase):
    def test_repeat_post_returns_same_item_without_regenerating(self):
        cid, lid, _ = self.seed_lesson_with_transcript()
        first = self.body(self.post_study(cid, lid))
        # Second POST must return the SAME item (same createdAt) — no new run.
        second = self.body(self.post_study(cid, lid))
        self.assertEqual(first["createdAt"], second["createdAt"])
        self.assertEqual(first["status"], "ready")
        self.assertEqual(second["status"], "ready")
        # Still exactly one STUDY# row persisted.
        rows = store.query_prefix(SUB_A, store.sk_study_prefix(lid))
        self.assertEqual(len(rows), 1)

    def test_force_regenerates(self):
        cid, lid, _ = self.seed_lesson_with_transcript()
        first = self.body(self.post_study(cid, lid))
        forced = self.body(self.post_study(cid, lid, body={"force": True}))
        self.assertEqual(forced["status"], "ready")
        # createdAt is preserved across regeneration; updatedAt advances.
        self.assertEqual(first["createdAt"], forced["createdAt"])
        self.assertGreaterEqual(forced["updatedAt"], first["updatedAt"])
        # Still a single row (same SK), not a duplicate.
        rows = store.query_prefix(SUB_A, store.sk_study_prefix(lid))
        self.assertEqual(len(rows), 1)


class StalenessTests(StudyBase):
    def test_edited_transcript_marks_study_stale(self):
        cid, lid, sid = self.seed_lesson_with_transcript()
        self.post_study(cid, lid)
        # Edit the transcript (new fingerprint) without regenerating study.
        t = store.get(SUB_A, store.sk_transcript(lid, sid))
        t["text"] = TR_TEXT + " Yeni bir cümle eklendi."
        store.put(SUB_A, store.sk_transcript(lid, sid), t)

        lst = self.body(self.get_study(cid, lid))
        self.assertTrue(lst["study"][0]["stale"])

        # Regenerating against the new transcript clears staleness.
        self.post_study(cid, lid, body={"force": True})
        lst2 = self.body(self.get_study(cid, lid))
        self.assertFalse(lst2["study"][0]["stale"])


class NoTranscriptTests(StudyBase):
    def test_generate_without_transcript_is_409(self):
        cid = self.make_course()
        lid = self.make_lesson(cid)  # no transcript persisted
        r = self.post_study(cid, lid)
        self.assertEqual(r["statusCode"], 409)
        self.assertEqual(self.body(r)["error"]["code"], "no_transcript")
        # Nothing persisted.
        self.assertEqual(store.query_prefix(SUB_A, store.sk_study_prefix(lid)), [])


class OwnerIsolationTests(StudyBase):
    def test_other_user_cannot_generate_or_read(self):
        cid, lid, _ = self.seed_lesson_with_transcript(sub=SUB_A)
        self.post_study(cid, lid, sub=SUB_A)  # A generates

        # B cannot POST (course not in B's partition -> 404).
        rb_post = self.post_study(cid, lid, sub=SUB_B)
        self.assertEqual(rb_post["statusCode"], 404)
        # B cannot GET either.
        rb_get = self.get_study(cid, lid, sub=SUB_B)
        self.assertEqual(rb_get["statusCode"], 404)
        # A still sees exactly its own study.
        lst = self.body(self.get_study(cid, lid, sub=SUB_A))
        self.assertEqual(len(lst["study"]), 1)


class _FailingProvider:
    name = "failing"

    def generate_chunk(self, chunk_text, language):
        raise study_mod.ProviderError("boom")


class FailureStatusTests(StudyBase):
    def setUp(self):
        super().setUp()
        self._orig = study_mod.make_provider
        study_mod.make_provider = lambda *a, **k: _FailingProvider()

    def tearDown(self):
        study_mod.make_provider = self._orig
        super().tearDown()

    def test_provider_failure_persists_failed_and_is_retryable(self):
        cid, lid, _ = self.seed_lesson_with_transcript()
        r = self.post_study(cid, lid)
        # Surfaced as the provider's 502 error to the client.
        self.assertEqual(r["statusCode"], 502)

        # A failed row is persisted (not ready, no fabricated content).
        rows = store.query_prefix(SUB_A, store.sk_study_prefix(lid))
        self.assertEqual(len(rows), 1)
        failed = resources._study_public(rows[0])
        self.assertEqual(failed["status"], "failed")
        self.assertNotIn("summary", failed)

        # Listing shows the failed status (retryable from the UI).
        lst = self.body(self.get_study(cid, lid))
        self.assertEqual(lst["study"][0]["status"], "failed")

        # Retry with a working provider recovers to ready (same row).
        study_mod.make_provider = self._orig
        r2 = self.post_study(cid, lid)
        self.assertEqual(r2["statusCode"], 200)
        self.assertEqual(self.body(r2)["status"], "ready")
        self.assertEqual(len(store.query_prefix(SUB_A, store.sk_study_prefix(lid))), 1)


class DeleteCascadeTests(StudyBase):
    def test_delete_lesson_removes_study(self):
        cid, lid, _ = self.seed_lesson_with_transcript()
        self.post_study(cid, lid)
        self.assertEqual(len(store.query_prefix(SUB_A, store.sk_study_prefix(lid))), 1)
        r = api.handler(event(
            "DELETE", f"/courses/{cid}/lessons/{lid}", sub=SUB_A,
            path_params={"courseId": cid, "lessonId": lid},
        ))
        self.assertEqual(r["statusCode"], 200)
        self.assertEqual(store.query_prefix(SUB_A, store.sk_study_prefix(lid)), [])


if __name__ == "__main__":
    unittest.main()
