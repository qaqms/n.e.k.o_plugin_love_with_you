from __future__ import annotations

import copy

import pytest


def test_shop_migration_and_roundtrip(shop):
    state = shop.normalize(None)
    assert state["coins"] == shop.WELCOME_COINS
    shop.buy(state, "cake")
    assert shop.normalize(state) == state
    assert shop.normalize({**state, "coins": 0})["coins"] == 0


def test_corrupt_economy_is_bounded_without_accepting_unknown_products(shop):
    state = shop.normalize({
        "coins": True, "inventory": {"cake": 999, "tea": -3, "arbitrary": 5},
        "history": [{"item_id": [], "id": []}, None, {"item_id": "cake", "id": "not a token"}],
        "gift_gain": 999, "revision": float("inf"), "claimed_day": "bad",
    })
    assert state["inventory"] == {"cake": 99, "tea": 0}
    assert state["history"] == []
    assert state["gift_gain"] == shop.DAILY_GIFT_GAIN
    assert state["revision"] == 1
    assert state["claimed_day"] == ""


def test_manual_claim_cannot_mint_more_coins(shop):
    state = shop.new_state()
    before = copy.deepcopy(state)
    for day in ["2026-11-07", "2026-11-06", "2026-11-08"]:
        with pytest.raises(shop.ShopError, match="shop_income_automatic"):
            shop.claim(state, day)
        assert state == before


def test_purchase_checks_price_and_capacity(shop):
    state = shop.new_state()
    state["coins"] = 0
    before = copy.deepcopy(state)
    with pytest.raises(shop.ShopError, match="shop_insufficient_coins"):
        shop.buy(state, "cake")
    assert state == before
    state["inventory"]["cake"] = 99
    state["coins"] = 100
    with pytest.raises(shop.ShopError, match="shop_inventory_full"):
        shop.buy(state, "cake")
    with pytest.raises(shop.ShopError, match="shop_item_not_found"):
        shop.buy(state, {"price": -100})


def test_replay_is_bound_to_operation_arguments_and_revision(shop):
    state = shop.new_state()
    signature = ["buy", "cake", ""]
    assert shop.replay(state, "request_00000001", 0, signature) is None
    result = shop.buy(state, "cake")
    shop.commit(state, "request_00000001", 0, signature, result)
    assert shop.replay(state, "request_00000001", 0, signature) == result
    with pytest.raises(shop.ShopError, match="shop_invalid_request"):
        shop.replay(state, "request_00000001", 0, ["buy", "plush", ""])
    with pytest.raises(shop.ShopError, match="shop_stale"):
        shop.replay(state, "request_00000002", 0, signature)
    state["receipts"] = []
    with pytest.raises(shop.ShopError, match="shop_stale"):
        shop.replay(state, "request_00000001", 0, signature)


@pytest.mark.parametrize("token,revision", [("", 0), ("short", 0), ("valid_000000000", True), ([], 0)])
def test_invalid_requests_do_not_mutate(shop, token, revision):
    state = shop.new_state()
    before = copy.deepcopy(state)
    with pytest.raises(shop.ShopError, match="shop_invalid_request"):
        shop.replay(state, token, revision, ["claim", "", ""])
    assert state == before


def test_gift_view_marks_unconfirmed_delivery_without_claiming_success(shop):
    state = shop.new_state()
    state["inventory"]["cake"] = 1
    gift = shop.record_gift(state, "request_00000001", "cake", "YUI", 2, 1000, "2026-11-07")
    gift.update(reaction="submitted", requested_at=1000, attempts=1)
    assert shop.view(state, "2026-11-07", 1010)["history"][0]["can_retry"] is False
    view = shop.view(state, "2026-11-07", 1130)
    assert view["history"][0]["reaction"] == "unknown"
    assert view["history"][0]["can_retry"] is True
    assert gift["reaction"] == "submitted"
    assert shop.gift_room(state, "2026-11-06") == 0
    assert shop.gift_room(state, "2026-11-08") == 4
