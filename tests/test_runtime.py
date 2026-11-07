"""Exercise real plugin orchestration with an isolated SDK boundary.

The stub supplies decorators/results and the base context only. Queues, worker
threads, event loops, judging, state mutations and disk writes use plugin code.
"""

from __future__ import annotations

import asyncio
import copy
import importlib.util
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

PLUGIN_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def runtime(monkeypatch):
    sdk = ModuleType("plugin.sdk.plugin")

    class Base:
        def __init__(self, ctx):
            self.ctx = ctx
            self.logger = ctx.logger
            self.plugin_dir = PLUGIN_ROOT
            self.plugin_id = "love_with_you"

        def data_path(self, name):
            return self.ctx.data_dir / name

    @dataclass
    class Ok:
        value: object

    @dataclass
    class Err:
        error: object

    def decorator(**_):
        return lambda target: target

    sdk.NekoPluginBase = Base
    sdk.Ok, sdk.Err, sdk.SdkError = Ok, Err, RuntimeError
    sdk.neko_plugin = lambda target: target
    sdk.lifecycle = sdk.timer_interval = sdk.plugin_entry = decorator
    sdk.tr = lambda key, **kwargs: kwargs.get("default", key)
    sdk.ui = SimpleNamespace(context=decorator, action=decorator)
    for name in ("plugin", "plugin.sdk"):
        package = ModuleType(name)
        package.__path__ = []
        monkeypatch.setitem(sys.modules, name, package)
    monkeypatch.setitem(sys.modules, "plugin.sdk.plugin", sdk)
    package_name = "_love_with_you_runtime_test"
    spec = importlib.util.spec_from_file_location(
        package_name, PLUGIN_ROOT / "__init__.py", submodule_search_locations=[str(PLUGIN_ROOT)]
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, package_name, module)
    try:
        spec.loader.exec_module(module)
        yield module
    finally:
        for name in tuple(sys.modules):
            if name.startswith(package_name + "."):
                sys.modules.pop(name)


@pytest.fixture
def plugin(runtime, tmp_path):
    ctx = SimpleNamespace(logger=Mock(), models=SimpleNamespace(aclose=AsyncMock()), data_dir=tmp_path)
    instance = runtime.LoveWithYouPlugin(ctx)
    instance._ready = True
    instance._state["shared"] = runtime.engine.new_record(10)
    instance._state["known_characters"] = ["YUI", "MIO"]
    instance._state["current_character"] = "YUI"
    instance._state_file = runtime.StateFile(tmp_path / "state.json")
    instance._sync_characters = AsyncMock()
    instance._reconcile_tools = Mock()
    instance._complete = AsyncMock(return_value=('{"delta":2,"reason":"kind"}', "ok"))
    yield instance
    assert instance._stop_worker(), "test left a scoring worker running"


def exchange(runtime, character="YUI", ts=1.0):
    return runtime.conv.Exchange(character, "hello", "reply", "", "", ts)


def test_appearance_action_persists_globally_without_editing_relationships(plugin, runtime, tmp_path):
    before = copy.deepcopy(plugin._state)
    plugin._appearance = runtime.appearance.AppearancePrefs(runtime.StateFile(tmp_path / "appearance.json"))
    result = asyncio.run(plugin.set_appearance(accent_color="#7DB9E8", color_scheme="dark"))
    assert isinstance(result, runtime.Ok)
    dashboard = asyncio.run(plugin.dashboard())
    assert dashboard["appearance"] == {"accent_color": "#7db9e8", "color_scheme": "dark"}
    assert plugin._state == before
    assert runtime.appearance.AppearancePrefs(runtime.StateFile(tmp_path / "appearance.json")).summary() == dashboard["appearance"]


def test_appearance_action_reports_failed_save_and_preserves_preferences(plugin, runtime, tmp_path, monkeypatch):
    store = runtime.StateFile(tmp_path / "appearance.json")
    plugin._appearance = runtime.appearance.AppearancePrefs(store)
    monkeypatch.setattr(store, "save", Mock(side_effect=OSError("disk full")))
    result = asyncio.run(plugin.set_appearance(accent_color="#7db9e8", color_scheme="light"))
    assert isinstance(result, runtime.Err)
    assert str(result.error) == "appearance_save_failed"
    assert plugin._appearance.summary() == runtime.appearance.DEFAULTS
    invalid = asyncio.run(plugin.set_appearance(accent_color="red", color_scheme="light"))
    assert isinstance(invalid, runtime.Err)
    assert str(invalid.error) == "appearance_invalid_settings"


def test_appearance_not_ready_uses_defaults_and_returns_retryable_error(plugin, runtime):
    assert asyncio.run(plugin.dashboard())["appearance"] == runtime.appearance.DEFAULTS
    result = asyncio.run(plugin.set_appearance(accent_color="#7db9e8", color_scheme="system"))
    assert isinstance(result, runtime.Err)
    assert str(result.error) == "appearance_not_ready"


def take_job(plugin, runtime, character="YUI"):
    plugin._enqueue(exchange(runtime, character))
    return plugin._jobs.get_nowait()


async def change_state(plugin, change):
    if change == "disable":
        await plugin.set_settings(auto_score=False)
    elif change == "disable_enable":
        await plugin.set_settings(auto_score=False)
        await plugin.set_settings(auto_score=True)
    elif change == "independent":
        await plugin.set_per_character(enabled=True)
    elif change == "independent_shared":
        await plugin.set_per_character(enabled=True)
        await plugin.set_per_character(enabled=False)
    elif change == "manual":
        await plugin.set_affection(scope="shared", value=42)
    elif change == "reset":
        await plugin.reset_affection(scope="shared")
    elif change == "gate":
        await plugin.set_settings(require_confession=False)
        await plugin.set_settings(require_confession=True)
    else:
        raise AssertionError(change)


CHANGES = ["disable", "disable_enable", "independent", "independent_shared", "manual", "reset", "gate"]


