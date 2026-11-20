"""Strict JSON decoding shared by disk and loopback boundaries."""

from __future__ import annotations

import json
import math
from typing import Any

MAX_DEPTH = 64


def _object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate_json_key")
        result[key] = value
    return result


def _constant(_value: str) -> Any:
    raise ValueError("nonfinite_json_value")


def _float(value: str) -> float:
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("nonfinite_json_value")
    return result


def validate_depth(result: Any) -> None:
    pending = [(result, 0)]
    while pending:
        item, depth = pending.pop()
        if depth > MAX_DEPTH:
            raise ValueError("json_too_deep")
        children = item.values() if isinstance(item, dict) else item if isinstance(item, (list, tuple)) else ()
        pending.extend((child, depth + 1) for child in children if isinstance(child, (dict, list, tuple)))


def loads(raw: str | bytes) -> Any:
    result = json.loads(raw, object_pairs_hook=_object, parse_constant=_constant, parse_float=_float)
    validate_depth(result)
    return result
