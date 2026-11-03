"""Phase 3: cooldown, first-loss grace, confession gate, decay, daily trend, settings."""

from __future__ import annotations

from datetime import date

import pytest

DAY = 1_750_000_000.0
GAP = 150
ONE_DAY = 86_400


def _record(engine, value: int, stage: str | None = None, confessed: bool | None = None):
    record = engine.new_record(value, now=DAY)
    if stage:
        record["stage"] = stage
        record["confessed"] = stage == "lover"
    if confessed is not None:
        record["confessed"] = confessed
    return record


# ------------------------------------------------------------ cooldown


def test_same_direction_within_cooldown_is_ignored(engine):
    record = _record(engine, 50)
    assert engine.apply_model_delta(record, 3, "温柔", now=DAY)["applied"] == 3
    second = engine.apply_model_delta(record, 3, "还是温柔", now=DAY + 30)
    assert second["applied"] == 0 and second["limited_by"] == "cooldown"
    assert record["affection"] == 53 and len(record["history"]) == 1
    assert engine.apply_model_delta(record, 3, "又一次", now=DAY + GAP)["applied"] == 3


def test_opposite_direction_is_not_blocked(engine):
    record = _record(engine, 50)
    engine.apply_model_delta(record, 3, "温柔", now=DAY)
    assert engine.apply_model_delta(record, -4, "失约", now=DAY + 10)["applied"] == -2


def test_capped_call_does_not_restart_cooldown(engine):
    record = _record(engine, 10)
    for i in range(3):
        engine.apply_model_delta(record, 5, "好", now=DAY + i * GAP)
    stamp = record["last_model_ts"]
    assert engine.apply_model_delta(record, 5, "好", now=DAY + 3 * GAP)["limited_by"] == "daily_gain"
    assert record["last_model_ts"] == stamp


def test_cooldown_can_be_disabled(engine):
    record = _record(engine, 10)
    applied = [engine.apply_model_delta(record, 2, "好", now=DAY, cooldown=0)["applied"] for _ in range(3)]
    assert applied == [2, 2, 2]


# ------------------------------------------------------------ first-loss grace


@pytest.mark.parametrize(("delta", "first"), [(-5, -2), (-4, -2), (-3, -1), (-2, -1), (-1, -1)])
def test_first_loss_of_day_is_halved(engine, delta, first):
    record = _record(engine, 50)
    result = engine.apply_model_delta(record, delta, "冷淡", now=DAY)
    assert result["applied"] == first
    assert result["limited_by"] in (None, "grace")


def test_grace_resets_next_day(engine):
    record = _record(engine, 50)
    engine.apply_model_delta(record, -5, "冷淡", now=DAY)
    assert engine.apply_model_delta(record, -5, "冷淡", now=DAY + GAP)["applied"] == -5
    assert engine.apply_model_delta(record, -5, "冷淡", now=DAY + ONE_DAY)["applied"] == -2


# ------------------------------------------------------------ confession gate


def test_gate_holds_at_ambiguous(engine):
    record = _record(engine, 78, "ambiguous")
    result = engine.apply_model_delta(record, 5, "心动", now=DAY, gate=True)
    assert record["affection"] == 83 and result["stage"] == "ambiguous"
    assert engine.awaiting_confession(record, True) is True
    assert "lover" not in record["milestones"]
    view = engine.record_view(record, gate=True)
    assert view["awaiting_confession"] is True and view["next_stage"] == "lover" and view["points_to_next"] == 0


def test_without_gate_promotes_and_marks_confessed(engine):
    record = _record(engine, 78, "ambiguous")
    engine.apply_model_delta(record, 5, "心动", now=DAY)
    assert record["stage"] == "lover" and record["confessed"] is True
    assert record["confessed_on"] is None  # no confession moment, only the stage


