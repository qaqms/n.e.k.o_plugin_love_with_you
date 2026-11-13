"""Exercise real plugin orchestration with an isolated SDK boundary.

The stub supplies decorators/results and the base context only. Queues, worker
threads, event loops, judging, state mutations and disk writes use plugin code.
"""

from __future__ import annotations

import asyncio
import copy
import importlib.util
import io
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

PLUGIN_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def runtime(monkeypatch, module_clock):
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
        for target in (module, module.engine, module.host):
            monkeypatch.setattr(target, "time", module_clock)
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


def shop_args(plugin, request_id="transaction_000001", **extra):
    result = {"request_id": request_id, "revision": plugin._state["shop"]["revision"], **extra}
    if "character" in extra:
        module = sys.modules[plugin.__class__.__module__]
        scope = module.engine.scope_key_for(plugin._state, extra["character"])
        record = module.engine.get_record(plugin._state, scope)
        product = module.shop.ITEMS.get(extra["item_id"], {"gain": 0})
        result.setdefault("relationship_revision", record["gain_revision"])
        result.setdefault("expected_gain", 0 if extra.get("gesture") else min(
            product["gain"], module.shop.gift_room(plugin._state["shop"], module.engine.today_str()),
            module.engine.gain_room(record, "gift"), 100 - record["affection"],
        ))
    return result


def prepare_gift(plugin):
    plugin._state["shop"]["inventory"]["cake"] = 3
    plugin.push_message = Mock(return_value={"submitted": True})


def restart_args(plugin, scope="shared"):
    module = sys.modules[plugin.__class__.__module__]
    record = module.engine.get_record(plugin._state, scope)
    return {"scope": scope, "expected_revision": record["gain_revision"], "expected_confessed": record["confessed"]}


def experience_args(plugin, operation, values, character="YUI", request_id=None):
    state = plugin._state["experiences"]
    record = state["characters"].get(character, {"revision": 0})
    return {
        "operation": operation, "values": values, "character": character,
        "revision": state["revision"] if operation == "configure" else record["revision"],
        "request_id": request_id or f"xp_request_{len(state['receipts']):08}",
    }


def confession_reply(plugin, runtime, ts, content, character="YUI", **kwargs):
    scope = runtime.engine.scope_key_for(plugin._state, character)
    record = runtime.engine.get_record(plugin._state, scope, create=False) or {}
    request_id = record.get("proactive_confession", {}).get("request_id", "")
    return runtime.conv.Message(
        ts, "proactive_reply", character, content,
        metadata={
            "event_type": "proactive_confession", "plugin_id": plugin.plugin_id,
            "coalesce_key": f"{plugin.plugin_id}:confession:{character}:{request_id}",
        }, **kwargs,
    )


def test_experience_actions_are_opt_in_atomic_and_do_not_change_affection_or_coins(plugin, runtime):
    before = copy.deepcopy(plugin._state["shared"]), copy.deepcopy(plugin._state["shop"])
    disabled = asyncio.run(plugin.experience_action(**experience_args(
        plugin, "start_note", {"title": "Together", "text": "First line"},
    )))
    assert isinstance(disabled, runtime.Err)
    enabled = asyncio.run(plugin.experience_action(**experience_args(
        plugin, "configure", {"enabled": True}, character="",
    )))
    assert isinstance(enabled, runtime.Ok)
    result = asyncio.run(plugin.experience_action(**experience_args(
        plugin, "start_note", {"title": "Together", "text": "First line"},
    )))
    assert isinstance(result, runtime.Ok)
    args = experience_args(plugin, "save_note", {"id": result.value["id"]})
    assert isinstance(asyncio.run(plugin.experience_action(**args)), runtime.Ok)
    assert asyncio.run(plugin.experience_action(**args)).value["replay"]
    assert len(plugin._state["experiences"]["characters"]["YUI"]["memories"]) == 1
    assert (plugin._state["shared"], plugin._state["shop"]) == before
    saved, _ = plugin._state_file.load()
    assert saved["experiences"] == plugin._state["experiences"]


def test_experience_failed_save_rolls_back_content_and_receipt(plugin, runtime, monkeypatch):
    plugin._state["experiences"]["enabled"] = True
    before = copy.deepcopy(plugin._state)
    monkeypatch.setattr(plugin._state_file, "save", Mock(side_effect=OSError("disk full")))
    result = asyncio.run(plugin.experience_action(**experience_args(
        plugin, "start_note", {"title": "Together", "text": "First line"},
    )))
    assert isinstance(result, runtime.Err)
    assert plugin._state == before


def test_experience_tool_is_role_bound_even_in_shared_mode_and_cannot_confirm_memory(plugin, runtime):
    plugin._state["experiences"]["enabled"] = True
    desired = plugin._desired_tools()
    tools = {name: spec for name, spec in desired.items() if spec[2] == "experience"}
    assert {spec[0] for spec in tools.values()} == {"YUI", "MIO"}
    assert all(spec[1] == "char:" + spec[0] for spec in tools.values())
    handler = plugin._make_experience_handler("YUI")
    args = experience_args(plugin, "propose_followup", {
        "summary": "Interview", "due": runtime.engine.today_str(),
    })
    args.pop("character")
    args["token"] = plugin._experience_token_locked("YUI")
    result = asyncio.run(handler(**args))
    assert result["saved_as_draft"]
    assert plugin._state["experiences"]["characters"]["YUI"]["followups"][0]["status"] == "pending"
    args["operation"] = "confirm_followup"
    assert asyncio.run(handler(**args))["is_error"]
    assert "MIO" not in plugin._state["experiences"]["characters"]


def test_experience_tool_replay_and_mode_change_reject_stale_calls(plugin, runtime):
    plugin._state["experiences"]["enabled"] = True
    handler = plugin._make_experience_handler("YUI")
    args = experience_args(plugin, "propose_followup", {
        "summary": "Interview", "due": runtime.engine.today_str(),
    })
    args.pop("character")
    args["token"] = plugin._experience_token_locked("YUI")
    assert not asyncio.run(handler(**args)).get("is_error")
    assert asyncio.run(handler(**args))["replay"]
    asyncio.run(plugin.set_per_character(enabled=True))
    assert asyncio.run(handler(**args))["error"] == "experience_stale"


def test_followup_only_submits_on_next_user_chat_and_does_not_repeatedly_prompt(plugin, runtime):
    plugin._state["experiences"]["enabled"] = True
    plugin.push_message = Mock(return_value={"submitted": True})
    result = asyncio.run(plugin.experience_action(**experience_args(
        plugin, "propose_followup", {"summary": "Interview", "due": runtime.engine.today_str()},
    )))
    asyncio.run(plugin.experience_action(**experience_args(
        plugin, "confirm_followup", {"id": result.value["id"]},
    )))
    assert not any('"followup":' in call.kwargs["parts"][0]["text"] for call in plugin.push_message.call_args_list)
    plugin._on_message(runtime.conv.Message(100, "user", "YUI", "Hello"))
    plugin._flush_context()
    followup_calls = [call for call in plugin.push_message.call_args_list if '"followup":' in call.kwargs["parts"][0]["text"]]
    assert len(followup_calls) == 1
    assert followup_calls[0].kwargs["ai_behavior"] == "read"
    assert plugin._state["experiences"]["characters"]["YUI"]["followups"][0]["prompt_submitted"]
    plugin._on_message(runtime.conv.Message(101, "user", "YUI", "Another topic"))
    plugin._flush_context()
    assert len([call for call in plugin.push_message.call_args_list if '"followup":' in call.kwargs["parts"][0]["text"]]) == 1


def test_rejected_followup_submission_remains_eligible_for_next_chat(plugin, runtime):
    plugin._state["experiences"]["enabled"] = True
    result = asyncio.run(plugin.experience_action(**experience_args(
        plugin, "propose_followup", {"summary": "Interview", "due": runtime.engine.today_str()},
    )))
    asyncio.run(plugin.experience_action(**experience_args(
        plugin, "confirm_followup", {"id": result.value["id"]},
    )))
    plugin.push_message = Mock(return_value={"submitted": False})
    plugin._on_message(runtime.conv.Message(100, "user", "YUI", "Hello"))
    plugin._context_entry("YUI")["retry_at"] = 0
    plugin._flush_context()
    assert not plugin._state["experiences"]["characters"]["YUI"]["followups"][0]["prompt_submitted"]


def test_note_invitation_replay_never_requests_second_response(plugin, runtime):
    plugin._state["experiences"]["enabled"] = True
    plugin.push_message = Mock(return_value={"submitted": True})
    created = asyncio.run(plugin.experience_action(**experience_args(
        plugin, "start_note", {"title": "Together", "text": "First line"},
    )))
    args = experience_args(plugin, "invite", {"id": created.value["id"]})
    result = asyncio.run(plugin.experience_action(**args))
    assert result.value["invitation"] == "submitted"
    assert asyncio.run(plugin.experience_action(**args)).value["replay"]
    responses = [call for call in plugin.push_message.call_args_list if call.kwargs["ai_behavior"] == "respond"]
    assert len(responses) == 1
    assert responses[0].kwargs["target_lanlan"] == "YUI"
    assert responses[0].kwargs["metadata"]["event_type"] == "experience_note"


def test_relationship_restart_cancels_only_participating_experiences(plugin, runtime):
    plugin._state["per_character"] = True
    plugin._state["experiences"]["enabled"] = True
    for name in ["YUI", "MIO"]:
        runtime.engine.get_record(plugin._state, "char:" + name)
        asyncio.run(plugin.experience_action(**experience_args(
            plugin, "start_note", {"title": "Together", "text": "First line"}, character=name,
        )))
    before = copy.deepcopy(plugin._state["experiences"]["characters"]["MIO"])
    result = asyncio.run(plugin.restart_relationship(**restart_args(plugin, "char:YUI")))
    assert isinstance(result, runtime.Ok)
    assert plugin._state["experiences"]["characters"]["YUI"]["note"] is None
    assert plugin._state["experiences"]["characters"]["MIO"] == before


def test_startup_preserves_opt_out_and_rejects_unknown_experience_format(plugin, runtime):
    raw = copy.deepcopy(plugin._state)
    raw["experiences"] = {"version": 999}
    plugin._state_file.save(raw)
    result = asyncio.run(plugin.startup())
    assert isinstance(result, runtime.Err)
    assert not plugin._ready


def test_experience_model_query_never_returns_disabled_memories(plugin, runtime):
    plugin._state["experiences"]["enabled"] = True
    created = asyncio.run(plugin.experience_action(**experience_args(
        plugin, "start_note", {"title": "Private note", "text": "Do not recall this"},
    )))
    asyncio.run(plugin.experience_action(**experience_args(
        plugin, "save_note", {"id": created.value["id"]},
    )))
    asyncio.run(plugin.experience_action(**experience_args(
        plugin, "toggle_memory", {"id": created.value["id"], "recall": False},
    )))
    handler = plugin._make_experience_handler("YUI")
    result = asyncio.run(handler(operation="status", token=plugin._experience_token_locked("YUI")))
    assert not result["record"]["memories"]
    assert "Do not recall this" not in repr(result)


def test_experience_model_save_failure_rolls_back_draft_and_receipt(plugin, runtime, monkeypatch):
    plugin._state["experiences"]["enabled"] = True
    before = copy.deepcopy(plugin._state)
    handler = plugin._make_experience_handler("YUI")
    monkeypatch.setattr(plugin._state_file, "save", Mock(side_effect=OSError("disk full")))
    result = asyncio.run(handler(
        operation="propose_followup", token=plugin._experience_token_locked("YUI"),
        revision=0, request_id="propose_000001",
        values={"summary": "Interview", "due": runtime.engine.today_str()},
    ))
    assert result["error"] == "experience_save_failed"
    assert plugin._state == before


def test_followup_save_outage_recovers_before_first_submission(plugin, runtime, monkeypatch):
    plugin._state["experiences"]["enabled"] = True
    created = asyncio.run(plugin.experience_action(**experience_args(
        plugin, "propose_followup", {"summary": "Interview", "due": runtime.engine.today_str()},
    )))
    asyncio.run(plugin.experience_action(**experience_args(
        plugin, "confirm_followup", {"id": created.value["id"]},
    )))
    plugin.push_message = Mock(return_value={"submitted": True})
    plugin._on_message(runtime.conv.Message(100, "user", "YUI", "Hello"))
    save = plugin._state_file.save
    monkeypatch.setattr(plugin._state_file, "save", Mock(side_effect=OSError("disk full")))
    plugin._context_entry("YUI")["retry_at"] = 0
    plugin._flush_context()
    assert not plugin._state["experiences"]["characters"]["YUI"]["followups"][0]["prompt_submitted"]
    plugin.push_message.assert_not_called()
    monkeypatch.setattr(plugin._state_file, "save", save)
    plugin._context_entry("YUI")["retry_at"] = 0
    plugin._flush_context()
    assert plugin._state["experiences"]["characters"]["YUI"]["followups"][0]["prompt_submitted"]
    plugin._on_message(runtime.conv.Message(101, "user", "YUI", "Another topic"))
    plugin._flush_context()
    assert len([call for call in plugin.push_message.call_args_list if '"followup":' in call.kwargs["parts"][0]["text"]]) == 1


def test_followup_submission_does_not_consume_a_concurrently_postponed_item(plugin, runtime):
    plugin._state["experiences"]["enabled"] = True
    created = asyncio.run(plugin.experience_action(**experience_args(
        plugin, "propose_followup", {"summary": "Interview", "due": runtime.engine.today_str()},
    )))
    asyncio.run(plugin.experience_action(**experience_args(
        plugin, "confirm_followup", {"id": created.value["id"]},
    )))

    def postpone(**_):
        with plugin._state_transaction_locked():
            runtime.experiences.apply(
                plugin._state["experiences"], **experience_args(
                    plugin, "edit_followup", {"id": created.value["id"], "due": "2099-12-31"},
                ), today=runtime.engine.today_str(),
            )
            plugin._save_locked()
        return {"submitted": True}

    plugin.push_message = Mock(side_effect=postpone)
    plugin._on_message(runtime.conv.Message(100, "user", "YUI", "Hello"))
    plugin._context_entry("YUI")["retry_at"] = 0
    plugin._flush_context()
    assert not plugin._state["experiences"]["characters"]["YUI"]["followups"][0]["prompt_submitted"]


def test_total_experience_payload_limit_rolls_back_new_content(plugin, runtime, monkeypatch):
    plugin._state["experiences"]["enabled"] = True
    before = copy.deepcopy(plugin._state)
    monkeypatch.setattr(runtime.experiences, "MAX_BYTES", 10)
    result = asyncio.run(plugin.experience_action(**experience_args(
        plugin, "start_note", {"title": "Together", "text": "First line"},
    )))
    assert isinstance(result, runtime.Err)
    assert "experience_limit" in str(result.error)
    assert plugin._state == before


def income_turn(plugin, runtime, timestamp, text, character="YUI"):
    plugin._on_message(runtime.conv.Message(timestamp, "user", character, text))
    plugin._on_message(runtime.conv.Message(timestamp + 1, "reply", character, "received"))


def test_runtime_fake_clock_is_shared_only_by_the_tested_modules(runtime, monkeypatch):
    real_time = sys.modules["time"].time
    monkeypatch.setattr(runtime.time, "time", lambda: 123.0)
    assert runtime.time.time() == runtime.engine.time.time() == runtime.host.time.time() == 123.0
    assert sys.modules["time"].time is real_time


def test_income_works_without_model_or_auto_score_and_survives_replay(plugin, runtime, monkeypatch):
    now = 1_800_000_000.0
    monkeypatch.setattr(runtime.time, "time", lambda: now + 2)
    plugin._state["settings"]["auto_score"] = False
    income_turn(plugin, runtime, now, "morning")
    assert plugin._state["shop"]["coins"] == 100
    today = runtime.engine.today_str()
    assert plugin._state["shop"]["days"][today]["count"] == 1
    assert plugin._jobs.empty()
    saved, _ = plugin._state_file.load()
    assert "morning" not in str(saved["shop"])
    plugin._state = runtime.engine.normalize_state(saved)
    plugin._state["shop"] = runtime.shop.normalize(saved["shop"])
    plugin._income_tracker.reset()
    income_turn(plugin, runtime, now, "morning")
    assert plugin._state["shop"]["coins"] == 100
    assert plugin._state["shop"]["income_total"] == 0
    assert plugin._state["shop"]["days"][today]["count"] == 1
    claimed = asyncio.run(plugin.claim_shop_coins(**shop_args(plugin, reward="daily_1", period=today)))
    assert isinstance(claimed, runtime.Ok) and claimed.value["credited"] == 10
    assert plugin._state["shop"]["coins"] == 110


def test_income_save_failure_rolls_back_and_retries_pending_fact(plugin, runtime, monkeypatch):
    now = 1_800_000_000.0
    monkeypatch.setattr(runtime.time, "time", lambda: now + 2)
    save = plugin._state_file.save
    plugin._state_file.save = Mock(side_effect=OSError("full"))
    income_turn(plugin, runtime, now, "hello")
    assert plugin._state["shop"]["coins"] == 100
    assert plugin._state["shop"]["days"] == {}
    assert len(plugin._income_pending) == 1
    assert plugin._income_error == "save_failed"
    plugin._state_file.save = save
    with plugin._lock:
        plugin._flush_income_locked()
    assert plugin._state["shop"]["coins"] == 100
    assert plugin._state["shop"]["days"][runtime.engine.today_str()]["count"] == 1
    assert not plugin._income_pending and not plugin._income_error
    with plugin._lock:
        plugin._flush_income_locked()
    assert plugin._state["shop"]["coins"] == 100


