"""Atomic JSON persistence for the plugin state file.

No SDK imports, so tests can load it directly. The file lives in the plugin's
SDK-assigned data directory (``self.data_path(...)``), never next to the code.
"""

from __future__ import annotations

import json
import os
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

from . import _json as strict_json

MAX_STATE_BYTES = 32 * 1024 * 1024


class StateFile:
    def __init__(self, path: Path, *, max_bytes: int = MAX_STATE_BYTES) -> None:
        self.path = Path(path)
        self.max_bytes = max_bytes

    def load(self) -> tuple[Any, str | None]:
        """Return ``(raw_data, warning)``.

        A missing file yields ``(None, None)``. An unreadable or corrupt file is
        moved aside (never deleted) so the user's data can be recovered, and a
        warning describing where it went is returned.
        """
        if not self.path.exists():
            return None, None
        try:
            with self.path.open("rb") as stream:
                if os.fstat(stream.fileno()).st_size > self.max_bytes:
                    raise ValueError("state_too_large")
                payload = stream.read(self.max_bytes + 1)
            if len(payload) > self.max_bytes:
                raise ValueError("state_too_large")
            return strict_json.loads(payload.decode("utf-8")), None
        except (OSError, ValueError, RecursionError) as exc:
            quarantine = self.path.with_name(
                f"{self.path.stem}.corrupt-{int(time.time())}-{uuid.uuid4().hex}{self.path.suffix}"
            )
            try:
                os.replace(self.path, quarantine)
                moved = str(quarantine)
            except OSError:
                moved = "(could not move)"
            return None, f"state file unreadable ({type(exc).__name__}); moved to {moved}"

    def save(self, data: Any) -> None:
        """Write atomically: temp file in the same directory, then replace."""
        payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
        if len(payload) > self.max_bytes:
            raise ValueError("state_too_large")
        strict_json.validate_depth(data)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(prefix=f".{self.path.name}.", suffix=".tmp", dir=str(self.path.parent))
        try:
            with os.fdopen(fd, "wb") as stream:
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
