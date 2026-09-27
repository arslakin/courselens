"""Tests for the core AI loop (classification, workflows, explain, guardrails)."""

from __future__ import annotations

import json

from courselens import prompts
from courselens.analyzer import Analyzer
from tests.conftest import make_runtime


def test_classify_valid_type():
    runtime, _ = make_runtime([json.dumps({"type": "assignment", "confidence": 0.92})])
    analyzer = Analyzer(bedrock=runtime)
    result = analyzer.classify("Write a 5-page essay on photosynthesis.")
    assert result["type"] == "assignment"
    assert result["confidence"] == 0.92


def test_classify_unknown_type_falls_back_to_other():
    runtime, _ = make_runtime([json.dumps({"type": "banana", "confidence": 0.5})])
    analyzer = Analyzer(bedrock=runtime)
    assert analyzer.classify("???")["type"] == "other"


def test_analyze_assignment_workflow():
    classification = json.dumps({"type": "assignment", "confidence": 0.9})
    body = json.dumps(
        {
            "explanation": "Write an essay about photosynthesis.",
            "requirements": ["5 pages", "cite 3 sources"],
            "deliverables": ["essay.pdf"],
            "deadlines": ["Friday"],
            "constraints": ["APA format"],
            "actionPlan": [
                {"step": 1, "title": "Research", "detail": "Read sources."},
                {"step": 2, "title": "Outline", "detail": "Draft an outline."},
            ],
            "concepts": [
                {"name": "Photosynthesis", "whyItMatters": "Core topic."}
            ],
        }
    )
    runtime, fake = make_runtime([classification, body])
    analyzer = Analyzer(bedrock=runtime)

    result = analyzer.analyze("Write a 5-page essay on photosynthesis.")

    assert result["documentType"] == "assignment"
    assert result["requirements"] == ["5 pages", "cite 3 sources"]
    assert result["actionPlan"][0]["step"] == 1
    assert result["actionPlan"][1]["title"] == "Outline"
    assert result["concepts"][0]["name"] == "Photosynthesis"
    # Usage accumulates across the two calls (classify + analyze).
    assert result["usage"]["totalTokens"] == 60


def test_analyze_lecture_workflow():
    classification = json.dumps({"type": "lecture_notes", "confidence": 0.8})
    body = json.dumps(
        {
            "summary": "Overview of cell biology.",
            "keyConcepts": [{"name": "Cell", "explanation": "Basic unit."}],
            "difficultConcepts": [
                {"name": "Osmosis", "explanation": "Water movement."}
            ],
            "quiz": [
                {"question": f"Q{i}", "answer": f"A{i}"} for i in range(1, 6)
            ],
        }
    )
    runtime, _ = make_runtime([classification, body])
    analyzer = Analyzer(bedrock=runtime)

    result = analyzer.analyze("Cell biology notes ...")

    assert result["documentType"] == "lecture_notes"
    assert result["summary"].startswith("Overview")
    assert len(result["quiz"]) == 5


def test_analyze_with_override_skips_classification():
    # Only one queued response: the assignment body. If classification were
    # called, the fake would run out of responses and error.
    body = json.dumps(
        {
            "explanation": "x",
            "requirements": [],
            "deliverables": [],
            "deadlines": [],
            "constraints": [],
            "actionPlan": [],
            "concepts": [],
        }
    )
    runtime, fake = make_runtime([body])
    analyzer = Analyzer(bedrock=runtime)

    result = analyzer.analyze("some text", doc_type="assignment")
    assert result["documentType"] == "assignment"
    assert len(fake.requests) == 1  # no classification call


def test_syllabus_falls_back_to_lecture_workflow():
    body = json.dumps(
        {"summary": "s", "keyConcepts": [], "difficultConcepts": [], "quiz": []}
    )
    runtime, _ = make_runtime([body])
    analyzer = Analyzer(bedrock=runtime)
    result = analyzer.analyze("course policies", doc_type="syllabus")
    # Uses lecture workflow shape but keeps the syllabus label.
    assert result["documentType"] == "syllabus"
    assert "summary" in result


def test_retry_on_bad_json():
    classification = json.dumps({"type": "assignment", "confidence": 0.9})
    bad = "here is your answer, not json"
    good = json.dumps(
        {
            "explanation": "ok",
            "requirements": [],
            "deliverables": [],
            "deadlines": [],
            "constraints": [],
            "actionPlan": [],
            "concepts": [],
        }
    )
    runtime, fake = make_runtime([classification, bad, good])
    analyzer = Analyzer(bedrock=runtime)

    result = analyzer.analyze("Write an essay.")
    assert result["explanation"] == "ok"
    # 3 calls total: classify, bad analyze, retried analyze.
    assert len(fake.requests) == 3


def test_explain_further():
    runtime, _ = make_runtime([json.dumps({"explanation": "Plain explanation."})])
    analyzer = Analyzer(bedrock=runtime)
    result = analyzer.explain("context text", "Photosynthesis")
    assert result["explanation"] == "Plain explanation."


def test_guardrail_system_message_is_sent():
    runtime, fake = make_runtime([json.dumps({"type": "other", "confidence": 0.1})])
    analyzer = Analyzer(bedrock=runtime)
    analyzer.classify("random")
    # The guardrail system prompt must accompany the call.
    assert fake.requests[0]["system"] == [{"text": prompts.GUARDRAIL_SYSTEM}]


def test_guardrail_text_forbids_doing_the_work():
    # The product-critical guardrail must be explicit about not completing work.
    text = prompts.GUARDRAIL_SYSTEM.lower()
    assert "never" in text or "not" in text
    assert "essay" in text
    assert "guide" in text


def test_malformed_action_plan_is_normalized():
    classification = json.dumps({"type": "assignment", "confidence": 0.9})
    body = json.dumps(
        {
            "explanation": "x",
            "requirements": "not a list",  # wrong type -> becomes []
            "deliverables": [],
            "deadlines": [],
            "constraints": [],
            "actionPlan": ["not a dict", {"title": "Do it", "detail": "d"}],
            "concepts": [{"name": "C"}],
        }
    )
    runtime, _ = make_runtime([classification, body])
    analyzer = Analyzer(bedrock=runtime)

    result = analyzer.analyze("Write an essay.")
    assert result["requirements"] == []  # coerced
    # Only the valid dict step survives; step number auto-assigned.
    assert len(result["actionPlan"]) == 1
    assert result["actionPlan"][0]["title"] == "Do it"
    assert result["concepts"][0]["whyItMatters"] == ""
