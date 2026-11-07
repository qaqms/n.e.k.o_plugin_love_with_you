"""Pure affection / relationship-stage logic for 与你相恋.

No SDK or host imports: this module is loaded directly by tests and must stay
side-effect free. All mutating functions operate on plain JSON-compatible
dicts so the state file round-trips without custom serialization.

Confession gate: with ``gate=True`` a record never resolves to "lover" until
``confess()`` has been called for it; the value may keep rising, the stage
holds at "ambiguous". Reaching "lover" by any path sets ``confessed``, so the
gate only ever applies to the first time.
"""

from __future__ import annotations

import calendar
import copy
import math
import re
import time
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Iterator

# v2 added first_met / milestones / nicknames per record and global anniversaries.
# v3 added cooldown, decay, daily trend and confession per record, and settings.
# The proactive flow is opt-in and migrates old state files through the same
# settings normalizer.
SCHEMA_VERSION = 3

AFFECTION_MIN = 0
AFFECTION_MAX = 100

# (stage key, lower bound). Ordered from lowest to highest.
STAGES: tuple[tuple[str, int], ...] = (
    ("stranger", 0),
    ("familiar", 20),
    ("fond", 40),
    ("ambiguous", 60),
    ("lover", 80),
)
STAGE_KEYS: tuple[str, ...] = tuple(key for key, _ in STAGES)
STAGE_LOWER: dict[str, int] = dict(STAGES)
LOVER_THRESHOLD = STAGE_LOWER["lover"]

# A stage is only lost after falling this many points below its lower bound,
# so a value hovering on a boundary does not flip the stage back and forth.
DEMOTION_MARGIN = 5

MAX_DELTA_PER_CALL = 5
DAILY_GAIN_CAP = 15
DAILY_LOSS_CAP = 30
HISTORY_LIMIT = 50
REASON_MAX_CHARS = 80
NICKNAME_MAX_CHARS = 12
ANNIVERSARY_TITLE_MAX_CHARS = 20
ANNIVERSARY_LIMIT = 20
CONFESSION_MOMENT_MAX_CHARS = 40
EARLIEST_DATE = date(1970, 1, 1)

# A same-direction model change within this window is ignored, so one sweet
# line is not scored several times by repeated tool calls in one turn.
MODEL_COOLDOWN_SECONDS = 120

# Time decay (opt-in): after DECAY_GRACE_DAYS without tool activity, lose
# DECAY_PER_DAY per day, never below the current stage's lower bound. At most
# DECAY_MAX_CATCHUP_DAYS are applied at once after the plugin was stopped.
DECAY_GRACE_DAYS = 3
DECAY_PER_DAY = 1
DECAY_MAX_CATCHUP_DAYS = 7

DAILY_POINTS_LIMIT = 400
TREND_DAYS = 365

# auto_score: the plugin scores each finished exchange (user message + reply)
# itself instead of waiting for the chat model to call love_update.
DEFAULT_SETTINGS: dict[str, bool] = {
    "require_confession": True,
    "decay": False,
    "auto_score": True,
    "proactive_confession": False,
}
PROACTIVE_CONFESSION_SETTING = "proactive_confession"
PROACTIVE_CONFESSION_MAX_ATTEMPTS = 3
PROACTIVE_CONFESSION_WAIT_SECONDS = 30 * 60
PROACTIVE_CONFESSION_COOLDOWN_SECONDS = 24 * 60 * 60
PROACTIVE_CONFESSION_TIMEOUT_COOLDOWN_SECONDS = 6 * 60 * 60
PROACTIVE_CONFESSION_UNDELIVERED_COOLDOWN_SECONDS = 60

_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")

SHARED_SCOPE = "shared"
CHAR_SCOPE_PREFIX = "char:"


class EngineError(ValueError):
    """Raised for invalid operations, with a stable machine-readable code."""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code


# ---------------------------------------------------------------- helpers


def today_str(now: float | None = None) -> str:
    """Local calendar day used for the daily caps."""
    return datetime.fromtimestamp(time.time() if now is None else now).strftime("%Y-%m-%d")


def _today(now: float | None = None) -> date:
    return date.fromisoformat(today_str(now))


