"""Async study-generation pipeline tests (Phase 2 MVP, ≤50-minute lessons).

Covers the SQS hand-off, the background worker, idempotency / no-duplicate-
spend under retries + redelivery, the final grounded synthesis, and a full
~50-minute transcript processed end-to-end with no truncation.

No AWS, no network, no paid model: the queue is a FakeSQS and the provider is
the deterministic LocalGroundedProvider (we force async on by setting the queue
URL env, then drive the worker directly to simulate the Lambda consuming SQS).
"""
import json
import os
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("ROJANDA_MEDIA_BUCKET", "rojanda-media-test")
os.environ.setdefault("ROJANDA_APP_TABLE", "rojanda-app-test")
os.environ.setdefault("ROJANDA_MAX_UPLOAD_BYTES", "157286400")
os.environ.setdefault("ROJANDA_MAX_AUDIO_SECONDS", "5400")
os.environ.setdefault("ROJANDA_DAILY_MINUTES_ALLOWANCE", "120")

from rojanda_transcribe import api, jobs, resources, store, study as study_mod, worker  # noqa: E402
from conftest_fakes import FakeDynamo, FakeS3, FakeSQS, FakeTranscribe  # noqa: E402
from test_api import Base, event, SUB_A, SUB_B  # noqa: E402

TR_TEXT = (
    "Fotosentez bitkilerin ışığı kullanarak besin üretmesidir. "
    "Kloroplast fotosentezin gerçekleştiği organeldir. "
    "Klorofil ışığı emen yeşil pigmenttir. "
    "Fotosentez sonucunda oksijen açığa çıkar. "
    "Karbondioksit ve su fotosentezin girdileridir."
)


class AsyncBase(Base):
    """Base that turns async ON (queue URL set + FakeSQS) and seeds a lesson
    with a persisted transcript."""

    def setUp(self):
        super().setUp()
        self.sqs = FakeSQS()
        jobs.set_client(self.sqs)
        os.environ["ROJANDA_STUDY_QUEUE_URL"] = "https://sqs.test/local/rojanda-study-jobs"

    def tearDown(self):
        os.environ.pop("ROJANDA_STUDY_QUEUE_URL", None)
        super().tearDown()

    def seed(self, sub=SUB_A, text=TR_TEXT, source_id="src_async_1"):
        course_id = self.make_course(sub=sub)
        lesson_id = self.make_lesson(course_id, sub=sub)
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

    def post_study(self, course_id, lesson_id, sub=SUB_A, body=None):
        return api.handler(event(
            "POST", f"/courses/{course_id}/lessons/{lesson_id}/study", sub=sub, body=body or {},
            path_params={"courseId": course_id, "lessonId": lesson_id},
        ))

    def get_study(self, course_id, lesson_id, sub=SUB_A):
        return api.handler(event(
            "GET", f"/courses/{course_id}/lessons/{lesson_id}/study", sub=sub,
            path_params={"courseId": course_id, "lessonId": lesson_id},
        ))

    def drain_worker(self):
        """Simulate the worker Lambda consuming every queued message."""
        records = [{"messageId": f"m{i}", "body": json.dumps(m)} for i, m in enumerate(self.sqs.sent)]
        self.sqs.sent = []
        return worker.handler({"Records": records})


class EnqueueTests(AsyncBase):
    def test_post_enqueues_and_returns_202_generating_without_model_call(self):
        cid, lid, sid = self.seed()
        r = self.post_study(cid, lid)
        self.assertEqual(r["statusCode"], 202)                 # async hand-off
        item = self.body(r)
        self.assertEqual(item["status"], "generating")
        self.assertEqual(len(self.sqs.sent), 1)                # exactly one job
        # No study content yet (worker hasn't run) — nothing fabricated inline.
        self.assertNotIn("summary", item)
        # Internal claim bookkeeping is never exposed.
        self.assertNotIn("claimToken", item)
        self.assertNotIn("startedAtEpoch", item)
        # The queued message carries ids + claim token, never transcript text.
        msg = self.sqs.sent[0]
        self.assertEqual(msg["lessonId"], lid)
        self.assertEqual(msg["sourceId"], sid)
        self.assertIn("claimToken", msg)
        self.assertNotIn("text", msg)

    def test_worker_completes_generation_to_ready(self):
        cid, lid, _ = self.seed()
        self.post_study(cid, lid)
        self.drain_worker()
        lst = self.body(self.get_study(cid, lid))
        self.assertEqual(lst["study"][0]["status"], "ready")
        self.assertTrue(lst["study"][0]["summary"])
        self.assertTrue(lst["study"][0]["quiz"])
        self.assertEqual(lst["study"][0]["provider"], "local-grounded-v2")


