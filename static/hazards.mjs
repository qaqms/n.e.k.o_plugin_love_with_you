import { HAZARDS, hazardsFor, breakable, DEPTH } from "./terrain-rules.mjs"
import { isBoss } from "./encounter-rules.mjs"

const inside = (actor, [x, y, r]) => Math.hypot(actor.x - x, actor.y - y) <= r

// Rule 16 terrain mechanics: breakable ruin pillars, slowing deep-forest thorns and poison mist.
// Broken pillars and pillar wear are saved; thorns and mist are fixed by the arena.
export class Hazards {
  constructor(scene, snapshot) {
    this.s = scene
    this.broken = [...(snapshot?.terrain?.broken || [])]
    this.wear = { ...(snapshot?.terrain?.wear || {}) }
    this.tickAt = 0; this.rootAt = 0; this.phase = 0
    this.g = scene.add.graphics().setDepth(DEPTH.floor + 1)
    this.mistG = scene.add.graphics().setDepth(DEPTH.effects - 1)
    this.decor = []
    this.apply()
  }
  data() { return { terrain: { broken: [...this.broken], wear: { ...this.wear } } } }
  destroy() { this.g.destroy(); this.mistG.destroy(); for (const image of this.decor) image.destroy(); this.decor = [] }
  get skin() { return this.s.terrain.skin }
  get patches() { return hazardsFor(this.s.terrain.arena, this.skin) }
  // A new node starts with every pillar standing again.
  reset() { this.broken = []; this.wear = {}; this.apply() }
  apply() {
    const t = this.s.terrain
    for (const id of this.broken) t.removeProp(id, "map-ruin-rubble")
    for (const image of this.decor) image.destroy()
    this.decor = []
    this.g.clear()
    const patches = this.patches
    if (!patches) return
    for (const [x, y, r] of patches.thorns) {
      this.g.fillStyle(0x24102b, .5).fillEllipse(x, y, r * 2.1, r * 1.5)
      this.g.lineStyle(2, 0x9a5fb0, .45).strokeEllipse(x, y, r * 2.1, r * 1.5)
      for (let i = 0; i < 10; i++) {
        const a = i * .63 + x % 7, d = r * (.2 + (i % 4) * .2)
        if (this.s.textures.exists("map-deep-rubble")) this.decor.push(this.s.add.image(x + Math.cos(a) * d, y + Math.sin(a) * d * .7, "map-deep-rubble")
          .setScale(1 + (i % 2) * .3).setOrigin(.5, .85).setDepth(100 + y + Math.sin(a) * d * .7).setAlpha(.95))
      }
    }
  }
  // Any damage that lands on a breakable pillar wears it down.
  strike(id, amount) {
    const s = this.s
    if (!id || !amount || this.broken.includes(id) || s.outcome !== "playing") return
    const prop = s.terrain.geometry.props.find(item => item.id === id)
    if (!prop || !breakable(prop, this.skin)) return
    const worn = Math.round((this.wear[id] || 0) + amount)
    if (worn < HAZARDS.pillar.hp) { this.wear[id] = worn; s.art?.impact?.(prop.x, prop.y - 30, "stone"); return }
    delete this.wear[id]
    this.broken.push(id)
    s.terrain.removeProp(id, "map-ruin-rubble")
    const spec = HAZARDS.pillar, point = { x: prop.x, y: prop.y - 10 }, damage = s.combat.damage("player", spec.damage + spec.perLevel * s.level)
    s.art?.shake?.(.008, 220)
    s.art?.spray?.("fx-chunk", point.x, point.y, 14, { speed: 260, lift: -120, gravity: 620, life: 650, tint: 0x9aa39a, from: .7, to: .15, spin: 8, solid: true })
    for (const enemy of [...s.enemies.getChildren()]) {
      if (!enemy.active || Math.hypot(enemy.x - point.x, enemy.y - point.y) > spec.radius) continue
      s.combat.deal(enemy, damage, "player")
      if (s.outcome !== "playing") return
    }
    s.combat.flash(point.x, point.y, spec.radius, 0xc9c2a8, "awakened")
    this.s.controller?.notice?.("石柱倒塌了！")
  }
  // Areas and swings also reach a pillar whose base is inside them.
  area(point, radius, amount) {
    for (const prop of [...this.s.terrain.geometry.props]) {
      if (breakable(prop, this.skin) && Math.hypot(prop.x - point.x, prop.y - 11 - point.y) <= radius + 18) this.strike(prop.id, amount)
    }
  }
  bossPhase() {
    const boss = this.s.enemies.getChildren().find(enemy => enemy.active && enemy.getData("kind") === "boss")
    return boss ? this.s.encounters?.foes.get(boss.getData("id"))?.phase || 1 : 0
  }
  outside(actor) {
    const r = HAZARDS.sanctuary
    return ((actor.x - r.x) / r.rx) ** 2 + ((actor.y - r.y) / r.ry) ** 2 > 1
  }
  sanctuary(now) {
    const s = this.s, phase = this.bossPhase(), g = this.mistG, r = HAZARDS.sanctuary
    this.phase = phase
    if (phase >= 2) for (const prop of s.terrain.geometry.props) if (prop.kind === "rubble") {
      g.fillStyle(0x9cff8a, .25 + .15 * Math.sin(now / 250 + prop.x)).fillCircle(prop.x, prop.y - 22, 22)
    }
    if (phase < 3) return
    // Roots fill the ground outside the platform; standing there hurts.
    g.lineStyle(240, 0x22301a, .38).strokeEllipse(r.x, r.y, r.rx * 2 + 240, r.ry * 2 + 240)
    g.lineStyle(26, 0x3e5a2a, .55).strokeEllipse(r.x, r.y, r.rx * 2 + 26, r.ry * 2 + 26)
    for (let i = 0; i < 36; i++) {
      const a = i / 36 * Math.PI * 2, wave = Math.sin(now / 400 + i) * 8
      g.lineStyle(5, 0x5d3b22, .8).lineBetween(r.x + Math.cos(a) * (r.rx + 4), r.y + Math.sin(a) * (r.ry + 4),
        r.x + Math.cos(a + .08) * (r.rx + 60 + wave), r.y + Math.sin(a + .08) * (r.ry + 50 + wave))
    }
    if (this.rootAt > now) return
    this.rootAt = now + HAZARDS.mist.tick
    if (this.outside(s.player)) { s.hp = Math.max(1, s.hp - r.player); s.lowHealth = s.hp / s.maxHp() <= .3 }
  }
  update() {
    const s = this.s, patches = this.patches, now = s.elapsed
    this.mistG.clear()
    if (this.skin === "boss" && s.meta.rules >= 17) this.sanctuary(now)
    if (!patches) return
    const actors = [s.player, s.companion, ...s.enemies.getChildren().filter(enemy => enemy.active && !isBoss(enemy))]
    for (const actor of actors) if (patches.thorns.some(patch => inside(actor, patch))) {
      actor.setVelocity(actor.body.velocity.x * HAZARDS.thorn.slow, actor.body.velocity.y * HAZARDS.thorn.slow)
    }
    for (const [x, y, r] of patches.mist) {
      for (let i = 0; i < 4; i++) {
        const a = now / 1800 + i * 1.57, d = r * .3
        this.mistG.fillStyle(0x8fd36a, .2).fillEllipse(x + Math.cos(a) * d, y + Math.sin(a) * d * .6, r * 1.5, r * 1.05)
      }
      this.mistG.lineStyle(3, 0xb8f08a, .55).strokeEllipse(x, y, r * 2, r * 1.4)
    }
    if (this.tickAt > now) return
    this.tickAt = now + HAZARDS.mist.tick
    const spec = HAZARDS.mist
    if (patches.mist.some(patch => inside(s.player, patch))) {
      s.hp = Math.max(1, s.hp - spec.player); s.lowHealth = s.hp / s.maxHp() <= .3
    }
    for (const enemy of [...s.enemies.getChildren()]) {
      if (!enemy.active || isBoss(enemy) || !patches.mist.some(patch => inside(enemy, [patch[0], patch[1], patch[2] * 1.1]))) continue
      s.combat.deal(enemy, spec.enemy, "player")
      if (s.outcome !== "playing") return
    }
  }
}
