from __future__ import annotations

from datetime import date


def _kinds(events):
    return [(e["kind"], e["type"], e["count"], e["days_until"]) for e in events]


def test_day_number_counts_start_as_day_one(cal):
    start = date(2026, 1, 1)
    assert cal.day_number(start, start) == 1
    assert cal.day_number(start, date(2026, 4, 10)) == 100
    assert cal.day_number(start, date(2025, 12, 31)) == 0


def test_hundredth_day_is_today(cal):
    events = cal.today_events("2026-01-01", None, [], date(2026, 4, 10))
    assert _kinds(events) == [("met", "day", 100, 0)]


def test_first_anniversary_and_lover_ordering(cal):
    events = cal.today_events("2025-05-20", "2025-05-20", [], date(2026, 5, 20))
    # Same day: the lover anniversary is listed before the met one.
    assert _kinds(events) == [("lover", "year", 1, 0), ("met", "year", 1, 0)]


def test_start_day_itself_is_not_an_anniversary(cal):
    assert cal.today_events("2026-03-01", None, [], date(2026, 3, 1)) == []


def test_future_start_yields_nothing(cal):
    assert cal.upcoming("2027-01-01", None, [], date(2026, 1, 1)) == []


def test_upcoming_window_and_limit(cal):
    today = date(2026, 3, 1)
    events = cal.upcoming("2026-01-01", None, [{"title": "生日", "month": 3, "day": 15}], today)
    assert [(e["kind"], e["days_until"]) for e in events] == [("custom", 14), ("met", 40)]
    assert events[0]["title"] == "生日"
    assert events[1]["count"] == 100
    assert cal.upcoming("2026-01-01", None, [], today, window=10) == []


def test_custom_wraps_to_next_year(cal):
    events = cal.upcoming(None, None, [{"title": "跨年", "month": 1, "day": 1}], date(2026, 12, 20))
    assert events[0]["date"] == "2027-01-01"
    assert events[0]["days_until"] == 12


def test_feb_29_falls_back_in_common_years(cal):
    custom = [{"title": "闰日", "month": 2, "day": 29}]
    assert cal.today_events(None, None, custom, date(2027, 2, 28))[0]["title"] == "闰日"
    assert cal.today_events(None, None, custom, date(2028, 2, 28)) == []
    assert cal.today_events(None, None, custom, date(2028, 2, 29))[0]["date"] == "2028-02-29"
    assert _kinds(cal.today_events("2024-02-29", None, [], date(2025, 2, 28))) == [("met", "year", 1, 0)]


def test_invalid_inputs_are_ignored(cal):
    bad = [{"title": "x", "month": 13, "day": 1}, {"title": "y", "month": True, "day": 1}, "junk"]
    assert cal.upcoming("not-a-date", "", [b for b in bad if isinstance(b, dict)], date(2026, 1, 1)) == []
