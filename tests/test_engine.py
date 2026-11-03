from __future__ import annotations

import pytest

DAY = 1_750_000_000.0  # fixed timestamp; all calls within one local day


def _record(engine, value: int, stage: str | None = None):
    record = engine.new_record(value, now=DAY)
    if stage:
        record["stage"] = stage
    return record


# ------------------------------------------------------------ stages


@pytest.mark.parametrize(
    ("value", "stage"),
    [
        (0, "stranger"),
        (19, "stranger"),
        (20, "familiar"),
        (59, "fond"),
        (60, "ambiguous"),
        (80, "lover"),
        (100, "lover"),
    ],
)
def test_raw_stage_boundaries(engine, value, stage):
    assert engine.raw_stage_for(value) == stage


def test_promotion_is_immediate(engine):
    assert engine.resolve_stage("fond", 60) == "ambiguous"


def test_demotion_waits_for_margin(engine):
    # Lover lower bound is 80; margin 5 keeps the stage down to 75.
    assert engine.resolve_stage("lover", 75) == "lover"
    assert engine.resolve_stage("lover", 74) == "ambiguous"


def test_large_drop_skips_multiple_stages(engine):
    assert engine.resolve_stage("lover", 30) == "familiar"
    assert engine.resolve_stage("lover", 14) == "stranger"


# ------------------------------------------------------------ model deltas


def test_delta_is_clamped_per_call(engine):
    record = _record(engine, 50)
    result = engine.apply_model_delta(record, 9, "很温柔", now=DAY)
    assert result["applied"] == 5
    assert result["limited_by"] == "per_call"
    assert record["affection"] == 55


GAP = 150  # past MODEL_COOLDOWN_SECONDS, same local day


def test_daily_gain_cap(engine):
    record = _record(engine, 10)
    applied = [engine.apply_model_delta(record, 5, "好", now=DAY + i * GAP)["applied"] for i in range(4)]
    assert applied == [5, 5, 5, 0]
    assert record["affection"] == 25
    assert record["gained_today"] == 15


def test_daily_cap_resets_next_day(engine):
    record = _record(engine, 10)
    for i in range(3):
        engine.apply_model_delta(record, 5, "好", now=DAY + i * GAP)
    result = engine.apply_model_delta(record, 5, "好", now=DAY + 86_400)
    assert result["applied"] == 5


def test_losses_can_demote(engine):
    record = _record(engine, 80, "lover")
    applied = [engine.apply_model_delta(record, -5, "冷淡", now=DAY + i * GAP)["applied"] for i in range(3)]
    # First loss of the day is halved; the margin keeps "lover" down to 75.
    assert applied == [-2, -5, -5]
    assert record["affection"] == 68
    assert record["stage"] == "ambiguous"


def test_bounds(engine):
    record = _record(engine, 2)
    result = engine.apply_model_delta(record, -5, "失约", now=DAY)
    assert result["applied"] == -2
    assert record["affection"] == 0


def test_reason_required(engine):
    record = _record(engine, 50)
    with pytest.raises(engine.EngineError) as info:
        engine.apply_model_delta(record, 3, "   ", now=DAY)
    assert info.value.code == "reason_required"
    assert record["affection"] == 50


def test_invalid_delta(engine):
    with pytest.raises(engine.EngineError) as info:
        engine.apply_model_delta(_record(engine, 50), "lots", "x", now=DAY)
    assert info.value.code == "invalid_delta"


def test_history_is_bounded_and_skips_zero(engine):
    record = _record(engine, 50)
    engine.apply_model_delta(record, 0, "闲聊", now=DAY)
    assert record["history"] == []
    for i in range(engine.HISTORY_LIMIT + 10):
        engine.apply_model_delta(record, 1 if i % 2 else -1, f"r{i}", now=DAY + i * 86_400)
    assert len(record["history"]) == engine.HISTORY_LIMIT


# ------------------------------------------------------------ manual set


def test_manual_set_ignores_caps_and_hysteresis(engine):
    record = _record(engine, 80, "lover")
    result = engine.set_affection(record, 77, now=DAY)
    assert record["stage"] == "ambiguous"
    assert result["stage_changed"] is True
    assert record["history"][-1]["source"] == "manual"


def test_reset_records_entry_even_at_zero(engine):
    record = _record(engine, 0)
    engine.set_affection(record, 0, source="reset", now=DAY)
    assert record["history"][-1]["source"] == "reset"


# ------------------------------------------------------------ per-character mode


def _state_with(engine, shared_value: int):
    state = engine.new_state()
    state["shared"] = _record(engine, shared_value)
    state["known_characters"] = ["小八", "小九"]
    return state