def clean_text(value: Any, max_chars: int) -> str:
    """Single-line, control-free text, trimmed to ``max_chars``."""
    text = _CONTROL_CHARS.sub(" ", str(value or ""))
    return " ".join(text.split())[:max_chars]


def _parse_day(value: Any) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        return None


def clamp_affection(value: Any) -> int:
    try:
        number = int(round(float(value)))
    except (TypeError, ValueError):
        number = AFFECTION_MIN
    return max(AFFECTION_MIN, min(AFFECTION_MAX, number))


def stage_index(key: str) -> int:
    try:
        return STAGE_KEYS.index(key)
    except ValueError:
        return 0


def raw_stage_for(affection: int) -> str:
    """Stage purely from the value, ignoring hysteresis."""
    result = STAGES[0][0]
    for key, lower in STAGES:
        if affection >= lower:
            result = key
    return result


def record_stage(record: dict[str, Any], affection: int) -> str:
    """The record's stored stage, or the raw stage when it is missing/invalid."""
    stage = record.get("stage")
    if isinstance(stage, str) and stage in STAGE_KEYS:
        return stage
    return raw_stage_for(affection)


def resolve_stage(previous: str, affection: int) -> str:
    """Stage after a change, applying the demotion margin.

    Promotion is immediate once a lower bound is reached. Demotion only happens
    after falling more than ``DEMOTION_MARGIN`` below the current stage's lower
    bound, and then lands on the highest stage the value still satisfies with
    the same margin.
    """
    raw = raw_stage_for(affection)
    prev_idx = stage_index(previous)
    raw_idx = stage_index(raw)
    if raw_idx >= prev_idx:
        return raw
    idx = prev_idx
    while idx > 0 and affection < STAGES[idx][1] - DEMOTION_MARGIN:
        idx -= 1
    return STAGES[idx][0]


def _gated(stage: str, record: dict[str, Any], gate: bool) -> str:
    if gate and stage == "lover" and not record.get("confessed"):
        return "ambiguous"
    return stage


def awaiting_confession(record: dict[str, Any], gate: bool) -> bool:
    """True when only a confession stands between this record and "lover"."""
    return bool(gate) and not record.get("confessed") and int(record.get("affection", 0)) >= LOVER_THRESHOLD


def proactive_confession_state(record: dict[str, Any]) -> dict[str, Any]:
    """Return a normalized, persisted state for the optional proactive flow."""
    raw = record.get("proactive_confession")
    if not isinstance(raw, dict):
        raw = {}
    status = raw.get("status")
    if not isinstance(status, str) or status not in {"idle", "dispatching", "waiting", "declined", "accepted"}:
        status = "idle"
    attempts = raw.get("attempts")
    if isinstance(attempts, bool) or not isinstance(attempts, int):
        attempts = 0
    attempts = max(0, min(PROACTIVE_CONFESSION_MAX_ATTEMPTS, attempts))

    def timestamp(key: str) -> float | None:
        value = raw.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0:
            return float(value)
        return None

    target = clean_text(raw.get("target"), 100) if isinstance(raw.get("target"), str) else ""
    values: dict[str, Any] = {
        "status": status,
        "attempts": attempts,
        "target": target,
        "last_attempt_at": timestamp("last_attempt_at"),
        "waiting_since": timestamp("waiting_since"),
        "cooldown_until": timestamp("cooldown_until") or 0.0,
        "reply_at": timestamp("reply_at"),
        "reply_seen": raw.get("reply_seen") is True and timestamp("reply_at") is not None,
        "delivery_seen": raw.get("delivery_seen") is True,
        "answer_turns": max(0, min(100, raw["answer_turns"]))
        if type(raw.get("answer_turns")) is int else 0,
    }
    if status in {"dispatching", "waiting"} and (not target or values["waiting_since"] is None):
        values.update(status="idle", reply_seen=False, reply_at=None)
    record["proactive_confession"] = values
    return values


def stage_progress(affection: int, stage: str) -> dict[str, Any]:
    """Progress information for UI and tool output."""
    idx = stage_index(stage)
    next_key = STAGES[idx + 1][0] if idx + 1 < len(STAGES) else None
    next_lower = STAGES[idx + 1][1] if next_key else None
    return {
        "stage": stage,
        "stage_index": idx,
        "next_stage": next_key,
        "points_to_next": max(0, next_lower - affection) if next_lower is not None else 0,
    }


