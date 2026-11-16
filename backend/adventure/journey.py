"""Rule 8 journey: nine nodes, a goal per node and a choice of doors between them."""

from __future__ import annotations

import json
from typing import Any

from ..paths import STATIC_ROOT
from .economy import AdventureError

DATA = json.loads((STATIC_ROOT / "journey.json").read_text(encoding="utf-8"))
NODES = DATA["nodes"]
AREAS = {area["id"]: area for area in DATA["areas"]}
LAST = len(NODES) - 1
FIELDS = {"node", "phase", "goal", "reward", "hard", "need", "started_at", "kills_at", "doors", "hard_cleared"}
STOPS = json.loads((STATIC_ROOT / "stops.json").read_text(encoding="utf-8"))
STOP_FIELDS = {"shards", "boon", "charm", "vigor", "stop"}
STOP_KINDS = ("camp", "shop", "event")
EVENTS = {event["id"] for event in STOPS["events"]}


def _check(condition: bool) -> None:
    if not condition:
        raise AdventureError("adventure_invalid_snapshot")


def _int(value: Any, low: int, high: int) -> bool:
    return type(value) is int and low <= value <= high


def hard_from(rules: int) -> int:
    """Rule 12 opens the hard door from the second node on."""
    return 1 if rules >= 12 else DATA["hard"]["from"]


def _door(index: int, door: Any, rules: int) -> None:
    """A door (or the node being fought) must be one the node at index can offer."""
    spec = NODES[index]
    _check(isinstance(door, dict) and all(key in door for key in ("goal", "reward", "hard", "need")))
    _check(isinstance(door["goal"], str) and isinstance(door["reward"], str) and type(door["hard"]) is bool)
    if spec["type"] != "fight":
        _check(door["goal"] == spec["type"] and door["reward"] == "" and not door["hard"] and door["need"] == 0)
        return
    _check(door["goal"] in ("hold", "clear") and door["reward"] in DATA["rewards"])
    _check(not door["hard"] or index >= hard_from(rules))
    expected = DATA["goals"]["hold"]["need"] if door["goal"] == "hold" else AREAS[spec["area"]]["clear"]
    _check(type(door["need"]) is int and door["need"] == expected)


def _stop_door(door: Any) -> bool:
    return isinstance(door, dict) and door.get("goal") == "stop"


def _stops(value: dict, journey: dict, index: int) -> None:
    """Rule 14: shards, a pending boon, the charm, extra vitality and the stop being visited."""
    _check(_int(journey["shards"], 0, STOPS["shards"]["cap"]) and journey["boon"] in ("", "power", "bounty"))
    _check(type(journey["charm"]) is bool and _int(journey["vigor"], 0, STOPS["vigor"]["cap"])
           and journey["vigor"] % STOPS["vigor"]["step"] == 0)
    stop = journey["stop"]
    if journey["phase"] != "stop":
        _check(stop is None)
        return
    _check(index + 1 in STOPS["at"] and not value["enemies"] and not value["foes"] and not value["threats"])
    _check(not value["choices"] and value["outcome"] == "playing")
    _check(isinstance(stop, dict) and set(stop) == {"kind", "offer", "bought"} and stop["kind"] in STOP_KINDS)
    offer, bought = stop["offer"], stop["bought"]
    _check(isinstance(offer, list) and isinstance(bought, list) and all(isinstance(item, str) for item in offer + bought))
    if stop["kind"] == "shop":
        _check(len(offer) == 3 and len(set(offer)) == 3 and all(item in STOPS["items"] for item in offer))
        _check(len(set(bought)) == len(bought) and set(bought) <= set(offer))
    elif stop["kind"] == "event":
        _check(len(offer) == 1 and offer[0] in EVENTS and not bought)
    else:
        _check(not offer and not bought)


