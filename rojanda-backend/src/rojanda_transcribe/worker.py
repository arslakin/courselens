"""Background study-generation worker (Phase 2 async pipeline).

Triggered by the study-generation SQS queue. Each message carries only the ids
+ the claim token + language (never transcript text or secrets); the worker
re-reads the AUTHORITATIVE transcript from the single table and runs the grounded
MAP/REDUCE, persisting a `ready` or `failed` study item.

Why a separate Lambda: the API Gateway HTTP API has a hard, non-raisable 30s
integration timeout, but a full lesson (up to ~50 min this milestone) can take
longer when a real model provider runs per-chunk. The API handler enqueues and
returns fast (202); this worker does the long work off the request path, with a
timeout sized for the work rather than the HTTP window.

Idempotency / no duplicate spend lives in `resources.run_study_job`: it no-ops
when the stored claim token no longer matches or the item is already ready, so
an SQS redelivery (at-least-once) cannot double-spend on the model.
"""
from __future__ import annotations

import json
import logging
import os

from . import resources

logger = logging.getLogger("rojanda.worker")
logger.setLevel(logging.INFO)

_bedrock_runtime = None


def _provider_client():
    """Create the Bedrock Runtime client lazily, in the WORKER only.

    Constructing a boto3 client does not invoke a model. The API Lambda neither
    imports this worker handler nor has Bedrock IAM/configuration. Tests/local
    mode return None, preserving the no-paid-model safety gate.
    """
    if os.environ.get("ROJANDA_STUDY_PROVIDER", "local").lower() != "bedrock":
        return None
    global _bedrock_runtime
    if _bedrock_runtime is None:
        import boto3

        _bedrock_runtime = boto3.client("bedrock-runtime")
    return _bedrock_runtime


def handler(event, _context=None):
    """SQS event handler. Processes each record; partial-batch reporting lets a
    single bad record be retried/DLQ'd without reprocessing the whole batch."""
    failures = []
    for record in (event or {}).get("Records", []):
        message_id = record.get("messageId")
        try:
            msg = json.loads(record.get("body") or "{}")
            resources.run_study_job(
                owner_id=msg["ownerId"],
                course_id=msg["courseId"],
                lesson_id=msg["lessonId"],
                source_id=msg["sourceId"],
                fingerprint=msg["transcriptFingerprint"],
                claim_token=msg["claimToken"],
                language=msg.get("language", "tr"),
                provider_client=_provider_client(),
            )
        except Exception:  # noqa: BLE001 - never crash the whole batch
            # Log route/type only (no transcript text / ids beyond the message
            # id). The record is returned as a batch-item failure so SQS retries
            # it and, after maxReceiveCount, routes it to the DLQ.
            logger.exception("study_job_failed messageId=%s", message_id)
            if message_id:
                failures.append({"itemIdentifier": message_id})
    return {"batchItemFailures": failures}
