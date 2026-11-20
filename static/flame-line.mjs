import { CASTS, castStats } from "./skills.mjs"
import { isBoss } from "./encounter-rules.mjs"

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
// Distance from a point to the segment that runs `half` either side of a centre across `angle`.
function fromSegment(point, line) {
  const dx = Math.cos(line.angle), dy = Math.sin(line.angle)
  const t = clamp((point.x - line.x) * dx + (point.y - line.y) * dy, -line.half, line.half)
  return Math.hypot(point.x - (line.x + dx * t), point.y - (line.y + dy * t))
}

// Rule 13 manual fire line. Pressing the flame ring key casts every learned form in order.
// Walls, rolling orbs, rifts, the domain (field) and pillars are short-lived and are not saved;
// a load restores the cooldown, not the chain in flight.
export class FlameLine {
  constructor(combat) { this.c = combat; this.s = combat.s; this.clear() }
  clear() { this.queue = []; this.walls = []; this.orbs = []; this.rifts = []; this.field = null; this.pending = []; this.pillars = []; this.boltAt = 0 }
  casts() { return this.c.builds.player.casts || [] }
  active() { return this.casts().length > 0 }
  boost() { return this.field && this.field.until > this.s.elapsed ? 1.25 : 1 }
  amount(id, scale) { return this.c.damage("player", castStats(this.c.builds.player, id).damage) * scale }
  // Returns the aimed point, or null when nothing is in reach, so the cooldown is not spent.
  cast(skill, p, cadence, embers) {
    const s = this.s, c = this.c, casts = this.casts(), top = casts.at(-1)
    const reach = Math.max(p.range, ...casts.map(cast => CASTS.arts[cast.id].range))
    const target = c.targetGroup(s.player, reach)
    if (!target) return null
    const spot = { x: target.x, y: target.y }
    skill.ready_at = s.elapsed + castStats(c.builds.player, top.id).cooldown * cadence
    c.addZone("flame", "player", spot, p.radius, c.damage("player", p.damage) * CASTS.lower * embers, p.duration)
    casts.forEach((cast, index) => this.queue.push({ id: cast.id, at: s.elapsed + CASTS.gap * (index + 1), x: spot.x, y: spot.y,
      scale: index === casts.length - 1 ? 1 : CASTS.lower }))
    return spot
  }
  aim(step) {
    const s = this.s, found = this.c.targetGroup(s.player, CASTS.arts[step.id].range)
    return found ? { x: found.x, y: found.y } : { x: step.x, y: step.y }
  }
  wall(step) {
    const s = this.s, t = this.aim(step), angle = Math.atan2(t.y - s.player.y, t.x - s.player.x) + Math.PI / 2
    if (this.walls.length >= 3) this.walls.shift()
    this.walls.push({ x: t.x, y: t.y, angle, half: 150, born: s.elapsed, until: s.elapsed + 6000, tick_at: s.elapsed, damage: this.amount("wall", step.scale) })
    s.art?.shake?.(.004, 140)
  }
  orb(step) {
    const s = this.s, t = this.aim(step), angle = Math.atan2(t.y - s.player.y, t.x - s.player.x)
    if (this.orbs.length >= 2) this.orbs.shift()
    this.orbs.push({ x: s.player.x, y: s.player.y, vx: Math.cos(angle) * 340, vy: Math.sin(angle) * 340, tx: t.x, ty: t.y,
      radius: 54, born: s.elapsed, until: s.elapsed + 2400, moved_at: s.elapsed, seen: new Map(), damage: this.amount("orb", step.scale) })
  }
  rift(step) {
    const s = this.s, t = this.aim(step), angle = Math.atan2(t.y - s.player.y, t.x - s.player.x), area = s.terrain.geometry.area
    const damage = this.amount("rift", step.scale), segments = []
    for (let i = 0; i < 7; i++) {
      const x = s.player.x + Math.cos(angle) * (70 + i * 75), y = s.player.y + Math.sin(angle) * (70 + i * 75)
      if (x < area.left || x > area.right || y < area.top || y > area.bottom) break
      segments.push({ x, y, at: s.elapsed + i * 110, done: false })
    }
    if (segments.length) this.rifts.push({ angle, born: s.elapsed, damage, segments })
  }
  domain(step) {
    const s = this.s
    this.field = { radius: 200, born: s.elapsed, until: s.elapsed + 8000, tick_at: s.elapsed, damage: this.amount("domain", step.scale) }
  }
  pillar(step) {
    const s = this.s, t = this.aim(step)
    this.pending.push({ ...t, born: s.elapsed, at: s.elapsed + 500, damage: this.amount("pillar", step.scale) })
  }
  // The great pillar, its ring of small pillars, and one answering pillar on every fire already on the ground.
  erupt(blast) {
    const s = this.s, c = this.c, small = []
    this.raise(blast, 130, blast.damage, true)
    if (s.outcome !== "playing") return
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3 + blast.at % 1
      small.push({ x: blast.x + Math.cos(angle) * 170, y: blast.y + Math.sin(angle) * 170, at: s.elapsed + 90 * (i + 1) })
    }
    const grounds = [...(c.line?.pools || []), ...c.zones.filter(zone => zone.kind === "flame" && zone.owner === "player"), ...this.walls]
      .filter(fire => distance(fire, blast) > 60).slice(0, 8)
    grounds.forEach((fire, i) => small.push({ x: fire.x, y: fire.y, at: s.elapsed + 600 + 70 * i }))
    for (const spot of small) this.pending.push({ ...spot, born: s.elapsed, damage: blast.damage * .4, small: true })
    blast.linked = grounds.length
  }
  raise(spot, radius, damage, big) {
    const s = this.s
    this.pillars.push({ x: spot.x, y: spot.y, radius, born: s.elapsed, big })
    if (this.pillars.length > 16) this.pillars.shift()
    if (big) { s.art?.shake?.(.014, 360); if (!s.art?.reduced) s.cameras?.main?.flash?.(200, 255, 190, 110) }
    this.c.splash(spot, radius, damage, "player", null, big ? "meteor" : "awakened")
  }
  // Link: a fire bolt that hits an enemy inside the domain bursts once more.
  onBolt(enemy, owner, damage) {
    const s = this.s
    if (owner !== "player" || !this.field || this.boltAt > s.elapsed || distance(enemy, s.player) > this.field.radius) return
    this.boltAt = s.elapsed + 300
    this.c.splash({ x: enemy.x, y: enemy.y }, 60, damage * .5, owner, enemy)
  }
  // Flash link: walls and the domain answer the saint-rank fire bolt line.
  fires() {
    return [...this.walls.map(wall => ({ x: wall.x, y: wall.y, radius: 150 })),
      ...(this.field ? [{ x: this.s.player.x, y: this.s.player.y, radius: this.field.radius }] : [])]
  }
  update() {
    const s = this.s, c = this.c, now = s.elapsed
    for (const step of [...this.queue]) {
      if (step.at > now) continue
      this.queue.splice(this.queue.indexOf(step), 1)
      this[step.id](step)
      s.art?.cast?.("player", "flame", Math.atan2(step.y - s.player.y, step.x - s.player.x))
    }
    for (const wall of [...this.walls]) {
      if (wall.until <= now) { this.walls.splice(this.walls.indexOf(wall), 1); continue }
      const inside = s.enemies.getChildren().filter(enemy => enemy.active && fromSegment(enemy, wall) <= 38)
      for (const enemy of inside) if (!isBoss(enemy)) enemy.setVelocity(enemy.body.velocity.x * .4, enemy.body.velocity.y * .4)
      if (wall.tick_at > now) continue
      wall.tick_at = now + 500
      for (const enemy of inside) {
        c.deal(enemy, wall.damage, "player")
        if (s.outcome !== "playing") return
        c.ignite(enemy, "player", wall.damage * 4)
      }
    }
    for (const orb of [...this.orbs]) {
      const step = Math.min(120, now - orb.moved_at) / 1000
      orb.moved_at = now; orb.x += orb.vx * step; orb.y += orb.vy * step
      for (const enemy of [...s.enemies.getChildren()]) {
        if (!enemy.active || distance(orb, enemy) > orb.radius + 10) continue
        const id = enemy.getData("id")
        if ((orb.seen.get(id) || 0) > now) continue
        orb.seen.set(id, now + 350)
        c.deal(enemy, orb.damage, "player")
        if (s.outcome !== "playing") return
        c.ignite(enemy, "player", orb.damage)
      }
      const area = s.terrain.geometry.area
      const arrived = Math.hypot(orb.tx - orb.x, orb.ty - orb.y) < 14 || (orb.tx - orb.x) * orb.vx + (orb.ty - orb.y) * orb.vy < 0
      if (!arrived && orb.until > now && orb.x > area.left && orb.x < area.right && orb.y > area.top && orb.y < area.bottom) continue
      this.orbs.splice(this.orbs.indexOf(orb), 1)
      s.art?.shake?.(.01, 260)
      c.splash(orb, 150, orb.damage * 3, "player", null, "meteor")
      if (s.outcome !== "playing") return
    }
    for (const rift of [...this.rifts]) {
      for (const [index, segment] of rift.segments.entries()) {
        if (segment.done || segment.at > now) continue
        segment.done = true
        c.splash(segment, 72, rift.damage, "player", null, index === rift.segments.length - 1 ? "meteor" : "awakened")
        if (s.outcome !== "playing") return
      }
      if (now - rift.born > 110 * rift.segments.length + 900) this.rifts.splice(this.rifts.indexOf(rift), 1)
    }
    const domain = this.field
    if (domain && domain.until <= now) this.field = null
    else if (domain && domain.tick_at <= now) {
      domain.tick_at = now + 500
      for (const enemy of [...s.enemies.getChildren()]) {
        if (!enemy.active || distance(enemy, s.player) > domain.radius) continue
        c.deal(enemy, domain.damage, "player")
        if (s.outcome !== "playing") return
        c.ignite(enemy, "player", domain.damage * 4)
      }
    }
    for (const blast of [...this.pending]) {
      if (blast.at > now) continue
      this.pending.splice(this.pending.indexOf(blast), 1)
      if (blast.small) this.raise(blast, 70, blast.damage, false)
      else this.erupt(blast)
      if (s.outcome !== "playing") return
    }
    this.pillars = this.pillars.filter(item => now - item.born < 900)
  }
}
