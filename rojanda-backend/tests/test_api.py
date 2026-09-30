"""Backend security + behavior tests for the RojAnda transcription API.

Uses stdlib unittest (no third-party test deps). boto3 clients on the api
module are replaced with in-memory fakes so no AWS is touched. Run:

    ROJANDA_MEDIA_BUCKET=b ROJANDA_USAGE_TABLE=t \
    PYTHONPATH=src python -m unittest discover -s tests -v
"""
import json
import os
import sys
import unittest
from pathlib import Path

# Make src importable and set required env before importing the handler.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
os.environ.setdefault("ROJANDA_MEDIA_BUCKET", "rojanda-media-test")
os.environ.setdefault("ROJANDA_USAGE_TABLE", "rojanda-usage-test")
os.environ.setdefault("ROJANDA_MAX_UPLOAD_BYTES", "157286400")
os.environ.setdefault("ROJANDA_MAX_AUDIO_SECONDS", "5400")
os.environ.setdefault("ROJANDA_DAILY_MINUTES_ALLOWANCE", "120")

from rojanda_transcribe import api  # noqa: E402
from rojanda_transcribe import core  # noqa: E402

IDENTITY_A = "us-east-1:11111111-1111-1111-1111-111111111111"
IDENTITY_B = "us-east-1:22222222-2222-2222-2222-222222222222"


def write_transcript(text, items):
    """Write a fake Amazon Transcribe output JSON to a temp file, return file:// URI."""
    import tempfile

    payload = {"results": {"transcripts": [{"transcript": text}], "items": items}}
    f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump(payload, f)
    f.close()
    return "file://" + f.name


def timed_items(end_times, confidence="0.9"):
    """Build pronunciation items with the given end_time values (seconds str)."""
    return [
        {"type": "pronunciation", "end_time": str(t), "alternatives": [{"confidence": confidence}]}
        for t in end_times
    ]


def event(method, path, identity=IDENTITY_A, body=None, query=None):
    rc = {"http": {"method": method, "path": path}}
    if identity is not None:
        rc["authorizer"] = {"iam": {"cognitoIdentity": {"identityId": identity}}}
    return {
        "requestContext": rc,
        "rawPath": path,
        "body": json.dumps(body) if body is not None else None,
        "queryStringParameters": query,
    }


class FakeConditionalCheckFailed(Exception):
    pass


