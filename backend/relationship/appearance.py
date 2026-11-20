"""Global visual preferences, persisted independently from relationship data."""

from __future__ import annotations

import re
import threading
from typing import Any

DEFAULTS = {"accent_color": "#7db9e8", "color_scheme": "system"}
_COLOR = re.compile(r"#[0-9a-fA-F]{6}\Z")
_SCHEMES = ("system", "light", "dark")


class AppearanceError(ValueError):
    pass


class AppearancePrefs:
    def __init__(self, store: Any) -> None:
        self._store = store
        self._lock = threading.RLock()
        raw, self.warning = store.load()
        raw = raw if isinstance(raw, dict) else {}
        color = raw.get("accent_color")
        scheme = raw.get("color_scheme")
        self._prefs = {
            "accent_color": color.lower() if isinstance(color, str) and _COLOR.fullmatch(color) else DEFAULTS["accent_color"],
            "color_scheme": scheme if isinstance(scheme, str) and scheme in _SCHEMES else DEFAULTS["color_scheme"],
        }

    def summary(self) -> dict[str, str]:
        with self._lock:
            return dict(self._prefs)

    def update(self, accent_color: Any, color_scheme: Any) -> dict[str, str]:
        if (
            not isinstance(accent_color, str) or not _COLOR.fullmatch(accent_color)
            or not isinstance(color_scheme, str) or color_scheme not in _SCHEMES
        ):
            raise AppearanceError("appearance_invalid_settings")
        next_prefs = {"accent_color": accent_color.lower(), "color_scheme": color_scheme}
        with self._lock:
            if next_prefs != self._prefs:
                # Publish only after the atomic write succeeds.
                self._store.save(next_prefs)
                self._prefs = next_prefs
            return dict(self._prefs)
