"""Bounded versioned builds and effects; catalogs contain no executable code."""

from __future__ import annotations

import copy
import json
import math
from pathlib import Path
from typing import Any

from ._adventure_economy import AdventureError

def _catalog(filename: str) -> dict:
    return {item["id"]: item for item in json.loads(
        (Path(__file__).parent / "static" / filename).read_text(encoding="utf-8")
    )}


CATALOG = _catalog("skills-v2.json")
CATALOGS = {2: CATALOG, 3: _catalog("skills.json")}
TALENTS = {"power", "vitality", "stride", "reach", "ward"}
LIMITS = {"player": {"auto": 3, "manual": 2, "support": 0},
          "companion": {"auto": 2, "manual": 0, "support": 1}}
EXTRA = {"builds", "study_owner", "rerolls", "zones", "facing", "stats"}
RANKS = dict.fromkeys(("power", "vitality", "stride", "reach", "partner", "haste", "ward", "multishot"), 0)


def _check(condition: bool) -> None:
    if not condition:
        raise AdventureError("adventure_invalid_snapshot")


def _int(value: Any, low: int, high: int) -> bool:
    return type(value) is int and low <= value <= high


def _num(value: Any, low: float, high: float) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and low <= value <= high


def legal_choices(build: dict, owner: str, rules: int = 2) -> set[str]:
    catalog = CATALOGS[rules]
    skills = {skill["id"]: skill for skill in build["skills"]}
    result: set[str] = set()
    for skill_id, spec in catalog.items():
        skill = skills.get(skill_id)
        if skill is None:
            count = sum(catalog[s["id"]]["slot"] == spec["slot"] for s in skills.values())
            if count < LIMITS[owner][spec["slot"]]:
                result.add(f"{skill_id}:learn")
        elif skill["level"] == 1:
            result.update((f"{skill_id}:power", f"{skill_id}:haste"))
        elif skill["level"] == 2:
            result.update(f"{skill_id}:{branch[0]}" for branch in spec["branches"])
        elif skill["level"] == 3:
            result.add(f"{skill_id}:deepen")
        elif skill["level"] == 4:
            result.add(f"{skill_id}:awaken")
            catalyst = spec.get("fusion", [""])[0]
            if catalyst in skills and skills[catalyst]["level"] >= 2 and not any(
                s["evolution"] == "fusion" for s in skills.values()
            ):
                result.add(f"{skill_id}:fuse")
    allowed = {"power", "vitality", "stride", "reach"} if owner == "player" else {"power", "ward"}
    result.update(f"talent:{key}" for key in allowed if build["talents"][key] < 4)
    return result


