import assert from "node:assert/strict"
import { test } from "node:test"
import {
  EXISTING_FEATURES, FURNITURE, ROOMS, SLOTS, STAIRS, STOREYS, WALLS, bounds, overlaps, room, wallPieces,
} from "../../static/cottage-layout.mjs"

const solids = WALLS.flatMap(wall => wallPieces(wall))
const stairBox = { at: [(STAIRS.x[0] + STAIRS.x[1]) / 2, STAIRS.rise / 2, (STAIRS.z[0] + STAIRS.z[1]) / 2],
  size: [STAIRS.x[1] - STAIRS.x[0], STAIRS.rise, STAIRS.z[1] - STAIRS.z[0]] }
// The space someone walks through: 0.9 m on both sides of every door, 2 m tall.
const doorways = WALLS.flatMap(wall => wall.openings.filter(opening => opening[4] === "door").map(([from, to, low]) => {
  const along = (from + to) / 2
  return wall.axis === "x"
    ? { at: [wall.at, low + 1, along], size: [1.8, 2, to - from] }
    : { at: [along, low + 1, wall.at], size: [to - from, 2, 1.8] }
}))
const label = item => item.id || item.name

test("rooms tile their storey without overlapping", () => {
  for (const [index, a] of ROOMS.entries()) for (const b of ROOMS.slice(index + 1)) {
    if (a.storey !== b.storey) continue
    const apart = a.x[1] <= b.x[0] || b.x[1] <= a.x[0] || a.z[1] <= b.z[0] || b.z[1] <= a.z[0]
    assert.ok(apart, `${a.id} overlaps ${b.id}`)
  }
})

test("slot ids are unique and every slot names a room", () => {
  assert.equal(new Set(SLOTS.map(slot => slot.id)).size, SLOTS.length)
  for (const item of [...SLOTS, ...FURNITURE]) assert.ok(room(item.room), `${label(item)} has unknown room`)
})

test("every shipped interaction keeps exactly one home", () => {
  const hosted = SLOTS.flatMap(slot => slot.features || [])
  assert.deepEqual([...hosted].sort(), [...EXISTING_FEATURES].sort())
  for (const slot of SLOTS) assert.ok(slot.features?.length || slot.idea, `${slot.id} needs a feature or an idea`)
})

test("slots and furniture stay inside their room and storey", () => {
  for (const item of [...SLOTS, ...FURNITURE]) {
    const home = room(item.room)
    const storey = STOREYS[home.storey]
    const [[x0, x1], [y0, y1], [z0, z1]] = bounds(item)
    assert.ok(x0 >= home.x[0] - 1e-6 && x1 <= home.x[1] + 1e-6, `${label(item)} leaves ${home.id} along x`)
    assert.ok(z0 >= home.z[0] - 1e-6 && z1 <= home.z[1] + 1e-6, `${label(item)} leaves ${home.id} along z`)
    assert.ok(y0 >= storey.y - 1e-6 && y1 <= storey.y + storey.height + 1e-6, `${label(item)} leaves storey ${storey.id}`)
  }
})

test("wall slots hang on the wall they name", () => {
  for (const slot of SLOTS.filter(item => item.kind === "wall")) {
    const home = room(slot.room)
    const [[x0], , [z0]] = bounds(slot)
    if (slot.wall === "back") assert.ok(z0 <= home.z[0] + .6, `${slot.id} is away from the back wall`)
    else if (slot.wall === "left") assert.ok(x0 <= home.x[0] + .6, `${slot.id} is away from the left wall`)
    else assert.fail(`${slot.id} names an unknown wall ${slot.wall}`)
  }
})

test("nothing intersects walls, stairs, doorways or another slot in the same room", () => {
  for (const item of [...SLOTS, ...FURNITURE]) {
    for (const piece of solids) assert.ok(!overlaps(item, piece), `${label(item)} cuts into a wall`)
    if (item.room === STAIRS.room) assert.ok(!overlaps(item, stairBox), `${label(item)} blocks the stairs`)
    for (const doorway of doorways) assert.ok(!overlaps(item, doorway), `${label(item)} blocks a doorway`)
  }
  for (const [index, a] of SLOTS.entries()) for (const b of SLOTS.slice(index + 1)) {
    if (a.room === b.room) assert.ok(!overlaps(a, b), `${a.id} overlaps ${b.id}`)
  }
  // Surface slots rest on furniture; everything else keeps clear of the placeholders.
  for (const slot of SLOTS.filter(item => item.kind !== "surface")) {
    for (const piece of FURNITURE.filter(item => item.room === slot.room)) {
      assert.ok(!overlaps(slot, piece), `${slot.id} overlaps ${piece.name}`)
    }
  }
})

test("the stair opening upstairs is clear and every room has a way in", () => {
  const hole = { at: [(STAIRS.hole.x[0] + STAIRS.hole.x[1]) / 2, 3.4 + 1, (STAIRS.hole.z[0] + STAIRS.hole.z[1]) / 2],
    size: [STAIRS.hole.x[1] - STAIRS.hole.x[0], 2, STAIRS.hole.z[1] - STAIRS.hole.z[0]] }
  for (const item of [...SLOTS, ...FURNITURE].filter(entry => room(entry.room).storey === 1)) {
    assert.ok(!overlaps(item, hole), `${label(item)} covers the stair opening`)
  }
  // The rooms connect through a door or the stairs.
  const doorsBetween = (a, b) => WALLS.some(wall => wall.storey === a.storey && wall.axis === "x" &&
    wall.openings.some(opening => opening[4] === "door") &&
    [a.x[0], a.x[1]].includes(wall.at) && [b.x[0], b.x[1]].includes(wall.at))
  assert.ok(doorsBetween(room("living"), room("kitchen")))
  assert.ok(doorsBetween(room("kitchen"), room("porch")))
  assert.ok(doorsBetween(room("bedroom"), room("study")))
  assert.equal(room(STAIRS.room).storey, 0)
})

test("wall pieces leave the openings empty", () => {
  for (const wall of WALLS) {
    const pieces = wallPieces(wall)
    for (const [from, to, low, high] of wall.openings) {
      const middle = (from + to) / 2
      const hole = wall.axis === "z"
        ? { at: [middle, (low + high) / 2, wall.at], size: [to - from - .02, high - low - .02, .1] }
        : { at: [wall.at, (low + high) / 2, middle], size: [.1, high - low - .02, to - from - .02] }
      assert.ok(pieces.every(piece => !overlaps(piece, hole)), "an opening is filled in")
    }
  }
})
