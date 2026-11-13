"""Read-only queries against the local main_server.

Endpoints are GET and loopback-only:

* ``/api/characters``  -> character names + the current character
* ``/api/tools``       -> which LLM tools main_server currently holds per role
* ``/api/memory/recent_files`` and ``recent_file`` -> explicitly requested date preview

Blocking stdlib HTTP is used on purpose (no extra dependency); callers run it
through ``asyncio.to_thread``. Proxies are bypassed so a system proxy can never
intercept loopback traffic.
"""

from __future__ import annotations

import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from typing import Any

from . import _json as strict_json

_DEFAULT_PORT = 48911
_TIMEOUT_SECONDS = 3.0
_MAX_JSON_BYTES = 8 * 1024 * 1024


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
_port_cache: int | None = None


def main_server_port() -> int:
    """Resolve the main_server port from the environment.

    The launcher exports the port it actually chose (including fallback ports)
    as ``NEKO_MAIN_SERVER_PORT`` to every child process, so the plugin never
    needs to import host internals. ``MAIN_SERVER_PORT`` is the host's legacy
    compatibility name.
    """
    global _port_cache
    if _port_cache is not None:
        return _port_cache
    port = _DEFAULT_PORT
    for key in ("NEKO_MAIN_SERVER_PORT", "MAIN_SERVER_PORT"):
        raw = (os.getenv(key) or "").strip()
        if len(raw) <= 5 and raw.isascii() and raw.isdigit() and 1 <= int(raw) <= 65535:
            port = int(raw)
            break
    _port_cache = port
    return _port_cache


def _get_json(path: str, *, timeout: float = _TIMEOUT_SECONDS, max_bytes: int | None = None) -> Any | None:
    limit = _MAX_JSON_BYTES if max_bytes is None else min(max_bytes, _MAX_JSON_BYTES)
    url = f"http://127.0.0.1:{main_server_port()}{path}"
    # zh-CN skips the host's persona auto-translation on /api/characters.
    request = urllib.request.Request(url, headers={"Accept": "application/json", "Accept-Language": "zh-CN"})
    try:
        with _OPENER.open(request, timeout=timeout) as response:
            if response.status >= 400:
                return None
            raw = response.read(limit + 1)
            if len(raw) > limit:
                return None
            return strict_json.loads(raw.decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError, RecursionError):
        return None


def fetch_characters() -> tuple[list[str], str | None] | None:
    """Return ``(names, current)`` or ``None`` when main_server is unreachable."""
    data = _get_json("/api/characters")
    if not isinstance(data, dict):
        return None
    catgirls = data.get("猫娘")
    names = (
        [str(name) for name in catgirls.keys() if isinstance(name, str) and name] if isinstance(catgirls, dict) else []
    )
    current = data.get("当前猫娘")
    current = current if isinstance(current, str) and current in names else (names[0] if len(names) == 1 else None)
    return names, current


def fetch_tools_by_role() -> dict[str, set[str]] | None:
    """Return ``{role: {tool names}}`` or ``None`` when unreachable."""
    data = _get_json("/api/tools")
    if not isinstance(data, dict) or not isinstance(data.get("tools_by_role"), dict):
        return None
    out: dict[str, set[str]] = {}
    for role, tools in data["tools_by_role"].items():
        if isinstance(tools, list):
            out[str(role)] = {str(t.get("name")) for t in tools if isinstance(t, dict) and t.get("name")}
    return out


def fetch_recent_chat(character: str) -> list[Any]:
    """Read a bounded snapshot through the host API, including on older hosts."""
    if not character or any(part in character for part in ("/", "\\", "..")):
        raise HistoryError("host_history_unavailable")
    payload = _get_json(
        "/api/memory/recent_file?" + urllib.parse.urlencode({"filename": f"recent_{character}.json"}),
        timeout=2.0, max_bytes=8 * 1024 * 1024,
    )
    if not isinstance(payload, dict) or not isinstance(payload.get("content"), str):
        raise HistoryError("host_history_unavailable")
    try:
        rows = strict_json.loads(payload["content"])
    except (ValueError, RecursionError) as exc:
        raise HistoryError("host_history_unavailable") from exc
    if not isinstance(rows, list):
        raise HistoryError("host_history_unavailable")
    return rows[-512:]


class HistoryError(ValueError):
    """Fixed UI error codes; never include chat text or response bodies."""


