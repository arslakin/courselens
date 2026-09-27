"""Thin wrapper around the Amazon Bedrock Converse API.

Keeping all Bedrock interaction in one small module means:
- the rest of the code depends on a simple ``converse_text`` function, not on
  boto3 request/response shapes;
- tests can inject a fake client and never touch the network or AWS.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from . import config
from .errors import BedrockError


@dataclass
class ConverseResult:
    """Normalized result of a Converse call."""

    text: str
    input_tokens: int
    output_tokens: int
    total_tokens: int

    @property
    def usage(self) -> dict[str, int]:
        return {
            "inputTokens": self.input_tokens,
            "outputTokens": self.output_tokens,
            "totalTokens": self.total_tokens,
        }


class BedrockRuntime:
    """Wraps a boto3 ``bedrock-runtime`` client and the Converse call.

    The underlying boto3 client is created lazily so importing this module
    (and running unit tests) never requires AWS credentials. Tests can pass
    their own client via the ``client`` argument.
    """

    def __init__(
        self,
        client: Optional[Any] = None,
        model_id: Optional[str] = None,
        region: Optional[str] = None,
    ) -> None:
        self._client = client
        self._model_id = model_id or config.BEDROCK_MODEL_ID
        self._region = region or config.AWS_REGION

    @property
    def model_id(self) -> str:
        return self._model_id

    def _get_client(self) -> Any:
        if self._client is None:
            # Imported lazily so unit tests don't require boto3/credentials.
            import boto3  # noqa: PLC0415

            self._client = boto3.client("bedrock-runtime", region_name=self._region)
        return self._client

    def converse_text(
        self,
        prompt: str,
        *,
        system: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> ConverseResult:
        """Send a single-turn user prompt and return the model's text reply.

        Raises:
            BedrockError: if the call fails or returns an unexpected shape.
        """
        client = self._get_client()

        kwargs: dict[str, Any] = {
            "modelId": self._model_id,
            "messages": [{"role": "user", "content": [{"text": prompt}]}],
            "inferenceConfig": {
                "maxTokens": max_tokens or config.MAX_TOKENS,
                "temperature": (
                    temperature if temperature is not None else config.TEMPERATURE
                ),
            },
        }
        if system:
            kwargs["system"] = [{"text": system}]

        try:
            response = client.converse(**kwargs)
        except Exception as exc:  # boto3 raises many client-specific types
            raise BedrockError(f"Bedrock Converse call failed: {exc}") from exc

        return self._parse_response(response)

    @staticmethod
    def _parse_response(response: dict[str, Any]) -> ConverseResult:
        try:
            content = response["output"]["message"]["content"]
            text = "".join(
                block.get("text", "") for block in content if "text" in block
            ).strip()
            usage = response.get("usage", {})
        except (KeyError, TypeError) as exc:
            raise BedrockError(
                f"Unexpected Bedrock response shape: {response!r}"
            ) from exc

        if not text:
            raise BedrockError("Bedrock returned an empty response.")

        return ConverseResult(
            text=text,
            input_tokens=int(usage.get("inputTokens", 0)),
            output_tokens=int(usage.get("outputTokens", 0)),
            total_tokens=int(usage.get("totalTokens", 0)),
        )