class FakeDynamo:
    """In-memory DynamoDB fake that interprets the exact update patterns the
    handler uses (day-counter conditional add, unconditional add + floor,
    per-job provisional write, conditional settle/release) and get_item."""

    class exceptions:
        ConditionalCheckFailedException = FakeConditionalCheckFailed

    def __init__(self):
        # pk -> dict of attributes (each a plain python value)
        self.items = {}

    # --- helpers ---
    def _get(self, pk):
        return self.items.setdefault(pk, {})

    def get_item(self, TableName, Key):
        pk = Key["pk"]["S"]
        item = self.items.get(pk)
        if not item:
            return {}
        out = {}
        for k, v in item.items():
            if isinstance(v, bool):
                out[k] = {"BOOL": v}
            else:
                out[k] = {"N": str(v)}
        return {"Item": out}

    def update_item(self, TableName, Key, UpdateExpression,
                    ExpressionAttributeValues=None, ExpressionAttributeNames=None,
                    ConditionExpression=None, ReturnValues=None):
        pk = Key["pk"]["S"]
        item = self._get(pk)
        vals = ExpressionAttributeValues or {}
        expr = UpdateExpression

        # 1) Day-counter conditional provisional add: "SET #ttl=:ttl ADD #m :inc"
        if "ADD #m :inc" in expr:
            inc = int(vals[":inc"]["N"])
            room = int(vals[":room"]["N"])
            current = item.get("minutes")
            if ConditionExpression and current is not None and not (current <= room):
                raise FakeConditionalCheckFailed()
            item["minutes"] = (current or 0) + inc
            item["ttl"] = int(vals[":ttl"]["N"])
            return {}

        # 2) Unconditional day delta: "SET #ttl=:ttl ADD #m :d"
        if "ADD #m :d" in expr:
            d = int(vals[":d"]["N"])
            item["minutes"] = (item.get("minutes") or 0) + d
            item["ttl"] = int(vals[":ttl"]["N"])
            return {}

        # 3) Floor: "SET #m = :zero" with condition "#m < :zero"
        if "SET #m = :zero" in expr:
            if (item.get("minutes") or 0) < 0:
                item["minutes"] = 0
            else:
                raise FakeConditionalCheckFailed()
            return {}

        # 4) Per-job provisional create: "SET provisional=:p, settled=:false, #ttl=:ttl"
        if "provisional = :p" in expr:
            item["provisional"] = int(vals[":p"]["N"])
            item["settled"] = bool(vals[":false"]["BOOL"])
            item["ttl"] = int(vals[":ttl"]["N"])
            return {}

        # 5) Settle / release: condition "attribute_exists(provisional) AND settled = :false"
        if "settled = :true" in expr:
            if "provisional" not in item or item.get("settled") is not False:
                raise FakeConditionalCheckFailed()
            item["settled"] = True
            item["actualMinutes"] = int(vals[":am"]["N"]) if ":am" in vals else int(vals[":zero"]["N"])
            if ":ds" in vals:
                item["durationSeconds"] = float(vals[":ds"]["N"])
            elif ":zerof" in vals:
                item["durationSeconds"] = float(vals[":zerof"]["N"])
            item["ttl"] = int(vals[":ttl"]["N"])
            return {}

        raise AssertionError("Unhandled UpdateExpression in fake: " + expr)


class FakeS3:
    def __init__(self, size=1_000_000, missing=False):
        self._size = size
        self._missing = missing
        self.presigned_calls = []

    def generate_presigned_post(self, Bucket, Key, Fields, Conditions, ExpiresIn):
        self.presigned_calls.append({"Bucket": Bucket, "Key": Key, "Conditions": Conditions})
        return {"url": f"https://{Bucket}.s3.amazonaws.com", "fields": {"key": Key, **Fields}}

    def head_object(self, Bucket, Key):
        if self._missing:
            from botocore.exceptions import ClientError as BotoClientError
            raise BotoClientError({"Error": {"Code": "404"}}, "HeadObject")
        return {"ContentLength": self._size}


class FakeTranscribe:
    def __init__(self, status="COMPLETED", transcript_uri=None, fail_reason=None):
        self.status = status
        self.transcript_uri = transcript_uri
        self.fail_reason = fail_reason
        self.started = []

    def start_transcription_job(self, **kwargs):
        self.started.append(kwargs)
        return {}

    def get_transcription_job(self, TranscriptionJobName):
        job = {"TranscriptionJobStatus": self.status}
        if self.status == "FAILED":
            job["FailureReason"] = self.fail_reason or "boom"
        if self.status == "COMPLETED":
            job["Transcript"] = {"TranscriptFileUri": self.transcript_uri}
        return {"TranscriptionJob": job}


class BaseCase(unittest.TestCase):
    def setUp(self):
        self.s3 = FakeS3()
        self.transcribe = FakeTranscribe()
        self.dynamo = FakeDynamo()
        self._orig = (api._s3, api._transcribe, api._dynamodb)
        api._s3, api._transcribe, api._dynamodb = self.s3, self.transcribe, self.dynamo

    def tearDown(self):
        api._s3, api._transcribe, api._dynamodb = self._orig

    def body(self, resp):
        return json.loads(resp["body"])


class IdentityTests(BaseCase):
    def test_missing_identity_is_unauthorized(self):
        resp = api.handler(event("POST", "/transcribe/upload-url", identity=None, body={}))
        self.assertEqual(resp["statusCode"], 401)

    def test_malformed_identity_is_unauthorized(self):
        resp = api.handler(event("POST", "/transcribe/upload-url", identity="not-an-identity", body={}))
        self.assertEqual(resp["statusCode"], 401)