@pytest.mark.parametrize("change", CHANGES)
def test_late_result_cannot_overwrite_user_changes(plugin, runtime, change):
    async def scenario():
        started, release = asyncio.Event(), asyncio.Event()

        async def complete(_):
            started.set()
            await release.wait()
            return '{"delta":3,"reason":"old","confession":true}', "ok"

        plugin._complete = complete
        task = asyncio.create_task(plugin._score(take_job(plugin, runtime)))
        await asyncio.wait_for(started.wait(), timeout=2)
        await change_state(plugin, change)
        state, status = copy.deepcopy(plugin._state), dict(plugin._auto)
        saved = plugin._state_file.path.read_bytes()
        release.set()
        await asyncio.wait_for(task, timeout=2)
        assert plugin._state == state
        assert plugin._auto == status
        assert plugin._state_file.path.read_bytes() == saved
        assert plugin._model_retry_at == 0

    asyncio.run(scenario())


@pytest.mark.parametrize("change", CHANGES)
def test_queued_jobs_are_discarded_before_calling_model(plugin, runtime, change):
    async def scenario():
        job = take_job(plugin, runtime)
        await change_state(plugin, change)
        state = copy.deepcopy(plugin._state)
        await plugin._score(job)
        plugin._complete.assert_not_awaited()
        assert plugin._state == state
        assert plugin._auto["scored"] == 0

    asyncio.run(scenario())


def test_reset_does_not_invalidate_another_characters_score(plugin, runtime):
    async def scenario():
        started, release = asyncio.Event(), asyncio.Event()

        async def complete(_):
            started.set()
            await release.wait()
            return '{"delta":2,"reason":"kind"}', "ok"

        plugin._complete = complete
        await plugin.set_per_character(enabled=True)
        job = take_job(plugin, runtime, "MIO")
        task = asyncio.create_task(plugin._score(job))
        await asyncio.wait_for(started.wait(), timeout=2)
        await plugin.set_affection(scope="char:YUI", value=42)
        release.set()
        await asyncio.wait_for(task, timeout=2)
        assert plugin._state["characters"]["YUI"]["affection"] == 42
        assert plugin._state["characters"]["MIO"]["affection"] == 2
        assert plugin._auto["scored"] == 1

    asyncio.run(scenario())


def test_late_confession_cannot_confirm_relationship_after_manual_adjustment(plugin, runtime):
    async def scenario():
        runtime.engine.set_affection(plugin._state["shared"], 85, gate=True)
        started, release = asyncio.Event(), asyncio.Event()

        async def complete(_):
            started.set()
            await release.wait()
            return '{"delta":0,"reason":"yes","confession":true}', "ok"

        plugin._complete = complete
        task = asyncio.create_task(plugin._score(take_job(plugin, runtime)))
        await asyncio.wait_for(started.wait(), timeout=2)
        await plugin.set_affection(scope="shared", value=90)
        release.set()
        await asyncio.wait_for(task, timeout=2)
        record = plugin._state["shared"]
        assert record["affection"] == 90 and record["stage"] == "ambiguous"
        assert not record["confessed"] and record["confessed_on"] is None
        assert "lover" not in record["milestones"]
        assert not any(item["source"] == "confession" for item in record["history"])

    asyncio.run(scenario())


@pytest.mark.parametrize("status", ["unbound", "gateway_unavailable", "timeout", "http_502"])
def test_discarded_failure_does_not_change_diagnostics_or_retry_deadline(plugin, runtime, status):
    async def scenario():
        started, release = asyncio.Event(), asyncio.Event()

        async def complete(_):
            started.set()
            await release.wait()
            return None, status

        plugin._complete = complete
        task = asyncio.create_task(plugin._score(take_job(plugin, runtime)))
        await asyncio.wait_for(started.wait(), timeout=2)
        await plugin.set_settings(auto_score=False)
        release.set()
        await asyncio.wait_for(task, timeout=2)
        assert plugin._auto["scored"] == plugin._auto["failed"] == 0
        assert plugin._auto["mode"] is None
        assert plugin._auto["model_status"] == plugin._auto["last_error"] == ""
        assert plugin._model_retry_at == 0

    asyncio.run(scenario())


def test_current_model_failure_still_falls_back_and_records_status(plugin, runtime):
    plugin._complete = AsyncMock(return_value=(None, "timeout"))
    plugin._enqueue(runtime.conv.Exchange("YUI", "摸摸头", "reply", "", "", 1))
    asyncio.run(plugin._score(plugin._jobs.get_nowait()))
    assert plugin._state["shared"]["affection"] == 11
    assert plugin._auto["mode"] == "rules"
    assert plugin._auto["model_status"] == plugin._auto["last_error"] == "timeout"
    assert plugin._auto["scored"] == plugin._auto["failed"] == 1


def test_changing_active_character_keeps_original_score_target(plugin, runtime):
    async def scenario():
        await plugin.set_per_character(enabled=True)
        job = take_job(plugin, runtime)
        plugin._state["current_character"] = "MIO"
        await plugin._score(job)
        assert plugin._state["characters"]["YUI"]["affection"] == 12
        assert "MIO" not in plugin._state["characters"]

    asyncio.run(scenario())


@pytest.mark.parametrize("operation", ["disable", "reset", "independent"])
def test_partial_exchange_is_not_scored_across_user_change(plugin, runtime, operation):
    async def scenario():
        plugin._on_message(runtime.conv.Message(1, "user", "YUI", "before"))
        await change_state(plugin, operation)
        if operation == "disable":
            await plugin.set_settings(auto_score=True)
        plugin._on_message(runtime.conv.Message(2, "reply", "YUI", "after"))
        assert plugin._jobs.empty()
        plugin._on_message(runtime.conv.Message(3, "user", "YUI", "new"))
        plugin._on_message(runtime.conv.Message(4, "reply", "YUI", "new reply"))
        job = plugin._jobs.get_nowait()
        assert job.exchange.user == "new"
        assert job.exchange.previous_user == ""
        await plugin._score(job)
        assert plugin._auto["scored"] == 1

    asyncio.run(scenario())


