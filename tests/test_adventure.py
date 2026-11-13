from __future__ import annotations

import copy
import importlib
from concurrent.futures import ThreadPoolExecutor

import pytest


@pytest.fixture
def module(storage):
    return importlib.import_module(storage.__package__ + "._adventure")


@pytest.fixture
def store(module, storage, tmp_path):
    return module.AdventureStore(storage.StateFile(tmp_path / "adventure.json", max_bytes=module.MAX_BYTES))


def call(store, operation="start", request="request_00000001", revision=None, client="client_00000001", **values):
    if operation == "start":
        values = {"character": "YUI", "player_class": "guardian", "companion_class": "mage", **values}
    elif operation in ("claim", "checkpoint", "release", "finish") and "run_id" not in values:
        values["run_id"] = store.view()["run"]["id"]
    return store.execute(
        operation, request, store.view()["revision"] if revision is None else revision,
        client, store.epoch, values, character="YUI", stage_index=2,
    )


def snapshot(**changes):
    value = {
        "rules": 1, "elapsed": 10000, "rng": "!rnd,1,0.4,0.5,0.6",
        "player": {"x": 900, "y": 600, "hp": 80}, "companion": {"x": 850, "y": 630},
        "enemies": [{"id": 1, "kind": "slime", "x": 700, "y": 500, "hp": 24}],
        "bullets": [{"id": 2, "x": 800, "y": 500, "vx": -400, "vy": 0, "life": 800, "damage": 20, "owner": "player"}],
        "drops": [{"id": 3, "x": 800, "y": 600, "amount": 4}],
        "level": 2, "xp": 3, "kills": 1, "partner_kills": 1, "next_id": 4,
        "ranks": dict.fromkeys(("power", "vitality", "stride", "reach", "partner", "haste", "ward", "multishot"), 0),
        "choices": ["power", "partner", "ward"], "spawn_at": 10500,
        "attack_at": 10200, "support_at": 11000, "hurt_until": 0, "shield": 12,
        "boss_spawned": False, "outcome": "playing",
    }
    value.update(changes)
    return value


def test_start_and_checkpoint_survive_reload_without_restoring_control(store, module):
    call(store)
    call(store, "checkpoint", "checkpoint_000001", snapshot=snapshot())
    reloaded = module.AdventureStore(store.file)
    assert reloaded.view()["run"]["snapshot"] == snapshot()
    assert not reloaded.view("client_00000001")["owns_control"]
    call(reloaded, "claim", "claim_request_001", takeover=False)
    assert reloaded.view("client_00000001")["owns_control"]


def test_start_replay_keeps_original_identity_and_relation_snapshot(store):
    first = call(store)
    original = store.view()
    replay = call(store, revision=0)
    assert replay == first
    assert store.view() == original
    assert original["run"]["bonus"] == 4
    assert original["run"]["snapshot"] is None


def test_retry_cannot_recover_control_after_takeover(store, module):
    call(store)
    call(store, "claim", "claim_request_001", client="client_00000002", takeover=True)
    assert call(store, revision=0)["revision"] == 1
    assert not store.view("client_00000001")["owns_control"]
    with pytest.raises(module.AdventureError, match="control_lost"):
        call(store, "checkpoint", "checkpoint_000001", snapshot=snapshot())


def test_takeover_is_explicit_and_old_calls_are_rejected(store, module):
    call(store)
    with pytest.raises(module.AdventureError, match="controlled_elsewhere"):
        call(store, "claim", "claim_request_001", client="client_00000002", takeover=False)
    call(store, "claim", "claim_request_002", client="client_00000002", takeover=True)
    with pytest.raises(module.AdventureError, match="stale"):
        call(store, "checkpoint", "checkpoint_000001", revision=1, snapshot=snapshot())


def test_save_failure_does_not_publish_state_or_owner(store, monkeypatch):
    call(store)
    original = store.view("client_00000001")
    monkeypatch.setattr(store.file, "save", lambda _: (_ for _ in ()).throw(OSError("full")))
    with pytest.raises(OSError):
        call(store, "claim", "claim_request_001", client="client_00000002", takeover=True)
    assert store.view("client_00000001") == original


