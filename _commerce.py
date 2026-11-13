"""Cross-domain shop settlement; the caller owns locking, rollback and saving.

No SDK, I/O, clock reads, scoring invalidation or character messages belong here.
Replay is checked before current eligibility so an acknowledged transaction can
still be retrieved after the relationship or date changes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from . import _engine as engine
from . import _shop as shop


@dataclass(frozen=True)
class Settlement:
    result: dict[str, Any]
    replayed: bool = False


def settle(
    state: dict[str, Any], action: str, request_id: Any, revision: Any,
    item_id: Any = "", character: Any = "", *, expected_gain: Any = None,
    relationship_revision: Any = None, gesture: Any = False,
    reward: Any = "", period: Any = "", now: float, today: str, gate: bool,
) -> Settlement:
    if action not in {"claim", "buy", "gift"}:
        raise shop.ShopError("shop_invalid_request")
    signature = [action, item_id, character]
    if action == "claim" and (reward != "" or period != ""):
        signature.extend([reward, period])
    if action == "gift" and (expected_gain is not None or relationship_revision is not None or gesture is not False):
        signature.extend([expected_gain, relationship_revision, gesture])
    economy = state["shop"]
    previous = shop.replay(economy, request_id, revision, signature)
    if previous is not None:
        return Settlement(previous, replayed=True)
    if action == "claim":
        result = shop.claim(economy, today, reward, period, now)
    elif action == "buy":
        result = shop.buy(economy, item_id, now, request_id)
    else:
        result = _give(
            state, request_id, item_id, character, expected_gain=expected_gain,
            relationship_revision=relationship_revision, gesture=gesture, now=now, today=today, gate=gate,
        )
    shop.commit(economy, request_id, revision, signature, result)
    return Settlement(result)


def _give(
    state: dict[str, Any], request_id: str, item_id: Any, character: Any, *,
    expected_gain: Any, relationship_revision: Any, gesture: Any, now: float, today: str, gate: bool,
) -> dict[str, Any]:
    product = shop.item(item_id)
    economy = state["shop"]
    known = set(state["known_characters"])
    known.add(state["current_character"])
    if not isinstance(character, str) or not character or character not in known:
        raise shop.ShopError("shop_unknown_character")
    if economy["inventory"].get(item_id, 0) <= 0:
        raise shop.ShopError("shop_no_stock")
    room = shop.gift_room(economy, today)
    if not gesture and room <= 0:
        raise shop.ShopError("shop_daily_limit")
    scope = engine.scope_key_for(state, character)
    record = engine.get_record(state, scope)
    if record is None:
        raise shop.ShopError("shop_unknown_character")
    if type(gesture) is not bool or type(expected_gain) is not int or type(relationship_revision) is not int:
        raise shop.ShopError("shop_invalid_request")
    actual = 0 if gesture else min(product["gain"], room, engine.gain_room(record, "gift", now),
                                   100 - record["affection"])
    if relationship_revision != record.get("gain_revision", 0) or expected_gain != actual:
        raise shop.ShopError("shop_gain_changed")
    if gesture and not shop.gesture_room(economy, today):
        raise shop.ShopError("shop_gesture_limit")
    if not gesture and actual <= 0:
        raise shop.ShopError("shop_no_affection_room")
    if gesture:
        result = {"applied": 0, "affection": record["affection"], "stage": record["stage"],
                  "previous_stage": record["stage"], "stage_changed": False}
    else:
        result = engine.apply_model_delta(
            record, actual, f"gift:{item_id}", gate=gate, cooldown=0, source="gift", now=now,
        )
    engine.mark_active(record, now)
    gift = shop.record_gift(economy, request_id, item_id, character, result["applied"], now, today, gesture=gesture)
    result.update(gift_id=gift["id"], item_id=item_id, character=character, scope=scope)
    return result
