"""Reading the host's plugin conversation bus (pure, unit tested).

The host copies every finished message onto the ``conversations`` bus store:
``user_message`` for what the user said and ``assistant_message`` for the
character's reply, each tagged with the character name. This module turns
those records into messages, drops ones already seen, and pairs each user
message with the reply that follows it, per character.

Proactive turns (``proactive_*``) are ignored: nothing the user said caused
them, so they are not something to score.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

USER_TURN = "user_message"
REPLY_TURN = "assistant_message"

# Text kept per message when building a scoring prompt.
MESSAGE_MAX_CHARS = 300
# Several user messages before one reply are merged, up to this many.
PENDING_MAX_MESSAGES = 4
# Remembered (ts, role, lanlan, content-prefix) keys for de-duplication.
SEEN_LIMIT = 256


@dataclass(frozen=True)
class Message:
    ts: float
    role: str  # "user" | "reply"
    lanlan: str
    content: str


@dataclass(frozen=True)
class Exchange:
    lanlan: str
    user: str
    reply: str
    previous_user: str
    previous_reply: str
    ts: float


def _field(record: Any, name: str) -> Any:
    if isinstance(record, dict):
        return record.get(name)
    return getattr(record, name, None)


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _clip(text: str) -> str:
    text = " ".join(str(text or "").split())
    return text[:MESSAGE_MAX_CHARS]


def parse_record(record: Any) -> Message | None:
    """One bus record -> Message, or None when it is not a user/reply message."""
    metadata = _as_dict(_field(record, "metadata"))
    raw = _as_dict(_field(record, "raw"))
    raw_meta = _as_dict(raw.get("metadata"))

    turn_type = _field(record, "turn_type") or metadata.get("turn_type") or raw_meta.get("turn_type")
    if turn_type == USER_TURN:
        role = "user"
    elif turn_type == REPLY_TURN:
        role = "reply"
    else:
        return None
    lanlan = _field(record, "lanlan_name") or metadata.get("lanlan_name") or raw_meta.get("lanlan_name")
    content = _field(record, "content") or raw.get("content")
    if not isinstance(lanlan, str) or not lanlan.strip() or not isinstance(content, str) or not content.strip():
        return None
    # timestamp = arrival on the bus (what since_ts filters on); metadata.ts is
    # when it was said and is only a fallback.
    ts = _field(record, "timestamp")
    if not isinstance(ts, (int, float)) or isinstance(ts, bool):
        ts = metadata.get("ts")
    if not isinstance(ts, (int, float)) or isinstance(ts, bool):
        return None
    return Message(ts=float(ts), role=role, lanlan=lanlan.strip(), content=_clip(content))


class BusCursor:
    """Hands out each message once, in arrival order."""

    def __init__(self, start_ts: float) -> None:
        self.since = float(start_ts)
        self._seen: list[tuple[float, str, str, str]] = []

    def fresh(self, messages: Iterable[Message]) -> list[Message]:
        out: list[Message] = []
        for message in sorted(messages, key=lambda item: item.ts):
            if message.ts < self.since:
                continue
            key = (message.ts, message.role, message.lanlan, message.content[:40])
            if key in self._seen:
                continue
            self._seen.append(key)
            out.append(message)
        del self._seen[:-SEEN_LIMIT]
        if out:
            self.since = max(self.since, out[-1].ts)
        return out


class ExchangeTracker:
    """Pairs user messages with the next reply, per character."""

    def __init__(self) -> None:
        self._pending: dict[str, list[str]] = {}
        self._last: dict[str, tuple[str, str]] = {}

    def feed(self, message: Message) -> Exchange | None:
        if message.role == "user":
            pending = self._pending.setdefault(message.lanlan, [])
            pending.append(message.content)
            del pending[:-PENDING_MAX_MESSAGES]
            return None
        pending = self._pending.pop(message.lanlan, None)
        if not pending:
            return None  # a reply nobody asked for in this window (e.g. a greeting)
        user = _clip(" / ".join(pending))
        previous_user, previous_reply = self._last.get(message.lanlan, ("", ""))
        self._last[message.lanlan] = (user, message.content)
        return Exchange(
            lanlan=message.lanlan,
            user=user,
            reply=message.content,
            previous_user=previous_user,
            previous_reply=previous_reply,
            ts=message.ts,
        )