def test_noop_and_invalid_settings_keep_valid_jobs(plugin, runtime):
    async def scenario():
        job = take_job(plugin, runtime)
        await plugin.set_settings(auto_score=True)
        invalid = await plugin.set_settings(auto_score="invalid")
        assert type(invalid).__name__ == "Err"
        await plugin.set_settings(decay=True)
        await plugin._score(job)
        assert plugin._state["shared"]["affection"] == 12

    asyncio.run(scenario())


def test_unbound_retry_deadline_is_not_extended_by_skipped_calls(plugin, runtime):
    async def scenario():
        plugin._complete = AsyncMock(return_value=(None, runtime.judge.UNBOUND))
        await plugin._score(take_job(plugin, runtime))
        deadline = plugin._model_retry_at
        await plugin._score(take_job(plugin, runtime))
        assert plugin._model_retry_at == deadline
        assert plugin._complete.await_count == 1
        assert plugin._auto["scored"] == 2

    asyncio.run(scenario())


def test_shutdown_cancels_gateway_call_drains_queue_and_closes_client(plugin, runtime):
    started, cancelled, closed = threading.Event(), threading.Event(), threading.Event()

    async def create(**_):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    async def close():
        closed.set()

    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    plugin.ctx.models = SimpleNamespace(get_client=AsyncMock(return_value=client), aclose=close)
    plugin._complete = plugin._model_complete
    plugin._start_worker()
    worker = plugin._worker
    plugin._enqueue(exchange(runtime))
    assert started.wait(timeout=2)
    plugin._enqueue(exchange(runtime, ts=2))
    before = copy.deepcopy(plugin._state)
    result = asyncio.run(plugin.shutdown())
    assert type(result).__name__ == "Ok"
    assert cancelled.is_set() and closed.is_set()
    assert worker is not None and not worker.is_alive()
    assert plugin._worker is None and plugin._worker_loop is None
    assert plugin._score_task is None
    assert plugin._state == before
    assert plugin._auto["scored"] == plugin._auto["failed"] == 0
    assert not plugin._ready
    plugin._enqueue(exchange(runtime, ts=3))
    assert all(job is None for job in list(plugin._jobs.queue))


def test_setting_change_cancels_slow_request_and_worker_accepts_new_job(plugin, runtime):
    started, cancelled, finished = threading.Event(), threading.Event(), threading.Event()
    calls = []

    async def complete(_):
        calls.append(1)
        if len(calls) == 1:
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        return '{"delta":2,"reason":"new"}', "ok"

    plugin._complete = complete
    original_apply = plugin._apply_verdict

    def apply(*args, **kwargs):
        original_apply(*args, **kwargs)
        finished.set()

    plugin._apply_verdict = apply
    plugin._start_worker()
    worker = plugin._worker
    plugin._enqueue(exchange(runtime))
    assert started.wait(timeout=2)
    asyncio.run(plugin.set_settings(auto_score=False))
    assert cancelled.wait(timeout=2)
    asyncio.run(plugin.set_settings(auto_score=True))
    plugin._enqueue(exchange(runtime, ts=2))
    assert finished.wait(timeout=2)
    assert plugin._worker is worker and worker.is_alive()
    assert plugin._state["shared"]["affection"] == 12
    assert plugin._auto["scored"] == 1
    assert plugin._auto["failed"] == 0


def test_one_crashed_job_does_not_stop_worker(plugin, runtime):
    finished = threading.Event()
    calls = []

    async def complete(_):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("broken response")
        return '{"delta":2,"reason":"new"}', "ok"

    plugin._complete = complete
    original_apply = plugin._apply_verdict

    def apply(*args, **kwargs):
        original_apply(*args, **kwargs)
        finished.set()

    plugin._apply_verdict = apply
    plugin._enqueue(exchange(runtime))
    plugin._enqueue(exchange(runtime, ts=2))
    plugin._start_worker()
    assert finished.wait(timeout=2)
    assert plugin._worker.is_alive()
    assert plugin._state["shared"]["affection"] == 12
    assert plugin._auto["scored"] == plugin._auto["failed"] == 1


def test_stop_timeout_retains_worker_and_blocks_restart_until_exit(plugin, runtime, monkeypatch):
    started, cancelling = threading.Event(), threading.Event()
    release = {}

    async def complete(_):
        release["loop"] = asyncio.get_running_loop()
        release["future"] = asyncio.get_running_loop().create_future()
        started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelling.set()
            await release["future"]
        return '{"delta":3,"reason":"late"}', "ok"

    monkeypatch.setattr(runtime, "_SCORE_STOP_SECONDS", 0.05)
    plugin._complete = complete
    plugin._start_worker()
    worker = plugin._worker
    plugin._enqueue(exchange(runtime))
    assert started.wait(timeout=2)
    try:
        result = asyncio.run(plugin.shutdown())
        assert type(result).__name__ == "Err"
        assert cancelling.is_set()
        assert plugin._worker is worker and worker.is_alive()
        with pytest.raises(RuntimeError, match="scoring_worker_still_stopping"):
            plugin._start_worker()
        startup = asyncio.run(plugin.startup())
        assert type(startup).__name__ == "Err"
        assert not plugin._ready
    finally:
        release["loop"].call_soon_threadsafe(release["future"].set_result, None)
        worker.join(timeout=2)
    assert not worker.is_alive()
    assert plugin._state["shared"]["affection"] == 10
    assert plugin._auto["scored"] == plugin._auto["failed"] == 0
    assert plugin._stop_worker()