def test_checkpoint_response_loss_can_be_replayed_without_second_write(store, monkeypatch):
    call(store)
    args = {"operation": "checkpoint", "request_id": "checkpoint_000001", "revision": 1,
            "client": "client_00000001", "epoch": store.epoch,
            "values": {"run_id": store.view()["run"]["id"], "snapshot": snapshot()}}
    first = store.execute(**args)
    monkeypatch.setattr(store.file, "save", lambda _: pytest.fail("replay wrote disk"))
    assert store.execute(**args) == first


def test_saved_exit_releases_control_and_other_window_can_resume_without_takeover(store):
    call(store)
    call(store, "release", "release_request_01", snapshot=snapshot())
    assert not store.view("client_00000001")["owns_control"]
    call(store, "claim", "claim_request_001", client="client_00000002", takeover=False)
    assert store.view("client_00000002")["owns_control"]


def test_changed_request_identity_is_rejected(store, module):
    call(store)
    with pytest.raises(module.AdventureError, match="request_conflict"):
        call(store, revision=0, player_class="mage")


def test_finish_is_terminal_and_replay_does_not_reopen_run(store, module):
    call(store)
    final = snapshot(outcome="retreated")
    result = call(store, "finish", "finish_request_01", snapshot=final)
    assert call(store, "finish", "finish_request_01", revision=1, snapshot=final) == result
    assert store.view()["run"]["status"] == "ended"
    with pytest.raises(module.AdventureError, match="run_closed"):
        call(store, "checkpoint", "checkpoint_000001", snapshot=snapshot(elapsed=11000))


def test_evicted_receipt_cannot_repeat_old_start_or_checkpoint(store, module):
    first = call(store)
    for i in range(34):
        call(store, "checkpoint", f"checkpoint_{i:08}", snapshot=snapshot(elapsed=10000 + i))
    assert not any(r["id"] == first["request_id"] for r in store.state["receipts"])
    with pytest.raises(module.AdventureError, match="stale"):
        call(store, revision=0)


def test_concurrent_checkpoint_at_same_revision_has_one_winner(store):
    call(store)
    def save(index):
        try:
            call(store, "checkpoint", f"checkpoint_{index:08}", revision=1, snapshot=snapshot())
            return True
        except ValueError:
            return False
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(save, range(2))) == [False, True]
    assert store.view()["revision"] == 2


@pytest.mark.parametrize("changes", [
    {"elapsed": True}, {"elapsed": -1}, {"elapsed": 1200001}, {"rules": 2},
    {"player": {"x": float("nan"), "y": 600, "hp": 100}},
    {"player": {"x": 900, "y": 600, "hp": float("inf")}},
    {"rng": "broken"}, {"enemies": [None]}, {"enemies": [{}] * 161},
    {"choices": ["power", "power"]}, {"choices": [["power"]]},
    {"partner_kills": 2}, {"ranks": {}}, {"next_id": 3},
    {"outcome": "defeated"}, {"outcome": "cleared"}, {"outcome": "timeout"},
])
def test_invalid_checkpoints_leave_saved_state_untouched(store, module, changes):
    call(store)
    before = copy.deepcopy(store.state)
    with pytest.raises(module.AdventureError):
        call(store, "checkpoint", "checkpoint_000001", snapshot=snapshot(**changes))
    assert store.state == before


def test_unknown_or_corrupt_save_is_not_overwritten(store, module):
    store.file.save({"version": 999})
    raw = store.file.path.read_bytes()
    reloaded = module.AdventureStore(store.file)
    with pytest.raises(module.AdventureError, match="recovery_required"):
        reloaded.view()
    assert store.file.path.read_bytes() == raw


def test_old_epoch_is_rejected_after_reload(store, module):
    call(store)
    reloaded = module.AdventureStore(store.file)
    with pytest.raises(module.AdventureError, match="session_expired"):
        reloaded.execute("claim", "claim_request_001", 1, "client_00000001", store.epoch,
                         {"run_id": store.view()["run"]["id"], "takeover": False})


def test_multishot_cannot_exceed_its_actual_effect_cap(module):
    value = snapshot()
    value["ranks"]["multishot"] = 3
    module.validate_snapshot(value)
    value["ranks"]["multishot"] = 4
    with pytest.raises(module.AdventureError):
        module.validate_snapshot(value)


def earn(store, *, elapsed=1200000, outcome="timeout"):
    sequence = store.state["sequence"] + 1
    call(store, request=f"start_earn_{sequence:08}")
    return call(store, "finish", f"finish_earn_{sequence:08}", snapshot=snapshot(elapsed=elapsed, outcome=outcome))


