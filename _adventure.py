"""Independent adventure checkpoints. No SDK, relationship writes or model calls."""

from __future__ import annotations

import copy
import hashlib
import json
import math
import re
import secrets
import threading
from typing import Any

from . import _adventure_economy as economy
from . import _adventure_skills as skills
from ._adventure_economy import AdventureError
from ._storage import StateFile

VERSION = 8
RULES = 7
DURATION = 20 * 60 * 1000
WORLD = (1800, 1200)
CLASSES = ("guardian", "mage")
UPGRADES = ("power", "vitality", "stride", "reach", "partner", "haste", "ward", "multishot")
TOKEN = re.compile(r"[A-Za-z0-9_-]{12,80}\Z")
MAX_BYTES = 512 * 1024


def _number(value: Any, minimum: float, maximum: float) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and minimum <= value <= maximum


def _integer(value: Any, minimum: int, maximum: int) -> bool:
    return type(value) is int and minimum <= value <= maximum


def _token(value: Any) -> bool:
    return isinstance(value, str) and bool(TOKEN.fullmatch(value))


def validate_snapshot(value: Any) -> dict[str, Any]:
    """Validate the entire bounded checkpoint, including pending upgrade choices."""
    if isinstance(value, dict) and type(value.get("rules")) is int and value["rules"] in (2, 3, 4, 5, 6, 7):
        common = skills.validate_extra(value)
        validate_snapshot(common)
        if value["rules"] >= 4:
            skills.validate_encounters(value, value["builds"])
        return copy.deepcopy(value)
    if not isinstance(value, dict) or set(value) != {
        "rules", "elapsed", "rng", "player", "companion", "enemies", "bullets", "drops",
        "level", "xp", "kills", "partner_kills", "next_id", "ranks", "choices",
        "spawn_at", "attack_at", "support_at", "hurt_until", "shield", "boss_spawned", "outcome",
    }:
        raise AdventureError("adventure_invalid_snapshot")
    if value["rules"] != 1 or type(value["rules"]) is not int:
        raise AdventureError("adventure_rules_unsupported")
    if not _integer(value["elapsed"], 0, DURATION):
        raise AdventureError("adventure_invalid_snapshot")
    if not isinstance(value["rng"], str) or not re.fullmatch(r"!rnd,[0-9.,e+\-]{1,180}", value["rng"]):
        raise AdventureError("adventure_invalid_snapshot")
    for name in ("player", "companion"):
        entity = value[name]
        expected = {"x", "y", "hp"} if name == "player" else {"x", "y"}
        if not isinstance(entity, dict) or set(entity) != expected:
            raise AdventureError("adventure_invalid_snapshot")
        if not _number(entity["x"], 0, WORLD[0]) or not _number(entity["y"], 0, WORLD[1]):
            raise AdventureError("adventure_invalid_snapshot")
    if not _number(value["player"]["hp"], 0, 500):
        raise AdventureError("adventure_invalid_snapshot")
    for name, minimum, maximum in (
        ("level", 1, 100), ("xp", 0, 10000), ("kills", 0, 100000),
        ("partner_kills", 0, 100000), ("next_id", 1, 1000000),
    ):
        if not _integer(value[name], minimum, maximum):
            raise AdventureError("adventure_invalid_snapshot")
    for name in ("spawn_at", "attack_at", "support_at", "hurt_until"):
        if not _number(value[name], 0, DURATION + 30000):
            raise AdventureError("adventure_invalid_snapshot")
    if not _number(value["shield"], 0, 200) or type(value["boss_spawned"]) is not bool:
        raise AdventureError("adventure_invalid_snapshot")
    if value["outcome"] not in ("playing", "defeated", "cleared", "timeout", "retreated"):
        raise AdventureError("adventure_invalid_snapshot")
    ranks = value["ranks"]
    if not isinstance(ranks, dict) or set(ranks) != set(UPGRADES) or any(
        not _integer(rank, 0, 3 if key == "multishot" else 8) for key, rank in ranks.items()
    ):
        raise AdventureError("adventure_invalid_snapshot")
    choices = value["choices"]
    if not isinstance(choices, list) or len(choices) > 3 or len(set(
        item for item in choices if isinstance(item, str)
    )) != len(choices) or any(not isinstance(item, str) or item not in UPGRADES for item in choices):
        raise AdventureError("adventure_invalid_snapshot")
    ids: set[int] = set()
    for name, limit, fields in (
        ("enemies", 160, {"id", "kind", "x", "y", "hp"}),
        ("bullets", 160, {"id", "x", "y", "vx", "vy", "life", "damage", "owner"}),
        ("drops", 160, {"id", "x", "y", "amount"}),
    ):
        items = value[name]
        if not isinstance(items, list) or len(items) > limit:
            raise AdventureError("adventure_invalid_snapshot")
        for item in items:
            if not isinstance(item, dict) or set(item) != fields:
                raise AdventureError("adventure_invalid_snapshot")
            if not _integer(item["id"], 1, value["next_id"] - 1) or item["id"] in ids:
                raise AdventureError("adventure_invalid_snapshot")
            ids.add(item["id"])
            if not _number(item["x"], 0, WORLD[0]) or not _number(item["y"], 0, WORLD[1]):
                raise AdventureError("adventure_invalid_snapshot")
            if name == "enemies" and (
                item["kind"] not in ("slime", "wisp", "brute", "boss") or not _number(item["hp"], 0.01, 100000)
            ):
                raise AdventureError("adventure_invalid_snapshot")
            if name == "bullets" and (
                any(not _number(item[key], -1000, 1000) for key in ("vx", "vy"))
                or not _number(item["life"], 0, 3000) or not _number(item["damage"], 0.01, 1000)
                or item["owner"] not in ("player", "companion")
            ):
                raise AdventureError("adventure_invalid_snapshot")
            if name == "drops" and not _integer(item["amount"], 1, 100000):
                raise AdventureError("adventure_invalid_snapshot")
    if value["partner_kills"] > value["kills"]:
        raise AdventureError("adventure_invalid_snapshot")
    if value["outcome"] == "defeated" and value["player"]["hp"] != 0:
        raise AdventureError("adventure_invalid_snapshot")
    if value["outcome"] == "cleared" and (not value["boss_spawned"] or value["elapsed"] < 18 * 60 * 1000):
        raise AdventureError("adventure_invalid_snapshot")
    if value["outcome"] == "timeout" and value["elapsed"] != DURATION:
        raise AdventureError("adventure_invalid_snapshot")
    try:
        size = len(json.dumps(value, allow_nan=False, separators=(",", ":")).encode("utf-8"))
    except (ValueError, RecursionError, TypeError) as exc:
        raise AdventureError("adventure_invalid_snapshot") from exc
    if size > MAX_BYTES // 2:
        raise AdventureError("adventure_invalid_snapshot")
    return copy.deepcopy(value)


