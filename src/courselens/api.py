"""AWS Lambda handler for the CourseLens HTTP API.

This is a thin adapter over ``pipeline``: it parses/validates the HTTP request,
calls the existing analysis logic, and formats a consistent JSON response. All
domain logic lives in the pipeline/analyzer modules — nothing is duplicated
here.

Routes (API Gateway HTTP API, payload format v2.0):
    POST /analyze  -> analyze pasted text or an uploaded file
    POST /explain  -> explain a single step/concept further
    OPTIONS *      -> CORS preflight

The handler is written to be import-safe and unit-testable without AWS: the
event/response shapes match API Gateway's HTTP API v2 format, and the pipeline
functions accept an injectable analyzer in tests.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
from typing import Any

from . import config, pipeline
from .errors import (
    BedrockError,
    CourseLensError,
    EmptyInputError,
    ExtractionError,
    ModelOutputError,
    ScannedDocumentError,
    UnsupportedFileTypeError,
)

logger = logging.getLogger("courselens.api")
logger.setLevel(logging.INFO)

# CORS is permissive here (any origin) so the future static frontend on
# CloudFront can call the API. The API is read-only-ish and unauthenticated;
# it exposes no data store. Tighten to the CloudFront domain post-hackathon.
CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
}

# Cap the decoded request body to avoid pathological payloads. API Gateway
# also caps at 10MB; this is a defensive inner bound aligned with MVP-sized docs.
MAX_BODY_BYTES = 8 * 1024 * 1024  # 8 MB


class ApiError(Exception):
    """Raised to short-circuit request handling with a specific status code."""

    def __init__(self, status: int, message: str, code: str = "bad_request") -> None:
        super().__init__(message)
        self.status = status
        self.code = code


def handler(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    """Lambda entry point for the HTTP API."""
    method = _method(event)
    path = _path(event)

    # CORS preflight.
    if method == "OPTIONS":
        return _response(204, "")

    try:
        if method != "POST":
            raise ApiError(405, f"Method {method} not allowed.", "method_not_allowed")

        if path.endswith("/analyze"):
            body = _parse_body(event)
            result = _handle_analyze(body)
            return _json_response(200, result)

        if path.endswith("/explain"):
            body = _parse_body(event)
            result = _handle_explain(body)
            return _json_response(200, result)

        raise ApiError(404, f"No route for {path}.", "not_found")

    except ApiError as exc:
        return _error(exc.status, exc.code, str(exc))
    except (
        EmptyInputError,
        UnsupportedFileTypeError,
        ScannedDocumentError,
    ) as exc:
        # Client-correctable input problems -> 422.
        return _error(422, _error_code(exc), str(exc))
    except ExtractionError as exc:
        return _error(422, "extraction_failed", str(exc))
    except (BedrockError, ModelOutputError) as exc:
        # Upstream/model failures -> 502.
        logger.exception("Upstream model error")
        return _error(502, "model_error", str(exc))
    except CourseLensError as exc:
        logger.exception("CourseLens error")
        return _error(500, "internal_error", str(exc))
    except Exception:  # noqa: BLE001 - final safety net
        logger.exception("Unhandled error")
        return _error(500, "internal_error", "An unexpected error occurred.")


# -- route handlers ----------------------------------------------------------


def _handle_analyze(body: dict[str, Any]) -> dict[str, Any]:
    input_type = body.get("inputType")
    override = body.get("overrideType")

    if override is not None and not isinstance(override, str):
        raise ApiError(400, "'overrideType' must be a string when provided.")

    if input_type == "text":
        text = body.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ApiError(400, "'text' is required and must be a non-empty string.")
        return pipeline.analyze_text(text, doc_type=override)

    if input_type == "file":
        file_name = body.get("fileName")
        b64 = body.get("fileContentBase64")
        if not isinstance(file_name, str) or not file_name.strip():
            raise ApiError(400, "'fileName' is required for file input.")
        if not isinstance(b64, str) or not b64:
            raise ApiError(400, "'fileContentBase64' is required for file input.")
        data = _decode_base64(b64)
        return pipeline.analyze_file(data, file_name, doc_type=override)

    raise ApiError(400, "'inputType' must be 'text' or 'file'.")


def _handle_explain(body: dict[str, Any]) -> dict[str, Any]:
    context_text = body.get("context")
    target = body.get("target")
    if not isinstance(context_text, str) or not context_text.strip():
        raise ApiError(400, "'context' is required and must be a non-empty string.")
    if not isinstance(target, str) or not target.strip():
        raise ApiError(400, "'target' is required and must be a non-empty string.")
    return pipeline.explain_further(context_text, target)


# -- request parsing helpers -------------------------------------------------


def _method(event: dict[str, Any]) -> str:
    ctx = event.get("requestContext", {})
    http = ctx.get("http", {}) if isinstance(ctx, dict) else {}
    return (http.get("method") or event.get("httpMethod") or "").upper()


def _path(event: dict[str, Any]) -> str:
    ctx = event.get("requestContext", {})
    http = ctx.get("http", {}) if isinstance(ctx, dict) else {}
    return http.get("path") or event.get("rawPath") or event.get("path") or ""


def _parse_body(event: dict[str, Any]) -> dict[str, Any]:
    raw = event.get("body")
    if raw is None:
        raise ApiError(400, "Request body is required.")

    if event.get("isBase64Encoded"):
        try:
            raw = base64.b64decode(raw).decode("utf-8")
        except (binascii.Error, ValueError, UnicodeDecodeError) as exc:
            raise ApiError(400, "Could not decode request body.") from exc

    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", errors="replace")

    if len(raw) > MAX_BODY_BYTES:
        raise ApiError(413, "Request body too large.", "payload_too_large")

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ApiError(400, "Request body must be valid JSON.") from exc

    if not isinstance(parsed, dict):
        raise ApiError(400, "Request body must be a JSON object.")
    return parsed


def _decode_base64(value: str) -> bytes:
    try:
        data = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ApiError(400, "'fileContentBase64' is not valid base64.") from exc
    if len(data) > MAX_BODY_BYTES:
        raise ApiError(413, "Uploaded file is too large.", "payload_too_large")
    return data


# -- response helpers --------------------------------------------------------


def _response(status: int, body: str, extra_headers: dict[str, str] | None = None) -> dict[str, Any]:
    headers = {**CORS_HEADERS}
    if extra_headers:
        headers.update(extra_headers)
    return {"statusCode": status, "headers": headers, "body": body}


def _json_response(status: int, payload: dict[str, Any]) -> dict[str, Any]:
    return _response(
        status,
        json.dumps(payload),
        {"Content-Type": "application/json"},
    )


def _error(status: int, code: str, message: str) -> dict[str, Any]:
    return _json_response(status, {"error": {"code": code, "message": message}})


def _error_code(exc: Exception) -> str:
    return {
        EmptyInputError: "empty_input",
        UnsupportedFileTypeError: "unsupported_file_type",
        ScannedDocumentError: "scanned_document",
    }.get(type(exc), "bad_request")


# Convenience for logging which model/region the handler is configured for.
logger.info(
    "CourseLens API configured: region=%s model=%s",
    config.AWS_REGION,
    config.BEDROCK_MODEL_ID,
)