@pytest.mark.parametrize(("elapsed", "outcome", "expected"), [
    (0, "retreated", 0), (59999, "defeated", 0), (60000, "defeated", 6),
    (300001, "retreated", 30), (1200000, "timeout", 120),
    (1080000, "cleared", 188), (1200000, "cleared", 200),
])
def test_terminal_rewards_use_complete_simulated_minutes_and_actual_clear(store, elapsed, outcome, expected, module):
    call(store)
    final = snapshot(elapsed=elapsed, outcome=outcome, boss_spawned=outcome == "cleared",
                     player={"x": 900, "y": 600, "hp": 0 if outcome == "defeated" else 80})
    result = call(store, "finish", "finish_reward_001", snapshot=final)
    assert result["settlement"]["total"] == expected
    assert store.view()["economy"] == {
        "balance": expected, "earned": expected, "levels": dict.fromkeys(module.economy.PRODUCTS, 0),
    }
    assert store.view()["run"]["settlement"] == result["settlement"]
    reloaded = module.AdventureStore(store.file)
    assert reloaded.view()["economy"] == store.view()["economy"]
    assert reloaded.view()["run"] == store.view()["run"]


def test_checkpoints_and_saved_exits_do_not_mint_coins(store):
    call(store)
    call(store, "checkpoint", "checkpoint_paid_01", snapshot=snapshot(elapsed=61000))
    call(store, "release", "release_paid_001", snapshot=snapshot(elapsed=119999))
    call(store, "claim", "claim_paid_00001", takeover=False)
    assert store.view()["economy"]["earned"] == 0
    result = call(store, "finish", "finish_paid_0001", snapshot=snapshot(elapsed=120000, outcome="retreated"))
    assert result["economy"]["balance"] == 12


def test_finish_response_loss_is_atomic_and_replay_never_awards_twice(store, monkeypatch):
    call(store)
    final = snapshot(elapsed=600000, outcome="retreated")
    revision = store.view()["revision"]
    first = call(store, "finish", "finish_reward_001", revision=revision, snapshot=final)
    monkeypatch.setattr(store.file, "save", lambda _: pytest.fail("replay wrote disk"))
    assert call(store, "finish", "finish_reward_001", revision=revision, snapshot=final) == first
    assert store.view()["economy"]["earned"] == 60
    assert store.view()["run"]["status"] == "ended"


@pytest.mark.parametrize("operation", ["finish", "buy", "refund"])
def test_economy_write_failure_rolls_back_wallet_terminal_and_receipt(store, module, monkeypatch, operation):
    earn(store)
    if operation == "finish":
        call(store)
        values = {"snapshot": snapshot(elapsed=300000, outcome="retreated")}
    else:
        if operation == "refund":
            call(store, "buy", "buy_before_failure", upgrade="vitality", level=0)
        values = {"upgrade": "vitality", "level": store.state["economy"]["levels"]["vitality"]}
    before = copy.deepcopy(store.state)
    owner = store.owner
    persisted = store.file.path.read_bytes()
    monkeypatch.setattr(store.file, "save", lambda _: (_ for _ in ()).throw(OSError("disk full")))
    with pytest.raises(OSError):
        call(store, operation, "failed_economy_01", **values)
    assert store.state == before
    assert store.owner == owner
    assert store.file.path.read_bytes() == persisted
    assert module.AdventureStore(store.file).state == before


def test_buy_and_refund_use_backend_prices_and_replay_exact_historical_receipts(store):
    earn(store)
    revision = store.view()["revision"]
    bought = call(store, "buy", "buy_upgrade_0001", upgrade="vitality", level=0)
    assert bought["economy"]["balance"] == 80
    assert bought["transaction"] == {"upgrade": "vitality", "before": 0, "after": 1, "amount": 40}
    refund = call(store, "refund", "refund_upgrade_01", upgrade="vitality", level=1)
    assert refund["economy"]["balance"] == 120
    assert refund["economy"]["earned"] == 120
    assert call(store, "buy", "buy_upgrade_0001", revision=revision, upgrade="vitality", level=0) == bought
    assert store.view()["economy"] == refund["economy"]
    assert not store.view("client_00000001")["owns_control"]


