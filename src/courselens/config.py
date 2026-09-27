"""Central configuration for CourseLens.

All tunable knobs live here so they can be changed in one place during the
hackathon (for example switching the model from Nova Lite to Nova Pro).
Values can be overridden via environment variables, which is how the Lambda
runtime will configure them later without code changes.
"""

from __future__ import annotations

import os

# --- AWS / Bedrock ----------------------------------------------------------

# Region where Bedrock is invoked. The account has Bedrock access in us-east-1.
AWS_REGION: str = os.environ.get("COURSELENS_AWS_REGION", "us-east-1")

# Model used for every Converse call. Kept as a single constant so upgrading
# from Nova Lite to Nova Pro is a one-line change (or an env override).
BEDROCK_MODEL_ID: str = os.environ.get(
    "COURSELENS_MODEL_ID", "amazon.nova-lite-v1:0"
)

# Inference defaults. Low temperature keeps classification and structured
# output stable and reproducible.
MAX_TOKENS: int = int(os.environ.get("COURSELENS_MAX_TOKENS", "2000"))
TEMPERATURE: float = float(os.environ.get("COURSELENS_TEMPERATURE", "0.2"))

# --- Input safeguards -------------------------------------------------------

# Hard cap on characters sent to the model. Protects against oversized inputs
# blowing the context window and cost. Roughly ~4 chars/token, so ~20k chars
# is a safe budget well under Nova Lite's context limit while leaving room for
# the prompt scaffolding and the model's response.
MAX_INPUT_CHARS: int = int(os.environ.get("COURSELENS_MAX_INPUT_CHARS", "20000"))

# If a PDF/DOCX yields fewer than this many characters of extractable text we
# treat it as effectively empty (likely a scanned/image document). Used to
# raise a friendly "OCR not supported yet" message instead of failing silently.
MIN_EXTRACTED_CHARS: int = int(
    os.environ.get("COURSELENS_MIN_EXTRACTED_CHARS", "20")
)
