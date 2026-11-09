"""Virtual shop rules. The caller commits economy and affection in one transaction."""

from __future__ import annotations

import copy
import math
import re
from datetime import date, datetime, timedelta
from typing import Any

WELCOME_COINS = 100
ECONOMY_VERSION = 2
DAILY_COINS = 30
DAILY_GIFT_GAIN = 4
INCOME_STEPS = (1, 3, 8)
STEP_COINS = 10
WEEKLY_DAYS = 4
WEEKLY_COINS = 40
INTERACTION_GAP = 20
LEDGER_LIMIT = 100
INVENTORY_LIMIT = 99
HISTORY_LIMIT = 50
RECEIPT_LIMIT = 64
REACTION_TIMEOUT = 120
REACTION_COOLDOWN = 30
REACTION_ATTEMPTS = 3
CATALOG = (
    {"id": "tea", "name": "暖心红茶", "price": 20, "gain": 1, "icon": "Coffee"},
    {"id": "cake", "name": "草莓蛋糕", "price": 40, "gain": 2, "icon": "CakeSlice"},
    {"id": "chocolate", "name": "手作巧克力", "price": 40, "gain": 2, "icon": "Candy"},
    {"id": "flowers", "name": "当季花束", "price": 60, "gain": 3, "icon": "Flower2"},
    {"id": "book", "name": "精装故事集", "price": 60, "gain": 3, "icon": "BookOpen"},
    {"id": "plush", "name": "柔软玩偶", "price": 80, "gain": 4, "icon": "Gift"},
)
ITEMS = {item["id"]: item for item in CATALOG}
_TOKEN = re.compile(r"[a-zA-Z0-9_-]{12,80}\Z")
REACTION_STATES = {"pending", "submitted", "received", "unavailable", "unknown"}


class ShopError(ValueError):
    pass


def _integer(value: Any, default: int = 0, maximum: int = 1_000_000_000) -> int:
    return max(0, min(maximum, value)) if type(value) is int else default


def _day(value: Any) -> str:
    try:
        return date.fromisoformat(value).isoformat() if isinstance(value, str) else ""
    except ValueError:
        return ""


def _timestamp(value: Any) -> float:
    return float(value) if type(value) in (int, float) and math.isfinite(value) and value > 0 else 0.0


def new_state() -> dict[str, Any]:
    return {
        "economy_version": ECONOMY_VERSION, "highest_day": "", "days": {}, "weeks": {},
        "ledger": [], "gesture_day": "", "income_total": 0,
        "coins": WELCOME_COINS, "revision": 0, "claimed_day": "",
        "gift_day": "", "gift_gain": 0, "inventory": {}, "history": [], "receipts": [],
    }


