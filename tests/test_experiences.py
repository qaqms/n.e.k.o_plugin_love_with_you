from __future__ import annotations

import copy

import pytest

DAY = "2026-11-11"


@pytest.fixture
def state(experiences):
    result = experiences.new_state()
    result["enabled"] = True
    return result


def apply(module, state, operation, values=None, character="YUI", **kwargs):
    return module.apply(
        state, character, operation,
        kwargs.get("revision", module.record_for(state, character)["revision"]),
        kwargs.get("request_id", f"request_{len(state['receipts']):08}"), values or {},
        today=DAY, now=kwargs.get("now", 1000),
    )


def saved_note(module, state, character="YUI"):
    result = apply(module, state, "start_note", {"title": "Together", "text": "A real first line"}, character)
    apply(module, state, "save_note", {"id": result["id"]}, character)
    return result["id"]


def active_followup(module, state, **kwargs):
    result = apply(module, state, "propose_followup", {"summary": "Interview", "due": DAY}, **kwargs)
    apply(module, state, "confirm_followup", {"id": result["id"]}, **kwargs)
    return result["id"]


def test_default_is_opt_in_and_disabled_writes_do_not_create_records(experiences):
    state = experiences.new_state()
    with pytest.raises(experiences.ExperienceError, match="experience_disabled"):
        apply(experiences, state, "start_note", {"title": "Title"})
    assert not state["characters"]


def test_note_draft_review_edit_and_delete_roundtrip(experiences, state):
    result = apply(experiences, state, "start_note", {"title": "Together", "text": "First line"})
    record = state["characters"]["YUI"]
    assert not record["memories"]
    apply(experiences, state, "draft_note", {"id": result["id"], "text": "Both lines"})
    apply(experiences, state, "save_note", {"id": result["id"], "text": "Reviewed lines"})
    assert record["note"] is None
    assert record["memories"][0]["text"] == "Reviewed lines"
    apply(experiences, state, "edit_memory", {"id": result["id"], "title": "Edited", "text": "Corrected"})
    restored = experiences.normalize(state)
    assert restored == state
    apply(experiences, state, "delete_memory", {"id": result["id"]})
    assert not record["memories"]
    assert "Reviewed lines" not in repr(state["receipts"])


def test_shared_affection_does_not_share_experiences(experiences, state):
    saved_note(experiences, state)
    text, _ = experiences.context(state, "MIO", DAY)
    assert "A real first line" not in text
    assert not experiences.record_for(state, "MIO")["memories"]
    assert "MIO" not in state["characters"]


def test_draft_edit_keeps_title_and_text_across_reload(experiences, state):
    item = apply(experiences, state, "start_note", {"title": "Old title", "text": "First"})
    apply(experiences, state, "draft_note", {
        "id": item["id"], "title": "Revised title", "text": "Revised draft",
    })
    restored = experiences.normalize(state)
    note = restored["characters"]["YUI"]["note"]
    assert (note["title"], note["text"]) == ("Revised title", "Revised draft")
    assert not restored["characters"]["YUI"]["memories"]
    apply(experiences, restored, "draft_note", {"id": item["id"], "text": "Model continuation"})
    assert note["title"] == "Revised title"


def test_recall_off_and_global_disable_stop_context_but_keep_records(experiences, state):
    item_id = saved_note(experiences, state)
    apply(experiences, state, "toggle_memory", {"id": item_id, "recall": False})
    assert "A real first line" not in experiences.context(state, "YUI", DAY)[0]
    state["enabled"] = False
    assert experiences.context(state, "YUI", DAY) == ("", "")
    apply(experiences, state, "delete_memory", {"id": item_id})
    assert not state["characters"]["YUI"]["memories"]


def test_followup_needs_consent_then_user_turn_then_due_date(experiences, state):
    item = apply(experiences, state, "propose_followup", {"summary": "Interview", "due": "2026-11-12"})
    assert experiences.due_item(state, "YUI", "2026-11-13") is None
    apply(experiences, state, "confirm_followup", {"id": item["id"]})
    assert not experiences.context(state, "YUI", DAY, user_turn=True)[1]
    assert not experiences.context(state, "YUI", "2026-11-12")[1]
    assert experiences.context(state, "YUI", "2026-11-12", user_turn=True)[1] == item["id"]
    state["characters"]["YUI"]["followups"][0]["prompt_submitted"] = True
    assert not experiences.context(state, "YUI", "2026-11-13", user_turn=True)[1]
    apply(experiences, state, "edit_followup", {"id": item["id"], "due": "2026-11-14"})
    assert not experiences.due_item(state, "YUI", "2026-11-13")
    assert experiences.due_item(state, "YUI", "2026-11-14")


