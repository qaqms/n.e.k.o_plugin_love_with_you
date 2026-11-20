from __future__ import annotations

from datetime import datetime

import pytest

NOW = datetime(2026, 11, 9, 15, 2).timestamp()


def row(kind, text, **metadata):
    return {"type": kind, "data": {"content": text, "metadata": metadata}}


def test_initial_snapshot_is_only_a_baseline_even_with_an_unanswered_user(conv):
    tracker = conv.RecentHistoryTracker(NOW)
    rows = [row("human", "我喜欢你，和我在一起吧")]
    assert tracker.feed("MS", rows, NOW) == []
    assert tracker.feed("MS", [*rows, row("ai", "我愿意")], NOW + 5) == []


def test_legacy_append_and_unchanged_snapshot_are_observed_once(conv):
    tracker = conv.RecentHistoryTracker(NOW)
    rows = [row("ai", "old greeting")]
    assert tracker.feed("MS", rows, NOW) == []
    rows += [row("human", "早上好"), row("ai", "[20261109 Mon 15:02] 你好呀")]
    messages = tracker.feed("MS", rows, NOW + 10)
    assert [(message.role, message.content) for message in messages] == [("user", "早上好"), ("reply", "你好呀")]
    assert all(message.said_at == NOW + 10 for message in messages)
    assert tracker.feed("MS", rows, NOW + 15) == []


def test_user_waits_for_reply_and_keeps_first_observation_time(conv):
    tracker = conv.RecentHistoryTracker(NOW)
    tracker.feed("MS", [], NOW)
    rows = [row("human", "hello")]
    assert tracker.feed("MS", rows, NOW + 5) == []
    messages = tracker.feed("MS", [*rows, row("ai", "hi")], NOW + 15)
    assert [message.said_at for message in messages] == [NOW + 5, NOW + 15]


def test_precise_host_timestamps_survive_poll_delay(conv):
    tracker = conv.RecentHistoryTracker(NOW)
    tracker.feed("MS", [], NOW)
    messages = tracker.feed("MS", [
        row("human", "hello", recent_memory_time=str(int((NOW + 2) * 1000))),
        row("ai", "hi", chat_original_source={"originalTime": str(int((NOW + 4) * 1000))}),
    ], NOW + 10)
    assert [message.said_at for message in messages] == [NOW + 2, NOW + 4]


def test_rolling_and_summarized_window_can_retain_a_tail_anchor(conv):
    tracker = conv.RecentHistoryTracker(NOW)
    old = [row("human", "previous"), row("ai", "old reply")]
    tracker.feed("MS", old, NOW)
    rows = [row("system", "new summary"), old[-1], row("human", "new question"), row("ai", "new reply")]
    assert len(tracker.feed("MS", rows, NOW + 10)) == 2
    assert tracker.feed("MS", rows, NOW + 15) == []
    replacement = [row("human", "imported"), row("ai", "imported reply")]
    assert tracker.feed("MS", replacement, NOW + 20) == []


@pytest.mark.parametrize("metadata", [
    {"source": "avatar-drop"}, {"source": "theater_numeric_v2"}, {"source": "tool"},
    {"chat_original_source": {"origin": "agent"}}, {"turn_type": "proactive_reply"},
    {"event_type": "gift_received"}, {"event_type": "proactive_confession"},
    {"event_type": "experience_note"},
])
def test_generated_or_special_replies_never_complete_an_income_turn(conv, metadata):
    tracker = conv.RecentHistoryTracker(NOW)
    tracker.feed("MS", [], NOW)
    assert tracker.feed("MS", [
        row("human", "hello"), row("ai", "generated", **metadata), row("ai", "unasked"),
    ], NOW + 10) == []


@pytest.mark.parametrize("reply", [
    "[20261108 Sun 15:02] old",
    "[20261110 Tue 15:02] future",
    "[20260230 Mon 15:02] invalid",
])
def test_old_future_or_invalid_legacy_reply_stamp_does_not_credit(conv, reply):
    tracker = conv.RecentHistoryTracker(NOW)
    tracker.feed("MS", [], NOW)
    assert tracker.feed("MS", [row("human", "hello"), row("ai", reply)], NOW + 10) == []


def test_precise_history_from_before_start_is_not_replayed(conv):
    tracker = conv.RecentHistoryTracker(NOW)
    tracker.feed("MS", [], NOW)
    assert tracker.feed("MS", [
        row("human", "old", recent_memory_time=str(int((NOW - 5) * 1000))), row("ai", "old reply"),
    ], NOW + 10) == []


def test_characters_and_pending_turns_remain_separate(conv):
    tracker = conv.RecentHistoryTracker(NOW)
    tracker.feed("MS", [], NOW)
    tracker.feed("YUI", [], NOW)
    tracker.feed("MS", [row("human", "for MS")], NOW + 1)
    assert tracker.feed("YUI", [row("ai", "unasked YUI")], NOW + 2) == []
    messages = tracker.feed("MS", [row("human", "for MS"), row("ai", "from MS")], NOW + 3)
    assert len(messages) == 2 and all(message.lanlan == "MS" for message in messages)


def test_settings_edit_marks_pending_scoring_stale_without_losing_income(conv):
    tracker = conv.RecentHistoryTracker(NOW)
    tracker.feed("MS", [], NOW)
    tracker.feed("MS", [row("human", "hello")], NOW + 1)
    tracker.invalidate_scoring("MS")
    messages = tracker.feed("MS", [row("human", "hello"), row("ai", "hi")], NOW + 3)
    assert len(messages) == 2 and all(message.metadata["skip_score"] for message in messages)


def test_pending_overflow_cannot_confirm_confession_from_a_partial_turn(conv):
    tracker = conv.RecentHistoryTracker(NOW)
    tracker.feed("MS", [], NOW)
    messages = tracker.feed("MS", [
        *[row("human", f"message {index}") for index in range(6)], row("ai", "reply"),
    ], NOW + 10)
    assert len(messages) == conv.PENDING_MAX_MESSAGES + 1
    assert messages[-1].truncated


def test_restarting_compatibility_reader_never_replays_completed_chat(conv):
    rows = [row("human", "hello"), row("ai", "hi")]
    tracker = conv.RecentHistoryTracker(NOW)
    tracker.feed("MS", [], NOW)
    assert len(tracker.feed("MS", rows, NOW + 5)) == 2
    restarted = conv.RecentHistoryTracker(NOW + 10)
    assert restarted.feed("MS", rows, NOW + 15) == []