def test_permanent_caps_and_full_refund_follow_paid_rank_cost(store, module):
    for _ in range(6):
        earn(store)
    for level in range(5):
        call(store, "buy", f"buy_vitality_{level:04}", upgrade="vitality", level=level)
    assert store.view()["economy"]["balance"] == 40
    with pytest.raises(module.AdventureError, match="upgrade_maxed"):
        call(store, "buy", "buy_above_cap_001", upgrade="vitality", level=5)
    refund = call(store, "refund", "refund_last_rank", upgrade="vitality", level=5)
    assert refund["transaction"]["amount"] == 260
    for level in range(4, 0, -1):
        call(store, "refund", f"refund_rank_{level:04}", upgrade="vitality", level=level)
    assert store.view()["economy"]["balance"] == 720
    assert store.view()["economy"]["earned"] == 720
    with pytest.raises(module.AdventureError, match="nothing_to_refund"):
        call(store, "refund", "refund_empty_001", upgrade="vitality", level=0)


@pytest.mark.parametrize("values", [
    {"upgrade": "vitality", "level": True}, {"upgrade": "missing", "level": 0},
    {"upgrade": ["power"], "level": 0}, {"upgrade": "vitality", "level": 0, "price": 0},
    {"upgrade": "vitality", "level": 1}, {"upgrade": "vitality", "level": -1},
])
def test_invalid_or_stale_shop_requests_do_not_change_assets(store, module, values):
    earn(store)
    before = copy.deepcopy(store.state)
    with pytest.raises(module.AdventureError):
        call(store, "buy", "invalid_purchase_01", **values)
    assert store.state == before


def test_insufficient_coins_and_frontend_reward_claims_are_rejected(store, module):
    with pytest.raises(module.AdventureError, match="insufficient_coins"):
        call(store, "buy", "buy_no_money_001", upgrade="power", level=0)
    call(store)
    with pytest.raises(module.AdventureError, match="invalid_request"):
        call(store, "finish", "finish_fake_money", snapshot=snapshot(outcome="retreated"), coins=1000000)
    assert store.view()["economy"]["earned"] == 0


def test_active_run_blocks_shop_and_preserves_start_loadout_on_reload(store, module):
    earn(store)
    call(store, "buy", "buy_vitality_001", upgrade="vitality", level=0)
    call(store, "buy", "buy_power_000001", upgrade="power", level=0)
    call(store)
    run = store.view()["run"]
    assert run["loadout"]["bonuses"] == {"vitality": 4, "power": 2, "stride": 0, "reach": 0}
    for operation in ("buy", "refund"):
        with pytest.raises(module.AdventureError, match="shop_during_run"):
            call(store, operation, f"{operation}_during_run_01", client="client_00000002",
                 upgrade="power", level=1)
    assert store.view("client_00000001")["owns_control"]
    call(store, "release", "release_with_stats", snapshot=snapshot())
    reloaded = module.AdventureStore(store.file)
    assert reloaded.view()["run"]["loadout"] == run["loadout"]
    call(reloaded, "claim", "claim_with_stats", takeover=False)
    call(reloaded, "finish", "finish_with_stats", snapshot=snapshot(outcome="retreated"))
    call(reloaded, "refund", "refund_after_run", upgrade="power", level=1)
    assert reloaded.view()["run"]["loadout"] == run["loadout"]
    call(reloaded, request="start_after_refund")
    assert reloaded.view()["run"]["loadout"]["bonuses"]["power"] == 0


def test_concurrent_purchases_have_one_winner_at_the_same_revision(store, module):
    earn(store)
    revision = store.view()["revision"]
    def purchase(index):
        try:
            call(store, "buy", f"concurrent_buy_{index:04}", revision=revision, upgrade="power", level=0)
            return True
        except module.AdventureError:
            return False
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(purchase, range(2))) == [False, True]
    assert store.view()["economy"]["balance"] == 80
    assert store.view()["economy"]["levels"]["power"] == 1


def test_evicted_finish_and_purchase_requests_cannot_repeat_assets(store, module):
    first = earn(store)
    buy_revision = store.view()["revision"]
    call(store, "buy", "buy_evicted_0001", upgrade="power", level=0)
    call(store, "refund", "refund_evicted_01", upgrade="power", level=1)
    for index in range(18):
        call(store, "buy", f"later_buy_{index:08}", upgrade="power", level=0)
        call(store, "refund", f"later_refund_{index:08}", upgrade="power", level=1)
    before = copy.deepcopy(store.state)
    assert not any(receipt["id"] == first["request_id"] for receipt in store.state["receipts"])
    with pytest.raises(module.AdventureError, match="stale"):
        call(store, "buy", "buy_evicted_0001", revision=buy_revision, upgrade="power", level=0)
    with pytest.raises(module.AdventureError, match="run_closed"):
        call(store, "finish", first["request_id"], snapshot=snapshot(elapsed=1200000, outcome="timeout"))
    assert store.state == before
    call(store, request="start_after_eviction")
    with pytest.raises(module.AdventureError, match="run_closed"):
        call(store, "finish", first["request_id"], run_id=first["run_id"],
             snapshot=snapshot(elapsed=1200000, outcome="timeout"))
    assert store.view()["economy"]["balance"] == 120


