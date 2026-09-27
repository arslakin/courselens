"""Helpers for coaxing valid JSON out of model output.

Even with a strict "JSON only" instruction, models occasionally wrap output in
markdown fences or add stray text. These helpers recover the JSON object
before parsing, so a cosmetic formatting slip doesn't fail the whole request.
"""

from __future__ import annotations

import json
import re
from typing import Any

from .errors import ModelOutputError

_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


def parse_json_object(raw: str) -> dict[str, Any]:
    """Parse a JSON object out of raw model text.

    Tries, in order:
    1. direct ``json.loads``;
    2. stripping a surrounding ```json ... ``` fence;
    3. extracting the substring from the first ``{`` to the last ``}``.

    Raises:
        ModelOutputError: if no valid JSON object can be parsed.
    """
    candidates: list[str] = []

    stripped = raw.strip()
    candidates.append(stripped)

    # Remove markdown code fences if present.
    unfenced = _FENCE_RE.sub("", stripped).strip()
    if unfenced != stripped:
        candidates.append(unfenced)

    # Fall back to the outermost braces.
    first = stripped.find("{")
    last = stripped.rfind("}")
    if first != -1 and last != -1 and last > first:
        candidates.append(stripped[first : last + 1])

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed

    raise ModelOutputError(
        f"Could not parse a JSON object from model output: {raw[:300]!r}"
    )
