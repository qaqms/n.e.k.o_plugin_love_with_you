"""Economy contracts: income facts, budgets, migration and daily source caps."""

from __future__ import annotations

import copy
import hashlib
from datetime import datetime

import pytest

START = datetime(2026, 11, 2, 12).timestamp()  # Monday, local calendar.


def event(day=0, index=0, *, user_at=None, text=None):
    timestamp = START + day * 86400 + index * 21 if user_at is None else user_at
    return {
        "id": hashlib.sha256(f"{day}:{index}:{timestamp}".encode()).hexdigest(),
        "text": hashlib.sha256((text or f"sentence {index}").encode()).hexdigest(),
        "user_at": timestamp, "reply_at": timestamp + 1,
    }


def participate(shop, state, day=0, turns=8):
    for index in range(turns):
        value = event(day, index)
        shop.accrue(state, value, value["reply_at"])


def claim_available(shop, state, day=0):
    now = START + day * 86400 + 1000
    today = datetime.fromtimestamp(now).date().isoformat()
    for reward in shop._rewards(state, today):
        if reward["ready"]:
            shop.claim(state, today, reward["reward"], reward["period"], now)


def test_daily_income_waits_for_three_independent_manual_claims_and_is_bounded(shop):
    state = shop.new_state()
    gains = []
    for index in range(12):
        value = event(index=index)
        gains.append(shop.accrue(state, value, value["reply_at"]))
    assert gains == [0] * 12
    assert state["coins"] == 100 and state["income_total"] == 0 and not state["ledger"]
    assert state["days"]["2026-11-02"]["count"] == 8
    for threshold in [8, 1, 3]:
        assert shop.claim(state, "2026-11-02", f"daily_{threshold}", "2026-11-02", START + 1000)["credited"] == 10
        state = shop.normalize(state)
        with pytest.raises(shop.ShopError, match="shop_already_claimed"):
            shop.claim(state, "2026-11-02", f"daily_{threshold}", "2026-11-02")
    assert state["coins"] == 130 and state["income_total"] == 30
    assert [entry["source"] for entry in state["ledger"]] == ["daily_8", "daily_1", "daily_3"]


def test_replays_repeated_text_and_fast_exchanges_do_not_add_progress(shop):
    state = shop.new_state()
    first = event()
    shop.accrue(state, first, first["reply_at"])
    after = copy.deepcopy(state)
    shop.accrue(state, first, first["reply_at"] + 30)
    assert state == after
    for value in [event(index=1, text="sentence 0"), event(index=2, user_at=START + 3)]:
        shop.accrue(state, value, START + 50)
    assert state["days"]["2026-11-02"]["count"] == 1
    value = event(index=3)
    shop.accrue(state, value, value["reply_at"])
    assert state["days"]["2026-11-02"]["count"] == 2


def test_nonconsecutive_active_days_grant_weekly_reward_once(shop):
    state = shop.new_state()
    for day in [0, 2, 4, 6]:
        participate(shop, state, day, 3)
        claim_available(shop, state, day)
    assert state["coins"] == 100 + 4 * 20 + 40
    assert state["weeks"]["2026-11-02"]["paid"]
    assert len([entry for entry in state["ledger"] if entry["source"] == "weekly"]) == 1
    participate(shop, state, 7, 3)
    assert state["weeks"]["2026-11-09"]["days"] == ["2026-11-09"]
    assert not state["weeks"]["2026-11-09"]["paid"]


def test_full_week_budget_and_roundtrip_are_exact(shop):
    state = shop.new_state()
    for day in range(7):
        participate(shop, state, day)
        claim_available(shop, state, day)
        state = shop.normalize(state, "2026-11-08")
    assert state["coins"] == 350
    assert state["income_total"] == 250
    assert shop.normalize(state) == state
    assert len(state["days"]) == 2


def test_clock_rollback_cannot_create_a_new_day_or_allowance(shop):
    state = shop.new_state()
    participate(shop, state, 2)
    after = copy.deepcopy(state)
    old = event(1)
    shop.accrue(state, old, old["reply_at"])
    assert state == after
    assert shop.gift_room(state, "2026-11-03") == 0
    assert not shop.gesture_room(state, "2026-11-03")
    assert shop.view(state, "2026-11-03", old["reply_at"])["income"]["clock_error"]