def legacy_file(store, *, ended=False):
    call(store)
    call(store, "checkpoint", "checkpoint_legacy", snapshot=snapshot())
    if ended:
        call(store, "finish", "finish_legacy_001", snapshot=snapshot(elapsed=300000, outcome="retreated"))
    raw = copy.deepcopy(store.state)
    raw["version"] = 1
    del raw["economy"]
    del raw["run"]["loadout"]
    del raw["run"]["settlement"]
    del raw["run"]["rules"]
    for receipt in raw["receipts"]:
        receipt["result"].pop("economy", None)
        receipt["result"].pop("settlement", None)
    store.file.save(raw)
    return raw


def test_v1_active_run_migrates_without_losing_checkpoint_and_backs_up_before_write(store, module):
    legacy = legacy_file(store)
    original = store.file.path.read_bytes()
    migrated = module.AdventureStore(store.file)
    assert migrated.view()["run"]["snapshot"] == legacy["run"]["snapshot"]
    assert migrated.view()["run"]["loadout"]["bonuses"] == dict.fromkeys(module.economy.PRODUCTS, 0)
    assert migrated.view()["economy"]["balance"] == 0
    assert store.file.path.read_bytes() == original
    call(migrated, "claim", "claim_after_upgrade", takeover=False)
    backups = list(store.file.path.parent.glob("adventure.v1-*.backup.json"))
    assert len(backups) == 1
    assert module.StateFile(backups[0]).load()[0] == legacy
    assert store.file.load()[0]["version"] == module.VERSION
    result = call(migrated, "finish", "finish_after_upgrade", snapshot=snapshot(elapsed=300000, outcome="retreated"))
    assert result["economy"]["balance"] == 30
    assert len(list(store.file.path.parent.glob("adventure.v1-*.backup.json"))) == 1


def test_v1_ended_run_is_preserved_without_automatic_retroactive_rewards(store, module):
    legacy = legacy_file(store, ended=True)
    migrated = module.AdventureStore(store.file)
    assert migrated.view()["run"]["snapshot"] == legacy["run"]["snapshot"]
    assert migrated.view()["run"]["settlement"] is None
    assert migrated.view()["economy"]["earned"] == 0
    with pytest.raises(module.AdventureError, match="run_closed"):
        call(migrated, "finish", "finish_again_legacy", snapshot=snapshot(elapsed=300000, outcome="retreated"))
    assert module.AdventureStore(store.file).view()["economy"]["balance"] == 0


def test_v1_backup_failure_leaves_original_and_published_state_unchanged(store, module, monkeypatch):
    legacy_file(store)
    original = store.file.path.read_bytes()
    migrated = module.AdventureStore(store.file)
    before = copy.deepcopy(migrated.state)
    monkeypatch.setattr(module.StateFile, "save", lambda *_: (_ for _ in ()).throw(OSError("backup failed")))
    with pytest.raises(OSError):
        call(migrated, "claim", "claim_failed_migration", takeover=False)
    assert migrated.state == before
    assert migrated.owner is None
    assert store.file.path.read_bytes() == original


def skill_snapshot(module, **changes):
    def build(ids):
        return {
            "skills": [{"id": key, "level": 1, "focus": "", "branch": "", "evolution": "",
                        "ready_at": 0, "react_at": 0} for key in ids],
            "talents": dict.fromkeys(module.skills.TALENTS, 0),
            "misses": dict.fromkeys(module.skills.CATALOG, 0),
        }
    value = snapshot(rules=2, choices=["fire:power", "fire:haste", "wind:learn"])
    del value["ranks"]
    value.update(builds={"player": build(["fire", "flame"]), "companion": build(["wind", "pull"])},
                 study_owner="player", rerolls=2, zones=[], facing={"x": 1, "y": 0},
                 stats={"player_damage": 0, "companion_damage": 0, "supports": 0, "followups": 0})
    value["bullets"][0].update(skill="fire", pierce=0, hit_ids=[])
    value.update(changes)
    return value