def test_outcome_stays_draft_until_review_and_declining_is_terminal(experiences, state):
    item_id = active_followup(experiences, state)
    apply(experiences, state, "propose_outcome", {"id": item_id, "outcome": "Player reported success"})
    item = state["characters"]["YUI"]["followups"][0]
    assert not item["outcome"] and item["status"] == "active"
    apply(experiences, state, "save_outcome", {"id": item_id, "outcome": "Reviewed actual result"})
    assert item["outcome"] == "Reviewed actual result"
    assert item["status"] == "closed"
    assert experiences.due_item(state, "YUI", DAY) is None


def test_same_request_replays_without_duplicate_record(experiences, state):
    values = {"summary": "Interview", "due": DAY}
    first = apply(experiences, state, "propose_followup", values, revision=0, request_id="one_request")
    second = apply(experiences, state, "propose_followup", values, revision=0, request_id="one_request")
    assert second["id"] == first["id"] and second["replay"]
    assert len(state["characters"]["YUI"]["followups"]) == 1
    with pytest.raises(experiences.ExperienceError, match="experience_invalid"):
        apply(experiences, state, "propose_followup", {"summary": "Other", "due": DAY},
              revision=0, request_id="one_request")


def test_stale_writes_and_restart_replays_are_rejected(experiences, state):
    item_id = saved_note(experiences, state)
    with pytest.raises(experiences.ExperienceError, match="experience_stale"):
        apply(experiences, state, "delete_memory", {"id": item_id}, revision=0)
    experiences.restart(state, ["YUI"])
    assert not state["characters"]["YUI"]["memories"][0]["recall"]
    with pytest.raises(experiences.ExperienceError, match="experience_stale"):
        apply(experiences, state, "start_note", {"title": "Together", "text": "A real first line"},
              revision=0, request_id="request_00000000")


def test_restart_cancels_active_work_but_preserves_other_character(experiences, state):
    apply(experiences, state, "start_note", {"title": "Draft", "text": "Hello"})
    active_followup(experiences, state)
    saved_note(experiences, state, "MIO")
    before = copy.deepcopy(state["characters"]["MIO"])
    experiences.restart(state, ["YUI"])
    assert state["characters"]["YUI"]["note"] is None
    assert state["characters"]["YUI"]["followups"][0]["status"] == "closed"
    assert state["characters"]["MIO"] == before


@pytest.mark.parametrize("values", [
    {"summary": "", "due": DAY}, {"summary": "x" * 161, "due": DAY},
    {"summary": "Interview", "due": "2026-11-10"}, {"summary": "Interview", "due": "2026-02-30"},
    {"summary": "Interview", "due": "20261111"}, {"summary": "Interview", "due": None},
])
def test_invalid_followup_is_rejected(experiences, state, values):
    with pytest.raises(experiences.ExperienceError):
        apply(experiences, state, "propose_followup", values)


def test_restart_does_not_resend_uncertain_invitation(experiences, state):
    item = apply(experiences, state, "start_note", {"title": "Together", "text": "First"})
    apply(experiences, state, "invite", {"id": item["id"]})
    restored = experiences.normalize(state)
    assert restored["characters"]["YUI"]["note"]["invitation"] == "unknown"


def test_invite_cooldown_and_duplicate_replay(experiences, state):
    item = apply(experiences, state, "start_note", {"title": "Together", "text": "First"})
    rev = state["characters"]["YUI"]["revision"]
    apply(experiences, state, "invite", {"id": item["id"]}, request_id="invite_once", revision=rev)
    replay = apply(experiences, state, "invite", {"id": item["id"]}, request_id="invite_once", revision=rev)
    assert replay["replay"]
    with pytest.raises(experiences.ExperienceError, match="experience_cooldown"):
        apply(experiences, state, "invite", {"id": item["id"]}, now=1100)


@pytest.mark.parametrize("raw", [{"version": 999}, [], {"version": True}])
def test_unknown_or_malformed_state_fails_closed(experiences, raw):
    with pytest.raises(experiences.ExperienceError, match="experience_recovery_required"):
        experiences.normalize(raw)


def test_corrupt_followup_cannot_break_later_maintenance(experiences, state):
    active_followup(experiences, state)
    del state["characters"]["YUI"]["followups"][0]["due"]
    with pytest.raises(experiences.ExperienceError, match="experience_recovery_required"):
        experiences.normalize(state)


def test_context_is_bounded_and_does_not_expose_receipts(experiences, state):
    for _ in range(4):
        item = apply(experiences, state, "start_note", {"title": "Title", "text": "a" * 600})
        apply(experiences, state, "save_note", {"id": item["id"]})
    text, _ = experiences.context(state, "YUI", DAY)
    assert text.count("a" * 240) == 2
    assert len(text) < 1400
    assert "request_id" not in text