def validate_extra(value: dict) -> dict:
    """Return a legacy-shaped common checkpoint for the existing entity validator."""
    modern = value["rules"] == 3
    catalog = CATALOGS[value["rules"]]
    extra = EXTRA | ({"frosts", "shatter_at"} if modern else set())
    common_fields = {
        "rules", "elapsed", "rng", "player", "companion", "enemies", "bullets", "drops",
        "level", "xp", "kills", "partner_kills", "next_id", "choices", "spawn_at",
        "attack_at", "support_at", "hurt_until", "shield", "boss_spawned", "outcome",
    }
    _check(set(value) == common_fields | extra)
    _check(_int(value["level"], 1, 31) and _int(value["rerolls"], 0, 2))
    builds = value["builds"]
    _check(isinstance(builds, dict) and set(builds) == set(LIMITS))
    for owner, build in builds.items():
        _check(isinstance(build, dict) and set(build) == {"skills", "talents", "misses"})
        skills = build["skills"]
        _check(isinstance(skills, list) and 2 <= len(skills) <= (5 if owner == "player" else 3))
        seen: set[str] = set()
        for skill in skills:
            _check(isinstance(skill, dict) and set(skill) == {
                "id", "level", "focus", "branch", "evolution", "ready_at", "react_at",
            })
            skill_id = skill["id"]
            _check(isinstance(skill_id, str) and skill_id in catalog and skill_id not in seen)
            seen.add(skill_id)
            _check(_int(skill["level"], 1, 5))
            _check(skill["focus"] in (("",) if skill["level"] == 1 else ("power", "haste")))
            _check(skill["branch"] in (("",) if skill["level"] < 3 else tuple(
                branch[0] for branch in catalog[skill_id]["branches"]
            )))
            _check(skill["evolution"] in (("",) if skill["level"] < 5 else ("pure", "fusion")))
            _check(all(_num(skill[key], 0, 1230000) for key in ("ready_at", "react_at")))
        for slot, limit in LIMITS[owner].items():
            count = sum(catalog[s["id"]]["slot"] == slot for s in skills)
            _check(count <= limit and (slot != "auto" or count >= 1))
        _check(any(catalog[s["id"]]["slot"] == ("manual" if owner == "player" else "support") for s in skills))
        fused = [s for s in skills if s["evolution"] == "fusion"]
        _check(len(fused) <= 1)
        for skill in fused:
            catalyst = catalog[skill["id"]].get("fusion", [""])[0]
            _check(any(s["id"] == catalyst and s["level"] >= 2 for s in skills))
        for key, maximum in (("talents", 4), ("misses", 2)):
            _check(isinstance(build[key], dict) and set(build[key]) == (TALENTS if key == "talents" else set(catalog)))
            _check(all(_int(rank, 0, maximum) for rank in build[key].values()))
        unused = {"ward"} if owner == "player" else {"vitality", "stride", "reach"}
        _check(all(build["talents"][key] == 0 for key in unused))
    choices = value["choices"]
    _check(isinstance(choices, list) and len(choices) <= 3 and all(isinstance(key, str) for key in choices))
    _check(len(set(choices)) == len(choices))
    owner = "companion" if (value["level"] - 1) % 3 == 0 else "player"
    _check(value["study_owner"] == (owner if choices else ""))
    if choices:
        _check(value["level"] >= 2 and set(choices) <= legal_choices(builds[owner], owner, value["rules"]))
    facing = value["facing"]
    _check(isinstance(facing, dict) and set(facing) == {"x", "y"})
    _check(all(_num(facing[key], -1, 1) for key in ("x", "y")))
    _check(.99 <= math.hypot(facing["x"], facing["y"]) <= 1.01)
    stats = value["stats"]
    counters = {"supports", "followups"} | ({"shatters", "cross_shatters"} if modern else set())
    _check(isinstance(stats, dict) and set(stats) == {"player_damage", "companion_damage"} | counters)
    _check(all(_num(number, 0, 10**9) for number in stats.values()))
    _check(all(_int(stats[key], 0, 10**6) for key in counters))
    _check(stats["followups"] <= stats["supports"])
    if modern:
        _check(stats["cross_shatters"] <= stats["shatters"])
        _validate_frost(value, builds)
    common = copy.deepcopy({key: item for key, item in value.items() if key not in extra})
    common.update(rules=1, choices=[], ranks=RANKS.copy())
    _check(isinstance(common.get("bullets"), list) and len(common["bullets"]) <= 160)
    for bullet in common["bullets"]:
        _check(isinstance(bullet, dict) and set(bullet) == {
            "id", "x", "y", "vx", "vy", "life", "damage", "owner", "skill", "pierce", "hit_ids",
        } | ({"form"} if modern else set()))
        _check(bullet["skill"] in (("fire", "wind", "ice") if modern else ("fire", "wind"))
               and _int(bullet["pierce"], 0, 5 if modern else 3))
        _check(bullet["owner"] in ("player", "companion") and any(
            skill["id"] == bullet["skill"] for skill in builds[bullet["owner"]]["skills"]
        ))
        if modern:
            form = bullet.pop("form")
            _check(form in ("base", "awakened", "fusion"))
            skill = next(s for s in builds[bullet["owner"]]["skills"] if s["id"] == bullet["skill"])
            _check(form == "base" or skill["level"] == 5 and (
                skill["evolution"] == ("fusion" if form == "fusion" else "pure")
            ))
        hits = bullet["hit_ids"]
        _check(isinstance(hits, list) and len(hits) <= (6 if modern else 4)
               and all(_int(item, 1, 999999) for item in hits))
        _check(len(set(hits)) == len(hits))
        for key in ("skill", "pierce", "hit_ids"):
            del bullet[key]
    zones = value["zones"]
    _check(isinstance(zones, list) and len(zones) <= 12)
    _check(all(isinstance(value.get(key), list) for key in ("enemies", "bullets", "drops")))
    ids = [item.get("id") for key in ("enemies", "bullets", "drops") for item in value[key] if isinstance(item, dict)]
    _check(_int(value.get("next_id"), 1, 1000000))
    for zone in zones:
        _check(isinstance(zone, dict) and set(zone) == {
            "id", "kind", "owner", "x", "y", "radius", "damage", "expires_at", "tick_at", "targets",
        })
        _check(zone["kind"] in (("flame", "pull", "frost") if modern else ("flame", "pull"))
               and zone["owner"] in ("player", "companion"))
        if modern:
            owned = builds[zone["owner"]]["skills"]
            _check(any(s["id"] == zone["kind"] or (
                zone["kind"] == "flame" and s["id"] == "fire" and s["branch"] == "blast"
            ) for s in owned))
        _check(_int(zone["id"], 1, value["next_id"] - 1) and zone["id"] not in ids)
        ids.append(zone["id"])
        _check(_num(zone["x"], 0, 1800) and _num(zone["y"], 0, 1200))
        _check(_num(zone["radius"], 1, 200) and _num(zone["damage"], 0, 1000))
        _check(all(_num(zone[key], 0, 1230000) for key in ("expires_at", "tick_at")))
        targets = zone["targets"]
        _check(isinstance(targets, list) and len(targets) <= (4 if modern else 3)
               and all(_int(item, 1, value["next_id"] - 1) for item in targets))
        _check(len(set(targets)) == len(targets))
    return common


