"""Tests for the Bedrock Converse client wrapper."""

from __future__ import annotations

import pytest

from courselens.errors import BedrockError
from tests.conftest import make_runtime


def test_converse_text_parses_response_and_usage():
    runtime, fake = make_runtime(["hello world"])
    result = runtime.converse_text("hi", system="be nice")

    assert result.text == "hello world"
    assert result.input_tokens == 10
    assert result.output_tokens == 20
    assert result.total_tokens == 30
    assert result.usage == {
        "inputTokens": 10,
        "outputTokens": 20,
        "totalTokens": 30,
    }


def test_converse_passes_system_and_inference_config():
    runtime, fake = make_runtime(["ok"])
    runtime.converse_text("prompt text", system="SYSTEM MSG", temperature=0.0)

    req = fake.requests[0]
    assert req["modelId"] == "amazon.nova-lite-v1:0"
    assert req["system"] == [{"text": "SYSTEM MSG"}]
    assert req["messages"][0]["content"][0]["text"] == "prompt text"
    assert req["inferenceConfig"]["temperature"] == 0.0


def test_converse_empty_response_raises():
    runtime, _ = make_runtime([""])
    with pytest.raises(BedrockError):
        runtime.converse_text("hi")


def test_converse_client_error_wrapped():
    class Boom:
        def converse(self, **kwargs):
            raise RuntimeError("network down")

    from courselens.bedrock_client import BedrockRuntime

    runtime = BedrockRuntime(client=Boom())
    with pytest.raises(BedrockError):
        runtime.converse_text("hi")


def test_client_configures_bounded_retries(monkeypatch):
    """The real boto3 client must be created with bounded retries."""
    from courselens import bedrock_client, config

    captured = {}

    class FakeBoto:
        def client(self, name, region_name=None, config=None):
            captured["name"] = name
            captured["region"] = region_name
            captured["retries"] = config.retries if config else None

            class _C:
                def converse(self, **kwargs):
                    return {
                        "output": {"message": {"content": [{"text": "ok"}]}},
                        "usage": {"inputTokens": 1, "outputTokens": 1, "totalTokens": 2},
                    }

            return _C()

    # Inject a fake boto3 module.
    import sys
    import types

    fake_boto3 = types.ModuleType("boto3")
    fake_boto3.client = FakeBoto().client
    monkeypatch.setitem(sys.modules, "boto3", fake_boto3)

    rt = bedrock_client.BedrockRuntime()  # no injected client -> builds real one
    rt.converse_text("hi")

    assert captured["name"] == "bedrock-runtime"
    assert captured["retries"]["max_attempts"] == config.BEDROCK_MAX_ATTEMPTS
