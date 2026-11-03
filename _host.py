"""Read-only queries against the local main_server.

Only two endpoints are used, both GET and loopback-only:

* ``/api/characters``  -> character names + the current character
* ``/api/tools``       -> which LLM tools main_server currently holds per role

Blocking stdlib HTTP is used on purpose (no extra dependency); callers run it
through ``asyncio.to_thread``. Proxies are bypassed so a system proxy can never
intercept loopback traffic.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

_DEFAULT_PORT = 48911
_TIMEOUT_SECONDS = 3.0
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
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
        if raw.isdigit() and 1 <= int(raw) <= 65535:
            port = int(raw)
            break
    _port_cache = port
    return _port_cache


def _get_json(path: str) -> Any | None:
    url = f"http://127.0.0.1:{main_server_port()}{path}"
    # zh-CN skips the host's persona auto-translation on /api/characters.
    request = urllib.request.Request(url, headers={"Accept": "application/json", "Accept-Language": "zh-CN"})
    try:
        with _OPENER.open(request, timeout=_TIMEOUT_SECONDS) as response:
            if response.status >= 400:
                return None
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError):
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