def _validate_frost(value: dict, builds: dict) -> None:
    _check(_num(value.get("elapsed"), 0, 1200000))
    now = value["elapsed"]
    _check(_num(value["shatter_at"], 0, now + 600))
    marks = value["frosts"]
    _check(isinstance(marks, list) and len(marks) <= 160)
    enemies = value.get("enemies")
    _check(isinstance(enemies, list))
    live = {enemy.get("id") for enemy in enemies if isinstance(enemy, dict) and type(enemy.get("id")) is int}
    seen: set[int] = set()
    for mark in marks:
        _check(isinstance(mark, dict) and set(mark) == {
            "target", "source", "stacks", "expires_at", "frozen_until", "freeze_at", "break_at",
        })
        _check(_int(mark["target"], 1, 999999) and mark["target"] in live and mark["target"] not in seen)
        seen.add(mark["target"])
        _check(mark["source"] in ("player", "companion") and any(
            skill["id"] in ("ice", "frost") for skill in builds[mark["source"]]["skills"]
        ))
        _check(_int(mark["stacks"], 0, 3))
        _check(all(_num(mark[key], 0, 1230000) for key in ("expires_at", "frozen_until", "freeze_at", "break_at")))
        _check(all(mark[key] <= now + maximum for key, maximum in (
            ("expires_at", 5000), ("frozen_until", 600), ("freeze_at", 3500), ("break_at", 1800),
        )))
        _check(mark["frozen_until"] <= mark["freeze_at"])
        if any(enemy.get("id") == mark["target"] and enemy.get("kind") == "boss" for enemy in enemies):
            _check(mark["frozen_until"] == 0)
