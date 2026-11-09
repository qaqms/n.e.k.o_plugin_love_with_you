"""Reading the host's plugin conversation bus (pure, unit tested).

The host copies every finished message onto the ``conversations`` bus store:
``user_message`` for what the user said and ``assistant_message`` for the
character's reply, each tagged with the character name. This module turns
those records into messages, drops ones already seen, and pairs each user
message with the reply that follows it, per character.

Proactive turns (``proactive_*``) are kept separate from ordinary exchanges:
nothing the user said caused them, so they are not something to score.  The
plugin uses ``proactive_reply`` to confirm that a proactive prompt actually
reached the character before interpreting a following user message as its
answer.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import unicodedata
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Any, Iterable

USER_TURN = "user_message"
REPLY_TURN = "assistant_message"
PROACTIVE_REPLY_TURN = "proactive_reply"

# Text kept per message when building a scoring prompt.
MESSAGE_MAX_CHARS = 300
# Several user messages before one reply are merged, up to this many.
PENDING_MAX_MESSAGES = 4
# Remembered (ts, role, lanlan, content-prefix) keys for de-duplication.
SEEN_LIMIT = 256


@dataclass(frozen=True)
class Message:
    ts: float
    role: str  # "user" | "reply" | "proactive_reply"
    lanlan: str
    content: str
    truncated: bool = False
    source: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)
    spoken_at: float | None = None
    income_text: str = field(default="", compare=False)
    income_valid: bool = field(default=True, compare=False)

    @property
    def said_at(self) -> float:
        """Dialogue chronology, separate from the bus arrival cursor."""
        return self.ts if self.spoken_at is None else self.spoken_at


@dataclass(frozen=True)
class Exchange:
    lanlan: str
    user: str
    reply: str
    previous_user: str
    previous_reply: str
    ts: float
    truncated: bool = False
    spoken_at: float | None = None
    income_event: dict[str, Any] | None = None

    @property
    def said_at(self) -> float:
        return self.ts if self.spoken_at is None else self.spoken_at


def _field(record: Any, name: str) -> Any:
    if isinstance(record, dict):
        return record.get(name)
    return getattr(record, name, None)


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _correlation_metadata(*values: dict[str, Any]) -> dict[str, Any]:
    keys = {"event_type", "source_name", "plugin_id", "coalesce_key", "conversation_id"}
    result: dict[str, Any] = {}
    for value in values:
        for key in keys:
            if key in value:
                result[key] = value[key]
    return result


def _clip(text: str) -> str:
    text = " ".join(str(text or "").split())
    return text[:MESSAGE_MAX_CHARS]


def income_digest(text: str) -> str:
    normalized = "".join(char for char in unicodedata.normalize("NFKC", text).casefold()
                         if not char.isspace() and unicodedata.category(char)[0] not in {"P", "C"})
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest() if normalized else ""


def _timestamp(*values: Any) -> float | None:
    for value in values:
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
            return float(value)
    return None


def parse_record(record: Any) -> Message | None:
    """One bus record -> Message, or None when it is not a user/reply message."""
    metadata = _as_dict(_field(record, "metadata"))
    raw = _as_dict(_field(record, "raw"))
    raw_meta = _as_dict(raw.get("metadata"))

    turn_type = _field(record, "turn_type") or metadata.get("turn_type") or raw_meta.get("turn_type")
    if (metadata.get("event_type") or raw_meta.get("event_type")) in ("gift_received", "proactive_confession"):
        return None
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
    spoken_at = _timestamp(metadata.get("ts"), raw_meta.get("ts"))
    ts = _timestamp(_field(record, "timestamp"), spoken_at)
    if ts is None:
        return None
    normalized = " ".join(content.split())
    digest = income_digest(content)
    source = _field(record, "source") or metadata.get("source") or raw_meta.get("source")
    return Message(
        ts=float(ts), role=role, lanlan=lanlan.strip(), content=_clip(content),
        truncated=len(normalized) > MESSAGE_MAX_CHARS,
        source=str(source or ""),
        metadata=_correlation_metadata(raw_meta, metadata),
        spoken_at=spoken_at,
        income_text=digest,
        income_valid=bool(digest),
    )


def parse_proactive_record(record: Any) -> Message | None:
    """Parse a proactive reply without making it part of a scored exchange."""
    metadata = _as_dict(_field(record, "metadata"))
    raw = _as_dict(_field(record, "raw"))
    raw_meta = _as_dict(raw.get("metadata"))
    turn_type = _field(record, "turn_type") or metadata.get("turn_type") or raw_meta.get("turn_type")
    # The prompt itself can carry event_type=proactive_confession. Only a
    # generated reply confirms delivery, never an instruction bus record.
    if turn_type != PROACTIVE_REPLY_TURN:
        return None
    lanlan = _field(record, "lanlan_name") or metadata.get("lanlan_name") or raw_meta.get("lanlan_name")
    content = _field(record, "content") or raw.get("content")
    if not isinstance(lanlan, str) or not lanlan.strip() or not isinstance(content, str) or not content.strip():
        return None
    spoken_at = _timestamp(metadata.get("ts"), raw_meta.get("ts"))
    ts = _timestamp(_field(record, "timestamp"), spoken_at)
    if ts is None:
        return None
    normalized = " ".join(content.split())
    source = _field(record, "source") or metadata.get("source") or raw_meta.get("source")
    correlation = _correlation_metadata(raw_meta, metadata)
    conversation_id = _field(record, "conversation_id")
    if isinstance(conversation_id, str) and conversation_id:
        correlation["conversation_id"] = conversation_id
    return Message(
        ts=float(ts), role=PROACTIVE_REPLY_TURN, lanlan=lanlan.strip(), content=_clip(content),
        truncated=len(normalized) > MESSAGE_MAX_CHARS,
        source=str(source or ""),
        metadata=correlation,
        spoken_at=spoken_at,
    )


def parse_gift_instruction(record: Any) -> tuple[str, str, str, float] | None:
    """The host's ephemeral instruction/reply pair shares a conversation ID."""
    metadata = _as_dict(_field(record, "metadata"))
    raw = _as_dict(_field(record, "raw"))
    raw_meta = _as_dict(raw.get("metadata"))
    turn_type = _field(record, "turn_type") or metadata.get("turn_type") or raw_meta.get("turn_type")
    if turn_type != "proactive_instruction":
        return None
    content = _field(record, "content") or raw.get("content")
    conversation_id = _field(record, "conversation_id") or metadata.get("conversation_id") or raw_meta.get("conversation_id")
    character = _field(record, "lanlan_name") or metadata.get("lanlan_name") or raw_meta.get("lanlan_name")
    ts = _timestamp(metadata.get("ts"), raw_meta.get("ts"), _field(record, "timestamp"))
    if not isinstance(content, str) or not isinstance(conversation_id, str) or not conversation_id:
        return None
    if not isinstance(character, str) or not character or ts is None:
        return None
    match = re.search(r"\[LWY-GIFT:([a-zA-Z0-9_-]{12,80})\]", content)
    return (conversation_id, character, match[1], ts) if match else None


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


