import { FOES, COOPERATIONS, MILESTONES, drawCooperations, segmentDistance, spawnPoint, isBoss } from "./encounter-rules.mjs"
import { button, element } from "./camp.mjs"
import { icon } from "./icons.mjs"
import { DEPTH } from "./terrain-rules.mjs"

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const clamp = (value, max) => Math.max(35, Math.min(max - 35, value))

export class Encounters {
  constructor(scene, controller, snapshot) {
    this.s = scene; this.controller = controller
    this.state = snapshot ? structuredClone(snapshot.encounters) : {
      milestones: Object.fromEntries(MILESTONES.map(id => [id, { spawned: false, defeated: false, enemy: 0 }])),
      selected: [], resolved: [], pending: "", choices: [], rest_until: 0,
    }
    this.foes = new Map((snapshot?.foes || []).map(foe => [foe.target, { ...foe }]))
    this.threats = structuredClone(snapshot?.threats || [])
    this.graphics = scene.add.graphics().setDepth(DEPTH.warnings)
    this.hudAt = -Infinity
    this.paint()
  }
  has(id) { return this.state.selected.includes(id) }
  destroy() { this.graphics.destroy() }
  data() {
    return { encounters: structuredClone(this.state), foes: [...this.foes.values()].map(f => ({ ...f })),
      threats: structuredClone(this.threats) }
  }
  track(enemy) {
    const kind = enemy.getData("kind"), target = enemy.getData("id")
    if (!FOES[kind]) return
    this.foes.set(target, { target, state: "move", ready_at: this.s.elapsed + 1200, step: 0, phase: 1 })
  }
  spawn() {
    const s = this.s
    for (const id of MILESTONES) {
      const mark = this.state.milestones[id], spec = FOES[id]
      if (mark.spawned || s.elapsed < spec.at) continue
      const enemy = s.makeEnemy({ id: s.next(), kind: id, hp: spec.hp, ...spawnPoint(s.player, s.rng) })
      mark.spawned = true; mark.enemy = enemy.getData("id")
      this.controller.notice(`${spec.name}现身了。`)
    }
    if (!s.bossSpawned && s.elapsed >= FOES.boss.at) {
      s.bossSpawned = true
      s.makeEnemy({ id: s.next(), kind: "boss", hp: FOES.boss.hp, ...spawnPoint(s.player, s.rng) })
      this.controller.notice("林地守望者已经苏醒。")
    }
  }
  spawnRegular() {
    const s = this.s
    if (s.enemies.countActive() >= 145) return
    const roll = s.rng.frac()
    let kind = s.elapsed >= 480000 && roll < .13 ? "caster"
      : s.elapsed >= 180000 && roll < .28 ? "charger" : roll < .47 ? "brute" : roll < .65 ? "wisp" : "slime"
    if (s.elapsed < 180000) kind = roll < .2 ? "wisp" : "slime"
    if (this.foes.size >= 24 && FOES[kind]) kind = "brute"
    const hp = FOES[kind]?.hp || (kind === "brute" ? 65 : kind === "wisp" ? 13 : 24)
    s.makeEnemy({ id: s.next(), kind, hp: hp * (1 + s.elapsed / 300000), ...spawnPoint(s.player, s.rng) })
  }
  onKill(id, kind) {
    const warnings = this.threats.length
    this.foes.delete(id); this.threats = this.threats.filter(t => t.source !== id)
    if (this.threats.length !== warnings) this.paint()
    const mark = this.state.milestones[kind]
    if (!mark || !mark.spawned || mark.defeated || mark.enemy !== id) return
    mark.defeated = true; mark.enemy = 0
    this.state.rest_until = this.s.elapsed + 15000
    this.s.spawnAt = Math.max(this.s.spawnAt, this.state.rest_until)
    this.s.hp = Math.min(this.s.maxHp(), this.s.hp + Math.ceil(this.s.maxHp() * .12))
    this.s.xp = Math.min(10000, this.s.xp + FOES[kind].xp)
    this.controller.notice(`${FOES[kind].name}已击败 · 双人协同可研习`)
  }
  onSupport() {
    if (this.has("warmth") && this.s.outcome === "playing") this.s.hp = Math.min(this.s.maxHp(), this.s.hp + 4)
  }
  openReward(force = false) {
    const s = this.s, c = this.controller
    if (s.outcome !== "playing" || (!force && (s.paused || c.busy || c.saving || c.api.pending)) || s.choices.length) return false
    if (!this.state.pending) {
      const id = MILESTONES.find(id => this.state.milestones[id].defeated && !this.state.resolved.includes(id))
      if (!id) return false
      this.state.pending = id
      this.state.choices = drawCooperations(s.combat.builds, this.state.selected, s.rng)
    }
    s.setPaused(true); c.cooperation(true)
    return true
  }
  render(body) {
    body.append(element("p", `${FOES[this.state.pending].name} · ${this.s.meta.character}与你的协同成长`, "study-owner"))
    const grid = element("div", "", "upgrade-grid")
    for (const id of this.state.choices) {
      const spec = COOPERATIONS[id], card = button("", () => this.choose(id), "upgrade")
      card.dataset.cooperation = id
      card.append(element("span", "本局双人协同", "tag"), icon(spec.icon), element("strong", spec.name),
        element("span", spec.description))
      grid.append(card)
    }
    const actions = element("div", "", "actions")
    actions.append(button("技能图鉴", () => this.controller.codex(), "", "BookOpen"),
      button("保存并返回", () => this.controller.action(async () => {
        await this.controller.save(true); this.s.activeRun = false; await this.controller.refresh()
      }), "", "Save"))
    body.append(grid, actions)
  }
  choose(id) {
    const c = this.controller
    if (!this.s.paused || !this.state.pending || !this.state.choices.includes(id) || c.busy || c.api.pending) return
    this.state.selected.push(id); this.state.resolved.push(this.state.pending)
    this.state.pending = ""; this.state.choices = []
    c.action(async () => {
      await c.save()
      this.s.checkLevel()
      if (this.s.choices.length) return
      if (this.openReward(true)) return
      c.play()
      c.notice(`双人协同 · ${COOPERATIONS[id].name}`)
    })
  }
  prepare(enemy, ai) {
    const s = this.s, kind = enemy.getData("kind"), spec = FOES[kind], phase = ai.phase
    const circle = kind === "caster" || kind === "oracle" || isBoss(enemy) && ai.step % 2 === 1
    const count = kind === "oracle" || kind === "boss" && phase === 2 && circle ? 3 : 1
    if (this.threats.length + count > 32) return
    const delay = spec.windup - (phase === 2 ? 150 : 0)
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * 105
      let x = circle ? clamp(s.player.x + offset, 1800) : enemy.x
      let y = circle ? clamp(s.player.y, 1200) : enemy.y
      let ex = x, ey = y
      if (!circle) {
        const d = Math.max(1, distance(enemy, s.player)), range = Math.min(kind === "charger" ? 300 : 360, d + 45)
        ex = clamp(x + (s.player.x - x) / d * range, 1800); ey = clamp(y + (s.player.y - y) / d * range, 1200)
        const end = s.terrain.endpoint(enemy, { x: ex, y: ey })
        ex = end.x; ey = end.y
      }
      this.threats.push({ id: s.next(), source: ai.target, kind: circle ? "circle" : "line",
        x, y, ex, ey, radius: circle ? kind === "caster" ? 58 : kind === "oracle" ? 72 : 105 : kind === "charger" ? 30 : 48,
        damage: spec.damage, trigger_at: s.elapsed + delay, expires_at: s.elapsed + delay + 260, fired: false })
    }
    enemy.setVelocity(0)
    ai.state = "windup"; ai.ready_at = s.elapsed + delay
    ai.step = (ai.step + 1) % 6
  }
  update() {
    const s = this.s, now = s.elapsed
    if (s.outcome !== "playing") return
    const live = new Map(s.enemies.getChildren().filter(e => e.active).map(e => [e.getData("id"), e]))
    for (const [id, ai] of this.foes) {
      const enemy = live.get(id)
      if (!enemy) { this.foes.delete(id); continue }
      const kind = enemy.getData("kind"), spec = FOES[kind], d = distance(enemy, s.player)
      if (kind === "boss" && ai.phase === 1 && enemy.getData("hp") <= spec.hp / 2) {
        ai.phase = 2; this.controller.notice("林地守望者 · 回响激化")
      }
      const frost = s.combat.frost.marks.get(id)
      if (!isBoss(enemy) && frost?.stacks && frost.frozen_until > now) {
        this.threats = this.threats.filter(t => t.source !== id || t.fired)
        ai.state = "recover"; ai.ready_at = now + 700; enemy.setVelocity(0); continue
      }
      if (ai.state !== "move") {
        enemy.setVelocity(0)
        if (ai.state === "recover" && now >= ai.ready_at) ai.state = "move"
      }
      if (ai.state === "move") {
        if (kind === "caster" && d < 190) s.terrain.move(enemy, { x: enemy.x * 2 - s.player.x, y: enemy.y * 2 - s.player.y }, spec.speed)
        else if (kind === "caster" && d < 350) enemy.setVelocity(0)
        else s.terrain.move(enemy, s.player, spec.speed)
        const groundSpell = kind === "caster" || kind === "oracle" || isBoss(enemy) && ai.step % 2 === 1
        if (now >= ai.ready_at && d < (kind === "caster" || kind === "oracle" ? 520 : 430)
          && (groundSpell || s.terrain.travelClear(enemy, s.player))) this.prepare(enemy, ai)
      }
    }
    for (const threat of this.threats) {
      if (s.outcome !== "playing") return
      const source = live.get(threat.source)
      if (!source || threat.fired || now < threat.trigger_at) continue
      // Commit the one-shot before damage can pause or end the scene.
      threat.fired = true
      const ai = this.foes.get(threat.source), spec = FOES[source.getData("kind")]
      if (ai) { ai.state = "recover"; ai.ready_at = now + spec.recovery }
      if (threat.kind === "line") {
        const end = s.terrain.place(source, { x: threat.ex, y: threat.ey })
        threat.ex = end.x; threat.ey = end.y
      }
      const hit = threat.kind === "circle" ? distance(s.player, threat) <= threat.radius + 10
        : segmentDistance(s.player, threat, { x: threat.ex, y: threat.ey }) <= threat.radius + 10
      if (hit && (threat.kind === "circle" || s.terrain.lineClear(threat, s.player))) s.takeDamage(threat.damage, source)
    }
    this.threats = this.threats.filter(t => live.has(t.source) && t.expires_at > now)
    this.paint()
  }
  paint() {
    const g = this.graphics, now = this.s.elapsed
    g.clear()
    for (const t of this.threats) {
      const color = t.fired ? 0xffbc86 : 0xf18c88
      g.lineStyle(t.fired ? 4 : 2, color, .95).fillStyle(color, t.fired ? .42 : .14)
      if (t.kind === "circle") {
        g.fillCircle(t.x, t.y, t.radius).strokeCircle(t.x, t.y, t.radius)
        const progress = Math.max(0, Math.min(1, 1 - (t.trigger_at - now) / 1200))
        g.strokeCircle(t.x, t.y, t.radius * progress)
      } else {
        const angle = Math.atan2(t.ey - t.y, t.ex - t.x), nx = -Math.sin(angle) * t.radius, ny = Math.cos(angle) * t.radius
        const points = [{ x: t.x + nx, y: t.y + ny }, { x: t.ex + nx, y: t.ey + ny },
          { x: t.ex - nx, y: t.ey - ny }, { x: t.x - nx, y: t.y - ny }]
        g.fillPoints(points, true).strokePoints(points, true).lineBetween(t.x, t.y, t.ex, t.ey)
      }
    }
  }
  updateHud() {
    if (this.s.elapsed - this.hudAt < 100) return
    this.hudAt = this.s.elapsed
    const node = document.getElementById("encounter-status")
    const bosses = this.s.enemies.getChildren().filter(e => isBoss(e))
    const enemy = bosses.find(e => e.getData("kind") === "boss") || bosses[0]
    node.hidden = !enemy || this.s.paused
    node.closest(".battlefield").classList.toggle("has-encounter", Boolean(enemy))
    if (!enemy) return
    const spec = FOES[enemy.getData("kind")], ai = this.foes.get(enemy.getData("id"))
    node.querySelector(".encounter-name").textContent = `${spec.name} · ${ai?.phase === 2 ? "第二阶段 · " : ""}${ai?.state === "windup" ? "蓄力" : ai?.state === "recover" ? "恢复" : "游走"}`
    node.querySelector(".encounter-fill").style.width = `${Math.min(100, enemy.getData("hp") / spec.hp * 100)}%`
  }
}
