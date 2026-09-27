"""Tests for robust JSON parsing of model output."""

from __future__ import annotations

import pytest

from courselens.errors import ModelOutputError
from courselens.json_utils import parse_json_object


def test_parse_plain_json():
    assert parse_json_object('{"a": 1}') == {"a": 1}


def test_parse_json_with_code_fence():
    raw = '```json\n{"type": "assignment", "confidence": 0.9}\n```'
    assert parse_json_object(raw) == {"type": "assignment", "confidence": 0.9}


def test_parse_json_with_surrounding_prose():
    raw = 'Sure! Here is the result:\n{"summary": "hi"}\nHope that helps.'
    assert parse_json_object(raw) == {"summary": "hi"}


def test_parse_invalid_raises():
    with pytest.raises(ModelOutputError):
        parse_json_object("not json at all")


def test_parse_non_object_raises():
    with pytest.raises(ModelOutputError):
        parse_json_object("[1, 2, 3]")
