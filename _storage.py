"""Atomic JSON persistence for the plugin state file.

No SDK imports, so tests can load it directly. The file lives in the plugin's
SDK-assigned data directory (``self.data_path(...)``), never next to the code.
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any


class StateFile:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)

    def load(self) -> tuple[Any, str | None]:
        """Return ``(raw_data, warning)``.

        A missing file yields ``(None, None)``. An unreadable or corrupt file is
        moved aside (never deleted) so the user's data can be recovered, and a
        warning describing where it went is returned.
        """
        if not self.path.exists():
            return None, None
        try:
            with self.path.open("r", encoding="utf-8") as stream:
                return json.load(stream), None
        except (OSError, ValueError) as exc:
            quarantine = self.path.with_name(f"{self.path.stem}.corrupt-{int(time.time())}{self.path.suffix}")
            try:
                os.replace(self.path, quarantine)
                moved = str(quarantine)
            except OSError:
                moved = "(could not move)"
            return None, f"state file unreadable ({type(exc).__name__}); moved to {moved}"

    def save(self, data: Any) -> None:
        """Write atomically: temp file in the same directory, then replace."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        fd, tmp_name = tempfile.mkstemp(prefix=f".{self.path.name}.", suffix=".tmp", dir=str(self.path.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(tmp_name, self.path)
        except BaseException:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise
