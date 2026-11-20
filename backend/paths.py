"""Resource locations shared by backend modules."""

from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
STATIC_ROOT = PLUGIN_ROOT / "static"