def test_restart_cannot_replay_old_queue_or_stop_sentinel(plugin, runtime):
    job = take_job(plugin, runtime)
    plugin._jobs.put_nowait(job)
    assert plugin._stop_worker()
    result = asyncio.run(plugin.startup())
    assert type(result).__name__ == "Ok"
    worker = plugin._worker
    assert worker is not None and worker.is_alive()
    asyncio.run(plugin._score(job))
    assert plugin._auto["scored"] == 0
    finished = threading.Event()
    original_apply = plugin._apply_verdict

    def apply(*args, **kwargs):
        original_apply(*args, **kwargs)
        finished.set()

    plugin._apply_verdict = apply
    plugin._enqueue(exchange(runtime, ts=2))
    assert finished.wait(timeout=2)
    assert plugin._auto["scored"] == 1
    assert plugin._state["shared"]["affection"] == 2


def test_proactive_confession_is_opt_in_and_waits_for_delivered_reply(plugin, runtime):
    async def scenario():
        plugin.push_message = Mock()
        runtime.engine.set_affection(plugin._state["shared"], 85, gate=True)
        await plugin._score(take_job(plugin, runtime))
        assert plugin.push_message.call_count == 0

        await plugin.set_settings(proactive_confession=True)
        await plugin._score(take_job(plugin, runtime))
        assert plugin.push_message.call_count == 1
        kwargs = plugin.push_message.call_args.kwargs
        assert kwargs["ai_behavior"] == "respond"
        assert kwargs["visibility"] == []
        assert kwargs["target_lanlan"] == "YUI"
        assert kwargs["metadata"]["event_type"] == "proactive_confession"
        state = plugin._state["shared"]["proactive_confession"]
        assert state["status"] == "waiting" and state["attempts"] == 1

        now = runtime.time.time()
        plugin._on_message(runtime.conv.Message(now + 1, "proactive_reply", "YUI", "我喜欢你，和我在一起吧"))
        assert plugin._state["shared"]["proactive_confession"]["reply_seen"] is True
        plugin._on_message(runtime.conv.Message(now + 2, "user", "YUI", "我愿意"))
        record = plugin._state["shared"]
        assert record["confessed"] is True and record["stage"] == "lover"
        assert record["proactive_confession"]["status"] == "accepted"

    asyncio.run(scenario())


def test_proactive_confession_rejects_ambiguous_answers_and_cools_down(plugin, runtime):
    async def scenario():
        plugin.push_message = Mock()
        runtime.engine.set_affection(plugin._state["shared"], 85, gate=True)
        await plugin.set_settings(proactive_confession=True)
        await plugin._score(take_job(plugin, runtime))
        now = runtime.time.time()
        plugin._on_message(runtime.conv.Message(now + 1, "proactive_reply", "YUI", "我喜欢你，和我在一起吧"))
        plugin._on_message(runtime.conv.Message(now + 2, "user", "YUI", "好"))
        assert plugin._state["shared"]["stage"] == "ambiguous"
        assert plugin._state["shared"]["proactive_confession"]["status"] == "waiting"
        plugin._on_message(runtime.conv.Message(now + 3, "user", "YUI", "我不愿意"))
        state = plugin._state["shared"]["proactive_confession"]
        assert state["status"] == "declined" and state["cooldown_until"] > 0
        assert plugin._state["shared"]["stage"] == "ambiguous"

    asyncio.run(scenario())


def request_confession(plugin, runtime):
    plugin.push_message = Mock(return_value={"submitted": True})
    runtime.engine.set_affection(plugin._state["shared"], 85, gate=True)
    plugin._state["settings"]["proactive_confession"] = True
    job = take_job(plugin, runtime)
    verdict = runtime.scoring.Verdict(0, "普通聊天", False)
    plugin._apply_verdict(job, verdict, "rules", "unbound", model_attempted=False)
    assert plugin.push_message.call_count == 1
    return runtime.time.time(), job


@pytest.mark.parametrize("answer", ["我愿意", "我愿意和你在一起", "我也喜欢你", "好，我们在一起"])
def test_proactive_acceptance_persists_and_confesses_once(plugin, runtime, answer):
    now, _ = request_confession(plugin, runtime)
    plugin._on_message(runtime.conv.Message(now + 1, "proactive_reply", "YUI", "我喜欢你，你愿意和我在一起吗？"))
    plugin._on_message(runtime.conv.Message(now + 2, "user", "YUI", answer))
    plugin._on_message(runtime.conv.Message(now + 3, "user", "YUI", answer))
    record = plugin._state["shared"]
    assert record["stage"] == "lover"
    assert len([item for item in record["history"] if item["source"] == "confession"]) == 1
    saved, warning = plugin._state_file.load()
    assert warning is None
    restored = runtime.engine.normalize_state(saved)["shared"]
    assert restored["proactive_confession"]["status"] == "accepted"
    assert restored["confessed"] is True


def test_other_characters_and_non_confession_replies_cannot_confirm(plugin, runtime):
    now, _ = request_confession(plugin, runtime)
    plugin._on_message(runtime.conv.Message(now + 1, "proactive_reply", "MIO", "我喜欢你，和我在一起吧"))
    plugin._on_message(runtime.conv.Message(now + 2, "user", "MIO", "我愿意"))
    plugin._on_message(runtime.conv.Message(now + 3, "proactive_reply", "YUI", "早上好"))
    plugin._on_message(runtime.conv.Message(now + 4, "user", "YUI", "我愿意"))
    state = plugin._state["shared"]["proactive_confession"]
    assert not state["reply_seen"]
    assert plugin._jobs.empty()  # proactive turns never feed the exchange tracker
    assert not plugin._state["shared"]["confessed"]