# ---------------------------------------------------------------- records


def new_record(affection: int = 0, now: float | None = None) -> dict[str, Any]:
    value = clamp_affection(affection)
    day = today_str(now)
    stage = raw_stage_for(value)
    return {
        "affection": value,
        "stage": stage,
        "day": day,
        "gained_today": 0,
        "lost_today": 0,
        "history": [],
        "updated_at": time.time() if now is None else now,
        # Day the relationship started; user-editable.
        "first_met": day,
        # stage key -> date it was first reached. Only stages above "stranger".
        "milestones": {},
        # stage key -> what the character calls the user at that stage.
        "nicknames": {},
        # Last model change (cooldown).
        "last_model_ts": None,
        "last_model_sign": 0,
        # Last day the character's tools were used, and last day decay ran.
        "last_active": day,
        "decay_checked": day,
        # Confession gate.
        "confessed": stage == "lover",
        "confessed_on": None,
        "confession": "",
        # Optional proactive confession flow. It is deliberately separate
        # from the relationship gate and harmless when the setting is off.
        "proactive_confession": {
            "status": "idle",
            "attempts": 0,
            "target": "",
            "last_attempt_at": None,
            "waiting_since": None,
            "cooldown_until": 0.0,
            "reply_seen": False,
            "reply_at": None,
            "delivery_seen": False,
            "answer_turns": 0,
        },
        # date -> value at the end of that day, for the trend chart.
        "daily": {day: value},
    }


def normalize_record(raw: Any, now: float | None = None) -> dict[str, Any]:
    """Coerce an untrusted dict (from disk) into a valid record."""
    if not isinstance(raw, dict):
        return new_record(now=now)
    record = new_record(raw.get("affection", 0), now=now)
    stage = raw.get("stage")
    if isinstance(stage, str) and stage in STAGE_KEYS:
        # A stored stage above the raw one survives only inside the demotion margin.
        record["stage"] = resolve_stage(stage, record["affection"])
    day = raw.get("day")
    if isinstance(day, str):
        record["day"] = day
    for key, cap in (("gained_today", DAILY_GAIN_CAP), ("lost_today", DAILY_LOSS_CAP)):
        try:
            record[key] = max(0, min(cap, int(raw.get(key, 0))))
        except (TypeError, ValueError):
            record[key] = 0
    history = raw.get("history")
    if isinstance(history, list):
        record["history"] = [item for item in history if isinstance(item, dict)][-HISTORY_LIMIT:]
    updated_at = raw.get("updated_at")
    if isinstance(updated_at, (int, float)):
        record["updated_at"] = float(updated_at)
    _normalize_relationship(record, raw)
    _normalize_v3(record, raw)
    return record


def _normalize_relationship(record: dict[str, Any], raw: dict[str, Any]) -> None:
    first_met = _parse_day(raw.get("first_met"))
    if first_met is not None:
        record["first_met"] = first_met.isoformat()
    else:
        # v1 records: the oldest history entry is the best guess; else keep today.
        stamps = [item.get("ts") for item in record["history"] if isinstance(item.get("ts"), (int, float))]
        if stamps:
            record["first_met"] = today_str(min(stamps))
    milestones = raw.get("milestones")
    if isinstance(milestones, dict):
        record["milestones"] = {
            key: parsed.isoformat()
            for key, value in milestones.items()
            if key in STAGE_KEYS[1:] and (parsed := _parse_day(value)) is not None
        }
    nicknames = raw.get("nicknames")
    if isinstance(nicknames, dict):
        record["nicknames"] = {
            key: text
            for key, value in nicknames.items()
            if key in STAGE_KEYS and (text := clean_text(value, NICKNAME_MAX_CHARS))
        }


