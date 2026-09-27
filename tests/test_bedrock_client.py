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