def _history_message(row: Any) -> tuple[str, str, dict[str, Any]]:
    if not isinstance(row, dict):
        return "", "", {}
    kind = row.get("type", row.get("role"))
    role = "user" if kind in ("human", "user") else "reply" if kind in ("ai", "assistant") else ""
    data = row.get("data", row)
    if not role or not isinstance(data, dict):
        return "", "", {}
    metadata = {**_as_dict(data.get("metadata")), **_as_dict(row.get("metadata"))}
    proof = _as_dict(metadata.get("chat_original_source"))
    sources = metadata.get("sources", [])
    sources = sources if isinstance(sources, list) else [sources]
    if (
        metadata.get("source") in ("theater_numeric_v2", "avatar-drop", "tool", "agent", "proactive")
        or "avatar-drop" in sources or proof.get("origin") in ("tool", "agent")
        or metadata.get("event_type") in ("gift_received", "relationship_context", "proactive_confession")
        or metadata.get("turn_type") in ("proactive_reply", "proactive_instruction")
    ):
        return "", "", {}
    content = data.get("content")
    if isinstance(content, list):
        content = "".join(block.get("text", "") for block in content
                          if isinstance(block, dict) and isinstance(block.get("text"), str))
    return (role, content, metadata) if isinstance(content, str) and content.strip() else ("", "", {})


def _history_timestamp(metadata: dict[str, Any]) -> float | None:
    proof = _as_dict(metadata.get("chat_original_source"))
    stamp = metadata.get("recent_memory_time", proof.get("originalTime"))
    if isinstance(stamp, str) and re.fullmatch(r"[0-9]{1,16}", stamp):
        return int(stamp) / 1000
    return None


