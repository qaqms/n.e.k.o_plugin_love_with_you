import { STRIKES, strikeStats } from "./skills.mjs"

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
function fromSegment(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy || 1
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / length, 0, 1)
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t))
}

// Rule 18 manual sword line. After the dash itself, every learned form follows in order.
// The queue, paths, echoes and the domain are short-lived and are not saved.
export class DashLine {
  constructor(combat) { this.c = combat; this.s = combat.s; this.clear() }
  clear() { this.queue = []; this.paths = []; this.route = []; this.echoes = []; this.stars = []; this.arcs = []; this.domain = null }
  forms() { return this.c.builds.player.strikes || [] }
  active() { return this.forms().length > 0 }
  amount(id, scale) { return this.c.damage("player", strikeStats(this.c.builds.player, id).damage) * scale }
  hit(enemy, amount) {
    if (!enemy.active || this.s.outcome !== "playing") return
    if (this.c.swordLine) this.c.swordLine.strike(enemy, "player", amount)
    else this.c.deal(enemy, amount, "player")
  }
  live() { return this.s.enemies.getChildren().filter(enemy => enemy.active) }
  // Called after the dash itself landed: queue the chain and set the cooldown of the highest form.
  chain(skill, start, end, cadence) {
    const s = this.s, forms = this.forms(), top = forms.at(-1)
    skill.ready_at = s.elapsed + strikeStats(this.c.builds.player, top.id).cooldown * cadence
    this.paths = [{ ax: start.x, ay: start.y, bx: end.x, by: end.y, born: s.elapsed }]
    this.route = [...this.paths]
    forms.forEach((item, index) => this.queue.push({ id: item.id, at: s.elapsed + STRIKES.gap * (index + 1),
      scale: index === forms.length - 1 ? 1 : STRIKES.lower }))
  }
  // Move the swordsman along a cut, hitting everything near the line.
  cut(to, damage, width = 60) {
    const s = this.s, from = { x: s.player.x, y: s.player.y }
    const end = s.terrain.endpoint(s.player, to)
    if (distance(from, end) < 8) return null
    s.terrain.place(s.player, end)
    s.hurtUntil = Math.max(s.hurtUntil, s.elapsed + 250)
    this.paths.push({ ax: from.x, ay: from.y, bx: end.x, by: end.y, born: s.elapsed })
    if (this.paths.length > 12) this.paths.shift()
    this.route.push({ ax: from.x, ay: from.y, bx: end.x, by: end.y })
    for (const enemy of this.live()) {
      if (fromSegment(enemy, from, end) > width || !s.terrain.lineClear(from, enemy)) continue
      this.hit(enemy, damage)
      if (s.outcome !== "playing") break
    }
    return end
  }
  nearest(range, except = []) {
    const s = this.s
    return this.live().filter(enemy => distance(enemy, s.player) <= range && !except.includes(enemy))
      .sort((a, b) => distance(a, s.player) - distance(b, s.player))[0] || null
  }
  chainStep(step) {
    const damage = this.amount("chain", step.scale), seen = []
    for (let i = 0; i < 3; i++) {
      const target = this.nearest(STRIKES.arts.chain.range, seen)
      if (!target) break
      seen.push(target)
      const s = this.s, angle = Math.atan2(target.y - s.player.y, target.x - s.player.x)
      // Overshoot slightly so the cut passes through, not into, the target.
      this.cut({ x: target.x + Math.cos(angle) * 40, y: target.y + Math.sin(angle) * 40 }, damage)
      if (s.outcome !== "playing") return
    }
  }
  returnStep(step) {
    const s = this.s, f = this.c.facing, angle = Math.atan2(f.y, f.x), damage = this.amount("return", step.scale)
    this.arcs.push({ x: s.player.x, y: s.player.y, angle, born: s.elapsed })
    this.queue.push({ id: "arcBack", at: s.elapsed + 250, angle, damage, x: s.player.x, y: s.player.y })
    this.arc(s.player, angle, damage)
  }
  arc(center, angle, damage) {
    const s = this.s
    for (const enemy of this.live()) {
      if (distance(enemy, center) > STRIKES.arts.return.range) continue
      const a = Math.atan2(enemy.y - center.y, enemy.x - center.x) - angle
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) > 1.45) continue
      this.hit(enemy, damage)
      if (s.outcome !== "playing") return
    }
  }
  starStep(step) {
    const s = this.s, live = this.live().filter(enemy => distance(enemy, s.player) <= STRIKES.arts.star.range)
    let best = null, score = 0
    for (const enemy of live) {
      const count = live.filter(other => distance(enemy, other) <= 110).length
      if (count > score) { best = enemy; score = count }
    }
    if (best) this.cut({ x: best.x, y: best.y }, this.amount("star", step.scale) * .5)
    const damage = this.amount("star", step.scale), center = { x: s.player.x, y: s.player.y }
    this.stars.push({ ...center, born: s.elapsed })
    for (const enemy of this.live()) {
      const d = distance(enemy, center)
      if (d > 160) continue
      const a = Math.atan2(enemy.y - center.y, enemy.x - center.x), ray = Math.round(a / (Math.PI / 4)) * Math.PI / 4
      if (d > 30 && Math.abs(Math.sin(a - ray)) * d > 32) continue
      this.hit(enemy, damage)
      if (s.outcome !== "playing") return
    }
  }
  echoStep(step) {
    const s = this.s, damage = this.amount("echo", step.scale)
    const paths = this.route.slice(-6).map(path => ({ ...path }))
    for (const delay of [500, 1000]) this.echoes.push({ paths, at: s.elapsed + delay, born: s.elapsed, damage })
  }
  domainStep(step) {
    const s = this.s
    this.domain = { x: s.player.x, y: s.player.y, born: s.elapsed, until: s.elapsed + 2000, next: s.elapsed, damage: this.amount("domain", step.scale), struck: [] }
    s.hurtUntil = Math.max(s.hurtUntil, s.elapsed + 2100)
    s.art?.shake?.(.006, 200)
  }
  domainTick() {
    const s = this.s, d = this.domain
    if (!d || d.next > s.elapsed) return
    d.next = s.elapsed + 150
    const inside = this.live().filter(enemy => distance(enemy, d) <= STRIKES.arts.domain.range)
    if (!inside.length) return
    const fresh = inside.filter(enemy => !d.struck.includes(enemy.getData("id")))
    const target = (fresh.length ? fresh : inside).sort((a, b) => distance(a, s.player) - distance(b, s.player))[0]
    d.struck.push(target.getData("id"))
    const angle = Math.atan2(target.y - s.player.y, target.x - s.player.x)
    const spot = s.terrain.endpoint(s.player, { x: target.x - Math.cos(angle) * 30, y: target.y - Math.sin(angle) * 30 }, false)
    this.paths.push({ ax: s.player.x, ay: s.player.y, bx: spot.x, by: spot.y, born: s.elapsed })
    if (this.paths.length > 12) this.paths.shift()
    s.terrain.place(s.player, spot)
    this.hit(target, d.damage)
  }
  update() {
    const s = this.s, now = s.elapsed
    for (const step of [...this.queue]) {
      if (step.at > now) continue
      this.queue.splice(this.queue.indexOf(step), 1)
      if (step.id === "arcBack") { this.arcs.push({ x: step.x, y: step.y, angle: step.angle + Math.PI, born: now, back: true }); this.arc(step, step.angle, step.damage) }
      else this[`${step.id}Step`](step)
      if (s.outcome !== "playing") return
    }
    for (const echo of [...this.echoes]) {
      if (echo.at > now) continue
      this.echoes.splice(this.echoes.indexOf(echo), 1)
      echo.fired = now
      for (const path of echo.paths) {
        const a = { x: path.ax, y: path.ay }, b = { x: path.bx, y: path.by }
        this.paths.push({ ...path, born: now, echo: true })
        for (const enemy of this.live()) if (fromSegment(enemy, a, b) <= 60) { this.hit(enemy, echo.damage); if (s.outcome !== "playing") return }
      }
    }
    if (this.domain) {
      if (this.domain.until <= now) this.domain = null
      else this.domainTick()
    }
    this.paths = this.paths.filter(path => now - path.born < 380)
    this.stars = this.stars.filter(item => now - item.born < 420)
    this.arcs = this.arcs.filter(item => now - item.born < 300)
  }
}
