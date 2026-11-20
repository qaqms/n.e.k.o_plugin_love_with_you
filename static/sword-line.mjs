import { SWORDS, swordStats, swordResonance, SKILLS } from "./skills.mjs"

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
// Distance from a point to the segment from `a` to `b`.
function fromSegment(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy || 1
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / length, 0, 1)
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t))
}

// Rule 15 sword line and sword intent. Intent stacks, pending blades, waves and the cut are
// short-lived and are not saved: a load keeps the forms and their levels, not the stacks.
export class SwordLine {
  constructor(combat) { this.c = combat; this.s = combat.s; this.clear() }
  clear() {
    this.tiers = { player: this.tier("player"), companion: this.tier("companion") }
    this.at = { player: {}, companion: {} }; this.intent = new Map(); this.counterAt = 0
    this.lines = []; this.rings = []; this.phantoms = []; this.waves = []; this.blades = []; this.severs = []
  }
  forms(owner) { return this.c.builds[owner].swords || [] }
  has(owner, id) { return this.forms(owner).some(item => item.id === id) }
  ready(owner, id) { return (this.at[owner][id] || 0) <= this.s.elapsed }
  spend(owner, id) { this.at[owner][id] = this.s.elapsed + swordStats(this.c.builds[owner], id).cooldown }
  amount(owner, id) { return this.c.damage(owner, swordStats(this.c.builds[owner], id).damage) }
  tier(owner) { return swordResonance(this.c.builds[owner]).tier }
  stacks(enemy) {
    const mark = this.intent.get(enemy.getData("id"))
    return mark && mark.until > this.s.elapsed ? mark.stacks : 0
  }
  mark(enemy, count = 1) {
    if (!enemy.active) return
    const id = enemy.getData("id"), spec = SWORDS.intent
    this.intent.set(id, { stacks: Math.min(spec.cap, this.stacks(enemy) + count), until: this.s.elapsed + spec.life })
  }
  // Resonance I: an enemy carrying intent takes more from sword hits.
  edge(enemy, owner, amount) { return this.tier(owner) >= 1 && this.stacks(enemy) ? amount * 1.15 : amount }
  // Every sword hit goes through here: the resonance bonus, intent, and the cooldown refund on a kill.
  strike(enemy, owner, amount, count = 1) {
    const s = this.s, c = this.c
    if (!enemy.active || s.outcome !== "playing") return
    c.deal(enemy, this.edge(enemy, owner, amount), owner)
    if (s.outcome !== "playing") return
    if (enemy.active) { this.mark(enemy, count); return }
    this.intent.delete(enemy.getData("id"))
    if (owner === "player" && this.tier("player") >= 2) {
      for (const skill of c.builds.player.skills) if (SKILLS[skill.id].slot === "manual" && skill.ready_at > s.elapsed) {
        skill.ready_at -= (skill.ready_at - s.elapsed) * .1
      }
    }
  }
  live() { return this.s.enemies.getChildren().filter(enemy => enemy.active) }
  // Middle rank, swift school: a long thin line of light toward the nearest enemy.
  flash(owner) {
    const s = this.s, actor = this.c.actor(owner), spec = SWORDS.arts.flash, target = s.nearest(actor, spec.range)
    if (!target) return
    this.spend(owner, "flash")
    const angle = Math.atan2(target.y - actor.y, target.x - actor.x), damage = this.amount(owner, "flash")
    const end = { x: actor.x + Math.cos(angle) * spec.range, y: actor.y + Math.sin(angle) * spec.range }
    this.lines.push({ x: actor.x, y: actor.y, ex: end.x, ey: end.y, angle, born: s.elapsed })
    for (const enemy of this.live()) {
      if (fromSegment(enemy, actor, end) > 22 || !s.terrain.lineClear(actor, enemy)) continue
      this.strike(enemy, owner, damage)
      if (s.outcome !== "playing") return
    }
  }
  // Middle rank, still-water school: a guarding ring, and a counter whenever the player is struck.
  ripple(owner, counter = false) {
    const s = this.s, actor = this.c.actor(owner), spec = SWORDS.arts.ripple
    const near = this.live().filter(enemy => distance(actor, enemy) <= spec.range)
    if (!near.length && !counter) return
    if (!counter) this.spend(owner, "ripple")
    const damage = this.amount(owner, "ripple") * (counter ? 3 : 1)
    this.rings.push({ x: actor.x, y: actor.y, radius: spec.range, born: s.elapsed, counter })
    for (const enemy of near) {
      this.strike(enemy, owner, damage)
      if (s.outcome !== "playing") return
    }
  }
  onHurt() {
    const s = this.s
    if (!this.has("player", "ripple") || this.counterAt > s.elapsed || s.outcome !== "playing") return
    this.counterAt = s.elapsed + 600
    s.hurtUntil = Math.max(s.hurtUntil, s.elapsed + 400)
    this.ripple("player", true)
  }
  // Middle rank, north-star school: phantom blades from odd angles leave deep intent.
  phantom(owner) {
    const s = this.s, actor = this.c.actor(owner), spec = SWORDS.arts.phantom
    const targets = this.live().filter(enemy => distance(actor, enemy) <= spec.range)
      .sort((a, b) => distance(actor, a) - distance(actor, b)).slice(0, 3)
    if (!targets.length) return
    this.spend(owner, "phantom")
    const damage = this.amount(owner, "phantom")
    targets.forEach((enemy, index) => {
      this.phantoms.push({ x: enemy.x, y: enemy.y, angle: [-2.3, -1.2, -.4][index], born: s.elapsed })
      this.strike(enemy, owner, damage, 3)
    })
  }
  // Upper rank: a crescent of sword pressure that pierces the whole lane.
  wave(owner) {
    const s = this.s, actor = this.c.actor(owner), spec = SWORDS.arts.wave, target = s.nearest(actor, spec.range)
    if (!target) return
    this.spend(owner, "wave")
    if (this.waves.length >= 3) this.waves.shift()
    const angle = Math.atan2(target.y - actor.y, target.x - actor.x)
    this.waves.push({ x: actor.x, y: actor.y, angle, vx: Math.cos(angle) * 620, vy: Math.sin(angle) * 620, travel: 0, born: s.elapsed,
      moved_at: s.elapsed, owner, damage: this.amount(owner, "wave"), seen: new Set(), bonus: 0 })
  }
  // Upper rank: eight blades fall in a ring around the swordsman.
  rain(owner) {
    const s = this.s, actor = this.c.actor(owner), spec = SWORDS.arts.rain
    if (!this.live().some(enemy => distance(actor, enemy) <= spec.range)) return
    this.spend(owner, "rain")
    const damage = this.amount(owner, "rain")
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4 - Math.PI / 2
      this.blades.push({ x: actor.x + Math.cos(angle) * 120, y: actor.y + Math.sin(angle) * 120, at: s.elapsed + 70 * i, born: s.elapsed, owner, damage })
    }
  }
  // Saint rank: one cut across the view that spends every stack of intent.
  sever(owner) {
    const s = this.s, actor = this.c.actor(owner)
    if (!this.live().some(enemy => distance(actor, enemy) <= SWORDS.arts.sever.range) || this.severs.some(cut => !cut.done)) return
    this.spend(owner, "sever")
    this.severs.push({ owner, born: s.elapsed, at: s.elapsed + 500, done: 0, damage: this.amount(owner, "sever") })
  }
  cut(sever) {
    const s = this.s, actor = this.c.actor(sever.owner)
    sever.x = actor.x; sever.y = actor.y; sever.done = s.elapsed; sever.hits = 0; sever.spent = 0
    s.art?.shake?.(.016, 360)
    if (!s.art?.reduced) { s.cameras?.main?.flash?.(200, 120, 150, 200); s.art?.hold?.(120) }
    for (const enemy of this.live()) {
      if (distance(actor, enemy) > SWORDS.arts.sever.range) continue
      const stacks = this.stacks(enemy)
      sever.spent += stacks; sever.hits++
      this.intent.delete(enemy.getData("id"))
      this.strike(enemy, sever.owner, sever.damage * (1 + stacks * .35), 0)
      if (s.outcome !== "playing") return
    }
  }
  update() {
    const s = this.s, now = s.elapsed
    for (const owner of ["player", "companion"]) {
      const tier = this.tier(owner)
      if (tier > this.tiers[owner]) {
        const [, name, text] = SWORDS.resonance.tiers[tier - 1]
        this.c.controller.notice(`${owner === "player" ? "" : `${s.meta.character} · `}${SWORDS.resonance.name}${["Ⅰ", "Ⅱ", "Ⅲ"][tier - 1]} · ${name}：${text}`)
      }
      this.tiers[owner] = tier
    }
    for (const owner of ["player", "companion"]) for (const item of this.forms(owner)) {
      if (s.outcome !== "playing") return
      if (this.ready(owner, item.id)) this[item.id](owner)
    }
    for (const wave of [...this.waves]) {
      const step = Math.min(120, now - wave.moved_at) / 1000
      wave.moved_at = now; wave.x += wave.vx * step; wave.y += wave.vy * step; wave.travel += 620 * step
      for (const enemy of this.live()) {
        const id = enemy.getData("id")
        if (wave.seen.has(id) || distance(wave, enemy) > 75) continue
        wave.seen.add(id)
        if (this.stacks(enemy) >= 3) wave.bonus = Math.min(.6, wave.bonus + .1)
        this.strike(enemy, wave.owner, wave.damage * (1 + wave.bonus))
        if (s.outcome !== "playing") return
      }
      const area = s.terrain.geometry.area
      if (wave.travel >= SWORDS.arts.wave.range || wave.x < area.left || wave.x > area.right || wave.y < area.top || wave.y > area.bottom) {
        this.waves.splice(this.waves.indexOf(wave), 1)
      }
    }
    for (const blade of [...this.blades]) {
      if (blade.at > now) continue
      this.blades.splice(this.blades.indexOf(blade), 1)
      blade.landed = now
      this.phantoms.push({ x: blade.x, y: blade.y, angle: -Math.PI / 2, born: now, fall: true })
      for (const enemy of this.live()) {
        if (distance(blade, enemy) > 58) continue
        this.strike(enemy, blade.owner, blade.damage * (this.stacks(enemy) >= 5 ? 2 : 1), 2)
        if (s.outcome !== "playing") return
      }
    }
    for (const sever of this.severs) {
      if (!sever.done && sever.at <= now) this.cut(sever)
      if (s.outcome !== "playing") return
    }
    this.severs = this.severs.filter(cut => !cut.done || now - cut.done < 700)
    this.lines = this.lines.filter(item => now - item.born < 220)
    this.rings = this.rings.filter(item => now - item.born < 320)
    this.phantoms = this.phantoms.filter(item => now - item.born < 420)
    if (this.intent.size > 200 || now % 1000 < 20) for (const [id, mark] of [...this.intent]) if (mark.until <= now) this.intent.delete(id)
  }
}