def test_enable_keeps_current_and_starts_others_fresh(engine):
    state = _state_with(engine, 66)
    engine.set_per_character(state, True, "小八")
    assert state["characters"]["小八"]["affection"] == 66
    other = engine.get_record(state, engine.CHAR_SCOPE_PREFIX + "小九")
    assert other["affection"] == 0


def test_disable_keeps_independent_records(engine):
    state = _state_with(engine, 40)
    engine.set_per_character(state, True, "小八")
    engine.get_record(state, engine.CHAR_SCOPE_PREFIX + "小九")["affection"] = 90
    state["characters"]["小八"]["affection"] = 55
    engine.set_per_character(state, False, "小八")
    assert state["shared"]["affection"] == 55
    assert state["characters"]["小九"]["affection"] == 90


def test_reenable_restores_other_characters(engine):
    state = _state_with(engine, 40)
    engine.set_per_character(state, True, "小八")
    engine.get_record(state, engine.CHAR_SCOPE_PREFIX + "小九")["affection"] = 90
    engine.set_per_character(state, False, "小八")
    state["shared"]["affection"] = 30  # shared value moved on while off
    engine.set_per_character(state, True, "小八")
    assert state["characters"]["小八"]["affection"] == 30
    assert state["characters"]["小九"]["affection"] == 90


def test_switch_requires_current_character(engine):
    state = _state_with(engine, 40)
    with pytest.raises(engine.EngineError) as info:
        engine.set_per_character(state, True, None)
    assert info.value.code == "current_character_unknown"
    assert state["per_character"] is False


def test_switch_to_same_mode_is_noop(engine):
    state = _state_with(engine, 40)
    assert engine.set_per_character(state, False, None) == {"changed": False, "per_character": False}


# ------------------------------------------------------------ normalization


def test_normalize_rejects_garbage(engine):
    state = engine.normalize_state(
        {
            "per_character": "yes",
            "shared": {"affection": 999, "stage": "bogus", "gained_today": -3, "history": ["x", {"delta": 1}]},
            "characters": {"": {}, "小八": "bad"},
            "known_characters": ["小八", "小八", 3],
        }
    )
    assert state["per_character"] is False
    assert state["shared"]["affection"] == 100
    assert state["shared"]["stage"] == "lover"
    assert state["shared"]["gained_today"] == 0
    assert state["shared"]["history"] == [{"delta": 1}]
    assert list(state["characters"]) == ["小八"]
    assert state["known_characters"] == ["小八"]


def test_normalize_keeps_stage_inside_margin(engine):
    record = engine.normalize_record({"affection": 77, "stage": "lover"})
    assert record["stage"] == "lover"
    record = engine.normalize_record({"affection": 70, "stage": "lover"})
    assert record["stage"] == "ambiguous"


# ------------------------------------------------------------ relationship details (v2)


def test_new_record_has_relationship_fields(engine):
    record = engine.new_record(now=DAY)
    assert record["first_met"] == engine.today_str(DAY)
    assert record["milestones"] == {} and record["nicknames"] == {}


def test_promotion_records_every_skipped_milestone_once(engine):
    record = _record(engine, 0)
    engine.set_affection(record, 65, now=DAY)
    day = engine.today_str(DAY)
    assert record["milestones"] == {"familiar": day, "fond": day, "ambiguous": day}
    engine.set_affection(record, 0, now=DAY + 86400 * 3)
    engine.set_affection(record, 90, now=DAY + 86400 * 5)
    # Earlier dates survive demotion and re-promotion; only "lover" is new.
    assert record["milestones"]["familiar"] == day
    assert record["milestones"]["lover"] == engine.today_str(DAY + 86400 * 5)


def test_model_delta_records_milestone(engine):
    record = _record(engine, 18)
    engine.apply_model_delta(record, 3, "认真听我说话", now=DAY)
    assert record["stage"] == "familiar"
    assert record["milestones"] == {"familiar": engine.today_str(DAY)}


def test_effective_nickname_inherits_from_lower_stage(engine):
    record = _record(engine, 65)
    engine.set_nicknames(record, {"familiar": "小笨蛋", "lover": "亲爱的"})
    assert engine.effective_nickname(record) == "小笨蛋"
    assert engine.effective_nickname(record, "lover") == "亲爱的"
    assert engine.effective_nickname(record, "stranger") == ""


