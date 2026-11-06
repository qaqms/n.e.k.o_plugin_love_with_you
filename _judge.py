"""Model judging through the host's official plugin model gateway.

``plugin.toml`` declares the usage ``judge``. The user binds it to a model in
N.E.K.O's Plugin API page; the plugin only ever sees the usage name and an
instance-scoped gateway token, never a provider URL or key. Unbound means the
plugin falls back to the offline keyword judge.

Every failure returns ``(None, status)`` and never raises: chatting must keep
working without scoring. Statuses never contain exception messages.
"""

from __future__ import annotations

import asyncio
import inspect
from typing import Any

USAGE = "judge"
TIMEOUT_SECONDS = 30.0
MAX_TOKENS = 160

UNBOUND = "unbound"
UNAVAILABLE = "gateway_unavailable"


async def complete(models: Any, prompt: str) -> tuple[str | None, str]:
    """Return (text, "ok") or (None, status)."""
    get_client = getattr(models, "get_client", None)
    if not callable(get_client):
        return None, UNAVAILABLE
    try:
        pending = get_client()
        client: Any = await pending if inspect.isawaitable(pending) else pending
    except Exception:
        return None, UNAVAILABLE
    try:
        response = await asyncio.wait_for(
            client.chat.completions.create(
                model=USAGE,
                # Keep one user message for compatibility with host model
                # adapters; build_prompt embeds the same guardrails alongside
                # the JSON-delimited dialogue data.
                messages=[{"role": "user", "content": prompt}],
                max_completion_tokens=MAX_TOKENS,
                temperature=0.2,
            ),
            timeout=TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        return None, "timeout"
    except Exception as exc:
        status = getattr(exc, "status_code", None)
        if status == 403:
            return None, UNBOUND  # usage not bound to a model yet
        if status == 409:
            return None, "binding_incompatible"
        return None, f"http_{status}" if isinstance(status, int) else f"call_{type(exc).__name__}"
    try:
        content = response.choices[0].message.content
    except (AttributeError, IndexError, TypeError):
        content = None
    if isinstance(content, str) and content.strip():
        return content, "ok"
    return None, "empty_reply"
