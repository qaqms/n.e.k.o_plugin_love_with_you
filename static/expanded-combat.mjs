import { parameters } from "./skills.mjs"
import { isBoss, segmentDistance } from "./encounter-rules.mjs"

const TAU = Math.PI * 2
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const COLORS = { spark: 0xe7db9d, stone: 0xb6c7a0, thrust: 0xf1e3c7, orbit: 0xb4ded8,
  rune: 0xd5acc3, quake: 0xb6c7a0, whirl: 0xe5e4c8, meteor: 0xf2ba8e, heal: 0xade1bd, beacon: 0xb2d9ec }
const ZONES = new Set(["orbit", "rune", "quake", "whirl", "meteor", "beacon"])

// Rule 6 effects use the existing bounded, saved zone clock and entity IDs.
export class ExpandedCombat {
  constructor(combat) { this.c = combat; this.s = combat.s; this.lines = [] }
  isZone(kind) { return ZONES.has(kind) }
  p(owner, id) { return parameters(this.c.skill(owner, id), this.c.builds[owner]) }
  erase(zone) { const i = this.c.zones.indexOf(zone); if (i >= 0) this.c.zones.splice(i, 1) }
  put(kind, owner, point, radius, damage, duration, delay = 0) {
    if (this.c.zones.length >= 12) return null
    this.c.addZone(kind, owner, point, radius, damage, duration)
    const zone = this.c.zones.at(-1)
    zone.tick_at = this.s.elapsed + delay
    return zone
  }
  beam(points, color, width = 2) {
    if (this.lines.length >= 48) this.lines.shift()
    this.lines.push({ points: points.map(p => ({ x: p.x, y: p.y })), color, width, until: this.s.elapsed + 220 })
  }
  chain(source, owner, target, amount, jumps = 3, hop = 145, decay = .72, consume = false, first = 1) {
    const used = new Set(), points = [{ x: source.x, y: source.y }]
    let current = target
    for (let i = 0; current && i < jumps && this.s.outcome === "playing"; i++) {
      const point = { x: current.x, y: current.y }
      used.add(current.getData("id")); points.push(point)
      const extra = consume ? this.c.frost.consume(current, 10) : 0
      this.c.deal(current, amount * decay ** i * (i === 0 ? first : 1) + this.c.damage(owner, extra), owner)
      if (this.s.outcome !== "playing") break
      current = this.s.enemies.getChildren().filter(e => e.active && !used.has(e.getData("id"))
        && distance(e, point) <= hop && this.s.terrain.lineClear(point, e))
        .sort((a, b) => distance(a, point) - distance(b, point))[0]
    }
    this.beam(points, COLORS.spark)
  }
  auto(source, owner, skill, p) {
    const s = this.s, c = this.c
    if (!["spark", "thrust", "orbit", "rune"].includes(skill.id)) return null
    if (skill.id === "orbit") {
      const active = c.zones.find(z => z.kind === "orbit" && z.owner === owner)
      if (active) {
        active.expires_at = s.elapsed + p.duration; active.radius = p.radius; active.damage = c.damage(owner, p.damage)
        return true
      }
      if (!s.enemies.getChildren().some(e => e.active && distance(source, e) <= p.range)) return false
      return Boolean(this.put("orbit", owner, source, p.radius, c.damage(owner, p.damage), p.duration))
    }
    if (skill.id === "rune") {
      if (c.zones.filter(z => z.kind === "rune" && z.owner === owner).length >= p.cap
        || !s.enemies.getChildren().some(e => e.active && distance(source, e) <= p.range)) return false
      const point = s.terrain.safePoint(source)
      const zone = this.put("rune", owner, point, p.radius, c.damage(owner, p.damage), p.duration, 500)
      if (zone) s.art.cast(owner, skill.id)
      return Boolean(zone)
    }
    const target = s.nearest(source, p.range)
    if (!target) return false
    s.art.cast(owner, skill.id, Math.atan2(target.y - source.y, target.x - source.x))
    if (skill.id === "spark") {
      this.chain(source, owner, target, c.damage(owner, p.damage), p.jumps, p.hop, p.decay, skill.evolution === "fusion", p.first)
    } else {
      const d = Math.max(1, distance(source, target)), ux = (target.x - source.x) / d, uy = (target.y - source.y) / d
      const end = { x: source.x + ux * p.range, y: source.y + uy * p.range }
      const enemies = s.enemies.getChildren().filter(e => {
        const projection = (e.x - source.x) * ux + (e.y - source.y) * uy
        return e.active && projection >= 0 && projection <= p.range && segmentDistance(e, source, end) <= p.width
          && s.terrain.lineClear(source, e)
      }).sort((a, b) => distance(source, a) - distance(source, b)).slice(0, p.targets)
      this.beam([source, s.terrain.endpoint(source, end)], COLORS.thrust, p.width * .45)
      for (const enemy of enemies) {
        const damage = c.frost.strike(enemy, owner, "thrust", c.damage(owner, p.damage))
        c.deal(enemy, damage, owner)
        if (s.outcome !== "playing") break
        if (skill.evolution === "fusion" && enemy.active) c.frost.apply(enemy, owner, c.skill(owner, "ice"), 1)
      }
    }
    return true
  }
  stoneImpact(enemy, point, skill, owner, damage, first) {
    const p = this.p(owner, "stone"), fusion = skill.evolution === "fusion" && first
    const radius = fusion ? 95 : p.splash, multiplier = fusion ? .7 : p.splashDamage
    if (enemy.active && !isBoss(enemy)) this.c.push(enemy, this.c.actor(owner), p.knockback)
    if (!radius) return
    this.c.flash(point.x, point.y, radius, fusion ? COLORS.meteor : COLORS.stone, "stone")
    for (const other of [...this.s.enemies.getChildren()]) {
      if (other !== enemy && distance(other, point) <= radius && this.s.terrain.lineClear(point, other)) this.c.deal(other, damage * multiplier, owner)
      if (this.s.outcome !== "playing") return
    }
  }
  pulse(point, radius, damage, owner, knockback = 0, sword = "") {
    for (const enemy of [...this.s.enemies.getChildren()]) {
      if (!enemy.active || distance(point, enemy) > radius || !this.s.terrain.lineClear(point, enemy)) continue
      const amount = sword ? this.c.frost.strike(enemy, owner, sword, damage) : damage
      this.c.deal(enemy, amount, owner)
      if (this.s.outcome !== "playing") return
      if (knockback && enemy.active && !isBoss(enemy)) this.c.push(enemy, point, knockback)
    }
  }
  manual(skill, p) {
    const s = this.s, c = this.c, point = { x: s.player.x, y: s.player.y }
    if (!["quake", "whirl", "meteor"].includes(skill.id)) return null
    const target = skill.id === "meteor" ? c.targetGroup(s.player, p.range) : s.nearest(s.player, p.range)
    if (skill.id !== "whirl" && !target) return c.castFailure("范围内没有敌人 · 未消耗冷却")
    const needed = skill.id === "meteor" ? p.waves : skill.id === "quake" && !skill.branch ? 0 : 1
    if (c.zones.length + needed > 12 || skill.id === "whirl" && c.zones.some(z => z.kind === "whirl")) {
      return c.castFailure("当前区域效果已满 · 未消耗冷却")
    }
    skill.ready_at = s.elapsed + p.cooldown * (s.encounters?.has("cadence") ? .9 : 1)
    if (skill.id === "quake") {
      if (skill.branch === "echo") this.put("quake", "player", point, p.radius, c.damage("player", p.damage * p.echoDamage), 1100, 700)
      if (skill.branch === "fault") this.put("quake", "player", point, p.radius, c.damage("player", p.damage * .15), p.duration, 500)
      c.flash(point.x, point.y, p.radius, COLORS.quake, "quake")
      this.pulse(point, p.radius, c.damage("player", p.damage), "player", p.knockback)
    } else if (skill.id === "whirl") {
      this.put("whirl", "player", point, p.radius, c.damage("player", p.damage), p.duration)
      if (skill.evolution === "fusion") this.radial(point, "player", "wind", p.damage * .6, 5)
    } else {
      point.x = target.x; point.y = target.y
      for (let i = 0; i < p.waves; i++) {
        const delay = p.delay + i * 500
        this.put("meteor", "player", point, p.radius, c.damage("player", p.damage) * (i && skill.branch !== "rain" ? .6 : 1), delay + 400, delay)
      }
    }
    if (s.outcome === "playing") c.follow(skill.id, point)
    return true
  }
  radial(point, owner, id, amount, count) {
    const c = this.c, skill = c.skill(owner, id)
    if (!skill || this.s.bullets.countActive() + count > 160) return
    for (let i = 0; i < count; i++) c.emit(point, owner, { ...skill, level: 1, evolution: "" },
      { ...parameters(skill, c.builds[owner]), count: 1, pierce: 0, damage: amount, range: 320 }, i * TAU / count)
  }
  follow(action, point) {
    const c = this.c, skill = c.builds.companion.skills.find(s => ["pull", "armor", "heal", "beacon"].includes(s.id))
    const open = Boolean(c.builds.companion.mods?.follow)
    if (!skill || !open && skill.branch !== "follow" || skill.ready_at > this.s.elapsed) return
    if (!open && (skill.id === "pull" && action !== "flame" || skill.id === "armor" && action !== "dash")) return
    if (distance(c.actor("companion"), ["heal", "armor"].includes(skill.id) ? this.s.player : point) > this.p("companion", skill.id).range) return
    if (c.support(skill, point, true)) c.controller.notice(`${this.s.meta.character} · 接续支援`)
  }
  support(skill, position, follow) {
    const s = this.s, c = this.c, p = this.p("companion", skill.id)
    if (!["heal", "beacon"].includes(skill.id)) return null
    if (distance(s.companion, s.player) > p.range) return false
    if (skill.id === "heal") {
      const ratio = s.hp / s.maxHp(), overflow = skill.branch === "overflow"
      if (ratio > (follow ? .95 : .85) && !(overflow && s.shield < 8)) return false
      const amount = p.damage * (1 + c.talent("companion", "ward") * .12) * (1 + s.meta.bonus / 100) * (follow ? p.healBonus : 1)
      const restored = Math.min(s.maxHp() - s.hp, amount)
      s.hp += restored; s.lowHealth = s.hp / s.maxHp() <= .3
      s.shield = Math.min(200, s.shield + (amount - restored) * p.overflow + p.ward)
      c.flash(s.player.x, s.player.y, 42, COLORS.heal, "heal")
    } else {
      if (c.zones.some(z => z.kind === "beacon") || c.zones.length + p.lamps > 12) return false
      const target = position || c.targetGroup(s.player, p.range)
      if (!target) return false
      const point = position || s.player
      for (let i = 0; i < p.lamps; i++) {
        const place = s.terrain.safePoint({ x: point.x + (p.lamps === 2 ? (i ? 28 : -28) : 0), y: point.y })
        this.put("beacon", "companion", place, p.radius, c.damage("companion", p.damage), p.duration)
      }
    }
    return true
  }
  stride() {
    return this.c.zones.some(z => z.kind === "whirl" && z.expires_at > this.s.elapsed) ? this.p("player", "whirl").stride : 0
  }
  updateZone(z) {
    if (!this.isZone(z.kind)) return false
    const s = this.s, c = this.c, now = s.elapsed, skill = c.skill(z.owner, z.kind), p = this.p(z.owner, z.kind)
    if (["rune", "orbit", "whirl", "beacon"].includes(z.kind) && z.expires_at <= now) { this.erase(z); return true }
    if (z.kind === "orbit" || z.kind === "whirl") {
      const actor = c.actor(z.owner)
      z.x = actor.x; z.y = actor.y
    }
    if (z.kind === "meteor" && skill.evolution === "fusion" && z.tick_at > now) {
      for (const enemy of s.enemies.getChildren()) if (!isBoss(enemy) && s.terrain.lineClear(z, enemy) && distance(z, enemy) < z.radius + 30
        && distance(z, enemy) > 14) s.physics.moveTo(enemy, z.x, z.y, 95)
    }
    if (z.kind === "quake" && skill.branch === "fault") {
      if (z.expires_at <= now) { this.erase(z); return true }
      for (const enemy of s.enemies.getChildren()) if (!isBoss(enemy) && s.terrain.lineClear(z, enemy) && distance(z, enemy) < z.radius) {
        enemy.setVelocity(enemy.body.velocity.x * .6, enemy.body.velocity.y * .6)
      }
    }
    if (now < z.tick_at) return true
    if (z.kind === "rune") {
      if (!s.enemies.getChildren().some(e => e.active && distance(z, e) <= p.trigger)) return true
      this.erase(z) // Commit one-shot removal before damage can end and save the journey.
      c.flash(z.x, z.y, z.radius, COLORS.rune, "rune")
      this.pulse(z, z.radius, z.damage, z.owner)
      if (s.outcome === "playing" && skill.evolution === "fusion") this.radial(z, z.owner, "stone", p.damage * .4, 3)
    } else if (z.kind === "meteor" || z.kind === "quake" && skill.branch === "echo") {
      this.erase(z)
      c.flash(z.x, z.y, z.radius, COLORS[z.kind], z.kind)
      this.pulse(z, z.radius, z.damage, z.owner, z.kind === "meteor" ? p.knockback : 25)
    } else if (z.kind === "beacon") {
      const target = s.nearest(z, z.radius)
      if (!target) return true
      z.tick_at = now + 900
      if (p.ward && distance(z, s.player) <= 220 && s.shield < 30) {
        s.shield = Math.min(30, s.shield + p.ward * (1 + c.talent(z.owner, "ward") * .12) * (1 + s.meta.bonus / 100))
      }
      this.chain(z, z.owner, target, z.damage, p.jumps ?? (skill.evolution === "fusion" ? 3 : 1))
    } else {
      z.tick_at = now + (z.kind === "orbit" ? 200 : z.kind === "whirl" ? 400 : 500)
      for (const enemy of [...s.enemies.getChildren()]) {
        if (!enemy.active) continue
        const d = distance(z, enemy)
        if (z.kind === "orbit") {
          if (!s.terrain.lineClear(z, enemy)) continue
          if (skill.evolution === "fusion" && !isBoss(enemy) && d < z.radius - p.band && d > 4) c.push(enemy, z, Math.min(14, z.radius - p.band - d))
          if (Math.abs(d - z.radius) > p.band) continue
          const angle = Math.atan2(enemy.y - z.y, enemy.x - z.x) - now / 1000 * p.rotation
          if (!Array.from({ length: p.blades }, (_, i) => angle - i * TAU / p.blades)
            .some(a => Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) <= .45)) continue
        } else if (d > z.radius || z.kind === "whirl" && !s.terrain.lineClear(z, enemy)) continue
        const amount = z.damage * (z.kind === "whirl" && d > z.radius * .65 ? p.edge : 1)
        c.deal(enemy, z.kind === "whirl" ? c.frost.strike(enemy, z.owner, "whirl", amount) : amount, z.owner)
        if (s.outcome !== "playing") return true
      }
    }
    return true
  }
  paint(g) {
    const now = this.s.elapsed, reduced = this.s.art?.reduced
    for (const z of this.c.zones) {
      if (!this.isZone(z.kind)) continue
      const p = this.p(z.owner, z.kind), color = COLORS[z.kind]
      g.lineStyle(1.5, color, .65)
      if (z.kind === "orbit") {
        g.lineStyle(1, color, .2).strokeCircle(z.x, z.y, z.radius)
        g.lineStyle(1, color, .1).strokeCircle(z.x, z.y, z.radius - p.band).strokeCircle(z.x, z.y, z.radius + p.band)
        for (let i = 0; i < p.blades; i++) {
          const a = now / 1000 * p.rotation + i * TAU / p.blades, x = z.x + Math.cos(a) * z.radius, y = z.y + Math.sin(a) * z.radius
          g.lineStyle(p.band === 16 ? 4 : 7, color, .9).beginPath().arc(z.x, z.y, z.radius, a - .22, a + .22).strokePath()
          g.fillStyle(0xf4f2d8, .9).fillTriangle(x, y - 9, x - 5, y + 7, x + 5, y + 7)
        }
      } else if (z.kind === "rune") {
        const armed = now >= z.tick_at
        g.lineStyle(2, color, armed ? .9 : .3).strokeRect(z.x - 16, z.y - 16, 32, 32)
        g.lineBetween(z.x - 20, z.y, z.x + 20, z.y).lineBetween(z.x, z.y - 20, z.x, z.y + 20)
        g.lineStyle(1, color, .25).strokeCircle(z.x, z.y, p.trigger)
      } else if (z.kind === "beacon") {
        g.lineStyle(1, color, .12).strokeCircle(z.x, z.y, z.radius)
        g.fillStyle(0x304353, .9).fillEllipse(z.x, z.y + 7, 28, 12)
        g.lineStyle(2, color, .9).strokeTriangle(z.x, z.y - 24, z.x - 9, z.y - 10, z.x + 9, z.y - 10)
        g.lineBetween(z.x, z.y - 10, z.x, z.y + 5).strokeEllipse(z.x, z.y + 5, 28, 10)
      } else if (z.kind === "meteor") {
        g.fillStyle(color, .06).fillCircle(z.x, z.y, z.radius).strokeCircle(z.x, z.y, z.radius)
        const progress = 1 - Math.max(0, Math.min(p.delay, z.tick_at - now)) / p.delay
        g.lineStyle(2, color, .7).strokeCircle(z.x, z.y, z.radius * progress)
        g.lineBetween(z.x - 12, z.y, z.x + 12, z.y).lineBetween(z.x, z.y - 12, z.x, z.y + 12)
        g.fillStyle(color, .8).fillEllipse(z.x, z.y - (1 - progress) * 150 - 12, 10 + progress * 12, 16 + progress * 14)
      } else if (z.kind === "whirl") {
        const angle = now / 140
        g.lineStyle(4, color, .65).beginPath().arc(z.x, z.y, z.radius, angle, angle + Math.PI * 1.5).strokePath()
        g.lineStyle(2, 0xf5f2de, .7).beginPath().arc(z.x, z.y, z.radius * .8, -angle, -angle + 2).strokePath()
      } else {
        g.lineStyle(1, color, .4).strokeCircle(z.x, z.y, z.radius)
        for (let i = 0; i < (reduced ? 6 : 12); i++) {
          const a = i * TAU / (reduced ? 6 : 12), x = z.x + Math.cos(a) * z.radius * .72, y = z.y + Math.sin(a) * z.radius * .72
          g.fillStyle(color, .5).fillTriangle(x - 7, y + 5, x, y - 15, x + 7, y + 5)
        }
      }
    }
    this.lines = this.lines.filter(line => line.until > now)
    for (const line of this.lines) {
      g.lineStyle(line.width, line.color, (line.until - now) / 220 * .9)
      for (let i = 1; i < line.points.length; i++) {
        const a = line.points[i - 1], b = line.points[i], dx = b.x - a.x, dy = b.y - a.y, d = Math.max(1, Math.hypot(dx, dy))
        if (line.width > 3 || reduced) { g.lineBetween(a.x, a.y, b.x, b.y); continue }
        const side = i % 2 ? 7 : -7, x = (a.x + b.x) / 2 - dy / d * side, y = (a.y + b.y) / 2 + dx / d * side
        g.lineBetween(a.x, a.y, x, y).lineBetween(x, y, b.x, b.y)
      }
    }
  }
}
