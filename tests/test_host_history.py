from __future__ import annotations

import json
from datetime import datetime
from urllib.parse import parse_qs, urlsplit

import pytest

NOW = datetime(2026, 11, 9, 12).timestamp()


def message(day, *, kind="human", source=None):
    metadata = {"recent_memory_time": str(int(datetime.fromisoformat(day + "T12:00:00").timestamp() * 1000))}
    if source:
        metadata["source"] = source
    return {"type": kind, "data": {"content": "private chat body", "metadata": metadata}}


def test_history_dates_use_original_metadata_and_local_calendar(host):
    rows = [
        message("2026-11-07"), message("2026-03-04"),
        {"role": "user", "content": [{"type": "text", "text": "hello"}],
         "metadata": {"chat_original_source": {"originalTime": message("2026-02-02")["data"]["metadata"]["recent_memory_time"]}}},
    ]
    assert host.earliest_chat_date(rows, NOW) == "2026-02-02"


def test_history_dates_do_not_parse_chat_text_or_use_generated_messages(host):
    rows = [
        {"type": "human", "data": {"content": "We met on 1999-01-01"}},
        message("2025-01-01", kind="system"), message("2025-01-01", kind="ai"),
        message("2025-01-01", source="avatar-drop"), message("2025-01-01", source="theater_numeric_v2"),
        message("2027-01-01"), message("2026-10-10"),
    ]
    assert host.earliest_chat_date(rows, NOW) == "2026-10-10"
    rows[-1]["data"]["metadata"] = {"recent_memory_time": "0"}
    assert host.earliest_chat_date(rows, NOW) is None


@pytest.mark.parametrize("separator", ["", " "])
def test_legacy_host_reply_stamps_require_a_real_preceding_user_message(host, separator):
    def row(kind, text, **metadata):
        return {"type": kind, "data": {"content": text, "metadata": metadata}}
    assert host.earliest_chat_date([row("ai", "[20260101 Thu 12:00] unsolicited")], NOW) is None
    assert host.earliest_chat_date([row("human", "[20260101 Thu 12:00] quoted date")], NOW) is None
    rows = [
        row("human", "hello"), row("ai", f"[20261031 Sat 13:42]{separator}reply"),
        row("ai", "[20260101 Thu 12:00] unpaired"),
        row("human", "again"), row("ai", "[20261104 Wed 10:10] reply"),
    ]
    assert host.earliest_chat_date(rows, NOW) == "2026-10-31"


@pytest.mark.parametrize("prefix,metadata", [
    ("[20260230 Mon 12:00] invalid", {}),
    ("[20270101 Fri 12:00] future", {}),
    ("[20260101 Thu 12:00] tool", {"chat_original_source": {"origin": "tool"}}),
    ("[20260101 Thu 12:00] proactive", {"turn_type": "proactive_reply"}),
])
def test_legacy_reply_stamp_rejects_invalid_or_generated_replies(host, prefix, metadata):
    rows = [
        {"type": "human", "data": {"content": "hello"}},
        {"type": "ai", "data": {"content": prefix, "metadata": metadata}},
    ]
    assert host.earliest_chat_date(rows, NOW) is None


@pytest.mark.parametrize("stamp", [None, True, 123, "NaN", "123.45", "-1", "9" * 100])
def test_history_dates_ignore_invalid_timestamp_types(host, stamp):
    row = message("2026-10-10")
    row["data"]["metadata"]["recent_memory_time"] = stamp
    assert host.earliest_chat_date([row, None, {"type": []}], NOW) is None


def install_history(monkeypatch, host, files):
    calls = []

    def get(path, **kwargs):
        calls.append(path)
        if path == "/api/memory/recent_files":
            return {"files": list(files)}
        filename = parse_qs(urlsplit(path).query)["filename"][0]
        return files[filename]

    monkeypatch.setattr(host, "_get_json", get)
    monkeypatch.setattr(host.time, "time", lambda: NOW)
    return calls


def payload(day):
    return {"content": json.dumps([message(day)])}


def test_shared_history_chooses_earliest_across_all_roles_without_returning_chat(host, monkeypatch):
    install_history(monkeypatch, host, {"recent_YUI.json": payload("2026-10-01"), "recent_MIO.json": payload("2026-02-03")})
    result = host.fetch_first_met()
    assert result == {"date": "2026-02-03", "character": "MIO", "source": "host_recent_history", "scanned_roles": 2}
    assert "private chat body" not in str(result)


def test_independent_history_queries_only_exact_encoded_character(host, monkeypatch):
    calls = install_history(monkeypatch, host, {
        "recent_A & B.json": payload("2026-10-01"), "recent_B.json": payload("2026-02-03"),
        "../recent_bad.json": payload("2025-01-01"),
    })
    result = host.fetch_first_met("A & B")
    assert result["date"] == "2026-10-01" and result["scanned_roles"] == 1
    assert len(calls) == 2 and "A+%26+B" in calls[1]


@pytest.mark.parametrize("bad_payload", [None, {"content": "bad json"}, {"content": "{}"}])
def test_failed_role_read_never_produces_a_partial_earliest_date(host, monkeypatch, bad_payload):
    install_history(monkeypatch, host, {"recent_YUI.json": payload("2026-10-01"), "recent_MIO.json": bad_payload})
    with pytest.raises(host.HistoryError, match="host_history_incomplete"):
        host.fetch_first_met()


def test_history_distinguishes_offline_empty_and_undated_records(host, monkeypatch):
    monkeypatch.setattr(host, "_get_json", lambda *args, **kwargs: None)
    with pytest.raises(host.HistoryError, match="host_history_unavailable"):
        host.fetch_first_met()
    install_history(monkeypatch, host, {})
    with pytest.raises(host.HistoryError, match="host_history_empty"):
        host.fetch_first_met()
    install_history(monkeypatch, host, {"recent_YUI.json": {"content": "[]"}})
    with pytest.raises(host.HistoryError, match="host_history_empty"):
        host.fetch_first_met()


def test_history_budget_never_reports_unscanned_roles_as_complete(host, monkeypatch):
    calls = install_history(monkeypatch, host, {"recent_YUI.json": payload("2026-10-01")})
    ticks = iter([0, 6])
    monkeypatch.setattr(host.time, "monotonic", lambda: next(ticks))
    with pytest.raises(host.HistoryError, match="host_history_incomplete"):
        host.fetch_first_met()
    assert calls == ["/api/memory/recent_files"]


def test_live_history_read_is_bounded_and_encodes_character(host, monkeypatch):
    calls = []

    def get(path, **kwargs):
        calls.append((path, kwargs))
        return {"content": json.dumps([message("2026-11-09")] * 600)}

    monkeypatch.setattr(host, "_get_json", get)
    assert len(host.fetch_recent_chat("A & B")) == 512
    assert "recent_A+%26+B.json" in calls[0][0]
    assert calls[0][1] == {"timeout": 2.0, "max_bytes": 8 * 1024 * 1024}


@pytest.mark.parametrize("payload", [None, {}, {"content": "broken"}, {"content": "{}"}])
def test_live_history_read_failure_does_not_return_an_empty_baseline(host, monkeypatch, payload):
    monkeypatch.setattr(host, "_get_json", lambda *args, **kwargs: payload)
    with pytest.raises(host.HistoryError):
        host.fetch_recent_chat("MS")
