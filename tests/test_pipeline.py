"""Tests for the high-level pipeline entry points."""

from __future__ import annotations

import json

from courselens.analyzer import Analyzer
from courselens.pipeline import analyze_file, analyze_text, explain_further
from tests.conftest import make_runtime


def _lecture_responses():
    classification = json.dumps({"type": "reading", "confidence": 0.7})
    body = json.dumps(
        {"summary": "s", "keyConcepts": [], "difficultConcepts": [], "quiz": []}
    )
    return [classification, body]


def test_analyze_text_attaches_input_metadata():
    runtime, _ = make_runtime(_lecture_responses())
    result = analyze_text("Some reading passage.", analyzer=Analyzer(bedrock=runtime))
    assert result["documentType"] == "reading"
    assert result["input"]["source"] == "text"
    assert result["input"]["truncated"] is False


def test_analyze_file_txt():
    runtime, _ = make_runtime(_lecture_responses())
    data = b"A markdown reading.\nWith two lines."
    result = analyze_file(
        data, "reading.md", analyzer=Analyzer(bedrock=runtime)
    )
    assert result["input"]["source"] == "txt"


def test_explain_further_pipeline():
    runtime, _ = make_runtime([json.dumps({"explanation": "clear"})])
    result = explain_further(
        "context", "Osmosis", analyzer=Analyzer(bedrock=runtime)
    )
    assert result["explanation"] == "clear"
