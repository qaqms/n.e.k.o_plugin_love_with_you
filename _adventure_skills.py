"""Bounded versioned builds and effects; catalogs contain no executable code."""

from __future__ import annotations

import copy
import json
import math
from pathlib import Path
from typing import Any

from ._adventure_economy import AdventureError


def _catalog(filename: str, key: str = "") -> dict:
    entries = json.loads(
        (Path(__file__).parent / "static" / filename).read_text(encoding="utf-8")
    )
    return {item["id"]: item for item in (entries[key] if key else entries)}


CATALOG = _catalog("skills-v2.json")
CATALOGS = {2: CATALOG, **dict.fromkeys((3, 4, 5), _catalog("skills.json"))}
CATALOGS[6] = {**CATALOGS[5], **_catalog("skills-expanded.json")}
CATALOGS[7] = CATALOGS[6]
MODS = _catalog("build-mods.json", "mods")
SKILL_TAGS = json.loads((Path(__file__).parent / "static" / "build-mods.json").read_text(encoding="utf-8"))["tags"]
ROUTES = _catalog("routes.json")
FOES = _catalog("encounters.json", "foes")
COOPERATIONS = _catalog("encounters.json", "cooperations")
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
            if skill_id not in build.get("banished", []) and count < LIMITS[owner][spec["slot"]]:
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
    if rules >= 7:
        result.update(f"mod:{key}" for key, spec in MODS.items()
                      if owner in spec["owners"] and build["mods"][key] < spec["cap"]
                      and any(spec["tag"] in SKILL_TAGS[s["id"]] for s in skills.values()))
    return result