def test_new_rules_save_builds_pending_owner_and_effect_cooldowns(store, module):
    call(store, rules=2, player_class="mage")
    value = skill_snapshot(module)
    value["builds"]["companion"]["skills"][1]["ready_at"] = 18500
    value["zones"] = [{"id": 4, "kind": "flame", "owner": "player", "x": 800, "y": 600,
                       "radius": 90, "damage": 18, "expires_at": 14000, "tick_at": 10500, "targets": []}]
    value["next_id"] = 5
    call(store, "release", "release_new_skills", snapshot=value)
    reloaded = module.AdventureStore(store.file)
    assert reloaded.view()["run"]["rules"] == 2
    assert reloaded.view()["run"]["snapshot"] == value
    assert not reloaded.view("client_00000001")["owns_control"]


@pytest.mark.parametrize("corruption", [
    "owner", "missing", "slot", "branch", "fusion", "cooldown", "rerolls", "facing",
    "duplicate_zone", "too_many_zones", "unknown_choice", "duplicate_hit", "companion_talent",
])
def test_new_skill_checkpoints_reject_invalid_catalog_and_owner_states(store, module, corruption):
    call(store, rules=2)
    value = skill_snapshot(module)
    if corruption == "owner":
        value["study_owner"] = "companion"
    elif corruption == "missing":
        del value["builds"]
    elif corruption == "slot":
        value["builds"]["companion"]["skills"][0]["id"] = "flame"
    elif corruption == "branch":
        value["builds"]["player"]["skills"][0].update(level=3, focus="power", branch="follow")
    elif corruption == "fusion":
        value["builds"]["player"]["skills"][0].update(level=5, focus="power", branch="blast", evolution="fusion")
    elif corruption == "cooldown":
        value["builds"]["player"]["skills"][0]["ready_at"] = float("nan")
    elif corruption == "rerolls":
        value["rerolls"] = 3
    elif corruption == "facing":
        value["facing"] = {"x": 0, "y": 0}
    elif corruption in ("duplicate_zone", "too_many_zones"):
        zone = {"id": 1, "kind": "pull", "owner": "companion", "x": 800, "y": 600,
                "radius": 90, "damage": 10, "expires_at": 11000, "tick_at": 10500, "targets": [1]}
        value["zones"] = [zone] * (13 if corruption == "too_many_zones" else 1)
    elif corruption == "unknown_choice":
        value["choices"] = ["armor:learn"]
    elif corruption == "duplicate_hit":
        value["bullets"][0]["hit_ids"] = [1, 1]
    elif corruption == "companion_talent":
        value["builds"]["companion"]["talents"]["vitality"] = 1
    before = copy.deepcopy(store.state)
    with pytest.raises(module.AdventureError):
        call(store, "checkpoint", "invalid_skill_save", snapshot=value)
    assert store.state == before


def test_rules_cannot_change_during_a_run(store, module):
    call(store)
    with pytest.raises(module.AdventureError, match="rules_unsupported"):
        call(store, "checkpoint", "changed_rules_save", snapshot=skill_snapshot(module))
    assert store.view()["run"]["snapshot"] is None


def test_v2_active_run_and_wallet_migrate_to_v3_without_changing_combat(store, module):
    earn(store)
    call(store, "buy", "buy_before_v3", upgrade="power", level=0)
    call(store, request="start_before_v3")
    call(store, "checkpoint", "save_before_v3", snapshot=snapshot())
    raw = copy.deepcopy(store.state)
    raw["version"] = 2
    del raw["run"]["rules"]
    store.file.save(raw)
    migrated = module.AdventureStore(store.file)
    assert migrated.view()["run"]["rules"] == 1
    assert migrated.view()["run"]["snapshot"] == raw["run"]["snapshot"]
    assert migrated.view()["economy"] == raw["economy"]
    call(migrated, "claim", "claim_v3_migration", takeover=False)
    backups = list(store.file.path.parent.glob("adventure.v2-*.backup.json"))
    assert len(backups) == 1
    assert module.StateFile(backups[0]).load()[0] == raw
    assert module.AdventureStore(store.file).view()["run"]["rules"] == 1