def validate(value: dict) -> None:
    journey = value["journey"]
    rules = value["rules"]
    stops = rules >= 14
    _check(isinstance(journey, dict) and set(journey) == FIELDS | (STOP_FIELDS if stops else set()))
    _check(_int(journey["node"], 0, LAST) and journey["phase"] in (("fight", "doors", "stop") if stops else ("fight", "doors")))
    index, fighting = journey["node"], journey["phase"] == "fight"
    _door(index, journey, rules)
    if index == 0:
        _check(journey["goal"] == "hold" and journey["reward"] == "study" and not journey["hard"])
    _check(_int(journey["started_at"], 0, value["elapsed"]) and _int(journey["kills_at"], 0, value["kills"]))
    fights = sum(node["type"] == "fight" and at >= hard_from(rules) for at, node in enumerate(NODES[:index + 1]))
    _check(_int(journey["hard_cleared"], 0, fights))
    doors = journey["doors"]
    _check(isinstance(doors, list))
    if fighting:
        _check(not doors)
    else:
        # A cleared node leaves an empty field behind it; the last node ends the run instead.
        _check(index < LAST and not value["enemies"] and not value["foes"] and not value["threats"])
        _check(1 <= len(doors) <= 4 and sum(1 for door in doors if isinstance(door, dict) and door.get("hard")) <= 1)
        # Rule 14 adds one stop door where an area's first fight ends; it is removed once taken.
        stop_doors = [door for door in doors if _stop_door(door)]
        _check(not stop_doors or stops and index + 1 in STOPS["at"] and len(stop_doors) == 1
               and journey["phase"] == "doors")
        for door in doors:
            _check(isinstance(door, dict) and set(door) == {"goal", "reward", "hard", "need"})
            if _stop_door(door):
                _check(door["reward"] in STOP_KINDS and door["hard"] is False and door["need"] == 0)
            else:
                _door(index + 1, door, rules)
        base = 1 if NODES[index + 1]["type"] != "fight" else 2 + (index + 1 >= hard_from(rules))
        _check(len(doors) == base + len(stop_doors))
    if stops:
        _stops(value, journey, index)
    marks = value["encounters"]["milestones"]
    for at, node in enumerate(NODES):
        foe = node.get("foe")
        if foe not in marks:
            continue
        mark = marks[foe]
        if index < at:
            _check(not mark["spawned"])
        elif index > at or not fighting:
            _check(mark["defeated"])
        else:
            _check(mark["spawned"])
    _check(value["boss_spawned"] == (index == LAST))
    if value["outcome"] == "cleared":
        _check(index == LAST and fighting)


PILLARS = ("column-0", "column-1", "column-2", "column-3")
PILLAR_HP = 160


def validate_terrain(value: dict) -> None:
    """Rule 16: broken pillars and pillar wear, only in a ruin lane arena."""
    terrain = value["terrain"]
    _check(isinstance(terrain, dict) and set(terrain) == {"broken", "wear"})
    broken, wear = terrain["broken"], terrain["wear"]
    _check(isinstance(broken, list) and len(set(broken)) == len(broken) and all(isinstance(i, str) and i in PILLARS for i in broken))
    _check(isinstance(wear, dict) and all(key in PILLARS and key not in broken and _int(amount, 1, PILLAR_HP - 1)
                                          for key, amount in wear.items()))
    node = NODES[value["journey"]["node"]]
    _check(not broken and not wear or node["area"] == "ruin" and node["arena"] == "lanes" and node["type"] != "boss")


def cleared(snapshot: dict) -> int:
    journey = snapshot["journey"]
    return len(NODES) if snapshot["outcome"] == "cleared" else journey["node"] + (journey["phase"] != "fight")


def settlement(snapshot: dict) -> dict[str, int]:
    done, coins = NODES[:cleared(snapshot)], DATA["coins"]
    hard = snapshot["journey"]["hard_cleared"]
    journey = (sum(node["type"] == "fight" for node in done) * coins["fight"] + hard * coins["hard"]
               + sum(node["type"] == "elite" for node in done) * coins["elite"])
    clear = coins["clear"] if snapshot["outcome"] == "cleared" else 0
    return {"formula": 2, "nodes": len(done), "hard": hard, "journey": journey, "clear": clear,
            "total": journey + clear}
