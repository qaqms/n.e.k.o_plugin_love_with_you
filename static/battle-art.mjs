import { FRAME_COUNTS, directionFor } from "./actor-art.mjs"
import { DEPTH } from "./terrain-rules.mjs"

export const MAX_PARTICLES = 180
const COLORS = { fire: 0xf3b078, ice: 0xb2e6f0, wind: 0x9cdbcb, slash: 0xf3e2ac, guard: 0xb4d8e4,
  spark: 0xe7db9d, stone: 0xb6c7a0, thrust: 0xf1e3c7, orbit: 0xb4ded8, rune: 0xd5acc3,
  quake: 0xb6c7a0, whirl: 0xe5e4c8, meteor: 0xf2ba8e, heal: 0xade1bd, beacon: 0xb2d9ec }
const TAU = Math.PI * 2

export class BattleArt {
  constructor(scene) {
    this.s = scene
    this.graphics = scene.add.graphics().setDepth(DEPTH.effects + 1)
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
    this.reset()
  }
  reset() {
    this.actors = new WeakMap(); this.particles = []; this.bursts = []
    this.trailAt = 0; this.serial = 0; this.graphics.clear()
  }
  destroy() { this.reset(); this.graphics.destroy() }
  setReduced(value) {
    this.reduced = value
    this.particles = []; this.bursts = []; this.graphics.clear()
  }
  cast(owner, skill, angle = 0) {
    const actor = owner === "player" ? this.s.player : this.s.companion
    const state = this.actors.get(actor) || { direction: "down" }
    state.direction = directionFor(Math.cos(angle) * 10, Math.sin(angle) * 10, state.direction)
    state.castAt = this.s.elapsed; state.castUntil = this.s.elapsed + 320
    this.actors.set(actor, state)
    this.burst(actor.x, actor.y - 5, 18, COLORS[skill] || COLORS.wind, "cast")
  }
  burst(x, y, radius, color, form = "base") {
    if (this.bursts.length >= 24) this.bursts.shift()
    const now = this.s.elapsed
    this.bursts.push({ x, y, radius, color, form, born: now, until: now + (form === "cast" ? 240 : 380) })
    if (this.reduced) return
    const count = form === "shatter" ? 14 : form === "cast" ? 3 : 7
    // Golden-angle distribution is cosmetic and independent of combat randomness.
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      const a = (this.serial++ * 2.399963), speed = 24 + (i % 5) * 17
      this.particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 18,
        born: now, until: now + 260 + (i % 4) * 85, color, size: form === "shatter" ? 3 : 1.5,
        ice: form === "shatter" || form === "frost" })
    }
  }
  impact(x, y, skill) { this.burst(x, y, skill === "fire" ? 23 : 16, COLORS[skill] || COLORS.slash, skill === "ice" ? "frost" : "impact") }
  hurt() {
    const state = this.actors.get(this.s.player) || { direction: "down" }
    state.hurtAt = this.s.elapsed; state.hurtUntil = this.s.elapsed + 160
    this.actors.set(this.s.player, state)
  }
  animate(actor, kind, owner) {
    const velocity = actor.body.velocity, now = this.s.elapsed
    const state = this.actors.get(actor) || { direction: "down", castUntil: 0, castAt: 0 }
    const casting = state.castUntil > now
    if (!casting) state.direction = directionFor(velocity.x, velocity.y, state.direction)
    const hurt = state.hurtUntil > now
    const pose = hurt ? "hurt" : casting ? "cast" : Math.hypot(velocity.x, velocity.y) > 3 ? "walk" : "idle"
    const frame = Math.floor((hurt ? now - state.hurtAt : casting ? now - state.castAt : now) / (pose === "idle" ? 230 : 80)) % FRAME_COUNTS[pose]
    const texture = `${owner === "companion" ? "companion-" : ""}${kind}-${state.direction}-${pose}-${frame}`
    if (actor.frame.name !== texture) actor.setTexture("actors-v2", texture)
    this.actors.set(actor, state)
  }
  update() {
    const s = this.s, now = s.elapsed, g = this.graphics
    this.animate(s.player, s.meta.player_class, "player"); this.animate(s.companion, s.meta.companion_class, "companion")
    for (const enemy of s.enemies.getChildren()) {
      const kind = enemy.getData("kind")
      if (kind === "slime" || kind === "wisp") {
        const frame = Math.floor((now + enemy.getData("id") * 43) / 130) % 6
        const key = `${kind}-motion-${frame}`
        if (enemy.frame.name !== key) enemy.setTexture("actors-v2", key)
      }
    }
    if (!this.reduced && now >= this.trailAt) {
      this.trailAt = now + 45
      for (const bolt of s.bullets.getChildren()) {
        if (this.particles.length >= MAX_PARTICLES) break
        const skill = bolt.getData("skill"), velocity = bolt.body.velocity
        this.particles.push({ x: bolt.x, y: bolt.y, vx: -velocity.x * .06, vy: -velocity.y * .06 - 10,
          born: now, until: now + (skill === "fire" ? 260 : 150), color: COLORS[skill] || COLORS.slash,
          size: skill === "fire" ? 2.5 : 1.5, ice: skill === "ice" })
      }
    }
    this.particles = this.particles.filter(p => p.until > now)
    this.bursts = this.bursts.filter(b => b.until > now)
    g.clear()
    for (const p of this.particles) {
      const t = (now - p.born) / 1000, fade = (p.until - now) / (p.until - p.born)
      const x = p.x + p.vx * t, y = p.y + p.vy * t
      g.fillStyle(p.color, fade * .8)
      if (p.ice) {
        g.fillTriangle(x, y - p.size * 2, x - p.size, y + p.size, x + p.size, y + p.size)
      } else g.fillEllipse(x, y, p.size * 2 * fade, p.size * 3 * fade)
    }
    for (const b of this.bursts) {
      const t = Math.min(1, (now - b.born) / (b.until - b.born)), r = b.radius * (.35 + t * .65)
      g.lineStyle(b.form === "cast" ? 1 : 2, b.color, (1 - t) * .65)
      g.beginPath().arc(b.x, b.y, r, t * 2, t * 2 + Math.PI * 1.5).strokePath()
      if (b.form === "shatter" || b.form === "frost") {
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * TAU
          g.lineBetween(b.x + Math.cos(a) * r * .45, b.y + Math.sin(a) * r * .45,
            b.x + Math.cos(a) * r, b.y + Math.sin(a) * r)
        }
      } else if (b.form === "heal") {
        g.lineStyle(3, b.color, 1 - t).lineBetween(b.x - 12, b.y, b.x + 12, b.y)
          .lineBetween(b.x, b.y - 12, b.x, b.y + 12)
      } else if (["quake", "stone", "meteor", "rune"].includes(b.form)) {
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * TAU, x = b.x + Math.cos(a) * r * .7, y = b.y + Math.sin(a) * r * .7
          g.fillStyle(b.color, (1 - t) * .7).fillTriangle(x - 5, y + 4, x, y - 14 * (1 - t), x + 5, y + 4)
        }
      } else if (b.form === "impact") {
        g.fillStyle(0xfff0ce, (1 - t) * .55).fillEllipse(b.x, b.y, r * .65, r * .55)
      }
    }
  }
}