@pytest.mark.parametrize("corruption", ["balance", "levels", "loadout", "settlement", "receipt"])
def test_inconsistent_assets_or_receipts_block_adventure_without_overwrite(store, module, corruption):
    earn(store)
    raw = copy.deepcopy(store.state)
    if corruption == "balance":
        raw["economy"]["balance"] += 1
    elif corruption == "levels":
        raw["economy"]["levels"]["power"] = True
    elif corruption == "loadout":
        raw["run"]["loadout"]["bonuses"]["power"] = 2
    elif corruption == "settlement":
        raw["run"]["settlement"]["total"] += 1
    else:
        raw["receipts"][-1]["result"]["economy"]["balance"] += 1
    store.file.save(raw)
    persisted = store.file.path.read_bytes()
    reloaded = module.AdventureStore(store.file)
    with pytest.raises(module.AdventureError, match="recovery_required"):
        reloaded.view()
    assert store.file.path.read_bytes() == persisted


def frost_snapshot(module, rules=3, **changes):
    value = skill_snapshot(module, rules=rules, choices=[], study_owner="")
    for build in value["builds"].values():
        build["misses"] = dict.fromkeys(module.skills.CATALOGS[3], 0)
    value["builds"]["companion"]["skills"][0]["id"] = "ice"
    value["builds"]["player"]["skills"][1]["id"] = "frost"
    value["bullets"][0].update(skill="ice", owner="companion", form="base")
    value["zones"] = [{"id": 4, "kind": "frost", "owner": "player", "x": 700, "y": 500,
                       "radius": 115, "damage": 6, "expires_at": 13000, "tick_at": 11000, "targets": []}]
    value.update(next_id=5, shatter_at=10500, frosts=[{
        "target": 1, "source": "companion", "stacks": 3, "expires_at": 13000,
        "frozen_until": 10400, "freeze_at": 13300, "break_at": 0,
    }])
    value["stats"].update(shatters=2, cross_shatters=1)
    value.update(changes)
    return value


def test_frost_checkpoint_restores_marks_zones_forms_and_counters_exactly(store, module):
    call(store, rules=3)
    value = frost_snapshot(module)
    call(store, "release", "release_frost_save", snapshot=value)
    restored = module.AdventureStore(store.file)
    assert restored.view()["rules"] == 3
    assert restored.view()["run"]["snapshot"] == value
    assert not restored.view("client_00000001")["owns_control"]


@pytest.mark.parametrize("corruption", [
    "missing", "unknown", "stacks", "boolean_stack", "source", "unlearned_source", "dead_target",
    "duplicate", "too_many", "nan", "long_freeze", "long_immunity", "long_expiry",
    "long_break", "long_shatter", "boss_freeze", "clock_order", "cross_count",
    "projectile_form", "unearned_awakening", "unearned_fusion", "hits", "zone_owner",
    "old_misses", "unknown_skill",
])
def test_frost_hostile_checkpoints_are_rejected_without_writes(store, module, corruption):
    call(store, rules=3)
    value = frost_snapshot(module)
    mark = value["frosts"][0]
    if corruption == "missing":
        del value["frosts"]
    elif corruption == "unknown":
        mark["extra"] = True
    elif corruption == "stacks":
        mark["stacks"] = 4
    elif corruption == "boolean_stack":
        mark["stacks"] = True
    elif corruption == "source":
        mark["source"] = []
    elif corruption == "unlearned_source":
        value["builds"]["companion"]["skills"][0]["id"] = "wind"
        value["bullets"][0]["skill"] = "wind"
    elif corruption == "dead_target":
        mark["target"] = 99
    elif corruption == "duplicate":
        value["frosts"].append(copy.deepcopy(mark))
    elif corruption == "too_many":
        value["frosts"] *= 161
    elif corruption == "nan":
        mark["expires_at"] = float("nan")
    elif corruption.startswith("long_"):
        field = {"long_freeze": "frozen_until", "long_immunity": "freeze_at", "long_expiry": "expires_at",
                 "long_break": "break_at", "long_shatter": "shatter_at"}[corruption]
        (value if field == "shatter_at" else mark)[field] = 1000000
    elif corruption == "boss_freeze":
        value["enemies"][0]["kind"] = "boss"
    elif corruption == "clock_order":
        mark["freeze_at"] = 0
    elif corruption == "cross_count":
        value["stats"]["cross_shatters"] = 3
    elif corruption in ("projectile_form", "unearned_awakening", "unearned_fusion"):
        value["bullets"][0]["form"] = {
            "projectile_form": [], "unearned_awakening": "awakened", "unearned_fusion": "fusion",
        }[corruption]
    elif corruption == "hits":
        value["bullets"][0]["hit_ids"] = list(range(1, 8))
    elif corruption == "zone_owner":
        value["zones"][0]["owner"] = "companion"
    elif corruption == "old_misses":
        value["builds"]["player"]["misses"] = dict.fromkeys(module.skills.CATALOG, 0)
    elif corruption == "unknown_skill":
        value["builds"]["player"]["skills"][0]["id"] = "gravity"
    before = copy.deepcopy(store.state)
    persisted = store.file.path.read_bytes()
    with pytest.raises(module.AdventureError):
        call(store, "checkpoint", "invalid_frost_save", snapshot=value)
    assert store.state == before
    assert store.file.path.read_bytes() == persisted