def normalize(raw: Any, today: str | None = None) -> dict[str, Any]:
    result = new_state()
    if not isinstance(raw, dict) or not raw:
        return result
    result.update(
        coins=_integer(raw.get("coins")),
        revision=_integer(raw.get("revision")),
        claimed_day=_day(raw.get("claimed_day")),
        gift_day=_day(raw.get("gift_day")),
        gift_gain=_integer(raw.get("gift_gain"), maximum=DAILY_GIFT_GAIN),
    )
    inventory = raw.get("inventory")
    if isinstance(inventory, dict):
        result["inventory"] = {key: _integer(value, maximum=INVENTORY_LIMIT)
                               for key, value in inventory.items() if key in ITEMS}
    history = raw.get("history")
    if isinstance(history, list):
        seen: set[str] = set()
        for entry in history[-HISTORY_LIMIT:]:
            if not isinstance(entry, dict):
                continue
            item_id, gift_id, target = entry.get("item_id"), entry.get("id"), entry.get("character")
            if (
                not isinstance(item_id, str) or item_id not in ITEMS
                or not isinstance(gift_id, str) or not _TOKEN.fullmatch(gift_id) or gift_id in seen
                or not isinstance(target, str) or not target or len(target) > 100
                or not _timestamp(entry.get("ts"))
            ):
                continue
            seen.add(gift_id)
            reaction = entry.get("reaction")
            result["history"].append({
                "id": gift_id, "item_id": item_id, "character": target, "ts": _timestamp(entry.get("ts")),
                "applied": _integer(entry.get("applied"), maximum=4),
                "reaction": reaction if isinstance(reaction, str) and reaction in REACTION_STATES else "unknown",
                "attempts": _integer(entry.get("attempts"), maximum=REACTION_ATTEMPTS),
                "requested_at": _timestamp(entry.get("requested_at")),
            })
    receipts = raw.get("receipts")
    if isinstance(receipts, list):
        result["receipts"] = [
            copy.deepcopy(entry) for entry in receipts[-RECEIPT_LIMIT:]
            if isinstance(entry, dict) and isinstance(entry.get("id"), str)
            and _TOKEN.fullmatch(entry["id"]) and isinstance(entry.get("signature"), list)
            and isinstance(entry.get("result"), dict)
        ]
    result["highest_day"] = max(_day(raw.get("highest_day")), result["claimed_day"], result["gift_day"])
    result["gesture_day"] = _day(raw.get("gesture_day"))
    result["highest_day"] = max(result["highest_day"], result["gesture_day"])
    result["income_total"] = _integer(raw.get("income_total"))
    days = raw.get("days")
    if isinstance(days, dict):
        for day_key in sorted(key for key in days if _day(key))[-2:]:
            entry = days[day_key]
            if not isinstance(entry, dict):
                continue
            result["days"][day_key] = {
                "count": _integer(entry.get("count"), maximum=8),
                "paid": _integer(entry.get("paid"), maximum=3),
                "earned": _integer(entry.get("earned"), maximum=DAILY_COINS),
                "last_at": _timestamp(entry.get("last_at")),
                "times": [_timestamp(value) for value in entry.get("times", [])[-8:] if _timestamp(value)]
                if isinstance(entry.get("times"), list) else ([_timestamp(entry["last_at"])] if _timestamp(entry.get("last_at")) else []),
                "texts": _digests(entry.get("texts")), "events": _digests(entry.get("events")),
            }
            result["highest_day"] = max(result["highest_day"], day_key)
    weeks = raw.get("weeks")
    if isinstance(weeks, dict):
        for week in sorted(key for key in weeks if _day(key) and _week(key) == key)[-2:]:
            entry = weeks[week]
            if isinstance(entry, dict):
                active = entry.get("days", [])
                result["weeks"][week] = {
                    "days": sorted({key for key in active if _day(key) and _week(key) == week})[:7]
                    if isinstance(active, list) else [],
                    "paid": entry.get("paid") is True,
                }
    ledger = raw.get("ledger")
    if isinstance(ledger, list):
        result["ledger"] = [
            {"id": entry["id"], "source": entry["source"], "amount": entry["amount"],
             "balance": _integer(entry.get("balance")), "ts": _timestamp(entry.get("ts")),
             "item_id": entry.get("item_id") if isinstance(entry.get("item_id"), str) and entry["item_id"] in ITEMS else "",
             "day": _day(entry.get("day"))}
            for entry in ledger[-LEDGER_LIMIT:]
            if isinstance(entry, dict) and isinstance(entry.get("id"), str)
            and isinstance(entry.get("source"), str)
            and entry["source"] in {"daily_1", "daily_3", "daily_8", "weekly", "purchase"}
            and type(entry.get("amount")) is int and _timestamp(entry.get("ts"))
        ]
    if raw.get("economy_version") != ECONOMY_VERSION:
        day = today or date.today().isoformat()
        if result["claimed_day"] >= day:
            result["days"][result["claimed_day"]] = _new_day(paid=3)
        result["revision"] += 1
    return result


def _digests(raw: Any) -> list[str]:
    return [value for value in raw[-8:] if isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value)] \
        if isinstance(raw, list) else []


def _week(day: str) -> str:
    value = date.fromisoformat(day)
    return (value - timedelta(days=value.weekday())).isoformat()


def _new_day(*, paid: int = 0) -> dict[str, Any]:
    return {"count": 0, "paid": paid, "earned": paid * STEP_COINS,
            "last_at": 0, "times": [], "texts": [], "events": []}


def _ledger(economy: dict[str, Any], key: str, source: str, amount: int, now: float,
            day: str, item_id: str = "") -> None:
    economy["ledger"].append({
        "id": key, "source": source, "amount": amount, "balance": economy["coins"],
        "ts": now, "day": day, "item_id": item_id,
    })
    del economy["ledger"][:-LEDGER_LIMIT]