def test_income_is_global_and_not_reset_by_scoring_changes(plugin, runtime, monkeypatch):
    now = 1_800_000_000.0
    monkeypatch.setattr(runtime.time, "time", lambda: now + 100)
    income_turn(plugin, runtime, now, "first", "YUI")
    plugin._invalidate_scoring_locked()
    income_turn(plugin, runtime, now + 21, "second", "MIO")
    income_turn(plugin, runtime, now + 42, "third", "YUI")
    assert plugin._state["shop"]["coins"] == 100
    assert plugin._state["shop"]["days"][runtime.engine.today_str()]["count"] == 3
    assert len(plugin._state["shop"]["days"]) == 1
    plugin._on_message(runtime.conv.Message(now + 70, runtime.conv.PROACTIVE_REPLY_TURN, "YUI", "thanks"))
    assert plugin._state["shop"]["coins"] == 100


def test_gift_confirmation_rejects_changed_relationship_without_consuming(plugin, runtime):
    prepare_gift(plugin)
    args = shop_args(plugin, item_id="cake", character="YUI")
    runtime.engine.apply_model_delta(plugin._state["shared"], 1, "chat", cooldown=0)
    before = copy.deepcopy(plugin._state)
    result = asyncio.run(plugin.send_shop_gift(**args))
    assert isinstance(result, runtime.Err) and str(result.error) == "shop_gain_changed"
    assert plugin._state == before
    plugin.push_message.assert_not_called()


def test_new_gift_cannot_omit_explicit_expected_gain(plugin, runtime):
    prepare_gift(plugin)
    args = shop_args(plugin, item_id="cake", character="YUI")
    del args["expected_gain"]
    result = asyncio.run(plugin.send_shop_gift(**args))
    assert isinstance(result, runtime.Err) and str(result.error) == "shop_invalid_request"
    assert plugin._state["shop"]["inventory"]["cake"] == 3


def test_gesture_at_full_affection_has_one_global_daily_use_and_idempotency(plugin, runtime):
    prepare_gift(plugin)
    plugin._state["shared"] = runtime.engine.new_record(100)
    args = shop_args(plugin, item_id="cake", character="YUI", gesture=True)
    result = asyncio.run(plugin.send_shop_gift(**args))
    assert isinstance(result, runtime.Ok) and result.value["applied"] == 0
    assert plugin._state["shop"]["inventory"]["cake"] == 2
    assert plugin._state["shop"]["gift_gain"] == 0
    assert plugin._state["shared"]["affection"] == 100
    assert isinstance(asyncio.run(plugin.send_shop_gift(**args)), runtime.Ok)
    assert plugin._state["shop"]["inventory"]["cake"] == 2
    result = asyncio.run(plugin.send_shop_gift(**shop_args(
        plugin, "another_gesture_0001", item_id="cake", character="MIO", gesture=True,
    )))
    assert isinstance(result, runtime.Err) and str(result.error) == "shop_gesture_limit"
    assert plugin._state["shop"]["inventory"]["cake"] == 2
    assert plugin.push_message.call_count == 1


def test_chat_and_gift_can_each_use_four_points_in_runtime(plugin, runtime):
    prepare_gift(plugin)
    runtime.engine.apply_model_delta(plugin._state["shared"], 4, "chat", cooldown=0)
    for n in range(2):
        result = asyncio.run(plugin.send_shop_gift(**shop_args(
            plugin, f"separate_cap_{n:04}", item_id="cake", character="YUI",
        )))
        assert isinstance(result, runtime.Ok)
    assert plugin._state["shared"]["gained_today"] == 8
    assert plugin._state["shared"]["gained_chat"] == 4
    assert plugin._state["shared"]["gained_gift"] == 4


def test_income_progress_makes_old_purchase_revision_stale_without_charging(plugin, runtime, monkeypatch):
    args = shop_args(plugin, item_id="cake")
    now = 1_800_000_000.0
    monkeypatch.setattr(runtime.time, "time", lambda: now + 2)
    income_turn(plugin, runtime, now, "hello")
    result = asyncio.run(plugin.buy_shop_item(**args))
    assert isinstance(result, runtime.Err) and str(result.error) == "shop_stale"
    assert plugin._state["shop"]["coins"] == 100
    assert plugin._state["shop"]["inventory"].get("cake", 0) == 0


def test_startup_migrates_legacy_once_with_backup_and_preserves_old_receipt(plugin, runtime):
    raw = copy.deepcopy(plugin._state)
    raw["shop"] = {
        "coins": 60, "inventory": {"cake": 1}, "revision": 1,
        "receipts": [{"id": "old_claim_000001", "signature": [0, "claim", "", ""],
                      "result": {"coins": 60, "credited": 60}}],
    }
    raw["shared"].pop("quota_version")
    raw["shared"]["gained_today"] = 2
    plugin._state_file.save(raw)
    plugin._start_worker = Mock()
    assert isinstance(asyncio.run(plugin.startup()), runtime.Ok)
    assert plugin._state["shop"]["coins"] == 60
    assert plugin._state["shared"]["quota_blocked_day"] == raw["shared"]["day"]
    backup = runtime.StateFile(plugin.data_path("state.pre-economy-v2.json"))
    assert backup.load()[0] == raw
    replayed = asyncio.run(plugin.claim_shop_coins(request_id="old_claim_000001", revision=0))
    assert isinstance(replayed, runtime.Ok) and replayed.value["credited"] == 60
    migrated = copy.deepcopy(plugin._state)
    assert isinstance(asyncio.run(plugin.startup()), runtime.Ok)
    assert plugin._state == migrated
    assert backup.load()[0] == raw


def test_corrupt_state_never_silently_creates_another_wallet(plugin, runtime):
    plugin._state_file.path.write_text("{broken", encoding="utf-8")
    plugin._start_worker = Mock()
    result = asyncio.run(plugin.startup())
    assert isinstance(result, runtime.Err) and str(result.error) == "state_recovery_required"
    assert not plugin._ready
    assert not plugin._state_file.path.exists()
    assert list(plugin.ctx.data_dir.glob("state.corrupt-*"))
    plugin._start_worker.assert_not_called()
    result = asyncio.run(plugin.startup())
    assert isinstance(result, runtime.Err)
    assert not plugin._state_file.path.exists()


@pytest.mark.parametrize(("area", "key", "value"), [
    ("root", "version", 999), ("root", "version", True), ("root", "version", "3"),
    ("shop", "economy_version", 999), ("shop", "economy_version", True),
    ("shop", "economy_version", "2"),
])
def test_unknown_storage_versions_never_rewrite_the_save(plugin, runtime, area, key, value):
    raw = copy.deepcopy(plugin._state)
    (raw if area == "root" else raw[area])[key] = value
    raw["shop"]["coins"] = 321
    plugin._state_file.save(raw)
    before = plugin._state_file.path.read_bytes()
    plugin._start_worker = Mock()
    result = asyncio.run(plugin.startup())
    assert isinstance(result, runtime.Err)
    assert not plugin._ready
    assert plugin._state_file.path.read_bytes() == before
    assert not list(plugin.ctx.data_dir.glob("state.pre-*"))
    plugin._start_worker.assert_not_called()


@pytest.mark.parametrize("corruption", ["null", "character_map", "character_record"])
def test_structurally_broken_state_is_not_replaced_with_empty_records(plugin, runtime, corruption):
    raw = copy.deepcopy(plugin._state)
    if corruption == "null":
        raw = None
    elif corruption == "character_map":
        raw["characters"] = ["YUI"]
    else:
        raw["characters"] = {"YUI": None}
    plugin._state_file.save(raw)
    before = plugin._state_file.path.read_bytes()
    plugin._start_worker = Mock()
    for _ in range(2):
        result = asyncio.run(plugin.startup())
        assert isinstance(result, runtime.Err) and str(result.error) == "state_recovery_required"
        assert plugin._state_file.path.read_bytes() == before and not plugin._ready
    plugin._start_worker.assert_not_called()


def test_followup_is_durable_before_queue_submission_and_not_resent_after_crash(plugin, runtime):
    plugin._state["experiences"]["enabled"] = True
    result = asyncio.run(plugin.experience_action(**experience_args(
        plugin, "propose_followup", {"summary": "Interview", "due": runtime.engine.today_str()},
    )))
    asyncio.run(plugin.experience_action(**experience_args(
        plugin, "confirm_followup", {"id": result.value["id"]},
    )))
    queued_state = []

    def submit(**kwargs):
        if '"followup":' in kwargs["parts"][0]["text"]:
            queued_state.append(plugin._state_file.load()[0])
        return {"submitted": True}

    plugin.push_message = Mock(side_effect=submit)
    plugin._on_message(runtime.conv.Message(100, "user", "YUI", "Hello"))
    plugin._context_entry("YUI")["retry_at"] = 0
    plugin._flush_context()
    assert len(queued_state) == 1
    snapshot = queued_state[0]
    assert snapshot["experiences"]["characters"]["YUI"]["followups"][0]["prompt_submitted"]
    # Restore exactly what was durable when the external queue accepted the prompt.
    plugin._state_file.save(snapshot)
    plugin._start_worker = Mock()
    assert isinstance(asyncio.run(plugin.startup()), runtime.Ok)
    plugin.push_message.reset_mock()
    plugin._on_message(runtime.conv.Message(101, "user", "YUI", "Another topic"))
    plugin._flush_context()
    assert not any('"followup":' in call.kwargs["parts"][0]["text"]
                   for call in plugin.push_message.call_args_list)


def test_followup_save_failure_prevents_submission_and_leaves_it_eligible(plugin, runtime, monkeypatch):
    plugin._state["experiences"]["enabled"] = True
    result = asyncio.run(plugin.experience_action(**experience_args(
        plugin, "propose_followup", {"summary": "Interview", "due": runtime.engine.today_str()},
    )))
    asyncio.run(plugin.experience_action(**experience_args(
        plugin, "confirm_followup", {"id": result.value["id"]},
    )))
    plugin.push_message = Mock(return_value={"submitted": True})
    plugin._on_message(runtime.conv.Message(100, "user", "YUI", "Hello"))
    plugin._context_entry("YUI")["retry_at"] = 0
    monkeypatch.setattr(plugin._state_file, "save", Mock(side_effect=OSError("disk full")))
    plugin._flush_context()
    assert not plugin.push_message.called
    assert not plugin._state["experiences"]["characters"]["YUI"]["followups"][0]["prompt_submitted"]


def test_shutdown_during_character_sync_cannot_save_or_publish_late_work(plugin, runtime, monkeypatch):
    started, release = threading.Event(), threading.Event()
    plugin._sync_characters = runtime.LoveWithYouPlugin._sync_characters.__get__(plugin)
    plugin._verify_tools = AsyncMock()
    plugin._poll_conversations = AsyncMock(return_value=True)
    plugin._poll_recent_conversations = AsyncMock(return_value=True)
    plugin._reconcile_tools = runtime.LoveWithYouPlugin._reconcile_tools.__get__(plugin)
    plugin.register_llm_tool = Mock()
    plugin.unregister_llm_tool = Mock()
    plugin.push_message = Mock(return_value={"submitted": True})
    before = copy.deepcopy(plugin._state)

    def fetch():
        started.set()
        assert release.wait(timeout=3)
        return ["LATE"], "LATE"

    monkeypatch.setattr(runtime.host, "fetch_characters", fetch)

    async def scenario():
        task = asyncio.create_task(plugin.maintain())
        try:
            assert await asyncio.to_thread(started.wait, 2)
            assert isinstance(await plugin.shutdown(), runtime.Ok)
        finally:
            release.set()
            await asyncio.wait_for(task, timeout=3)

    asyncio.run(scenario())
    assert plugin._state == before
    plugin.push_message.assert_not_called()
    plugin.register_llm_tool.assert_not_called()
    assert not plugin._state_file.path.exists()


def test_state_query_after_stop_cannot_mark_activity_or_write_save(plugin, runtime):
    handler = plugin._make_state_handler("shared")
    plugin._stop_worker()
    before = copy.deepcopy(plugin._state)
    result = asyncio.run(handler())
    assert result.get("is_error") and result["error"] == "NOT_READY"
    assert plugin._state == before
    assert not plugin._state_file.path.exists()


@pytest.mark.parametrize("action", ["affection", "addressing", "anniversary", "settings", "mode"])
def test_stopped_panel_actions_cannot_modify_relationship_data(plugin, runtime, action):
    plugin._stop_worker()
    before = copy.deepcopy(plugin._state)
    operations = {
        "affection": lambda: plugin.set_affection(scope="shared", value=60),
        "addressing": lambda: plugin.set_addressing(
            scope="shared", changes={"preferred_name": "Changed"},
            expected=copy.deepcopy(plugin._state["shared"]["addressing"]),
        ),
        "anniversary": lambda: plugin.add_anniversary(title="Changed", month=1, day=1),
        "settings": lambda: plugin.set_settings(decay=True),
        "mode": lambda: plugin.set_per_character(enabled=True),
    }
    result = asyncio.run(operations[action]())
    assert isinstance(result, runtime.Err) and str(result.error) == "not_ready"
    assert plugin._state == before
    assert not plugin._state_file.path.exists()


@pytest.mark.parametrize("namespace", ["shop", "experiences"])
def test_domain_rollback_preserves_other_domain_identity(plugin, namespace):
    untouched = "experiences" if namespace == "shop" else "shop"
    sibling = plugin._state[untouched]
    before = copy.deepcopy(plugin._state[namespace])
    with pytest.raises(OSError):
        with plugin._lock, plugin._state_transaction_locked(namespace):
            plugin._state[namespace].clear()
            raise OSError("save rejected")
    assert plugin._state[namespace] == before
    assert plugin._state[untouched] is sibling


def test_full_rollback_still_restores_cross_domain_transactions(plugin):
    before = copy.deepcopy(plugin._state)
    with pytest.raises(OSError):
        with plugin._lock, plugin._state_transaction_locked():
            plugin._state["shop"]["coins"] = 0
            plugin._state["shared"]["affection"] = 90
            plugin._state["experiences"]["enabled"] = True
            raise OSError("save rejected")
    assert plugin._state == before


@pytest.mark.parametrize("resource", ["portrait", "appearance"])
def test_stopped_asset_actions_do_not_invoke_services(plugin, runtime, resource):
    service = Mock()
    setattr(plugin, "_portraits" if resource == "portrait" else "_appearance", service)
    plugin._stop_worker()
    operation = plugin.set_portraits(mode="off") if resource == "portrait" else plugin.set_appearance(
        accent_color="#123456", color_scheme="dark",
    )
    result = asyncio.run(operation)
    assert isinstance(result, runtime.Err) and str(result.error) == "not_ready"
    assert not service.method_calls


def test_asset_io_does_not_hold_the_relationship_lock_and_stop_drains_it(plugin, runtime):
    started, release, stopped = threading.Event(), threading.Event(), threading.Event()

    def update(*_):
        started.set()
        assert release.wait(timeout=3)
        return {"saved": True}

    plugin._appearance = SimpleNamespace(update=update)

    async def scenario():
        task = asyncio.create_task(plugin.set_appearance(accent_color="#123456", color_scheme="dark"))
        stop = None
        try:
            assert await asyncio.to_thread(started.wait, 2)
            # Run in a different thread: an RLock acquired by this event loop
            # would otherwise hide an accidental main-lock hold in asset I/O.
            def check():
                acquired = plugin._lock.acquire(timeout=0.2)
                if acquired:
                    plugin._lock.release()
                return acquired

            assert await asyncio.to_thread(check)

            def stop_worker():
                result = plugin._stop_worker()
                stopped.set()
                return result

            stop = asyncio.create_task(asyncio.to_thread(stop_worker))
            await asyncio.sleep(0)
            assert not stopped.is_set()
        finally:
            release.set()
            result = await asyncio.wait_for(task, timeout=3)
            assert isinstance(result, runtime.Ok)
            if stop is not None:
                assert await asyncio.wait_for(stop, timeout=3)
        assert not plugin._ready

    asyncio.run(scenario())


def test_legacy_artwork_reader_stays_bounded_when_a_file_grows(plugin, runtime, monkeypatch):
    reads = []

    class Stream(io.BytesIO):
        def read(self, size=-1):
            reads.append(size)
            return super().read(size)

    art = SimpleNamespace(
        name="decoration.webp", suffix=".webp",
        stat=lambda: SimpleNamespace(st_size=10, st_mtime_ns=1),
        open=lambda *_: Stream(b"x" * (runtime._ART_MAX_BYTES + 100)),
    )
    monkeypatch.setattr(plugin, "_art_path", lambda _: art)
    assert plugin._load_decoration(None) == {"available": False}
    assert reads == [runtime._ART_MAX_BYTES + 1]
    assert not plugin._art_cache


def test_missing_optional_artwork_cannot_break_dashboard_refresh(plugin, runtime, monkeypatch):
    def missing():
        raise FileNotFoundError("optional artwork was removed")

    art = SimpleNamespace(stat=missing)
    monkeypatch.setattr(plugin, "_art_path", lambda _: art)
    assert plugin._art_meta("decoration") == {"available": False}
    assert plugin._load_decoration(None) == {"available": False}
    dashboard = asyncio.run(plugin.dashboard())
    assert dashboard["scopes"][0]["affection"] == 10
    assert not dashboard["decoration"]["default"]["available"]


@pytest.mark.parametrize("receipt", [None, {}, {"submitted": 1}, {"submitted": False}, {"submitted": True}])
def test_note_invitation_requires_an_explicit_submission_receipt(plugin, runtime, receipt):
    plugin._state["experiences"]["enabled"] = True
    plugin.push_message = Mock(return_value=receipt)
    note = asyncio.run(plugin.experience_action(**experience_args(
        plugin, "start_note", {"title": "Together", "text": "First line"},
    )))
    result = asyncio.run(plugin.experience_action(**experience_args(
        plugin, "invite", {"id": note.value["id"]},
    )))
    expected = "unknown"
    if receipt and receipt.get("submitted") is True:
        expected = "submitted"
    elif receipt and receipt.get("submitted") is False:
        expected = "unavailable"
    assert result.value["invitation"] == expected
    saved, _ = plugin._state_file.load()
    assert saved["experiences"]["characters"]["YUI"]["note"]["invitation"] == expected


