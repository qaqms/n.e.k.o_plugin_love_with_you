"""Address preferences preserve history, user control and concurrent edits."""

import copy

import pytest


@pytest.mark.parametrize("names", [{}, {"familiar": "朋友"}, {"stranger": "阁下", "fond": "小林", "lover": "亲爱的"}])
def test_old_records_keep_exact_inheritance_and_never_opt_into_sweet_names(engine, names):
    raw = engine.new_record(90)
    raw.pop("addressing")
    raw["nicknames"] = names
    restored = engine.normalize_record(raw)
    inherited = ""
    for stage in engine.STAGE_KEYS:
        inherited = names.get(stage) or inherited
        assert engine.effective_nickname(restored, stage) == inherited
        assert not engine.resolve_addressing(restored, stage)["candidate"]
    assert not restored["addressing"]["endearments"]
    assert engine.normalize_record(restored) == restored


def test_new_defaults_are_persona_first_and_candidate_requires_confirmed_lover(engine):
    record = engine.new_record()
    assert all(item["mode"] == "auto" for item in record["addressing"]["stages"].values())
    assert not engine.resolve_addressing(record, "lover")["candidate"]
    engine.set_affection(record, 90, gate=True)
    assert record["stage"] == "ambiguous"
    engine.confess(record, "互相答应")
    assert engine.resolve_addressing(record)["candidate"] == "亲爱的"
    assert engine.effective_nickname(record) == ""
    engine.set_addressing(record, {"endearments": False})
    assert not engine.resolve_addressing(record)["candidate"]
    engine.set_addressing(record, {"endearments": True, "avoided": ["亲爱的"]})
    assert not engine.resolve_addressing(record)["candidate"]


def test_persona_is_an_inheritance_barrier_and_auto_respects_existing_names(engine):
    record = engine.new_record(90)
    engine.set_addressing(record, {"stages": {
        "familiar": {"mode": "custom", "text": "阁下"},
        "fond": {"mode": "inherit", "text": ""},
    }})
    assert engine.resolve_addressing(record)["text"] == "阁下"
    assert not engine.resolve_addressing(record)["candidate"]
    engine.set_addressing(record, {"stages": {"fond": {"mode": "persona", "text": ""}}})
    assert engine.resolve_addressing(record, "ambiguous")["text"] == ""
    engine.set_addressing(record, {"preferred_name": "小林"})
    assert engine.resolve_addressing(record, "fond")["text"] == ""
    assert engine.resolve_addressing(record, "ambiguous")["text"] == "小林"
    assert engine.resolve_addressing(record, "familiar")["text"] == "阁下"


def test_address_cas_merges_unrelated_fields_and_replay_without_revision_churn(engine):
    record = engine.new_record()
    old = {"mode": "auto", "text": ""}
    change = {"stages": {"fond": {"mode": "custom", "text": "  hi   pal  "}}}
    expected = {"stages": {"fond": old}}
    engine.set_addressing(record, {"endearments": False})
    engine.set_addressing(record, change, expected=expected)
    revision = record["addressing_revision"]
    engine.set_addressing(record, change, expected=expected)
    assert record["addressing_revision"] == revision
    assert not record["addressing"]["endearments"]
    assert record["nicknames"] == {"fond": "hi pal"}
    before = copy.deepcopy(record)
    with pytest.raises(engine.EngineError, match="nickname_conflict"):
        engine.set_addressing(record, {"stages": {"fond": {"mode": "persona", "text": ""}}}, expected=expected)
    assert record == before


@pytest.mark.parametrize("patch", [
    [], {}, {"unknown": 1}, {"endearments": 1}, {"preferred_name": []}, {"avoided": "宝贝"},
    {"stages": {"fond": {"mode": [], "text": ""}}},
    {"stages": {"fond": {"mode": {}, "text": ""}}},
    {"stages": {"fond": {"mode": "custom", "text": ""}}},
    {"stages": {"invalid": {"mode": "auto", "text": ""}}},
    {"stages": {"fond": {"mode": "auto", "text": "", "extra": True}}},
])
def test_invalid_address_payloads_never_partially_mutate(engine, patch):
    record = engine.new_record()
    before = copy.deepcopy(record)
    with pytest.raises(engine.EngineError):
        engine.set_addressing(record, patch)
    assert record == before


