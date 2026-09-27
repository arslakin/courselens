"""Text extraction for CourseLens inputs.

Turns each supported input (pasted text, TXT/Markdown, PDF, DOCX) into a
normalized plain-text string, applying the input-size and scanned-document
safeguards defined in config.py.

The heavy parsers (pypdf, python-docx) are imported lazily inside their
functions so that importing this module — and unit-testing the pasted-text and
safeguard paths — does not require those packages to be installed.
"""

from __future__ import annotations

import io
import os
from dataclasses import dataclass

from . import config
from .errors import (
    EmptyInputError,
    ExtractionError,
    ScannedDocumentError,
    UnsupportedFileTypeError,
)

# Extensions handled in the MVP.
_TEXT_EXTS = {".txt", ".md", ".markdown", ".text"}
_PDF_EXTS = {".pdf"}
_DOCX_EXTS = {".docx"}
SUPPORTED_EXTENSIONS = _TEXT_EXTS | _PDF_EXTS | _DOCX_EXTS


@dataclass
class ExtractionResult:
    """Normalized extraction output."""

    text: str
    source: str  # "text" | "txt" | "pdf" | "docx"
    truncated: bool  # whether the text was cut to MAX_INPUT_CHARS
    original_chars: int  # length before truncation


def extract_from_text(text: str) -> ExtractionResult:
    """Handle pasted text."""
    return _finalize(text, source="text")


def extract_from_file(data: bytes, filename: str) -> ExtractionResult:
    """Dispatch to the right extractor based on the file extension.

    Args:
        data: raw file bytes.
        filename: original file name (used only for its extension).

    Raises:
        UnsupportedFileTypeError: extension not supported in the MVP.
        ScannedDocumentError: parsed but effectively no text (likely scanned).
        EmptyInputError: no usable text at all.
        ExtractionError: the file could not be parsed.
    """
    ext = os.path.splitext(filename)[1].lower()

    if ext in _TEXT_EXTS:
        source, raw = "txt", _extract_txt(data)
    elif ext in _PDF_EXTS:
        source, raw = "pdf", _extract_pdf(data)
    elif ext in _DOCX_EXTS:
        source, raw = "docx", _extract_docx(data)
    else:
        raise UnsupportedFileTypeError(
            f"Unsupported file type '{ext or '(none)'}'. Supported: "
            f"{', '.join(sorted(SUPPORTED_EXTENSIONS))}, or paste text directly."
        )

    # A PDF/DOCX that parsed but returned almost nothing is most likely a
    # scanned/image document. OCR is out of scope for the MVP.
    if source in {"pdf", "docx"} and len(raw.strip()) < config.MIN_EXTRACTED_CHARS:
        raise ScannedDocumentError(
            "This document appears to be scanned or image-only, so no text "
            "could be extracted. OCR isn't supported yet — please paste the "
            "text directly or upload a text-based document."
        )

    return _finalize(raw, source=source)


# -- format-specific extractors ---------------------------------------------


def _extract_txt(data: bytes) -> str:
    # Try utf-8-sig first so a byte-order mark is stripped rather than left
    # as a stray character at the start of the text.
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    # Last resort: decode with replacement so we never hard-fail on encoding.
    return data.decode("utf-8", errors="replace")


def _extract_pdf(data: bytes) -> str:
    try:
        from pypdf import PdfReader  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover - env-dependent
        raise ExtractionError(
            "PDF support requires the 'pypdf' package."
        ) from exc

    try:
        reader = PdfReader(io.BytesIO(data))
        parts = [page.extract_text() or "" for page in reader.pages]
    except Exception as exc:
        raise ExtractionError(f"Could not read PDF: {exc}") from exc

    return "\n".join(parts)


def _extract_docx(data: bytes) -> str:
    try:
        import docx  # noqa: PLC0415  (python-docx)
    except ImportError as exc:  # pragma: no cover - env-dependent
        raise ExtractionError(
            "DOCX support requires the 'python-docx' package."
        ) from exc

    try:
        document = docx.Document(io.BytesIO(data))
        parts = [p.text for p in document.paragraphs]
        # Include table cell text, which python-docx keeps separate.
        for table in document.tables:
            for row in table.rows:
                for cell in row.cells:
                    if cell.text:
                        parts.append(cell.text)
    except Exception as exc:
        raise ExtractionError(f"Could not read DOCX: {exc}") from exc

    return "\n".join(parts)


# -- shared finalization -----------------------------------------------------


def _finalize(raw: str, *, source: str) -> ExtractionResult:
    """Normalize whitespace, enforce non-empty, and apply the size cap."""
    normalized = (raw or "").replace("\r\n", "\n").replace("\r", "\n").strip()

    if not normalized:
        raise EmptyInputError(
            "No text was found in the input. Please paste text or upload a "
            "document that contains text."
        )

    original_chars = len(normalized)
    truncated = original_chars > config.MAX_INPUT_CHARS
    if truncated:
        normalized = normalized[: config.MAX_INPUT_CHARS]

    return ExtractionResult(
        text=normalized,
        source=source,
        truncated=truncated,
        original_chars=original_chars,
    )