class UploadUrlTests(BaseCase):
    def test_server_generates_key_under_caller_prefix_with_size_condition(self):
        resp = api.handler(event("POST", "/transcribe/upload-url", body={}))
        self.assertEqual(resp["statusCode"], 200)
        b = self.body(resp)
        self.assertTrue(b["audioKey"].startswith(f"users/{IDENTITY_A}/audio/"))
        self.assertTrue(b["audioKey"].endswith(".m4a"))
        # content-length-range condition present with the 150 MB ceiling.
        conds = self.s3.presigned_calls[0]["Conditions"]
        clr = [c for c in conds if isinstance(c, list) and c[0] == "content-length-range"]
        self.assertEqual(clr, [["content-length-range", 1, 157286400]])


class KeyValidationTests(BaseCase):
    def test_cross_user_key_is_rejected(self):
        other = f"users/{IDENTITY_B}/audio/deadbeef.m4a"
        resp = api.handler(event("POST", "/transcribe/start", identity=IDENTITY_A, body={"audioKey": other}))
        self.assertEqual(resp["statusCode"], 403)
        self.assertEqual(self.transcribe.started, [])  # never started

    def test_path_injection_keys_rejected(self):
        for bad in [
            "users/{}/audio/../../etc/passwd".format(IDENTITY_A),
            "users/{}/audio/x.mp3".format(IDENTITY_A),  # wrong ext
            "users/{}/audio/x.m4a/../y.m4a".format(IDENTITY_A),
            "../users/{}/audio/x.m4a".format(IDENTITY_A),
            "users/{}/notaudio/x.m4a".format(IDENTITY_A),
            "arbitrary-string",
        ]:
            resp = api.handler(event("POST", "/transcribe/start", body={"audioKey": bad}))
            self.assertIn(resp["statusCode"], (400, 403), bad)
            self.assertEqual(self.transcribe.started, [])


class UploadSizeTests(BaseCase):
    def test_oversized_object_rejected_server_side(self):
        self.s3 = FakeS3(size=200_000_000)  # > 150 MB
        api._s3 = self.s3
        key = core.new_audio_key(IDENTITY_A)
        resp = api.handler(event("POST", "/transcribe/start", body={"audioKey": key}))
        self.assertEqual(resp["statusCode"], 413)
        self.assertEqual(self.transcribe.started, [])

    def test_missing_object_is_404(self):
        self.s3 = FakeS3(missing=True)
        api._s3 = self.s3
        key = core.new_audio_key(IDENTITY_A)
        resp = api.handler(event("POST", "/transcribe/start", body={"audioKey": key}))
        self.assertEqual(resp["statusCode"], 404)


class DailyQuotaTests(BaseCase):
    def test_quota_enforced_after_allowance_exhausted(self):
        # ~10 min per 1 MB? No: FakeS3 default 1 MB ~= 1 min. Use a big file so
        # each start reserves a large chunk and the second call exceeds 120.
        self.s3 = FakeS3(size=90 * 960_000)  # ~90 min worth of bytes
        api._s3 = self.s3
        key1 = core.new_audio_key(IDENTITY_A)
        key2 = core.new_audio_key(IDENTITY_A)
        r1 = api.handler(event("POST", "/transcribe/start", body={"audioKey": key1}))
        self.assertEqual(r1["statusCode"], 200)  # ~90 <= 120
        r2 = api.handler(event("POST", "/transcribe/start", body={"audioKey": key2}))
        self.assertEqual(r2["statusCode"], 429)  # 90 + 90 > 120 -> blocked
        self.assertEqual(self.body(r2)["error"]["code"], "daily_quota")

    def test_quota_is_per_identity(self):
        self.s3 = FakeS3(size=90 * 960_000)
        api._s3 = self.s3
        # A uses ~90 min; B is unaffected.
        api.handler(event("POST", "/transcribe/start", identity=IDENTITY_A,
                          body={"audioKey": core.new_audio_key(IDENTITY_A)}))
        rb = api.handler(event("POST", "/transcribe/start", identity=IDENTITY_B,
                               body={"audioKey": core.new_audio_key(IDENTITY_B)}))
        self.assertEqual(rb["statusCode"], 200)


