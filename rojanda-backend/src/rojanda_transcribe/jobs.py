"""Background job enqueue seam (Phase 2 async study generation).

Study-material generation does a bounded MAP/REDUCE over the transcript. For a
full lesson (up to ~50 min this milestone) that can exceed the API Gateway HTTP
API hard 30s integration timeout, so when a real (paid) provider is used the API
handler must NOT run generation inline: it enqueues a job here and returns fast,
and a separate worker Lambda consumes the queue and persists the result.

This module is the single SQS boundary, kept thin + injectable like `store`:
unit tests replace the client via `set_client`. When no queue is configured
(local dev / tests / the deterministic local provider), `is_async_enabled()` is
False and the caller generates synchronously instead — no queue, no network.
"""
from __future__ import annotations

import json
import os
from typing import Optional

import boto3

_sqs = boto3.client("sqs")


def set_client(client) -> None:
    """Test seam: replace the SQS client with a fake."""
    global _sqs
    _sqs = client


def queue_url() -> str:
    """The study-generation queue URL, or "" when async is not configured."""
    return os.environ.get("ROJANDA_STUDY_QUEUE_URL", "")


def is_async_enabled() -> bool:
    """True only when a queue is configured. Local dev / tests / the local
    grounded provider run synchronously (no queue), so this stays False there."""
    return bool(queue_url())


def enqueue_study_job(owner_id: str, course_id: str, lesson_id: str, source_id: str,
                      fingerprint: str, claim_token: str, language: str) -> None:
    """Enqueue one grounded-generation job. The message carries only the IDS +
    the claim token the worker must match — never the transcript text or any
    secret. The worker re-reads the authoritative transcript from the store.
    """
    body = {
        "ownerId": owner_id,
        "courseId": course_id,
        "lessonId": lesson_id,
        "sourceId": source_id,
        "transcriptFingerprint": fingerprint,
        "claimToken": claim_token,
        "language": language,
    }
    _sqs.send_message(QueueUrl=queue_url(), MessageBody=json.dumps(body))