def _normalize_v3(record: dict[str, Any], raw: dict[str, Any]) -> None:
    last_ts = raw.get("last_model_ts")
    if isinstance(last_ts, (int, float)) and not isinstance(last_ts, bool):
        record["last_model_ts"] = float(last_ts)
    sign = raw.get("last_model_sign")
    record["last_model_sign"] = sign if sign in (-1, 1) and not isinstance(sign, bool) else 0
    for key in ("last_active", "decay_checked"):
        parsed = _parse_day(raw.get(key))
        if parsed is not None:
            record[key] = parsed.isoformat()
    # Keep an explicit pending gate on reload: resolving stage from 85 points
    # must not turn a saved "ambiguous", confessed=false record into a lover.
    # Old records already stored as lovers still migrate as confirmed.
    record["confessed"] = (
        raw.get("confessed") is True or raw.get("stage") == "lover"
        or (raw.get("confessed") is not False and record["stage"] == "lover")
    )
    if not record["confessed"] and record["stage"] == "lover":
        record["stage"] = "ambiguous"
    confessed_on = _parse_day(raw.get("confessed_on"))
    record["confessed_on"] = confessed_on.isoformat() if confessed_on and record["confessed"] else None
    record["confession"] = clean_text(raw.get("confession"), CONFESSION_MOMENT_MAX_CHARS) if record["confessed"] else ""
    daily = raw.get("daily")
    points: dict[str, int] = {}
    if isinstance(daily, dict):
        for key, value in daily.items():
            parsed = _parse_day(key)
            if parsed is not None and isinstance(value, (int, float)) and not isinstance(value, bool):
                points[parsed.isoformat()] = clamp_affection(value)
    else:
        # v1/v2: rebuild what the bounded history still remembers.
        for item in record["history"]:
            ts, value = item.get("ts"), item.get("value")
            if isinstance(ts, (int, float)) and isinstance(value, (int, float)):
                points[today_str(ts)] = clamp_affection(value)
    record["daily"] = dict(sorted(points.items())[-DAILY_POINTS_LIMIT:]) or {record["day"]: record["affection"]}
    proactive = raw.get("proactive_confession")
    if isinstance(proactive, dict):
        record["proactive_confession"] = copy.deepcopy(proactive)
    proactive_confession_state(record)


def _record_milestones(record: dict[str, Any], previous_stage: str, new_stage: str, ts: float) -> None:
    """Remember the first day each higher stage was reached. Never overwritten."""
    if stage_index(new_stage) <= stage_index(previous_stage):
        return
    milestones = record.setdefault("milestones", {})
    day = today_str(ts)
    for key in STAGE_KEYS[stage_index(previous_stage) + 1 : stage_index(new_stage) + 1]:
        milestones.setdefault(key, day)


def _settle(record: dict[str, Any], previous_stage: str, new_stage: str, ts: float) -> None:
    record["stage"] = new_stage
    _record_milestones(record, previous_stage, new_stage, ts)
    if new_stage == "lover":
        record["confessed"] = True


def _touch_daily(record: dict[str, Any], ts: float) -> None:
    daily = record.setdefault("daily", {})
    daily[today_str(ts)] = int(record.get("affection", 0))
    if len(daily) > DAILY_POINTS_LIMIT:
        for key in sorted(daily)[: len(daily) - DAILY_POINTS_LIMIT]:
            del daily[key]


def _roll_day(record: dict[str, Any], now: float | None) -> None:
    day = today_str(now)
    if record.get("day") != day:
        record["day"] = day
        record["gained_today"] = 0
        record["lost_today"] = 0


def _append_history(record: dict[str, Any], entry: dict[str, Any]) -> None:
    history = record.setdefault("history", [])
    history.append(entry)
    del history[:-HISTORY_LIMIT]


def _clean_reason(reason: Any) -> str:
    text = " ".join(str(reason or "").split())
    return text[:REASON_MAX_CHARS]


def mark_active(record: dict[str, Any], now: float | None = None) -> bool:
    """Note that the character's tools were used today. Returns True if changed."""
    day = today_str(now)
    if record.get("last_active") == day:
        return False
    record["last_active"] = day
    return True


def idle_days(record: dict[str, Any], today: date | None = None) -> int:
    """Whole days since the tools were last used (0 = today)."""
    last = _parse_day(record.get("last_active"))
    current = today or _today()
    return max(0, (current - last).days) if last else 0


