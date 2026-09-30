"""API behavior + usage-metering tests for the Phase 1C authenticated API.

Single-table store + S3/Transcribe are faked (no AWS). Identity comes from a
verified JWT `sub` in requestContext. Run:
    PYTHONPATH=src python -m unittest discover -s tests -v
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

SUB_A = "11111111-1111-4111-8111-111111111111"
SUB_B = "22222222-2222-4222-8222-222222222222"


def event(method, path, sub=SUB_A, body=None, query=None, path_params=None):
    rc = {"http": {"method": method, "path": path}}
    if sub is not None:
        rc["authorizer"] = {"jwt": {"claims": {"sub": sub, "email": "s@example.com"}}}
    return {
        "requestContext": rc,
        "rawPath": path,
        "pathParameters": path_params,
        "body": json.dumps(body) if body is not None else None,
        "queryStringParameters": query,
    }


def write_transcript(text, items):
    import tempfile

    payload = {"results": {"transcripts": [{"transcript": text}], "items": items}}
    f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump(payload, f)
    f.close()
    return "file://" + f.name


def timed_items(end_times, confidence="0.9"):
    return [
        {"type": "pronunciation", "end_time": str(t), "alternatives": [{"confidence": confidence}]}
        for t in end_times
    ]


class Base(unittest.TestCase):
    def setUp(self):
        self.dynamo = FakeDynamo()
        self.s3 = FakeS3()
        self.transcribe = FakeTranscribe()
        store.set_client(self.dynamo)
        api._s3 = self.s3
        api._transcribe = self.transcribe

    def body(self, resp):
        return json.loads(resp["body"])

    # helpers to create a course + lesson for the active sub
    def make_course(self, sub=SUB_A, title="Matematik"):
        r = api.handler(event("POST", "/courses", sub=sub, body={"title": title}))
        return self.body(r)["courseId"]

    def make_lesson(self, course_id, sub=SUB_A, title="Türev"):
        r = api.handler(
            event("POST", f"/courses/{course_id}/lessons", sub=sub, body={"title": title},
                  path_params={"courseId": course_id})
        )
        return self.body(r)["lessonId"]


class AuthTests(Base):
    def test_missing_sub_unauthorized(self):
        self.assertEqual(api.handler(event("GET", "/profile", sub=None))["statusCode"], 401)


class ProfileTests(Base):
    def test_get_creates_default_then_update_keeps_identity_out(self):
        r = api.handler(event("GET", "/profile"))
        self.assertEqual(r["statusCode"], 200)
        p = self.body(r)
        self.assertEqual(p["locale"], "tr")
        # Attempt to inject ownership fields -> ignored.
        r2 = api.handler(event("PUT", "/profile", body={"displayName": "Ada", "ownerId": SUB_B, "sub": SUB_B, "pk": "x"}))
        p2 = self.body(r2)
        self.assertEqual(p2["displayName"], "Ada")
        self.assertNotIn("ownerId", p2)
        self.assertNotIn("pk", p2)


class CourseLessonTests(Base):
    def test_create_list_get_update_delete_course(self):
        cid = self.make_course(title="Fizik")
        self.assertTrue(cid.startswith("course_"))
        lst = self.body(api.handler(event("GET", "/courses")))
        self.assertEqual(len(lst["courses"]), 1)
        got = self.body(api.handler(event("GET", f"/courses/{cid}", path_params={"courseId": cid})))
        self.assertEqual(got["title"], "Fizik")
        upd = self.body(api.handler(event("PUT", f"/courses/{cid}", body={"title": "Fizik 2"}, path_params={"courseId": cid})))
        self.assertEqual(upd["title"], "Fizik 2")
        dele = api.handler(event("DELETE", f"/courses/{cid}", path_params={"courseId": cid}))
        self.assertEqual(dele["statusCode"], 200)
        self.assertEqual(len(self.body(api.handler(event("GET", "/courses")))["courses"]), 0)

    def test_lesson_requires_owned_course(self):
        cid = self.make_course()
        lid = self.make_lesson(cid)
        self.assertTrue(lid.startswith("lesson_"))
        lessons = self.body(api.handler(event("GET", f"/courses/{cid}/lessons", path_params={"courseId": cid})))
        self.assertEqual(len(lessons["lessons"]), 1)
        # Lesson under a non-existent course -> 404.
        r = api.handler(event("POST", "/courses/course_nope/lessons", body={"title": "X"}, path_params={"courseId": "course_nope"}))
        self.assertEqual(r["statusCode"], 404)


class TranscriptionFlowTests(Base):
    def _prep(self, sub=SUB_A):
        cid = self.make_course(sub=sub)
        lid = self.make_lesson(cid, sub=sub)
        return cid, lid

    def test_upload_url_scoped_and_size_limited(self):
        cid, lid = self._prep()
        r = api.handler(event("POST", "/transcribe/upload-url", body={"courseId": cid, "lessonId": lid}))
        b = self.body(r)
        self.assertTrue(b["audioKey"].startswith(f"owners/{SUB_A}/courses/{cid}/lessons/{lid}/audio/"))
        clr = [c for c in self.s3.presigned_calls[0]["Conditions"] if isinstance(c, list) and c[0] == "content-length-range"]
        self.assertEqual(clr, [["content-length-range", 1, 157286400]])

    def test_start_tr_tr_and_persists_source(self):
        cid, lid = self._prep()
        up = self.body(api.handler(event("POST", "/transcribe/upload-url", body={"courseId": cid, "lessonId": lid})))
        r = api.handler(event("POST", "/transcribe/start",
                              body={"audioKey": up["audioKey"], "courseId": cid, "lessonId": lid, "sourceId": up["sourceId"]}))
        b = self.body(r)
        self.assertEqual(b["status"], "IN_PROGRESS")
        started = self.transcribe.started[0]
        self.assertEqual(started["LanguageCode"], "tr-TR")
        self.assertEqual(started["MediaFormat"], "mp4")
        self.assertTrue(started["TranscriptionJobName"].startswith("rojanda-11111111-"))
        # source persisted under the owner
        sources = store.query_prefix(SUB_A, "SOURCE#")
        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0]["audioKey"], up["audioKey"])

    def test_completed_persists_transcript_linked_to_course_lesson(self):
        cid, lid = self._prep()
        up = self.body(api.handler(event("POST", "/transcribe/upload-url", body={"courseId": cid, "lessonId": lid})))
        started = self.body(api.handler(event("POST", "/transcribe/start",
                            body={"audioKey": up["audioKey"], "courseId": cid, "lessonId": lid, "sourceId": up["sourceId"]})))
        self.transcribe.status = "COMPLETED"
        self.transcribe.transcript_uri = write_transcript("Türev tanımı", timed_items([10.0, 65.4]))
        r = api.handler(event("GET", "/transcribe/status", query={"jobId": started["jobId"]}))
        b = self.body(r)
        self.assertEqual(b["status"], "COMPLETED")
        self.assertEqual(b["transcript"], "Türev tanımı")
        self.assertAlmostEqual(b["durationSeconds"], 65.4, places=3)
        # transcript persisted + linked (source-specific key)
        trs = store.query_prefix(SUB_A, store.sk_transcript_prefix(lid))
        self.assertEqual(len(trs), 1)
        tr = trs[0]
        self.assertEqual(tr["courseId"], cid)
        self.assertEqual(tr["lessonId"], lid)
        self.assertEqual(tr["sourceId"], up["sourceId"])
        self.assertEqual(tr["text"], "Türev tanımı")
        self.assertEqual(tr["language"], "tr-TR")
        # lesson marked ready
        lesson = store.get(SUB_A, store.sk_lesson(cid, lid))
        self.assertEqual(lesson["status"], "ready")

    def test_failed_releases_and_retry_no_double_count(self):
        cid, lid = self._prep()
        # ~90 min file -> provisional 90
        self.s3 = FakeS3(size=90 * 960_000)
        api._s3 = self.s3
        up1 = self.body(api.handler(event("POST", "/transcribe/upload-url", body={"courseId": cid, "lessonId": lid})))
        j1 = self.body(api.handler(event("POST", "/transcribe/start",
                       body={"audioKey": up1["audioKey"], "courseId": cid, "lessonId": lid, "sourceId": up1["sourceId"]})))
        self.transcribe.status = "FAILED"
        api.handler(event("GET", "/transcribe/status", query={"jobId": j1["jobId"]}))
        # day counter released to 0
        usage = store.get(SUB_A, store.sk_usage(core.today_utc()))
        self.assertEqual(int(usage["minutes"]), 0)
        # retry completes at ~3 min
        up2 = self.body(api.handler(event("POST", "/transcribe/upload-url", body={"courseId": cid, "lessonId": lid})))
        j2 = self.body(api.handler(event("POST", "/transcribe/start",
                       body={"audioKey": up2["audioKey"], "courseId": cid, "lessonId": lid, "sourceId": up2["sourceId"]})))
        self.transcribe.status = "COMPLETED"
        self.transcribe.transcript_uri = write_transcript("tekrar", timed_items([150.0]))
        for _ in range(3):  # idempotent repeated polling
            api.handler(event("GET", "/transcribe/status", query={"jobId": j2["jobId"]}))
        usage = store.get(SUB_A, store.sk_usage(core.today_utc()))
        self.assertEqual(int(usage["minutes"]), 3)  # only the successful attempt's actual

    def test_oversized_rejected(self):
        cid, lid = self._prep()
        self.s3 = FakeS3(size=200_000_000)
        api._s3 = self.s3
        up = self.body(api.handler(event("POST", "/transcribe/upload-url", body={"courseId": cid, "lessonId": lid})))
        # upload-url uses the new (200MB) fake but that's fine; start re-heads.
        r = api.handler(event("POST", "/transcribe/start",
                        body={"audioKey": up["audioKey"], "courseId": cid, "lessonId": lid, "sourceId": up["sourceId"]}))
        self.assertEqual(r["statusCode"], 413)
        self.assertEqual(self.transcribe.started, [])

    def test_start_requires_owned_course_lesson(self):
        # No course/lesson created -> start rejected 404 (ownership).
        r = api.handler(event("POST", "/transcribe/upload-url", body={"courseId": "course_x", "lessonId": "lesson_x"}))
        self.assertEqual(r["statusCode"], 404)

    def _complete_one(self, cid, lid, text):
        up = self.body(api.handler(event("POST", "/transcribe/upload-url", body={"courseId": cid, "lessonId": lid})))
        j = self.body(api.handler(event("POST", "/transcribe/start",
                     body={"audioKey": up["audioKey"], "courseId": cid, "lessonId": lid, "sourceId": up["sourceId"]})))
        self.transcribe.status = "COMPLETED"
        self.transcribe.transcript_uri = write_transcript(text, timed_items([30.0]))
        api.handler(event("GET", "/transcribe/status", query={"jobId": j["jobId"]}))
        return up["sourceId"]

    def test_two_recordings_one_lesson_do_not_overwrite(self):
        cid, lid = self._prep()
        s1 = self._complete_one(cid, lid, "birinci kayıt")
        s2 = self._complete_one(cid, lid, "ikinci kayıt")
        self.assertNotEqual(s1, s2)
        trs = store.query_prefix(SUB_A, store.sk_transcript_prefix(lid))
        self.assertEqual(len(trs), 2)  # both preserved, source-specific keys
        texts = sorted(t["text"] for t in trs)
        self.assertEqual(texts, ["birinci kayıt", "ikinci kayıt"])

    def test_list_sources_and_transcripts_cross_device(self):
        cid, lid = self._prep()
        self._complete_one(cid, lid, "ders metni")
        # A fresh "device" (no local state) lists via the API.
        srcs = self.body(api.handler(event("GET", f"/courses/{cid}/lessons/{lid}/sources",
                        path_params={"courseId": cid, "lessonId": lid})))
        self.assertEqual(len(srcs["sources"]), 1)
        self.assertNotIn("audioKey", srcs["sources"][0])  # raw S3 key not exposed
        trs = self.body(api.handler(event("GET", f"/courses/{cid}/lessons/{lid}/transcripts",
                        path_params={"courseId": cid, "lessonId": lid})))
        self.assertEqual(len(trs["transcripts"]), 1)
        self.assertEqual(trs["transcripts"][0]["text"], "ders metni")


if __name__ == "__main__":
    unittest.main()
