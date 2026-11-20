import { LINE, artOf, artStats } from "./skills.mjs"
import { isBoss } from "./encounter-rules.mjs"

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const turn = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

// Rule 11 fire line: the advanced forms a finished fire bolt grows into.
// Their timers, pending blasts and lava pools are short-lived and are not saved.
export class FireLine {
  constructor(combat) {
    this.c = combat; this.s = combat.s
    this.at = { player: {}, companion: {} }
    this.pending = []; this.pools = []; this.slashes = []; this.orbs = []; this.flashes = []
  }
  clear() { this.pending = []; this.pools = []; this.slashes = []; this.orbs = []; this.flashes = []; this.at = { player: {}, companion: {} } }
  arts(owner) { return this.c.builds[owner].arts || [] }
  ready(owner, id) { return (this.at[owner][id] || 0) <= this.s.elapsed }
  spend(owner, id) { this.at[owner][id] = this.s.elapsed + artStats(this.c.builds[owner], id).cooldown }
  amount(owner, id) { return this.c.damage(owner, artStats(this.c.builds[owner], id).damage) }
  blade(owner) {
    const s = this.s, c = this.c, actor = c.actor(owner), range = LINE.arts.blade.range
    const target = s.nearest(actor, range)
    if (!target) return
    const angle = Math.atan2(target.y - actor.y, target.x - actor.x), damage = this.amount(owner, "blade")
    this.spend(owner, "blade")
    this.slashes.push({ x: actor.x, y: actor.y, angle, range, born: s.elapsed })
    for (const enemy of [...s.enemies.getChildren()]) {
      if (!enemy.active || distance(actor, enemy) > range || !s.terrain.lineClear(actor, enemy)) continue
      if (turn(Math.atan2(enemy.y - actor.y, enemy.x - actor.x), angle) > 1.05) continue
      c.deal(enemy, damage, owner)
      if (s.outcome !== "playing") return
      c.ignite(enemy, owner, damage)
    }
  }
  spray(owner) {
    const s = this.s, c = this.c, actor = c.actor(owner), range = LINE.arts.spray.range
    const target = s.nearest(actor, range)
    if (!target) return
    const angle = Math.atan2(target.y - actor.y, target.x - actor.x), damage = this.amount(owner, "spray")
    this.spend(owner, "spray")
    // A stream of small painted bursts walks out along the cone, with loose flames around it.
    this.puff = (this.puff || 0) + 1
    for (const [at, size] of [[.3 + (this.puff % 3) * .1, 34], [.62 + (this.puff % 2) * .14, 46], [.95, 40]]) {
      const wobble = ((this.puff * 7 + size) % 5 - 2) * .07
      s.fireArt?.boom(actor.x + Math.cos(angle + wobble) * range * at, actor.y + Math.sin(angle + wobble) * range * at, size)
    }
    s.art?.spray?.("fx-tongue", actor.x, actor.y, 3, { angle, spread: .7, speed: 520, life: 380, tint: 0xff8a3c, from: .9, to: .3, aim: true, offset: 16 })
    for (const enemy of [...s.enemies.getChildren()]) {
      if (!enemy.active || distance(actor, enemy) > range || !s.terrain.lineClear(actor, enemy)) continue
      if (turn(Math.atan2(enemy.y - actor.y, enemy.x - actor.x), angle) > .42) continue
      c.deal(enemy, damage, owner)
      if (s.outcome !== "playing") return
      c.ignite(enemy, owner, damage * 5)
    }
  }
  // Prefer a crowd that is already burning, so earlier forms set the blast up.
  crowd(actor, range) {
    const s = this.s, live = s.enemies.getChildren().filter(e => e.active && distance(actor, e) <= range)
    let best = null, score = 0
    for (const enemy of live) {
      const near = live.filter(other => distance(enemy, other) <= 95)
      const value = near.length + near.filter(other => this.c.burns.has(other.getData("id"))).length * .5
      if (value > score) { best = enemy; score = value }
    }
    return best
  }
  burst(owner) {
    const target = this.crowd(this.c.actor(owner), LINE.arts.burst.range)
    if (!target || this.pending.length >= 6) return
    this.spend(owner, "burst")
    this.pending.push({ x: target.x, y: target.y, radius: 95, at: this.s.elapsed + 600, born: this.s.elapsed, owner, damage: this.amount(owner, "burst") })
  }
  magma(owner) {
    const target = this.crowd(this.c.actor(owner), LINE.arts.magma.range)
    if (!target) return
    this.spend(owner, "magma")
    if (this.pools.length >= 3) this.pools.shift()
    this.pools.push({ x: target.x, y: target.y, radius: 110, born: this.s.elapsed, until: this.s.elapsed + 5000, tick_at: this.s.elapsed,
      erupt_at: 0, owner, damage: this.amount(owner, "magma") })
  }
  // Upper rank: a slow ball of black fire that rolls through the crowd and grows on burning enemies.
  hellfire(owner) {
    const s = this.s, actor = this.c.actor(owner), spec = LINE.arts.hellfire
    const target = this.crowd(actor, spec.range)
    if (!target) return
    this.spend(owner, "hellfire")
    if (this.orbs.length >= 2) this.orbs.shift()
    const angle = Math.atan2(target.y - actor.y, target.x - actor.x)
    this.orbs.push({ x: actor.x, y: actor.y, vx: Math.cos(angle) * 150, vy: Math.sin(angle) * 150, born: s.elapsed, until: s.elapsed + 3600,
      radius: 46, grow: 0, owner, damage: this.amount(owner, "hellfire"), seen: new Map(), moved_at: s.elapsed })
  }
  // Saint rank: after a short gathering the whole field ignites, and every fire already burning answers.
  flash(owner) {
    const s = this.s, actor = this.c.actor(owner)
    if (!s.enemies.getChildren().some(enemy => enemy.active && distance(actor, enemy) <= LINE.arts.flash.range)) return
    this.spend(owner, "flash")
    this.flashes.push({ owner, born: s.elapsed, at: s.elapsed + 500, done: 0, damage: this.amount(owner, "flash") })
  }
  ignition(flash) {
    const s = this.s, c = this.c, actor = c.actor(flash.owner), owner = flash.owner
    flash.x = actor.x; flash.y = actor.y; flash.done = s.elapsed
    s.art?.shake?.(.012, 320)
    if (!s.art?.reduced) s.cameras?.main?.flash?.(260, 255, 196, 120)
    for (const enemy of [...s.enemies.getChildren()]) {
      if (!enemy.active || distance(actor, enemy) > LINE.arts.flash.range) continue
      const burn = c.burns.get(enemy.getData("id"))
      c.deal(enemy, flash.damage + (burn ? burn.damage * 8 : 0), owner)
      if (s.outcome !== "playing") return
      if (burn && enemy.active) s.fireArt?.boom(enemy.x, enemy.y, 46)
      c.ignite(enemy, owner, flash.damage)
    }
    const fires = [...this.pools.map(pool => ({ x: pool.x, y: pool.y, radius: pool.radius })),
      ...this.pending.map(blast => ({ x: blast.x, y: blast.y, radius: blast.radius })),
      ...c.zones.filter(zone => zone.kind === "flame").map(zone => ({ x: zone.x, y: zone.y, radius: zone.radius })),
      ...(owner === "player" ? c.flameLine?.fires() || [] : [])]
    for (const fire of fires) {
      c.splash(fire, Math.min(200, fire.radius), flash.damage * 1.6, owner, null, "meteor")
      if (s.outcome !== "playing") return
    }
    flash.erupted = fires.length
  }
  // Link: a fire bolt that hits an enemy standing in lava raises a pillar of flame.
  onBolt(enemy, owner, damage) {
    const pool = this.pools.find(item => item.erupt_at <= this.s.elapsed && distance(item, enemy) <= item.radius)
    if (!pool) return
    pool.erupt_at = this.s.elapsed + 800
    this.c.splash({ x: enemy.x, y: enemy.y }, 70, damage * 1.5 + pool.damage * 2, owner, null, "meteor")
  }
  update() {
    const s = this.s, c = this.c, now = s.elapsed
    for (const owner of ["player", "companion"]) for (const art of this.arts(owner)) {
      if (s.outcome !== "playing") return
      if (this.ready(owner, art.id)) this[art.id](owner)
    }
    for (const blast of [...this.pending]) {
      if (blast.at > now) continue
      this.pending.splice(this.pending.indexOf(blast), 1)
      c.splash(blast, blast.radius, blast.damage, blast.owner, null, "meteor")
      if (s.outcome !== "playing") return
    }
    for (const pool of [...this.pools]) {
      if (pool.until <= now) { this.pools.splice(this.pools.indexOf(pool), 1); continue }
      const inside = s.enemies.getChildren().filter(enemy => enemy.active && distance(pool, enemy) <= pool.radius)
      for (const enemy of inside) if (!isBoss(enemy)) enemy.setVelocity(enemy.body.velocity.x * .55, enemy.body.velocity.y * .55)
      if (pool.tick_at > now) continue
      pool.tick_at = now + 500
      for (const enemy of inside) {
        c.deal(enemy, pool.damage, pool.owner)
        if (s.outcome !== "playing") return
        c.ignite(enemy, pool.owner, pool.damage * 4)
      }
    }
    for (const orb of [...this.orbs]) {
      const step = Math.min(120, now - orb.moved_at) / 1000
      orb.moved_at = now; orb.x += orb.vx * step; orb.y += orb.vy * step
      const area = s.terrain.geometry.area, size = orb.radius * (1 + orb.grow)
      for (const enemy of [...s.enemies.getChildren()]) {
        if (!enemy.active || distance(orb, enemy) > size + 10) continue
        const id = enemy.getData("id")
        if ((orb.seen.get(id) || 0) > now) continue
        orb.seen.set(id, now + 400)
        if (c.burns.has(id)) orb.grow = Math.min(.6, orb.grow + .06)
        c.deal(enemy, orb.damage * (1 + orb.grow), orb.owner)
        if (s.outcome !== "playing") return
        c.ignite(enemy, orb.owner, orb.damage)
      }
      if (orb.until > now && orb.x > area.left && orb.x < area.right && orb.y > area.top && orb.y < area.bottom) continue
      this.orbs.splice(this.orbs.indexOf(orb), 1)
      c.splash(orb, Math.min(200, 120 * (1 + orb.grow * .5)), orb.damage * 2 * (1 + orb.grow), orb.owner, null, "meteor")
      if (s.outcome !== "playing") return
    }
    for (const flash of this.flashes) {
      if (!flash.done && flash.at <= now) this.ignition(flash)
      if (s.outcome !== "playing") return
    }
    this.flashes = this.flashes.filter(flash => !flash.done || now - flash.done < 700)
    this.slashes = this.slashes.filter(item => now - item.born < 260)
  }
  has(owner, id) { return Boolean(artOf(this.c.builds[owner], id)) }
}
