import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { STOPS, STOP_KINDS, installStops, offersStop, stopDoor, openStop, eventOf, canBuy, choose, shardsFor, emptyStops } from "../../static/stop-rules.mjs"
import { installJourney, settlementFor } from "../../static/journey-rules.mjs"

const data = file => JSON.parse(readFileSync(new URL(`../../static/${file}.json`, import.meta.url), "utf8"))
installStops(data("stops")); installJourney(data("journey"))
const random = seed => ({ between(a, b) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return a + seed % (b - a + 1) } })

test("one stop door after each area's first fight, of any of the three kinds", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].filter(offersStop), [1, 4, 7])
  const seen = new Set()
  for (let seed = 1; seed <= 30; seed++) {
    const door = stopDoor(random(seed))
    assert.deepEqual([door.goal, door.hard, door.need], ["stop", false, 0])
    seen.add(door.reward)
  }
  assert.deepEqual([...seen].sort(), [...STOP_KINDS].sort())
})

test("a merchant lays out three different wares; an encounter is one known event; a camp holds nothing", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const shop = openStop("shop", random(seed))
    assert.equal(new Set(shop.offer).size, 3)
    assert.ok(shop.offer.every(id => STOPS.items[id]))
    assert.ok(eventOf(openStop("event", random(seed))))
  }
  assert.deepEqual(openStop("camp", random(1)), { kind: "camp", offer: [], bought: [] })
})

test("wares cost shards, sell once, and a second charm is not offered while one is held", () => {
  const shop = { kind: "shop", offer: ["study", "charm", "mend"], bought: [] }
  const journey = { ...emptyStops(), shards: 7 }
  assert.ok(canBuy(shop, journey, "study") && canBuy(shop, journey, "mend"))
  assert.ok(!canBuy(shop, journey, "charm"), "8 shards needed")
  assert.ok(!canBuy(shop, journey, "power"), "not on offer")
  journey.shards = 20
  assert.ok(canBuy(shop, journey, "charm"))
  journey.charm = true
  assert.ok(!canBuy(shop, journey, "charm"))
  shop.bought.push("study")
  assert.ok(!canBuy(shop, journey, "study"))
})

test("encounter options give their listed effects; a gamble lands on either side", () => {
  const chest = { kind: "event", offer: ["chest"], bought: [] }
  assert.deepEqual(choose(chest, 0, random(1)).effects, [["shards", 5]])
  const sides = new Set()
  for (let seed = 1; seed <= 20; seed++) sides.add(JSON.stringify(choose(chest, 1, random(seed)).effects))
  assert.deepEqual([...sides].sort(), [JSON.stringify([["hurt", 0.25]]), JSON.stringify([["shards", 12]])].sort())
  assert.equal(choose(chest, 2, random(1)), null)
  assert.equal(STOPS.events.length, 6)
})

test("shards: fights, hard fights and gatekeepers pay, the escort boon doubles, and a stop still counts as cleared", () => {
  assert.deepEqual([shardsFor("fight", false, ""), shardsFor("fight", true, ""), shardsFor("elite", false, ""), shardsFor("boss", false, "")], [3, 6, 8, 0])
  assert.equal(shardsFor("fight", true, "bounty"), 12)
  assert.equal(shardsFor("fight", false, "power"), 3)
  const snapshot = { outcome: "retreated", journey: { node: 0, phase: "stop", hard_cleared: 0 } }
  assert.equal(settlementFor(snapshot).nodes, 1)
  assert.throws(() => installStops({ ...data("stops"), camp: [] }))
})
