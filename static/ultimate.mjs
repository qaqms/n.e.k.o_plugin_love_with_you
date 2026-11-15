import { isBoss } from "./encounter-rules.mjs"
import { DEPTH } from "./terrain-rules.mjs"
import { NUMERALS } from "./skills.mjs"

// Rule 9: kills charge one finishing move. The fire school is the first to have one.
export const ULTIMATE = { need: 100, elite: 15, radius: 250, reach: 150, hold: 950, base: 160, perLevel: 20,
  schools: { fire: { name: "炎阳坠", skills: ["fire", "flame", "meteor"], cutin: "art/ultimate-fire-cutin.jpg" } } }
export const ULTIMATE_ART = { "ult-fire-blast": "art/ult-fire-blast.jpg", "ult-fire-rune": "art/ult-fire-rune.jpg", "ult-fire-sun": "art/ult-fire-sun.jpg" }

export const schoolOf = build => Object.keys(ULTIMATE.schools).find(id =>
  build.skills.some(skill => ULTIMATE.schools[id].skills.includes(skill.id))) || ""
export const charge = (energy, kind) => Math.min(ULTIMATE.need, energy + (isBoss(kind) ? ULTIMATE.elite : 1))
export const strike = (level, power) => (ULTIMATE.base + level * ULTIMATE.perLevel) * (1 + power / 100)

const $ = id => document.getElementById(id)

