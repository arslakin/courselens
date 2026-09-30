"""Shared in-memory fakes for backend tests (no AWS).

FakeDynamo implements the single-table operations the store + metering code use:
get_item / put_item / update_item / delete_item / query. It interprets the exact
UpdateExpressions used by the usage-metering functions so quota/idempotency
behavior is exercised faithfully.
"""
from __future__ import annotations

import copy


class FakeConditionalCheckFailed(Exception):
    pass


class FakeDynamo:
    class exceptions:
        ConditionalCheckFailedException = FakeConditionalCheckFailed

    def __init__(self):
        # (pk, sk) -> item dict (raw DynamoDB attribute-value form)
        self.items: dict[tuple, dict] = {}

    def _key(self, Key):
        return (Key["pk"]["S"], Key["sk"]["S"])

    def get_item(self, TableName, Key):
        it = self.items.get(self._key(Key))
        return {"Item": copy.deepcopy(it)} if it else {}

    def put_item(self, TableName, Item):
        self.items[(Item["pk"]["S"], Item["sk"]["S"])] = copy.deepcopy(Item)

    def delete_item(self, TableName, Key):
        self.items.pop(self._key(Key), None)

    def query(self, TableName, KeyConditionExpression, ExpressionAttributeValues, **kw):
        pk = ExpressionAttributeValues[":pk"]["S"]
        prefix = ExpressionAttributeValues.get(":p", {}).get("S", "")
        out = []
        for (ipk, isk), item in self.items.items():
            if ipk == pk and isk.startswith(prefix):
                out.append(copy.deepcopy(item))
        return {"Items": out}

    def update_item(self, TableName, Key, UpdateExpression,
                    ExpressionAttributeValues=None, ExpressionAttributeNames=None,
                    ConditionExpression=None, ReturnValues=None):
        k = self._key(Key)
        item = self.items.setdefault(k, {"pk": Key["pk"], "sk": Key["sk"]})
        vals = ExpressionAttributeValues or {}
        expr = UpdateExpression

        def num(name):
            return int(item.get(name, {}).get("N", "0")) if name in item else None

        # provisional day add: "SET #ttl=:ttl ADD #m :inc" (conditional)
        if "ADD #m :inc" in expr:
            inc = int(vals[":inc"]["N"])
            room = int(vals[":room"]["N"])
            cur = num("minutes")
            if ConditionExpression and cur is not None and not (cur <= room):
                raise FakeConditionalCheckFailed()
            item["minutes"] = {"N": str((cur or 0) + inc)}
            item["ttl"] = vals[":ttl"]
            return {}
        # unconditional day delta: "SET #ttl=:ttl ADD #m :d"
        if "ADD #m :d" in expr:
            d = int(vals[":d"]["N"])
            item["minutes"] = {"N": str((num("minutes") or 0) + d)}
            item["ttl"] = vals[":ttl"]
            return {}
        # floor: "SET #m = :zero" cond "#m < :zero"
        if "SET #m = :zero" in expr:
            if (num("minutes") or 0) < 0:
                item["minutes"] = {"N": "0"}
                return {}
            raise FakeConditionalCheckFailed()
        # per-job create: "SET provisional = :p, settled = :false, #ttl = :ttl"
        if "provisional = :p" in expr:
            item["provisional"] = vals[":p"]
            item["settled"] = vals[":false"]
            item["ttl"] = vals[":ttl"]
            return {}
        # settle/release: cond "attribute_exists(provisional) AND settled = :false"
        if "settled = :true" in expr:
            if "provisional" not in item or item.get("settled", {}).get("BOOL") is not False:
                raise FakeConditionalCheckFailed()
            item["settled"] = {"BOOL": True}
            if ":am" in vals:
                item["actualMinutes"] = vals[":am"]
            elif ":zero" in vals:
                item["actualMinutes"] = vals[":zero"]
            if ":ds" in vals:
                item["durationSeconds"] = vals[":ds"]
            elif ":zerof" in vals:
                item["durationSeconds"] = vals[":zerof"]
            item["ttl"] = vals[":ttl"]
            return {}

        raise AssertionError("Unhandled UpdateExpression in fake: " + expr)


class _Body:
    def __init__(self, data: bytes):
        self._data = data

    def read(self):
        return self._data


class FakeS3:
    def __init__(self, size=1_000_000, missing=False):
        self._size = size
        self._missing = missing
        self.presigned_calls = []
        # key -> bytes, served by get_object (models the signed S3 read).
        self.objects = {}
        self.get_calls = []

    def get_object(self, Bucket, Key):
        self.get_calls.append({"Bucket": Bucket, "Key": Key})
        if Key not in self.objects:
            from botocore.exceptions import ClientError as BotoClientError
            raise BotoClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        return {"Body": _Body(self.objects[Key])}

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
