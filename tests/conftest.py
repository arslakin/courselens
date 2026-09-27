"""Shared test fixtures and a fake Bedrock client.

The fake client lets us exercise the full AI loop deterministically without
network access or AWS credentials. It records every Converse request so tests
can assert on prompts and the guardrail system message.
"""

from __future__ import annotations

import os
import sys
from typing import Any

import pytest

# Make the src/ layout importable without installing the package.
_SRC = os.path.join(os.path.dirname(__file__), "..", "src")
if _SRC not in sys.path:
    sys.path.insert(0, os.path.abspath(_SRC))

from courselens.bedrock_client import BedrockRuntime  # noqa: E402


class FakeBedrockClient:
    """Stands in for a boto3 bedrock-runtime client.

    Returns queued responses in order. Each queued item is the raw text the
    model would return; it is wrapped in a realistic Converse response shape.
    """

    def __init__(self, responses: list[str]) -> None:
        self._responses = list(responses)
        self.requests: list[dict[str, Any]] = []

    def converse(self, **kwargs: Any) -> dict[str, Any]:
        self.requests.append(kwargs)
        if not self._responses:
            raise AssertionError("FakeBedrockClient ran out of queued responses")
        text = self._responses.pop(0)
        return {
            "output": {"message": {"role": "assistant", "content": [{"text": text}]}},
            "usage": {"inputTokens": 10, "outputTokens": 20, "totalTokens": 30},
            "stopReason": "end_turn",
        }


def make_runtime(responses: list[str]) -> tuple[BedrockRuntime, FakeBedrockClient]:
    """Build a BedrockRuntime backed by a FakeBedrockClient."""
    fake = FakeBedrockClient(responses)
    runtime = BedrockRuntime(client=fake, model_id="amazon.nova-lite-v1:0")
    return runtime, fake


@pytest.fixture
def make_runtime_fixture():
    return make_runtime