export function paintCombat(combat) {
  const g = combat.graphics, now = combat.s.elapsed, reduced = combat.s.art?.reduced
  g.clear()
  for (const z of combat.zones) {
    if (combat.expanded?.isZone(z.kind)) continue
    const color = z.kind === "flame" ? COLORS.fire : z.kind === "frost" ? COLORS.ice : COLORS.wind
    g.fillStyle(color, z.kind === "flame" ? .12 : .07).fillCircle(z.x, z.y, z.radius)
    g.lineStyle(1.5, color, .65).strokeCircle(z.x, z.y, z.radius)
    const turn = reduced ? 0 : now / (z.kind === "pull" ? 500 : 2400)
    for (let i = 0; i < (reduced ? 4 : 10); i++) {
      const a = i / 10 * TAU + turn
      const radius = z.radius * (.66 + Math.sin(i * 5 + turn) * .13)
      if (z.kind === "flame") {
        const x = z.x + Math.cos(a) * radius, y = z.y + Math.sin(a) * radius
        const size = 8 + Math.sin(i * 3 + turn * 5) * 4
        g.fillStyle(0xdd7c66, .45).fillTriangle(x - 5, y + 4, x + 5, y + 3, x + 2, y - size)
        g.fillStyle(0xf4d6a0, .65).fillTriangle(x - 2, y + 3, x + 2, y + 2, x, y - size * .7)
      } else if (z.kind === "frost") {
        const x = z.x + Math.cos(a) * radius, y = z.y + Math.sin(a) * radius
        g.lineStyle(1, color, .65).lineBetween(z.x, z.y, x, y)
        g.fillStyle(0xc3e9ed, .4).fillTriangle(x - 3, y + 3, x + 3, y + 3, x + 1, y - 10)
      } else {
        g.lineStyle(2, color, .45).beginPath()
          .arc(z.x, z.y, radius, a, a + .65).strokePath()
      }
    }
  }
  combat.flashes = combat.flashes.filter(f => f.until > now)
  for (const f of combat.flashes) {
    if (f.form === "base") continue
    const fade = Math.min(1, (f.until - now) / 320)
    g.lineStyle(1.5, f.color, fade * .55).strokeCircle(f.x, f.y, f.radius * (1.05 - fade * .2))
  }
  if (combat.lastSlash?.until > now) {
    const slash = combat.lastSlash, fade = Math.min(1, (slash.until - now) / (combat.modern ? 220 : 130))
    const start = slash.angle - slash.half, end = slash.angle + slash.half
    const points = []
    for (let i = 0; i <= 16; i++) {
      const a = start + (end - start) * i / 16
      points.push({ x: slash.x + Math.cos(a) * slash.range, y: slash.y + Math.sin(a) * slash.range })
    }
    for (let i = 16; i >= 0; i--) {
      const a = start + (end - start) * i / 16
      points.push({ x: slash.x + Math.cos(a) * slash.range * .7, y: slash.y + Math.sin(a) * slash.range * .7 })
    }
    g.fillStyle(slash.color, fade * .25).fillPoints(points, true)
    g.lineStyle(3, 0xf7efcb, fade * .8).beginPath().arc(slash.x, slash.y, slash.range, start, end).strokePath()
    g.lineStyle(1, slash.color, fade * .7).beginPath().arc(slash.x, slash.y, slash.range * .83, start + .08, end - .08).strokePath()
  }
  combat.expanded?.paint(g)
  combat.frost?.paint(g)
}