def test_confess_opens_the_gate(engine):
    record = _record(engine, 85, "ambiguous")
    result = engine.confess(record, "  在樱花树下说喜欢你\n", now=DAY)
    assert result["stage_changed"] and result["stage"] == "lover"
    assert record["confessed_on"] == engine.today_str(DAY)
    assert record["confession"] == "在樱花树下说喜欢你"
    assert record["milestones"]["lover"] == engine.today_str(DAY)
    assert record["history"][-1]["source"] == "confession"
    assert engine.awaiting_confession(record, True) is False


def test_confess_requires_threshold_and_only_once(engine):
    low = _record(engine, 79, "ambiguous")
    with pytest.raises(engine.EngineError) as info:
        engine.confess(low, "早了", now=DAY)
    assert info.value.code == "not_ready" and low["confessed"] is False
    record = _record(engine, 90, "ambiguous")
    engine.confess(record, "", now=DAY)
    with pytest.raises(engine.EngineError) as info:
        engine.confess(record, "", now=DAY)
    assert info.value.code == "already_confessed"


def test_after_confession_demotion_and_return_need_no_second_confession(engine):
    record = _record(engine, 85, "ambiguous")
    engine.confess(record, "", now=DAY)
    engine.set_affection(record, 60, now=DAY, gate=True)
    assert record["stage"] == "ambiguous"
    engine.set_affection(record, 82, now=DAY, gate=True)
    assert record["stage"] == "lover"


def test_manual_set_respects_gate(engine):
    record = _record(engine, 10)
    engine.set_affection(record, 95, now=DAY, gate=True)
    assert record["stage"] == "ambiguous"


def test_existing_lovers_count_as_confessed(engine):
    state = engine.normalize_state({"shared": {"affection": 90, "stage": "lover"}})
    assert state["shared"]["confessed"] is True and state["shared"]["stage"] == "lover"
    assert state["settings"] == {"require_confession": True, "decay": False, "auto_score": True}


# ------------------------------------------------------------ settings


def test_turning_gate_off_promotes_waiting_records(engine):
    state = engine.new_state()
    state["shared"] = _record(engine, 88, "ambiguous")
    result = engine.update_settings(state, {"require_confession": False}, now=DAY)
    assert result["stage_changes"] == [{"scope": "shared", "from": "ambiguous", "to": "lover"}]
    assert state["shared"]["confessed"] is True
    # Turning it back on never takes "lover" away.
    assert engine.update_settings(state, {"require_confession": True}, now=DAY)["stage_changes"] == []
    assert state["shared"]["stage"] == "lover"


def test_bad_settings_rejected(engine):
    state = engine.new_state()
    for changes in ({}, {"decay": "yes"}, {"volume": True}, ["decay"]):
        with pytest.raises(engine.EngineError) as info:
            engine.update_settings(state, changes, now=DAY)
        assert info.value.code == "invalid_settings"
    assert state["settings"] == engine.DEFAULT_SETTINGS


def test_enabling_decay_starts_the_clock_today(engine):
    state = engine.new_state()
    state["shared"] = _record(engine, 50)
    state["shared"]["last_active"] = "2020-01-01"
    state["shared"]["decay_checked"] = "2020-01-01"
    engine.update_settings(state, {"decay": True}, now=DAY)
    assert state["shared"]["last_active"] == engine.today_str(DAY)
    assert engine.apply_decay(state["shared"], True, now=DAY + 2 * ONE_DAY) == 0


# ------------------------------------------------------------ decay


def test_decay_waits_for_grace_then_drifts_to_floor(engine):
    record = _record(engine, 47, "fond")  # floor 40
    removed = [engine.apply_decay(record, True, now=DAY + d * ONE_DAY) for d in range(1, 12)]
    grace = engine.DECAY_GRACE_DAYS
    assert removed[:grace] == [0] * grace
    assert sum(removed) == 7 and record["affection"] == 40 and record["stage"] == "fond"
    assert record["history"][-1]["source"] == "decay"


def test_decay_never_crosses_a_stage(engine):
    record = _record(engine, 80, "lover", confessed=True)
    assert engine.apply_decay(record, True, now=DAY + 10 * ONE_DAY) == 0
    assert record["affection"] == 80 and record["stage"] == "lover"