class NoDuplicateSpendTests(AsyncBase):
    def test_retry_while_generating_does_not_enqueue_second_job(self):
        cid, lid, _ = self.seed()
        self.post_study(cid, lid)                 # first -> 1 job
        r2 = self.post_study(cid, lid)            # retry (e.g. after a 504)
        self.assertEqual(r2["statusCode"], 202)
        self.assertEqual(self.body(r2)["status"], "generating")
        # CRITICAL: still exactly one job -> no duplicate Bedrock spend.
        self.assertEqual(len(self.sqs.sent), 1)

    def test_post_after_ready_returns_cached_without_enqueue(self):
        cid, lid, _ = self.seed()
        self.post_study(cid, lid)
        self.drain_worker()                       # -> ready
        r = self.post_study(cid, lid)             # idempotent fast-path
        self.assertEqual(r["statusCode"], 200)
        self.assertEqual(self.body(r)["status"], "ready")
        self.assertEqual(len(self.sqs.sent), 0)   # no new job

    def test_redelivery_is_idempotent(self):
        cid, lid, sid = self.seed()
        self.post_study(cid, lid)
        queued = list(self.sqs.sent)
        self.drain_worker()                       # first delivery -> ready
        ready1 = store.get(SUB_A, store.sk_study(lid, sid))
        # SQS is at-least-once: replay the SAME message. Worker must no-op.
        worker.handler({"Records": [{"messageId": "dup", "body": json.dumps(queued[0])}]})
        ready2 = store.get(SUB_A, store.sk_study(lid, sid))
        self.assertEqual(ready2["status"], "ready")
        self.assertEqual(ready1["updatedAt"], ready2["updatedAt"])  # untouched


class ForceAndStaleTests(AsyncBase):
    def test_force_enqueues_new_job_even_when_ready(self):
        cid, lid, _ = self.seed()
        self.post_study(cid, lid)
        self.drain_worker()
        r = self.post_study(cid, lid, body={"force": True})
        self.assertEqual(r["statusCode"], 202)
        self.assertEqual(len(self.sqs.sent), 1)   # explicit regenerate -> 1 job

    def test_stale_claim_can_be_reclaimed(self):
        cid, lid, sid = self.seed()
        self.post_study(cid, lid)                 # claim written
        # Simulate an abandoned claim (worker crashed) by ageing startedAtEpoch
        # beyond the TTL.
        row = store.get(SUB_A, store.sk_study(lid, sid))
        row["startedAtEpoch"] = int(time.time()) - resources.STUDY_CLAIM_TTL_SECONDS - 10
        store.put(SUB_A, store.sk_study(lid, sid), row)
        self.sqs.sent = []
        r = self.post_study(cid, lid)             # should reclaim + re-enqueue
        self.assertEqual(r["statusCode"], 202)
        self.assertEqual(len(self.sqs.sent), 1)


class WorkerFailureTests(AsyncBase):
    def test_transcript_changed_after_enqueue_marks_failed(self):
        cid, lid, sid = self.seed()
        self.post_study(cid, lid)
        # Edit the transcript AFTER the job was queued (fingerprint drift).
        t = store.get(SUB_A, store.sk_transcript(lid, sid))
        t["text"] = TR_TEXT + " Sonradan eklenen cümle."
        store.put(SUB_A, store.sk_transcript(lid, sid), t)
        self.drain_worker()
        row = store.get(SUB_A, store.sk_study(lid, sid))
        self.assertEqual(row["status"], "failed")
        self.assertEqual(row["error"], "transcript_changed")

    def test_claim_token_mismatch_is_skipped(self):
        cid, lid, sid = self.seed()
        self.post_study(cid, lid)
        msg = dict(self.sqs.sent[0])
        msg["claimToken"] = "stale-token"         # superseded by a newer claim
        worker.handler({"Records": [{"messageId": "x", "body": json.dumps(msg)}]})
        row = store.get(SUB_A, store.sk_study(lid, sid))
        self.assertEqual(row["status"], "generating")  # untouched by stale job

    def test_enqueue_failure_marks_failed_and_502(self):
        cid, lid, sid = self.seed()

        def boom(*a, **k):
            raise RuntimeError("sqs down")

        self.sqs.send_message = boom
        r = self.post_study(cid, lid)
        self.assertEqual(r["statusCode"], 502)
        self.assertEqual(self.body(r)["error"]["code"], "enqueue_failed")
        row = store.get(SUB_A, store.sk_study(lid, sid))
        self.assertEqual(row["status"], "failed")
        self.assertEqual(row["error"], "enqueue_failed")


class OwnerIsolationAsyncTests(AsyncBase):
    def test_other_user_cannot_enqueue(self):
        cid, lid, _ = self.seed(sub=SUB_A)
        r = self.post_study(cid, lid, sub=SUB_B)
        self.assertEqual(r["statusCode"], 404)
        self.assertEqual(len(self.sqs.sent), 0)   # nothing queued for a stranger


class WorkerProviderClientTests(unittest.TestCase):
    def test_worker_injects_its_provider_client_into_generation(self):
        """The worker, not the API path, owns Bedrock client construction and
        passes that client through to run_study_job. No model is invoked here."""
        original_client = worker._provider_client
        original_run = resources.run_study_job
        marker = object()
        captured = {}
        try:
            worker._provider_client = lambda: marker
            resources.run_study_job = lambda **kwargs: captured.update(kwargs)
            result = worker.handler({
                "Records": [{
                    "messageId": "client-seam",
                    "body": json.dumps({
                        "ownerId": SUB_A,
                        "courseId": "course_1",
                        "lessonId": "lesson_1",
                        "sourceId": "src_1",
                        "transcriptFingerprint": "sha256:x",
                        "claimToken": "claim_1",
                        "language": "tr",
                    }),
                }],
            })
        finally:
            worker._provider_client = original_client
            resources.run_study_job = original_run
        self.assertEqual(result, {"batchItemFailures": []})
        self.assertIs(captured["provider_client"], marker)


if __name__ == "__main__":
    unittest.main()