def earliest_chat_date(rows: Any, now: float | None = None) -> str | None:
    """Use user timestamps or host-stamped replies paired with a real user turn."""
    if not isinstance(rows, list):
        raise HistoryError("host_history_unavailable")
    current = time.time() if now is None else now
    dates: list[str] = []
    pending_user = False
    for row in rows:
        if not isinstance(row, dict):
            continue
        kind = row.get("type", row.get("role"))
        if kind not in ("human", "user", "ai", "assistant"):
            pending_user = False
            continue
        data = row.get("data", row)
        if not isinstance(data, dict):
            continue
        metadata = row.get("metadata")
        metadata = metadata if isinstance(metadata, dict) else data.get("metadata")
        metadata = metadata if isinstance(metadata, dict) else {}
        sources = metadata.get("sources", [])
        sources = sources if isinstance(sources, list) else [sources]
        if (
            metadata.get("source") in ("theater_numeric_v2", "avatar-drop", "tool", "agent")
            or "avatar-drop" in sources
            or metadata.get("event_type") in (
                "gift_received", "relationship_context", "proactive_confession", "experience_note",
            )
            or metadata.get("turn_type") in ("proactive_reply", "proactive_instruction")
        ):
            pending_user = False
            continue
        content = data.get("content")
        if isinstance(content, list):
            content = "".join(block.get("text", "") for block in content
                              if isinstance(block, dict) and isinstance(block.get("text"), str))
        if not isinstance(content, str) or not content.strip():
            continue
        proof = metadata.get("chat_original_source")
        proof = proof if isinstance(proof, dict) else {}
        if kind in ("human", "user"):
            pending_user = True
        elif not pending_user or proof.get("origin") in ("tool", "agent"):
            pending_user = False
            continue
        else:
            pending_user = False
        stamp = metadata.get("recent_memory_time", proof.get("originalTime"))
        try:
            if isinstance(stamp, str) and re.fullmatch(r"[0-9]{1,16}", stamp):
                seconds = int(stamp) / 1000
            elif stamp is None and kind in ("ai", "assistant"):
                # cross_server prefixes legacy replies with local time before
                # appending model output. Never parse a user-authored date.
                match = re.match(r"^\[([0-9]{8}) [^\]\s]+ ([0-9]{2}:[0-9]{2})\] ?", content)
                if not match:
                    continue
                seconds = datetime.strptime(f"{match[1]} {match[2]}", "%Y%m%d %H:%M").timestamp()
            else:
                continue
            if not 0 < seconds <= current:
                continue
            day = datetime.fromtimestamp(seconds).date()
        except (OverflowError, OSError, ValueError):
            continue
        if day >= date(1970, 1, 1):
            dates.append(day.isoformat())
    return min(dates) if dates else None


def fetch_first_met(character: str | None = None) -> dict[str, Any]:
    """Preview the earliest accessible chat day without modifying host or plugin data."""
    listing = _get_json("/api/memory/recent_files", max_bytes=256 * 1024)
    if not isinstance(listing, dict) or not isinstance(listing.get("files"), list):
        raise HistoryError("host_history_unavailable")
    names: dict[str, str] = {}
    for filename in listing["files"]:
        if not isinstance(filename, str) or any(part in filename for part in ("/", "\\", "..")):
            continue
        match = re.fullmatch(r"recent_(.+)\.json", filename)
        if match and (character is None or match[1] == character):
            names[filename] = match[1]
    if not names:
        raise HistoryError("host_history_empty")
    if len(names) > 64:
        raise HistoryError("host_history_incomplete")
    deadline = time.monotonic() + 5.0
    now = time.time()

    def read(item: tuple[str, str]) -> tuple[str, str | None, bool]:
        filename, name = item
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return name, None, False
        payload = _get_json(
            "/api/memory/recent_file?" + urllib.parse.urlencode({"filename": filename}),
            timeout=min(2.0, remaining), max_bytes=8 * 1024 * 1024,
        )
        if not isinstance(payload, dict) or not isinstance(payload.get("content"), str):
            return name, None, False
        try:
            return name, earliest_chat_date(strict_json.loads(payload["content"]), now), True
        except (ValueError, TypeError, RecursionError):
            return name, None, False

    with ThreadPoolExecutor(max_workers=4, thread_name_prefix="love-history") as pool:
        results = list(pool.map(read, sorted(names.items())))
    if any(not complete for _name, _day, complete in results):
        raise HistoryError("host_history_incomplete")
    candidates = sorted((day, name) for name, day, _complete in results if day)
    if not candidates:
        raise HistoryError("host_history_empty")
    day, name = candidates[0]
    return {"date": day, "character": name, "source": "host_recent_history", "scanned_roles": len(names)}