class StartLanguageTests(BaseCase):
    def test_starts_turkish_mp4_job_with_server_key(self):
        key = core.new_audio_key(IDENTITY_A)
        resp = api.handler(event("POST", "/transcribe/start", body={"audioKey": key}))
        self.assertEqual(resp["statusCode"], 200)
        started = self.transcribe.started[0]
        self.assertEqual(started["LanguageCode"], "tr-TR")
        self.assertEqual(started["MediaFormat"], "mp4")
        self.assertEqual(started["Media"]["MediaFileUri"], f"s3://rojanda-media-test/{key}")
        self.assertTrue(started["TranscriptionJobName"].startswith("rojanda-us-east-1-"))
        self.assertTrue(started["OutputKey"].startswith(f"users/{IDENTITY_A}/transcript/"))


class StatusTests(BaseCase):
    def _job_for(self, identity):
        return core.job_name_for(identity, core.new_audio_key(identity))

    def test_pending_status(self):
        self.transcribe.status = "IN_PROGRESS"
        job = self._job_for(IDENTITY_A)
        resp = api.handler(event("GET", "/transcribe/status", query={"jobId": job}))
        self.assertEqual(self.body(resp)["status"], "IN_PROGRESS")

    def test_failed_status_preserves_audio_and_reports_error(self):
        self.transcribe.status = "FAILED"
        self.transcribe.fail_reason = "bad audio"
        job = self._job_for(IDENTITY_A)
        resp = api.handler(event("GET", "/transcribe/status", query={"jobId": job}))
        b = self.body(resp)
        self.assertEqual(b["status"], "FAILED")
        self.assertIn("error", b)
        # No transcript text fabricated on failure.
        self.assertNotIn("transcript", b)

    def test_completed_returns_only_real_transcript(self):
        self.transcribe.status = "COMPLETED"
        self.transcribe.transcript_uri = write_transcript(
            "Merhaba ders",
            items=[
                {"type": "pronunciation", "end_time": "1.0", "alternatives": [{"confidence": "0.9"}]},
                {"type": "pronunciation", "end_time": "2.0", "alternatives": [{"confidence": "0.8"}]},
            ],
        )
        job = self._job_for(IDENTITY_A)
        resp = api.handler(event("GET", "/transcribe/status", query={"jobId": job}))
        b = self.body(resp)
        self.assertEqual(b["status"], "COMPLETED")
        self.assertEqual(b["transcript"], "Merhaba ders")
        self.assertAlmostEqual(b["confidenceAvg"], 0.85, places=3)

    def test_cannot_read_another_identitys_job(self):
        job_b = self._job_for(IDENTITY_B)
        resp = api.handler(event("GET", "/transcribe/status", identity=IDENTITY_A, query={"jobId": job_b}))
        self.assertEqual(resp["statusCode"], 403)

    def test_missing_jobid_is_forbidden(self):
        resp = api.handler(event("GET", "/transcribe/status", query={}))
        self.assertEqual(resp["statusCode"], 403)