def test_proactive_reply_and_user_answer_may_arrive_out_of_order(plugin, runtime):
    now, _ = request_confession(plugin, runtime)
    plugin._on_message(runtime.conv.Message(now - 1, "proactive_reply", "YUI", "我喜欢你，和我在一起吧"))
    plugin._on_message(runtime.conv.Message(now + 1, "user", "YUI", "我愿意", spoken_at=now + 1))
    assert not plugin._state["shared"]["confessed"]
    plugin._on_message(runtime.conv.Message(
        now + 2, "proactive_reply", "YUI", "我喜欢你，和我在一起吧", spoken_at=now + 0.5
    ))
    assert plugin._state["shared"]["confessed"]
    plugin._on_message(runtime.conv.Message(now + 1, "user", "YUI", "我愿意"))
    assert plugin._state["shared"]["confessed"]


def test_pending_ambiguous_answer_is_replayed_before_explicit_consent(plugin, runtime):
    now, _ = request_confession(plugin, runtime)
    plugin._on_message(runtime.conv.Message(now + 1, "user", "YUI", "好"))
    assert plugin._pending_answers["shared"]
    plugin._on_message(runtime.conv.Message(
        now + 2, "proactive_reply", "YUI", "我喜欢你，和我在一起吧", spoken_at=now + 0.5
    ))
    state = plugin._state["shared"]["proactive_confession"]
    assert state["answer_turns"] == 1
    assert not plugin._state["shared"]["confessed"]
    plugin._on_message(runtime.conv.Message(now + 3, "user", "YUI", "我愿意和你在一起"))
    assert plugin._state["shared"]["confessed"]


def test_proactive_reply_with_other_event_source_is_ignored(plugin, runtime):
    now, _ = request_confession(plugin, runtime)
    plugin._on_message(
        runtime.conv.Message(
            now + 1,
            "proactive_reply",
            "YUI",
            "我喜欢你，和我在一起吧",
            metadata={"event_type": "other_event"},
        )
    )
    state = plugin._state["shared"]["proactive_confession"]
    assert not state["delivery_seen"] and not state["reply_seen"]
    plugin._on_message(runtime.conv.Message(now + 2, "proactive_reply", "YUI", "我喜欢你，和我在一起吧"))
    state = plugin._state["shared"]["proactive_confession"]
    assert state["delivery_seen"] and state["reply_seen"]


def test_undelivered_waiting_confession_releases_attempt(plugin, runtime):
    now, _ = request_confession(plugin, runtime)
    state = plugin._state["shared"]["proactive_confession"]
    later = now + runtime.engine.PROACTIVE_CONFESSION_WAIT_SECONDS + 1
    assert plugin._expire_proactive_locked(state, later)
    assert state["status"] == "idle"
    assert state["attempts"] == 0
    assert state["cooldown_until"] == later + runtime.engine.PROACTIVE_CONFESSION_UNDELIVERED_COOLDOWN_SECONDS


def test_dispatching_confession_is_recovered_as_undelivered(plugin, runtime):
    now, _ = request_confession(plugin, runtime)
    state = plugin._state["shared"]["proactive_confession"]
    state["status"] = "dispatching"
    assert plugin._expire_proactive_locked(state, now + 1)
    assert state["status"] == "idle"
    assert state["attempts"] == 0
    assert state["cooldown_until"] > now


def test_pending_proposal_survives_restart_without_a_second_send(plugin, runtime):
    now, _ = request_confession(plugin, runtime)
    plugin._on_message(runtime.conv.Message(now + 1, "proactive_reply", "YUI", "我喜欢你，和我在一起吧"))
    saved, _ = plugin._state_file.load()
    plugin._state = runtime.engine.normalize_state(saved)
    assert not plugin._state["shared"]["confessed"]
    assert plugin._state["shared"]["stage"] == "ambiguous"
    plugin._maybe_trigger_proactive_confession(
        take_job(plugin, runtime), runtime.scoring.Verdict(0, "", False)
    )
    assert plugin.push_message.call_count == 1
    plugin._on_message(runtime.conv.Message(now + 2, "user", "YUI", "我愿意"))
    assert plugin._state["shared"]["confessed"]


def test_expired_confession_does_not_accept_or_send_again_immediately(plugin, runtime, monkeypatch):
    now, _ = request_confession(plugin, runtime)
    plugin._on_message(runtime.conv.Message(now + 1, "proactive_reply", "YUI", "我喜欢你，和我在一起吧"))
    later = now + runtime.engine.PROACTIVE_CONFESSION_WAIT_SECONDS + 10
    monkeypatch.setattr(runtime.time, "time", lambda: later)
    plugin._on_message(runtime.conv.Message(later, "user", "YUI", "我愿意"))
    state = plugin._state["shared"]["proactive_confession"]
    assert state["status"] == "idle" and state["cooldown_until"] > later
    assert not plugin._state["shared"]["confessed"]
    plugin._maybe_trigger_proactive_confession(
        take_job(plugin, runtime), runtime.scoring.Verdict(0, "", False)
    )
    assert plugin.push_message.call_count == 1


@pytest.mark.parametrize("change", ["disable", "independent", "manual", "reset", "gate", "proactive_off"])
def test_user_edits_cancel_pending_confession_without_resetting_attempts(plugin, runtime, change):
    now, _ = request_confession(plugin, runtime)
    if change == "proactive_off":
        asyncio.run(plugin.set_settings(proactive_confession=False))
        asyncio.run(plugin.set_settings(proactive_confession=True))
    else:
        asyncio.run(change_state(plugin, change))
    for _, record in runtime.engine.iter_records(plugin._state):
        assert record["proactive_confession"]["status"] != "waiting"
    plugin._on_message(runtime.conv.Message(now + 1, "proactive_reply", "YUI", "我喜欢你，和我在一起吧"))
    plugin._on_message(runtime.conv.Message(now + 2, "user", "YUI", "我愿意"))
    record = runtime.engine.get_record(plugin._state, runtime.engine.scope_key_for(plugin._state, "YUI"))
    assert record["proactive_confession"]["attempts"] == 1
    assert record["proactive_confession"]["status"] == "idle"


