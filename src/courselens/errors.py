"""Domain-specific exceptions for CourseLens.

Using narrow exception types lets the API layer map failures to clear,
user-facing messages (and appropriate HTTP status codes later) instead of
leaking raw stack traces.
"""

from __future__ import annotations


class CourseLensError(Exception):
    """Base class for all CourseLens errors."""


class ExtractionError(CourseLensError):
    """Raised when text could not be extracted from an input."""


class UnsupportedFileTypeError(ExtractionError):
    """Raised when the uploaded file type is not supported in the MVP."""


class ScannedDocumentError(ExtractionError):
    """Raised when a document appears to be scanned/image-only.

    The document parsed successfully but yielded (almost) no extractable
    text, which usually means it is a scanned image. OCR is out of scope for
    the MVP, so we surface a friendly message rather than sending an empty
    prompt to the model.
    """


class EmptyInputError(ExtractionError):
    """Raised when the input contains no usable text at all."""


class BedrockError(CourseLensError):
    """Raised when a Bedrock call fails or returns an unusable response."""


class ModelOutputError(CourseLensError):
    """Raised when the model output cannot be parsed into the expected shape."""