def test_set_nicknames_cleans_and_validates(engine):
    record = _record(engine, 0)
    cleaned = engine.set_nicknames(record, {"fond": "  宝\n贝  ", "lover": "", "familiar": "x" * 40})
    assert cleaned == {"fond": "宝 贝", "familiar": "x" * engine.NICKNAME_MAX_CHARS}
    with pytest.raises(engine.EngineError) as info:
        engine.set_nicknames(record, {"boss": "老板"})
    assert info.value.code == "invalid_nicknames"
    with pytest.raises(engine.EngineError):
        engine.set_nicknames(record, ["not", "a", "dict"])


def test_set_first_met_validation(engine):
    record = _record(engine, 0)
    assert engine.set_first_met(record, "2025-02-14", now=DAY) == "2025-02-14"
    for value, code in (
        ("2025/02/14", "invalid_date"),
        ("2099-01-01", "date_in_future"),
        ("1900-01-01", "date_too_old"),
    ):
        with pytest.raises(engine.EngineError) as info:
            engine.set_first_met(record, value, now=DAY)
        assert info.value.code == code
    assert record["first_met"] == "2025-02-14"


def test_anniversary_add_remove_and_limits(engine):
    state = engine.new_state()
    item = engine.add_anniversary(state, " 主人的生日 ", 2, 29)
    assert item["title"] == "主人的生日" and len(item["id"]) == 12
    with pytest.raises(engine.EngineError) as info:
        engine.add_anniversary(state, "坏日期", 4, 31)
    assert info.value.code == "invalid_date"
    with pytest.raises(engine.EngineError) as info:
        engine.add_anniversary(state, "   ", 1, 1)
    assert info.value.code == "title_required"
    assert engine.remove_anniversary(state, item["id"]) is True
    assert engine.remove_anniversary(state, item["id"]) is False
    for i in range(engine.ANNIVERSARY_LIMIT):
        engine.add_anniversary(state, f"日子{i}", 1, 1)
    with pytest.raises(engine.EngineError) as info:
        engine.add_anniversary(state, "多一个", 1, 2)
    assert info.value.code == "too_many"


def test_v1_state_migrates_without_losing_data(engine):
    v1_record = {
        "affection": 70,
        "stage": "ambiguous",
        "day": "2025-06-01",
        "gained_today": 3,
        "lost_today": 0,
        "history": [{"ts": DAY - 86400 * 10, "delta": 3, "value": 70, "reason": "r", "source": "model"}],
        "updated_at": DAY,
    }
    state = engine.normalize_state({"version": 1, "per_character": False, "shared": v1_record, "characters": {}})
    shared = state["shared"]
    assert shared["affection"] == 70 and shared["stage"] == "ambiguous"
    assert shared["first_met"] == engine.today_str(DAY - 86400 * 10)
    # Dates are never invented for stages reached before v2.
    assert shared["milestones"] == {} and shared["nicknames"] == {}
    assert state["anniversaries"] == []


def test_normalize_drops_bad_relationship_fields(engine):
    raw = {
        "shared": {
            "affection": 10,
            "first_met": "nope",
            "milestones": {"lover": "2025-01-01", "stranger": "2025-01-01", "fond": "bad"},
            "nicknames": {"lover": "亲爱的", "boss": "x", "fond": "  "},
        },
        "anniversaries": [
            {"id": "aaaaaaaaaaaa", "title": "a", "month": 1, "day": 1},
            {"id": "aaaaaaaaaaaa", "title": "dup", "month": 1, "day": 2},
            {"title": "no id", "month": 2, "day": 3},
            {"title": "bad", "month": 2, "day": 30},
        ],
    }
    state = engine.normalize_state(raw)
    shared = state["shared"]
    assert shared["milestones"] == {"lover": "2025-01-01"}
    assert shared["nicknames"] == {"lover": "亲爱的"}
    assert [a["title"] for a in state["anniversaries"]] == ["a", "no id"]


def test_per_character_copy_carries_relationship_fields(engine):
    state = engine.new_state()
    engine.set_nicknames(state["shared"], {"lover": "亲爱的"})
    engine.set_first_met(state["shared"], "2025-01-01", now=DAY)
    engine.set_per_character(state, True, "YUI")
    assert state["characters"]["YUI"]["nicknames"] == {"lover": "亲爱的"}
    assert state["characters"]["YUI"]["first_met"] == "2025-01-01"
    engine.set_nicknames(state["characters"]["YUI"], {})
    assert state["shared"]["nicknames"] == {"lover": "亲爱的"}  # deep copy, not shared


def test_record_view_includes_nickname(engine):
    record = _record(engine, 85)
    engine.set_nicknames(record, {"fond": "宝贝"})
    view = engine.record_view(record)
    assert view["nickname"] == "宝贝" and view["nicknames"] == {"fond": "宝贝"}
