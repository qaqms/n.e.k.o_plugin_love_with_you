import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"
import { TerrainGeometry, forestLayout, CELL } from "../static/terrain-rules.mjs"
import { ForestMap } from "../static/forest-map.mjs"

const require = createRequire(import.meta.url)
const { Graph, astar } = require("./game/node_modules/javascript-astar/astar.js")
globalThis.Graph = Graph; globalThis.astar = astar
const shape = { rx: 12, ry: 12 }

test("sweeps stop before masonry from both directions, including thin walls and glancing contact", () => {
  const geometry = new TerrainGeometry([{ footprint: { x: 400, y: 400, width: 80, height: 16 } }])
  for (const [a, b, axis, bound, relation] of [
    [{ x: 250, y: 407 }, { x: 650, y: 407 }, "x", 388, "less"],
    [{ x: 650, y: 407 }, { x: 250, y: 407 }, "x", 492, "more"],
    [{ x: 440, y: 250 }, { x: 440, y: 650 }, "y", 388, "less"],
    [{ x: 440, y: 650 }, { x: 440, y: 250 }, "y", 428, "more"],
  ]) {
    const end = geometry.sweep(a, b, shape)
    assert.ok(relation === "less" ? end[axis] < bound : end[axis] > bound)
    assert.ok(geometry.free(end, shape))
  }
  assert.deepEqual(geometry.sweep({ x: 200, y: 380 }, { x: 700, y: 380 }, shape), { x: 700, y: 380 })
  const end = geometry.sweep({ x: 300, y: 300 }, { x: 600, y: 600 }, shape)
  assert.ok(end.x < 388 && end.y < 388)
})

test("recovery is deterministic, bounded and does not consume any random source", () => {
  const geometry = new TerrainGeometry()
  for (const prop of geometry.props) for (const radius of [8, 12, 28]) {
    const body = { rx: radius, ry: radius }, point = { x: prop.x, y: prop.y - 5 }
    const first = geometry.safe(point, body), second = geometry.safe(point, body)
    assert.deepEqual(first, second)
    assert.ok(geometry.free(first, body), prop.id)
  }
  assert.ok(geometry.free(geometry.safe({ x: -900, y: 9000 }, shape), shape))
  assert.equal(new Set(forestLayout().map(p => p.id)).size, forestLayout().length)
})

test("the navigation grids connect all walkable space and the central platform has open exits", () => {
  const map = Object.create(ForestMap.prototype)
  map.geometry = new TerrainGeometry(); map.graphs = new Map()
  for (const radius of [10, 18, 27]) {
    const { graph } = map.graphFor({ rx: radius, ry: radius })
    const start = map.nodeFor({ x: 900, y: 600 }, { rx: radius, ry: radius }, graph)
    const visited = new Set([start]), queue = [start]
    while (queue.length) {
      const node = queue.pop()
      for (const neighbour of graph.neighbors(node)) {
        if (!neighbour.weight || visited.has(neighbour)) continue
        visited.add(neighbour); queue.push(neighbour)
      }
    }
    const walkable = graph.nodes.filter(n => n.weight).length
    assert.equal(visited.size, walkable, `isolated pocket for body radius ${radius}`)
    for (const point of [{ x: 300, y: 600 }, { x: 1500, y: 600 }, { x: 900, y: 200 }, { x: 900, y: 1000 }]) {
      const end = map.nodeFor(point, { rx: radius, ry: radius }, graph)
      assert.ok(astar.search(graph, start, end).length > 0)
    }
  }
  assert.equal(CELL, 24)
})

test("cached A* route goes around a visible rock without crossing an inflated footprint", () => {
  const map = Object.create(ForestMap.prototype)
  map.geometry = new TerrainGeometry(); map.graphs = new Map()
  const { graph } = map.graphFor(shape)
  const a = { x: 590, y: 410 }, b = { x: 770, y: 410 }
  assert.equal(map.geometry.clear(a, b, shape), false)
  const from = map.nodeFor(a, shape, graph, a), to = map.nodeFor(b, shape, graph, b)
  const path = [a, map.point(from), ...astar.search(graph, from, to).map(n => map.point(n)), b]
  assert.ok(path.length > 3)
  for (let i = 1; i < path.length; i++) assert.ok(map.geometry.clear(path[i - 1], path[i], shape))
})

test("stuck actors receive a bounded lateral recovery before their route is rebuilt", () => {
  const map = Object.create(ForestMap.prototype)
  map.s = { elapsed: 1000 }; map.enabled = true
  map.geometry = new TerrainGeometry([{ footprint: { x: 400, y: 400, width: 80, height: 80 } }])
  map.routes = new WeakMap(); map.motion = new WeakMap(); map.graphs = new Map()
  map.searches = 0; map.searchesThisFrame = 0
  const actor = {
    x: 350, y: 440, scaleX: 1, scaleY: 1, displayOriginX: 0, displayOriginY: 0,
    body: { sourceWidth: 24, sourceHeight: 24, offset: { x: 0, y: 0 }, velocity: { x: 20, y: 0 },
      blocked: { left: false, right: true, up: false, down: false, none: false },
      reset(x, y) { actor.x = x; actor.y = y }, updateFromGameObject() {},
      prev: { copy() {} }, prevFrame: { copy() {} } },
    setVelocity(x, y = x) { this.body.velocity = { x, y }; return this },
  }
  for (let i = 0; i < 12; i++) {
    map.beginFrame()
    map.move(actor, { x: 650, y: 440 }, 80)
    map.s.elapsed += 50
  }
  assert.ok(actor.x !== 350 || actor.y !== 440)
  assert.ok(map.geometry.free({ x: actor.x, y: actor.y }, { rx: 12, ry: 12 }))
  const embedded = {
    x: 420, y: 440, scaleX: 1, scaleY: 1, displayOriginX: 0, displayOriginY: 0,
    body: { sourceWidth: 24, sourceHeight: 24, offset: { x: 0, y: 0 }, velocity: { x: 20, y: 0 },
      blocked: { left: false, right: true, up: false, down: false, none: false },
      reset(x, y) { embedded.x = x; embedded.y = y }, updateFromGameObject() {},
      prev: { copy() {} }, prevFrame: { copy() {} } },
    setVelocity(x, y = x) { this.body.velocity = { x, y }; return this },
  }
  map.motion = new WeakMap(); map.routes = new WeakMap()
  for (let i = 0; i < 12; i++) {
    map.beginFrame()
    map.move(embedded, { x: 650, y: 440 }, 80)
    map.s.elapsed += 50
  }
  assert.ok(map.geometry.free({ x: embedded.x + 12, y: embedded.y + 12 }, { rx: 12, ry: 12 }))
})