@pytest.mark.parametrize("receipt", [None, {}, {"submitted": 1}, TimeoutError("unknown result")])
def test_uncertain_followup_submission_is_never_automatically_repeated(plugin, runtime, receipt):
    plugin._state["experiences"]["enabled"] = True
    note = asyncio.run(plugin.experience_action(**experience_args(
        plugin, "propose_followup", {"summary": "Interview", "due": runtime.engine.today_str()},
    )))
    asyncio.run(plugin.experience_action(**experience_args(
        plugin, "confirm_followup", {"id": note.value["id"]},
    )))
    plugin.push_message = Mock(
        **({"side_effect": receipt} if isinstance(receipt, Exception) else {"return_value": receipt})
    )
    plugin._on_message(runtime.conv.Message(100, "user", "YUI", "Hello"))
    plugin._context_entry("YUI")["retry_at"] = 0
    plugin._flush_context()
    plugin._start_worker = Mock()
    assert isinstance(asyncio.run(plugin.startup()), runtime.Ok)
    plugin._on_message(runtime.conv.Message(101, "user", "YUI", "Another topic"))
    plugin._context_entry("YUI")["retry_at"] = 0
    plugin._flush_context()
    assert sum('"followup":' in call.kwargs["parts"][0]["text"]
               for call in plugin.push_message.call_args_list) == 1


def test_old_bus_response_is_discarded_even_after_restart(plugin, runtime):
    async def scenario():
        started, release = asyncio.Event(), asyncio.Event()

        async def get(**_):
            started.set()
            await release.wait()
            return [{"timestamp": 10, "turn_type": "user_message", "lanlan_name": "YUI", "content": "Old turn"}]

        plugin._cursor = runtime.conv.BusCursor(0)
        plugin.ctx.bus = SimpleNamespace(conversations=SimpleNamespace(get=get))
        pending = asyncio.create_task(plugin._poll_conversations())
        await asyncio.wait_for(started.wait(), timeout=2)
        await plugin.shutdown()
        plugin._start_worker = Mock()
        assert isinstance(await plugin.startup(), runtime.Ok)
        before = copy.deepcopy(plugin._state)
        release.set()
        assert not await asyncio.wait_for(pending, timeout=2)
        assert plugin._state == before
        assert not plugin._conversation_sources
        assert plugin._auto["seen"] == 0

    asyncio.run(scenario())


def test_old_tool_verification_cannot_unregister_new_session_tools(plugin, runtime, monkeypatch):
    started, release = threading.Event(), threading.Event()
    plugin.unregister_llm_tool = Mock()
    plugin._registered = {"love_state": (None, "current")}

    def fetch():
        started.set()
        assert release.wait(timeout=3)
        return {"YUI": set()}

    monkeypatch.setattr(runtime.host, "fetch_tools_by_role", fetch)

    async def scenario():
        pending = asyncio.create_task(plugin._verify_tools())
        try:
            assert await asyncio.to_thread(started.wait, 2)
            await plugin.shutdown()
            plugin._start_worker = Mock()
            assert isinstance(await plugin.startup(), runtime.Ok)
            plugin.unregister_llm_tool.reset_mock()
        finally:
            release.set()
            await asyncio.wait_for(pending, timeout=3)

    asyncio.run(scenario())
    plugin.unregister_llm_tool.assert_not_called()
    assert plugin._live_roles is None


def test_shop_buy_persists_once_and_claims_require_specific_rewards(plugin, runtime):
    args = shop_args(plugin)
    bought = asyncio.run(plugin.buy_shop_item(**args, item_id="cake"))
    assert isinstance(bought, runtime.Ok)
    assert asyncio.run(plugin.buy_shop_item(**args, item_id="cake")).value == bought.value
    economy = plugin._state["shop"]
    assert economy["coins"] == 60 and economy["inventory"]["cake"] == 1
    assert economy["revision"] == 1
    claimed = asyncio.run(plugin.claim_shop_coins(**shop_args(plugin, "transaction_000002")))
    assert isinstance(claimed, runtime.Err)
    assert str(claimed.error) == "shop_invalid_request"
    raw, warning = plugin._state_file.load()
    assert warning is None
    loaded = runtime.engine.normalize_state(raw)
    assert runtime.shop.normalize(loaded["shop"]) == economy
    assert economy["coins"] == 60
    rejected = asyncio.run(plugin.claim_shop_coins(**shop_args(plugin, "transaction_000003")))
    assert isinstance(rejected, runtime.Err)
    assert str(rejected.error) == "shop_invalid_request"


def test_concurrent_duplicate_purchase_only_charges_once(plugin, runtime):
    from concurrent.futures import ThreadPoolExecutor

    args = shop_args(plugin)
    with ThreadPoolExecutor(max_workers=3) as workers:
        results = list(workers.map(lambda _: asyncio.run(plugin.buy_shop_item(**args, item_id="cake")), range(3)))
    assert all(isinstance(result, runtime.Ok) for result in results)
    assert plugin._state["shop"]["coins"] == 60
    assert plugin._state["shop"]["inventory"]["cake"] == 1


def test_manual_claim_is_atomic_and_same_request_recovers_after_save_failure(plugin, runtime, monkeypatch):
    now = 1_800_000_000.0
    monkeypatch.setattr(runtime.time, "time", lambda: now + 2)
    income_turn(plugin, runtime, now, "morning")
    today = runtime.engine.today_str()
    args = shop_args(plugin, reward="daily_1", period=today)
    before = copy.deepcopy(plugin._state)
    save = plugin._state_file.save
    plugin._state_file.save = Mock(side_effect=OSError("full"))
    with pytest.raises(runtime.SdkError):
        asyncio.run(plugin.claim_shop_coins(**args))
    assert plugin._state == before
    assert plugin._state_file.load()[0] == before
    plugin._state_file.save = save
    claimed = asyncio.run(plugin.claim_shop_coins(**args))
    assert isinstance(claimed, runtime.Ok) and claimed.value["credited"] == 10
    assert plugin._state["shop"]["coins"] == 110
    saved, _ = plugin._state_file.load()
    plugin._state["shop"] = runtime.shop.normalize(saved["shop"])
    monkeypatch.setattr(runtime.time, "time", lambda: now + 3 * 86400)
    assert asyncio.run(plugin.claim_shop_coins(**args)).value == claimed.value
    assert plugin._state["shop"]["coins"] == 110
    assert len(plugin._state["shop"]["ledger"]) == 1


