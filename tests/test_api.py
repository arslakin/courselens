"""Tests for the Lambda HTTP API handler.

The pipeline is monkeypatched so these tests exercise routing, validation,
CORS, and error mapping without any Bedrock/AWS calls.
"""

from __future__ import annotations

import base64
import json

import pytest

from courselens import api


def make_event(method="POST", path="/analyze", body=None, is_b64=False):
    if body is not None and not isinstance(body, str):
        body = json.dumps(body)
    return {
        "requestContext": {"http": {"method": method, "path": path}},
        "rawPath": path,
        "body": body,
        "isBase64Encoded": is_b64,
    }


@pytest.fixture(autouse=True)
def stub_pipeline(monkeypatch):
    """Replace pipeline functions with lightweight stubs."""
    calls = {}

    def fake_analyze_text(text, *, doc_type=None):
        calls["analyze_text"] = {"text": text, "doc_type": doc_type}
        return {"documentType": doc_type or "reading", "summary": "ok"}

    def fake_analyze_file(data, filename, *, doc_type=None):
        calls["analyze_file"] = {
            "len": len(data),
            "filename": filename,
            "doc_type": doc_type,
        }
        return {"documentType": doc_type or "assignment", "explanation": "ok"}

    def fake_explain(context, target):
        calls["explain"] = {"context": context, "target": target}
        return {"explanation": "clear"}

    monkeypatch.setattr(api.pipeline, "analyze_text", fake_analyze_text)
    monkeypatch.setattr(api.pipeline, "analyze_file", fake_analyze_file)
    monkeypatch.setattr(api.pipeline, "explain_further", fake_explain)
    return calls


def _body(resp):
    return json.loads(resp["body"])


# -- CORS / preflight --------------------------------------------------------


def test_options_preflight_returns_cors_headers():
    resp = api.handler(make_event(method="OPTIONS", path="/analyze"))
    assert resp["statusCode"] == 204
    assert resp["headers"]["Access-Control-Allow-Origin"] == "*"
    assert "POST" in resp["headers"]["Access-Control-Allow-Methods"]


def test_success_responses_include_cors_and_content_type():
    resp = api.handler(make_event(body={"inputType": "text", "text": "hello"}))
    assert resp["statusCode"] == 200
    assert resp["headers"]["Access-Control-Allow-Origin"] == "*"
    assert resp["headers"]["Content-Type"] == "application/json"


# -- /analyze ----------------------------------------------------------------


def test_analyze_text_ok(stub_pipeline):
    resp = api.handler(make_event(body={"inputType": "text", "text": "some notes"}))
    assert resp["statusCode"] == 200
    assert stub_pipeline["analyze_text"]["text"] == "some notes"


def test_analyze_text_with_override(stub_pipeline):
    resp = api.handler(
        make_event(
            body={"inputType": "text", "text": "x", "overrideType": "assignment"}
        )
    )
    assert resp["statusCode"] == 200
    assert stub_pipeline["analyze_text"]["doc_type"] == "assignment"


def test_analyze_text_missing_text_is_400():
    resp = api.handler(make_event(body={"inputType": "text"}))
    assert resp["statusCode"] == 400
    assert _body(resp)["error"]["code"] == "bad_request"


def test_analyze_file_ok(stub_pipeline):
    content = base64.b64encode(b"hello file").decode()
    resp = api.handler(
        make_event(
            body={
                "inputType": "file",
                "fileName": "notes.txt",
                "fileContentBase64": content,
            }
        )
    )
    assert resp["statusCode"] == 200
    assert stub_pipeline["analyze_file"]["filename"] == "notes.txt"
    assert stub_pipeline["analyze_file"]["len"] == len(b"hello file")


def test_analyze_file_bad_base64_is_400():
    resp = api.handler(
        make_event(
            body={
                "inputType": "file",
                "fileName": "notes.txt",
                "fileContentBase64": "!!!not base64!!!",
            }
        )
    )
    assert resp["statusCode"] == 400


def test_analyze_invalid_input_type_is_400():
    resp = api.handler(make_event(body={"inputType": "video"}))
    assert resp["statusCode"] == 400


def test_analyze_bad_override_type_is_400():
    resp = api.handler(
        make_event(body={"inputType": "text", "text": "x", "overrideType": 123})
    )
    assert resp["statusCode"] == 400


# -- /explain ----------------------------------------------------------------


def test_explain_ok(stub_pipeline):
    resp = api.handler(
        make_event(path="/explain", body={"context": "ctx", "target": "Osmosis"})
    )
    assert resp["statusCode"] == 200
    assert stub_pipeline["explain"]["target"] == "Osmosis"


def test_explain_missing_target_is_400():
    resp = api.handler(make_event(path="/explain", body={"context": "ctx"}))
    assert resp["statusCode"] == 400


# -- routing / body errors ---------------------------------------------------


def test_unknown_route_is_404():
    resp = api.handler(make_event(path="/nope", body={"a": 1}))
    assert resp["statusCode"] == 404


def test_get_method_not_allowed():
    resp = api.handler(make_event(method="GET", path="/analyze", body=None))
    assert resp["statusCode"] == 405


def test_missing_body_is_400():
    resp = api.handler(make_event(body=None))
    assert resp["statusCode"] == 400


def test_invalid_json_body_is_400():
    resp = api.handler(make_event(body="{not json"))
    assert resp["statusCode"] == 400


def test_base64_encoded_body_is_decoded(stub_pipeline):
    payload = json.dumps({"inputType": "text", "text": "encoded"})
    encoded = base64.b64encode(payload.encode()).decode()
    resp = api.handler(make_event(body=encoded, is_b64=True))
    assert resp["statusCode"] == 200
    assert stub_pipeline["analyze_text"]["text"] == "encoded"


# -- domain error mapping ----------------------------------------------------


def test_scanned_document_maps_to_422(monkeypatch):
    from courselens.errors import ScannedDocumentError

    def boom(*args, **kwargs):
        raise ScannedDocumentError("looks scanned")

    monkeypatch.setattr(api.pipeline, "analyze_file", boom)
    content = base64.b64encode(b"data").decode()
    resp = api.handler(
        make_event(
            body={
                "inputType": "file",
                "fileName": "scan.pdf",
                "fileContentBase64": content,
            }
        )
    )
    assert resp["statusCode"] == 422
    assert _body(resp)["error"]["code"] == "scanned_document"


def test_bedrock_error_maps_to_502(monkeypatch):
    from courselens.errors import BedrockError

    def boom(*args, **kwargs):
        raise BedrockError("bedrock down")

    monkeypatch.setattr(api.pipeline, "analyze_text", boom)
    resp = api.handler(make_event(body={"inputType": "text", "text": "x"}))
    assert resp["statusCode"] == 502
    assert _body(resp)["error"]["code"] == "model_error"


def test_unsupported_file_type_maps_to_422(monkeypatch):
    from courselens.errors import UnsupportedFileTypeError

    def boom(*args, **kwargs):
        raise UnsupportedFileTypeError("no csv")

    monkeypatch.setattr(api.pipeline, "analyze_file", boom)
    content = base64.b64encode(b"data").decode()
    resp = api.handler(
        make_event(
            body={
                "inputType": "file",
                "fileName": "data.csv",
                "fileContentBase64": content,
            }
        )
    )
    assert resp["statusCode"] == 422
    assert _body(resp)["error"]["code"] == "unsupported_file_type"
