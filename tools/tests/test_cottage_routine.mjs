import assert from "node:assert/strict"
import { test } from "node:test"
import { BED, EDGES, NODES, SCHEDULE, SPOTS, activityAt, cottageMinutes, periodOf, plan, roomOf, route }
  from "../../static/cottage-routine.mjs"
import { FURNITURE, ROOMS, SLOTS, STAIRS, WALLS, bounds } from "../../static/cottage-layout.mjs"

const at = (hours, minutes = 0) => hours * 60 + minutes

test("her day follows the schedule: asleep at night, meals in the kitchen, moving on through the day", () => {
  const expect = [
    [at(3), "sleep", "bed"], [at(7, 5), "wake", "bedside"], [at(7, 20), "breakfast-cook", "counter"],
    [at(7, 50), "breakfast", "table"], [at(8, 20), "day-rug", "rug"], [at(9), "day-sofa", "sofa"],
    [at(9, 40), "day-desk", "desk"], [at(10, 20), "day-bench", "bench"], [at(11), "day-rug", "rug"],
    [at(12), "lunch-cook", "counter"], [at(12, 20), "lunch", "table"], [at(12, 45), "day-rug", "rug"],
    [at(18, 10), "dinner-cook", "counter"], [at(18, 40), "dinner", "table"], [at(19, 30), "evening", "sofa"],
    [at(22, 40), "bedtime", "bedside"], [at(23, 30), "sleep", "bed"], [at(23, 59), "sleep", "bed"],
  ]
  for (const [minutes, id, spot] of expect) {
    const activity = activityAt(minutes)
    assert.deepEqual([activity.id, activity.spot], [id, spot], `${Math.floor(minutes / 60)}:${minutes % 60}`)
    assert.ok(activity.since <= minutes && minutes < activity.until)
  }
  // The daytime block ends where lunch starts, not 40 minutes after its own start.
  assert.equal(activityAt(at(11, 40)).until, at(11, 45))
  assert.deepEqual(activityAt(at(7, 1)).then, ["yawn", "stretch"])
  for (const [, entry] of SCHEDULE) if (entry.spot) assert.ok(SPOTS[entry.spot], entry.id)
})

test("the cottage clock is the computer's, or a moving time inside the period chosen in the room", () => {
  const date = new Date(2026, 10, 22, 14, 30)
  assert.equal(cottageMinutes("auto", date), at(14, 30))
  assert.equal(cottageMinutes("day", date), at(14, 30))
  for (const period of ["dusk", "night"]) {
    const minutes = cottageMinutes(period, date)
    assert.equal(periodOf(minutes), period)
    // A minute later the chosen period's clock has moved on by a minute too.
    assert.ok(Math.abs(cottageMinutes(period, new Date(2026, 10, 22, 14, 31)) - minutes - 1) < 1e-9)
  }
  assert.equal(activityAt(cottageMinutes("night", new Date(2026, 10, 22, 3))).id, "sleep")
  assert.equal(periodOf(cottageMinutes("day", new Date(2026, 10, 22, 23, 50))), "day")
})

// Footprints of everything she must walk around, by storey (the chairs are drawn beside the table and desk).
const OBSTACLES = [...FURNITURE, ...SLOTS.filter(slot => slot.kind === "floor")].map(item => {
  const [x, y, z] = bounds(item)
  return { name: item.name, storey: ROOMS.find(room => room.id === item.room).storey, x, z, y }
})
OBSTACLES.push({ name: "楼梯", storey: 0, x: STAIRS.x, z: STAIRS.z }, { name: "楼梯口", storey: 1, x: STAIRS.hole.x, z: STAIRS.hole.z })
const CLEARANCE = .12
const storeyOf = point => point.y > 2 ? 1 : 0

function crossesBox(a, b, box) {
  const [x0, x1] = [box.x[0] - CLEARANCE, box.x[1] + CLEARANCE]
  const [z0, z1] = [box.z[0] - CLEARANCE, box.z[1] + CLEARANCE]
  for (let i = 0; i <= 100; i++) {
    const x = a.x + (b.x - a.x) * i / 100
    const z = a.z + (b.z - a.z) * i / 100
    if (x > x0 && x < x1 && z > z0 && z < z1) return true
  }
  return false
}