class RetryTests(BaseCase):
    def test_retry_reuses_same_audio_key_and_starts_new_job(self):
        key = core.new_audio_key(IDENTITY_A)
        r1 = api.handler(event("POST", "/transcribe/start", body={"audioKey": key}))
        r2 = api.handler(event("POST", "/transcribe/start", body={"audioKey": key}))
        self.assertEqual(r1["statusCode"], 200)
        self.assertEqual(r2["statusCode"], 200)
        # Same preserved audio, two distinct server-generated job names.
        self.assertEqual(len(self.transcribe.started), 2)
        self.assertEqual(self.transcribe.started[0]["Media"]["MediaFileUri"],
                         self.transcribe.started[1]["Media"]["MediaFileUri"])
        self.assertNotEqual(self.transcribe.started[0]["TranscriptionJobName"],
                            self.transcribe.started[1]["TranscriptionJobName"])


class UsageMeteringTests(BaseCase):
    """Provisional (abuse guard) -> authoritative (Transcribe) reconciliation."""

    def _day_minutes(self, identity=IDENTITY_A):
        pk = core.usage_pk(identity)
        return self.dynamo.items.get(pk, {}).get("minutes", 0)

    def _start_job(self, identity=IDENTITY_A, size=None):
        if size is not None:
            self.s3 = FakeS3(size=size)
            api._s3 = self.s3
        key = core.new_audio_key(identity)
        r = api.handler(event("POST", "/transcribe/start", identity=identity, body={"audioKey": key}))
        self.assertEqual(r["statusCode"], 200, r)
        return self.body(r)["jobId"]

    def test_start_reserves_provisional_not_actual(self):
        # ~30 min file -> provisional 30 reserved up front (abuse guard only).
        job = self._start_job(size=30 * 960_000)
        self.assertEqual(self._day_minutes(), 30)
        rec = self.dynamo.items[core.job_usage_pk(IDENTITY_A, job)]
        self.assertEqual(rec["provisional"], 30)
        self.assertIs(rec["settled"], False)  # not settled as actual yet

    def test_completed_reconciles_to_authoritative_duration(self):
        # Provisional ~30 min from size, but real audio ends at 65.4s -> 2 min.
        job = self._start_job(size=30 * 960_000)
        self.assertEqual(self._day_minutes(), 30)  # provisional
        self.transcribe.status = "COMPLETED"
        self.transcribe.transcript_uri = write_transcript("merhaba", timed_items([10.0, 65.4]))
        resp = api.handler(event("GET", "/transcribe/status", query={"jobId": job}))
        b = self.body(resp)
        # Second-level precision preserved from Transcribe max(end_time).
        self.assertAlmostEqual(b["durationSeconds"], 65.4, places=3)
        # Day counter reconciled from provisional 30 -> actual 2 (ceil(65.4/60)).
        self.assertEqual(self._day_minutes(), 2)
        rec = self.dynamo.items[core.job_usage_pk(IDENTITY_A, job)]
        self.assertIs(rec["settled"], True)
        self.assertEqual(rec["actualMinutes"], 2)
        self.assertAlmostEqual(rec["durationSeconds"], 65.4, places=3)

    def test_duration_seconds_preserves_second_level_precision(self):
        job = self._start_job(size=5 * 960_000)
        self.transcribe.status = "COMPLETED"
        self.transcribe.transcript_uri = write_transcript("x", timed_items([12.345]))
        b = self.body(api.handler(event("GET", "/transcribe/status", query={"jobId": job})))
        self.assertAlmostEqual(b["durationSeconds"], 12.345, places=3)
        # Quota uses rounded-up minutes (1), but seconds retain precision.
        self.assertEqual(self._day_minutes(), 1)

    def test_repeated_completed_polling_is_idempotent(self):
        job = self._start_job(size=30 * 960_000)
        self.transcribe.status = "COMPLETED"
        self.transcribe.transcript_uri = write_transcript("m", timed_items([120.0]))
        for _ in range(4):
            api.handler(event("GET", "/transcribe/status", query={"jobId": job}))
        # Settled once to actual 2 min (ceil(120/60)); never double-counted.
        self.assertEqual(self._day_minutes(), 2)

    def test_failed_job_releases_provisional_usage(self):
        job = self._start_job(size=45 * 960_000)
        self.assertEqual(self._day_minutes(), 45)  # provisional held
        self.transcribe.status = "FAILED"
        self.transcribe.fail_reason = "bad audio"
        b = self.body(api.handler(event("GET", "/transcribe/status", query={"jobId": job})))
        self.assertEqual(b["status"], "FAILED")
        # Provisional released -> failed job not charged as usage.
        self.assertEqual(self._day_minutes(), 0)
        rec = self.dynamo.items[core.job_usage_pk(IDENTITY_A, job)]
        self.assertIs(rec["settled"], True)
        self.assertEqual(rec["actualMinutes"], 0)

    def test_failed_then_retry_success_does_not_double_count(self):
        # Attempt 1: reserve provisional, then fail -> released to 0.
        job1 = self._start_job(size=40 * 960_000)
        self.transcribe.status = "FAILED"
        api.handler(event("GET", "/transcribe/status", query={"jobId": job1}))
        self.assertEqual(self._day_minutes(), 0)
        # Attempt 2 (retry, same audio): its own job record; completes at ~3 min.
        job2 = self._start_job(size=40 * 960_000)  # provisional 40 again
        self.assertEqual(self._day_minutes(), 40)
        self.transcribe.status = "COMPLETED"
        self.transcribe.transcript_uri = write_transcript("tekrar", timed_items([150.0]))
        api.handler(event("GET", "/transcribe/status", query={"jobId": job2}))
        # Only the successful attempt's ACTUAL usage counts: ceil(150/60)=3.
        self.assertEqual(self._day_minutes(), 3)
        # Failed job stays at zero actual; success settled to 3.
        self.assertEqual(self.dynamo.items[core.job_usage_pk(IDENTITY_A, job1)]["actualMinutes"], 0)
        self.assertEqual(self.dynamo.items[core.job_usage_pk(IDENTITY_A, job2)]["actualMinutes"], 3)

    def test_trailing_silence_uses_transcribe_derived_duration(self):
        # Last recognized token ends at 40.0s even if the file is longer; we
        # account the Transcribe-derived duration, documented as through-final-token.
        job = self._start_job(size=10 * 960_000)
        self.transcribe.status = "COMPLETED"
        self.transcribe.transcript_uri = write_transcript("son kelime", timed_items([38.0, 40.0]))
        b = self.body(api.handler(event("GET", "/transcribe/status", query={"jobId": job})))
        self.assertAlmostEqual(b["durationSeconds"], 40.0, places=3)  # not the ~10-min file size
        self.assertEqual(self._day_minutes(), 1)  # ceil(40/60)


