"""High-level orchestration entry points for CourseLens.

These functions compose extraction + analysis into the two operations the API
will expose (analyze, explain). Keeping them here means the future Lambda
handler stays a thin adapter and the same logic can be exercised locally.
"""

from __future__ import annotations

from typing import Any, Optional

from .analyzer import Analyzer
from .extraction import (
    ExtractionResult,
    extract_from_file,
    extract_from_text,
)


def analyze_text(
    text: str,
    *,
    doc_type: Optional[str] = None,
    analyzer: Optional[Analyzer] = None,
) -> dict[str, Any]:
    """Analyze pasted text."""
    extraction = extract_from_text(text)
    return _run_analysis(extraction, doc_type=doc_type, analyzer=analyzer)


def analyze_file(
    data: bytes,
    filename: str,
    *,
    doc_type: Optional[str] = None,
    analyzer: Optional[Analyzer] = None,
) -> dict[str, Any]:
    """Analyze an uploaded file (PDF/DOCX/TXT/Markdown)."""
    extraction = extract_from_file(data, filename)
    return _run_analysis(extraction, doc_type=doc_type, analyzer=analyzer)


def explain_further(
    context: str, target: str, *, analyzer: Optional[Analyzer] = None
) -> dict[str, Any]:
    """Explain a single step/concept in more depth."""
    analyzer = analyzer or Analyzer()
    return analyzer.explain(context, target)


def _run_analysis(
    extraction: ExtractionResult,
    *,
    doc_type: Optional[str],
    analyzer: Optional[Analyzer],
) -> dict[str, Any]:
    analyzer = analyzer or Analyzer()
    result = analyzer.analyze(extraction.text, doc_type=doc_type)
    # Attach extraction metadata so the UI can, e.g., warn about truncation.
    result["input"] = {
        "source": extraction.source,
        "truncated": extraction.truncated,
        "originalChars": extraction.original_chars,
    }
    return result
