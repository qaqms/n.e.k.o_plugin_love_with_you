import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { JOURNEY, installJourney, firstNode, drawDoors, enter, progress, pace, hpScale, interval, settlementFor, nodeAt } from "../static/journey-rules.mjs"
import { ARENAS, arenaLayout, TerrainGeometry, forestLayout } from "../static/terrain-rules.mjs"
import { spawnPoint } from "../static/encounter-rules.mjs"
import { ULTIMATE, schoolOf, charge, strike } from "../static/ultimate.mjs"

installJourney(JSON.parse(readFileSync(new URL("../static/journey.json", import.meta.url), "utf8")))
const rng = values => { let i = 0; return { between: (low, high) => Math.max(low, Math.min(high, values[i++ % values.length])) } }

test("the journey is nine nodes: two fights and a gatekeeper per area, ending at the boss", () => {
  assert.deepEqual(JOURNEY.nodes.map(node => node.type), ["fight", "fight", "elite", "fight", "fight", "elite", "fight", "fight", "boss"])
  assert.deepEqual(JOURNEY.nodes.filter(node => node.foe).map(node => node.foe), ["sentinel", "oracle", "boss"])
  assert.ok(JOURNEY.nodes.every(node => ARENAS[node.arena]))
  assert.deepEqual(firstNode(), { node: 0, phase: "fight", goal: "hold", reward: "study", hard: false, need: 90000,
    started_at: 0, kills_at: 0, doors: [], hard_cleared: 0 })
})

test("doors always offer both goals, distinct rewards, and a single hard door only after the first area", () => {
  for (const seed of [[0], [1], [2, 0, 1], [1, 1, 0, 1]]) for (const index of [1, 3, 4, 6, 7]) {
    const doors = drawDoors(index, { level: 5, rerolls: 1 }, rng(seed))
    assert.equal(doors.length, index >= 3 ? 3 : 2)
    assert.deepEqual(doors.slice(0, 2).map(door => door.goal).sort(), ["clear", "hold"])
    assert.equal(new Set(doors.map(door => door.reward)).size, doors.length)
    assert.deepEqual(doors.map(door => door.hard), index >= 3 ? [false, false, true] : [false, false])
    for (const door of doors) assert.equal(door.need, door.goal === "hold" ? 90000 : { 1: 60, 3: 100, 4: 100, 6: 170, 7: 170 }[index])
  }
  assert.deepEqual(drawDoors(2, { level: 5, rerolls: 1 }, rng([0])), [{ goal: "elite", reward: "", hard: false, need: 0 }])
  assert.deepEqual(drawDoors(8, { level: 5, rerolls: 1 }, rng([0])), [{ goal: "boss", reward: "", hard: false, need: 0 }])
})

test("capped builds are never offered a reward they cannot use", () => {
  const doors = drawDoors(4, { level: 30, rerolls: 2 }, rng([0]))
  assert.deepEqual(doors.map(door => door.reward), ["mend", "mend", "mend"])
  assert.ok(!drawDoors(4, { level: 30, rerolls: 0 }, rng([0])).some(door => door.reward === "study"))
  assert.ok(!drawDoors(4, { level: 3, rerolls: 2 }, rng([0])).some(door => door.reward === "insight"))
})

test("hold ends on time, clear ends on kills or its cap, gatekeepers end only when defeated", () => {
  const journey = firstNode()
  assert.equal(progress(journey, 89999, 500).done, false)
  assert.equal(progress(journey, 90000, 0).done, true)
  enter(journey, { goal: "clear", reward: "mend", hard: false, need: 60 }, 90000, 40)
  assert.deepEqual([journey.node, journey.started_at, journey.kills_at, journey.doors], [1, 90000, 40, []])
  assert.equal(progress(journey, 100000, 99).done, false)
  assert.equal(progress(journey, 100000, 100).done, true)
  assert.equal(progress(journey, 210000, 41).done, true)
  enter(journey, { goal: "elite", reward: "", hard: false, need: 0 }, 150000, 100)
  assert.equal(progress(journey, 900000, 5000, false).done, false)
  assert.equal(progress(journey, 150001, 100, true).done, true)
})