class CoreDurationUnitTests(unittest.TestCase):
    def test_authoritative_seconds_is_max_end_time(self):
        items = [
            {"type": "pronunciation", "end_time": "1.5"},
            {"type": "punctuation"},  # no end_time -> ignored
            {"type": "pronunciation", "end_time": "42.317"},
        ]
        self.assertAlmostEqual(core.authoritative_seconds(items), 42.317, places=3)

    def test_authoritative_seconds_empty(self):
        self.assertEqual(core.authoritative_seconds([]), 0.0)

    def test_seconds_to_minutes_rounds_up(self):
        self.assertEqual(core.seconds_to_billable_minutes(0), 0)
        self.assertEqual(core.seconds_to_billable_minutes(1), 1)
        self.assertEqual(core.seconds_to_billable_minutes(60), 1)
        self.assertEqual(core.seconds_to_billable_minutes(61), 2)

    def test_provisional_minutes_clamped_and_rounded_up(self):
        self.assertEqual(core.provisional_minutes_from_size(0, 90), 1)
        self.assertEqual(core.provisional_minutes_from_size(960_000, 90), 1)
        self.assertEqual(core.provisional_minutes_from_size(960_001, 90), 2)
        self.assertEqual(core.provisional_minutes_from_size(999 * 960_000, 90), 90)  # clamp


if __name__ == "__main__":
    unittest.main()