def accrue(economy: dict[str, Any], event: dict[str, Any], now: float) -> int:
    """One observed normal exchange; persist progress and credit together."""
    today = datetime.fromtimestamp(now).date()
    today_key = today.isoformat()
    if economy["highest_day"] > today_key:
        return 0
    user_at, reply_at = event["user_at"], event["reply_at"]
    if not (0 < user_at <= reply_at <= now + 5):
        return 0
    day = datetime.fromtimestamp(user_at).date().isoformat()
    if not (today - timedelta(days=1)).isoformat() <= day <= today_key:
        return 0
    economy["highest_day"] = max(economy["highest_day"], today_key)
    for old in list(economy["days"]):
        if old < (today - timedelta(days=1)).isoformat():
            del economy["days"][old]
    progress = economy["days"].setdefault(day, _new_day())
    if (
        progress["count"] >= 8 or event["id"] in progress["events"] or event["text"] in progress["texts"]
        or any(abs(user_at - timestamp) < INTERACTION_GAP
               for entry in economy["days"].values() for timestamp in entry["times"])
    ):
        return 0
    progress["count"] += 1
    progress["last_at"] = max(progress["last_at"], user_at)
    progress["times"].append(user_at)
    progress["texts"].append(event["text"])
    progress["events"].append(event["id"])
    before = economy["coins"]
    for index, threshold in enumerate(INCOME_STEPS, 1):
        if progress["count"] >= threshold and progress["paid"] < index:
            old = economy["coins"]
            economy["coins"] = min(1_000_000_000, old + STEP_COINS)
            progress["paid"] = index
            progress["earned"] += economy["coins"] - old
            _ledger(economy, f"{event['id']}:{threshold}", f"daily_{threshold}",
                    economy["coins"] - old, now, day)
    week_key = _week(day)
    current_week = date.fromisoformat(_week(today_key))
    for old in list(economy["weeks"]):
        if old < (current_week - timedelta(days=7)).isoformat():
            del economy["weeks"][old]
    week = economy["weeks"].setdefault(week_key, {"days": [], "paid": False})
    if progress["count"] >= 3 and day not in week["days"]:
        week["days"].append(day)
        week["days"].sort()
    if len(week["days"]) >= WEEKLY_DAYS and not week["paid"]:
        old = economy["coins"]
        economy["coins"] = min(1_000_000_000, old + WEEKLY_COINS)
        week["paid"] = True
        _ledger(economy, f"week:{week_key}", "weekly", economy["coins"] - old, now, day)
    credited = economy["coins"] - before
    economy["income_total"] += credited
    economy["revision"] += 1
    return credited


def item(item_id: Any) -> dict[str, Any]:
    if not isinstance(item_id, str) or item_id not in ITEMS:
        raise ShopError("shop_item_not_found")
    return ITEMS[item_id]


def replay(economy: dict[str, Any], request_id: Any, revision: Any, signature: list[Any]) -> dict[str, Any] | None:
    if not isinstance(request_id, str) or not _TOKEN.fullmatch(request_id) or type(revision) is not int or revision < 0:
        raise ShopError("shop_invalid_request")
    expected = [revision, *signature]
    for receipt in economy["receipts"]:
        if receipt["id"] == request_id:
            if receipt["signature"] != expected:
                raise ShopError("shop_invalid_request")
            return copy.deepcopy(receipt["result"])
    # An evicted request still cannot run again using its old revision.
    if revision != economy["revision"]:
        raise ShopError("shop_stale")
    return None


def commit(economy: dict[str, Any], request_id: str, revision: int, signature: list[Any], result: dict[str, Any]) -> None:
    economy["revision"] += 1
    economy["receipts"].append({"id": request_id, "signature": [revision, *signature], "result": copy.deepcopy(result)})
    del economy["receipts"][:-RECEIPT_LIMIT]


def claim(economy: dict[str, Any], today: str) -> dict[str, Any]:
    # Retained entry point can replay old receipts, but cannot mint new money.
    raise ShopError("shop_income_automatic")