def test_rule3_awakening_forms_and_four_pull_targets_are_valid(module):
    value = frost_snapshot(module)
    ice = value["builds"]["companion"]["skills"][0]
    ice.update(level=5, focus="power", branch="rime", evolution="pure")
    value["bullets"][0].update(form="awakened", pierce=1)
    value["enemies"] += [{"id": i, "kind": "slime", "x": 750, "y": 500, "hp": 24} for i in range(5, 8)]
    value["zones"].append({"id": 8, "kind": "pull", "owner": "companion", "x": 700, "y": 500,
                           "radius": 160, "damage": 10, "expires_at": 11000, "tick_at": 10500,
                           "targets": [1, 5, 6, 7]})
    value["next_id"] = 9
    assert module.validate_snapshot(value) == value


def test_v3_skill_run_wallet_and_pending_choices_migrate_with_a_unique_backup(store, module):
    earn(store)
    call(store, "buy", "buy_before_ice", upgrade="power", level=0)
    call(store, request="start_before_ice", rules=2)
    value = skill_snapshot(module)
    call(store, "checkpoint", "save_before_ice", snapshot=value)
    raw = copy.deepcopy(store.state)
    raw["version"] = 3
    store.file.save(raw)
    original = store.file.path.read_bytes()
    existing = store.file.path.with_name("adventure.v3-existing.backup.json")
    existing.write_bytes(b"existing backup")
    migrated = module.AdventureStore(store.file)
    assert migrated.view()["run"] == raw["run"]
    assert migrated.view()["economy"] == raw["economy"]
    assert store.file.path.read_bytes() == original
    call(migrated, "claim", "claim_ice_upgrade", takeover=False)
    assert existing.read_bytes() == b"existing backup"
    backups = [p for p in store.file.path.parent.glob("adventure.v3-*.backup.json") if p != existing]
    assert len(backups) == 1
    assert module.StateFile(backups[0]).load()[0] == raw
    call(migrated, "checkpoint", "save_after_ice", snapshot=value)
    assert len(list(store.file.path.parent.glob("adventure.v3-*.backup.json"))) == 2
    assert module.AdventureStore(store.file).view()["run"]["snapshot"] == value


def test_v3_file_cannot_claim_rule3_and_rule2_cannot_switch_mid_run(store, module):
    call(store, rules=2)
    with pytest.raises(module.AdventureError, match="rules_unsupported"):
        call(store, "checkpoint", "switch_to_frost", snapshot=frost_snapshot(module))
    raw = copy.deepcopy(store.state)
    raw["version"] = 3
    raw["run"].update(rules=3, snapshot=frost_snapshot(module))
    store.file.save(raw)
    original = store.file.path.read_bytes()
    with pytest.raises(module.AdventureError, match="recovery_required"):
        module.AdventureStore(store.file).view()
    assert store.file.path.read_bytes() == original


def test_rule3_settlement_retry_preserves_contribution_and_awards_once(store, module, monkeypatch):
    call(store, rules=3)
    final = frost_snapshot(module, elapsed=420000, outcome="retreated")
    revision = store.view()["revision"]
    first = call(store, "finish", "finish_frost_once", revision=revision, snapshot=final)
    monkeypatch.setattr(store.file, "save", lambda _: pytest.fail("retry wrote disk"))
    assert call(store, "finish", "finish_frost_once", revision=revision, snapshot=final) == first
    assert store.view()["economy"]["balance"] == 42
    assert store.view()["run"]["snapshot"]["stats"]["cross_shatters"] == 1