def test_out_of_order_events_still_obey_gap_against_all_counted_turns(shop):
    state = shop.new_state()
    for index, seconds in enumerate([0, 60, 30, 61]):
        value = event(index=index, user_at=START + seconds)
        shop.accrue(state, value, START + 100)
    assert state["days"]["2026-11-02"]["count"] == 3
    assert state["coins"] == 100


def test_midnight_reply_makes_original_user_day_claimable(shop):
    state = shop.new_state()
    user_at = datetime(2026, 11, 8, 23, 59, 55).timestamp()
    value = event(user_at=user_at)
    value["reply_at"] = user_at + 15
    shop.accrue(state, value, value["reply_at"])
    assert state["days"]["2026-11-08"]["count"] == 1
    assert shop.view(state, "2026-11-09", value["reply_at"])["income"]["earned"] == 0
    assert state["coins"] == 100 and not state["ledger"]
    pending = shop.view(state, "2026-11-09", value["reply_at"])["income"]["pending"]
    assert pending == [{"reward": "daily_1", "period": "2026-11-08", "coins": 10, "claimed": False, "ready": True}]
    shop.claim(state, "2026-11-09", "daily_1", "2026-11-08", value["reply_at"])
    assert state["ledger"][-1]["day"] == "2026-11-08"
    before = state["coins"]
    shop.accrue(state, event(day=-5), START)
    assert state["coins"] == before


def test_late_sunday_can_complete_previous_week_without_reusing_new_week(shop):
    state = shop.new_state()
    for day in [0, 2, 4]:
        participate(shop, state, day, 3)
    sunday = datetime(2026, 11, 8, 23, 57).timestamp()
    for index in range(3):
        value = event(6, index, user_at=sunday + index * 21)
        value["reply_at"] = datetime(2026, 11, 9, 0, 1).timestamp()
        shop.accrue(state, value, value["reply_at"])
    assert not state["weeks"]["2026-11-02"]["paid"] and state["coins"] == 100
    assert shop.view(state, "2026-11-09", value["reply_at"])["income"]["weekly_days"] == 0
    result = shop.claim(state, "2026-11-09", "weekly", "2026-11-02", value["reply_at"])
    assert result["credited"] == 40
    assert state["weeks"]["2026-11-02"]["paid"]
    assert "2026-11-09" not in state["weeks"]


def test_legacy_claim_migration_preserves_assets_and_covers_daily_rewards(shop):
    state = shop.normalize({
        "coins": 67, "inventory": {"plush": 2}, "claimed_day": "2026-11-02", "revision": 5,
        "gift_day": "2026-11-02", "gift_gain": 6,
    }, "2026-11-02")
    assert state["coins"] == 67 and state["inventory"] == {"plush": 2}
    assert state["revision"] == 6
    assert shop.gift_room(state, "2026-11-02") == 0
    participate(shop, state)
    assert state["coins"] == 67
    assert state["days"]["2026-11-02"]["paid"] == 3
    assert state["weeks"]["2026-11-02"]["days"] == ["2026-11-02"]
    assert shop.normalize(state) == state


def test_ledger_history_is_not_reward_authority(shop):
    state = shop.new_state()
    participate(shop, state)
    claim_available(shop, state)
    for index in range(150):
        state["coins"] += 20
        shop.buy(state, "tea", START + index, f"purchase_{index:06}")
        state["inventory"]["tea"] = 0
    assert len(state["ledger"]) == shop.LEDGER_LIMIT
    before = state["coins"]
    participate(shop, state)
    assert state["coins"] == before
    assert state["days"]["2026-11-02"]["paid"] == 3


def test_untrusted_economy_namespaces_do_not_recreate_welcome_money(shop):
    state = shop.normalize({"coins": [], "ledger": [
        {"id": "bad", "source": [], "amount": 1, "ts": START},
        {"id": "valid", "source": "purchase", "amount": -1, "ts": START, "item_id": []},
    ], "days": {"bad": []}, "weeks": {"bad": []}})
    assert state["coins"] == 0
    assert state["ledger"][0]["item_id"] == ""


