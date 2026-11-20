"""Cross-domain settlements run without SDK, model, filesystem or a live host."""

from __future__ import annotations

import copy
from datetime import datetime

import pytest


def setup_state(engine, shop, *, independent=False):
    state = engine.new_state()
    state["per_character"] = independent
    state["known_characters"] = ["YUI", "MIO"]
    state["current_character"] = "YUI"
    state["characters"] = {name: engine.new_record(10) for name in ["YUI", "MIO"]}
    state["shared"] = engine.new_record(10)
    state["shop"] = shop.new_state()
    state["shop"]["inventory"] = {"cake": 2}
    return state


def give(commerce, state, *, request_id="settlement_000001", revision=0, character="MIO", **kwargs):
    now = datetime.now().timestamp()
    return commerce.settle(
        state, "gift", request_id, revision, "cake", character,
        now=now, today=datetime.fromtimestamp(now).date().isoformat(), gate=True,
        **{"expected_gain": 2, "relationship_revision": 0, **kwargs},
    )


@pytest.mark.parametrize("independent", [False, True])
def test_gift_settlement_and_replay_keep_relationships_and_economy_together(engine, shop, commerce, independent):
    state = setup_state(engine, shop, independent=independent)
    result = give(commerce, state)
    target = state["characters"]["MIO"] if independent else state["shared"]
    assert not result.replayed
    assert result.result["applied"] == 2
    assert target["affection"] == 12
    assert state["characters"]["YUI"]["affection"] == 10
    assert state["shop"]["coins"] == 100
    assert state["shop"]["inventory"]["cake"] == 1
    assert len(state["shop"]["receipts"]) == 1
    assert state["shop"]["history"][0]["reaction"] == "pending"
    before = copy.deepcopy(state)
    replay = give(commerce, state)
    assert replay.replayed and replay.result == result.result
    assert state == before


def test_replay_precedes_changed_role_and_relationship_eligibility(engine, shop, commerce):
    state = setup_state(engine, shop, independent=True)
    settled = give(commerce, state)
    state["known_characters"] = ["YUI"]
    state["characters"]["MIO"]["gain_revision"] += 1
    state["shop"]["inventory"]["cake"] = 0
    before = copy.deepcopy(state)
    replay = give(commerce, state)
    assert replay.replayed and replay.result == settled.result
    assert state == before


@pytest.mark.parametrize("kwargs,code", [
    ({"character": "UNKNOWN"}, "shop_unknown_character"),
    ({"expected_gain": 1}, "shop_gain_changed"),
    ({"relationship_revision": 3}, "shop_gain_changed"),
    ({"gesture": 1}, "shop_invalid_request"),
    ({"expected_gain": True}, "shop_invalid_request"),
])
def test_invalid_gift_never_spends_existing_assets(engine, shop, commerce, kwargs, code):
    state = setup_state(engine, shop)
    before = copy.deepcopy(state)
    with pytest.raises(shop.ShopError, match=code):
        give(commerce, state, **kwargs)
    assert state == before


def test_gesture_settlement_keeps_affection_but_consumes_inventory_once(engine, shop, commerce):
    state = setup_state(engine, shop)
    result = give(commerce, state, expected_gain=0, gesture=True)
    assert result.result["applied"] == 0
    assert state["shared"]["affection"] == 10
    assert state["shop"]["inventory"]["cake"] == 1
    assert state["shop"]["gift_gain"] == 0
    assert give(commerce, state, expected_gain=0, gesture=True).replayed
    assert state["shop"]["inventory"]["cake"] == 1


def test_purchase_settlement_is_replayable_without_affection_changes(engine, shop, commerce):
    state = setup_state(engine, shop)
    now = datetime.now().timestamp()
    args = dict(
        action="buy", request_id="purchase_00000001", revision=0, item_id="tea",
        now=now, today=datetime.fromtimestamp(now).date().isoformat(), gate=True,
    )
    relationships = copy.deepcopy(state["shared"])
    result = commerce.settle(state, **args)
    assert result.result["quantity"] == 1 and not result.replayed
    assert state["shop"]["coins"] == 80
    assert state["shared"] == relationships
    assert commerce.settle(state, **args).replayed
    assert state["shop"]["coins"] == 80


def test_unknown_settlement_command_is_rejected_before_mutation(engine, shop, commerce):
    state = setup_state(engine, shop)
    before = copy.deepcopy(state)
    with pytest.raises(shop.ShopError, match="shop_invalid_request"):
        commerce.settle(state, "typo", "invalid_00000001", 0, now=1, today="2026-11-12", gate=True)
    assert state == before