def buy(economy: dict[str, Any], item_id: Any, now: float | None = None, request_id: str = "") -> dict[str, Any]:
    product = item(item_id)
    count = economy["inventory"].get(product["id"], 0)
    if count >= INVENTORY_LIMIT:
        raise ShopError("shop_inventory_full")
    if economy["coins"] < product["price"]:
        raise ShopError("shop_insufficient_coins")
    economy["coins"] -= product["price"]
    economy["inventory"][product["id"]] = count + 1
    if now is not None:
        economy["highest_day"] = max(economy["highest_day"], datetime.fromtimestamp(now).date().isoformat())
        _ledger(economy, request_id, "purchase", -product["price"], now,
                datetime.fromtimestamp(now).date().isoformat(), product["id"])
    return {"item_id": product["id"], "coins": economy["coins"], "quantity": count + 1}


def gift_room(economy: dict[str, Any], today: str) -> int:
    # A clock rollback must not provide another daily allowance.
    if economy["highest_day"] > today:
        return 0
    used = economy["gift_gain"] if economy["gift_day"] >= today else 0
    return max(0, DAILY_GIFT_GAIN - used)


def gesture_room(economy: dict[str, Any], today: str) -> bool:
    return max(economy["gesture_day"], economy["highest_day"]) <= today and economy["gesture_day"] < today


def record_gift(economy: dict[str, Any], gift_id: str, item_id: str, character: str,
                applied: int, now: float, today: str, *, gesture: bool = False) -> dict[str, Any]:
    if economy["inventory"].get(item_id, 0) <= 0:
        raise ShopError("shop_no_stock")
    if gesture and not gesture_room(economy, today):
        raise ShopError("shop_gesture_limit")
    economy["inventory"][item_id] -= 1
    economy["highest_day"] = max(economy["highest_day"], today)
    if gesture:
        economy["gesture_day"] = today
    if economy["gift_day"] < today:
        economy.update(gift_day=today, gift_gain=0)
    economy["gift_gain"] += applied
    entry = {
        "id": gift_id, "item_id": item_id, "character": character, "applied": applied, "ts": now,
        "reaction": "pending", "attempts": 0, "requested_at": 0,
    }
    economy["history"].append(entry)
    del economy["history"][:-HISTORY_LIMIT]
    return entry


def find_gift(economy: dict[str, Any], gift_id: Any) -> dict[str, Any]:
    for entry in economy["history"]:
        if entry["id"] == gift_id:
            return entry
    raise ShopError("shop_gift_not_found")


def view(economy: dict[str, Any], today: str, now: float) -> dict[str, Any]:
    history = copy.deepcopy(list(reversed(economy["history"])))
    for entry in history:
        if entry["reaction"] in {"pending", "submitted"} and now - entry["requested_at"] >= REACTION_TIMEOUT:
            entry["reaction"] = "unknown"
        entry["can_retry"] = (
            entry["reaction"] in {"unknown", "unavailable"} and entry["attempts"] < REACTION_ATTEMPTS
            and now - entry["requested_at"] >= (REACTION_TIMEOUT if entry["reaction"] == "unknown" else REACTION_COOLDOWN)
        )
    return {
        "coins": economy["coins"], "revision": economy["revision"],
        "daily_coins": DAILY_COINS, "can_claim": False,
        "income_total": economy["income_total"],
        "income": {
            "count": economy["days"].get(today, {}).get("count", 0),
            "earned": economy["days"].get(today, {}).get("earned", 0),
            "steps": [{"turns": threshold, "coins": STEP_COINS} for threshold in INCOME_STEPS],
            "paid": economy["days"].get(today, {}).get("paid", 0),
            "weekly_days": len(economy["weeks"].get(_week(today), {}).get("days", [])),
            "weekly_goal": WEEKLY_DAYS, "weekly_coins": WEEKLY_COINS,
            "weekly_paid": economy["weeks"].get(_week(today), {}).get("paid", False),
            "legacy_claimed": economy["claimed_day"] == today,
            "clock_error": economy["highest_day"] > today,
        },
        "can_gesture": gesture_room(economy, today),
        "ledger": list(reversed(copy.deepcopy(economy["ledger"]))),
        "gift_remaining": gift_room(economy, today), "gift_daily_cap": DAILY_GIFT_GAIN,
        "inventory_limit": INVENTORY_LIMIT,
        "catalog": [dict(product, quantity=economy["inventory"].get(product["id"], 0)) for product in CATALOG],
        "history": history,
    }