@pytest.mark.parametrize("failure", ["exception", "receipt"])
def test_failed_proactive_send_is_cooled_down(plugin, runtime, failure):
    runtime.engine.set_affection(plugin._state["shared"], 85, gate=True)
    plugin._state["settings"]["proactive_confession"] = True
    plugin.push_message = Mock(
        side_effect=RuntimeError("failed") if failure == "exception" else None,
        return_value={"submitted": False},
    )
    verdict = runtime.scoring.Verdict(0, "", False)
    plugin._maybe_trigger_proactive_confession(take_job(plugin, runtime), verdict)
    plugin._maybe_trigger_proactive_confession(take_job(plugin, runtime), verdict)
    assert plugin.push_message.call_count == 1
    state = plugin._state["shared"]["proactive_confession"]
    assert state["status"] == "idle" and state["attempts"] == 1
    assert state["cooldown_until"] > runtime.time.time()


def test_proactive_attempts_remain_bounded_across_restart(plugin, runtime, monkeypatch):
    now, _ = request_confession(plugin, runtime)
    for i in range(1, runtime.engine.PROACTIVE_CONFESSION_MAX_ATTEMPTS + 2):
        later = now + i * (
            runtime.engine.PROACTIVE_CONFESSION_WAIT_SECONDS
            + runtime.engine.PROACTIVE_CONFESSION_TIMEOUT_COOLDOWN_SECONDS + 3600
        )
        monkeypatch.setattr(runtime.time, "time", lambda: later)
        plugin._state = runtime.engine.normalize_state(plugin._state)
        plugin._maybe_trigger_proactive_confession(
            take_job(plugin, runtime), runtime.scoring.Verdict(0, "", False)
        )
    assert plugin.push_message.call_count == runtime.engine.PROACTIVE_CONFESSION_MAX_ATTEMPTS


def test_later_unrelated_consent_cannot_answer_an_earlier_confession(plugin, runtime):
    now, _ = request_confession(plugin, runtime)
    plugin._on_message(runtime.conv.Message(now + 1, "proactive_reply", "YUI", "我喜欢你，和我在一起吧"))
    plugin._on_message(runtime.conv.Message(now + 2, "user", "YUI", "今天吃什么"))
    plugin._on_message(runtime.conv.Message(now + 3, "user", "YUI", "我愿意"))
    assert not plugin._state["shared"]["confessed"]
    plugin._on_message(runtime.conv.Message(now + 4, "user", "YUI", "我愿意和你在一起"))
    assert plugin._state["shared"]["confessed"]


def test_new_message_arriving_during_scoring_prevents_an_old_turn_trigger(plugin, runtime):
    runtime.engine.set_affection(plugin._state["shared"], 85, gate=True)
    plugin._state["settings"]["proactive_confession"] = True
    plugin.push_message = Mock()
    job = take_job(plugin, runtime)
    plugin._on_message(runtime.conv.Message(2, "user", "YUI", "等等，我还想问你"))
    plugin._apply_verdict(job, runtime.scoring.Verdict(0, "", False), "rules", "unbound", model_attempted=False)
    plugin.push_message.assert_not_called()


@pytest.mark.parametrize("value,confessed,gate", [(79, False, True), (85, True, True), (85, False, False)])
def test_proactive_threshold_gate_and_existing_relationship_are_required(plugin, runtime, value, confessed, gate):
    record = plugin._state["shared"]
    runtime.engine.set_affection(record, value, gate=gate)
    record["confessed"] = confessed
    plugin._state["settings"].update(proactive_confession=True, require_confession=gate)
    plugin.push_message = Mock()
    plugin._maybe_trigger_proactive_confession(take_job(plugin, runtime), runtime.scoring.Verdict(0, "", False))
    plugin.push_message.assert_not_called()


def test_pending_confession_cannot_be_confirmed_by_a_model_verdict(plugin, runtime):
    request_confession(plugin, runtime)
    job = take_job(plugin, runtime)
    plugin._apply_verdict(
        job, runtime.scoring.Verdict(0, "模型误报", True), "model", "ok", model_attempted=True
    )
    assert not plugin._state["shared"]["confessed"]
    assert plugin.push_message.call_count == 1


def test_real_user_proposal_remains_possible_while_proactive_confession_waits(plugin, runtime):
    now, _ = request_confession(plugin, runtime)
    plugin._enqueue(runtime.conv.Exchange("YUI", "我喜欢你，和我在一起吧", "我愿意", "", "", now + 1))
    plugin._complete = AsyncMock(return_value=(None, runtime.judge.UNBOUND))
    asyncio.run(plugin._score(plugin._jobs.get_nowait()))
    assert plugin._state["shared"]["confessed"]


def test_proactive_confessions_keep_independent_records_separate(plugin, runtime):
    asyncio.run(plugin.set_per_character(enabled=True))
    plugin._state["settings"]["proactive_confession"] = True
    for character in ("YUI", "MIO"):
        record = runtime.engine.get_record(plugin._state, "char:" + character)
        runtime.engine.set_affection(record, 85, gate=True)
    plugin.push_message = Mock(return_value={"submitted": True})
    for character in ("YUI", "MIO"):
        plugin._maybe_trigger_proactive_confession(
            take_job(plugin, runtime, character), runtime.scoring.Verdict(0, "", False)
        )
    assert plugin.push_message.call_count == 2
    now = runtime.time.time()
    plugin._on_message(runtime.conv.Message(now + 1, "proactive_reply", "MIO", "我喜欢你，和我在一起吧"))
    plugin._on_message(runtime.conv.Message(now + 2, "user", "MIO", "我愿意"))
    assert plugin._state["characters"]["MIO"]["confessed"]
    assert not plugin._state["characters"]["YUI"]["confessed"]


