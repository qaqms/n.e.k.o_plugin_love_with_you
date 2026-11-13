import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { FOES, drawCooperations, installEncounters, isBoss, legalCooperations, segmentDistance, spawnPoint } from "../static/encounter-rules.mjs"

installEncounters(JSON.parse(readFileSync(new URL("../static/encounters.json", import.meta.url), "utf8")))
const builds = {
  player: { skills: [{ id: "fire" }, { id: "flame" }, { id: "slash" }] },
  companion: { skills: [{ id: "wind" }, { id: "pull" }, { id: "ice" }] },
}
const rng = { between: (low, high) => high }

test("milestone cooperation offers only same-run prerequisites and never repeats a reward", () => {
  const eligible = legalCooperations(builds, [])
  assert.deepEqual(eligible.sort(), ["cadence", "embers", "escort", "rime", "warmth"].sort())
  assert.deepEqual(drawCooperations(builds, [], rng), ["rime", "embers", "escort"])
  assert.deepEqual(drawCooperations(builds, ["rime", "embers"], rng), ["escort", "warmth", "cadence"])
  assert.deepEqual(drawCooperations(builds, ["cadence", "warmth"], rng), ["rime", "embers", "escort"])
})

test("line warnings provide a dodgeable segment and spawn points stay outside the close ring", () => {
  assert.equal(segmentDistance({ x: 5, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 4)
  const point = spawnPoint({ x: 900, y: 600 }, { realInRange: () => 0, between: () => 380 })
  assert.ok(Math.hypot(point.x - 900, point.y - 600) >= 280)
  assert.deepEqual([FOES.sentinel.at, FOES.oracle.at, FOES.boss.at], [360000, 720000, 1080000])
  assert.equal(isBoss("sentinel"), true)
  assert.equal(isBoss("charger"), false)
})

test("without linked spells the three general cooperations still provide a complete offer", () => {
  const starting = { player: { skills: [{ id: "fire" }, { id: "flame" }] },
    companion: { skills: [{ id: "guard" }, { id: "armor" }] } }
  assert.deepEqual(legalCooperations(starting, []), ["cadence", "warmth", "escort"])
  assert.equal(drawCooperations(starting, ["warmth"], rng).length, 2)
})