test("every walk stays on one floor, clear of the furniture, and goes through doors", () => {
  for (const [from, to, how] of EDGES) {
    const a = NODES[from]
    const b = NODES[to]
    assert.ok(a && b, `${from}-${to}`)
    if (how === "stairs") {
      assert.notEqual(storeyOf(a), storeyOf(b))
      continue
    }
    assert.equal(storeyOf(a), storeyOf(b), `${from}-${to} changes floor`)
    for (const box of OBSTACLES.filter(item => item.storey === storeyOf(a))) {
      assert.ok(!crossesBox(a, b, box), `${from}-${to} walks through ${box.name}`)
    }
    for (const wall of WALLS.filter(item => item.storey === storeyOf(a) && item.axis === "x")) {
      if ((a.x - wall.at) * (b.x - wall.at) >= 0) continue
      const z = a.z + (b.z - a.z) * (wall.at - a.x) / (b.x - a.x)
      const door = wall.openings.find(([low, high, , , kind]) => kind === "door" && z > low + .25 && z < high - .25)
      assert.ok(door, `${from}-${to} goes through the wall at x ${wall.at} (z ${z.toFixed(2)})`)
    }
  }
  for (const [name, node] of Object.entries(NODES)) {
    for (const box of OBSTACLES.filter(item => item.storey === storeyOf(node))) {
      assert.ok(!crossesBox(node, node, box), `${name} stands in ${box.name}`)
    }
  }
})

test("she can get from every place to every other, using the stairs only between floors", () => {
  const names = Object.keys(SPOTS)
  for (const from of names) for (const to of names) {
    const steps = plan({ spot: from }, to)
    if (from === to) { assert.deepEqual(steps, []); continue }
    const stairs = steps.filter(step => step.kind === "stairs").length
    assert.equal(stairs, Number(storeyOf(SPOTS[from]) !== storeyOf(SPOTS[to])), `${from} -> ${to}`)
    assert.equal(steps.at(-1).spot, to)
    assert.equal(steps.at(-1).kind, { walk: "arrive", sit: "sit", bed: "bed" }[SPOTS[to].enter])
    if (SPOTS[from].enter === "sit") {
      // 0.9.51: getting up she stands to the point beside the seat she sat on.
      assert.equal(steps[0].kind, "rise")
      assert.equal(steps[0].seatOf, from)
    }
    if (SPOTS[from].enter === "bed") assert.equal(steps[0].kind, "leave-bed")
    assert.equal(roomOf(steps.at(-1).to), SPOTS[to].room)
  }
  // From a node in the middle of the way (where a visitor stopped her).
  assert.equal(plan({ node: "kitchenDoor" }, "bed").filter(step => step.kind === "stairs").length, 1)
  assert.deepEqual(route("rug", "rug"), [])
  assert.throws(() => route("rug", "attic"))
  for (const spot of Object.values(SPOTS)) assert.equal(roomOf(spot), spot.room)
})

test("getting into and out of bed stays on the mattress and lands clear of the furniture", () => {
  const bed = FURNITURE.find(item => item.name === "床")
  const [x, , z] = bounds(bed)
  for (const point of [BED.back, BED.edge, SPOTS.bed]) {
    assert.ok(point.x > x[0] && point.x < x[1] && point.z > z[0] && point.z < z[1], "on the bed")
    assert.ok(point.y > BED.surface, "on top of the mattress")
  }
  // She stands up from the edge on the room side, on the floor, and walks from there to the bedside.
  assert.ok(BED.floor.x > x[1] && BED.floor.y === NODES.bedside.y)
  for (const box of OBSTACLES.filter(item => item.storey === 1)) {
    assert.ok(!crossesBox(BED.floor, BED.floor, box), `stands in ${box.name}`)
    assert.ok(!crossesBox(BED.floor, NODES.bedside, box), `walks through ${box.name}`)
  }
  assert.equal(roomOf(BED.floor), "bedroom")
  // 0.9.52: she sits on the side of the bed like on a seat, its top the mattress, and stands up right in front of it.
  assert.equal(BED.side.y, BED.floor.y)
  assert.equal(BED.stand.y, BED.floor.y)
  assert.ok(BED.stand.x > x[1], "she stands clear of the bed")
  assert.ok(Math.abs(BED.side.y + BED.side.seat - BED.surface) < .03, "the side's top is the mattress")
  assert.ok(Math.abs(BED.side.x + BED.side.chair[0] - x[1]) < .05, "the side's front edge is the mattress's")
  const ahead = (BED.stand.x - BED.side.x) * Math.sin(BED.side.turn) + (BED.stand.z - BED.side.z) * Math.cos(BED.side.turn)
  assert.ok(ahead > .3 && ahead < .5, "she stands in front of where she sits")
})
