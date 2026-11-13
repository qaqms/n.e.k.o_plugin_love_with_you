import { parameters } from "./skills.mjs"

// Status clocks use saved simulation time; pausing never advances them.
export class FrostEffects {
  constructor(combat, snapshot) {
    this.c = combat; this.s = combat.s
    this.marks = new Map((snapshot?.frosts || []).map(mark => [mark.target, { ...mark }]))
    this.shatterAt = snapshot?.shatter_at || 0
  }
  data() {
    const live = new Set(this.s.enemies.getChildren().filter(enemy => enemy.active).map(enemy => enemy.getData("id")))
    return { frosts: [...this.marks.values()].filter(mark => live.has(mark.target)).map(mark => ({ ...mark })), shatter_at: this.shatterAt }
  }
  apply(enemy, source, skill, stacks) {
    if (!enemy.active || this.s.outcome !== "playing") return
    const now = this.s.elapsed, id = enemy.getData("id"), p = parameters(skill, this.c.builds[source])
    let mark = this.marks.get(id)
    if (!mark) {
      if (this.marks.size >= 160) return
      mark = { target: id, source, stacks: 0, expires_at: 0, frozen_until: 0, freeze_at: 0, break_at: 0 }
      this.marks.set(id, mark)
    }
    if (mark.expires_at <= now) mark.stacks = 0
    if (!mark.stacks || source === "companion") mark.source = source
    mark.stacks = Math.min(3, mark.stacks + (stacks ?? p.frostStacks))
    mark.expires_at = now + p.frostDuration
    if (mark.stacks === 3 && now >= mark.freeze_at && enemy.getData("kind") !== "boss") {
      mark.frozen_until = now + 600; mark.freeze_at = now + 3500
    }
  }
  consume(enemy, damagePerStack) {
    if (!enemy.active || this.s.outcome !== "playing") return 0
    const mark = this.marks.get(enemy.getData("id"))
    if (!mark?.stacks || mark.expires_at <= this.s.elapsed) return 0
    const damage = damagePerStack * mark.stacks * (enemy.getData("kind") === "boss" ? .65 : 1)
    mark.stacks = 0; mark.frozen_until = 0
    return damage
  }
  strike(enemy, owner, skillId, amount) {
    if (!enemy.active || this.s.outcome !== "playing") return amount
    const now = this.s.elapsed, mark = this.marks.get(enemy.getData("id"))
    if (owner !== "player" || !["slash", "guard", "dash"].includes(skillId) || now < this.shatterAt
      || !mark?.stacks || mark.expires_at <= now || now < mark.break_at) return amount
    const cross = mark.source === "companion", extra = this.consume(enemy, 12)
    mark.break_at = now + 1800; this.shatterAt = now + 600
    this.c.stats.shatters++; if (cross) this.c.stats.cross_shatters++
    this.c.flash(enemy.x, enemy.y, 48, 0xc1f4ff, "shatter")
    this.c.controller.notice(cross ? `${this.s.meta.character}凝霜 → 玩家碎冰` : "玩家 · 碎冰")
    return amount + this.c.damage("player", extra)
  }
  update() {
    if (this.s.outcome !== "playing") return
    const now = this.s.elapsed
    const enemies = new Map(this.s.enemies.getChildren().filter(e => e.active).map(e => [e.getData("id"), e]))
    for (const [id, mark] of this.marks) {
      const enemy = enemies.get(id)
      if (!enemy) { this.marks.delete(id); continue }
      if (mark.expires_at <= now) mark.stacks = 0
      if (!mark.stacks && Math.max(mark.freeze_at, mark.break_at) <= now) { this.marks.delete(id); continue }
      const factor = mark.stacks && mark.frozen_until > now ? 0
        : 1 - mark.stacks * (enemy.getData("kind") === "boss" ? .04 : .12)
      enemy.setVelocity(enemy.body.velocity.x * factor, enemy.body.velocity.y * factor)
    }
  }
  paint(g) {
    const now = this.s.elapsed
    for (const enemy of this.s.enemies.getChildren()) {
      const mark = this.marks.get(enemy.getData("id"))
      if (!mark?.stacks || mark.expires_at <= now) continue
      const frozen = mark.frozen_until > now
      g.lineStyle(frozen ? 3 : 1, 0xa6e9fb, frozen ? .95 : .65)
      if (frozen) g.strokeCircle(enemy.x, enemy.y, enemy.displayWidth / 2 + 5)
      for (let i = 0; i < mark.stacks; i++) {
        const x = enemy.x + (i - (mark.stacks - 1) / 2) * 9, y = enemy.y - enemy.displayHeight / 2 - 7
        g.lineBetween(x, y - 4, x + 3, y).lineBetween(x + 3, y, x, y + 4)
        g.lineBetween(x, y + 4, x - 3, y).lineBetween(x - 3, y, x, y - 4)
      }
    }
  }
}
