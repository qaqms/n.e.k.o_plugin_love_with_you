"""Anniversary arithmetic for 与你相恋. Pure, no SDK imports.

Day numbers follow the convention of Chinese couple apps: the first day is
day 1, so "第 100 天" falls 99 days after the start date.

Event dicts are JSON-safe and shared by the UI and the model prompts:

    {"kind": "met" | "lover" | "custom",
     "type": "day" | "year" | "date",
     "count": int,          # day number / year count; 0 for custom dates
     "title": str,          # custom anniversaries only, else ""
     "date": "YYYY-MM-DD",  # the occurrence date
     "days_until": int}     # 0 = today
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta
from typing import Any

# Day numbers worth celebrating besides whole years. 520 reads like 我爱你.
DAY_MILESTONES: tuple[int, ...] = (100, 200, 300, 520, 1000, 1314, 2000)

UPCOMING_WINDOW_DAYS = 60
UPCOMING_LIMIT = 6

_KIND_ORDER = {"lover": 0, "met": 1, "custom": 2}


def parse_date(value: Any) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        return None


def valid_month_day(month: Any, day: Any) -> bool:
    if isinstance(month, bool) or isinstance(day, bool):
        return False
    if not isinstance(month, int) or not isinstance(day, int):
        return False
    if not 1 <= month <= 12:
        return False
    # 2000 is a leap year, so Feb 29 is accepted.
    return 1 <= day <= calendar.monthrange(2000, month)[1]


def occurrence_in_year(year: int, month: int, day: int) -> date:
    """The yearly date in ``year``; Feb 29 falls back to Feb 28 in common years."""
    if month == 2 and day == 29 and not calendar.isleap(year):
        return date(year, 2, 28)
    return date(year, month, day)


def next_occurrence(month: int, day: int, today: date) -> date:
    this_year = occurrence_in_year(today.year, month, day)
    if this_year >= today:
        return this_year
    return occurrence_in_year(today.year + 1, month, day)


def day_number(start: date, today: date) -> int:
    """1 on the start date itself; 0 before it."""
    delta = (today - start).days
    return delta + 1 if delta >= 0 else 0


def _event(kind: str, type_: str, count: int, when: date, today: date, title: str = "") -> dict[str, Any]:
    return {
        "kind": kind,
        "type": type_,
        "count": count,
        "title": title,
        "date": when.isoformat(),
        "days_until": (when - today).days,
    }


def _start_events(kind: str, start: date, today: date, window: int) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    if start > today:
        return events
    current = day_number(start, today)
    for milestone in DAY_MILESTONES:
        if milestone < current:
            continue
        when = start + timedelta(days=milestone - 1)
        if (when - today).days > window:
            break
        events.append(_event(kind, "day", milestone, when, today))
    years = today.year - start.year
    for year_count in (years, years + 1):
        if year_count < 1:
            continue
        when = occurrence_in_year(start.year + year_count, start.month, start.day)
        if 0 <= (when - today).days <= window:
            events.append(_event(kind, "year", year_count, when, today))
    return events


def _custom_events(anniversaries: list[dict[str, Any]], today: date, window: int) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for item in anniversaries:
        month, day = item.get("month"), item.get("day")
        if not isinstance(month, int) or not isinstance(day, int) or not valid_month_day(month, day):
            continue
        when = next_occurrence(month, day, today)
        if (when - today).days <= window:
            events.append(_event("custom", "date", 0, when, today, str(item.get("title") or "")))
    return events


def upcoming(
    first_met: Any,
    lover_since: Any,
    anniversaries: list[dict[str, Any]],
    today: date,
    *,
    window: int = UPCOMING_WINDOW_DAYS,
    limit: int = UPCOMING_LIMIT,
) -> list[dict[str, Any]]:
    """Events from today through ``window`` days ahead, soonest first."""
    events: list[dict[str, Any]] = []
    met = parse_date(first_met)
    if met is not None:
        events.extend(_start_events("met", met, today, window))
    lover = parse_date(lover_since)
    if lover is not None:
        events.extend(_start_events("lover", lover, today, window))
    events.extend(_custom_events(anniversaries, today, window))
    events.sort(key=lambda e: (e["days_until"], _KIND_ORDER.get(e["kind"], 9), e["title"]))
    return events[:limit]


def today_events(
    first_met: Any, lover_since: Any, anniversaries: list[dict[str, Any]], today: date
) -> list[dict[str, Any]]:
    return upcoming(first_met, lover_since, anniversaries, today, window=0, limit=len(DAY_MILESTONES) + 8)