def test_activity_resets_the_quiet_spell(engine):
    record = _record(engine, 60, "ambiguous")
    record["affection"] = 70
    engine.apply_decay(record, True, now=DAY + 4 * ONE_DAY)
    assert record["affection"] == 69
    assert engine.mark_active(record, now=DAY + 4 * ONE_DAY) is True
    assert engine.mark_active(record, now=DAY + 4 * ONE_DAY) is False
    assert engine.apply_decay(record, True, now=DAY + 6 * ONE_DAY) == 0


def test_decay_catch_up_is_bounded(engine):
    record = _record(engine, 100, "lover", confessed=True)
    record["affection"] = 100
    record["decay_checked"] = engine.today_str(DAY)
    removed = engine.apply_decay(record, True, now=DAY + 40 * ONE_DAY)
    assert removed == engine.DECAY_MAX_CATCHUP_DAYS * engine.DECAY_PER_DAY


def test_disabled_decay_only_advances_the_marker(engine):
    record = _record(engine, 50)
    assert engine.apply_decay(record, False, now=DAY + 30 * ONE_DAY) == 0
    assert record["affection"] == 50 and record["decay_checked"] == engine.today_str(DAY + 30 * ONE_DAY)


def test_idle_days(engine):
    record = _record(engine, 50)
    start = date.fromisoformat(record["last_active"])
    assert engine.idle_days(record, start) == 0
    assert engine.idle_days(record, date.fromordinal(start.toordinal() + 5)) == 5


# ------------------------------------------------------------ daily trend


def test_daily_points_follow_changes(engine):
    record = _record(engine, 10)
    engine.apply_model_delta(record, 5, "好", now=DAY)
    engine.apply_model_delta(record, 5, "好", now=DAY + 2 * ONE_DAY)
    assert record["daily"] == {
        engine.today_str(DAY): 15,
        engine.today_str(DAY + 2 * ONE_DAY): 20,
    }


def test_trend_forward_fills_and_ends_on_current_value(engine):
    record = _record(engine, 10)
    start = date.fromisoformat(engine.today_str(DAY))
    record["daily"] = {"2000-01-01": 3, start.isoformat(): 10}
    record["affection"] = 12
    view = engine.trend_view(record, days=5, today=date.fromordinal(start.toordinal() + 2))
    assert view["start"] == date.fromordinal(start.toordinal() - 2).isoformat()
    assert view["values"] == [3, 3, 10, 10, 12]
    empty = engine.trend_view({"daily": {start.isoformat(): 5}, "affection": 5}, days=3, today=start)
    assert empty["values"] == [None, None, 5]


def test_daily_rebuilt_from_v2_history_and_bounded(engine):
    v2 = {
        "affection": 30,
        "history": [{"ts": DAY - ONE_DAY, "delta": 2, "value": 28, "reason": "r", "source": "model"}],
    }
    record = engine.normalize_record(v2, now=DAY)
    assert record["daily"] == {engine.today_str(DAY - ONE_DAY): 28}
    record["daily"] = {}
    for d in range(engine.DAILY_POINTS_LIMIT + 5):
        engine.set_affection(record, d % 100, now=DAY + d * ONE_DAY)
    assert len(record["daily"]) == engine.DAILY_POINTS_LIMIT


def test_normalize_v3_garbage(engine):
    record = engine.normalize_record(
        {
            "affection": 40,
            "last_model_ts": True,
            "last_model_sign": 7,
            "last_active": "bad",
            "confessed": "yes",
            "confessed_on": "2025-01-01",
            "confession": "x",
            "daily": {"bad": 1, "2025-01-01": True, "2025-01-02": 500},
        },
        now=DAY,
    )
    assert record["last_model_ts"] is None and record["last_model_sign"] == 0
    assert record["last_active"] == engine.today_str(DAY)
    assert record["confessed"] is False and record["confessed_on"] is None and record["confession"] == ""
    assert record["daily"] == {"2025-01-02": 100}
