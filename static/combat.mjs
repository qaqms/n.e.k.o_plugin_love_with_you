import { SKILLS, newBuild, studyOwner, drawChoices, applyChoice, parameters, skillName, skillControl } from "./skills.mjs"
import { FrostEffects } from "./frost.mjs"
import { ExpandedCombat } from "./expanded-combat.mjs"
import { Buildcraft } from "./buildcraft.mjs"
import { isBoss } from "./encounter-rules.mjs"
import { paintCombat } from "./battle-art.mjs"
import { DEPTH } from "./terrain-rules.mjs"

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const COLORS = { fire: 0xefae76, wind: 0x8bd8ca, slash: 0xf2dda0, guard: 0xabcbe5, ice: 0xa6e9fb }

// Versioned combat owns effects; the scene retains physics, entities and persistence.
export class SkillCombat {
  constructor(scene, controller, snapshot) {
    this.s = scene; this.controller = controller
    this.modern = scene.meta.rules >= 3
    this.builds = snapshot ? structuredClone(snapshot.builds) : {
      player: newBuild("player", scene.meta.player_class, scene.meta.rules, scene.meta.player_route),
      companion: newBuild("companion", scene.meta.companion_class, scene.meta.rules, scene.meta.companion_route),
    }
    this.studyOwner = snapshot?.study_owner || ""
    this.rerolls = snapshot?.rerolls ?? 2
    this.facing = snapshot ? { ...snapshot.facing } : { x: 1, y: 0 }
    this.stats = snapshot ? { ...snapshot.stats } : { player_damage: 0, companion_damage: 0, supports: 0, followups: 0,
      ...(this.modern ? { shatters: 0, cross_shatters: 0 } : {}) }
    this.zones = snapshot ? structuredClone(snapshot.zones) : []
    this.graphics = scene.add.graphics().setDepth(DEPTH.effects)
    this.flashes = []
    this.frost = this.modern ? new FrostEffects(this, snapshot) : null
    this.expanded = scene.meta.rules >= 6 ? new ExpandedCombat(this) : null
    this.craft = scene.meta.rules >= 7 ? new Buildcraft(this, snapshot) : null
  }
  destroy() { this.graphics.destroy(); this.zones = []; this.flashes = []; if (this.expanded) this.expanded.lines = [] }
  skill(owner, id) { return this.builds[owner].skills.find(skill => skill.id === id) }
  talent(owner, id) { return this.builds[owner].talents[id] }
  actor(owner) { return owner === "player" ? this.s.player : this.s.companion }
  damage(owner, value) {
    return value * (1 + this.s.meta.loadout.bonuses.power / 100)
      * (owner === "companion" ? .85 * (1 + this.s.meta.bonus / 100) * (this.s.encounters?.has("escort") ? 1.12 : 1) : 1)
  }
  data() {
    return {
      builds: structuredClone(this.builds), study_owner: this.studyOwner, rerolls: this.rerolls,
      zones: structuredClone(this.zones), facing: { ...this.facing }, stats: { ...this.stats },
      ...(this.frost?.data() || {}),
      ...(this.craft?.data() || {}),
    }
  }
  checkLevel() {
    const s = this.s
    if (this.craft?.preparation || s.outcome !== "playing" || s.xp < s.xpNeeded() || s.choices.length || s.encounters?.state.pending || s.level >= 31) return
    s.xp -= s.xpNeeded(); s.level++
    this.studyOwner = studyOwner(s.level)
    s.choices = drawChoices(this.builds[this.studyOwner], this.studyOwner, s.rng)
    if (!s.choices.length) { this.studyOwner = ""; this.checkLevel(); return }
    s.setPaused(true); this.controller.upgrades(true)
  }
  choose(key) {
    const s = this.s, owner = this.studyOwner
    if (!s.paused || !s.choices.includes(key) || !owner || this.controller.busy || this.controller.api.pending) return
    const hp = s.maxHp()
    if (!applyChoice(this.builds[owner], owner, key)) return
    if (s.maxHp() > hp) s.hp = Math.min(s.maxHp(), s.hp + s.maxHp() - hp)
    s.choices = []; this.studyOwner = ""
    // Save the choice before resuming; failed acknowledgments keep the scene paused.
    this.controller.action(async () => {
      await this.controller.save()
      this.checkLevel()
      if (!s.choices.length) {
        if (s.encounters?.openReward(true)) return
        this.controller.play()
        const skill = this.skill(owner, key.split(":")[0])
        if (skill) this.controller.notice(`${owner === "player" ? "玩家" : s.meta.character} · ${skillName(skill)} ${skill.level}级 · ${skillControl(this.builds[owner], skill.id)}`)
      }
    })
  }
  reroll() {
    if (this.craft) return this.craft.reroll()
    if (!this.rerolls || !this.studyOwner || this.controller.busy || this.controller.api.pending) return
    this.rerolls--
    this.s.choices = drawChoices(this.builds[this.studyOwner], this.studyOwner, this.s.rng, false)
    this.controller.upgrades(true)
  }
  deal(enemy, amount, owner) {
    const s = this.s
    if (!enemy.active || s.outcome !== "playing") return
    const hp = enemy.getData("hp"), damage = Math.min(hp, amount)
    this.stats[`${owner}_damage`] = Math.min(1e9, this.stats[`${owner}_damage`] + damage)
    enemy.setData("hp", hp - amount)
    if (hp > amount) return
    const kind = enemy.getData("kind"), id = enemy.getData("id"), x = enemy.x, y = enemy.y
    this.frost?.marks.delete(id)
    enemy.destroy(); s.kills++
    if (owner === "companion") s.partnerKills++
    s.makeDrop({ id: s.next(), x, y, amount: kind === "brute" ? 12 : kind === "wisp" ? 5 : 4 })
    s.encounters?.onKill(id, kind)
    if (kind === "boss") s.end("cleared")
  }
  hit(bolt, enemy) {
    const s = this.s
    if (s.paused || s.outcome !== "playing" || !bolt.active || !enemy.active) return
    const hits = bolt.getData("hit_ids"), id = enemy.getData("id")
    if (hits.includes(id)) return
    hits.push(id)
    const owner = bolt.getData("owner"), skill = this.skill(owner, bolt.getData("skill"))
    const position = { x: bolt.x, y: bolt.y }, p = parameters(skill, this.builds[owner])
    s.art?.impact(position.x, position.y, skill.id)
    this.deal(enemy, bolt.getData("damage"), owner)
    if (s.outcome !== "playing") return
    if (s.outcome === "playing") {
      if (skill.id === "ice") this.frost.apply(enemy, owner, skill)
      if (skill.id === "stone") this.expanded?.stoneImpact(enemy, position, skill, owner, bolt.getData("damage"), hits.length === 1)
      if (s.outcome !== "playing") return
      if (skill.id === "fire" && skill.branch === "blast") {
        this.addZone("flame", owner, position, p.blastRadius, bolt.getData("damage") * .22, p.blastDuration)
      }
      if (this.modern && skill.id === "fire" && bolt.getData("form") === "fusion" && hits.length === 1) {
        this.flash(position.x, position.y, 70, COLORS.wind, "fusion")
        for (const other of [...s.enemies.getChildren()]) {
          if (other !== enemy && distance(other, position) <= 70) this.deal(other, bolt.getData("damage") * .35, owner)
          if (s.outcome !== "playing") return
        }
      }
    }
    if (bolt.getData("pierce") > 0) bolt.setData("pierce", bolt.getData("pierce") - 1)
    else bolt.destroy()
  }
  flash(x, y, radius, color, form = "base") {
    if (this.flashes.length >= 16) this.flashes.shift()
    this.flashes.push({ x, y, radius, color, form, until: this.s.elapsed + (form === "base" ? 150 : 320) })
    this.s.art?.burst(x, y, radius, color, form)
  }
  melee(owner, skill, target, multiplier = 1) {
    if (this.s.outcome !== "playing") return
    const actor = this.actor(owner), p = parameters(skill, this.builds[owner])
    const angle = Math.atan2(target.y - actor.y, target.x - actor.x)
    this.s.art?.cast(owner, skill.id, angle)
    const half = p.half
    for (const enemy of [...this.s.enemies.getChildren()]) {
      if (!enemy.active || distance(actor, enemy) > p.range) continue
      if (!this.s.terrain.lineClear(actor, enemy)) continue
      const a = Math.atan2(enemy.y - actor.y, enemy.x - actor.x) - angle
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) > half) continue
      const amount = this.damage(owner, p.damage) * multiplier
      this.deal(enemy, this.frost?.strike(enemy, owner, skill.id, amount) ?? amount, owner)
      if (this.s.outcome !== "playing") return
      if (enemy.active && skill.branch === "sweep" && !isBoss(enemy)) {
        this.push(enemy, actor, p.knockback)
      }
    }
    // Lines reveal the actual arc rather than presenting a melee hit as a projectile.
    const lines = [angle - half, angle, angle + half].map(a => ({
      x: actor.x + Math.cos(a) * p.range, y: actor.y + Math.sin(a) * p.range,
    }))
    const form = skill.evolution === "fusion" ? "fusion" : skill.level === 5 ? "awakened" : "base"
    this.flash(actor.x, actor.y, Math.min(65, p.range), COLORS[skill.id], this.modern ? form : "base")
    this.lastSlash = { x: actor.x, y: actor.y, lines, angle, half, range: p.range,
      until: this.s.elapsed + (this.modern ? 220 : 130), color: form === "fusion" && this.modern ? COLORS.wind : COLORS[skill.id] }
    if (this.modern && skill.evolution === "fusion" && this.s.outcome === "playing") {
      const echo = { ...p, range: 500, count: 1, pierce: 1, damage: p.damage * .35 }
      if (!this.emit(actor, owner, { id: "wind", level: 1, evolution: "" }, echo, angle)) {
        const fallback = this.s.nearest(actor, echo.range)
        if (fallback) this.deal(fallback, this.damage(owner, echo.damage), owner)
      }
    }
  }
  push(enemy, source, amount) {
    const d = Math.max(1, distance(source, enemy))
    this.s.terrain.place(enemy, { x: clamp(enemy.x + (enemy.x - source.x) / d * amount, 35, 1765),
      y: clamp(enemy.y + (enemy.y - source.y) / d * amount, 35, 1165) })
  }
  shoot(source, owner, selected) {
    if (this.s.outcome !== "playing") return false
    const skill = selected || this.builds[owner].skills.find(item => SKILLS[item.id].slot === "auto")
    if (!skill) return false
    const p = parameters(skill, this.builds[owner])
    const expanded = this.expanded?.auto(source, owner, skill, p)
    if (expanded !== undefined && expanded !== null) return expanded
    const target = this.s.nearest(source, p.range)
    if (!target) return false
    if (["slash", "guard"].includes(skill.id)) this.melee(owner, skill, target)
    else return this.emit(source, owner, skill, p, Math.atan2(target.y - source.y, target.x - source.x))
    if (this.s.outcome !== "playing") return false
    return true
  }
  emit(source, owner, skill, p, angle) {
    if (this.s.bullets.countActive() + p.count > 160) return false
    this.s.art?.cast(owner, skill.id, angle)
    const speed = p.speed || 430
    for (let i = 0; i < p.count; i++) {
      const a = angle + (i - (p.count - 1) / 2) * .2
      this.s.makeBullet({
        id: this.s.next(), x: source.x, y: source.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        life: this.modern ? Math.min(3000, Math.ceil(p.range / speed * 1000 + 180)) : 1400,
        damage: this.damage(owner, p.damage), owner, skill: skill.id, pierce: p.pierce, hit_ids: [],
        ...(this.modern ? { form: skill.evolution === "fusion" ? "fusion" : skill.level === 5 ? "awakened" : "base" } : {}),
      })
    }
    return true
  }
  addZone(kind, owner, position, radius, damage, duration, targets = []) {
    // Coalesce damage fields at the budget ceiling instead of charging for a lost effect.
    if (this.zones.length >= 12) {
      const small = this.modern ? 64 : 48
      const existing = this.zones.find(z => z.kind === kind && z.owner === owner && (z.radius <= small) === (radius <= small))
      if (!existing) return false
      existing.x = clamp(position.x, 0, 1800); existing.y = clamp(position.y, 0, 1200)
      existing.radius = Math.max(existing.radius, radius); existing.damage = Math.max(existing.damage, damage)
      existing.expires_at = Math.max(existing.expires_at, this.s.elapsed + duration)
      existing.targets = [...targets]
      return true
    }
    this.zones.push({
      id: this.s.next(), kind, owner, x: clamp(position.x, 0, 1800), y: clamp(position.y, 0, 1200),
      radius, damage, expires_at: this.s.elapsed + duration, tick_at: this.s.elapsed, targets: [...targets],
    })
    return true
  }
  targetGroup(source, range) {
    const targets = this.s.enemies.getChildren().filter(e => e.active && distance(source, e) <= range
      && (!this.expanded || this.s.terrain.lineClear(source, e)))
    if (!targets.length) return null
    let best = targets[0], score = 0
    for (const enemy of targets) {
      const count = targets.filter(other => distance(enemy, other) <= 110).length
      if (count > score) { best = enemy; score = count }
    }
    return best
  }
  castManual(slot) {
    const s = this.s
    if (!s.activeRun || s.paused || s.outcome !== "playing" || this.controller.busy || this.controller.api.pending) return false
    const skill = this.builds.player.skills.filter(item => SKILLS[item.id].slot === "manual")[slot]
    if (!skill) return this.castFailure(`${slot === 0 ? "Q" : "E"} 尚未学习主动技能`)
    if (skill.ready_at > s.elapsed) return this.castFailure(`${skillName(skill)}冷却中 · ${((skill.ready_at - s.elapsed) / 1000).toFixed(1)}秒`)
    const p = parameters(skill, this.builds.player), followups = this.stats.followups
    const expanded = this.expanded?.manual(skill, p)
    if (expanded === false) return false
    if (expanded === true) {
      if (s.outcome !== "playing") return true
    } else if (skill.id === "flame") {
      const target = this.targetGroup(s.player, p.range)
      if (!target) return this.castFailure("焰环范围内没有敌人 · 未消耗冷却")
      if (!this.addZone("flame", "player", target, p.radius, this.damage("player", p.damage) * (s.encounters?.has("embers") ? 1.15 : 1), p.duration)) return this.castFailure("焰环暂无法落地 · 未消耗冷却")
      skill.ready_at = s.elapsed + p.cooldown * (s.encounters?.has("cadence") ? .9 : 1)
      this.follow("flame", { x: target.x, y: target.y })
    } else if (skill.id === "frost") {
      const target = this.targetGroup(s.player, p.range)
      if (!target) return this.castFailure("霜爆范围内没有敌人 · 未消耗冷却")
      const position = { x: target.x, y: target.y }
      if (skill.branch === "mist" && !this.addZone("frost", "player", position, p.radius, this.damage("player", p.damage) * .2, p.duration)) {
        return this.castFailure("霜雾暂无法落地 · 未消耗冷却")
      }
      skill.ready_at = s.elapsed + p.cooldown * (s.encounters?.has("cadence") ? .9 : 1)
      this.flash(position.x, position.y, p.radius, COLORS.ice, "frost")
      for (const enemy of [...s.enemies.getChildren()]) {
        if (!enemy.active || distance(enemy, position) > p.radius) continue
        const extra = skill.branch === "shatter" ? this.frost.consume(enemy, p.breakDamage) : 0
        this.deal(enemy, this.damage("player", p.damage + extra), "player")
        if (s.outcome !== "playing") return true
        this.frost.apply(enemy, "player", skill)
      }
      if (this.expanded) this.follow("frost", position)
    } else if (skill.id === "dash") {
      const start = { x: s.player.x, y: s.player.y }, d = this.facing
      const end = s.terrain.endpoint(s.player, { x: clamp(start.x + d.x * p.range, 35, 1765), y: clamp(start.y + d.y * p.range, 35, 1165) })
      if (distance(start, end) < 8) return this.castFailure("前方有障碍或已到地图边界 · 未消耗突进冷却")
      s.terrain.place(s.player, end); s.hurtUntil = Math.max(s.hurtUntil, s.elapsed + 250)
      skill.ready_at = s.elapsed + p.cooldown * (s.encounters?.has("cadence") ? .9 : 1)
      for (const enemy of [...s.enemies.getChildren()]) {
        const dx = end.x - start.x, dy = end.y - start.y
        const t = clamp(((enemy.x - start.x) * dx + (enemy.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1)
        if (distance(enemy, { x: start.x + t * dx, y: start.y + t * dy }) <= p.width && s.terrain.lineClear(start, enemy)) {
          const amount = this.damage("player", p.damage)
          this.deal(enemy, this.frost?.strike(enemy, "player", skill.id, amount) ?? amount, "player")
          if (s.outcome !== "playing") return true
        }
      }
      if (skill.branch === "guarded") s.shield = Math.min(200, Math.max(s.shield, 12 + skill.level * 2 + p.shieldBonus))
      this.flash(end.x, end.y, 55, COLORS.slash, this.modern && skill.level === 5 ? "awakened" : "base")
      this.follow("dash", end)
    } else return false
    s.art?.cast("player", skill.id, Math.atan2(this.facing.y, this.facing.x))
    if (this.stats.followups === followups) this.controller.notice(`${skillName(skill)} · 已施放`)
    this.lastCastNotice = null
    s.updateHud()
    return true
  }
  castFailure(text) {
    if (this.lastCastNotice?.text !== text || this.s.elapsed - this.lastCastNotice.at >= 800) {
      this.lastCastNotice = { text, at: this.s.elapsed }
      this.controller.notice(text)
    }
    return false
  }
  follow(action, position) {
    if (this.s.outcome !== "playing") return
    if (this.expanded) { this.expanded.follow(action, position); return }
    const id = action === "flame" ? "pull" : "armor", skill = this.skill("companion", id)
    if (skill?.branch !== "follow" || skill.ready_at > this.s.elapsed || distance(this.s.companion, position) > SKILLS[id].range) return
    if (this.support(skill, position, true)) {
      this.controller.notice(`${this.s.meta.character} · ${id === "pull" ? "接续牵引" : "及时覆甲"}`)
    }
  }
  support(skill, position, follow = false) {
    const s = this.s, p = parameters(skill, this.builds.companion)
    if (skill.ready_at > s.elapsed || s.outcome !== "playing") return false
    const expanded = this.expanded?.support(skill, position, follow)
    if (expanded === false) return false
    if (expanded === true) {
      // New support conditions share the same cooldown and statistics commitment.
    } else if (skill.id === "pull") {
      const target = position || this.targetGroup(s.companion, p.range)
      if (!target) return false
      const radius = p.radius + (s.encounters?.has("embers") ? 20 : 0)
      const enemies = s.enemies.getChildren().filter(e => !isBoss(e) && distance(e, target) < radius)
        .sort((a, b) => distance(a, target) - distance(b, target)).slice(0, p.targets)
      if (!enemies.length || !this.addZone("pull", "companion", target, radius, this.damage("companion", p.damage), 1000,
        enemies.map(e => e.getData("id")))) return false
    } else if (skill.id === "armor") {
      if (!follow && s.shield >= 8) return false
      const shield = p.damage * (1 + this.talent("companion", "ward") * .12) * (1 + s.meta.bonus / 100) * (follow ? p.followBonus : 1)
      s.shield = Math.min(200, Math.max(s.shield, shield))
      this.flash(s.player.x, s.player.y, 55, COLORS.guard, this.modern && skill.level === 5 ? "awakened" : "base")
    } else return false
    skill.ready_at = s.elapsed + p.cooldown
    s.art?.cast("companion", skill.id)
    this.stats.supports++
    if (follow) this.stats.followups++
    s.encounters?.onSupport()
    if (skill.id === "armor" && skill.branch === "retaliate") for (const enemy of [...s.enemies.getChildren()]) {
      if (distance(s.player, enemy) < p.retaliateRange) this.deal(enemy, this.damage("companion", p.damage), "companion")
      if (s.outcome !== "playing") return true
    }
    if (skill.id === "armor" && this.modern && skill.level === 5) for (const enemy of s.enemies.getChildren()) {
      if (!isBoss(enemy) && distance(s.player, enemy) < 130) this.push(enemy, s.player, 45)
    }
    return true
  }
  onHurt(enemy) {
    if (this.s.outcome !== "playing") return
    for (const owner of ["player", "companion"]) {
      const skill = this.skill(owner, "guard")
      if (skill?.branch !== "counter" || skill.react_at > this.s.elapsed || !enemy.active
        || distance(this.actor(owner), enemy) > parameters(skill, this.builds[owner]).range) continue
      skill.react_at = this.s.elapsed + parameters(skill, this.builds[owner]).reactCooldown
      this.melee(owner, skill, enemy, 1.6)
    }
  }
  update(delta) {
    const s = this.s
    for (const owner of ["player", "companion"]) for (const skill of this.builds[owner].skills) {
      if (s.outcome !== "playing") return
      if (SKILLS[skill.id].slot !== "auto" || skill.ready_at > s.elapsed) continue
      if (this.shoot(this.actor(owner), owner, skill)) skill.ready_at = s.elapsed + parameters(skill, this.builds[owner]).cooldown
    }
    for (const skill of this.builds.companion.skills) if (SKILLS[skill.id].slot === "support" && skill.ready_at <= s.elapsed) {
      // A brief grace window after readiness gives deliberate player casts priority.
      if (!(skill.branch === "follow" || this.builds.companion.mods?.follow) || s.elapsed >= skill.ready_at + 1500) this.support(skill)
    }
    for (const zone of [...this.zones]) {
      if (s.outcome !== "playing") return
      if (this.expanded?.updateZone(zone)) continue
      if (zone.expires_at <= s.elapsed) { this.zones.splice(this.zones.indexOf(zone), 1); continue }
      if (zone.kind === "pull") {
        for (const enemy of s.enemies.getChildren()) if (zone.targets.includes(enemy.getData("id")) && !isBoss(enemy)) {
          if (distance(enemy, zone) > 12) s.physics.moveTo(enemy, zone.x, zone.y, 150)
          else enemy.setVelocity(0)
        }
      }
      if (zone.tick_at <= s.elapsed) {
        zone.tick_at = s.elapsed + (zone.kind === "frost" ? 1000 : 500)
        for (const enemy of [...s.enemies.getChildren()]) if (distance(enemy, zone) <= zone.radius) {
          this.deal(enemy, zone.damage, zone.owner)
          if (s.outcome !== "playing") return
          if (zone.kind === "frost") this.frost.apply(enemy, zone.owner, this.skill(zone.owner, "frost"), 1)
        }
      }
    }
    this.frost?.update()
    this.paint()
  }
  paint() {
    paintCombat(this)
  }
  labels() {
    return Object.fromEntries(["player", "companion"].map(owner => [owner,
      this.builds[owner].skills.map(skill => `${skillName(skill)} ${skill.level}级`).join(" / ")]))
  }
}