test("difficulty follows the node rather than the wall clock", () => {
  const journey = firstNode()
  assert.equal(pace(journey, 60000), 60000)
  journey.node = 6; journey.started_at = 500000
  assert.equal(pace(journey, 500000), 640000)
  assert.equal(pace(journey, 1200000), 790000)
  assert.equal(hpScale(journey), .55)
  journey.hard = true; journey.goal = "clear"
  assert.ok(Math.abs(hpScale(journey) - .715) < 1e-9)
  assert.ok(interval(journey, 500000) >= 170 && interval(journey, 500000) < 220)
  assert.equal(interval(firstNode(), 0), 1000)
})

test("coins are paid per cleared node, hard doors and gatekeepers add more, and only a clear pays the bonus", () => {
  const snapshot = (node, phase, hard, outcome = "retreated") => ({ outcome, journey: { node, phase, hard_cleared: hard } })
  assert.deepEqual(settlementFor(snapshot(0, "fight", 0)), { formula: 2, nodes: 0, hard: 0, journey: 0, clear: 0, total: 0 })
  assert.equal(settlementFor(snapshot(2, "doors", 0)).total, 14 * 2 + 22)
  assert.equal(settlementFor(snapshot(8, "fight", 2, "defeated")).total, 14 * 6 + 7 * 2 + 22 * 2)
  assert.deepEqual(settlementFor(snapshot(8, "fight", 4, "cleared")),
    { formula: 2, nodes: 9, hard: 4, journey: 156, clear: 80, total: 236 })
  assert.equal(settlementFor(snapshot(8, "fight", 0, "cleared")).total, 208)
})

test("arenas keep the centre open, their treeline is scenery, and spawns stay inside the fence", () => {
  for (const id of Object.keys(ARENAS)) {
    const props = arenaLayout(id), b = ARENAS[id].bounds, geometry = new TerrainGeometry(props, b)
    assert.equal(new Set(props.map(prop => prop.id)).size, props.length)
    assert.ok(props.some(prop => prop.decor) && props.some(prop => !prop.decor))
    assert.equal(geometry.rects.length, props.filter(prop => !prop.decor).length)
    for (const prop of props.filter(prop => !prop.decor)) {
      const r = prop.footprint
      assert.ok(r.x > b.x + 60 && r.x + r.width < b.x + b.width - 60 && r.y > b.y + 60 && r.y + r.height < b.y + b.height - 60, prop.id)
    }
    const body = { rx: 10, ry: 11 }
    assert.ok(geometry.free({ x: 900, y: 600 }, body) && geometry.free({ x: 845, y: 620 }, body))
    assert.deepEqual(geometry.bounded({ x: 0, y: 5000 }, body), { x: b.x + 10, y: b.y + b.height - 11 })
    for (const player of [{ x: 260, y: 160 }, { x: 900, y: 600 }, { x: 1540, y: 1040 }]) for (let i = 0; i < 40; i++) {
      const point = spawnPoint(player, { realInRange: () => i / 40 * Math.PI * 2, between: () => 380 + i * 3 }, geometry.area)
      assert.ok(point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height)
      assert.ok(Math.hypot(point.x - player.x, point.y - player.y) >= 280)
    }
  }
  const classic = new TerrainGeometry(forestLayout())
  assert.deepEqual(classic.area, { left: 24, top: 24, right: 1776, bottom: 1176 })
  assert.deepEqual(nodeAt(0).arena, "glade")
})

test("the finishing move belongs to a school, charges per kill with a bonus for gatekeepers, and scales with level", () => {
  assert.equal(schoolOf({ skills: [{ id: "wind" }, { id: "slash" }] }), "")
  for (const id of ["fire", "flame", "meteor"]) assert.equal(schoolOf({ skills: [{ id: "ice" }, { id }] }), "fire")
  assert.equal(charge(0, "slime"), 1)
  assert.equal(charge(40, "sentinel"), 55)
  assert.equal(charge(99, "boss"), ULTIMATE.need)
  assert.equal(charge(100, "slime"), 100)
  assert.equal(strike(1, 0), 180)
  assert.equal(strike(20, 10), 616)
})