@pytest.mark.parametrize("role", ["proactive_reply", "reply"])
def test_intervening_character_question_requires_explicit_relationship_consent(plugin, runtime, role):
    now, _ = request_confession(plugin, runtime)
    plugin._on_message(runtime.conv.Message(now + 1, "proactive_reply", "YUI", "我喜欢你，和我在一起吧"))
    plugin._on_message(runtime.conv.Message(now + 2, role, "YUI", "你愿意帮我找一本书吗？"))
    plugin._on_message(runtime.conv.Message(now + 3, "user", "YUI", "我愿意"))
    assert not plugin._state["shared"]["confessed"]
    plugin._on_message(runtime.conv.Message(now + 4, "user", "YUI", "我愿意和你在一起"))
    assert plugin._state["shared"]["confessed"]


def test_same_proactive_reply_with_unrelated_question_needs_explicit_consent(plugin, runtime):
    now, _ = request_confession(plugin, runtime)
    plugin._on_message(runtime.conv.Message(
        now + 1, "proactive_reply", "YUI", "我喜欢你，和我在一起吧。你愿意帮我找一本书吗？"
    ))
    plugin._on_message(runtime.conv.Message(now + 2, "user", "YUI", "我愿意"))
    assert not plugin._state["shared"]["confessed"]


@pytest.mark.parametrize("turn_type", ["user_message", "proactive_reply"])
def test_truncated_message_cannot_confirm_or_deliver_confession(plugin, runtime, turn_type):
    now, _ = request_confession(plugin, runtime)
    plugin._on_message(runtime.conv.Message(now + 1, "proactive_reply", "YUI", "我喜欢你，和我在一起吧"))
    text = "我愿意" if turn_type == "user_message" else "我喜欢你，和我在一起吧"
    text += "。" + "嗯" * 320 + "，但只是开玩笑"
    raw = {"timestamp": now + 2, "content": text,
           "metadata": {"turn_type": turn_type, "lanlan_name": "YUI"}}
    if turn_type == "proactive_reply":
        plugin._state["shared"]["proactive_confession"]["reply_seen"] = False
    message = runtime.conv.parse_proactive_record(raw) or runtime.conv.parse_record(raw)
    plugin._on_message(message)
    if turn_type == "user_message":
        assert not plugin._state["shared"]["confessed"]
    else:
        assert not plugin._state["shared"]["proactive_confession"]["reply_seen"]


def test_truncated_exchange_cannot_complete_confession_through_normal_scoring(plugin, runtime):
    runtime.engine.set_affection(plugin._state["shared"], 85, gate=True)
    for turn_type, text, ts in [
        ("user_message", "我喜欢你，和我在一起吧", 1),
        ("assistant_message", "我愿意。" + "嗯" * 320 + "，但只是开玩笑", 2),
    ]:
        plugin._on_message(runtime.conv.parse_record({
            "timestamp": ts, "content": text,
            "metadata": {"turn_type": turn_type, "lanlan_name": "YUI"},
        }))
    plugin._complete = AsyncMock(return_value=(None, runtime.judge.UNBOUND))
    asyncio.run(plugin._score(plugin._jobs.get_nowait()))
    assert not plugin._state["shared"]["confessed"]


def test_normal_confession_finishes_outstanding_proactive_state(plugin, runtime):
    now, _ = request_confession(plugin, runtime)
    plugin._enqueue(runtime.conv.Exchange("YUI", "我喜欢你，和我在一起吧", "我愿意", "", "", now + 1))
    plugin._complete = AsyncMock(return_value=(None, runtime.judge.UNBOUND))
    asyncio.run(plugin._score(plugin._jobs.get_nowait()))
    record = plugin._state["shared"]
    assert record["confessed"]
    assert record["proactive_confession"]["status"] == "accepted"
    assert record["proactive_confession"]["waiting_since"] is None


def test_rejected_context_submission_keeps_relationship_context_for_retry(plugin, runtime):
    plugin.push_message = Mock(return_value={"submitted": False})
    plugin._flush_context()
    entry = plugin._context["YUI"]
    assert entry["key"] is None
    assert entry["retry_at"] > runtime.time.monotonic()


@pytest.mark.parametrize("spoken_at", [None, -1, 1])
def test_consent_before_actual_proposal_never_confirms(plugin, runtime, spoken_at):
    now, _ = request_confession(plugin, runtime)
    plugin._on_message(runtime.conv.Message(
        now + 1, "user", "YUI", "我愿意",
        spoken_at=None if spoken_at is None else now + spoken_at,
    ))
    plugin._on_message(runtime.conv.Message(
        now + 20, "proactive_reply", "YUI", "我喜欢你，和我在一起吧", spoken_at=now + 10,
    ))
    assert not plugin._state["shared"]["confessed"]
    assert plugin._state["shared"]["proactive_confession"]["answer_turns"] == 0
    plugin._on_message(runtime.conv.Message(now + 21, "user", "YUI", "我愿意"))
    assert plugin._state["shared"]["confessed"]


def test_buffered_chat_is_memory_only_even_when_other_edits_save(plugin, runtime):
    now, _ = request_confession(plugin, runtime)
    private = "这段私密聊天不应出现在状态文件里"
    plugin._on_message(runtime.conv.Message(now + 1, "user", "YUI", private))
    assert plugin._pending_answers["shared"][0].content == private
    asyncio.run(plugin.set_nicknames(scope="shared", nicknames={"stranger": "朋友"}))
    assert private not in plugin._state_file.path.read_text(encoding="utf-8")
    assert "pending_answers" not in plugin._state_file.path.read_text(encoding="utf-8")


def test_startup_purges_legacy_pending_chat_from_disk(plugin, runtime):
    now, _ = request_confession(plugin, runtime)
    private = "旧版保存下来的私人内容"
    plugin._state["shared"]["proactive_confession"]["pending_answers"] = [
        {"ts": now + 1, "content": private, "truncated": False},
    ]
    plugin._state_file.save(plugin._state)
    plugin._start_worker = Mock()
    asyncio.run(plugin.startup())
    assert "pending_answers" not in plugin._state["shared"]["proactive_confession"]
    assert private not in plugin._state_file.path.read_text(encoding="utf-8")
    assert plugin._pending_answers == {}