@pytest.mark.parametrize("mode", [[], {}, 1, None])
def test_damaged_saved_mode_normalizes_without_crash(engine, mode):
    raw = engine.new_record()
    raw["addressing"]["stages"]["fond"]["mode"] = mode
    restored = engine.normalize_record(raw)
    assert restored["addressing"]["stages"]["fond"]["mode"] == "inherit"


def test_explicit_chat_preferences_apply_now_without_changing_relationship(engine):
    record = engine.new_record(60)
    engine.set_addressing(record, {"stages": {"ambiguous": {"mode": "custom", "text": "宝贝"}}})
    facts = {key: copy.deepcopy(value) for key, value in record.items()
             if key not in {"addressing", "addressing_revision", "nicknames"}}
    engine.apply_address_request(record, "set_name", "小林")
    assert engine.effective_nickname(record) == "小林"
    engine.apply_address_request(record, "avoid_name", "小林")
    assert engine.effective_nickname(record) == ""
    engine.apply_address_request(record, "allow_name", "小林")
    assert engine.effective_nickname(record) == ""
    assert {key: record[key] for key in facts} == facts
    engine.apply_address_request(record, "avoid_name", "宝贝")
    with pytest.raises(engine.EngineError, match="nickname_blocked"):
        engine.apply_address_request(record, "set_name", "宝贝")


def test_independent_and_shared_preferences_survive_repeated_switches(engine):
    state = engine.normalize_state(None)
    engine.set_addressing(state["shared"], {"preferred_name": "shared", "avoided": ["宝贝"]})
    engine.set_per_character(state, True, "A")
    assert state["characters"]["A"]["addressing"]["preferred_name"] == "shared"
    engine.set_addressing(state["characters"]["A"], {"preferred_name": "A", "endearments": False})
    engine.set_per_character(state, False, "A")
    assert state["shared"]["addressing"]["preferred_name"] == "shared"
    engine.set_per_character(state, True, "B")
    engine.set_addressing(state["characters"]["B"], {"preferred_name": "B"})
    engine.set_per_character(state, False, "B")
    engine.set_per_character(state, True, "A")
    assert state["characters"]["A"]["addressing"]["preferred_name"] == "A"
    assert state["characters"]["B"]["addressing"]["preferred_name"] == "B"
    assert not state["characters"]["A"]["addressing"]["endearments"]


@pytest.mark.parametrize("stage", ["stranger", "familiar", "fond", "ambiguous"])
def test_confirmed_relationship_survives_every_lower_stage_prompt(engine, prompts, stage):
    record = engine.new_record(90)
    engine.set_affection(record, dict(engine.STAGES)[stage])
    address = engine.resolve_addressing(record)
    texts = [
        prompts.relationship_context(stage, confirmed=True, addressing=address, transition=("lover", stage)),
        prompts.update_tool_description(stage, confirmed=True, addressing=address),
        prompts.gift_reaction_prompt("茶", stage, "", 1, gift_id="test", confirmed=True, addressing=address),
    ]
    assert record["confessed"]
    for text in texts:
        assert "恋人" in text
        assert "才刚认识" not in text
        assert "现在是「陌生」" not in text
    assert "不能因此否认已有关系" in texts[0]


@pytest.mark.parametrize("user", ["不要叫我宝贝", "以后叫我小林", "请叫我“小林”", "别再叫我「小笨蛋」了", "叫我小林就好"])
def test_pure_name_corrections_are_neutral_even_if_judge_penalizes_them(scoring, user):
    verdict = scoring.guard_verdict(scoring.Verdict(-3, "reject", True), user=user, reply="好的", awaiting_confession=True)
    assert verdict.delta == 0 and not verdict.confession


@pytest.mark.parametrize("user", ["不要叫我宝贝，你真垃圾", "如果不要叫我宝贝会怎样", "她说不要叫我宝贝", "我喜欢你，和我在一起吧"])
def test_mixed_or_quoted_content_is_not_silently_suppressed(scoring, user):
    assert not scoring.address_preference_only(user)