def test_upgrade_from_automatic_income_never_repays_completed_steps(shop):
    state = shop.new_state()
    participate(shop, state, turns=3)
    progress = state["days"]["2026-11-02"]
    del progress["claimed"]
    progress.update(paid=2, earned=20)
    state.update(coins=120, income_total=20)
    state = shop.normalize(state)
    assert state["days"]["2026-11-02"]["claimed"] == [1, 3]
    assert not shop.view(state, "2026-11-02", START)["can_claim"]
    before = copy.deepcopy(state)
    with pytest.raises(shop.ShopError, match="shop_already_claimed"):
        shop.claim(state, "2026-11-02", "daily_3", "2026-11-02")
    assert state == before
    participate(shop, state)
    claim_available(shop, state)
    assert state["coins"] == 130 and state["income_total"] == 30


def test_claim_expiry_is_checked_without_new_chat_and_view_is_read_only(shop):
    state = shop.new_state()
    for day in range(4):
        participate(shop, state, day)
    before = copy.deepcopy(state)
    view = shop.view(state, "2026-11-09", START + 7 * 86400)
    assert view["income"]["pending"] == [{
        "reward": "weekly", "period": "2026-11-02", "coins": 40, "claimed": False, "ready": True,
    }]
    assert state == before
    for today, reward, period in [
        ("2026-11-06", "daily_1", "2026-11-04"),
        ("2026-11-16", "weekly", "2026-11-02"),
        ("2026-11-05", "daily_8", "2026-11-06"),
        ("2026-11-05", [], "2026-11-05"),
        ("2026-11-05", "daily_1", []),
    ]:
        with pytest.raises(shop.ShopError, match="shop_invalid_request"):
            shop.claim(state, today, reward, period)
        assert state == before
    assert not shop.view(state, "2026-11-16", START + 14 * 86400)["can_claim"]


def test_unearned_and_clock_rollback_claims_cannot_change_state(shop):
    state = shop.new_state()
    participate(shop, state, turns=1)
    before = copy.deepcopy(state)
    for today, reward, period in [
        ("2026-11-02", "daily_3", "2026-11-02"),
        ("2026-11-02", "weekly", "2026-11-02"),
        ("2026-11-01", "daily_1", "2026-11-02"),
    ]:
        with pytest.raises(shop.ShopError, match="shop_reward_unavailable"):
            shop.claim(state, today, reward, period)
        assert state == before


def test_arbitrary_claim_order_stays_independent_after_normalization(shop):
    state = shop.new_state()
    participate(shop, state)
    shop.claim(state, "2026-11-02", "daily_8", "2026-11-02", START + 500)
    state = shop.normalize(state)
    steps = shop.view(state, "2026-11-02", START + 501)["income"]["steps"]
    assert [step["claimed"] for step in steps] == [False, False, True]
    assert [step["ready"] for step in steps] == [True, True, False]
    claim_available(shop, state)
    assert state["coins"] == 130
    assert state["days"]["2026-11-02"]["claimed"] == [1, 3, 8]


def test_gesture_uses_inventory_without_gain_and_is_once_daily(shop):
    state = shop.new_state()
    state["inventory"]["tea"] = 3
    shop.record_gift(state, "gesture_00000001", "tea", "YUI", 0, START, "2026-11-02", gesture=True)
    assert state["inventory"]["tea"] == 2 and state["gift_gain"] == 0
    before = copy.deepcopy(state)
    with pytest.raises(shop.ShopError, match="shop_gesture_limit"):
        shop.record_gift(state, "gesture_00000002", "tea", "MIO", 0, START, "2026-11-02", gesture=True)
    assert state == before
    assert shop.gesture_room(state, "2026-11-03")


def test_gift_records_date_high_water_before_restart(shop):
    state = shop.new_state()
    state["inventory"]["tea"] = 1
    shop.record_gift(state, "gift_date_000001", "tea", "YUI", 1, START + 86400, "2026-11-03")
    assert shop.gift_room(state, "2026-11-02") == 0
    assert shop.view(state, "2026-11-02", START)["income"]["clock_error"]


