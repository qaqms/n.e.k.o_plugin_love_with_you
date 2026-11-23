"""Locate the read-only N.E.K.O host checkout next to the plugin.

Order: the ``NEKO_HOST_ROOT`` environment variable, then a sibling folder named
``N.E.K.O`` or ``N.E.K.O-main`` (a GitHub zip download). The host is only read.
"""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SIBLING_NAMES = ("N.E.K.O", "N.E.K.O-main")


def default_host() -> Path:
    configured = os.environ.get("NEKO_HOST_ROOT")
    if configured:
        return Path(configured)
    for name in SIBLING_NAMES:
        candidate = ROOT.parent / name
        if (candidate / "plugin").is_dir():
            return candidate
    return ROOT.parent / SIBLING_NAMES[0]
