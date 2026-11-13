import { forestLayout, TerrainGeometry, WORLD, CELL, groundDepth, DEPTH } from "./terrain-rules.mjs"
import { paintForest } from "./forest-art.mjs"

export function bodyShape(actor) {
  const b = actor.body, sx = Math.abs(actor.scaleX), sy = Math.abs(actor.scaleY)
  return { rx: b.sourceWidth * sx / 2, ry: b.sourceHeight * sy / 2,
    ox: (b.offset.x + b.sourceWidth / 2 - actor.displayOriginX) * sx,
    oy: (b.offset.y + b.sourceHeight / 2 - actor.displayOriginY) * sy }
}
const centre = (actor, shape) => ({ x: actor.x + shape.ox, y: actor.y + shape.oy })
const unshift = (p, shape) => ({ x: p.x - shape.ox, y: p.y - shape.oy })
const length = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

export class ForestMap {
  constructor(scene) {
    this.s = scene; this.geometry = new TerrainGeometry(forestLayout())
    this.visuals = paintForest(scene, WORLD.width, WORLD.height, this.geometry.props)
    this.solids = scene.physics.add.staticGroup()
    for (const prop of this.geometry.props) {
      const r = prop.footprint
      const zone = scene.add.zone(r.x + r.width / 2, r.y + r.height / 2, r.width, r.height)
      scene.physics.add.existing(zone, true); this.solids.add(zone)
    }
    this.colliders = []
    this.reset(false)
  }
  bind() {
    const s = this.s, enabled = () => this.enabled
    for (const actor of [s.player, s.companion, s.enemies]) {
      this.colliders.push(s.physics.add.collider(actor, this.solids, null, enabled))
    }
    this.colliders.push(s.physics.add.overlap(s.bullets, this.solids,
      bolt => { if (bolt.active) { s.art.impact(bolt.x, bolt.y, bolt.getData("skill")); bolt.destroy() } }, enabled))
  }
  reset(enabled) {
    this.enabled = enabled
    this.routes = new WeakMap(); this.motion = new WeakMap(); this.graphs = new Map()
    this.searches = 0; this.searchesThisFrame = 0
    for (const { image } of this.visuals) image.setAlpha(1)
  }
  beginFrame() { this.searchesThisFrame = 0 }
  endpoint(actor, point, sweep = true) {
    if (!this.enabled) return { ...point }
    const shape = bodyShape(actor), target = { x: point.x + shape.ox, y: point.y + shape.oy }
    return unshift(sweep ? this.geometry.sweep(centre(actor, shape), target, shape) : this.geometry.safe(target, shape), shape)
  }
  place(actor, point, sweep = true) {
    const end = this.endpoint(actor, point, sweep)
    actor.body.reset(end.x, end.y); actor.body.updateFromGameObject()
    actor.body.prev.copy(actor.body.position); actor.body.prevFrame.copy(actor.body.position)
    return end
  }
  restoreActor(actor) { if (this.enabled) this.place(actor, actor, false) }
  lineClear(a, b) {
    return !this.enabled || this.geometry.clear(a, b, { rx: 7, ry: 7 })
  }
  travelClear(actor, point) {
    return !this.enabled || length(this.endpoint(actor, point), point) < .01
  }
  safePoint(point, radius = 8) {
    return this.enabled ? this.geometry.safe(point, { rx: radius, ry: radius }) : point
  }
  graphFor(shape) {
    const radius = Math.ceil(Math.max(shape.rx, shape.ry) / 4) * 4 + 2
    if (this.graphs.has(radius)) return this.graphs.get(radius)
    // Inflate by half a cell: every edge of a navigable cell is body-safe.
    const padding = { rx: radius + CELL / 2, ry: radius + CELL / 2 }
    const columns = Math.floor(WORLD.width / CELL), rows = Math.floor(WORLD.height / CELL)
    const matrix = Array.from({ length: columns }, (_, x) => Array.from({ length: rows }, (_, y) =>
      Number(this.geometry.free({ x: x * CELL + CELL / 2, y: y * CELL + CELL / 2 }, padding))))
    const graph = new Graph(matrix) // Vendored javascript-astar; cardinal edges avoid corner cutting.
    const value = { graph, radius }
    this.graphs.set(radius, value)
    return value
  }
  nodeFor(point, shape, graph, reachableFrom = null) {
    const x = Math.max(0, Math.min(graph.grid.length - 1, Math.floor(point.x / CELL)))
    const y = Math.max(0, Math.min(graph.grid[0].length - 1, Math.floor(point.y / CELL)))
    for (let ring = 0; ring <= 6; ring++) {
      const candidates = []
      for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        const node = graph.grid[x + dx]?.[y + dy]
        if (node?.weight) candidates.push(node)
      }
      candidates.sort((a, b) => length(this.point(a), point) - length(this.point(b), point))
      for (const node of candidates) if (!reachableFrom || this.geometry.clear(reachableFrom, this.point(node), shape)) return node
    }
    return null
  }
  point(node) { return { x: node.x * CELL + CELL / 2, y: node.y * CELL + CELL / 2 } }
  move(actor, target, speed, stop = 10) {
    const s = this.s
    if (!this.enabled) {
      if (length(actor, target) > stop) s.physics.moveTo(actor, target.x, target.y, speed)
      else actor.setVelocity(0)
      return
    }
    const shape = bodyShape(actor), start = centre(actor, shape)
    const goal = this.geometry.safe({ x: target.x + shape.ox, y: target.y + shape.oy }, shape)
    const distanceToGoal = length(start, goal)
    const blocked = actor.body?.blocked && !actor.body.blocked.none
    const touching = actor.body?.touching && !actor.body.touching.none
    const motion = this.motion.get(actor) || { blockedFrames: 0, goal }
    motion.blockedFrames = distanceToGoal > stop && (blocked || touching)
      ? motion.blockedFrames + 1 : 0
    motion.goal = goal
    this.motion.set(actor, motion)
    if (distanceToGoal <= stop) { actor.setVelocity(0); return }
    if (motion.blockedFrames >= 10 && this.recover(actor, start, goal, shape)) {
      motion.blockedFrames = 0
      this.routes.delete(actor)
      return
    }
    if (this.geometry.clear(start, goal, shape)) {
      this.routes.delete(actor); this.velocity(actor, start, goal, speed); return
    }
    let route = this.routes.get(actor)
    if ((!route || s.elapsed >= route.until || length(route.goal, goal) > 72)
      && this.searchesThisFrame < 4) {
      this.searchesThisFrame++; this.searches++
      const { graph } = this.graphFor(shape)
      const from = this.nodeFor(start, shape, graph, start), to = this.nodeFor(goal, shape, graph, goal)
      const nodes = from && to ? astar.search(graph, from, to) : []
      const points = from && nodes.length ? [this.point(from), ...nodes.map(n => this.point(n))] : []
      route = { goal, points, until: s.elapsed + 900 }
      this.routes.set(actor, route)
    }
    if (!route?.points.length) { actor.setVelocity(0); return }
    while (route.points.length > 1 && length(start, route.points[0]) < 9) route.points.shift()
    for (let i = route.points.length - 1; i > 0; i--) {
      if (this.geometry.clear(start, route.points[i], shape)) { route.points.splice(0, i); break }
    }
    const waypoint = route.points[0]
    if (length(start, waypoint) < 7) { route.points.shift(); actor.setVelocity(0); return }
    if (!this.geometry.clear(start, waypoint, shape)) { route.until = 0; actor.setVelocity(0); return }
    this.velocity(actor, start, waypoint, speed)
  }
  recover(actor, start, goal, shape) {
    // A physics collider can leave an actor exactly on a rock edge while its
    // cached route still points into that edge. Nudge to a nearby free point,
    // then let the next frame build a fresh route. The bounded search avoids
    // teleporting through scenery and keeps recovery deterministic.
    if (!this.geometry.free(start, shape)) {
      const safe = this.geometry.safe(start, shape)
      if (length(safe, start) > 1) {
        this.place(actor, unshift(safe, shape), false)
        actor.setVelocity(0)
        return true
      }
    }
    const angle = Math.atan2(goal.y - start.y, goal.x - start.x)
    const offsets = [Math.PI / 2, -Math.PI / 2, Math.PI, 0, Math.PI * .75, -Math.PI * .75]
    let best = null, score = Infinity
    for (const radius of [8, 12, 18, 24, 30]) for (const offset of offsets) {
      const candidate = this.geometry.bounded({
        x: start.x + Math.cos(angle + offset) * radius,
        y: start.y + Math.sin(angle + offset) * radius,
      }, shape)
      if (!this.geometry.free(candidate, shape) || !this.geometry.clear(start, candidate, shape)) continue
      const progress = length(candidate, goal)
      const lateral = Math.abs(Math.sin(offset))
      const value = progress + (offset === 0 ? 12 : 0) - lateral * 2
      if (value < score && length(candidate, start) > 2) { score = value; best = candidate }
    }
    if (!best) return false
    this.place(actor, unshift(best, shape), false)
    actor.setVelocity(0)
    return true
  }
  velocity(actor, start, target, speed) {
    const d = Math.max(1, length(start, target))
    actor.setVelocity((target.x - start.x) / d * speed, (target.y - start.y) / d * speed)
  }
  updateDepth() {
    const s = this.s, party = [s.player, s.companion]
    for (const actor of [...party, ...s.enemies.getChildren()]) {
      const shape = bodyShape(actor)
      actor.setDepth(groundDepth(actor.y + shape.oy + shape.ry))
    }
    for (const { prop, image, canopy } of this.visuals) {
      const covered = (canopy || prop.kind !== "tree") && party.some(actor => {
        const shape = bodyShape(actor), foot = actor.y + shape.oy + shape.ry
        if (foot >= prop.y || foot < prop.y - (canopy ? 155 * prop.scale : 70)) return false
        return Math.abs(actor.x - prop.x) < (canopy ? 73 * prop.scale : prop.footprint.width / 2 + 10)
      })
      image.setAlpha(covered ? canopy ? .38 : .6 : 1)
    }
    s.ring.setDepth(DEPTH.floor); s.partnerRing.setDepth(DEPTH.floor)
  }
  destroy() {
    for (const collider of this.colliders) if (collider.world) collider.destroy()
    this.colliders = []
    this.solids.destroy(true, true)
    this.graphs.clear()
  }
}