def test_chat_and_gift_budgets_are_separate_and_losses_do_not_refill(engine):
    record = engine.new_record(40, now=START)
    assert engine.apply_model_delta(record, 5, "chat", START, cooldown=0)["applied"] == 4
    assert engine.apply_model_delta(record, 4, "gift", START, source="gift", cooldown=0)["applied"] == 4
    assert record["gained_today"] == 8
    assert record["gained_chat"] == 4 and record["gained_gift"] == 4
    engine.apply_model_delta(record, -3, "hurt", START + 30, cooldown=0)
    assert engine.gain_room(record, "auto", START + 31) == 0
    assert engine.gain_room(record, "gift", START + 31) == 0
    assert engine.gain_room(record, "auto", START + 86400) == 4


def test_legacy_relationship_quota_is_blocked_for_original_day_only(engine):
    raw = {"affection": 40, "day": "2026-11-02", "gained_today": 3}
    record = engine.normalize_record(raw, now=START)
    assert engine.gain_room(record, "gift", START) == 0
    assert engine.gain_room(record, "auto", START) == 0
    assert engine.normalize_record(record, now=START) == record
    assert engine.gain_room(record, "auto", START + 86400) == 4


def test_relationship_clock_rollback_and_mode_switch_do_not_refill(engine):
    state = engine.new_state()
    state["shared"] = engine.new_record(40, now=START)
    state["characters"]["YUI"] = engine.new_record(10, now=START)
    engine.apply_model_delta(state["characters"]["YUI"], 4, "chat", START, cooldown=0)
    engine.set_per_character(state, True, "YUI")
    record = state["characters"]["YUI"]
    assert record["affection"] == 40
    assert engine.gain_room(record, "auto", START) == 0
    engine.set_per_character(state, False, "YUI")
    assert engine.gain_room(state["shared"], "auto", START) == 0
    assert engine.apply_model_delta(record, 3, "old day", START - 86400, cooldown=0)["applied"] == 0
    assert record["day"] == "2026-11-02"


def test_gifts_do_not_start_chat_tool_cooldown(engine):
    record = engine.new_record(30, now=START)
    engine.apply_model_delta(record, 2, "gift", START, source="gift", cooldown=0)
    assert record["last_model_ts"] is None
    assert engine.apply_model_delta(record, 2, "chat", START + 1)["applied"] == 2


@pytest.mark.parametrize("turns,chat,expected", [(3, 2, 23), (8, 3, 16), (8, 4, 13), (8, 0, 42)])
def test_real_rules_reproduce_design_pacing(shop, engine, turns, chat, expected):
    state = shop.new_state()
    record = engine.new_record(now=START)
    for day in range(60):
        participate(shop, state, day, turns)
        claim_available(shop, state, day)
        now = START + day * 86400 + 1000
        today = datetime.fromtimestamp(now).date().isoformat()
        if chat:
            engine.apply_model_delta(record, chat, "chat", now, cooldown=0, gate=True)
        for index in range(4):
            if state["coins"] < 20 or not shop.gift_room(state, today) or not engine.gain_room(record, "gift", now):
                break
            shop.buy(state, "tea", now, f"buy_{day:04}_{index:04}")
            result = engine.apply_model_delta(record, 1, "gift", now, cooldown=0, source="gift", gate=True)
            shop.record_gift(state, f"gift_{day:04}_{index:04}", "tea", "YUI", result["applied"], now, today)
        if record["affection"] >= 80:
            assert day + 1 == expected
            assert record["stage"] == "ambiguous" and not record["confessed"]
            return
    pytest.fail("never reached the threshold")


def test_income_fingerprint_uses_full_text_and_normalizes_punctuation(conv):
    assert conv.income_digest("Hello! ") == conv.income_digest("ｈｅｌｌｏ。")
    assert conv.income_digest("...！？") == ""
    prefix = "x" * 400
    def parse(text):
        return conv.parse_record({
            "turn_type": "user_message", "lanlan_name": "YUI", "content": text, "timestamp": START,
        })
    assert parse(prefix + "a").content == parse(prefix + "b").content
    assert parse(prefix + "a").income_text != parse(prefix + "b").income_text
    tracker = conv.ExchangeTracker()
    tracker.feed(parse("今天好开心"))
    result = tracker.feed(conv.Message(START + 1, "reply", "YUI", "我也是"))
    assert result.income_event["user_at"] == START
    assert conv.parse_record({
        "turn_type": "assistant_message", "lanlan_name": "YUI", "content": "thanks",
        "timestamp": START, "metadata": {"event_type": "gift_received"},
    }) is None