export class Ultimate {
  constructor(scene, controller, snapshot) {
    this.s = scene; this.controller = controller
    this.energy = snapshot?.ultimate.energy ?? 0
    this.pending = 0; this.fx = null
    this.images = Object.fromEntries(Object.keys(ULTIMATE_ART).map(key => [key, scene.textures.exists(key)
      ? scene.add.image(0, 0, key).setBlendMode(Phaser.BlendModes.ADD).setVisible(false) : null]))
    this.images["ult-fire-rune"]?.setDepth(DEPTH.floor + 1)
    this.images["ult-fire-blast"]?.setDepth(DEPTH.effects + 2)
    this.images["ult-fire-sun"]?.setDepth(DEPTH.effects + 3)
  }
  destroy() {
    this.cancel()
    for (const image of Object.values(this.images)) image?.destroy()
    $("ultimate").hidden = true
  }
  data() { return { ultimate: { energy: this.energy } } }
  get school() { return schoolOf(this.s.combat.builds.player) }
  get ready() { return Boolean(this.school) && this.energy >= ULTIMATE.need }
  // Fire resonance III charges half again as fast: one extra point on every second kill.
  onKill(kind) {
    this.energy = charge(this.energy, kind)
    if (this.s.combat.tier("player") >= 3 && this.s.kills % 2 === 0) this.energy = Math.min(ULTIMATE.need, this.energy + 1)
  }
  aim() {
    const s = this.s, f = s.combat.facing, a = s.terrain.geometry.area
    return { x: Math.max(a.left + 40, Math.min(a.right - 40, s.player.x + f.x * ULTIMATE.reach)),
      y: Math.max(a.top + 40, Math.min(a.bottom - 40, s.player.y + f.y * ULTIMATE.reach)) }
  }
  // The cut-in freezes the fight; nothing is spent until it has played out.
  cast() {
    const s = this.s
    if (s.paused || s.outcome !== "playing" || this.pending) return false
    if (!this.school) return false
    if (!this.ready) { this.controller.notice(`${ULTIMATE.schools[this.school].name}蓄能中 · ${this.energy} / ${ULTIMATE.need}`); return false }
    this.pending = performance.now() + ULTIMATE.hold
    this.target = this.aim()
    s.art.hold(ULTIMATE.hold)
    const node = $("cutin"), spec = ULTIMATE.schools[this.school]
    node.querySelector("img").src = spec.cutin
    node.querySelector("strong").textContent = spec.name
    node.hidden = false
    return true
  }
  cancel() {
    this.pending = 0
    $("cutin").hidden = true
    this.images["ult-fire-sun"]?.setVisible(false)
  }
  // Runs every frame, also while the fight is frozen for the cut-in.
  frame() {
    if (!this.pending) return
    const left = this.pending - performance.now(), sun = this.images["ult-fire-sun"]
    if (sun && left < 320) {
      const t = Math.max(0, Math.min(1, 1 - left / 320))
      sun.setVisible(true).setPosition(this.target.x, this.target.y - (1 - t * t) * 420)
        .setScale((1.5 - t * .55) * ULTIMATE.radius / 256).setAlpha(.35 + t * .65).setRotation(t * .6)
    }
    if (left <= 0) this.land()
  }
  land() {
    const s = this.s, point = this.target
    this.cancel()
    this.energy = 0
    const damage = strike(s.level, s.meta.loadout.bonuses.power)
    for (const enemy of [...s.enemies.getChildren()]) {
      if (s.outcome !== "playing") break
      if (!enemy.active || Math.hypot(enemy.x - point.x, enemy.y - point.y) > ULTIMATE.radius) continue
      s.combat.deal(enemy, damage, "player")
      if (s.outcome === "playing") s.combat.ignite(enemy, "player", damage * .5)
    }
    s.hurtUntil = Math.max(s.hurtUntil, s.elapsed + 800)
    this.fx = { ...point, born: s.elapsed }
    const art = s.art
    if (!art.reduced) {
      art.shake(.014, 420)
      art.flare(point.x, point.y, ULTIMATE.radius * 1.3, 0xffe9b0, { life: 260, alpha: .7 })
      for (let i = 0; i < 3; i++) art.ring(point.x, point.y, ULTIMATE.radius * (.7 + i * .35), 0xffb066, { life: 520, delay: i * 90, alpha: .6 })
      art.spray("fx-tongue", point.x, point.y, 26, { speed: 380, lift: -60, life: 620, tint: 0xff9a4d, from: 1.2, to: .2, aim: true })
      art.spray("fx-chunk", point.x, point.y, 16, { speed: 300, lift: -120, gravity: 620, life: 700, tint: 0x7a3a22, from: .7, to: .15, spin: 8, solid: true })
      art.spray("fx-star", point.x, point.y, 14, { speed: 190, lift: -80, life: 900, tint: 0xffe2a0, from: .55, to: .05, spin: 3 })
    }
    this.controller.notice(`终结技 · ${ULTIMATE.schools.fire.name}`)
  }
  paint() {
    const fx = this.fx, blast = this.images["ult-fire-blast"], rune = this.images["ult-fire-rune"]
    if (!fx) return
    const age = this.s.elapsed - fx.born, r = ULTIMATE.radius
    if (age > 2400) { this.fx = null; blast?.setVisible(false); rune?.setVisible(false); return }
    if (blast) {
      const t = Math.min(1, age / 620)
      blast.setVisible(t < 1).setPosition(fx.x, fx.y).setScale((.35 + .95 * (1 - (1 - t) ** 3)) * r * 2 / 512)
        .setAlpha(t < .25 ? 1 : 1 - (t - .25) / .75).setRotation(age / 2600)
    }
    if (rune) {
      const fade = age < 160 ? age / 160 : age > 1500 ? Math.max(0, 1 - (age - 1500) / 900) : 1
      rune.setVisible(true).setPosition(fx.x, fx.y).setScale(r * 2 / 512).setAlpha(.85 * fade).setRotation(age / 5200)
    }
  }
  hud() {
    const node = $("ultimate"), school = this.school
    node.hidden = this.s.paused || !school
    if (!school) return
    node.style.setProperty("--charge", `${this.energy / ULTIMATE.need * 100}%`)
    node.dataset.state = this.ready ? "ready" : "charging"
    node.querySelector(".ult-name").textContent = ULTIMATE.schools[school].name
    node.querySelector(".ult-count").textContent = this.ready ? "就绪" : `${this.energy}%`
    const tier = this.s.combat.tier("player")
    node.querySelector(".ult-res").textContent = tier ? `共鸣${NUMERALS[tier - 1]}` : ""
  }
}
