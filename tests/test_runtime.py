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
    assert plugin._state["shop"]["coins"] == 110
    assert plugin._jobs.empty()
    saved, _ = plugin._state_file.load()
    assert "morning" not in str(saved["shop"])
    plugin._state = runtime.engine.normalize_state(saved)
    plugin._state["shop"] = runtime.shop.normalize(saved["shop"])
    plugin._income_tracker.reset()
    income_turn(plugin, runtime, now, "morning")
    assert plugin._state["shop"]["coins"] == 110
    assert plugin._state["shop"]["income_total"] == 10


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
    assert plugin._state["shop"]["coins"] == 110
    assert not plugin._income_pending and not plugin._income_error
    with plugin._lock:
        plugin._flush_income_locked()
    assert plugin._state["shop"]["coins"] == 110


def test_income_is_global_and_not_reset_by_scoring_changes(plugin, runtime, monkeypatch):
    now = 1_800_000_000.0
    monkeypatch.setattr(runtime.time, "time", lambda: now + 100)
    income_turn(plugin, runtime, now, "first", "YUI")
    plugin._invalidate_scoring_locked()
    income_turn(plugin, runtime, now + 21, "second", "MIO")
    income_turn(plugin, runtime, now + 42, "third", "YUI")
    assert plugin._state["shop"]["coins"] == 120
    assert len(plugin._state["shop"]["days"]) == 1
    plugin._on_message(runtime.conv.Message(now + 70, runtime.conv.PROACTIVE_REPLY_TURN, "YUI", "thanks"))
    assert plugin._state["shop"]["coins"] == 120


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


def test_automatic_income_makes_old_purchase_revision_stale_without_charging(plugin, runtime, monkeypatch):
    args = shop_args(plugin, item_id="cake")
    now = 1_800_000_000.0
    monkeypatch.setattr(runtime.time, "time", lambda: now + 2)
    income_turn(plugin, runtime, now, "hello")
    result = asyncio.run(plugin.buy_shop_item(**args))
    assert isinstance(result, runtime.Err) and str(result.error) == "shop_stale"
    assert plugin._state["shop"]["coins"] == 110
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


def test_shop_buy_persists_once_and_manual_claim_is_retired(plugin, runtime):
    args = shop_args(plugin)
    bought = asyncio.run(plugin.buy_shop_item(**args, item_id="cake"))
    assert isinstance(bought, runtime.Ok)
    assert asyncio.run(plugin.buy_shop_item(**args, item_id="cake")).value == bought.value
    economy = plugin._state["shop"]
    assert economy["coins"] == 60 and economy["inventory"]["cake"] == 1
    assert economy["revision"] == 1
    claimed = asyncio.run(plugin.claim_shop_coins(**shop_args(plugin, "transaction_000002")))
    assert isinstance(claimed, runtime.Err)
    assert str(claimed.error) == "shop_income_automatic"
    raw, warning = plugin._state_file.load()
    assert warning is None
    loaded = runtime.engine.normalize_state(raw)
    assert runtime.shop.normalize(loaded["shop"]) == economy
    assert economy["coins"] == 60
    rejected = asyncio.run(plugin.claim_shop_coins(**shop_args(plugin, "transaction_000003")))
    assert isinstance(rejected, runtime.Err)
    assert str(rejected.error) == "shop_income_automatic"


def test_concurrent_duplicate_purchase_only_charges_once(plugin, runtime):
    from concurrent.futures import ThreadPoolExecutor

    args = shop_args(plugin)
    with ThreadPoolExecutor(max_workers=3) as workers:
        results = list(workers.map(lambda _: asyncio.run(plugin.buy_shop_item(**args, item_id="cake")), range(3)))
    assert all(isinstance(result, runtime.Ok) for result in results)
    assert plugin._state["shop"]["coins"] == 60
    assert plugin._state["shop"]["inventory"]["cake"] == 1


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
    assert plugin._state["shop"]["coins"] == 120
    assert plugin._state["shop"]["income_total"] == 20
    assert plugin._conversation_sources == {"YUI": "host_recent_history"}
    assert asyncio.run(plugin._poll_recent_conversations())
    assert plugin._auto["seen"] == 3 and plugin._jobs.empty()
    saved, _ = plugin._state_file.load()
    assert saved["shop"]["coins"] == 120 and saved["shared"]["stage"] == "lover"
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
    assert plugin._auto["seen"] == 1 and plugin._state["shop"]["coins"] == 110
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
    assert plugin._state["shop"]["coins"] == 110  # the second counted turn has no new threshold
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
    assert plugin._state["shop"]["coins"] == 110


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
    assert plugin._state["shop"]["coins"] == 110
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
