"""Pure adventure rewards and permanent upgrades, separate from gift coins."""

from __future__ import annotations

import copy
from typing import Any

MAX_COINS = 10**12
PRICES = (40, 80, 120, 180, 260)
PRODUCTS = {
    "vitality": {"name": "生命储备", "scope": "玩家", "percent": 4, "cap": 5},
    "power": {"name": "武艺研习", "scope": "双方攻击", "percent": 2, "cap": 5},
    "stride": {"name": "远行步伐", "scope": "玩家移动", "percent": 2, "cap": 3},
    "reach": {"name": "魔力牵引", "scope": "共同拾取", "percent": 6, "cap": 5},
}


class AdventureError(ValueError):
    pass


def _integer(value: Any, minimum: int, maximum: int) -> bool:
    return type(value) is int and minimum <= value <= maximum


def empty_economy() -> dict[str, Any]:
    return {"balance": 0, "earned": 0, "levels": dict.fromkeys(PRODUCTS, 0)}


def validate_levels(levels: Any) -> None:
    if not isinstance(levels, dict) or set(levels) != set(PRODUCTS) or any(
        not _integer(levels[key], 0, spec["cap"]) for key, spec in PRODUCTS.items()
    ):
        raise AdventureError("adventure_invalid_economy")


def invested(levels: dict[str, int]) -> int:
    return sum(sum(PRICES[:level]) for level in levels.values())


def validate_economy(value: Any) -> None:
    if not isinstance(value, dict) or set(value) != {"balance", "earned", "levels"}:
        raise AdventureError("adventure_invalid_economy")
    validate_levels(value["levels"])
    if not _integer(value["balance"], 0, MAX_COINS) or not _integer(value["earned"], 0, MAX_COINS):
        raise AdventureError("adventure_invalid_economy")
    if value["balance"] + invested(value["levels"]) != value["earned"]:
        raise AdventureError("adventure_invalid_economy")


def loadout(economy: dict[str, Any]) -> dict[str, Any]:
    levels = copy.deepcopy(economy["levels"])
    return {
        "levels": levels,
        "bonuses": {key: levels[key] * spec["percent"] for key, spec in PRODUCTS.items()},
    }


def validate_loadout(value: Any) -> None:
    if not isinstance(value, dict) or set(value) != {"levels", "bonuses"}:
        raise AdventureError("adventure_invalid_economy")
    validate_levels(value["levels"])
    expected = loadout({"levels": value["levels"]})["bonuses"]
    if not isinstance(value["bonuses"], dict) or set(value["bonuses"]) != set(PRODUCTS) or any(
        type(value["bonuses"][key]) is not int or value["bonuses"][key] != amount
        for key, amount in expected.items()
    ):
        raise AdventureError("adventure_invalid_economy")


def catalog() -> list[dict[str, Any]]:
    return [{"id": key, **spec, "prices": list(PRICES[:spec["cap"]])} for key, spec in PRODUCTS.items()]


def settlement(snapshot: dict[str, Any]) -> dict[str, int]:
    minutes = snapshot["elapsed"] // 60000
    survival = minutes * 6
    clear = 80 if snapshot["outcome"] == "cleared" else 0
    return {"formula": 1, "minutes": minutes, "survival": survival, "clear": clear, "total": survival + clear}


def validate_settlement(value: Any) -> None:
    if not isinstance(value, dict) or set(value) != {"formula", "minutes", "survival", "clear", "total"}:
        raise AdventureError("adventure_invalid_economy")
    if any(type(item) is not int for item in value.values()) or (
        value["formula"] != 1 or not 0 <= value["minutes"] <= 20
        or value["survival"] != value["minutes"] * 6
        or value["clear"] not in (0, 80)
        or (value["clear"] and value["minutes"] < 18)
        or value["total"] != value["survival"] + value["clear"]
    ):
        raise AdventureError("adventure_invalid_economy")


def award(economy: dict[str, Any], result: dict[str, int]) -> None:
    if economy["earned"] + result["total"] > MAX_COINS:
        raise AdventureError("adventure_economy_limit")
    economy["earned"] += result["total"]
    economy["balance"] += result["total"]


def validate_transaction(value: Any, operation: str) -> None:
    if not isinstance(value, dict) or set(value) != {"upgrade", "before", "after", "amount"}:
        raise AdventureError("adventure_invalid_economy")
    key = value["upgrade"]
    if not isinstance(key, str) or key not in PRODUCTS:
        raise AdventureError("adventure_invalid_economy")
    cap = PRODUCTS[key]["cap"]
    if not _integer(value["before"], 0, cap) or not _integer(value["after"], 0, cap):
        raise AdventureError("adventure_invalid_economy")
    direction = 1 if operation == "buy" else -1
    if value["after"] != value["before"] + direction:
        raise AdventureError("adventure_invalid_economy")
    price = PRICES[min(value["before"], value["after"])]
    if type(value["amount"]) is not int or value["amount"] != price:
        raise AdventureError("adventure_invalid_economy")


def trade(economy: dict[str, Any], operation: str, values: dict[str, Any]) -> dict[str, Any]:
    if set(values) != {"upgrade", "level"}:
        raise AdventureError("adventure_invalid_request")
    key = values["upgrade"]
    if not isinstance(key, str) or key not in PRODUCTS or type(values["level"]) is not int:
        raise AdventureError("adventure_invalid_request")
    before = economy["levels"][key]
    if values["level"] != before:
        raise AdventureError("adventure_stale")
    if operation == "buy":
        if before >= PRODUCTS[key]["cap"]:
            raise AdventureError("adventure_upgrade_maxed")
        amount = PRICES[before]
        if economy["balance"] < amount:
            raise AdventureError("adventure_insufficient_coins")
        after = before + 1
        economy["balance"] -= amount
    else:
        if before == 0:
            raise AdventureError("adventure_nothing_to_refund")
        amount = PRICES[before - 1]
        after = before - 1
        economy["balance"] += amount
    economy["levels"][key] = after
    return {"upgrade": key, "before": before, "after": after, "amount": amount}