class RecentHistoryTracker:
    """Observe appended live turns on hosts without ordinary conversation records.

    The first snapshot is a baseline. A retained row anchors subsequent appends;
    a wholly replaced window is a new baseline, never a request to replay history.
    Legacy rows have minute-only reply stamps, so their timing uses observation
    time instead of inventing second precision from those stamps.
    """

    def __init__(self, start_ts: float) -> None:
        self.start_ts = start_ts
        self._snapshots: dict[str, list[str]] = {}
        self._pending: dict[str, list[Message]] = {}

    def invalidate_scoring(self, character: str | None = None) -> None:
        """An in-flight legacy turn can still earn income after a settings edit."""
        for name, messages in self._pending.items():
            if character is None or name == character:
                for message in messages:
                    message.metadata["skip_score"] = True

    def feed(self, character: str, rows: list[Any], now: float) -> list[Message]:
        rows = rows[-512:]
        keys = [hashlib.sha256(json.dumps(row, sort_keys=True, ensure_ascii=True).encode()).hexdigest()
                for row in rows]
        previous = self._snapshots.get(character)
        self._snapshots[character] = keys
        if previous is None:
            return []
        start = 0
        if previous:
            positions = {key: index for index, key in enumerate(keys)}
            anchor = next((positions[key] for key in reversed(previous) if key in positions), None)
            if anchor is None:
                self._pending.pop(character, None)
                return []
            start = anchor + 1
        out: list[Message] = []
        for row in rows[start:]:
            role, text, metadata = _history_message(row)
            stamp = _history_timestamp(metadata)
            if not role or (stamp is not None and not self.start_ts <= stamp <= now + 5):
                self._pending.pop(character, None)
                continue
            if role == "reply":
                match = re.match(r"^\[([0-9]{8}) [^\]\s]+ ([0-9]{2}:[0-9]{2})\] ?", text)
                if match:
                    try:
                        minute = datetime.strptime(f"{match[1]} {match[2]}", "%Y%m%d %H:%M").timestamp()
                    except (ValueError, OSError, OverflowError):
                        self._pending.pop(character, None)
                        continue
                    if minute + 60 < max(self.start_ts, now - 300) or minute > now + 5:
                        self._pending.pop(character, None)
                        continue
                    text = text[match.end():]
            normalized = " ".join(text.split())
            if not normalized:
                self._pending.pop(character, None)
                continue
            message = Message(
                ts=now, role=role, lanlan=character, content=_clip(text),
                truncated=len(normalized) > MESSAGE_MAX_CHARS,
                source="host_recent_history", spoken_at=stamp if stamp is not None else now,
                income_text=income_digest(text), income_valid=bool(income_digest(text)),
            )
            if role == "user":
                pending = self._pending.setdefault(character, [])
                pending.append(message)
                if len(pending) > PENDING_MAX_MESSAGES:
                    for item in pending:
                        item.metadata["history_truncated"] = True
                del pending[:-PENDING_MAX_MESSAGES]
            else:
                pending = self._pending.pop(character, [])
                if pending and all(item.said_at <= message.said_at for item in pending):
                    if any(item.metadata.get("history_truncated") for item in pending):
                        message = replace(message, truncated=True)
                    if any(item.metadata.get("skip_score") for item in pending):
                        for item in [*pending, message]:
                            item.metadata["skip_score"] = True
                    out.extend([*pending, message])
        return out


class ExchangeTracker:
    """Pairs user messages with the next reply, per character."""

    def __init__(self) -> None:
        self._pending: dict[str, list[Message]] = {}
        self._pending_truncated: set[str] = set()
        self._last: dict[str, tuple[str, str, bool]] = {}

    def reset(self, lanlan: str | None = None) -> None:
        """Forget exchanges across a relationship reset or scoring-mode change."""
        if lanlan is None:
            self._pending.clear()
            self._pending_truncated.clear()
            self._last.clear()
        else:
            self._pending.pop(lanlan, None)
            self._pending_truncated.discard(lanlan)
            self._last.pop(lanlan, None)

    def feed(self, message: Message) -> Exchange | None:
        if message.role == "user":
            pending = self._pending.setdefault(message.lanlan, [])
            pending.append(message)
            if len(pending) > PENDING_MAX_MESSAGES:
                self._pending_truncated.add(message.lanlan)
            del pending[:-PENDING_MAX_MESSAGES]
            return None
        if message.role != "reply":
            return None
        queued = self._pending.get(message.lanlan, [])
        pending = sorted(
            (item for item in queued if item.said_at <= message.said_at),
            key=lambda item: item.said_at,
        )
        remaining = [item for item in queued if item.said_at > message.said_at]
        if remaining:
            self._pending[message.lanlan] = remaining
        else:
            self._pending.pop(message.lanlan, None)
        if not pending:
            return None  # a reply nobody asked for in this window (e.g. a greeting)
        joined = " / ".join(item.content for item in pending)
        truncated = (
            message.truncated or any(item.truncated for item in pending)
            or len(joined) > MESSAGE_MAX_CHARS or message.lanlan in self._pending_truncated
        )
        if not remaining:
            self._pending_truncated.discard(message.lanlan)
        user = _clip(joined)
        previous_user, previous_reply, previous_truncated = self._last.get(message.lanlan, ("", "", False))
        self._last[message.lanlan] = (user, message.content, truncated)
        text_keys = [item.income_text or income_digest(item.content) for item in pending]
        text_key = text_keys[0] if len(text_keys) == 1 else hashlib.sha256("|".join(text_keys).encode()).hexdigest()
        identity = repr((message.lanlan, tuple((item.said_at, key) for item, key in zip(pending, text_keys))))
        income_event = None
        if all(item.income_valid for item in pending) and text_key and income_digest(message.content):
            income_event = {
                "id": hashlib.sha256(identity.encode("utf-8")).hexdigest(), "text": text_key,
                "user_at": pending[-1].said_at, "reply_at": message.said_at,
            }
        return Exchange(
            lanlan=message.lanlan,
            user=user,
            reply=message.content,
            previous_user=previous_user,
            previous_reply=previous_reply,
            ts=message.ts,
            truncated=truncated or previous_truncated,
            spoken_at=message.spoken_at,
            income_event=income_event,
        )