@pytest.mark.parametrize("operation", [
    "manual", "reset", "independent", "settings", "nicknames", "first_met",
    "anniversary_add", "anniversary_remove", "update_tool", "confess_tool",
])
def test_save_failure_rolls_back_edits_and_does_not_invalidate_scoring(plugin, runtime, operation, monkeypatch):
    item = runtime.engine.add_anniversary(plugin._state, "生日", 3, 8)
    runtime.engine.set_affection(plugin._state["shared"], 85, gate=True)
    plugin._save_locked()
    before = copy.deepcopy(plugin._state)
    saved = plugin._state_file.path.read_bytes()
    job = take_job(plugin, runtime)
    with monkeypatch.context() as patch:
        patch.setattr(plugin._state_file, "save", Mock(side_effect=PermissionError("read-only")))
        with pytest.raises(runtime.SdkError, match="failed to save state"):
            if operation == "manual":
                asyncio.run(plugin.set_affection(scope="shared", value=42))
            elif operation == "reset":
                asyncio.run(plugin.reset_affection(scope="shared"))
            elif operation == "independent":
                asyncio.run(plugin.set_per_character(enabled=True))
            elif operation == "settings":
                asyncio.run(plugin.set_settings(require_confession=False, auto_score=False))
            elif operation == "nicknames":
                asyncio.run(plugin.set_nicknames(scope="shared", nicknames={"stranger": "朋友"}))
            elif operation == "first_met":
                asyncio.run(plugin.set_first_met(scope="shared", date="2020-01-01"))
            elif operation == "anniversary_add":
                asyncio.run(plugin.add_anniversary(title="纪念日", month=5, day=9))
            elif operation == "anniversary_remove":
                asyncio.run(plugin.remove_anniversary(id=item["id"]))
            elif operation == "update_tool":
                asyncio.run(plugin._make_update_handler("shared")(delta=2, reason="关心"))
            elif operation == "confess_tool":
                asyncio.run(plugin._make_confess_handler("shared")(moment="彼此答应"))
    assert plugin._state == before
    assert plugin._state_file.path.read_bytes() == saved
    assert plugin._score_current_locked(job)
    asyncio.run(plugin.set_nicknames(scope="shared", nicknames={"stranger": "朋友"}))
    restored, _ = plugin._state_file.load()
    expected = copy.deepcopy(before)
    expected["shared"]["nicknames"] = {"stranger": "朋友"}
    assert restored == expected


@pytest.mark.parametrize("path", ["chat", "state_tool", "update_tool", "zero_score"])
def test_first_independent_interaction_persists_even_without_affection_change(plugin, runtime, path):
    asyncio.run(plugin.set_per_character(enabled=True))
    assert "MIO" not in plugin._state["characters"]
    if path == "chat":
        plugin._on_message(runtime.conv.Message(1, "user", "MIO", "今天天气怎么样"))
        plugin._on_message(runtime.conv.Message(2, "reply", "MIO", "天气晴朗"))
        plugin._complete = AsyncMock(return_value=(None, runtime.judge.UNBOUND))
        asyncio.run(plugin._score(plugin._jobs.get_nowait()))
    elif path == "state_tool":
        asyncio.run(plugin._make_state_handler("char:MIO")())
    elif path == "update_tool":
        asyncio.run(plugin._make_update_handler("char:MIO")(delta=0, reason="普通聊天"))
    else:
        plugin._apply_verdict(
            take_job(plugin, runtime, "MIO"), runtime.scoring.Verdict(0, "", False),
            "rules", runtime.judge.UNBOUND, model_attempted=False,
        )
    saved, _ = plugin._state_file.load()
    restored = runtime.engine.normalize_state(saved)["characters"]["MIO"]
    assert restored["affection"] == 0
    assert restored["first_met"] == plugin._state["characters"]["MIO"]["first_met"]


def test_interrupted_reply_cannot_accept_the_next_users_confession(plugin, runtime):
    runtime.engine.set_affection(plugin._state["shared"], 85, gate=True)
    for turn_type, text, arrival, spoken in [
        ("user_message", "你愿意帮我找书吗", 100, 100),
        ("user_message", "我喜欢你，和我在一起吧", 102, 102),
        ("assistant_message", "我愿意", 103, 101),
        ("assistant_message", "我还没准备好", 104, 103.5),
    ]:
        plugin._on_message(runtime.conv.parse_record({
            "timestamp": arrival, "content": text,
            "metadata": {"ts": spoken, "turn_type": turn_type, "lanlan_name": "YUI"},
        }))
    assert plugin._jobs.qsize() == 2
    plugin._complete = AsyncMock(return_value=(None, runtime.judge.UNBOUND))
    while not plugin._jobs.empty():
        asyncio.run(plugin._score(plugin._jobs.get_nowait()))
    assert not plugin._state["shared"]["confessed"]


def test_delayed_old_reply_cannot_trigger_proactive_confession_during_a_new_turn(plugin, runtime):
    runtime.engine.set_affection(plugin._state["shared"], 85, gate=True)
    plugin._state["settings"]["proactive_confession"] = True
    plugin.push_message = Mock()
    plugin._on_message(runtime.conv.Message(100, "user", "YUI", "你好", spoken_at=100))
    plugin._on_message(runtime.conv.Message(102, "user", "YUI", "我还有个问题", spoken_at=102))
    plugin._on_message(runtime.conv.Message(103, "reply", "YUI", "你好呀", spoken_at=101))
    job = plugin._jobs.get_nowait()
    plugin._apply_verdict(job, runtime.scoring.Verdict(0, "", False), "rules", "unbound", model_attempted=False)
    plugin.push_message.assert_not_called()
