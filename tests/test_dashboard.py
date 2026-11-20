from __future__ import annotations

import copy
import time
from datetime import date

import pytest


def populated(engine, shop, experiences):
    state = engine.new_state()
    state["known_characters"] = ["YUI", "MIO"]
    state["current_character"] = "YUI"
    state["characters"] = {name: engine.new_record(45) for name in ["YUI", "MIO", "ARCHIVED"]}
    state["shared"] = engine.new_record(45)
    for record in [state["shared"], *state["characters"].values()]:
        record["history"] = [
            {"ts": index, "reason": f"Entry {index}", "delta": 1, "value": 45, "source": "auto"}
            for index in range(50)
        ]
        record["daily"] = {date.today().isoformat(): 45}
    state["shop"] = shop.new_state()
    state["experiences"] = experiences.new_state()
    record = experiences.new_record()
    record["memories"] = [{
        "id": "memory_0001", "title": "Title", "text": "Body", "status": "saved",
        "created_at": 1000, "recall": True,
    }]
    state["experiences"]["characters"]["YUI"] = record
    return state


@pytest.mark.parametrize("independent", [False, True])
def test_projection_preserves_record_views_and_omits_inactive_histories(
    engine, shop, experiences, dashboard_projection, independent,
):
    state = populated(engine, shop, experiences)
    state["per_character"] = independent
    today = date.today()
    detached = dashboard_projection.snapshot(state, today, time.time())
    payload = dashboard_projection.project(detached, today)
    names = ["YUI", "MIO"] if independent else [None]
    assert len(payload["scopes"]) == len(names)
    for name, shown in zip(names, payload["scopes"]):
        original = state["characters"][name] if name else state["shared"]
        expected = engine.record_view(original, history_limit=20, gate=True)
        assert all(shown[key] == value for key, value in expected.items())
        assert shown["trend"] == engine.trend_view(original, engine.TREND_DAYS, today)
        assert len(shown["history"]) == 20
    assert "records" not in payload
    assert "receipts" not in repr(payload)
    assert state["characters"]["ARCHIVED"]["history"][-1]["reason"] == "Entry 49"


def test_snapshot_never_copies_hidden_domains(engine, shop, experiences, dashboard_projection):
    class ForbiddenCopy:
        def __deepcopy__(self, memo):
            raise AssertionError("inactive data entered the panel snapshot")

    state = populated(engine, shop, experiences)
    state["characters"]["ARCHIVED"]["history"] = ForbiddenCopy()
    state["shop"]["receipts"] = ForbiddenCopy()
    state["experiences"]["receipts"] = ForbiddenCopy()
    detached = dashboard_projection.snapshot(state, date.today(), time.time())
    assert len(detached["records"]) == 1
    assert detached["records"][0][0] == "shared"


def test_panel_payload_has_no_aliases_back_to_live_state(engine, shop, experiences, dashboard_projection):
    state = populated(engine, shop, experiences)
    before = copy.deepcopy(state)
    detached = dashboard_projection.snapshot(state, date.today(), time.time())
    payload = dashboard_projection.project(detached, date.today())
    payload["scopes"][0]["history"][0]["reason"] = "Changed by view"
    payload["scopes"][0]["addressing"]["avoided"].append("Changed")
    payload["experiences"]["characters"]["YUI"]["memories"][0]["text"] = "Changed"
    payload["known_characters"].append("Changed")
    payload["settings"]["decay"] = True
    assert state == before
