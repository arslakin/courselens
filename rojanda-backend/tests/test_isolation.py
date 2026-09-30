"""Cross-user isolation tests (Phase 1C).

Two authenticated Cognito subs (A and B). Prove User A cannot read/modify User
B's profile, courses, lessons, uploads, transcription jobs, transcripts, or
usage — even with knowledge of B's ids. These are BACKEND tests (not UI).
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

from rojanda_transcribe import api, core, store  # noqa: E402
from conftest_fakes import FakeDynamo, FakeS3, FakeTranscribe  # noqa: E402

A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"


def ev(method, path, sub, body=None, query=None, path_params=None):
    return {
        "requestContext": {"http": {"method": method, "path": path},
                           "authorizer": {"jwt": {"claims": {"sub": sub, "email": "s@x.co"}}}},
        "rawPath": path,
        "pathParameters": path_params,
        "body": json.dumps(body) if body is not None else None,
        "queryStringParameters": query,
    }


class Isolation(unittest.TestCase):
    def setUp(self):
        self.dynamo = FakeDynamo()
        store.set_client(self.dynamo)
        api._s3 = FakeS3()
        self.transcribe = FakeTranscribe()
        api._transcribe = self.transcribe

    def b(self, r):
        return json.loads(r["body"])

    def _course(self, sub, title="C"):
        return self.b(api.handler(ev("POST", "/courses", sub, body={"title": title})))["courseId"]

    def _lesson(self, sub, cid, title="L"):
        return self.b(api.handler(ev("POST", f"/courses/{cid}/lessons", sub, body={"title": title},
                                     path_params={"courseId": cid})))["lessonId"]

    # --- profile ---
    def test_a_cannot_read_b_profile(self):
        api.handler(ev("PUT", "/profile", B, body={"displayName": "Berk"}))
        a_profile = self.b(api.handler(ev("GET", "/profile", A)))
        # A's profile is A's own default, never Berk.
        self.assertNotEqual(a_profile.get("displayName"), "Berk")

    # --- courses ---
    def test_a_cannot_list_or_get_b_course(self):
        b_course = self._course(B, "Berk Matematik")
        # A lists -> empty (does not see B's course).
        self.assertEqual(self.b(api.handler(ev("GET", "/courses", A)))["courses"], [])
        # A gets B's course by id -> 404.
        r = api.handler(ev("GET", f"/courses/{b_course}", A, path_params={"courseId": b_course}))
        self.assertEqual(r["statusCode"], 404)

    def test_a_cannot_update_or_delete_b_course(self):
        b_course = self._course(B)
        r1 = api.handler(ev("PUT", f"/courses/{b_course}", A, body={"title": "hacked"}, path_params={"courseId": b_course}))
        self.assertEqual(r1["statusCode"], 404)
        r2 = api.handler(ev("DELETE", f"/courses/{b_course}", A, path_params={"courseId": b_course}))
        self.assertEqual(r2["statusCode"], 404)
        # B's course still intact + unchanged.
        got = self.b(api.handler(ev("GET", f"/courses/{b_course}", B, path_params={"courseId": b_course})))
        self.assertNotEqual(got.get("title"), "hacked")

    # --- lessons ---
    def test_a_cannot_access_b_lesson(self):
        b_course = self._course(B)
        b_lesson = self._lesson(B, b_course)
        # A cannot list B's lessons (course not owned -> 404).
        r = api.handler(ev("GET", f"/courses/{b_course}/lessons", A, path_params={"courseId": b_course}))
        self.assertEqual(r["statusCode"], 404)
        # A cannot get/update/delete B's lesson.
        pp = {"courseId": b_course, "lessonId": b_lesson}
        self.assertEqual(api.handler(ev("GET", f"/courses/{b_course}/lessons/{b_lesson}", A, path_params=pp))["statusCode"], 404)
        self.assertEqual(api.handler(ev("PUT", f"/courses/{b_course}/lessons/{b_lesson}", A, body={"title": "x"}, path_params=pp))["statusCode"], 404)
        self.assertEqual(api.handler(ev("DELETE", f"/courses/{b_course}/lessons/{b_lesson}", A, path_params=pp))["statusCode"], 404)

    # --- transcription ---
    def test_a_cannot_get_upload_url_for_b_hierarchy(self):
        b_course = self._course(B)
        b_lesson = self._lesson(B, b_course)
        r = api.handler(ev("POST", "/transcribe/upload-url", A, body={"courseId": b_course, "lessonId": b_lesson}))
        self.assertEqual(r["statusCode"], 404)  # B's course not in A's partition

    def test_a_cannot_start_transcription_for_b_key(self):
        b_course = self._course(B)
        b_lesson = self._lesson(B, b_course)
        up = self.b(api.handler(ev("POST", "/transcribe/upload-url", B, body={"courseId": b_course, "lessonId": b_lesson})))
        # A tries to start using B's audio key -> validate_audio_key rejects (embedded sub != A).
        r = api.handler(ev("POST", "/transcribe/start", A,
                          body={"audioKey": up["audioKey"], "courseId": b_course, "lessonId": b_lesson, "sourceId": up["sourceId"]}))
        self.assertIn(r["statusCode"], (403, 404))
        self.assertEqual(self.transcribe.started, [])

    def test_a_cannot_poll_b_job(self):
        b_course = self._course(B)
        b_lesson = self._lesson(B, b_course)
        up = self.b(api.handler(ev("POST", "/transcribe/upload-url", B, body={"courseId": b_course, "lessonId": b_lesson})))
        started = self.b(api.handler(ev("POST", "/transcribe/start", B,
                         body={"audioKey": up["audioKey"], "courseId": b_course, "lessonId": b_lesson, "sourceId": up["sourceId"]})))
        # A polls B's job -> 403 (job name is namespaced by B's sub).
        r = api.handler(ev("GET", "/transcribe/status", A, query={"jobId": started["jobId"]}))
        self.assertEqual(r["statusCode"], 403)

    def test_a_cannot_retrieve_b_transcript(self):
        b_course = self._course(B)
        b_lesson = self._lesson(B, b_course)
        # Persist a transcript for B directly (source-specific key).
        store.put(B, store.sk_transcript(b_lesson, "src_1"), {"lessonId": b_lesson, "courseId": b_course, "text": "gizli"})
        # A can only reach its own partition; A has no transcript for that lesson.
        self.assertEqual(store.query_prefix(A, store.sk_transcript_prefix(b_lesson)), [])
        # And listing transcripts for B's lesson as A -> 404 (course not owned).
        r_list = api.handler(ev("GET", f"/courses/{b_course}/lessons/{b_lesson}/transcripts", A,
                                path_params={"courseId": b_course, "lessonId": b_lesson}))
        self.assertEqual(r_list["statusCode"], 404)
        # And A cannot get B's lesson (which would surface transcript linkage).
        r = api.handler(ev("GET", f"/courses/{b_course}/lessons/{b_lesson}", A, path_params={"courseId": b_course, "lessonId": b_lesson}))
        self.assertEqual(r["statusCode"], 404)

    def test_a_usage_does_not_affect_b(self):
        # A consumes ~90 min; B's daily usage is independent.
        api._s3 = FakeS3(size=90 * 960_000)
        a_course = self._course(A)
        a_lesson = self._lesson(A, a_course)
        up = self.b(api.handler(ev("POST", "/transcribe/upload-url", A, body={"courseId": a_course, "lessonId": a_lesson})))
        api.handler(ev("POST", "/transcribe/start", A,
                    body={"audioKey": up["audioKey"], "courseId": a_course, "lessonId": a_lesson, "sourceId": up["sourceId"]}))
        a_usage = store.get(A, store.sk_usage(core.today_utc()))
        self.assertGreater(int(a_usage["minutes"]), 0)
        # B has no usage row at all.
        self.assertIsNone(store.get(B, store.sk_usage(core.today_utc())))


if __name__ == "__main__":
    unittest.main()