def test_concurrent_claims_only_credit_once_and_bind_reward_parameters(plugin, runtime, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor

    now = 1_800_000_000.0
    monkeypatch.setattr(runtime.time, "time", lambda: now + 100)
    for index in range(3):
        income_turn(plugin, runtime, now + index * 21, f"turn {index}")
    today = runtime.engine.today_str()
    args = shop_args(plugin, reward="daily_3", period=today)
    with ThreadPoolExecutor(max_workers=3) as workers:
        results = list(workers.map(lambda _: asyncio.run(plugin.claim_shop_coins(**args)), range(3)))
    assert all(isinstance(result, runtime.Ok) for result in results)
    assert plugin._state["shop"]["coins"] == 110 and plugin._state["shop"]["income_total"] == 10
    for changed in [{"reward": "daily_1"}, {"period": "2026-01-01"}]:
        result = asyncio.run(plugin.claim_shop_coins(**{**args, **changed}))
        assert isinstance(result, runtime.Err) and str(result.error) == "shop_invalid_request"
    before = copy.deepcopy(plugin._state)
    result = asyncio.run(plugin.claim_shop_coins(**shop_args(plugin, "duplicate_reward_001", reward="daily_3", period=today)))
    assert isinstance(result, runtime.Err) and str(result.error) == "shop_already_claimed"
    assert plugin._state == before
    result = asyncio.run(plugin.claim_shop_coins(**shop_args(plugin, "other_reward_000001", reward="daily_1", period=today)))
    assert isinstance(result, runtime.Ok)
    assert plugin._state["shop"]["coins"] == 120


def test_concurrent_distinct_requests_for_same_reward_reject_stale_revision(plugin, runtime, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor

    now = 1_800_000_000.0
    monkeypatch.setattr(runtime.time, "time", lambda: now + 2)
    income_turn(plugin, runtime, now, "hello")
    requests = [shop_args(plugin, f"claim_race_{index:05}", reward="daily_1", period=runtime.engine.today_str())
                for index in range(3)]
    with ThreadPoolExecutor(max_workers=3) as workers:
        results = list(workers.map(lambda args: asyncio.run(plugin.claim_shop_coins(**args)), requests))
    assert sum(isinstance(result, runtime.Ok) for result in results) == 1
    assert [str(result.error) for result in results if isinstance(result, runtime.Err)] == ["shop_stale"] * 2
    assert plugin._state["shop"]["coins"] == 110


def test_gift_is_atomic_and_does_not_repeat_effects_or_response(plugin, runtime):
    prepare_gift(plugin)
    args = shop_args(plugin, item_id="cake", character="YUI")
    before = plugin._state["shared"]["affection"]
    result = asyncio.run(plugin.send_shop_gift(**args))
    assert isinstance(result, runtime.Ok)
    assert result.value["reaction"] == "submitted"
    assert result.value["applied"] == 2
    replay = asyncio.run(plugin.send_shop_gift(**args))
    assert isinstance(replay, runtime.Ok)
    assert plugin._state["shared"]["affection"] == before + 2
    assert plugin._state["shop"]["inventory"]["cake"] == 2
    assert len(plugin._state["shop"]["history"]) == 1
    assert len([item for item in plugin._state["shared"]["history"] if item["source"] == "gift"]) == 1
    assert plugin.push_message.call_count == 1
    assert plugin.push_message.call_args.kwargs["target_lanlan"] == "YUI"
    assert plugin.push_message.call_args.kwargs["ai_behavior"] == "respond"


@pytest.mark.parametrize("action", ["buy_shop_item", "send_shop_gift"])
def test_shop_disk_failure_rolls_back_all_state(plugin, runtime, monkeypatch, action):
    prepare_gift(plugin)
    before = copy.deepcopy(plugin._state)
    monkeypatch.setattr(plugin._state_file, "save", Mock(side_effect=OSError("full")))
    args = shop_args(plugin, item_id="cake", **({"character": "YUI"} if action == "send_shop_gift" else {}))
    with pytest.raises(RuntimeError, match="failed to save"):
        asyncio.run(getattr(plugin, action)(**args))
    assert plugin._state == before
    assert plugin.push_message.call_count == 0


def test_gifts_respect_confession_gate_and_global_daily_limit(plugin, runtime):
    prepare_gift(plugin)
    plugin._state["shared"] = runtime.engine.new_record(79)
    for n in range(2):
        result = asyncio.run(plugin.send_shop_gift(
            **shop_args(plugin, f"transaction_{n:06}", item_id="cake", character="YUI")
        ))
        assert isinstance(result, runtime.Ok)
    assert plugin._state["shared"]["affection"] == 83
    assert plugin._state["shared"]["stage"] == "ambiguous"
    plugin._state["shop"]["inventory"]["cake"] = 1
    before = copy.deepcopy(plugin._state)
    result = asyncio.run(plugin.send_shop_gift(**shop_args(plugin, "transaction_final000", item_id="cake", character="MIO")))
    assert isinstance(result, runtime.Err)
    assert str(result.error) == "shop_daily_limit"
    assert plugin._state == before


@pytest.mark.parametrize("value,gained", [(100, 0), (20, 8)])
def test_full_affection_or_daily_total_does_not_consume_gift(plugin, runtime, value, gained):
    prepare_gift(plugin)
    plugin._state["shared"] = runtime.engine.new_record(value)
    plugin._state["shared"]["gained_today"] = gained
    before = copy.deepcopy(plugin._state)
    result = asyncio.run(plugin.send_shop_gift(**shop_args(plugin, item_id="cake", character="YUI")))
    assert isinstance(result, runtime.Err)
    assert str(result.error) == "shop_no_affection_room"
    assert plugin._state == before
    plugin.push_message.assert_not_called()


def test_independent_gift_targets_recipient_and_invalidates_old_score(plugin, runtime):
    prepare_gift(plugin)
    asyncio.run(plugin.set_per_character(enabled=True))
    plugin._state["characters"]["MIO"] = runtime.engine.new_record(30)
    job = take_job(plugin, runtime, "MIO")
    result = asyncio.run(plugin.send_shop_gift(**shop_args(plugin, item_id="cake", character="MIO")))
    assert isinstance(result, runtime.Ok)
    assert plugin._state["characters"]["MIO"]["affection"] == 32
    assert plugin._state["characters"]["YUI"]["affection"] == 10
    before = copy.deepcopy(plugin._state)
    asyncio.run(plugin._score(job))
    assert plugin._state == before
    assert plugin.push_message.call_args.kwargs["target_lanlan"] == "MIO"


def test_response_submission_failure_keeps_gift_and_retry_only_requests_response(plugin, runtime, monkeypatch):
    prepare_gift(plugin)
    plugin.push_message.return_value = {"submitted": False}
    result = asyncio.run(plugin.send_shop_gift(**shop_args(plugin, item_id="cake", character="YUI")))
    assert isinstance(result, runtime.Ok)
    assert result.value["reaction"] == "unavailable"
    before_coins = plugin._state["shop"]["coins"]
    before_affection = plugin._state["shared"]["affection"]
    gift = plugin._state["shop"]["history"][-1]
    assert gift["attempts"] == 1
    plugin.push_message.return_value = {"submitted": True}
    monkeypatch.setattr(runtime.time, "time", lambda: gift["requested_at"] + 31)
    retried = asyncio.run(plugin.retry_gift_reaction(gift_id=result.value["gift_id"]))
    assert isinstance(retried, runtime.Ok)
    assert retried.value["reaction"] == "submitted"
    assert plugin._state["shop"]["coins"] == before_coins
    assert plugin._state["shared"]["affection"] == before_affection
    assert plugin._state["shop"]["inventory"]["cake"] == 2
    assert gift["attempts"] == 2


def test_gift_remains_successful_when_response_attempt_cannot_be_saved(plugin, runtime, monkeypatch):
    prepare_gift(plugin)
    save = plugin._state_file.save
    calls = 0

    def save_once(state):
        nonlocal calls
        calls += 1
        if calls > 1:
            raise OSError("disk became full")
        return save(state)

    monkeypatch.setattr(plugin._state_file, "save", save_once)
    result = asyncio.run(plugin.send_shop_gift(**shop_args(plugin, item_id="cake", character="YUI")))
    assert isinstance(result, runtime.Ok)
    assert result.value["reaction"] == "unknown"
    persisted, _ = plugin._state_file.load()
    assert persisted["shared"]["affection"] == 12
    assert persisted["shop"]["inventory"]["cake"] == 2
    plugin.push_message.assert_not_called()


def test_gift_partial_gain_consumes_one_gift_and_records_actual_amount(plugin, runtime):
    prepare_gift(plugin)
    plugin._state["shared"]["gained_today"] = 7
    result = asyncio.run(plugin.send_shop_gift(**shop_args(plugin, item_id="cake", character="YUI")))
    assert isinstance(result, runtime.Ok)
    assert result.value["applied"] == 1
    assert plugin._state["shop"]["gift_gain"] == 1
    assert plugin._state["shared"]["gained_today"] == 8
    assert plugin._state["shop"]["inventory"]["cake"] == 2


def test_response_retries_are_bounded_and_unknown_submissions_wait_longer(plugin, runtime, monkeypatch):
    prepare_gift(plugin)
    instant = 1_800_000_000.0
    monkeypatch.setattr(runtime.time, "time", lambda: instant)
    plugin.push_message.side_effect = RuntimeError("submission uncertain")
    result = asyncio.run(plugin.send_shop_gift(**shop_args(plugin, item_id="cake", character="YUI")))
    assert isinstance(result, runtime.Ok)
    assert result.value["reaction"] == "unknown"
    instant += 31
    rejected = asyncio.run(plugin.retry_gift_reaction(gift_id=result.value["gift_id"]))
    assert isinstance(rejected, runtime.Err)
    assert plugin.push_message.call_count == 1
    for _ in range(2):
        instant += 121
        assert isinstance(asyncio.run(plugin.retry_gift_reaction(gift_id=result.value["gift_id"])), runtime.Ok)
    instant += 121
    assert isinstance(asyncio.run(plugin.retry_gift_reaction(gift_id=result.value["gift_id"])), runtime.Err)
    assert plugin.push_message.call_count == 3
    assert plugin._state["shop"]["inventory"]["cake"] == 2


def test_startup_keeps_economy_and_does_not_automatically_resend_uncertain_reactions(plugin, runtime):
    prepare_gift(plugin)
    args = shop_args(plugin, item_id="cake", character="YUI")
    asyncio.run(plugin.send_shop_gift(**args))
    plugin._state["shop"]["history"][-1]["reaction"] = "pending"
    plugin._state_file.save(plugin._state)
    plugin._start_worker = Mock()
    plugin.push_message.reset_mock()
    asyncio.run(plugin.startup())
    assert plugin._state["shop"]["history"][-1]["reaction"] == "unknown"
    result = asyncio.run(plugin.send_shop_gift(**args))
    assert isinstance(result, runtime.Ok)
    assert result.value["reaction"] == "unknown"
    assert plugin._state["shop"]["inventory"]["cake"] == 2
    assert plugin._state["shared"]["affection"] == 12
    plugin.push_message.assert_not_called()


def test_correlated_gift_response_is_confirmed_without_scoring(plugin, runtime):
    prepare_gift(plugin)
    result = asyncio.run(plugin.send_shop_gift(**shop_args(plugin, item_id="cake", character="YUI")))
    gift = plugin._state["shop"]["history"][-1]
    now = gift["ts"] + 2
    metadata = {"plugin_id": plugin.plugin_id, "event_type": "gift_received",
                "coalesce_key": f"{plugin.plugin_id}:gift:{result.value['gift_id']}"}
    plugin._on_message(runtime.conv.Message(now, runtime.conv.PROACTIVE_REPLY_TURN, "MIO", "thanks", metadata=metadata))
    assert gift["reaction"] == "submitted"
    plugin._on_message(runtime.conv.Message(now, runtime.conv.PROACTIVE_REPLY_TURN, "YUI", "thanks", metadata=metadata))
    assert gift["reaction"] == "received"
    assert plugin._jobs.empty()
    assert plugin._auto["scored"] == 0
    assert asyncio.run(plugin.dashboard())["shop"]["history"][0]["reaction"] == "received"


def test_gift_response_uses_real_host_instruction_reply_correlation(plugin, runtime):
    prepare_gift(plugin)
    asyncio.run(plugin.send_shop_gift(**shop_args(plugin, item_id="cake", character="YUI")))
    gift = plugin._state["shop"]["history"][-1]
    instruction = {
        "content": plugin.push_message.call_args.kwargs["parts"][0]["text"],
        "timestamp": gift["requested_at"] + 1,
        "metadata": {"turn_type": "proactive_instruction", "lanlan_name": "YUI", "conversation_id": "host-turn-1"},
    }
    observed = runtime.conv.parse_gift_instruction(instruction)
    assert observed is not None
    plugin._observe_gift_instruction(observed)
    reply = runtime.conv.parse_proactive_record({
        "content": "谢谢你的蛋糕！", "timestamp": gift["requested_at"] + 2,
        "metadata": {"turn_type": "proactive_reply", "lanlan_name": "YUI", "conversation_id": "host-turn-1"},
    })
    assert reply is not None
    plugin._on_message(reply)
    assert gift["reaction"] == "received"
    assert plugin._jobs.empty()
    assert runtime.conv.parse_gift_instruction({**instruction, "content": "unrelated proactive event"}) is None


def test_uncorrelated_proactive_reply_never_claims_gift_was_acknowledged(plugin, runtime):
    prepare_gift(plugin)
    asyncio.run(plugin.send_shop_gift(**shop_args(plugin, item_id="cake", character="YUI")))
    gift = plugin._state["shop"]["history"][-1]
    plugin._on_message(runtime.conv.Message(
        gift["ts"] + 1, runtime.conv.PROACTIVE_REPLY_TURN, "YUI", "今天天气不错。"
    ))
    assert gift["reaction"] == "submitted"
    assert plugin._jobs.empty()


@pytest.mark.parametrize("character,item_id,stock,code", [
    ("missing", "cake", 1, "shop_unknown_character"),
    ("YUI", "missing", 1, "shop_item_not_found"),
    ("YUI", "cake", 0, "shop_no_stock"),
])
def test_gift_rejections_leave_all_state_unchanged(plugin, runtime, character, item_id, stock, code):
    prepare_gift(plugin)
    plugin._state["shop"]["inventory"]["cake"] = stock
    before = copy.deepcopy(plugin._state)
    result = asyncio.run(plugin.send_shop_gift(**shop_args(plugin, item_id=item_id, character=character)))
    assert isinstance(result, runtime.Err)
    assert str(result.error) == code
    assert plugin._state == before
    plugin.push_message.assert_not_called()


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
    elif change == "restart":
        await plugin.restart_relationship(**restart_args(plugin))
    elif change == "gate":
        await plugin.set_settings(require_confession=False)
        await plugin.set_settings(require_confession=True)
    else:
        raise AssertionError(change)


CHANGES = ["disable", "disable_enable", "independent", "independent_shared", "manual", "reset", "restart", "gate"]


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


@pytest.mark.parametrize("auto", [False, True])
@pytest.mark.parametrize("independent", [False, True])
@pytest.mark.parametrize(("value", "confessed", "gate", "available"), [
    (79, False, True, False),
    (80, False, True, True),
    (91, False, True, True),
    (91, True, True, False),
    (91, False, False, False),
])
def test_character_confession_tools_follow_gate_and_role_without_manual_scoring(
    plugin, runtime, auto, independent, value, confessed, gate, available,
):
    runtime.engine.set_affection(plugin._state["shared"], value, gate=True)
    plugin._state["shared"]["confessed"] = confessed
    plugin._state["settings"].update(auto_score=auto, require_confession=gate)
    if independent:
        runtime.engine.set_per_character(plugin._state, True, "YUI")
        plugin._live_roles = {"YUI"}
    scope = "char:YUI" if independent else "shared"
    suffix = f"_{runtime._role_suffix('YUI')}" if independent else ""
    desired = plugin._desired_tools()
    assert set(desired) == {
        "love_state" + suffix,
        "love_address" + suffix,
        *([] if auto else ["love_update" + suffix]),
        *(["love_confess" + suffix] if available else []),
    }
    for role, target, _kind, _description in desired.values():
        assert role == ("YUI" if independent else None)
        assert target == scope
    if available:
        assert desired[runtime._confess_tool_name(scope)][2] == "confess"
        assert runtime._confess_tool_name(scope) in desired["love_state" + suffix][3]
        hint = asyncio.run(plugin._make_state_handler(scope)())["hint"]
        assert runtime._confess_tool_name(scope) in hint
        plugin.push_message = Mock()
        plugin._flush_context()
        context = plugin.push_message.call_args.kwargs["parts"][0]["text"]
        assert runtime._confess_tool_name(scope) in context


@pytest.mark.parametrize("independent", [False, True])
def test_character_can_record_contextual_consent_with_auto_scoring_and_no_judge(plugin, runtime, independent):
    runtime.engine.set_affection(plugin._state["shared"], 91, gate=True)
    if independent:
        runtime.engine.set_per_character(plugin._state, True, "YUI")
        runtime.engine.set_affection(runtime.engine.get_record(plugin._state, "char:MIO"), 85, gate=True)
    scope = "char:YUI" if independent else "shared"
    other = copy.deepcopy(plugin._state["characters"].get("MIO"))
    economy = copy.deepcopy(plugin._state["shop"])
    plugin.register_llm_tool = Mock()
    plugin.unregister_llm_tool = Mock()
    plugin._reconcile_tools = runtime.LoveWithYouPlugin._reconcile_tools.__get__(plugin)
    plugin._reconcile_tools()
    specs = {call.kwargs["name"]: call.kwargs for call in plugin.register_llm_tool.call_args_list}
    spec = specs[runtime._confess_tool_name(scope)]
    assert spec["role"] == ("YUI" if independent else None)
    assert not any(name.startswith("love_update") for name in specs)

    proposal = "想一直陪着您，只陪着您。可以吗？"
    answer = "当然可以，我也会一直陪着你的。"
    plugin._enqueue(runtime.conv.Exchange("YUI", answer, "那太好了", "", proposal, 1))
    job = plugin._jobs.get_nowait()
    assert not runtime.scoring.rule_verdict(
        answer, "那太好了", previous_reply=proposal, awaiting_confession=True,
    ).confession
    token = spec["parameters"]["properties"]["relationship_token"]["enum"][0]
    result = asyncio.run(spec["handler"](moment="彼此认真确认了恋爱心意", relationship_token=token))
    assert result["stage"] == "恋人" and result["stage_changed"]
    record = runtime.engine.get_record(plugin._state, scope)
    assert record["affection"] == 91 and record["confessed"]
    assert record["confessed_on"] == runtime.engine.today_str()
    assert record["milestones"]["lover"] == record["confessed_on"]
    assert plugin._state["shop"] == economy
    assert plugin._state["characters"].get("MIO") == other
    assert runtime._confess_tool_name(scope) not in plugin._registered
    plugin._complete.assert_not_called()

    repeated = asyncio.run(spec["handler"](moment="重复确认", relationship_token=token))
    assert repeated["error"] == "ALREADY_CONFESSED"
    plugin._complete = AsyncMock(return_value=(None, runtime.judge.UNBOUND))
    asyncio.run(plugin._score(job))
    assert record["confessed"] and record["stage"] == "lover"
    assert len([item for item in record["history"] if item["source"] == "confession"]) == 1
    saved, warning = plugin._state_file.load()
    restored = runtime.engine.normalize_state(saved)
    assert warning is None
    assert runtime.engine.get_record(restored, scope)["confessed"]
    dashboard = asyncio.run(plugin.dashboard())
    shown = next(item for item in dashboard["scopes"] if item["key"] == scope)
    assert shown["stage"] == "lover" and not shown["awaiting_confession"]


@pytest.mark.parametrize(("condition", "error"), [
    ("below_threshold", "NOT_READY"),
    ("gate_off", "NOT_NEEDED"),
    ("stopped", "NOT_READY"),
    ("stopping", "NOT_READY"),
    ("shared_to_independent", "RELATIONSHIP_CHANGED"),
    ("independent_to_shared", "RELATIONSHIP_CHANGED"),
])
def test_character_confirmation_cannot_bypass_runtime_gate_or_redirect_stale_tools(plugin, runtime, condition, error):
    runtime.engine.set_affection(plugin._state["shared"], 91, gate=True)
    scope = "shared"
    if condition == "below_threshold":
        runtime.engine.set_affection(plugin._state["shared"], 79, gate=True)
    elif condition == "gate_off":
        plugin._state["settings"]["require_confession"] = False
    elif condition == "stopped":
        plugin._ready = False
    elif condition == "stopping":
        plugin._stopping.set()
    elif condition == "shared_to_independent":
        runtime.engine.set_per_character(plugin._state, True, "YUI")
    elif condition == "independent_to_shared":
        runtime.engine.set_per_character(plugin._state, True, "YUI")
        scope = "char:YUI"
        runtime.engine.set_per_character(plugin._state, False, "YUI")
    before = copy.deepcopy(plugin._state)
    result = asyncio.run(plugin._make_confess_handler(scope)(moment="确认关系"))
    assert result["error"] == error and result["is_error"]
    assert plugin._state == before and not plugin._state_file.path.exists()


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
        plugin._on_message(confession_reply(plugin, runtime, now + 1, "我喜欢你，和我在一起吧"))
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
        plugin._on_message(confession_reply(plugin, runtime, now + 1, "我喜欢你，和我在一起吧"))
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
    plugin._on_message(confession_reply(plugin, runtime, now + 1, "我喜欢你，你愿意和我在一起吗？"))
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
    plugin._on_message(confession_reply(plugin, runtime, now - 1, "我喜欢你，和我在一起吧"))
    plugin._on_message(runtime.conv.Message(now + 1, "user", "YUI", "我愿意", spoken_at=now + 1))
    assert not plugin._state["shared"]["confessed"]
    plugin._on_message(confession_reply(
        plugin, runtime, now + 2, "我喜欢你，和我在一起吧", spoken_at=now + 0.5
    ))
    assert plugin._state["shared"]["confessed"]
    plugin._on_message(runtime.conv.Message(now + 1, "user", "YUI", "我愿意"))
    assert plugin._state["shared"]["confessed"]


def test_pending_ambiguous_answer_is_replayed_before_explicit_consent(plugin, runtime):
    now, _ = request_confession(plugin, runtime)
    plugin._on_message(runtime.conv.Message(now + 1, "user", "YUI", "好"))
    assert plugin._pending_answers["shared"]
    plugin._on_message(confession_reply(
        plugin, runtime, now + 2, "我喜欢你，和我在一起吧", spoken_at=now + 0.5
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
    plugin._on_message(confession_reply(plugin, runtime, now + 2, "我喜欢你，和我在一起吧"))
    state = plugin._state["shared"]["proactive_confession"]
    assert state["delivery_seen"] and state["reply_seen"]


def test_uncertain_waiting_confession_keeps_the_attempt_reserved(plugin, runtime):
    now, _ = request_confession(plugin, runtime)
    state = plugin._state["shared"]["proactive_confession"]
    later = now + runtime.engine.PROACTIVE_CONFESSION_WAIT_SECONDS + 1
    assert plugin._expire_proactive_locked(state, later)
    assert state["status"] == "idle"
    assert state["attempts"] == 1
    assert state["cooldown_until"] == later + runtime.engine.PROACTIVE_CONFESSION_UNDELIVERED_COOLDOWN_SECONDS


def test_interrupted_confession_keeps_the_attempt_reserved_on_recovery(plugin, runtime):
    now, _ = request_confession(plugin, runtime)
    state = plugin._state["shared"]["proactive_confession"]
    state["status"] = "dispatching"
    assert plugin._expire_proactive_locked(state, now + 1)
    assert state["status"] == "idle"
    assert state["attempts"] == 1
    assert state["cooldown_until"] > now


def test_pending_proposal_survives_restart_without_a_second_send(plugin, runtime):
    now, _ = request_confession(plugin, runtime)
    plugin._on_message(confession_reply(plugin, runtime, now + 1, "我喜欢你，和我在一起吧"))
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
    plugin._on_message(confession_reply(plugin, runtime, now + 1, "我喜欢你，和我在一起吧"))
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
    plugin._on_message(confession_reply(plugin, runtime, now + 1, "我喜欢你，和我在一起吧"))
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
    plugin._on_message(confession_reply(plugin, runtime, now + 1, "我喜欢你，和我在一起吧"))
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
    plugin._on_message(confession_reply(plugin, runtime, now + 1, "我喜欢你，和我在一起吧", character="MIO"))
    plugin._on_message(runtime.conv.Message(now + 2, "user", "MIO", "我愿意"))
    assert plugin._state["characters"]["MIO"]["confessed"]
    assert not plugin._state["characters"]["YUI"]["confessed"]


@pytest.mark.parametrize("role", ["proactive_reply", "reply"])
def test_intervening_character_question_requires_explicit_relationship_consent(plugin, runtime, role):
    now, _ = request_confession(plugin, runtime)
    plugin._on_message(confession_reply(plugin, runtime, now + 1, "我喜欢你，和我在一起吧"))
    plugin._on_message(runtime.conv.Message(now + 2, role, "YUI", "你愿意帮我找一本书吗？"))
    plugin._on_message(runtime.conv.Message(now + 3, "user", "YUI", "我愿意"))
    assert not plugin._state["shared"]["confessed"]
    plugin._on_message(runtime.conv.Message(now + 4, "user", "YUI", "我愿意和你在一起"))
    assert plugin._state["shared"]["confessed"]


def test_same_proactive_reply_with_unrelated_question_needs_explicit_consent(plugin, runtime):
    now, _ = request_confession(plugin, runtime)
    plugin._on_message(confession_reply(
        plugin, runtime, now + 1, "我喜欢你，和我在一起吧。你愿意帮我找一本书吗？"
    ))
    plugin._on_message(runtime.conv.Message(now + 2, "user", "YUI", "我愿意"))
    assert not plugin._state["shared"]["confessed"]


@pytest.mark.parametrize("turn_type", ["user_message", "proactive_reply"])
def test_truncated_message_cannot_confirm_or_deliver_confession(plugin, runtime, turn_type):
    now, _ = request_confession(plugin, runtime)
    plugin._on_message(confession_reply(plugin, runtime, now + 1, "我喜欢你，和我在一起吧"))
    text = "我愿意" if turn_type == "user_message" else "我喜欢你，和我在一起吧"
    text += "。" + "嗯" * 320 + "，但只是开玩笑"
    raw = {"timestamp": now + 2, "content": text,
           "metadata": {
               **confession_reply(plugin, runtime, now + 2, text).metadata,
               "turn_type": turn_type, "lanlan_name": "YUI",
           } if turn_type == "proactive_reply" else {"turn_type": turn_type, "lanlan_name": "YUI"}}
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


@pytest.mark.parametrize("auto", [True, False])
def test_pending_confirmation_requeues_after_each_turn_without_interrupting(plugin, runtime, monkeypatch, auto):
    monkeypatch.setattr(runtime.time, "monotonic", lambda: 1000.0)
    runtime.engine.set_affection(plugin._state["shared"], 91, gate=True)
    plugin._state["settings"]["auto_score"] = auto
    queued = {}

    def submit(**kwargs):
        queued[kwargs["target_lanlan"]] = kwargs
        return {"submitted": True}

    plugin.push_message = Mock(side_effect=submit)
    plugin._flush_context()
    first = queued.pop("YUI")  # A natural turn consumes a passive host cue.
    plugin._on_message(runtime.conv.Message(10, "user", "YUI", "我喜欢你"))
    plugin._flush_context()
    assert plugin.push_message.call_count == 2
    queued.pop("YUI")
    plugin._on_message(runtime.conv.Message(11, "reply", "YUI", "你是想和我正式交往吗？"))
    plugin._flush_context()
    assert plugin.push_message.call_count == 3
    latest = queued["YUI"]
    for cue in (first, latest):
        assert cue["ai_behavior"] == "read" and cue["visibility"] == []
        assert cue["metadata"]["awaiting_confession"] is True
        assert cue["metadata"]["confess_tool"] == "love_confess"
    assert first["coalesce_key"] == latest["coalesce_key"]
    assert latest["metadata"]["sequence"] == 3
    assert latest["metadata"]["guidance_revision"] == runtime._CONTEXT_GUIDANCE_REVISION
    plugin._flush_context()
    assert plugin.push_message.call_count == 3
    assert not plugin._state["shared"]["confessed"]


def test_pending_confirmation_refreshes_across_idle_reconnect_and_stops_after_success(plugin, runtime, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(runtime.time, "monotonic", lambda: clock[0])
    runtime.engine.set_affection(plugin._state["shared"], 91, gate=True)
    plugin.push_message = Mock(return_value={"submitted": True})
    plugin._flush_context()
    clock[0] += runtime._CONTEXT_WAITING_REFRESH_SECONDS - 1
    plugin._flush_context()
    assert plugin.push_message.call_count == 1
    clock[0] += 1
    plugin._flush_context()
    assert plugin.push_message.call_count == 2
    result = asyncio.run(plugin._make_confess_handler("shared")(moment="彼此认真确认恋爱心意"))
    assert result["stage"] == "恋人"
    plugin._flush_context()
    assert plugin.push_message.call_count == 3
    latest = plugin.push_message.call_args.kwargs
    assert latest["metadata"]["awaiting_confession"] is False
    assert latest["metadata"]["confess_tool"] == ""
    assert "love_confess" not in latest["parts"][0]["text"]
    clock[0] += 600
    plugin._flush_context()
    assert plugin.push_message.call_count == 3


@pytest.mark.parametrize("condition", ["below_threshold", "already_lover", "gate_off"])
def test_other_relationships_keep_six_user_turn_refresh(plugin, runtime, monkeypatch, condition):
    clock = [1000.0]
    monkeypatch.setattr(runtime.time, "monotonic", lambda: clock[0])
    if condition != "below_threshold":
        runtime.engine.set_affection(plugin._state["shared"], 91, gate=True)
        if condition == "already_lover":
            runtime.engine.confess(plugin._state["shared"], "已确认")
        else:
            plugin._state["settings"]["require_confession"] = False
    plugin.push_message = Mock(return_value={"submitted": True})
    plugin._flush_context()
    for n in range(runtime._CONTEXT_REFRESH_TURNS - 1):
        income_turn(plugin, runtime, 10 + 3 * n, "hello")
        clock[0] += 70
        plugin._flush_context()
    assert plugin.push_message.call_count == 1
    plugin._on_message(runtime.conv.Message(100, "user", "YUI", "hello"))
    plugin._flush_context()
    assert plugin.push_message.call_count == 2


def test_context_failure_preserves_pending_activity_until_retry_succeeds(plugin, runtime, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(runtime.time, "monotonic", lambda: clock[0])
    runtime.engine.set_affection(plugin._state["shared"], 91, gate=True)
    plugin.push_message = Mock(return_value={"submitted": True})
    plugin._flush_context()
    plugin._on_message(runtime.conv.Message(10, "user", "YUI", "我喜欢你"))
    plugin.push_message.return_value = {"submitted": False}
    plugin._flush_context()
    entry = plugin._context["YUI"]
    assert entry["sequence"] == 1 and entry["submitted_activity"] == 0
    plugin._on_message(runtime.conv.Message(11, "reply", "YUI", "你想正式交往吗？"))
    clock[0] += runtime._CONTEXT_RETRY_SECONDS - 1
    plugin._flush_context()
    assert plugin.push_message.call_count == 2
    clock[0] += 1
    plugin.push_message.return_value = {"submitted": True}
    plugin._flush_context()
    assert entry["sequence"] == 2 and entry["submitted_activity"] == entry["activity"] == 2
    plugin._flush_context()
    assert plugin.push_message.call_count == 3


def test_activity_during_submission_is_not_mistaken_for_submitted_context(plugin, runtime, monkeypatch):
    monkeypatch.setattr(runtime.time, "monotonic", lambda: 1000.0)
    runtime.engine.set_affection(plugin._state["shared"], 91, gate=True)

    def submit(**_kwargs):
        if plugin.push_message.call_count == 1:
            plugin._on_message(runtime.conv.Message(10, "user", "YUI", "我喜欢你"))
        return {"submitted": True}

    plugin.push_message = Mock(side_effect=submit)
    plugin._flush_context()
    entry = plugin._context["YUI"]
    assert entry["turns"] == 1 and entry["submitted_activity"] == 0 and entry["activity"] == 1
    plugin._flush_context()
    assert plugin.push_message.call_count == 2 and entry["submitted_activity"] == 1


def test_pending_context_refresh_is_bound_to_each_character(plugin, runtime, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(runtime.time, "monotonic", lambda: clock[0])
    runtime.engine.set_affection(plugin._state["shared"], 91, gate=True)
    runtime.engine.set_per_character(plugin._state, True, "YUI")
    runtime.engine.set_affection(runtime.engine.get_record(plugin._state, "char:MIO"), 91, gate=True)
    plugin._context_entry("MIO")
    plugin.push_message = Mock(return_value={"submitted": True})
    plugin._flush_context()
    plugin.push_message.reset_mock()
    plugin._on_message(runtime.conv.Message(10, "reply", "MIO", "你好"))
    plugin._flush_context()
    cue = plugin.push_message.call_args.kwargs
    assert plugin.push_message.call_count == 1 and cue["target_lanlan"] == "MIO"
    assert cue["metadata"]["confess_tool"] == runtime._confess_tool_name("char:MIO")
    assert runtime._confess_tool_name("char:YUI") not in cue["parts"][0]["text"]
    clock[0] += runtime._CONTEXT_WAITING_REFRESH_SECONDS
    plugin.push_message.reset_mock()
    plugin._flush_context()
    assert plugin.push_message.call_count == 1
    assert plugin.push_message.call_args.kwargs["target_lanlan"] == "YUI"


@pytest.mark.parametrize("spoken_at", [None, -1, 1])
def test_consent_before_actual_proposal_never_confirms(plugin, runtime, spoken_at):
    now, _ = request_confession(plugin, runtime)
    plugin._on_message(runtime.conv.Message(
        now + 1, "user", "YUI", "我愿意",
        spoken_at=None if spoken_at is None else now + spoken_at,
    ))
    plugin._on_message(confession_reply(
        plugin, runtime, now + 20, "我喜欢你，和我在一起吧", spoken_at=now + 10,
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
    "manual", "reset", "restart", "independent", "settings", "nicknames", "first_met",
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
            elif operation == "restart":
                asyncio.run(plugin.restart_relationship(**restart_args(plugin)))
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
    runtime.engine.set_nicknames(expected["shared"], {"stranger": "朋友"})
    assert restored == expected


@pytest.mark.parametrize("per_character", [False, True])
def test_first_met_preview_has_no_state_or_disk_side_effects(plugin, runtime, per_character):
    plugin._state["per_character"] = per_character
    scope = "char:YUI" if per_character else "shared"
    before = copy.deepcopy(plugin._state)
    runtime.host.fetch_first_met = Mock(return_value={
        "date": "2026-02-03", "character": "YUI", "source": "host_recent_history", "scanned_roles": 1,
    })
    result = asyncio.run(plugin.preview_first_met(scope=scope))
    assert isinstance(result, runtime.Ok) and result.value["scope"] == scope
    runtime.host.fetch_first_met.assert_called_once_with("YUI" if per_character else None)
    assert plugin._state == before and not plugin._state_file.path.exists()
    original = result.value["previous_date"]
    saved = asyncio.run(plugin.set_first_met(scope=scope, date=result.value["date"], expected_date=original, source="host"))
    assert isinstance(saved, runtime.Ok)
    stored, _ = plugin._state_file.load()
    record = stored["characters"]["YUI"] if per_character else stored["shared"]
    assert record["first_met"] == "2026-02-03"
    assert record["plugin_first_met"] == original and record["host_first_met"] == "2026-02-03"
    assert "private chat body" not in str(stored)


def test_first_met_preview_rejects_a_date_changed_during_the_query(plugin, runtime):
    def lookup(character):
        with plugin._lock:
            plugin._state["shared"]["first_met"] = "2026-06-07"
        return {"date": "2026-02-03"}
    runtime.host.fetch_first_met = lookup
    result = asyncio.run(plugin.preview_first_met(scope="shared"))
    assert isinstance(result, runtime.Err) and str(result.error) == "first_met_conflict"
    assert not plugin._state_file.path.exists()


def test_first_met_import_cannot_overwrite_a_later_manual_edit(plugin, runtime):
    original = plugin._state["shared"]["first_met"]
    asyncio.run(plugin.set_first_met(scope="shared", date="2026-06-07"))
    before = plugin._state_file.path.read_bytes()
    result = asyncio.run(plugin.set_first_met(scope="shared", date="2026-02-03", expected_date=original))
    assert isinstance(result, runtime.Err) and str(result.error) == "first_met_conflict"
    assert plugin._state_file.path.read_bytes() == before


def test_first_met_preview_translates_fixed_host_errors_and_rejects_invalid_scope(plugin, runtime):
    runtime.host.fetch_first_met = Mock(side_effect=runtime.host.HistoryError("host_history_empty"))
    result = asyncio.run(plugin.preview_first_met(scope="char:YUI"))
    assert isinstance(result, runtime.Err) and str(result.error) == "per_character_off"
    runtime.host.fetch_first_met.assert_not_called()
    result = asyncio.run(plugin.preview_first_met(scope="shared"))
    assert isinstance(result, runtime.Err) and str(result.error) == "host_history_empty"
    assert not plugin._state_file.path.exists()


@pytest.mark.parametrize("per_character", [False, True])
def test_first_met_restore_and_cached_host_switch_persist_without_host_reads(plugin, runtime, per_character):
    plugin._state["per_character"] = per_character
    scope = "char:YUI" if per_character else "shared"
    record = plugin._scope_record_locked(scope)
    original = record["first_met"]
    other_before = copy.deepcopy(plugin._state["shared"] if per_character else plugin._state["characters"])
    runtime.host.fetch_first_met = Mock(side_effect=AssertionError("restore must work offline"))
    for target, source in [("2026-02-03", "host"), (original, "plugin"), ("2026-02-03", "host")]:
        previous = record["first_met"]
        result = asyncio.run(plugin.set_first_met(scope=scope, date=target, expected_date=previous, source=source))
        assert isinstance(result, runtime.Ok)
        stored, _ = plugin._state_file.load()
        persisted = stored["characters"]["YUI"] if per_character else stored["shared"]
        assert persisted["first_met"] == target and persisted["first_met_source"] == source
        assert persisted["plugin_first_met"] == original and persisted["host_first_met"] == "2026-02-03"
        assert (stored["shared"] if per_character else stored["characters"]) == other_before
    runtime.host.fetch_first_met.assert_not_called()
    dashboard = asyncio.run(plugin.dashboard())
    assert dashboard["scopes"][0]["plugin_first_met"] == original


def test_first_met_failed_restore_rolls_back_all_date_choices(plugin, runtime, monkeypatch):
    record = plugin._state["shared"]
    original = record["first_met"]
    asyncio.run(plugin.set_first_met(scope="shared", date="2026-02-03", source="host"))
    before = copy.deepcopy(plugin._state)
    stored = plugin._state_file.path.read_bytes()
    monkeypatch.setattr(plugin._state_file, "save", Mock(side_effect=OSError("disk unavailable")))
    with pytest.raises(runtime.SdkError, match="failed to save state: OSError"):
        asyncio.run(plugin.set_first_met(scope="shared", date=original, source="plugin"))
    assert plugin._state == before and plugin._state_file.path.read_bytes() == stored


def test_nickname_patch_merges_persists_and_pushes_context_immediately(plugin, runtime):
    plugin.push_message = Mock(return_value={"submitted": True})
    plugin._state["shared"]["nicknames"] = {"familiar": "friend"}
    result = asyncio.run(plugin.set_nicknames(
        scope="shared", nicknames={"stranger": "  hi   pal  "}, expected_nicknames={"stranger": ""},
    ))
    assert isinstance(result, runtime.Ok)
    assert result.value["result"] == {"stranger": "hi pal", "familiar": "friend"}
    saved, _ = plugin._state_file.load()
    assert saved["shared"]["nicknames"] == result.value["result"]
    assert "hi pal" in plugin.push_message.call_args.kwargs["parts"][0]["text"]
    assert plugin.push_message.call_args.kwargs["ai_behavior"] == "read"
    plugin.push_message.reset_mock()
    asyncio.run(plugin.set_nicknames(
        scope="shared", nicknames={"stranger": ""}, expected_nicknames={"stranger": "hi pal"},
    ))
    assert "恢复人设原本的称呼" in plugin.push_message.call_args.kwargs["parts"][0]["text"]


def test_nickname_conflict_preserves_saved_state_and_does_not_push_context(plugin, runtime):
    plugin.push_message = Mock(return_value={"submitted": True})
    plugin._state["shared"]["nicknames"] = {"stranger": "other panel"}
    plugin._save_locked()
    before = plugin._state_file.path.read_bytes()
    result = asyncio.run(plugin.set_nicknames(
        scope="shared", nicknames={"stranger": "mine"}, expected_nicknames={"stranger": ""},
    ))
    assert isinstance(result, runtime.Err) and str(result.error) == "nickname_conflict"
    assert plugin._state_file.path.read_bytes() == before
    assert plugin._state["shared"]["nicknames"] == {"stranger": "other panel"}
    plugin.push_message.assert_not_called()


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


def test_portrait_actions_import_manage_and_persist_without_touching_relationship(plugin, runtime, tmp_path):
    library = runtime.portraits.PortraitLibrary(
        PLUGIN_ROOT / "assets" / "portraits", runtime.StateFile(tmp_path / "portraits.json"),
    )
    plugin._portraits = library
    source_id = library.choose()["id"]
    before_relationship = copy.deepcopy(plugin._state)
    imported = asyncio.run(plugin.import_portrait(
        name="My portrait", collection="My game",
        data_url=library.image(source_id)["data_url"],
        thumbnail_url=library.image(source_id, True)["data_url"],
    ))
    assert isinstance(imported, runtime.Ok)
    item_id = imported.value["item"]["id"]
    updated = asyncio.run(plugin.edit_portrait(item_id=item_id, name="Renamed", collection="Moved"))
    assert isinstance(updated, runtime.Ok)
    assert updated.value["item"]["name"] == "Renamed"
    page = asyncio.run(plugin.list_portraits(collection="Moved"))
    assert page.value["items"][0]["id"] == item_id
    selected = asyncio.run(plugin.set_portraits(mode="fixed", selected_id=item_id, pool_ids=[item_id]))
    assert isinstance(selected, runtime.Ok)
    deleted = asyncio.run(plugin.delete_portrait(item_id=item_id))
    assert isinstance(deleted, runtime.Ok)
    assert item_id not in deleted.value["ids"]
    assert plugin._state == before_relationship


def recent_row(kind, text):
    return {"type": kind, "data": {"content": text}}


def test_legacy_host_chat_confession_and_income_use_live_history(plugin, runtime, monkeypatch):
    now = 1_800_000_000.0
    monkeypatch.setattr(runtime.time, "time", lambda: now)
    plugin._recent_tracker = runtime.conv.RecentHistoryTracker(now)
    runtime.engine.set_affection(plugin._state["shared"], 87, gate=True)
    snapshots = {"YUI": [], "MIO": []}
    monkeypatch.setattr(runtime.host, "fetch_recent_chat", lambda name: copy.deepcopy(snapshots[name]))
    assert asyncio.run(plugin._poll_recent_conversations())
    assert plugin._state["shop"]["coins"] == 100 and plugin._jobs.empty()
    for index, (user, reply) in enumerate([
        ("我喜欢你，和我在一起吧", "我愿意和你在一起"),
        ("谢谢你一直陪着我", "我也很开心"),
        ("今天过得怎么样", "今天很愉快"),
    ]):
        now += 25
        snapshots["YUI"] += [recent_row("human", user), recent_row("ai", reply)]
        assert asyncio.run(plugin._poll_recent_conversations())
        assert plugin._auto["seen"] == index + 1
        plugin._complete = AsyncMock(return_value=(None, runtime.judge.UNBOUND))
        asyncio.run(plugin._score(plugin._jobs.get_nowait()))
    assert plugin._state["shared"]["stage"] == "lover"
    assert plugin._state["shared"]["confessed"] is True
    assert plugin._state["shop"]["coins"] == 100
    assert plugin._state["shop"]["income_total"] == 0
    assert plugin._state["shop"]["days"][runtime.engine.today_str()]["count"] == 3
    assert plugin._conversation_sources == {"YUI": "host_recent_history"}
    assert asyncio.run(plugin._poll_recent_conversations())
    assert plugin._auto["seen"] == 3 and plugin._jobs.empty()
    saved, _ = plugin._state_file.load()
    assert saved["shop"]["coins"] == 100 and saved["shared"]["stage"] == "lover"
    assert "我喜欢你，和我在一起吧" not in str(saved)


def test_normal_bus_has_priority_and_late_bus_does_not_duplicate_history(plugin, runtime, monkeypatch):
    now = 1_800_000_000.0
    monkeypatch.setattr(runtime.time, "time", lambda: now)
    plugin._cursor = runtime.conv.BusCursor(now)
    plugin._recent_tracker = runtime.conv.RecentHistoryTracker(now)
    plugin._state["settings"]["auto_score"] = False
    snapshots = {"YUI": [], "MIO": []}
    monkeypatch.setattr(runtime.host, "fetch_recent_chat", lambda name: copy.deepcopy(snapshots[name]))
    records = []
    getter = AsyncMock(side_effect=lambda **kwargs: records)
    plugin.ctx.bus = SimpleNamespace(conversations=SimpleNamespace(get=getter))
    asyncio.run(plugin._poll_recent_conversations())
    now += 25
    snapshots["YUI"] = [recent_row("human", "hello"), recent_row("ai", "hi")]
    asyncio.run(plugin._poll_recent_conversations())
    assert plugin._auto["seen"] == 1 and plugin._state["shop"]["coins"] == 100
    records += [
        {"timestamp": now + 1, "turn_type": kind, "lanlan_name": name, "content": text}
        for name, kind, text in [
            ("YUI", "user_message", "hello"), ("YUI", "assistant_message", "hi"),
            ("MIO", "user_message", "hello MIO"), ("MIO", "assistant_message", "hi MIO"),
        ]
    ]
    now += 25
    assert asyncio.run(plugin._poll_conversations())
    assert plugin._auto["seen"] == 2
    assert plugin._conversation_sources == {"YUI": "host_recent_history", "MIO": "conversations"}
    assert plugin._state["shop"]["coins"] == 100
    assert plugin._state["shop"]["days"][runtime.engine.today_str()]["count"] == 1  # simultaneous replies share the global gap
    reads = Mock(side_effect=lambda name: copy.deepcopy(snapshots[name]))
    monkeypatch.setattr(runtime.host, "fetch_recent_chat", reads)
    asyncio.run(plugin._poll_recent_conversations())
    reads.assert_called_once_with("YUI")


def test_legacy_pending_turn_after_settings_edit_keeps_income_but_not_old_scoring(plugin, runtime, monkeypatch):
    now = 1_800_000_000.0
    monkeypatch.setattr(runtime.time, "time", lambda: now)
    plugin._recent_tracker = runtime.conv.RecentHistoryTracker(now)
    snapshots = {"YUI": [], "MIO": []}
    monkeypatch.setattr(runtime.host, "fetch_recent_chat", lambda name: copy.deepcopy(snapshots[name]))
    asyncio.run(plugin._poll_recent_conversations())
    now += 25
    snapshots["YUI"].append(recent_row("human", "我喜欢你，和我在一起吧"))
    asyncio.run(plugin._poll_recent_conversations())
    plugin._invalidate_scoring_locked()
    snapshots["YUI"].append(recent_row("ai", "我愿意"))
    now += 5
    asyncio.run(plugin._poll_recent_conversations())
    assert plugin._jobs.empty()
    assert plugin._state["shop"]["coins"] == 100
    assert plugin._state["shop"]["days"][runtime.engine.today_str()]["count"] == 1


def test_history_compatibility_continues_when_bus_read_fails(plugin, runtime, monkeypatch):
    now = 1_800_000_000.0
    monkeypatch.setattr(runtime.time, "time", lambda: now)
    plugin._cursor = runtime.conv.BusCursor(now)
    plugin._recent_tracker = runtime.conv.RecentHistoryTracker(now)
    plugin._state["settings"]["auto_score"] = False
    plugin.ctx.bus = SimpleNamespace(conversations=SimpleNamespace(get=AsyncMock(side_effect=TimeoutError())))
    monkeypatch.setattr(runtime.host, "fetch_recent_chat", lambda name: [])
    assert not asyncio.run(plugin._poll_conversations())
    assert asyncio.run(plugin._poll_recent_conversations())
    now += 25
    monkeypatch.setattr(runtime.host, "fetch_recent_chat", lambda name: [
        recent_row("human", f"hello {name}"), recent_row("ai", f"hi {name}"),
    ])
    assert asyncio.run(plugin._poll_recent_conversations())
    assert plugin._state["shop"]["coins"] == 100
    assert plugin._state["shop"]["days"][runtime.engine.today_str()]["count"] == 1
    assert plugin._auto["seen"] == 2 and plugin._jobs.empty()


def test_portrait_actions_report_validation_errors(plugin, runtime, tmp_path):
    plugin._portraits = runtime.portraits.PortraitLibrary(
        PLUGIN_ROOT / "assets" / "portraits", runtime.StateFile(tmp_path / "portraits.json"),
    )
    result = asyncio.run(plugin.import_portrait(name="Name", collection="Game", data_url="bad", thumbnail_url="bad"))
    assert isinstance(result, runtime.Err)
    assert str(result.error) == "portrait_invalid_image"
    result = asyncio.run(plugin.delete_portrait(item_id="sb-f600666675a9"))
    assert isinstance(result, runtime.Err)
    assert str(result.error) == "portrait_custom_only"


def test_address_tool_persists_only_preferences_and_replay_is_idempotent(plugin, runtime):
    plugin.push_message = Mock(return_value={"submitted": True})
    before = copy.deepcopy(plugin._state)
    handler = plugin._make_address_handler("shared", 0)
    result = asyncio.run(handler(operation="set_name", name="小林"))
    assert result["saved"] and result["changed"]
    assert "小林" in result["note"]
    saved, _ = plugin._state_file.load()
    assert saved["shared"]["addressing"]["preferred_name"] == "小林"
    for key, value in before["shared"].items():
        if key not in {"addressing", "nicknames", "addressing_revision"}:
            assert saved["shared"][key] == value
    assert saved["shop"] == before["shop"]
    payload = plugin._state_file.path.read_bytes()
    result = asyncio.run(handler(operation="set_name", name="小林"))
    assert result["saved"] and not result["changed"]
    assert plugin._state_file.path.read_bytes() == payload
    assert "小林" in plugin.push_message.call_args.kwargs["parts"][0]["text"]
    result = asyncio.run(handler(operation="avoid_name", name="宝贝"))
    assert result["error"] == "NICKNAME_CONFLICT" and not result.get("saved")
    assert plugin._state_file.path.read_bytes() == payload


@pytest.mark.parametrize("independent", [False, True])
def test_address_tool_rejects_stale_mode_scope(plugin, runtime, independent):
    if independent:
        runtime.engine.set_per_character(plugin._state, True, "YUI")
    scope = "char:YUI" if independent else "shared"
    handler = plugin._make_address_handler(scope, 0)
    runtime.engine.set_per_character(plugin._state, not independent, "YUI")
    before = copy.deepcopy(plugin._state)
    result = asyncio.run(handler(operation="set_name", name="小林"))
    assert result["error"] == "RELATIONSHIP_CHANGED"
    assert plugin._state == before


@pytest.mark.parametrize("stopped", [False, True])
def test_address_tool_does_not_claim_save_when_not_ready(plugin, stopped):
    if stopped:
        plugin._stopping.set()
    else:
        plugin._ready = False
    result = asyncio.run(plugin._make_address_handler("shared", 0)(operation="avoid_name", name="宝贝"))
    assert result["is_error"] and result["error"] == "NOT_READY"
    assert not plugin._state_file.path.exists()


def test_address_save_failure_rolls_back_tool_and_panel(plugin, runtime, monkeypatch):
    plugin.push_message = Mock(return_value={"submitted": True})
    plugin._save_locked()
    before = copy.deepcopy(plugin._state)
    payload = plugin._state_file.path.read_bytes()
    monkeypatch.setattr(plugin._state_file, "save", Mock(side_effect=OSError("full")))
    handler = plugin._make_address_handler("shared", 0)
    with pytest.raises(runtime.SdkError, match="failed to save state"):
        asyncio.run(handler(operation="set_name", name="小林"))
    assert plugin._state == before and plugin._state_file.path.read_bytes() == payload
    with pytest.raises(runtime.SdkError, match="failed to save state"):
        asyncio.run(plugin.set_addressing(
            scope="shared", changes={"preferred_name": "小林"}, expected={"preferred_name": ""},
        ))
    assert plugin._state == before and plugin._state_file.path.read_bytes() == payload
    plugin.push_message.assert_not_called()


def test_address_panel_uses_field_cas_and_updates_all_prompt_paths(plugin, runtime):
    plugin.push_message = Mock(return_value={"submitted": True})
    runtime.engine.set_addressing(plugin._state["shared"], {"endearments": False})
    result = asyncio.run(plugin.set_addressing(
        scope="shared", changes={"preferred_name": "小林"}, expected={"preferred_name": ""},
    ))
    assert isinstance(result, runtime.Ok) and not result.value["result"]["endearments"]
    assert "小林" in plugin.push_message.call_args.kwargs["parts"][0]["text"]
    state = asyncio.run(plugin._make_state_handler("shared")())
    assert state["nickname"] == "小林" and "小林" in state["addressing"]
    desired = plugin._desired_tools()
    assert "小林" in desired["love_state"][3]
    parameters, handler = plugin._tool_spec("address", "shared")
    token = parameters["properties"]["relationship_token"]["enum"][0]
    assert asyncio.run(handler(operation="avoid_name", name="小林", relationship_token=token))["saved"]
    assert not runtime.engine.effective_nickname(plugin._state["shared"])
    conflict = asyncio.run(plugin.set_addressing(
        scope="shared", changes={"endearments": False}, expected={"endearments": True},
    ))
    assert isinstance(conflict, runtime.Ok)  # current equals requested: replay is valid


def test_startup_backs_up_legacy_addressing_once_before_normalization(plugin, runtime):
    raw = copy.deepcopy(plugin._state)
    for key in ("addressing", "addressing_revision"):
        raw["shared"].pop(key)
    raw["shared"]["nicknames"] = {"familiar": "阁下"}
    raw["characters"]["MIO"] = copy.deepcopy(raw["shared"])
    plugin._state_file.save(raw)
    plugin._start_worker = Mock()
    assert isinstance(asyncio.run(plugin.startup()), runtime.Ok)
    backup = runtime.StateFile(plugin.data_path("state.pre-addressing-v1.json"))
    assert backup.load()[0] == raw
    assert not plugin._state["shared"]["addressing"]["endearments"]
    assert plugin._state["characters"]["MIO"]["nicknames"] == {"familiar": "阁下"}
    assert isinstance(asyncio.run(plugin.startup()), runtime.Ok)
    assert backup.load()[0] == raw


def test_addressing_backup_failure_aborts_without_overwriting_save(plugin, runtime, monkeypatch):
    raw = copy.deepcopy(plugin._state)
    raw["shared"].pop("addressing")
    plugin._state_file.save(raw)
    payload = plugin._state_file.path.read_bytes()
    save = runtime.StateFile.save

    def fail_backup(store, value):
        if store.path.name == "state.pre-addressing-v1.json":
            raise OSError("full")
        return save(store, value)

    monkeypatch.setattr(runtime.StateFile, "save", fail_backup)
    plugin._start_worker = Mock()
    result = asyncio.run(plugin.startup())
    assert isinstance(result, runtime.Err) and str(result.error) == "addressing_backup_failed"
    assert plugin._state_file.path.read_bytes() == payload and not plugin._ready
    plugin._start_worker.assert_not_called()


def test_future_addressing_version_aborts_without_data_loss(plugin, runtime):
    raw = copy.deepcopy(plugin._state)
    raw["shared"]["addressing"]["version"] = 999
    plugin._state_file.save(raw)
    payload = plugin._state_file.path.read_bytes()
    result = asyncio.run(plugin.startup())
    assert isinstance(result, runtime.Err) and str(result.error) == "addressing_version_unsupported"
    assert plugin._state_file.path.read_bytes() == payload and not plugin._ready


def test_lowered_confirmed_relationship_is_consistent_in_runtime_state_and_context(plugin, runtime):
    plugin._state["shared"] = runtime.engine.new_record(90)
    runtime.engine.set_affection(plugin._state["shared"], 0)
    plugin.push_message = Mock(return_value={"submitted": True})
    plugin._flush_context()
    assert "你们已经是恋人" in plugin.push_message.call_args.kwargs["parts"][0]["text"]
    value = asyncio.run(plugin._make_state_handler("shared")())
    assert value["stage"] == "恋人（目前相处有些疏远）"
    assert "不能因此否认已有关系" in value["tone"]
    updated = asyncio.run(plugin._make_update_handler("shared")(delta=1, reason="关心"))
    assert updated["stage"] == value["stage"]
    assert "不能因此否认已有关系" in updated["tone"]


@pytest.mark.parametrize("independent", [False, True])
def test_restart_persists_strangers_without_changing_other_relationships_or_assets(plugin, runtime, independent):
    runtime.engine.set_affection(plugin._state["shared"], 85, gate=True)
    runtime.engine.confess(plugin._state["shared"], "old romance")
    plugin._state["characters"]["YUI"] = copy.deepcopy(plugin._state["shared"])
    plugin._state["characters"]["MIO"] = runtime.engine.new_record(35)
    plugin._state["per_character"] = independent
    scope = "char:YUI" if independent else "shared"
    record = runtime.engine.get_record(plugin._state, scope)
    runtime.engine.set_affection(record, 0, source="reset")
    record["proactive_confession"].update(status="accepted", attempts=3, target="YUI")
    record.update(gained_today=3, gained_chat=2, gained_gift=1)
    before = copy.deepcopy(plugin._state)
    old_tool = plugin._make_update_handler(scope)
    plugin.push_message = Mock(return_value={"submitted": True})
    result = asyncio.run(plugin.restart_relationship(**restart_args(plugin, scope)))
    assert isinstance(result, runtime.Ok)
    record = runtime.engine.get_record(plugin._state, scope)
    assert record["stage"] == "stranger" and record["affection"] == 0 and not record["confessed"]
    assert record["confessed_on"] is None and record["confession"] == "" and "lover" not in record["milestones"]
    assert record["gained_chat"] == 2 and record["gained_gift"] == 1 and record["gained_today"] == 3
    assert record["history"][-1]["source"] == "restart" and record["history"][-2]["source"] == "reset"
    assert record["proactive_confession"]["status"] == "idle" and record["proactive_confession"]["attempts"] == 0
    assert plugin._state["shop"] == before["shop"]
    assert plugin._state["anniversaries"] == before["anniversaries"]
    if independent:
        assert plugin._state["shared"] == before["shared"]
        assert plugin._state["characters"]["MIO"] == before["characters"]["MIO"]
    else:
        assert plugin._state["characters"] == before["characters"]
    saved, _ = plugin._state_file.load()
    restored = runtime.engine.normalize_state(saved)
    assert runtime.engine.get_record(restored, scope) == record
    tool_state = asyncio.run(plugin._make_state_handler(scope)())
    assert tool_state["stage"] == "陌生" and "hint" not in tool_state
    rejection = asyncio.run(old_tool(delta=3, reason="old score"))
    assert rejection["error"] == "RELATIONSHIP_CHANGED"
    assert plugin.push_message.called
    assert "你们已经是恋人" not in plugin.push_message.call_args.kwargs["parts"][0]["text"]
    dashboard = asyncio.run(plugin.dashboard())
    current = next(item for item in dashboard["scopes"] if item["key"] == scope)
    assert not current["confessed"] and current["confessed_on"] is None
    assert "lover" not in current["milestones"]


@pytest.mark.parametrize("changed", ["revision", "confession", "missing", "bool_revision", "int_confessed"])
def test_restart_rejects_changed_relationship_or_invalid_confirmation_without_mutation(plugin, runtime, changed):
    runtime.engine.set_affection(plugin._state["shared"], 85, gate=True)
    args = restart_args(plugin)
    if changed == "revision":
        runtime.engine.set_affection(plugin._state["shared"], 86, gate=True)
    elif changed == "confession":
        runtime.engine.confess(plugin._state["shared"], "new romance")
    elif changed == "missing":
        args.pop("expected_revision")
    elif changed == "bool_revision":
        args["expected_revision"] = True
    else:
        args["expected_confessed"] = 0
    before = copy.deepcopy(plugin._state)
    result = asyncio.run(plugin.restart_relationship(**args))
    assert isinstance(result, runtime.Err) and str(result.error) == "relationship_changed"
    assert plugin._state == before
    assert not plugin._state_file.path.exists()


def test_concurrent_restarts_cannot_clear_new_progress_with_an_old_confirmation(plugin, runtime):
    from concurrent.futures import ThreadPoolExecutor

    runtime.engine.set_affection(plugin._state["shared"], 85, gate=True)
    runtime.engine.confess(plugin._state["shared"], "confirmed")
    args = restart_args(plugin)
    plugin._flush_context = Mock()
    with ThreadPoolExecutor(max_workers=3) as workers:
        results = list(workers.map(lambda _: asyncio.run(plugin.restart_relationship(**args)), range(3)))
    assert sum(isinstance(result, runtime.Ok) for result in results) == 1
    assert all(str(result.error) == "relationship_changed" for result in results if isinstance(result, runtime.Err))
    assert sum(item["source"] == "restart" for item in plugin._state["shared"]["history"]) == 1
    runtime.engine.set_affection(plugin._state["shared"], 35)
    before = copy.deepcopy(plugin._state)
    result = asyncio.run(plugin.restart_relationship(**args))
    assert isinstance(result, runtime.Err) and plugin._state == before


def test_noop_first_address_tool_call_persists_new_independent_record(plugin, runtime):
    runtime.engine.set_per_character(plugin._state, True, "YUI")
    result = asyncio.run(plugin._make_address_handler("char:MIO", 0)(operation="allow_name", name="宝贝"))
    assert result["saved"] and not result["changed"]
    saved, _ = plugin._state_file.load()
    assert saved["characters"]["MIO"]["addressing"] == runtime.engine.new_addressing()


@pytest.mark.parametrize("legacy", [False, True])
def test_prerelease_upgrade_resets_all_address_preferences_once_without_other_changes(plugin, runtime, legacy):
    raw = copy.deepcopy(plugin._state)
    raw.pop("addressing_defaults_version")
    raw["characters"]["MIO"] = runtime.engine.new_record(90)
    for record in (raw["shared"], raw["characters"]["MIO"]):
        runtime.engine.set_addressing(record, {
            "preferred_name": "old name", "endearments": False, "avoided": ["宝贝"],
            "stages": {"familiar": {"mode": "custom", "text": "阁下"}},
        })
        if legacy:
            record.pop("addressing")
    baseline = runtime.engine.normalize_state(raw)
    baseline["shop"] = runtime.shop.normalize(raw["shop"])
    plugin._state_file.save(raw)
    plugin._start_worker = Mock()
    assert isinstance(asyncio.run(plugin.startup()), runtime.Ok)
    assert plugin._state["addressing_defaults_version"] == runtime.engine.ADDRESSING_DEFAULTS_VERSION
    for scope, record in runtime.engine.iter_records(plugin._state):
        assert record["addressing"] == runtime.engine.new_addressing()
        assert record["nicknames"] == {}
        previous = runtime.engine.get_record(baseline, scope)
        for key, value in previous.items():
            if key not in {"addressing", "addressing_revision", "nicknames"}:
                assert record[key] == value, (scope, key)
    for key, value in baseline.items():
        if key not in {"addressing_defaults_version", "shared", "characters"}:
            assert plugin._state[key] == value
    backup = runtime.StateFile(plugin.data_path("state.pre-addressing-defaults-v1.json"))
    assert backup.load()[0] == raw
    runtime.engine.apply_address_request(plugin._state["characters"]["MIO"], "set_name", "new name")
    plugin._save_locked()
    assert isinstance(asyncio.run(plugin.startup()), runtime.Ok)
    assert plugin._state["characters"]["MIO"]["addressing"]["preferred_name"] == "new name"
    assert backup.load()[0] == raw


def test_prerelease_defaults_backup_failure_leaves_original_state_intact(plugin, runtime, monkeypatch):
    raw = copy.deepcopy(plugin._state)
    raw.pop("addressing_defaults_version")
    plugin._state_file.save(raw)
    payload = plugin._state_file.path.read_bytes()
    save = runtime.StateFile.save

    def fail_backup(store, data):
        if store.path.name == "state.pre-addressing-defaults-v1.json":
            raise OSError("full")
        save(store, data)

    monkeypatch.setattr(runtime.StateFile, "save", fail_backup)
    plugin._start_worker = Mock()
    result = asyncio.run(plugin.startup())
    assert isinstance(result, runtime.Err) and str(result.error) == "addressing_backup_failed"
    assert plugin._state_file.path.read_bytes() == payload and not plugin._ready
    plugin._start_worker.assert_not_called()


def test_full_address_defaults_restore_is_atomic_and_replayable(plugin, runtime):
    record = plugin._state["shared"]
    runtime.engine.set_addressing(record, {
        "endearments": False, "preferred_name": "小林", "avoided": ["宝贝"],
        "stages": {"familiar": {"mode": "custom", "text": "阁下"}},
    })
    expected = {key: value for key, value in copy.deepcopy(record["addressing"]).items() if key != "version"}
    changes = {key: value for key, value in runtime.engine.new_addressing().items() if key != "version"}
    for _ in range(2):
        result = asyncio.run(plugin.set_addressing(scope="shared", changes=changes, expected=expected))
        assert isinstance(result, runtime.Ok)
        assert result.value["result"] == runtime.engine.new_addressing()
    revision = record["addressing_revision"]
    runtime.engine.apply_address_request(record, "set_name", "new name")
    before = copy.deepcopy(record)
    result = asyncio.run(plugin.set_addressing(scope="shared", changes=changes, expected=expected))
    assert isinstance(result, runtime.Err) and str(result.error) == "nickname_conflict"
    assert record == before and record["addressing_revision"] == revision + 1


@pytest.mark.parametrize("copy_confirmed_shared", [False, True])
def test_mode_restore_preserves_each_characters_confession(plugin, runtime, copy_confirmed_shared):
    runtime.engine.set_affection(plugin._state["shared"], 85, gate=True)
    asyncio.run(plugin.set_per_character(enabled=True))
    runtime.engine.confess(plugin._state["characters"]["YUI"], "YUI relationship")
    mio = runtime.engine.get_record(plugin._state, "char:MIO")
    runtime.engine.set_affection(mio, 85, gate=True)
    original = {
        name: {key: copy.deepcopy(record[key]) for key in ("confessed", "confessed_on", "confession", "history")}
        for name, record in plugin._state["characters"].items()
    }
    plugin._state["current_character"] = "YUI" if copy_confirmed_shared else "MIO"
    asyncio.run(plugin.set_per_character(enabled=False))
    target = "MIO" if copy_confirmed_shared else "YUI"
    plugin._state["current_character"] = target
    asyncio.run(plugin.set_per_character(enabled=True))
    saved, warning = plugin._state_file.load()
    assert warning is None
    restored = runtime.engine.normalize_state(saved)
    for key, expected in original[target].items():
        assert restored["characters"][target][key] == expected, (target, key)


def test_old_confession_cannot_confirm_a_replaced_relationship(plugin, runtime):
    runtime.engine.set_affection(plugin._state["shared"], 85, gate=True)
    old_handler = plugin._make_confess_handler("shared")
    asyncio.run(plugin.set_per_character(enabled=True))
    mio = runtime.engine.get_record(plugin._state, "char:MIO")
    runtime.engine.set_affection(mio, 85, gate=True)
    plugin._state["current_character"] = "MIO"
    asyncio.run(plugin.set_per_character(enabled=False))
    before = copy.deepcopy(plugin._state)
    result = asyncio.run(old_handler(moment="YUI relationship"))
    assert result.get("error") == "RELATIONSHIP_CHANGED", result
    assert plugin._state == before


def test_old_update_cannot_change_a_different_relationship(plugin, runtime):
    plugin._state["settings"]["auto_score"] = False
    runtime.engine.set_affection(plugin._state["shared"], 85, gate=True)
    asyncio.run(plugin.set_per_character(enabled=True))
    old_handler = plugin._make_update_handler("char:YUI")
    mio = runtime.engine.get_record(plugin._state, "char:MIO")
    runtime.engine.set_affection(mio, 10, gate=True)
    plugin._state["current_character"] = "MIO"
    asyncio.run(plugin.set_per_character(enabled=False))
    before = copy.deepcopy(plugin._state)
    result = asyncio.run(old_handler(delta=2, reason="YUI exchange"))
    assert result.get("error") == "RELATIONSHIP_CHANGED", result
    assert plugin._state == before


@pytest.mark.parametrize("path", ["proactive", "scoring"])
def test_confession_save_failure_cannot_leave_an_undurable_lover(plugin, runtime, monkeypatch, path):
    if path == "proactive":
        now, _ = request_confession(plugin, runtime)
        plugin._on_message(confession_reply(
            plugin, runtime, now + 1, "我喜欢你，你愿意和我在一起吗？",
        ))
        job = None
    else:
        runtime.engine.set_affection(plugin._state["shared"], 85, gate=True)
        plugin._save_locked()
        job = take_job(plugin, runtime)
    saved_before = plugin._state_file.path.read_bytes()
    with monkeypatch.context() as patch:
        patch.setattr(plugin._state_file, "save", Mock(side_effect=PermissionError("read-only")))
        if path == "proactive":
            plugin._on_message(runtime.conv.Message(now + 2, "user", "YUI", "我愿意"))
        else:
            plugin._apply_verdict(
                job, runtime.scoring.Verdict(0, "mutual consent", True), "model", "ok", model_attempted=True,
            )
    assert plugin._state_file.path.read_bytes() == saved_before
    live = copy.deepcopy(plugin._state["shared"])
    plugin._start_worker = Mock()
    assert isinstance(asyncio.run(plugin.startup()), runtime.Ok)
    assert live["confessed"] == plugin._state["shared"]["confessed"]


def test_normal_character_switch_and_restart_preserve_independent_relationships(plugin, runtime, monkeypatch):
    runtime.engine.set_affection(plugin._state["shared"], 85, gate=True)
    asyncio.run(plugin.set_per_character(enabled=True))
    runtime.engine.confess(plugin._state["characters"]["YUI"], "YUI relationship")
    runtime.engine.get_record(plugin._state, "char:MIO")
    plugin._save_locked()
    original = copy.deepcopy(plugin._state["characters"])
    monkeypatch.setattr(runtime.host, "fetch_characters", lambda: (["YUI", "MIO"], "MIO"))
    asyncio.run(runtime.LoveWithYouPlugin._sync_characters(plugin))
    assert plugin._state["current_character"] == "MIO"
    assert plugin._state["characters"] == original
    plugin._start_worker = Mock()
    assert isinstance(asyncio.run(plugin.startup()), runtime.Ok)
    assert plugin._state["characters"] == original
    assert plugin._state["characters"]["YUI"]["confessed"]
    assert not plugin._state["characters"]["MIO"]["confessed"]


@pytest.mark.parametrize("kind", ["confess", "update", "address"])
@pytest.mark.parametrize("change", ["independent_shared", "manual", "disable_enable"])
def test_registered_mutations_require_the_current_token_even_when_the_name_is_reused(plugin, runtime, kind, change):
    runtime.engine.set_affection(plugin._state["shared"], 85, gate=True)
    plugin.push_message = Mock(return_value={"submitted": True})
    old_schema, old_handler = plugin._tool_spec(kind, "shared")
    old_token = old_schema["properties"]["relationship_token"]["enum"][0]
    asyncio.run(change_state(plugin, change))
    new_schema, new_handler = plugin._tool_spec(kind, "shared")
    new_token = new_schema["properties"]["relationship_token"]["enum"][0]
    assert new_token != old_token and "relationship_token" in new_schema["required"]
    args = {
        "confess": {"moment": "mutual consent"},
        "update": {"delta": 1, "reason": "kind"},
        "address": {"operation": "set_name", "name": "Lin"},
    }[kind]
    before = copy.deepcopy(plugin._state)
    for handler, token in ((new_handler, old_token), (old_handler, new_token)):
        result = asyncio.run(handler(**args, relationship_token=token))
        assert result["error"] == "RELATIONSHIP_CHANGED"
        assert plugin._state == before
    result = asyncio.run(new_handler(**args))
    assert result["error"] == "RELATIONSHIP_CHANGED"
    assert plugin._state == before
    result = asyncio.run(new_handler(**args, relationship_token=new_token))
    if kind == "confess" and change == "manual":
        assert result["error"] == "NOT_READY"  # the adjustment lowered affection to 42
    else:
        assert not result.get("is_error"), result


def test_tool_reconciliation_refreshes_bindings_after_same_stage_edits(plugin, runtime):
    runtime.engine.set_affection(plugin._state["shared"], 85, gate=True)
    plugin.register_llm_tool = Mock()
    plugin.unregister_llm_tool = Mock()
    plugin._reconcile_tools = runtime.LoveWithYouPlugin._reconcile_tools.__get__(plugin)
    plugin._reconcile_tools()
    old = {call.kwargs["name"]: call.kwargs for call in plugin.register_llm_tool.call_args_list}
    asyncio.run(plugin.set_affection(scope="shared", value=85))
    latest = {call.kwargs["name"]: call.kwargs for call in plugin.register_llm_tool.call_args_list}
    for name in ("love_confess", "love_address"):
        old_token = old[name]["parameters"]["properties"]["relationship_token"]["enum"][0]
        fresh_token = latest[name]["parameters"]["properties"]["relationship_token"]["enum"][0]
        assert old_token != fresh_token
        assert fresh_token in latest[name]["description"]
    result = asyncio.run(latest["love_confess"]["handler"](moment="consent", relationship_token=old_token))
    assert result["error"] == "RELATIONSHIP_CHANGED"
    assert not plugin._state["shared"]["confessed"]


def fail_automatic_confirmation(plugin, runtime, monkeypatch, path, *, delta=0):
    if path == "proactive":
        now, _ = request_confession(plugin, runtime)
        plugin._on_message(confession_reply(
            plugin, runtime, now + 1, "我喜欢你，你愿意和我在一起吗？",
        ))
        def action():
            plugin._on_message(runtime.conv.Message(now + 2, "user", "YUI", "我愿意"))
    else:
        runtime.engine.set_affection(plugin._state["shared"], 85, gate=True)
        plugin._save_locked()
        job = take_job(plugin, runtime)

        def action():
            plugin._apply_verdict(
                job, runtime.scoring.Verdict(delta, "mutual consent", True), "model", "ok", model_attempted=True,
            )

    before = plugin._state_file.path.read_bytes()
    with monkeypatch.context() as patch:
        patch.setattr(plugin._state_file, "save", Mock(side_effect=OSError("full")))
        action()
        plugin._retry_relationship_saves()
        assert not plugin._state["shared"]["confessed"]
        assert plugin._state["shared"]["affection"] == 85
        assert plugin._auto["last_error"] == "save_failed"
        assert plugin._state_file.path.read_bytes() == before
    assert plugin._pending_acceptances or plugin._pending_scores


@pytest.mark.parametrize("path", ["proactive", "scoring"])
def test_failed_confirmation_retries_once_preserves_other_edits_and_survives_restart(plugin, runtime, monkeypatch, path):
    fail_automatic_confirmation(plugin, runtime, monkeypatch, path, delta=2)
    plugin.push_message = Mock(return_value={"submitted": True})
    asyncio.run(plugin.set_addressing(
        scope="shared", changes={"preferred_name": "Lin"}, expected={"preferred_name": ""},
    ))
    plugin._retry_relationship_saves()
    record = plugin._state["shared"]
    assert record["confessed"] and record["confessed_on"] == runtime.engine.today_str()
    assert record["addressing"]["preferred_name"] == "Lin"
    assert record["affection"] == (87 if path == "scoring" else 85)
    assert len([item for item in record["history"] if item["source"] == "confession"]) == 1
    assert not plugin._pending_acceptances and not plugin._pending_scores
    assert plugin._auto["last_error"] != "save_failed"
    payload = plugin._state_file.path.read_bytes()
    plugin._retry_relationship_saves()
    assert plugin._state_file.path.read_bytes() == payload
    plugin._start_worker = Mock()
    assert isinstance(asyncio.run(plugin.startup()), runtime.Ok)
    assert plugin._state["shared"]["confessed"]
    assert plugin._state["shared"]["addressing"]["preferred_name"] == "Lin"


@pytest.mark.parametrize("path", ["proactive", "scoring"])
@pytest.mark.parametrize("change", ["manual", "reset", "restart", "independent_shared", "gate", "disable_enable"])
def test_user_changes_cancel_failed_confirmation_retries(plugin, runtime, monkeypatch, path, change):
    fail_automatic_confirmation(plugin, runtime, monkeypatch, path)
    asyncio.run(change_state(plugin, change))
    before = copy.deepcopy(plugin._state)
    assert not plugin._pending_acceptances and not plugin._pending_scores
    plugin._retry_relationship_saves()
    assert plugin._state == before


def test_declining_after_a_failed_acceptance_cancels_the_retry(plugin, runtime, monkeypatch):
    fail_automatic_confirmation(plugin, runtime, monkeypatch, "proactive")
    now = runtime.time.time()
    plugin._on_message(runtime.conv.Message(now + 5, "user", "YUI", "我不愿意"))
    assert not plugin._pending_acceptances
    plugin._retry_relationship_saves()
    assert not plugin._state["shared"]["confessed"]
    assert plugin._state["shared"]["proactive_confession"]["status"] == "declined"


@pytest.mark.parametrize("operation", ["manual", "restart", "independent", "proactive_off"])
def test_failed_user_edit_keeps_the_previous_acceptance_retry_valid(plugin, runtime, monkeypatch, operation):
    fail_automatic_confirmation(plugin, runtime, monkeypatch, "proactive")
    pending = dict(plugin._pending_acceptances)
    before = copy.deepcopy(plugin._state)
    with monkeypatch.context() as patch:
        patch.setattr(plugin._state_file, "save", Mock(side_effect=OSError("full")))
        with pytest.raises(runtime.SdkError):
            if operation == "manual":
                asyncio.run(plugin.set_affection(scope="shared", value=42))
            elif operation == "restart":
                asyncio.run(plugin.restart_relationship(**restart_args(plugin)))
            elif operation == "independent":
                asyncio.run(plugin.set_per_character(enabled=True))
            else:
                asyncio.run(plugin.set_settings(proactive_confession=False))
    assert plugin._state == before and plugin._pending_acceptances == pending
    plugin._retry_relationship_saves()
    assert plugin._state["shared"]["confessed"]


def test_write_outage_keeps_completed_scores_and_pauses_new_ones(plugin, runtime, monkeypatch):
    fail_automatic_confirmation(plugin, runtime, monkeypatch, "scoring", delta=2)
    pending = tuple(plugin._pending_scores)
    for i in range(runtime._SCORE_QUEUE_MAX * 2):
        plugin._enqueue(exchange(runtime, ts=10 + i))
    assert plugin._jobs.empty() and tuple(plugin._pending_scores) == pending
    plugin._retry_relationship_saves()
    assert plugin._state["shared"]["affection"] == 87 and plugin._state["shared"]["confessed"]
    assert not plugin._pending_scores
    plugin._enqueue(exchange(runtime, ts=100))
    assert plugin._jobs.qsize() == 1


@pytest.mark.parametrize("path", ["proactive", "scoring"])
def test_confirmation_retry_stays_with_the_original_independent_character(plugin, runtime, monkeypatch, path):
    runtime.engine.set_affection(plugin._state["shared"], 85, gate=True)
    asyncio.run(plugin.set_per_character(enabled=True))
    runtime.engine.get_record(plugin._state, "char:MIO")
    plugin._state["settings"]["proactive_confession"] = path == "proactive"
    plugin.push_message = Mock(return_value={"submitted": True})
    job = take_job(plugin, runtime)
    now = runtime.time.time()
    if path == "proactive":
        plugin._maybe_trigger_proactive_confession(job, runtime.scoring.Verdict(0, "", False))
        plugin._on_message(confession_reply(
            plugin, runtime, now + 1, "我喜欢你，你愿意和我在一起吗？",
        ))
    else:
        plugin._save_locked()
    with monkeypatch.context() as patch:
        patch.setattr(plugin._state_file, "save", Mock(side_effect=OSError("full")))
        if path == "proactive":
            plugin._on_message(runtime.conv.Message(now + 2, "user", "YUI", "我愿意"))
        else:
            plugin._apply_verdict(
                job, runtime.scoring.Verdict(0, "consent", True), "model", "ok", model_attempted=True,
            )
    other = copy.deepcopy(plugin._state["characters"]["MIO"])
    monkeypatch.setattr(runtime.host, "fetch_characters", lambda: (["YUI", "MIO"], "MIO"))
    asyncio.run(runtime.LoveWithYouPlugin._sync_characters(plugin))
    plugin._retry_relationship_saves()
    assert plugin._state["characters"]["YUI"]["confessed"]
    assert plugin._state["characters"]["MIO"] == other
    saved, _ = plugin._state_file.load()
    assert saved["characters"]["YUI"]["confessed"]
    assert not saved["characters"]["MIO"]["confessed"]


@pytest.mark.parametrize("receipt", [None, {}, {"submitted": 1}, {"submitted": "true"}])
def test_ambiguous_gift_submission_uses_uncertain_retry_delay(plugin, runtime, monkeypatch, receipt):
    prepare_gift(plugin)
    plugin.push_message.return_value = receipt
    result = asyncio.run(plugin.send_shop_gift(**shop_args(plugin, item_id="cake", character="YUI")))
    assert result.value["reaction"] == "unknown"
    gift = plugin._state["shop"]["history"][-1]
    monkeypatch.setattr(runtime.time, "time", lambda: gift["requested_at"] + 31)
    assert isinstance(asyncio.run(plugin.retry_gift_reaction(gift_id=gift["id"])), runtime.Err)
    assert plugin.push_message.call_count == 1
    saved, _ = plugin._state_file.load()
    assert saved["shop"]["history"][-1]["reaction"] == "unknown"


def test_invitation_replay_reports_current_submission_without_sending_again(plugin, runtime):
    plugin._state["experiences"]["enabled"] = True
    plugin.push_message = Mock(return_value={"submitted": True})
    note = asyncio.run(plugin.experience_action(**experience_args(
        plugin, "start_note", {"title": "Together", "text": "First line"},
    )))
    args = experience_args(plugin, "invite", {"id": note.value["id"]})
    assert asyncio.run(plugin.experience_action(**args)).value["invitation"] == "submitted"
    calls = plugin.push_message.call_count
    replay = asyncio.run(plugin.experience_action(**args))
    assert replay.value["replay"] and replay.value["invitation"] == "submitted"
    assert plugin.push_message.call_count == calls
    plugin._start_worker = Mock()
    assert isinstance(asyncio.run(plugin.startup()), runtime.Ok)
    replay = asyncio.run(plugin.experience_action(**args))
    assert replay.value["replay"] and replay.value["invitation"] == "unknown"
    assert sum(call.kwargs.get("ai_behavior") == "respond"
               for call in plugin.push_message.call_args_list) == 1


def test_late_history_snapshot_cannot_duplicate_a_newly_selected_bus_turn(plugin, runtime, monkeypatch):
    now = runtime.time.time()
    plugin._cursor = runtime.conv.BusCursor(now)
    plugin._recent_tracker = runtime.conv.RecentHistoryTracker(now)
    plugin._recent_tracker.feed("YUI", [], now)
    plugin._recent_tracker.feed("MIO", [], now)
    plugin._state["settings"]["auto_score"] = False
    started, release = threading.Event(), threading.Event()

    def fetch(name):
        if name == "YUI":
            started.set()
            assert release.wait(timeout=3)
            return [recent_row("human", "Hello"), recent_row("ai", "Hi")]
        return []

    monkeypatch.setattr(runtime.host, "fetch_recent_chat", fetch)
    plugin.ctx.bus = SimpleNamespace(conversations=SimpleNamespace(get=AsyncMock(return_value=[
        {"timestamp": now + index, "turn_type": kind, "lanlan_name": "YUI", "content": text}
        for index, (kind, text) in enumerate([("user_message", "Hello"), ("assistant_message", "Hi")], 1)
    ])))

    async def scenario():
        pending = asyncio.create_task(plugin._poll_recent_conversations())
        try:
            assert await asyncio.to_thread(started.wait, 2)
            assert await plugin._poll_conversations()
        finally:
            release.set()
            await asyncio.wait_for(pending, timeout=3)

    asyncio.run(scenario())
    assert plugin._auto["seen"] == 1
    assert plugin._conversation_sources == {"YUI": "conversations"}


def test_unrelated_proactive_proposal_cannot_confirm_this_plugins_confession(plugin, runtime):
    now, _ = request_confession(plugin, runtime)
    plugin._on_message(runtime.conv.Message(
        now + 1, "proactive_reply", "YUI", "我喜欢你，你愿意和我在一起吗？",
    ))
    plugin._on_message(runtime.conv.Message(now + 2, "user", "YUI", "我愿意"))
    state = plugin._state["shared"]["proactive_confession"]
    assert not state["reply_seen"] and not state["delivery_seen"]
    assert not plugin._state["shared"]["confessed"]


def test_host_instruction_correlates_only_the_current_confession_attempt(plugin, runtime):
    now, _ = request_confession(plugin, runtime)
    prompt = plugin.push_message.call_args.kwargs["parts"][0]["text"]
    assert "[LWY-CONFESSION:" in prompt
    unrelated = {"timestamp": now + 1, "turn_type": "proactive_reply", "lanlan_name": "YUI",
                 "conversation_id": "unrelated", "content": "我喜欢你，你愿意和我在一起吗？"}
    instruction = {"timestamp": now + 2, "turn_type": "proactive_instruction", "lanlan_name": "YUI",
                   "conversation_id": "proposal-turn", "content": prompt}
    reply = {**unrelated, "timestamp": now + 3, "conversation_id": "proposal-turn"}
    plugin._cursor = runtime.conv.BusCursor(now)
    plugin.ctx.bus = SimpleNamespace(conversations=SimpleNamespace(get=AsyncMock(return_value=[reply, instruction])))
    assert asyncio.run(plugin._poll_conversations())
    assert plugin._state["shared"]["proactive_confession"]["reply_seen"]
    assert plugin._jobs.empty()
    plugin._on_message(runtime.conv.Message(now + 4, "user", "YUI", "我愿意"))
    assert plugin._state["shared"]["confessed"]


def test_old_confession_request_cannot_acknowledge_a_new_attempt(plugin, runtime, monkeypatch):
    now, job = request_confession(plugin, runtime)
    old = confession_reply(plugin, runtime, now + 1, "我喜欢你，你愿意和我在一起吗？")
    later = now + runtime.engine.PROACTIVE_CONFESSION_WAIT_SECONDS + 1
    state = plugin._state["shared"]["proactive_confession"]
    plugin._expire_proactive_locked(state, later)
    later = state["cooldown_until"] + 1
    monkeypatch.setattr(runtime.time, "time", lambda: later)
    plugin._maybe_trigger_proactive_confession(job, runtime.scoring.Verdict(0, "", False))
    plugin._on_message(runtime.conv.Message(
        later + 1, old.role, old.lanlan, old.content, metadata=old.metadata,
    ))
    state = plugin._state["shared"]["proactive_confession"]
    assert state["status"] == "waiting" and not state["reply_seen"]


def test_shutdown_during_startup_io_prevents_late_reactivation(plugin, runtime, monkeypatch):
    plugin._save_locked()
    plugin._start_worker = Mock()
    plugin.register_llm_tool = Mock()
    plugin._reconcile_tools = runtime.LoveWithYouPlugin._reconcile_tools.__get__(plugin)
    original_to_thread = asyncio.to_thread

    async def scenario():
        prepared, release = asyncio.Event(), asyncio.Event()
        starting = None

        async def pause_startup(function, *args, **kwargs):
            result = await original_to_thread(function, *args, **kwargs)
            if asyncio.current_task() is starting:
                prepared.set()
                await release.wait()
            return result

        monkeypatch.setattr(runtime.asyncio, "to_thread", pause_startup)
        starting = asyncio.create_task(plugin.startup())
        try:
            await asyncio.wait_for(prepared.wait(), timeout=3)
            assert isinstance(await plugin.shutdown(), runtime.Ok)
        finally:
            release.set()
        result = await asyncio.wait_for(starting, timeout=3)
        assert isinstance(result, runtime.Err) and not plugin._ready
        plugin._start_worker.assert_not_called()
        plugin.register_llm_tool.assert_not_called()

    asyncio.run(scenario())


def test_overlapping_startups_cannot_both_initialize_the_plugin(plugin, runtime, monkeypatch):
    plugin._save_locked()
    plugin._start_worker = Mock()
    original_to_thread = asyncio.to_thread

    async def scenario():
        prepared, release = asyncio.Event(), asyncio.Event()
        starting = None

        async def pause_startup(function, *args, **kwargs):
            result = await original_to_thread(function, *args, **kwargs)
            if asyncio.current_task() is starting:
                prepared.set()
                await release.wait()
            return result

        monkeypatch.setattr(runtime.asyncio, "to_thread", pause_startup)
        starting = asyncio.create_task(plugin.startup())
        try:
            await asyncio.wait_for(prepared.wait(), timeout=3)
            duplicate = await plugin.startup()
            assert isinstance(duplicate, runtime.Err)
        finally:
            release.set()
            assert isinstance(await asyncio.wait_for(starting, timeout=3), runtime.Ok)
        assert plugin._start_worker.call_count == 1

    asyncio.run(scenario())


def test_reload_refreshes_state_tools_context_and_activity_for_the_new_session(plugin, runtime):
    plugin._save_locked()
    plugin._reconcile_tools = runtime.LoveWithYouPlugin._reconcile_tools.__get__(plugin)
    plugin.register_llm_tool = Mock(return_value=True)
    plugin.unregister_llm_tool = Mock(return_value=True)
    plugin._reconcile_tools()
    old_names = set(plugin._registered)
    plugin._live_roles = set()
    plugin._host_online = True
    plugin._context_entry("YUI").update(key="old", retry_at=1e20)
    plugin._latest_message_ts["YUI"] = 1e20
    plugin._last_decay_day = runtime.engine.today_str()
    plugin._last_character_sync = plugin._last_tool_verify = 1e20
    assert isinstance(asyncio.run(plugin.shutdown()), runtime.Ok)
    plugin.register_llm_tool.reset_mock()
    assert isinstance(asyncio.run(plugin.startup()), runtime.Ok)
    names = {call.kwargs["name"] for call in plugin.register_llm_tool.call_args_list}
    assert old_names <= names
    assert plugin._live_roles is None and not plugin._host_online
    assert not plugin._context and not plugin._latest_message_ts
    assert plugin._last_character_sync == plugin._last_tool_verify == 0
    assert plugin._last_decay_day is None


@pytest.mark.parametrize("version", [1, 2, 3])
def test_supported_save_versions_preserve_assets_and_relationships_on_repeated_upgrade(plugin, runtime, version):
    raw = copy.deepcopy(plugin._state)
    raw["version"] = version
    raw["shop"]["coins"] = 246
    raw["shop"]["inventory"] = {"cake": 3}
    runtime.engine.set_affection(raw["shared"], 90, gate=True)
    runtime.engine.confess(raw["shared"], "Mutual consent")
    raw["characters"]["MIO"] = runtime.engine.new_record(33)
    plugin._state_file.save(raw)
    plugin._start_worker = Mock()
    for _ in range(2):
        assert isinstance(asyncio.run(plugin.startup()), runtime.Ok)
        assert plugin._state["shop"]["coins"] == 246
        assert plugin._state["shop"]["inventory"]["cake"] == 3
        assert plugin._state["shared"]["confessed"] and plugin._state["shared"]["affection"] == 90
        assert plugin._state["characters"]["MIO"]["affection"] == 33


def test_failed_initial_save_returns_error_and_next_startup_recovers(plugin, runtime, monkeypatch):
    plugin._start_worker = Mock()
    save = runtime.StateFile.save
    with monkeypatch.context() as patch:
        patch.setattr(runtime.StateFile, "save", Mock(side_effect=OSError("disk full")))
        result = asyncio.run(plugin.startup())
        assert isinstance(result, runtime.Err)
        assert not plugin._ready and not plugin._state_file.path.exists()
        plugin._start_worker.assert_not_called()
    assert runtime.StateFile.save is save
    assert isinstance(asyncio.run(plugin.startup()), runtime.Ok)
    assert plugin._state_file.path.exists()


@pytest.mark.parametrize("result", [None, "unavailable", {"error": "failed"}, 1])
def test_invalid_bus_results_do_not_report_a_readable_bus(plugin, runtime, result):
    plugin._cursor = runtime.conv.BusCursor(0)
    plugin.ctx.bus = SimpleNamespace(conversations=SimpleNamespace(get=AsyncMock(return_value=result)))
    assert not asyncio.run(plugin._poll_conversations())
    assert plugin._bus_read_error == "invalid_result"
    assert plugin._auto["seen"] == 0 and plugin._jobs.empty()


def test_forwarded_pre_start_chat_does_not_become_a_new_exchange(plugin, runtime):
    now = runtime.time.time()
    plugin._cursor = runtime.conv.BusCursor(now)
    plugin.ctx.bus = SimpleNamespace(conversations=SimpleNamespace(get=AsyncMock(return_value=[
        {"timestamp": now + offset, "turn_type": kind, "lanlan_name": "YUI", "content": text,
         "metadata": {"ts": now - 20 + offset}}
        for offset, (kind, text) in enumerate([("user_message", "Old question"), ("assistant_message", "Old reply")], 1)
    ])))
    before = copy.deepcopy(plugin._state)
    assert asyncio.run(plugin._poll_conversations())
    assert plugin._auto["seen"] == 0 and plugin._jobs.empty()
    assert plugin._state == before and not plugin._conversation_sources


def test_previous_session_state_query_cannot_mutate_a_reloaded_relationship(plugin, runtime):
    handler = plugin._make_state_handler("shared")
    plugin._save_locked()
    assert isinstance(asyncio.run(plugin.shutdown()), runtime.Ok)
    assert isinstance(asyncio.run(plugin.startup()), runtime.Ok)
    before = copy.deepcopy(plugin._state), plugin._state_file.path.read_bytes()
    assert asyncio.run(handler())["is_error"]
    assert (plugin._state, plugin._state_file.path.read_bytes()) == before
    assert not asyncio.run(plugin._make_state_handler("shared")()).get("is_error")


def test_invitation_admitted_before_reload_cannot_send_after_reload(plugin, runtime):
    plugin._state["experiences"]["enabled"] = True
    plugin.push_message = Mock(return_value={"submitted": True})
    note = asyncio.run(plugin.experience_action(**experience_args(
        plugin, "start_note", {"title": "Together", "text": "First line"},
    )))
    original_dispatch = plugin._dispatch_note_invitation
    plugin._dispatch_note_invitation = Mock(return_value="unknown")
    asyncio.run(plugin.experience_action(**experience_args(plugin, "invite", {"id": note.value["id"]})))
    args = plugin._dispatch_note_invitation.call_args
    plugin._start_worker = Mock()
    assert isinstance(asyncio.run(plugin.startup()), runtime.Ok)
    plugin.push_message.reset_mock()
    assert original_dispatch(*args.args, **args.kwargs) == "unknown"
    plugin.push_message.assert_not_called()


def test_confession_request_identity_survives_reload_without_resending(plugin, runtime):
    now, _ = request_confession(plugin, runtime)
    reply = confession_reply(plugin, runtime, now + 2, "我喜欢你，你愿意和我在一起吗？")
    request_id = plugin._state["shared"]["proactive_confession"]["request_id"]
    plugin._start_worker = Mock()
    assert isinstance(asyncio.run(plugin.startup()), runtime.Ok)
    assert plugin._state["shared"]["proactive_confession"]["request_id"] == request_id
    assert plugin.push_message.call_count == 1
    plugin._on_message(reply)
    plugin._on_message(runtime.conv.Message(now + 3, "user", "YUI", "我愿意"))
    assert plugin._state["shared"]["confessed"]


def test_uncertain_confession_attempts_stay_bounded_after_many_restarts(plugin, runtime, monkeypatch):
    now, _ = request_confession(plugin, runtime)
    plugin._start_worker = Mock()
    for index in range(1, runtime.engine.PROACTIVE_CONFESSION_MAX_ATTEMPTS * 4):
        later = now + index * (
            runtime.engine.PROACTIVE_CONFESSION_WAIT_SECONDS
            + runtime.engine.PROACTIVE_CONFESSION_TIMEOUT_COOLDOWN_SECONDS + 3600
        )
        monkeypatch.setattr(runtime.time, "time", lambda: later)
        assert isinstance(asyncio.run(plugin.startup()), runtime.Ok)
        plugin._maybe_trigger_proactive_confession(
            take_job(plugin, runtime), runtime.scoring.Verdict(0, "", False),
        )
    assert plugin.push_message.call_count == runtime.engine.PROACTIVE_CONFESSION_MAX_ATTEMPTS


def test_adventure_is_separate_from_relationship_and_shop_and_uses_actual_stage(plugin, runtime, tmp_path):
    plugin._adventure = runtime.adventure.AdventureStore(runtime.StateFile(tmp_path / "adventure.json"))
    before = copy.deepcopy(plugin._state)
    view = asyncio.run(plugin.adventure_action(client="client_00000001")).value["adventure"]
    args = {
        "operation": "start", "request_id": "adventure_start_001", "client": "client_00000001",
        "revision": view["revision"], "epoch": view["epoch"],
        "values": {"character": "YUI", "player_class": "guardian", "companion_class": "mage"},
    }
    assert isinstance(asyncio.run(plugin.adventure_action(**args)), runtime.Ok)
    saved = asyncio.run(plugin.adventure_action(client="client_00000001")).value["adventure"]
    assert saved["run"]["character"] == "YUI"
    assert saved["run"]["stage_index"] == runtime.engine.stage_index(before["shared"]["stage"])
    assert plugin._state == before
    assert not plugin._state_file.path.exists()


def test_adventure_old_epoch_cannot_mutate_after_startup(plugin, runtime, tmp_path):
    plugin._adventure = runtime.adventure.AdventureStore(runtime.StateFile(tmp_path / "adventure.json"))
    old_epoch = plugin._adventure.epoch
    plugin._start_worker = Mock()
    assert isinstance(asyncio.run(plugin.startup()), runtime.Ok)
    result = asyncio.run(plugin.adventure_action(
        operation="start", request_id="adventure_start_001", client="client_00000001",
        revision=0, epoch=old_epoch,
        values={"character": "YUI", "player_class": "guardian", "companion_class": "mage"},
    ))
    assert isinstance(result, runtime.Err)
    assert str(result.error) == "adventure_session_expired"
    assert plugin._adventure.view()["run"] is None


def test_adventure_stopped_plugin_cannot_read_or_start(plugin, runtime, tmp_path):
    plugin._adventure = runtime.adventure.AdventureStore(runtime.StateFile(tmp_path / "adventure.json"))
    assert plugin._stop_worker()
    assert isinstance(asyncio.run(plugin.adventure_action()), runtime.Err)
    assert not (tmp_path / "adventure.json").exists()


def test_adventure_shop_transactions_are_isolated_from_relationship_and_gift_wallet(plugin, runtime, tmp_path):
    service = runtime.adventure.AdventureStore(runtime.StateFile(tmp_path / "adventure.json"))
    service.state["economy"].update(balance=120, earned=120)
    service.file.save(service.state)
    plugin._adventure = service
    before = copy.deepcopy(plugin._state)
    view = asyncio.run(plugin.adventure_action(client="client_00000001")).value["adventure"]
    args = {
        "operation": "buy", "request_id": "adventure_buy_0001", "client": "client_00000001",
        "revision": view["revision"], "epoch": view["epoch"], "values": {"upgrade": "power", "level": 0},
    }
    bought = asyncio.run(plugin.adventure_action(**args))
    assert isinstance(bought, runtime.Ok)
    assert bought.value["adventure"]["economy"]["balance"] == 80
    args.update(operation="refund", request_id="adventure_refund_01",
                revision=bought.value["adventure"]["revision"], values={"upgrade": "power", "level": 1})
    refunded = asyncio.run(plugin.adventure_action(**args))
    assert isinstance(refunded, runtime.Ok)
    assert refunded.value["adventure"]["economy"]["balance"] == 120
    assert plugin._state == before
    assert not plugin._state_file.path.exists()
