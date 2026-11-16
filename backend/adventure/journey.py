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


def validate(value: dict) -> None:
    journey = value["journey"]
    _check(isinstance(journey, dict) and set(journey) == FIELDS)
    _check(_int(journey["node"], 0, LAST) and journey["phase"] in ("fight", "doors"))
    index, fighting = journey["node"], journey["phase"] == "fight"
    rules = value["rules"]
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
        _check(1 <= len(doors) <= 3 and sum(1 for door in doors if isinstance(door, dict) and door.get("hard")) <= 1)
        for door in doors:
            _check(isinstance(door, dict) and set(door) == {"goal", "reward", "hard", "need"})
            _door(index + 1, door, rules)
        _check(len(doors) == (1 if NODES[index + 1]["type"] != "fight" else 2 + (index + 1 >= hard_from(rules))))
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


def cleared(snapshot: dict) -> int:
    journey = snapshot["journey"]
    return len(NODES) if snapshot["outcome"] == "cleared" else journey["node"] + (journey["phase"] == "doors")


def settlement(snapshot: dict) -> dict[str, int]:
    done, coins = NODES[:cleared(snapshot)], DATA["coins"]
    hard = snapshot["journey"]["hard_cleared"]
    journey = (sum(node["type"] == "fight" for node in done) * coins["fight"] + hard * coins["hard"]
               + sum(node["type"] == "elite" for node in done) * coins["elite"])
    clear = coins["clear"] if snapshot["outcome"] == "cleared" else 0
    return {"formula": 2, "nodes": len(done), "hard": hard, "journey": journey, "clear": clear,
            "total": journey + clear}
