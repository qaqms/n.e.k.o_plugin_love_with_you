"""Detached panel snapshots and projections; no SDK, filesystem or network access."""

from __future__ import annotations

import copy
from datetime import date
from typing import Any

from . import _calendar as cal
from . import _engine as engine
from . import _experiences as experiences
from . import _shop as shop


def snapshot(state: dict[str, Any], today: date, now: float, *, history_limit: int = 20) -> dict[str, Any]:
    """Called under the owner lock. Copy only records and history the panel shows."""
    def record_snapshot(record: dict[str, Any]) -> dict[str, Any]:
        return copy.deepcopy({
            **record,
            "history": record.get("history", [])[-history_limit:] if history_limit > 0 else [],
        })

    names = list(state["known_characters"])
    current = state["current_character"]
    if current and current not in names:
        names.insert(0, current)
    independent = state["per_character"]
    return {
        "per_character": independent,
        "current_character": current,
        "known_characters": list(state["known_characters"]),
        "settings": dict(state["settings"]),
        "anniversaries": copy.deepcopy(state.get("anniversaries", [])),
        "records": [
            (engine.CHAR_SCOPE_PREFIX + name, name, name == current,
             record_snapshot(state["characters"].get(name) or engine.new_record()))
            for name in names
        ] if independent else [
            (engine.SHARED_SCOPE, None, True, record_snapshot(state["shared"])),
        ],
        "shop": shop.view(state["shop"], today.isoformat(), now),
        "experiences": experiences.view(state["experiences"]),
    }


def project(state: dict[str, Any], today: date) -> dict[str, Any]:
    """Build the public panel payload from a detached snapshot outside the lock."""
    anniversaries = state["anniversaries"]
    gate = bool(state["settings"].get("require_confession"))
    scopes = []
    for key, label, is_current, record in state["records"]:
        first_met = cal.parse_date(record.get("first_met"))
        lover_since = (record.get("milestones") or {}).get("lover")
        scopes.append({
            "key": key, "label": label, "is_current": is_current,
            **engine.record_view(record, gate=gate),
            "met_day": cal.day_number(first_met, today) if first_met else 1,
            "idle_days": engine.idle_days(record, today),
            "trend": engine.trend_view(record, engine.TREND_DAYS, today),
            "today_events": cal.today_events(record.get("first_met"), lover_since, anniversaries, today),
            "upcoming": cal.upcoming(record.get("first_met"), lover_since, anniversaries, today),
        })
    return {
        "per_character": state["per_character"],
        "current_character": state["current_character"],
        "known_characters": state["known_characters"],
        "today": today.isoformat(),
        "settings": state["settings"],
        "decay_rules": {"grace_days": engine.DECAY_GRACE_DAYS, "per_day": engine.DECAY_PER_DAY},
        "scopes": scopes,
        "anniversaries": sorted(anniversaries, key=lambda item: (item["month"], item["day"], item["title"])),
        "stages": [{"key": key, "min": lower} for key, lower in engine.STAGES],
        "limits": {
            "per_call": engine.MAX_DELTA_PER_CALL,
            "daily_gain": engine.DAILY_GAIN_CAP,
            "daily_chat": engine.DAILY_CHAT_CAP,
            "daily_loss": engine.DAILY_LOSS_CAP,
            "nickname_chars": engine.NICKNAME_MAX_CHARS,
            "avoided_names": engine.AVOIDED_NAMES_MAX,
            "title_chars": engine.ANNIVERSARY_TITLE_MAX_CHARS,
            "anniversaries": engine.ANNIVERSARY_LIMIT,
        },
        "shop": state["shop"],
        "experiences": state["experiences"],
    }