class AdventureStore:
    """One writer per run; publish memory only after an atomic disk save."""

    def __init__(self, state_file: StateFile):
        self.file = state_file
        self.lock = threading.RLock()
        self.epoch = secrets.token_hex(16)
        self.owner: str | None = None
        self.error = ""
        self._legacy: dict[str, Any] | None = None
        self._legacy_version = 0
        self.state: dict[str, Any] = {
            "version": VERSION, "revision": 0, "sequence": 0, "run": None, "receipts": [],
            "economy": economy.empty_economy(),
        }
        raw, warning = state_file.load()
        if warning or (raw is None and (
            state_file.path.exists() or any(state_file.path.parent.glob("adventure.corrupt-*"))
        )):
            self.error = "adventure_recovery_required"
        elif raw is not None:
            try:
                source_version = raw.get("version") if isinstance(raw, dict) else None
                if type(source_version) is not int or source_version not in (1, 2, 3, 4, 5, 6, 7, VERSION):
                    raise AdventureError("adventure_recovery_required")
                self._validate_file(raw, version=source_version)
                migrated = copy.deepcopy(raw)
                if source_version < VERSION:
                    self._legacy = copy.deepcopy(raw)
                    self._legacy_version = source_version
                    migrated["version"] = VERSION
                    if source_version == 1:
                        migrated["economy"] = economy.empty_economy()
                    if migrated["run"] is not None and source_version == 1:
                        migrated["run"].update(loadout=economy.loadout(migrated["economy"]), settlement=None)
                    if migrated["run"] is not None and source_version < 3:
                        migrated["run"]["rules"] = 1
                self.state = migrated
            except (AdventureError, ValueError, TypeError, KeyError, RecursionError):
                self.error = "adventure_recovery_required"

    def _validate_file(self, raw: Any, *, version: int = VERSION) -> None:
        legacy = version == 1
        fields = set(self.state) - ({"economy"} if legacy else set())
        if not isinstance(raw, dict) or set(raw) != fields or (
            type(raw["version"]) is not int or raw["version"] != version
        ):
            raise AdventureError("adventure_recovery_required")
        if not legacy:
            economy.validate_economy(raw["economy"])
        if not _integer(raw["revision"], 0, 10**12) or not _integer(raw["sequence"], 0, 10**12):
            raise AdventureError("adventure_recovery_required")
        run = raw["run"]
        if run is not None:
            run_fields = {
                "id", "sequence", "character", "player_class", "companion_class", "stage_index",
                "bonus", "seed", "snapshot", "status",
            } | (set() if legacy else {"loadout", "settlement"}) | ({"rules"} if version >= 3 else set())
            if isinstance(run, dict) and run.get("rules") == 6:
                run_fields |= {"player_route", "companion_route"}
            if not isinstance(run, dict) or set(run) != run_fields:
                raise AdventureError("adventure_recovery_required")
            if not _token(run["id"]) or not _integer(run["sequence"], 1, 10**12) or run["sequence"] != raw["sequence"]:
                raise AdventureError("adventure_recovery_required")
            if not isinstance(run["character"], str) or not 1 <= len(run["character"]) <= 100:
                raise AdventureError("adventure_recovery_required")
            if run["player_class"] not in CLASSES or run["companion_class"] not in CLASSES:
                raise AdventureError("adventure_recovery_required")
            if not _integer(run["stage_index"], 0, 4) or (
                not _integer(run["bonus"], 0, 8) or run["bonus"] != run["stage_index"] * 2
            ):
                raise AdventureError("adventure_recovery_required")
            if not _token(run["seed"]) or run["status"] not in ("active", "ended"):
                raise AdventureError("adventure_recovery_required")
            if version >= 3 and (type(run["rules"]) is not int or run["rules"] not in (
                (1, 2) if version == 3 else (1, 2, 3) if version == 4 else (1, 2, 3, 4) if version == 5
                else (1, 2, 3, 4, 5) if version == 6 else (1, 2, 3, 4, 5, 6) if version == 7
                else (1, 2, 3, 4, 5, 6, 7)
            )):
                raise AdventureError("adventure_recovery_required")
            if run.get("rules") == 6 and any(
                not isinstance(run[f"{owner}_route"], str) or run[f"{owner}_route"] not in skills.ROUTES
                or skills.ROUTES[run[f"{owner}_route"]]["class"] != run[f"{owner}_class"]
                for owner in ("player", "companion")
            ):
                raise AdventureError("adventure_recovery_required")
            if run["snapshot"] is not None:
                validate_snapshot(run["snapshot"])
                if run["snapshot"]["rules"] != run.get("rules", 1):
                    raise AdventureError("adventure_recovery_required")
            if run["status"] == "ended" and (
                run["snapshot"] is None or run["snapshot"]["outcome"] == "playing"
            ):
                raise AdventureError("adventure_recovery_required")
            if run["status"] == "active" and run["snapshot"] is not None and run["snapshot"]["outcome"] != "playing":
                raise AdventureError("adventure_recovery_required")
            if not legacy:
                economy.validate_loadout(run["loadout"])
                if run["settlement"] is not None:
                    economy.validate_settlement(run["settlement"])
                    if run["status"] != "ended" or run["settlement"] != economy.settlement(run["snapshot"]):
                        raise AdventureError("adventure_recovery_required")
                    if raw["economy"]["earned"] < run["settlement"]["total"]:
                        raise AdventureError("adventure_recovery_required")
        receipts = raw["receipts"]
        if not isinstance(receipts, list) or len(receipts) > 32:
            raise AdventureError("adventure_recovery_required")
        seen: set[str] = set()
        for receipt in receipts:
            if not isinstance(receipt, dict) or set(receipt) != {"id", "signature", "result"}:
                raise AdventureError("adventure_recovery_required")
            if not _token(receipt["id"]) or receipt["id"] in seen or (
                not isinstance(receipt["signature"], str) or not re.fullmatch(r"[0-9a-f]{64}", receipt["signature"])
            ):
                raise AdventureError("adventure_recovery_required")
            seen.add(receipt["id"])
            result = receipt["result"]
            base = {"operation", "request_id", "run_id", "revision", "elapsed"}
            if not isinstance(result, dict) or not base <= set(result):
                raise AdventureError("adventure_recovery_required")
            if result["request_id"] != receipt["id"] or not _integer(result["revision"], 1, raw["revision"]):
                raise AdventureError("adventure_recovery_required")
            operation = result["operation"]
            shop = operation in ("buy", "refund")
            extra = {"transaction", "economy"} if shop else (
                {"settlement", "economy"} if "settlement" in result else set()
            )
            if set(result) != base | extra or (legacy and extra):
                raise AdventureError("adventure_recovery_required")
            if operation not in ("start", "claim", "checkpoint", "release", "finish", "buy", "refund") or (
                not (shop and result["run_id"] is None) and not _token(result["run_id"])
            ) or not _integer(result["elapsed"], 0, DURATION):
                raise AdventureError("adventure_recovery_required")
            if extra:
                economy.validate_economy(result["economy"])
            if shop:
                economy.validate_transaction(result["transaction"], operation)
                if result["economy"]["levels"][result["transaction"]["upgrade"]] != result["transaction"]["after"]:
                    raise AdventureError("adventure_recovery_required")
            elif extra:
                if operation != "finish":
                    raise AdventureError("adventure_recovery_required")
                economy.validate_settlement(result["settlement"])

    def view(self, client: str = "") -> dict[str, Any]:
        with self.lock:
            if self.error:
                raise AdventureError(self.error)
            return {
                "revision": self.state["revision"], "epoch": self.epoch, "rules": RULES,
                "run": copy.deepcopy(self.state["run"]),
                "owns_control": self.owner == client and bool(client),
                "economy": copy.deepcopy(self.state["economy"]), "shop": economy.catalog(),
            }

    def execute(
        self, operation: Any, request_id: Any, revision: Any, client: Any, epoch: Any,
        values: Any, *, character: str = "", stage_index: int = 0,
        allowed_characters: list[str] | None = None,
    ) -> dict[str, Any]:
        with self.lock:
            if self.error:
                raise AdventureError(self.error)
            if epoch != self.epoch:
                raise AdventureError("adventure_session_expired")
            if not _token(client) or not _token(request_id) or not isinstance(values, dict):
                raise AdventureError("adventure_invalid_request")
            if operation not in ("start", "claim", "checkpoint", "release", "finish", "buy", "refund"):
                raise AdventureError("adventure_invalid_request")
            if not _integer(revision, 0, 10**12):
                raise AdventureError("adventure_invalid_request")
            try:
                signature_bytes = json.dumps(
                    [operation, revision, client, values], sort_keys=True, allow_nan=False,
                    separators=(",", ":"),
                ).encode("utf-8")
                if len(signature_bytes) > MAX_BYTES:
                    raise AdventureError("adventure_invalid_request")
                signature = hashlib.sha256(signature_bytes).hexdigest()
            except (ValueError, TypeError, RecursionError) as exc:
                raise AdventureError("adventure_invalid_request") from exc
            for receipt in self.state["receipts"]:
                if receipt["id"] == request_id:
                    if receipt["signature"] != signature:
                        raise AdventureError("adventure_request_conflict")
                    # A lost response never restores a lease taken by another window.
                    return copy.deepcopy(receipt["result"])
            if revision != self.state["revision"]:
                raise AdventureError("adventure_stale")
            updated = copy.deepcopy(self.state)
            run = updated["run"]
            transaction = None
            if operation in ("buy", "refund"):
                if run is not None and run["status"] == "active":
                    raise AdventureError("adventure_shop_during_run")
                transaction = economy.trade(updated["economy"], operation, values)
            elif operation == "start":
                if run is not None and run["status"] == "active":
                    raise AdventureError("adventure_active")
                if allowed_characters is not None and character not in allowed_characters:
                    raise AdventureError("adventure_character_unknown")
                if not _integer(stage_index, 0, 4):
                    raise AdventureError("adventure_invalid_request")
                base_fields = {"player_class", "companion_class", "character"}
                allowed_fields = base_fields | {"rules"} | (
                    {"player_route", "companion_route"} if values.get("rules") == 6 else set())
                if not base_fields <= set(values) <= allowed_fields or (
                    values["player_class"] not in CLASSES or values["companion_class"] not in CLASSES
                    or values["character"] != character or not 1 <= len(character) <= 100
                    or type(values.get("rules", 1)) is not int or values.get("rules", 1) not in (1, 2, 3, 4, 5, 6, 7)
                ):
                    raise AdventureError("adventure_invalid_request")
                updated["sequence"] += 1
                run = {
                    "id": secrets.token_hex(16), "sequence": updated["sequence"],
                    "character": character, "player_class": values["player_class"],
                    "companion_class": values["companion_class"],
                    "stage_index": stage_index, "bonus": stage_index * 2,
                    "seed": secrets.token_hex(16), "snapshot": None, "status": "active",
                    "loadout": economy.loadout(updated["economy"]), "settlement": None,
                    "rules": values.get("rules", 1),
                }
                if run["rules"] == 6:
                    for owner in ("player", "companion"):
                        route = values.get(f"{owner}_route", run[f"{owner}_class"])
                        if not isinstance(route, str) or route not in skills.ROUTES or (
                            skills.ROUTES[route]["class"] != run[f"{owner}_class"]
                        ):
                            raise AdventureError("adventure_invalid_request")
                        run[f"{owner}_route"] = route
                updated["run"] = run
            else:
                if run is None or run["status"] != "active" or values.get("run_id") != run["id"]:
                    raise AdventureError("adventure_run_closed")
                if operation == "claim":
                    if set(values) != {"run_id", "takeover"} or type(values["takeover"]) is not bool:
                        raise AdventureError("adventure_invalid_request")
                    if self.owner not in (None, client) and not values["takeover"]:
                        raise AdventureError("adventure_controlled_elsewhere")
                else:
                    if self.owner != client:
                        raise AdventureError("adventure_control_lost")
                    if set(values) != {"run_id", "snapshot"}:
                        raise AdventureError("adventure_invalid_request")
                    snapshot = validate_snapshot(values["snapshot"])
                    if snapshot["rules"] != run["rules"]:
                        raise AdventureError("adventure_rules_unsupported")
                    previous = run["snapshot"]
                    if previous and (snapshot["elapsed"] < previous["elapsed"] or snapshot["kills"] < previous["kills"]):
                        raise AdventureError("adventure_stale")
                    if (operation in ("checkpoint", "release")) != (snapshot["outcome"] == "playing"):
                        raise AdventureError("adventure_invalid_request")
                    run["snapshot"] = snapshot
                    if operation == "finish":
                        run["status"] = "ended"
                        run["settlement"] = economy.settlement(snapshot)
                        economy.award(updated["economy"], run["settlement"])
            updated["revision"] += 1
            result = {
                "operation": operation, "request_id": request_id, "run_id": run["id"] if run else None,
                "revision": updated["revision"],
                "elapsed": run["snapshot"]["elapsed"] if run and run["snapshot"] else 0,
            }
            if transaction is not None:
                result.update(transaction=transaction, economy=copy.deepcopy(updated["economy"]))
            elif operation == "finish":
                result.update(settlement=copy.deepcopy(run["settlement"]), economy=copy.deepcopy(updated["economy"]))
            updated["receipts"].append({"id": request_id, "signature": signature, "result": result})
            updated["receipts"] = updated["receipts"][-32:]
            if self._legacy is not None:
                backup = self.file.path.with_name(f"adventure.v{self._legacy_version}-{secrets.token_hex(8)}.backup.json")
                StateFile(backup, max_bytes=MAX_BYTES).save(self._legacy)
                self._legacy = None
            self.file.save(updated)
            self.state = updated
            if transaction is None:
                self.owner = None if operation in ("finish", "release") else client
            return copy.deepcopy(result)