def apply_model_delta(
    record: dict[str, Any],
    delta: Any,
    reason: Any,
    now: float | None = None,
    *,
    gate: bool = False,
    cooldown: float = MODEL_COOLDOWN_SECONDS,
    source: str = "model",
) -> dict[str, Any]:
    """Apply a model-proposed change with cooldown, grace, per-call and daily caps.

    * Same-direction changes within ``cooldown`` seconds are ignored (pass 0
      when every call is already one distinct exchange, as auto scoring does).
    * The first loss of a day is halved (rounded down, at least 1): one bad
      moment should not undo a good day.

    Mutates ``record`` and returns a result summary.
    """
    try:
        requested = int(round(float(delta)))
    except (TypeError, ValueError) as exc:
        raise EngineError("invalid_delta", "delta must be an integer") from exc
    reason_text = _clean_reason(reason)
    if not reason_text:
        raise EngineError("reason_required", "reason must not be empty")

    ts = time.time() if now is None else now
    _roll_day(record, ts)
    before = int(record.get("affection", 0))
    previous_stage = record_stage(record, before)
    per_call = max(-MAX_DELTA_PER_CALL, min(MAX_DELTA_PER_CALL, requested))
    sign = (per_call > 0) - (per_call < 0)

    last_ts = record.get("last_model_ts")
    if (
        cooldown > 0
        and sign != 0
        and record.get("last_model_sign") == sign
        and isinstance(last_ts, (int, float))
        and 0 <= ts - last_ts < cooldown
    ):
        return {
            "requested": requested,
            "applied": 0,
            "affection": before,
            "previous_stage": previous_stage,
            "stage": previous_stage,
            "stage_changed": False,
            "limited_by": "cooldown",
        }

    applied = per_call
    limited_by = "per_call" if per_call != requested else None
    if applied > 0:
        room = DAILY_GAIN_CAP - int(record.get("gained_today", 0))
        if applied > room:
            applied, limited_by = max(0, room), "daily_gain"
    elif applied < 0:
        if int(record.get("lost_today", 0)) == 0:
            softened = -max(1, -applied // 2)
            if softened != applied:
                applied, limited_by = softened, limited_by or "grace"
        room = DAILY_LOSS_CAP - int(record.get("lost_today", 0))
        if -applied > room:
            applied, limited_by = -max(0, room), "daily_loss"

    after = clamp_affection(before + applied)
    if after - before != applied:
        limited_by = limited_by or "bounds"
    applied = after - before

    new_stage = _gated(resolve_stage(previous_stage, after), record, gate)
    record["affection"] = after
    _settle(record, previous_stage, new_stage, ts)
    if applied > 0:
        record["gained_today"] = int(record.get("gained_today", 0)) + applied
    elif applied < 0:
        record["lost_today"] = int(record.get("lost_today", 0)) - applied
    record["updated_at"] = ts
    if applied != 0:
        record["last_model_ts"] = ts
        record["last_model_sign"] = sign
        _touch_daily(record, ts)
        _append_history(
            record,
            {
                "ts": ts,
                "delta": applied,
                "value": after,
                "reason": reason_text,
                "source": source,
            },
        )

    return {
        "requested": requested,
        "applied": applied,
        "affection": after,
        "previous_stage": previous_stage,
        "stage": new_stage,
        "stage_changed": new_stage != previous_stage,
        "limited_by": limited_by,
    }


def set_affection(
    record: dict[str, Any],
    value: Any,
    source: str = "manual",
    now: float | None = None,
    *,
    gate: bool = False,
) -> dict[str, Any]:
    """User-driven absolute set. Ignores daily caps and hysteresis, not the gate."""
    ts = time.time() if now is None else now
    _roll_day(record, ts)
    before = int(record.get("affection", 0))
    after = clamp_affection(value)
    previous_stage = record_stage(record, before)
    new_stage = _gated(raw_stage_for(after), record, gate)
    record["affection"] = after
    _settle(record, previous_stage, new_stage, ts)
    record["updated_at"] = ts
    _touch_daily(record, ts)
    if after != before or source == "reset":
        _append_history(
            record,
            {
                "ts": ts,
                "delta": after - before,
                "value": after,
                "reason": "",
                "source": source,
            },
        )
    return {
        "applied": after - before,
        "affection": after,
        "previous_stage": previous_stage,
        "stage": new_stage,
        "stage_changed": new_stage != previous_stage,
    }


def apply_decay(record: dict[str, Any], enabled: bool, now: float | None = None) -> int:
    """Daily drift toward the current stage's lower bound after a quiet spell.

    Always advances ``decay_checked`` so turning decay on later never applies a
    backlog. Returns the points removed (0 when nothing happened).
    """
    ts = time.time() if now is None else now
    today = _today(ts)
    checked = _parse_day(record.get("decay_checked")) or today
    record["decay_checked"] = today.isoformat()
    if not enabled:
        return 0
    last_active = _parse_day(record.get("last_active")) or today
    start = max(checked, last_active + timedelta(days=DECAY_GRACE_DAYS))
    days = min(DECAY_MAX_CATCHUP_DAYS, (today - start).days)
    if days <= 0:
        return 0
    affection = int(record.get("affection", 0))
    stage = record_stage(record, affection)
    amount = min(days * DECAY_PER_DAY, affection - STAGE_LOWER[stage])
    if amount <= 0:
        return 0
    after = affection - amount
    record["affection"] = after
    record["stage"] = resolve_stage(stage, after)
    record["updated_at"] = ts
    _touch_daily(record, ts)
    _append_history(record, {"ts": ts, "delta": -amount, "value": after, "reason": "", "source": "decay"})
    return amount


def confess(record: dict[str, Any], moment: Any = "", now: float | None = None) -> dict[str, Any]:
    """Open the gate: the relationship becomes "lover" today."""
    if record.get("confessed"):
        raise EngineError("already_confessed", "already confessed")
    affection = int(record.get("affection", 0))
    if affection < LOVER_THRESHOLD:
        raise EngineError("not_ready", "affection is below the lover threshold")
    ts = time.time() if now is None else now
    _roll_day(record, ts)
    previous_stage = record_stage(record, affection)
    record["confessed"] = True
    record["confessed_on"] = today_str(ts)
    record["confession"] = clean_text(moment, CONFESSION_MOMENT_MAX_CHARS)
    proactive = record.get("proactive_confession")
    if isinstance(proactive, dict) and proactive.get("attempts", 0):
        proactive.update(
            status="accepted",
            waiting_since=None,
            reply_seen=False,
            reply_at=None,
            delivery_seen=False,
        )
    new_stage = resolve_stage(previous_stage, affection)
    _settle(record, previous_stage, new_stage, ts)
    record["updated_at"] = ts
    _append_history(
        record,
        {"ts": ts, "delta": 0, "value": affection, "reason": record["confession"], "source": "confession"},
    )
    return {
        "affection": affection,
        "previous_stage": previous_stage,
        "stage": new_stage,
        "stage_changed": new_stage != previous_stage,
    }


def trend_view(record: dict[str, Any], days: int = TREND_DAYS, today: date | None = None) -> dict[str, Any]:
    """One value per day ending today; days before any data are None."""
    end = today or _today()
    start = end - timedelta(days=days - 1)
    points = sorted((record.get("daily") or {}).items())
    values: list[int | None] = []
    last: int | None = None
    idx = 0
    start_key = start.isoformat()
    while idx < len(points) and points[idx][0] < start_key:
        last = points[idx][1]
        idx += 1
    for offset in range(days):
        key = (start + timedelta(days=offset)).isoformat()
        while idx < len(points) and points[idx][0] <= key:
            last = points[idx][1]
            idx += 1
        values.append(last)
    values[-1] = int(record.get("affection", 0))
    return {"start": start_key, "values": values}


# ---------------------------------------------------------------- relationship details


def effective_nickname(record: dict[str, Any], stage: str | None = None) -> str:
    """Nickname for ``stage``, inheriting from the nearest lower stage that has one."""
    nicknames = record.get("nicknames") or {}
    current = stage or record_stage(record, int(record.get("affection", 0)))
    for key in reversed(STAGE_KEYS[: stage_index(current) + 1]):
        text = nicknames.get(key)
        if isinstance(text, str) and text:
            return text
    return ""


def set_nicknames(record: dict[str, Any], values: Any) -> dict[str, str]:
    """Replace all nicknames. Unknown stages are rejected; empty values clear."""
    if not isinstance(values, dict):
        raise EngineError("invalid_nicknames", "nicknames must be an object")
    unknown = [key for key in values if key not in STAGE_KEYS]
    if unknown:
        raise EngineError("invalid_nicknames", f"unknown stage: {unknown[0]}")
    cleaned = {key: text for key, value in values.items() if (text := clean_text(value, NICKNAME_MAX_CHARS))}
    record["nicknames"] = cleaned
    return cleaned


def set_first_met(record: dict[str, Any], value: Any, now: float | None = None) -> str:
    parsed = _parse_day(value)
    if parsed is None:
        raise EngineError("invalid_date", "date must be YYYY-MM-DD")
    if parsed > _today(now):
        raise EngineError("date_in_future", "date is in the future")
    if parsed < EARLIEST_DATE:
        raise EngineError("date_too_old", "date is too old")
    record["first_met"] = parsed.isoformat()
    return record["first_met"]


def normalize_anniversary(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    title = clean_text(raw.get("title"), ANNIVERSARY_TITLE_MAX_CHARS)
    month, day = raw.get("month"), raw.get("day")
    if not title or isinstance(month, bool) or isinstance(day, bool):
        return None
    if not isinstance(month, int) or not isinstance(day, int) or not 1 <= month <= 12:
        return None
    # 2000 is a leap year, so Feb 29 is accepted.
    if not 1 <= day <= calendar.monthrange(2000, month)[1]:
        return None
    item_id = raw.get("id")
    if not isinstance(item_id, str) or not re.fullmatch(r"[0-9a-f]{12}", item_id):
        item_id = uuid.uuid4().hex[:12]
    return {"id": item_id, "title": title, "month": month, "day": day}


def add_anniversary(state: dict[str, Any], title: Any, month: Any, day: Any) -> dict[str, Any]:
    items = state.setdefault("anniversaries", [])
    if len(items) >= ANNIVERSARY_LIMIT:
        raise EngineError("too_many", f"at most {ANNIVERSARY_LIMIT} anniversaries")
    if not clean_text(title, ANNIVERSARY_TITLE_MAX_CHARS):
        raise EngineError("title_required", "title must not be empty")
    item = normalize_anniversary({"title": title, "month": month, "day": day})
    if item is None:
        raise EngineError("invalid_date", "month/day is not a valid date")
    items.append(item)
    return item


def remove_anniversary(state: dict[str, Any], item_id: Any) -> bool:
    items = state.setdefault("anniversaries", [])
    kept = [item for item in items if item.get("id") != item_id]
    removed = len(kept) != len(items)
    state["anniversaries"] = kept
    return removed


# ---------------------------------------------------------------- whole state


def new_state() -> dict[str, Any]:
    return {
        "version": SCHEMA_VERSION,
        "per_character": False,
        "shared": new_record(),
        "characters": {},
        "known_characters": [],
        "current_character": None,
        # Dates the user cares about (birthdays...), known to every character.
        "anniversaries": [],
        "settings": dict(DEFAULT_SETTINGS),
    }


def normalize_settings(raw: Any) -> dict[str, bool]:
    settings = dict(DEFAULT_SETTINGS)
    if isinstance(raw, dict):
        for key in settings:
            if isinstance(raw.get(key), bool):
                settings[key] = raw[key]
    return settings


def normalize_state(raw: Any) -> dict[str, Any]:
    state = new_state()
    if not isinstance(raw, dict):
        return state
    state["per_character"] = raw.get("per_character") is True
    state["shared"] = normalize_record(raw.get("shared"))
    characters = raw.get("characters")
    if isinstance(characters, dict):
        state["characters"] = {
            str(name): normalize_record(record) for name, record in characters.items() if isinstance(name, str) and name
        }
    known = raw.get("known_characters")
    if isinstance(known, list):
        state["known_characters"] = list(dict.fromkeys(str(n) for n in known if isinstance(n, str) and n))
    current = raw.get("current_character")
    state["current_character"] = current if isinstance(current, str) and current else None
    anniversaries = raw.get("anniversaries")
    if isinstance(anniversaries, list):
        seen: set[str] = set()
        for item in anniversaries:
            normalized = normalize_anniversary(item)
            if normalized is None or normalized["id"] in seen:
                continue
            seen.add(normalized["id"])
            state["anniversaries"].append(normalized)
            if len(state["anniversaries"]) >= ANNIVERSARY_LIMIT:
                break
    state["settings"] = normalize_settings(raw.get("settings"))
    return state


def iter_records(state: dict[str, Any]) -> Iterator[tuple[str, dict[str, Any]]]:
    yield SHARED_SCOPE, state["shared"]
    for name, record in state.get("characters", {}).items():
        yield CHAR_SCOPE_PREFIX + name, record


def active_records(state: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """Records the current mode actually uses."""
    if state.get("per_character"):
        return [(scope, record) for scope, record in iter_records(state) if scope != SHARED_SCOPE]
    return [(SHARED_SCOPE, state["shared"])]


def update_settings(state: dict[str, Any], changes: Any, now: float | None = None) -> dict[str, Any]:
    """Apply setting changes. Returns the settings and any stage changes they caused."""
    if not isinstance(changes, dict) or not changes:
        raise EngineError("invalid_settings", "changes must be a non-empty object")
    for key, value in changes.items():
        if key not in DEFAULT_SETTINGS or not isinstance(value, bool):
            raise EngineError("invalid_settings", f"bad setting: {key}")
    ts = time.time() if now is None else now
    settings = state.setdefault("settings", dict(DEFAULT_SETTINGS))
    before = dict(settings)
    settings.update(changes)
    if settings["decay"] and not before["decay"]:
        # Count quiet days from now on, never from before the switch.
        day = today_str(ts)
        for _scope, record in iter_records(state):
            record["last_active"] = day
            record["decay_checked"] = day
    stage_changes: list[dict[str, str]] = []
    if settings["require_confession"] != before["require_confession"]:
        gate = settings["require_confession"]
        for scope, record in iter_records(state):
            affection = int(record.get("affection", 0))
            previous = record_stage(record, affection)
            new = _gated(resolve_stage(previous, affection), record, gate)
            if new != previous:
                _settle(record, previous, new, ts)
                stage_changes.append({"scope": scope, "from": previous, "to": new})
    return {"settings": dict(settings), "stage_changes": stage_changes}


def scope_key_for(state: dict[str, Any], character: str | None) -> str:
    if state.get("per_character") and character:
        return CHAR_SCOPE_PREFIX + character
    return SHARED_SCOPE


def get_record(state: dict[str, Any], scope: str, *, create: bool = True) -> dict[str, Any] | None:
    if scope == SHARED_SCOPE:
        return state["shared"]
    if scope.startswith(CHAR_SCOPE_PREFIX):
        name = scope[len(CHAR_SCOPE_PREFIX) :]
        if not name:
            return None
        characters = state.setdefault("characters", {})
        record = characters.get(name)
        if record is None and create:
            record = new_record()
            characters[name] = record
        return record
    return None


def set_per_character(state: dict[str, Any], enabled: bool, current: str | None) -> dict[str, Any]:
    """Switch shared/independent mode without destroying anyone's data.

    * enable: the current character keeps the shared value; every other
      character keeps its earlier independent record (or starts at 0 when it
      has none, created lazily).
    * disable: the shared value becomes the current character's value; all
      independent records stay on disk for a later re-enable.
    """
    enabled = bool(enabled)
    if bool(state.get("per_character")) == enabled:
        return {"changed": False, "per_character": enabled}
    if not current:
        raise EngineError("current_character_unknown", "current character is unknown")
    characters = state.setdefault("characters", {})
    if enabled:
        characters[current] = copy.deepcopy(state["shared"])
    else:
        record = characters.get(current)
        if record is not None:
            state["shared"] = copy.deepcopy(record)
    state["per_character"] = enabled
    state["current_character"] = current
    return {"changed": True, "per_character": enabled, "current_character": current}


def record_view(record: dict[str, Any], history_limit: int = 20, *, gate: bool = False) -> dict[str, Any]:
    """JSON-safe projection of one record for UI and tools."""
    affection = int(record.get("affection", 0))
    stage = record_stage(record, affection)
    view = {
        "affection": affection,
        **stage_progress(affection, stage),
        "gained_today": int(record.get("gained_today", 0)) if record.get("day") == today_str() else 0,
        "lost_today": int(record.get("lost_today", 0)) if record.get("day") == today_str() else 0,
        "history": list(reversed(record.get("history", [])[-history_limit:])) if history_limit > 0 else [],
        "first_met": record.get("first_met") or today_str(),
        "milestones": dict(record.get("milestones") or {}),
        "nicknames": dict(record.get("nicknames") or {}),
        "nickname": effective_nickname(record, stage),
        "awaiting_confession": awaiting_confession(record, gate),
        "confessed_on": record.get("confessed_on"),
        "confession": record.get("confession") or "",
    }
    return view