def validate_extra(value: dict) -> dict:
    """Return a legacy-shaped common checkpoint for the existing entity validator."""
    modern = value["rules"] >= 3
    encounter_rules = value["rules"] >= 4
    catalog = CATALOGS[value["rules"]]
    free_build = value["rules"] >= 7
    extra = EXTRA | ({"frosts", "shatter_at"} if modern else set())
    if free_build:
        extra |= {"preparation", "swaps"}
    if encounter_rules:
        extra |= {"encounters", "foes", "threats"}
    common_fields = {
        "rules", "elapsed", "rng", "player", "companion", "enemies", "bullets", "drops",
        "level", "xp", "kills", "partner_kills", "next_id", "choices", "spawn_at",
        "attack_at", "support_at", "hurt_until", "shield", "boss_spawned", "outcome",
    }
    _check(set(value) == common_fields | extra)
    _check(_int(value["level"], 1, 31) and _int(value["rerolls"], 0, 2))
    if free_build:
        _check(isinstance(value["preparation"], str) and value["preparation"] in ("", "player", "companion"))
        _check(isinstance(value["swaps"], dict) and set(value["swaps"]) == set(LIMITS)
               and all(_int(count, 0, 2) for count in value["swaps"].values()))
        _check(isinstance(value.get("encounters"), dict) and isinstance(value["encounters"].get("resolved"), list))
        _check(all(count <= len(value["encounters"]["resolved"]) for count in value["swaps"].values()))
    builds = value["builds"]
    _check(isinstance(builds, dict) and set(builds) == set(LIMITS))
    for owner, build in builds.items():
        _check(isinstance(build, dict) and set(build) == {"skills", "talents", "misses"} | (
            {"mods", "banished"} if free_build else set()))
        skills = build["skills"]
        minimum = 0 if free_build and value["preparation"] else 1 if free_build else 2
        _check(isinstance(skills, list) and minimum <= len(skills) <= (5 if owner == "player" else 3))
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
            _check(count <= limit and (slot != "auto" or free_build and value["preparation"] or count >= 1))
        if not free_build:
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
        if free_build:
            _check(isinstance(build["mods"], dict) and set(build["mods"]) == set(MODS))
            _check(all(_int(rank, 0, MODS[key]["cap"]) and (rank == 0 or owner in MODS[key]["owners"])
                       for key, rank in build["mods"].items()))
            banished = build["banished"]
            _check(isinstance(banished, list) and len(banished) <= 2
                   and all(isinstance(key, str) and key in catalog and key not in seen
                           and LIMITS[owner][catalog[key]["slot"]] for key in banished))
            _check(len(set(banished)) == len(banished))
    choices = value["choices"]
    _check(isinstance(choices, list) and len(choices) <= (4 if free_build else 3) and all(isinstance(key, str) for key in choices))
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
    if free_build and value["preparation"]:
        _validate_preparation(value, builds)
    _check(all(isinstance(value[key], list) and len(value[key]) <= 160
               and all(isinstance(item, dict) for item in value[key])
               for key in ("enemies", "bullets", "drops")))
    common = copy.deepcopy({key: item for key, item in value.items() if key not in extra})
    if encounter_rules:
        for enemy in common["enemies"]:
            if enemy.get("kind") in ("charger", "caster", "sentinel", "oracle"):
                enemy["kind"] = "brute"
    common.update(rules=1, choices=[], ranks=RANKS.copy())
    _check(isinstance(common.get("bullets"), list) and len(common["bullets"]) <= 160)
    for bullet in common["bullets"]:
        _check(isinstance(bullet, dict) and set(bullet) == {
            "id", "x", "y", "vx", "vy", "life", "damage", "owner", "skill", "pierce", "hit_ids",
        } | ({"form"} if modern else set()))
        _check(bullet["skill"] in (("fire", "wind", "ice", "stone") if value["rules"] >= 6
                                   else ("fire", "wind", "ice") if modern else ("fire", "wind"))
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
        _check(zone["kind"] in (("flame", "pull", "frost", "orbit", "rune", "quake", "whirl", "meteor", "beacon")
                               if value["rules"] >= 6 else ("flame", "pull", "frost") if modern else ("flame", "pull"))
               and zone["owner"] in ("player", "companion"))
        if modern:
            owned = builds[zone["owner"]]["skills"]
            _check(any(s["id"] == zone["kind"] or (
                zone["kind"] == "flame" and s["id"] == "fire" and s["branch"] == "blast"
            ) for s in owned))
        _check(_int(zone["id"], 1, value["next_id"] - 1) and zone["id"] not in ids)
        ids.append(zone["id"])
        _check(_num(zone["x"], 0, 1800) and _num(zone["y"], 0, 1200))
        _check(_num(zone["radius"], 1, 280 if zone["kind"] == "beacon" else 200) and _num(zone["damage"], 0, 1000))
        _check(all(_num(zone[key], 0, 1230000) for key in ("expires_at", "tick_at")))
        targets = zone["targets"]
        _check(isinstance(targets, list) and len(targets) <= (4 if modern else 3)
               and all(_int(item, 1, value["next_id"] - 1) for item in targets))
        _check(len(set(targets)) == len(targets))
        if value["rules"] >= 6 and zone["kind"] in ("orbit", "rune", "quake", "whirl", "meteor", "beacon"):
            _check(not targets)
            skill = next(s for s in builds[zone["owner"]]["skills"] if s["id"] == zone["kind"])
            maximum = {"orbit": 1600, "rune": 8000, "quake": 4000,
                       "whirl": 4000, "meteor": 3300, "beacon": 7500}[zone["kind"]]
            _check(zone["expires_at"] <= value["elapsed"] + maximum
                   and zone["tick_at"] <= value["elapsed"] + maximum)
            if zone["kind"] == "quake":
                _check(skill["branch"] in ("echo", "fault"))
    if value["rules"] >= 6:
        for owner in LIMITS:
            for kind in ("orbit", "rune", "whirl", "beacon", "meteor"):
                active = [z for z in zones if z["owner"] == owner and z["kind"] == kind]
                if not active:
                    continue
                skill = next(s for s in builds[owner]["skills"] if s["id"] == kind)
                pure = skill["level"] == 5 and skill["evolution"] == "pure"
                maximum = 4 if kind == "rune" and pure else 3 if kind == "rune" else (
                    2 if kind == "beacon" and pure else 1 if kind == "beacon" else 5 if kind == "meteor" else 1)
                _check(len(active) <= maximum)
    return common


def _validate_preparation(value: dict, builds: dict) -> None:
    _check(value["elapsed"] == 0 and value["level"] == 1 and value["xp"] == 0
           and value["outcome"] == "playing" and value["kills"] == value["partner_kills"] == 0)
    _check(all(value[key] == [] for key in ("enemies", "bullets", "drops", "zones", "frosts", "choices")))
    _check(not any(value["stats"].values()) and not any(value["swaps"].values()) and value["rerolls"] == 2)
    _check(value["shield"] == value["shatter_at"] == 0 and value["boss_spawned"] is False
           and value["next_id"] == 1 and value["foes"] == value["threats"] == [])
    state = value["encounters"]
    _check(state.get("selected") == state.get("resolved") == state.get("choices") == []
           and state.get("pending") == "" and state.get("rest_until") == 0)
    marks = state.get("milestones")
    _check(isinstance(marks, dict) and all(
        mark == {"spawned": False, "defeated": False, "enemy": 0} for mark in marks.values()))
    for owner, build in builds.items():
        expected = 1 if value["preparation"] == "companion" and owner == "player" else 0
        _check(len(build["skills"]) == expected and all(
            CATALOGS[7][skill["id"]]["slot"] == "auto" and skill["level"] == 1
            and skill["ready_at"] == skill["react_at"] == 0 for skill in build["skills"]))
        _check(not build["banished"] and all(not any(build[key].values()) for key in ("talents", "misses", "mods")))


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
        if any(enemy.get("id") == mark["target"] and enemy.get("kind") in ("boss", "sentinel", "oracle") for enemy in enemies):
            _check(mark["frozen_until"] == 0)


def validate_encounters(value: dict, builds: dict) -> None:
    now = value["elapsed"]
    enemy_specs = FOES
    milestones = {"sentinel", "oracle"}
    cooperation_ids = COOPERATIONS
    state = value["encounters"]
    _check(isinstance(state, dict) and set(state) == {
        "milestones", "selected", "resolved", "pending", "choices", "rest_until",
    })
    marks = state["milestones"]
    _check(isinstance(marks, dict) and set(marks) == milestones)
    enemies = value["enemies"]
    for key, mark in marks.items():
        matching = [enemy for enemy in enemies if enemy["kind"] == key]
        _check(isinstance(mark, dict) and set(mark) == {"spawned", "defeated", "enemy"}
               and type(mark["spawned"]) is bool and type(mark["defeated"]) is bool
               and _int(mark["enemy"], 0, value["next_id"] - 1))
        if mark["defeated"]:
            _check(mark["spawned"] and mark["enemy"] == 0
                   and not any(e["kind"] == key for e in enemies))
        elif mark["spawned"]:
            _check(len(matching) == 1 and matching[0]["id"] == mark["enemy"])
        else:
            _check(mark["enemy"] == 0 and not matching)
    selected, resolved, choices = state["selected"], state["resolved"], state["choices"]
    _check(isinstance(selected, list) and all(isinstance(item, str) for item in selected)
           and len(selected) <= 2 and len(set(selected)) == len(selected)
           and all(item in cooperation_ids for item in selected))
    _check(isinstance(resolved, list) and all(isinstance(item, str) for item in resolved)
           and len(resolved) == len(selected) and len(resolved) <= 2
           and len(set(resolved)) == len(resolved) and all(item in milestones for item in resolved)
           and all(marks[key]["defeated"] for key in resolved))
    _check(_num(state["rest_until"], 0, now + 15000))
    pending = state["pending"]
    _check(isinstance(pending, str) and pending in ("", *milestones))
    _check(isinstance(choices, list) and all(isinstance(item, str) for item in choices)
           and len(choices) <= 3 and len(set(choices)) == len(choices)
           and all(item in cooperation_ids for item in choices))
    for item in selected + choices:
        _check(all(any(skill["id"] in ids for skill in builds[owner]["skills"])
                   for owner, ids in COOPERATIONS[item]["requires"].items()))
    if pending:
        _check(marks[pending]["defeated"] and pending not in resolved and choices
               and not value["choices"] and value["study_owner"] == "")
        for item in choices:
            _check(item not in selected)
    else:
        _check(not choices)
    _check(isinstance(value["foes"], list) and len(value["foes"]) <= 160)
    alive = {enemy["id"]: enemy for enemy in enemies}
    ai_by_target: dict[int, dict] = {}
    for ai in value["foes"]:
        _check(isinstance(ai, dict) and set(ai) == {"target", "state", "ready_at", "step", "phase"})
        target = ai["target"]
        _check(_int(target, 1, value["next_id"] - 1) and target not in ai_by_target
               and target in alive and alive[target]["kind"] in enemy_specs)
        _check(isinstance(ai["state"], str) and ai["state"] in ("move", "windup", "recover"))
        _check(_num(ai["ready_at"], 0, now + 3000) and _int(ai["step"], 0, 5)
               and _int(ai["phase"], 1, 2) and (ai["phase"] == 1 or alive[target]["kind"] == "boss"))
        ai_by_target[target] = ai
    _check(set(ai_by_target) == {key for key, enemy in alive.items() if enemy["kind"] in enemy_specs})
    threats = value["threats"]
    _check(isinstance(threats, list) and len(threats) <= 32)
    ids = {enemy["id"] for enemy in enemies} | {bullet["id"] for bullet in value["bullets"]} | {
        drop["id"] for drop in value["drops"]
    } | {zone["id"] for zone in value["zones"]}
    threat_ids: set[int] = set()
    for threat in threats:
        _check(isinstance(threat, dict) and set(threat) == {
            "id", "source", "kind", "x", "y", "ex", "ey", "radius", "damage", "trigger_at", "expires_at", "fired",
        })
        _check(_int(threat["id"], 1, value["next_id"] - 1) and threat["id"] not in ids
               and threat["id"] not in threat_ids and _int(threat["source"], 1, value["next_id"] - 1)
               and threat["source"] in ai_by_target)
        threat_ids.add(threat["id"])
        _check(threat["kind"] in ("line", "circle") and type(threat["fired"]) is bool)
        _check(all(_num(threat[key], 0, maximum) for key, maximum in (
            ("x", 1800), ("ex", 1800), ("y", 1200), ("ey", 1200),
        )))
        _check(_num(threat["radius"], 20, 120) and _num(threat["damage"], 1, 40))
        _check(_num(threat["trigger_at"], 0, now + 1200)
               and _num(threat["expires_at"], threat["trigger_at"], now + 1500))
