"""Core AI loop for CourseLens.

Given already-extracted text, this module:
- classifies the document type;
- runs the matching workflow (assignment vs lecture/reading);
- supports on-demand "explain further" for a single step or concept.

All model calls go through the injected ``BedrockRuntime`` so the whole loop
is testable with a fake client. Every call requests strict JSON and retries
once with a corrective nudge if the first response won't parse.
"""

from __future__ import annotations

from typing import Any, Optional

from . import prompts
from .bedrock_client import BedrockRuntime
from .errors import ModelOutputError
from .json_utils import parse_json_object

# Types that use the lecture/reading workflow. Everything classified as an
# assignment uses the assignment workflow; all remaining types fall back to
# the lecture/reading workflow for the MVP (syllabus/rubric/dataset/other get a
# generic study-style analysis until their dedicated workflows are built).
_LECTURE_LIKE = {"lecture_notes", "reading", "syllabus", "rubric", "dataset", "other"}

_RETRY_NUDGE = "\n\nIMPORTANT: Your previous reply was not valid JSON. Respond with valid JSON only."


class Analyzer:
    """Orchestrates classification, analysis, and explanation."""

    def __init__(self, bedrock: Optional[BedrockRuntime] = None) -> None:
        self._bedrock = bedrock or BedrockRuntime()

    # -- public API ---------------------------------------------------------

    def classify(self, text: str) -> dict[str, Any]:
        """Return {"type": <DocumentType>, "confidence": float}."""
        result = self._json_call(prompts.classification_prompt(text))
        doc_type = str(result.get("type", "other")).strip().lower()
        if doc_type not in prompts.DOCUMENT_TYPES:
            doc_type = "other"
        try:
            confidence = float(result.get("confidence", 0.0))
        except (TypeError, ValueError):
            confidence = 0.0
        return {"type": doc_type, "confidence": confidence}

    def analyze(
        self, text: str, doc_type: Optional[str] = None
    ) -> dict[str, Any]:
        """Classify (unless overridden) and run the matching workflow.

        Returns a dict with ``documentType`` plus the workflow-specific fields,
        and a ``usage`` field with cumulative token counts.
        """
        usage_total = {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0}

        if doc_type is None:
            classification = self._json_call(
                prompts.classification_prompt(text), usage_acc=usage_total
            )
            resolved = str(classification.get("type", "other")).strip().lower()
            if resolved not in prompts.DOCUMENT_TYPES:
                resolved = "other"
        else:
            resolved = doc_type.strip().lower()
            if resolved not in prompts.DOCUMENT_TYPES:
                resolved = "other"

        if resolved == "assignment":
            body = self._json_call(
                prompts.assignment_prompt(text), usage_acc=usage_total
            )
            result = self._normalize_assignment(body)
        else:
            body = self._json_call(
                prompts.lecture_prompt(text, resolved), usage_acc=usage_total
            )
            result = self._normalize_lecture(body, resolved)

        result["documentType"] = resolved
        result["usage"] = usage_total
        return result

    def explain(self, context: str, target: str) -> dict[str, Any]:
        """Explain a single step/concept further."""
        body = self._json_call(prompts.explain_prompt(context, target))
        return {"explanation": str(body.get("explanation", "")).strip()}

    # -- internals ----------------------------------------------------------

    def _json_call(
        self,
        prompt: str,
        *,
        usage_acc: Optional[dict[str, int]] = None,
    ) -> dict[str, Any]:
        """Run a Converse call expecting JSON, retrying once on parse failure."""
        result = self._bedrock.converse_text(
            prompt, system=prompts.GUARDRAIL_SYSTEM
        )
        self._accumulate(usage_acc, result)
        try:
            return parse_json_object(result.text)
        except ModelOutputError:
            # One corrective retry.
            retry = self._bedrock.converse_text(
                prompt + _RETRY_NUDGE, system=prompts.GUARDRAIL_SYSTEM
            )
            self._accumulate(usage_acc, retry)
            return parse_json_object(retry.text)

    @staticmethod
    def _accumulate(acc: Optional[dict[str, int]], result: Any) -> None:
        if acc is None:
            return
        acc["inputTokens"] += result.input_tokens
        acc["outputTokens"] += result.output_tokens
        acc["totalTokens"] += result.total_tokens

    # -- normalization: guarantee stable shapes for the frontend ------------

    @staticmethod
    def _str_list(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [str(item).strip() for item in value if str(item).strip()]

    def _normalize_assignment(self, body: dict[str, Any]) -> dict[str, Any]:
        raw_plan = body.get("actionPlan", [])
        action_plan: list[dict[str, Any]] = []
        if isinstance(raw_plan, list):
            for idx, step in enumerate(raw_plan, start=1):
                if not isinstance(step, dict):
                    continue
                action_plan.append(
                    {
                        "step": int(step.get("step", idx) or idx),
                        "title": str(step.get("title", "")).strip(),
                        "detail": str(step.get("detail", "")).strip(),
                    }
                )

        raw_concepts = body.get("concepts", [])
        concepts: list[dict[str, str]] = []
        if isinstance(raw_concepts, list):
            for c in raw_concepts:
                if not isinstance(c, dict):
                    continue
                concepts.append(
                    {
                        "name": str(c.get("name", "")).strip(),
                        "whyItMatters": str(c.get("whyItMatters", "")).strip(),
                    }
                )

        return {
            "explanation": str(body.get("explanation", "")).strip(),
            "requirements": self._str_list(body.get("requirements")),
            "deliverables": self._str_list(body.get("deliverables")),
            "deadlines": self._str_list(body.get("deadlines")),
            "constraints": self._str_list(body.get("constraints")),
            "actionPlan": action_plan,
            "concepts": concepts,
        }

    def _normalize_lecture(
        self, body: dict[str, Any], doc_type: str
    ) -> dict[str, Any]:
        def concept_list(key: str) -> list[dict[str, str]]:
            raw = body.get(key, [])
            out: list[dict[str, str]] = []
            if isinstance(raw, list):
                for c in raw:
                    if not isinstance(c, dict):
                        continue
                    out.append(
                        {
                            "name": str(c.get("name", "")).strip(),
                            "explanation": str(c.get("explanation", "")).strip(),
                        }
                    )
            return out

        raw_quiz = body.get("quiz", [])
        quiz: list[dict[str, str]] = []
        if isinstance(raw_quiz, list):
            for q in raw_quiz:
                if not isinstance(q, dict):
                    continue
                quiz.append(
                    {
                        "question": str(q.get("question", "")).strip(),
                        "answer": str(q.get("answer", "")).strip(),
                    }
                )

        return {
            "summary": str(body.get("summary", "")).strip(),
            "keyConcepts": concept_list("keyConcepts"),
            "difficultConcepts": concept_list("difficultConcepts"),
            "quiz": quiz,
        }
