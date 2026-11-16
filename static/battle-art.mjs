import { FRAME_COUNTS, directionFor } from "./actor-art.mjs"
import { DEPTH } from "./terrain-rules.mjs"
import { isBoss } from "./encounter-rules.mjs"
import { installFxTextures, palette, paletteName, mix, FOE_COLORS } from "./fx-art.mjs"
import { foeSheet } from "./foe-art.mjs"
import { paintZones, paintLines, paintSlash } from "./zone-art.mjs"

// Presentation only. Nothing here reads the run RNG, writes the snapshot or changes a collision body.
export const MAX_PARTICLES = 180
const MAX_TRAILS = 70, MAX_BURSTS = 24, MAX_NUMBERS = 40, MAX_GHOSTS = 24
const TAU = Math.PI * 2, GOLDEN = 2.399963
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const MANUAL = new Set(["flame", "frost", "dash", "quake", "whirl", "meteor"])
const SUPPORT = new Set(["pull", "armor", "heal", "beacon"])
const MELEE = new Set(["slash", "guard"])
const ELITES = new Set(["brute", "charger", "caster"])
const NUMBER_TINT = { player: 0xfff0c4, companion: 0xa9e2ff, shatter: 0xd6fbff, hurt: 0xff8b7d, block: 0xbcdcf5 }

export class BattleArt {
  constructor(scene) {
    this.s = scene
    installFxTextures(scene)
    // Ground decals sit under actors; additive layers sit above them but below enemy warnings.
    this.floor = scene.add.graphics().setDepth(DEPTH.floor + 2)
    this.zoneFloor = scene.add.graphics().setDepth(DEPTH.floor + 1)
    this.zoneGlow = scene.add.graphics().setDepth(DEPTH.effects).setBlendMode(Phaser.BlendModes.ADD)
    this.graphics = scene.add.graphics().setDepth(DEPTH.effects + 1)
    this.glow = scene.add.graphics().setDepth(DEPTH.effects + 2).setBlendMode(Phaser.BlendModes.ADD)
    this.vignette = scene.add.image(0, 0, "fx-vignette").setOrigin(0).setScrollFactor(0)
      .setDepth(DEPTH.warnings + 10).setVisible(false)
    this.sprites = []; this.labels = []; this.shades = []
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
    this.particles = []; this.bursts = []; this.numbers = []; this.ghosts = []
    this.reset()
  }
  reset() {
    for (const p of this.particles) this.free(p.image)
    for (const n of this.numbers) n.label.setVisible(false)
    for (const g of this.ghosts) this.dropGhost(g)
    this.actors = new WeakMap(); this.foes = new WeakMap(); this.motions = new WeakMap(); this.seenLines = new WeakSet()
    this.particles = []; this.bursts = []; this.numbers = []; this.ghosts = []
    this.trails = 0; this.trailAt = 0; this.emberAt = 0; this.serial = 0; this.clock = 0
    this.sparks = 0; this.shatter = null; this.slash = null; this.previous = null; this.swing = null
    this.flashUntil = 0; this.flashAt = 0; this.flashColor = 0xd8372b; this.flashPower = 0
    this.stopLeft = 0; this.stopGate = 0; this.shakeUntil = 0; this.shakeLevel = 0
    for (const g of [this.floor, this.zoneFloor, this.zoneGlow, this.graphics, this.glow]) g.clear()
    this.vignette.setVisible(false)
    if (this.s.player?.active) this.s.player.clearTint()
  }
  destroy() {
    this.reset()
    for (const item of [this.floor, this.zoneFloor, this.zoneGlow, this.graphics, this.glow, this.vignette,
      ...this.sprites, ...this.labels, ...this.shades]) item.destroy()
    this.sprites = []; this.labels = []; this.shades = []
  }
  setReduced(value) {
    this.reduced = value
    for (const p of this.particles) this.free(p.image)
    for (const g of this.ghosts) this.dropGhost(g)
    this.particles = []; this.bursts = []; this.ghosts = []; this.trails = 0
    for (const g of [this.floor, this.graphics, this.glow]) g.clear()
    this.release()
    this.s.cameras.main.shakeEffect?.reset()
    for (const enemy of this.s.enemies.getChildren()) enemy.setAngle(0)
  }

  // Pooled sprites keep density changes from allocating during a fight.
  free(image) { image.setVisible(false); this.sprites.push(image) }
  spawn(texture, x, y, o = {}) {
    if (this.reduced || this.particles.length >= MAX_PARTICLES) return null
    if (o.trail) { if (this.trails >= MAX_TRAILS) return null; this.trails++ }
    const image = this.sprites.pop() || this.s.add.image(0, 0, texture).setDepth(DEPTH.effects + 3)
    image.setTexture(texture).setVisible(true).setPosition(x, y).setTint(o.tint ?? 0xffffff)
      .setBlendMode(o.solid ? Phaser.BlendModes.NORMAL : Phaser.BlendModes.ADD)
      .setRotation(o.rotation || 0).setAlpha(0)
    const p = { image, x, y, vx: o.vx || 0, vy: o.vy || 0, gravity: o.gravity || 0, drag: o.drag || 0,
      born: this.s.elapsed + (o.delay || 0), life: o.life || 300, from: o.from ?? .5, to: o.to ?? 0,
      alpha: o.alpha ?? 1, spin: o.spin || 0, aim: Boolean(o.aim), trail: Boolean(o.trail),
      stretch: o.stretch || 1, hold: o.hold ?? 0 }
    this.particles.push(p)
    return p
  }
  spray(texture, x, y, count, o = {}) {
    for (let i = 0; i < count; i++) {
      const n = this.serial++, a = (o.angle ?? n * GOLDEN) + (o.spread ? ((n * 7 % 11) / 10 - .5) * o.spread : 0)
      const speed = (o.speed || 120) * (.55 + (n * 5 % 9) / 9 * .9)
      this.spawn(texture, x + Math.cos(a) * (o.offset || 0), y + Math.sin(a) * (o.offset || 0), {
        ...o, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed + (o.lift || 0),
        life: (o.life || 300) * (.75 + (n % 4) * .15), rotation: o.aim ? a : n * 1.7,
        spin: o.spin ? (n % 2 ? o.spin : -o.spin) : 0,
      })
    }
  }
  ring(x, y, radius, tint, o = {}) {
    return this.spawn("fx-ring", x, y, { tint, from: (o.start ?? .25) * radius / 60, to: radius / 60,
      life: o.life || 320, alpha: o.alpha ?? .9, delay: o.delay, solid: o.solid })
  }
  // A burning enemy sheds a couple of small flames on each burn tick.
  ember(x, y) {
    this.spray("fx-tongue", x, y - 8, 1, { speed: 30, lift: -70, life: 380, tint: 0xff7a3a, from: .38, to: .08, alpha: .7 })
  }
  flare(x, y, size, tint, o = {}) {
    return this.spawn("fx-glow", x, y, { tint, from: size / 32 * (o.start ?? .6), to: size / 32 * (o.end ?? 1.25),
      life: o.life || 200, alpha: o.alpha ?? .9, delay: o.delay })
  }

  // --- camera and timing feedback -------------------------------------------------------------
  shake(intensity, duration) {
    if (this.reduced || !this.s.activeRun || this.s.paused) return
    const now = performance.now()
    if (now < this.shakeUntil && intensity <= this.shakeLevel) return
    this.shakeLevel = intensity; this.shakeUntil = now + duration
    this.s.cameras.main.shake(duration, intensity, true)
  }
  // Hit-stop freezes the simulation clock and physics together for a few frames of wall-clock time.
  stop(duration) {
    const s = this.s, now = performance.now()
    if (this.reduced || !s.activeRun || s.paused || s.outcome !== "playing" || now < this.stopGate) return
    this.stopGate = now + 380; this.stopLeft = duration; this.stopEnd = now + duration
    s.physics.world.pause()
  }
  // A deliberate freeze for a cut-in; unlike a hit-stop it is not rate limited.
  hold(duration) {
    const now = performance.now()
    this.stopGate = now + duration + 380; this.stopLeft = duration; this.stopEnd = now + duration
    this.s.physics.world.pause()
  }
  // Measured on the wall clock, so a slow or uneven frame cannot shorten or stretch the pause.
  stall() {
    if (this.stopLeft <= 0) return false
    this.stopLeft = this.stopEnd - performance.now()
    if (this.stopLeft > 0) return true
    this.stopLeft = 0
    if (!this.s.paused) this.s.physics.world.resume()
    return false
  }
  release() { this.stopLeft = 0 }

  // --- casting --------------------------------------------------------------------------------
  cast(owner, skill, angle = 0) {
    const s = this.s, actor = owner === "player" ? s.player : s.companion
    const state = this.actors.get(actor) || { direction: "down" }
    state.direction = directionFor(Math.cos(angle) * 10, Math.sin(angle) * 10, state.direction)
    state.castAt = s.elapsed; state.castUntil = s.elapsed + 320
    this.actors.set(actor, state)
    const pal = palette(skill), heavy = MANUAL.has(skill) || SUPPORT.has(skill)
    this.swing = MELEE.has(skill) ? { at: s.elapsed, x: actor.x, y: actor.y } : null
    this.burst(actor.x, actor.y + 12, heavy ? 34 : 20, pal.mid, "cast", skill)
    if (this.reduced) return
    const hand = { x: actor.x + Math.cos(angle) * 14, y: actor.y - 4 + Math.sin(angle) * 10 }
    this.flare(hand.x, hand.y, heavy ? 26 : 11, pal.mid, { life: 170, alpha: heavy ? .8 : .55 })
    this.spray("fx-streak", hand.x, hand.y, heavy ? 5 : 2, { angle, spread: 1.1, speed: heavy ? 190 : 140,
      life: 190, tint: pal.hot, from: .5, to: .1, aim: true })
    if (skill === "dash" && owner === "player" && this.previous) {
      const from = this.previous, steps = 4
      for (let i = 0; i < steps; i++) {
        const t = i / steps
        this.ghost(actor, { x: from.x + (actor.x - from.x) * t, y: from.y + (actor.y - from.y) * t,
          tint: pal.mid, alpha: .35 + t * .4, life: 170 + i * 45, trail: true })
      }
      this.spray("fx-streak", (from.x + actor.x) / 2, (from.y + actor.y) / 2, 8, { angle: angle + Math.PI, spread: .5,
        speed: 260, life: 240, tint: pal.hot, from: .9, to: .2, aim: true, offset: 20 })
      this.shake(.004, 110)
    }
  }

  // --- bursts ---------------------------------------------------------------------------------
  burst(x, y, radius, color, form = "base", key = "") {
    if (this.bursts.length >= MAX_BURSTS) this.bursts.shift()
    const now = this.s.elapsed, pal = palette(key || (form === "hurt" ? color : paletteName(color) || color))
    const life = form === "cast" ? 300 : ["quake", "meteor", "frost"].includes(form) ? 620 : 380
    this.bursts.push({ x, y, radius, color, form, pal, born: now, until: now + life, seed: this.serial++ })
    if (form === "shatter") this.shatter = { x, y, at: now }
    if (this.reduced) return
    if (form === "cast") {
      this.spray("fx-star", x, y - 6, 3, { speed: 34, lift: -46, life: 420, tint: pal.hot, from: .16, to: .02, offset: radius * .6 })
    } else if (form === "shatter") {
      this.spawn("fx-star", x, y, { tint: pal.hot, from: .5, to: 2.1, life: 210, spin: 3 })
      this.flare(x, y, 46, pal.mid, { life: 240 })
      this.ring(x, y, radius * 1.15, pal.hot, { life: 300 })
      this.spray("fx-shard", x, y, 12, { speed: 250, gravity: 520, life: 520, tint: pal.hot, from: .55, to: .15, spin: 9, solid: true, hold: .6 })
      this.spray("fx-streak", x, y, 6, { speed: 320, life: 200, tint: pal.hot, from: .8, to: .1, aim: true })
      this.shake(.0045, 120); this.stop(45)
    } else if (form === "frost") {
      this.ring(x, y, radius, pal.hot, { life: 380 })
      this.ring(x, y, radius * .7, pal.mid, { life: 460, delay: 60, alpha: .6 })
      this.flare(x, y, radius * .8, pal.mid, { life: 260, alpha: .3 })
      this.spray("fx-shard", x, y, 10, { speed: radius * 2.3, drag: 3, life: 520, tint: pal.hot, from: .5, to: .2, spin: 4, solid: true, hold: .5 })
      this.spray("fx-puff", x, y, 4, { speed: 46, life: 560, tint: 0xdff6ff, from: .8, to: 1.6, alpha: .2, solid: true, offset: radius * .45 })
      this.shake(.003, 110)
    } else if (form === "stone" || form === "quake") {
      const big = form === "quake"
      this.ring(x, y, radius, pal.hot, { life: 340, solid: true, alpha: .7 })
      if (big) this.ring(x, y, radius * 1.25, pal.mid, { life: 460, delay: 90, solid: true, alpha: .45 })
      this.spray("fx-chunk", x, y, big ? 12 : 6, { speed: big ? 210 : 150, lift: -150, gravity: 720, life: 560,
        tint: pal.mid, from: big ? .75 : .55, to: .3, spin: 7, solid: true, hold: .7, offset: radius * .3 })
      this.spray("fx-puff", x, y, big ? 8 : 4, { speed: 70, life: 560, tint: 0xcdbd9c, from: .9, to: 2.1, alpha: .38, solid: true, offset: radius * .55 })
      this.shake(big ? .006 : .0025, big ? 170 : 90)
      if (big) this.stop(35)
    } else if (form === "meteor") {
      this.flare(x, y, radius * 1.5, pal.hot, { life: 240, start: .4 })
      this.flare(x, y, radius * 1.9, pal.deep, { life: 420, alpha: .6 })
      this.ring(x, y, radius * 1.1, pal.mid, { life: 360 })
      this.ring(x, y, radius * 1.5, pal.deep, { life: 520, delay: 70, alpha: .5 })
      this.spray("fx-streak", x, y, 12, { speed: 330, lift: -90, gravity: 380, life: 420, tint: pal.hot, from: 1, to: .15, aim: true })
      this.spray("fx-tongue", x, y, 6, { speed: 60, lift: -70, life: 460, tint: pal.mid, from: .9, to: .2, offset: radius * .4 })
      this.spray("fx-puff", x, y, 4, { speed: 40, lift: -40, life: 760, tint: 0x4d3b38, from: 1.1, to: 2.6, alpha: .4, solid: true, offset: radius * .3 })
      this.shake(.008, 220); this.stop(50)
    } else if (form === "rune") {
      this.flare(x, y, radius, pal.mid, { life: 260 })
      this.ring(x, y, radius, pal.hot, { life: 300 })
      this.spawn("fx-star", x, y, { tint: pal.hot, from: .4, to: 1.7, life: 220, spin: -4 })
      this.spray("fx-streak", x, y, 8, { speed: 240, life: 260, tint: pal.mid, from: .8, to: .1, aim: true })
      this.shake(.003, 100)
    } else if (form === "heal") {
      this.flare(x, y, 60, pal.mid, { life: 420, alpha: .55 })
      this.ring(x, y, radius, pal.hot, { life: 420, alpha: .7 })
      this.spray("fx-star", x, y, 7, { speed: 30, lift: -70, life: 620, tint: pal.hot, from: .3, to: .04, offset: 16, spin: 2 })
    } else if (form === "hurt") {
      this.ring(x, y, radius * 1.3, pal.mid, { life: 240 })
      this.spray("fx-streak", x, y, 6, { speed: 230, life: 220, tint: pal.hot, from: .7, to: .1, aim: true })
    } else if (this.swing?.at === now && this.swing.x === x && this.swing.y === y) {
      // A sword swing: the crescent carries it, so only evolved forms add sparks here.
      if (form !== "base") this.spray("fx-streak", x, y, 8, { speed: 280, life: 260, tint: form === "fusion" ? 0xd6fff2 : 0xfff0b0, from: .8, to: .1, aim: true, offset: radius * .5 })
    } else if (form === "fusion" || form === "awakened") {
      this.ring(x, y, radius, pal.hot, { life: 300 })
      this.ring(x, y, radius * 1.3, form === "fusion" ? 0x93e8cb : 0xffd27a, { life: 420, delay: 70, alpha: .7 })
      this.flare(x, y, radius * .9, pal.mid, { life: 240, alpha: .6 })
      this.spray("fx-streak", x, y, 9, { speed: 260, life: 260, tint: form === "fusion" ? 0xd6fff2 : 0xfff0b0, from: .8, to: .1, aim: true })
      this.spawn("fx-star", x, y, { tint: 0xffffff, from: .3, to: 1.3, life: 200, spin: 3 })
    } else if (form !== "impact") {
      this.ring(x, y, radius, pal.hot, { life: 280, alpha: .75 })
      this.spray("fx-streak", x, y, 4, { speed: 190, life: 220, tint: pal.mid, from: .6, to: .1, aim: true })
    }
  }
  impact(x, y, skill) {
    const pal = palette(skill)
    this.burst(x, y, skill === "fire" ? 23 : 16, pal.mid, "impact", skill)
    if (this.reduced) return
    if (skill === "fire") {
      this.flare(x, y, 44, pal.mid, { life: 190 }); this.flare(x, y, 22, pal.hot, { life: 130 })
      this.ring(x, y, 36, pal.deep, { life: 250, alpha: .8 })
      this.spray("fx-streak", x, y, 5, { speed: 210, lift: -40, life: 300, tint: pal.hot, from: .6, to: .08, aim: true })
      this.spawn("fx-puff", x, y - 4, { tint: 0x5a4038, vy: -34, from: .5, to: 1.3, life: 480, alpha: .32, solid: true })
    } else if (skill === "ice") {
      this.flare(x, y, 30, pal.mid, { life: 170 })
      this.ring(x, y, 28, pal.hot, { life: 240, alpha: .8 })
      this.spray("fx-shard", x, y, 5, { speed: 190, gravity: 420, life: 400, tint: pal.hot, from: .38, to: .12, spin: 8, solid: true, hold: .6 })
    } else if (skill === "wind") {
      this.flare(x, y, 24, pal.mid, { life: 150, alpha: .7 })
      this.spray("fx-streak", x, y, 4, { speed: 250, life: 200, tint: pal.hot, from: .8, to: .1, aim: true })
    } else if (skill === "stone") {
      this.spray("fx-chunk", x, y, 4, { speed: 160, lift: -110, gravity: 640, life: 440, tint: pal.mid, from: .5, to: .25, spin: 7, solid: true, hold: .7 })
      this.spawn("fx-puff", x, y, { tint: 0xcdbd9c, from: .6, to: 1.6, life: 380, alpha: .4, solid: true })
      this.shake(.0015, 70)
    } else {
      this.flare(x, y, 26, pal.mid, { life: 160 })
      this.spray("fx-streak", x, y, 3, { speed: 200, life: 200, tint: pal.hot, from: .6, to: .1, aim: true })
    }
  }

  // --- damage, kills and the player's own hurt state ------------------------------------------
  number(x, y, amount, style, key) {
    if (amount < .5) return
    const now = this.s.elapsed
    let entry = key !== undefined && this.numbers.find(n => n.key === key && n.style === style && now - n.born < 160)
    if (entry) { entry.amount += amount; entry.born = now }
    else {
      if (this.numbers.length >= MAX_NUMBERS) this.numbers.shift().label.setVisible(false)
      const label = this.labels.find(item => !item.visible) || this.labels[this.labels.push(
        this.s.add.bitmapText(0, 0, "fx-digits", "").setOrigin(.5).setDepth(DEPTH.bolts + 1).setLetterSpacing(-7)) - 1]
      entry = { label, key, style, amount, born: now, x, y, shift: (this.serial++ * 37 % 25) - 12 }
      this.numbers.push(entry); label.setVisible(true).setTint(NUMBER_TINT[style])
    }
    entry.x = x; entry.y = y
    entry.label.setText(`${style === "hurt" ? "-" : ""}${Math.max(1, Math.round(entry.amount))}`)
  }
  // Called for every point of damage an enemy takes; lethal hits also get a death beat.
  strike(enemy, amount, owner, lethal) {
    const s = this.s, now = s.elapsed, actor = owner === "companion" ? s.companion : s.player
    const top = enemy.y - enemy.displayHeight * .42
    const broke = this.shatter && this.shatter.at === now && Math.hypot(this.shatter.x - enemy.x, this.shatter.y - enemy.y) < 6
    this.number(enemy.x, top, amount, broke ? "shatter" : owner === "companion" ? "companion" : "player", enemy.getData("id"))
    if (lethal) return this.kill(enemy, owner)
    const state = this.foes.get(enemy) || { tinted: enemy.isTinted, tint: enemy.tintTopLeft, lit: false, flashAt: -1e9 }
    this.foes.set(enemy, state)
    // Small repeated ticks should not strobe the whole pack; they keep the number and skip the flash.
    if (amount < 10 && now - state.flashAt < 450) return
    state.flashAt = now; state.flashUntil = now + (this.reduced ? 50 : 55 + Math.min(45, amount))
    state.kickAt = now; state.kick = (enemy.x >= actor.x ? 1 : -1) * (isBoss(enemy) ? 3 : Math.min(12, 5 + amount / 6))
    if (this.reduced || this.sparks++ > 10) return
    const away = Math.atan2(enemy.y - actor.y, enemy.x - actor.x)
    this.spray("fx-streak", enemy.x, enemy.y - 4, 2, { angle: away, spread: 1.3, speed: 170, life: 170,
      tint: owner === "companion" ? 0xc9ecff : 0xfff3d0, from: .45, to: .08, aim: true })
  }
  kill(enemy, owner) {
    const kind = enemy.getData("kind"), color = FOE_COLORS[kind] || 0xcfd6d0, boss = isBoss(enemy), elite = ELITES.has(kind)
    const x = enemy.x, y = enemy.y, size = enemy.displayWidth
    const sheet = foeSheet(this.s, kind)
    this.ghost(enemy, { x, y, life: sheet ? boss ? 700 : 380 : boss ? 520 : 240, pop: true, tint: mix(color, 0xffffff, .55), death: sheet?.death })
    if (this.reduced) return
    this.flare(x, y, size * (boss ? 1.6 : .85), mix(color, 0xffffff, boss ? .6 : .4), { life: boss ? 320 : 170, alpha: boss ? .65 : .55 })
    this.ring(x, y, size * (boss ? 1.7 : 1.1), color, { life: boss ? 480 : 260, alpha: boss ? .6 : .85 })
    this.spray("fx-chunk", x, y, boss ? 18 : elite ? 9 : 6, { speed: boss ? 300 : 170, lift: -90, gravity: 560,
      life: boss ? 760 : 430, tint: color, from: boss ? .9 : .5, to: .12, spin: 8, solid: true, hold: .5 })
    this.spray("fx-puff", x, y, boss ? 8 : 2, { speed: boss ? 90 : 36, lift: -20, life: boss ? 800 : 380, tint: color,
      from: .6, to: boss ? 2.6 : 1.4, alpha: .4, solid: true })
    if (boss) {
      for (let i = 1; i <= 2; i++) this.ring(x, y, 110 + i * 55, mix(color, 0xffffff, .5), { life: 560, delay: i * 120, alpha: .32 })
      this.spray("fx-streak", x, y, 22, { speed: 420, life: 520, tint: 0xfff3d0, from: 1.2, to: .2, aim: true })
      this.spray("fx-star", x, y, 8, { speed: 150, lift: -60, life: 800, tint: 0xfff3d0, from: .5, to: .05, spin: 3 })
      this.shake(.013, 420); this.stop(120)
    } else if (elite) this.shake(.003, 110)
  }
  ghost(source, o) {
    if (this.ghosts.length >= MAX_GHOSTS) this.dropGhost(this.ghosts.shift())
    const image = this.shades.pop() || this.s.add.image(0, 0, source.texture.key)
    image.setTexture(source.texture.key, source.frame.name).setVisible(true).setPosition(o.x, o.y)
      .setScale(source.scaleX, source.scaleY).setFlipX(source.flipX).setDepth(source.depth).setAngle(source.angle)
    if (o.pop) image.setTintFill(0xffffff).setBlendMode(Phaser.BlendModes.NORMAL)
    else image.setTintFill(o.tint).setBlendMode(Phaser.BlendModes.ADD)
    this.ghosts.push({ image, born: this.s.elapsed, life: o.life, pop: Boolean(o.pop), alpha: o.alpha ?? 1, tint: o.tint, death: o.death || null,
      scaleX: source.scaleX, scaleY: source.scaleY, hide: o.hide || null })
    return image
  }
  dropGhost(ghost) {
    ghost.image.setVisible(false); this.shades.push(ghost.image)
    if (ghost.hide?.active) ghost.hide.setAlpha(1)
  }
  // Experience crystals hop out of the body; the real pickup is revealed when the hop lands.
  drop(drop) {
    if (this.reduced || !drop?.active) return
    drop.setAlpha(0)
    this.ghost(drop, { x: drop.x, y: drop.y, life: 260, tint: 0xe3d5f0, hide: drop }).setDepth(DEPTH.effects)
    this.ghosts.at(-1).hop = { x: drop.x, y: drop.y, side: (this.serial++ % 2 ? 1 : -1) * 5 }
  }
  hurt(amount = 0, blocked = 0) {
    const s = this.s, now = s.elapsed
    const state = this.actors.get(s.player) || { direction: "down" }
    state.hurtAt = now; state.hurtUntil = now + 160
    this.actors.set(s.player, state)
    const guard = amount <= 0 && blocked > 0
    this.burst(s.player.x, s.player.y, 25, guard ? 0xb4d8e4 : 0xe6a7a0, guard ? "base" : "hurt", guard ? "guard" : "hurt")
    this.number(s.player.x, s.player.y - 26, guard ? blocked : amount, guard ? "block" : "hurt", guard ? "block" : "hurt")
    this.flashAt = now; this.flashUntil = now + (guard ? 260 : 460)
    this.flashColor = guard ? 0x9fc8e8 : 0xd8372b
    this.flashPower = guard ? .28 : clamp(.4 + amount / 60, .45, .85) * (this.reduced ? .5 : 1)
    this.shake(guard ? .004 : .009, guard ? 110 : 190)
    if (!guard) this.stop(60)
  }
  // Enemy attacks that actually fire get their own landing beat, above friendly effects.
  enemyStrike(threat) {
    if (this.reduced) return
    const pal = palette("hurt")
    if (threat.kind === "circle") {
      this.ring(threat.x, threat.y, threat.radius, pal.mid, { life: 300, alpha: .8 })
      this.flare(threat.x, threat.y, threat.radius * 1.2, pal.deep, { life: 260, alpha: .5 })
      this.spray("fx-chunk", threat.x, threat.y, 6, { speed: 150, lift: -120, gravity: 620, life: 440, tint: 0xb98a8a,
        from: .5, to: .2, spin: 7, solid: true, hold: .7, offset: threat.radius * .4 })
      this.shake(.003, 110)
    } else {
      const angle = Math.atan2(threat.ey - threat.y, threat.ex - threat.x)
      for (let i = 0; i < 6; i++) {
        const t = i / 5
        this.spray("fx-puff", threat.x + (threat.ex - threat.x) * t, threat.y + (threat.ey - threat.y) * t, 1,
          { speed: 30, life: 420, tint: 0xcdbd9c, from: .6, to: 1.6, alpha: .34, solid: true })
      }
      this.spray("fx-streak", threat.ex, threat.ey, 5, { angle: angle + Math.PI, spread: 1, speed: 230, life: 240,
        tint: pal.hot, from: .8, to: .1, aim: true })
      this.shake(.003, 110)
    }
  }

  // --- per-frame ------------------------------------------------------------------------------
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
    const s = this.s, now = s.elapsed
    if (now < this.clock) this.clock = now
    const dt = Math.min(50, now - this.clock) / 1000
    this.clock = now; this.sparks = 0
    this.animate(s.player, s.meta.player_class, "player"); this.animate(s.companion, s.meta.companion_class, "companion")
    this.previous = { x: s.player.x, y: s.player.y }
    this.foesFrame(now)
    this.trailFrame(now)
    this.particleFrame(now, dt)
    this.burstFrame(now)
    this.numberFrame(now)
    this.ghostFrame(now)
    this.playerFrame(now)
  }
  // Presentation-only attack poses: the encounter AI's wind-up, the moment it strikes, and contact hits.
  motionOf(enemy, now) {
    const motion = this.motions.get(enemy) || { attackUntil: 0, last: "" }
    this.motions.set(enemy, motion)
    const ai = this.s.encounters?.foes.get(enemy.getData("id")), state = ai?.state || ""
    if (motion.last === "windup" && state !== "windup") this.strikeFx(enemy, now)
    motion.last = state
    if (state === "windup") return "windup"
    return motion.attackUntil > now ? "attack" : ""
  }
  lunge(enemy) {
    const now = this.s.elapsed, motion = this.motions.get(enemy) || { attackUntil: 0, last: "" }
    this.motions.set(enemy, motion)
    if (motion.attackUntil > now - 250) return
    motion.attackUntil = now + 320
    this.strikeFx(enemy, now, true)
  }
  strikeFx(enemy, now, contact = false) {
    const motion = this.motions.get(enemy)
    if (motion) motion.attackUntil = Math.max(motion.attackUntil, now + 320)
    if (this.reduced) return
    const kind = enemy.getData("kind"), color = FOE_COLORS[kind] || 0xcfd6d0, x = enemy.x, y = enemy.y + 10
    const big = isBoss(enemy), size = big ? 1.6 : contact ? .7 : 1
    if (["brute", "sentinel", "boss"].includes(kind)) {
      this.ring(x, y, 60 * size, mix(color, 0xffffff, .4), { life: 300, alpha: .7 })
      this.spray("fx-chunk", x, y, big ? 10 : 5, { speed: 160, lift: -110, gravity: 600, life: 420, tint: 0x8a7a62, from: .5, to: .12, spin: 8, solid: true })
    } else if (kind === "charger") {
      this.spray("fx-puff", x, y + 6, 4, { speed: 60, lift: -10, life: 420, tint: 0xd9c6a4, from: .5, to: 1.4, alpha: .5, solid: true })
    } else if (kind === "slime") {
      this.ring(x, y, 34 * size, 0x9be06a, { life: 240, alpha: .8 })
    } else {
      this.flare(x, y - 14, 40 * size, mix(color, 0xffffff, .5), { life: 200, alpha: .6 })
    }
  }
  foesFrame(now) {
    for (const enemy of this.s.enemies.getChildren()) {
      const kind = enemy.getData("kind"), id = enemy.getData("id"), sheet = foeSheet(this.s, kind)
      if (sheet) {
        // Cut-out frames: a hop cycle, replaced by the flinch while a recent hit is still landing.
        const hit = this.foes.get(enemy), age = hit ? now - hit.kickAt : 1e9
        const flinch = age >= 0 && age < sheet.hurt[1] * sheet.hurt[2]
        // Wind-up follows the encounter AI; the strike pose plays when it lets go, or when the enemy touches you.
        const motion = this.motionOf(enemy, now)
        const frame = flinch ? sheet.hurt[0] + Math.floor(age / sheet.hurt[2])
          : motion === "attack" && sheet.attack ? sheet.attack[0] + Math.floor(now / sheet.attack[2]) % sheet.attack[1]
          : motion === "windup" && sheet.windup ? sheet.windup[0] + Math.floor(now / sheet.windup[2]) % sheet.windup[1]
          : sheet.move[0] + Math.floor((now + id * 43) / sheet.move[2]) % sheet.move[1]
        if (enemy.frame.name !== frame) enemy.setFrame(frame)
        const face = this.s.player.x < enemy.x - 6 ? true : this.s.player.x > enemy.x + 6 ? false : enemy.flipX
        if (enemy.flipX !== face) enemy.setFlipX(face)
      } else if (kind === "slime" || kind === "wisp") {
        const key = `${kind}-motion-${Math.floor((now + id * 43) / 130) % 6}`
        if (enemy.frame.name !== key) enemy.setTexture("actors-v2", key)
      }
      const state = this.foes.get(enemy)
      if (state) {
        if (state.flashUntil > now) {
          if (!state.lit) { state.lit = true; this.reduced ? enemy.setTint(0xffe9e0) : enemy.setTintFill(0xffffff) }
        } else if (state.lit) {
          state.lit = false
          if (state.tinted) enemy.setTint(state.tint); else enemy.clearTint()
        }
      }
      if (this.reduced) continue
      // Rotation is render-only: arcade bodies neither rotate nor resize with it.
      const moving = Math.hypot(enemy.body.velocity.x, enemy.body.velocity.y) > 4
      const sway = kind === "slime" || kind === "wisp" || !moving ? 0 : Math.sin((now + id * 97) / (isBoss(enemy) ? 260 : 150)) * (isBoss(enemy) ? 2 : 4)
      const kick = state && !sheet ? state.kick * Math.max(0, 1 - (now - state.kickAt) / 170) : 0
      enemy.setAngle(sway + kick)
    }
  }
  trailFrame(now) {
    if (this.reduced || now < this.trailAt) return
    this.trailAt = now + 45
    for (const bolt of this.s.bullets.getChildren()) {
      const skill = bolt.getData("skill"), v = bolt.body.velocity, back = Math.atan2(-v.y, -v.x), n = this.serial++
      const pal = palette(bolt.getData("form") === "fusion" ? "wind" : skill || "slash")
      if (skill === "ice") {
        this.spawn("fx-shard", bolt.x, bolt.y, { trail: true, tint: pal.hot, from: .22, to: .05, life: 260, spin: 6, vy: 22, solid: true, rotation: n })
      } else if (skill === "wind") {
        this.spawn("fx-streak", bolt.x, bolt.y, { trail: true, tint: pal.mid, from: .7, to: .15, life: 170, rotation: back + Math.PI, alpha: .7 })
      } else if (skill === "stone") {
        this.spawn("fx-puff", bolt.x, bolt.y, { trail: true, tint: 0xcdbd9c, from: .35, to: .9, life: 320, alpha: .3, solid: true })
      } else {
        this.spawn("fx-glow", bolt.x, bolt.y, { trail: true, tint: n % 3 ? pal.mid : pal.deep, from: .42, to: .06, life: 250,
          vx: Math.cos(back) * 26, vy: Math.sin(back) * 26 - 16, alpha: .75 })
      }
    }
    // Standing fire and frost shed a slow trickle of embers and flakes.
    if (now < this.emberAt) return
    this.emberAt = now + 110
    for (const zone of this.s.combat?.zones || []) {
      if (zone.kind !== "flame" && zone.kind !== "frost" && zone.kind !== "beacon") continue
      const n = this.serial++, a = n * GOLDEN, r = zone.radius * Math.sqrt((n * 13 % 17) / 17) * (zone.kind === "beacon" ? .1 : .9)
      const x = zone.x + Math.cos(a) * r, y = zone.y + Math.sin(a) * r * (zone.kind === "beacon" ? 1 : .9) - (zone.kind === "beacon" ? 20 : 0)
      if (zone.kind === "flame") {
        this.spawn("fx-tongue", x, y, { trail: true, tint: n % 2 ? 0xffb057 : 0xff7a3a, from: .5, to: .12, life: 520, vy: -58, alpha: .8 })
      } else if (zone.kind === "frost") {
        this.spawn("fx-star", x, y, { trail: true, tint: 0xf2fdff, from: .16, to: .02, life: 620, vy: -14, spin: 2, alpha: .8 })
      } else {
        this.spawn("fx-glow", x, y, { trail: true, tint: 0xaedcf5, from: .2, to: .03, life: 520, vy: -30, alpha: .7 })
      }
    }
  }
  particleFrame(now, dt) {
    let kept = 0
    for (const p of this.particles) {
      const age = now - p.born
      if (age >= p.life) { if (p.trail) this.trails--; this.free(p.image); continue }
      this.particles[kept++] = p
      if (age < 0) continue
      const k = age / p.life
      if (p.drag) { const slow = Math.max(0, 1 - p.drag * dt); p.vx *= slow; p.vy *= slow }
      p.vy += p.gravity * dt; p.x += p.vx * dt; p.y += p.vy * dt
      const scale = p.from + (p.to - p.from) * (1 - (1 - k) * (1 - k))
      const fade = k < p.hold ? 1 : 1 - (k - p.hold) / (1 - p.hold)
      p.image.setPosition(p.x, p.y).setScale(scale * p.stretch, scale).setAlpha(p.alpha * fade)
      if (p.aim) p.image.setRotation(Math.atan2(p.vy, p.vx))
      else if (p.spin) p.image.rotation += p.spin * dt
    }
    this.particles.length = kept
  }
  burstFrame(now) {
    const g = this.graphics, floor = this.floor, glow = this.glow
    g.clear(); floor.clear(); glow.clear()
    this.bursts = this.bursts.filter(b => b.until > now)
    for (const b of this.bursts) {
      const t = clamp((now - b.born) / (b.until - b.born), 0, 1), fade = 1 - t
      if (this.reduced) {
        const r = b.radius * (.35 + t * .65)
        g.lineStyle(b.form === "cast" ? 1 : 2, b.pal.mid, fade * .65).strokeCircle(b.x, b.y, r)
        continue
      }
      if (b.form === "cast") {
        // A short magic circle under the caster's feet.
        const r = b.radius * (.6 + Math.min(1, t * 3) * .4), spin = now / 260 + b.seed, alpha = Math.sin(Math.PI * Math.min(1, t * 1.15)) * .8
        floor.lineStyle(2, b.pal.mid, alpha).strokeEllipse(b.x, b.y, r * 2, r)
        floor.lineStyle(1, b.pal.hot, alpha * .8).strokeEllipse(b.x, b.y, r * 1.5, r * .75)
        const sides = b.radius > 24 ? 6 : 3, points = []
        for (let i = 0; i <= sides; i++) {
          const a = spin + i / sides * TAU
          points.push({ x: b.x + Math.cos(a) * r * .98, y: b.y + Math.sin(a) * r * .49 })
        }
        floor.lineStyle(1.2, b.pal.hot, alpha * .7).strokePoints(points)
        glow.fillStyle(b.pal.mid, alpha * .12).fillEllipse(b.x, b.y, r * 2, r)
      } else if (b.form === "frost") {
        // Crystals rise along the rim of the blast and linger briefly.
        const grow = Math.min(1, t * 4), alpha = t < .55 ? 1 : fade / .45
        floor.fillStyle(b.pal.mid, alpha * .14).fillCircle(b.x, b.y, b.radius)
        for (let i = 0; i < 12; i++) {
          const a = i / 12 * TAU + b.seed, r = b.radius * (.78 + (i % 3) * .1)
          const x = b.x + Math.cos(a) * r, y = b.y + Math.sin(a) * r, h = (16 + (i % 4) * 6) * grow, w = 5 + (i % 2) * 2
          g.fillStyle(b.pal.deep, alpha * .85).fillTriangle(x - w, y + 3, x + w, y + 3, x + Math.cos(a) * 3, y - h)
          g.fillStyle(b.pal.hot, alpha * .9).fillTriangle(x - w, y + 3, x - 1, y + 3, x + Math.cos(a) * 3, y - h)
        }
      } else if (b.form === "quake") {
        const alpha = t < .5 ? 1 : fade / .5
        for (let i = 0; i < 6; i++) {
          let a = i / 6 * TAU + b.seed, x = b.x, y = b.y
          floor.lineStyle(4 - (i % 2), 0x3a2c1e, alpha * .6).beginPath().moveTo(x, y)
          const steps = 4, reach = b.radius * .8 * Math.min(1, t * 5)
          for (let j = 1; j <= steps; j++) {
            a += ((i * 7 + j * 3) % 5 - 2) * .16
            x += Math.cos(a) * reach / steps; y += Math.sin(a) * reach / steps * .85
            floor.lineTo(x, y)
          }
          floor.strokePath()
        }
      } else if (b.form === "meteor") {
        const alpha = t < .4 ? 1 : fade / .6
        floor.fillStyle(0x2b1d1a, alpha * .42).fillEllipse(b.x, b.y, b.radius * 1.7, b.radius * 1.35)
        floor.fillStyle(0xff8a3c, alpha * .25 * fade).fillEllipse(b.x, b.y, b.radius * 1.1, b.radius * .85)
      } else if (b.form === "rune") {
        const spin = now / 180
        const points = []
        for (let i = 0; i <= 4; i++) points.push({ x: b.x + Math.cos(spin + i / 4 * TAU) * b.radius * .6 * (1 + t), y: b.y + Math.sin(spin + i / 4 * TAU) * b.radius * .6 * (1 + t) })
        glow.lineStyle(2, b.pal.mid, fade * .8).strokePoints(points)
      } else if (b.form === "heal") {
        glow.lineStyle(3, b.pal.mid, fade * .9).lineBetween(b.x - 10, b.y - 34 - t * 16, b.x + 10, b.y - 34 - t * 16)
          .lineBetween(b.x, b.y - 44 - t * 16, b.x, b.y - 24 - t * 16)
      }
    }
    paintSlash(this, now)
  }
  numberFrame(now) {
    let kept = 0
    for (const n of this.numbers) {
      const age = now - n.born, life = n.style === "shatter" ? 760 : 620
      if (age >= life) { n.label.setVisible(false); continue }
      this.numbers[kept++] = n
      const k = age / life, size = (n.style === "shatter" ? .56 : n.style === "hurt" ? .56 : .34) + Math.min(.4, n.amount / 260)
      const pop = this.reduced ? 1 : 1 + .6 * Math.max(0, 1 - age / 120)
      const rise = (this.reduced ? 14 : 34) * (1 - (1 - k) ** 3)
      n.label.setPosition(n.x + n.shift * (this.reduced ? 0 : Math.min(1, k * 3)), n.y - 8 - rise)
        .setScale(size * pop).setAlpha(k < .62 ? 1 : 1 - (k - .62) / .38)
    }
    this.numbers.length = kept
  }
  ghostFrame(now) {
    let kept = 0
    for (const ghost of this.ghosts) {
      const age = now - ghost.born
      if (age >= ghost.life) { this.dropGhost(ghost); continue }
      this.ghosts[kept++] = ghost
      const k = age / ghost.life, image = ghost.image
      if (ghost.hop) {
        image.setPosition(ghost.hop.x + ghost.hop.side * Math.sin(k * Math.PI), ghost.hop.y - Math.sin(k * Math.PI) * 18)
          .setAlpha(1).setBlendMode(Phaser.BlendModes.NORMAL).clearTint()
      } else if (ghost.death) {
        // Drawn death frames: one white beat, then the collapse plays out in its own colours.
        if (age > 50 && !ghost.cooled) { ghost.cooled = true; image.clearTint() }
        image.setFrame(ghost.death[0] + Math.min(ghost.death[1] - 1, Math.floor(k * ghost.death[1]))).setAlpha(1)
      } else if (ghost.pop) {
        // White flash, squash outward, then vanish.
        const grow = this.reduced ? 1 : 1 + k * .38, squash = this.reduced ? 1 : 1 - k * .45
        if (age > 60 && !ghost.cooled) { ghost.cooled = true; image.setTintFill(ghost.tint) }
        image.setScale(ghost.scaleX * grow, ghost.scaleY * squash).setAlpha(.95 * (1 - k) ** 1.5)
      } else image.setAlpha(ghost.alpha * (1 - k))
    }
    this.ghosts.length = kept
  }
  playerFrame(now) {
    const s = this.s, player = s.player, state = this.actors.get(player)
    const stung = state?.hurtAt !== undefined && now - state.hurtAt < 110 && now >= state.hurtAt
    if (stung && !this.reduced) player.setTintFill(0xff9a8c)
    else if (player.isTinted) player.clearTint()
    if (!this.reduced && now < s.hurtUntil) player.setAlpha(Math.floor((s.hurtUntil - now) / 80) % 2 ? .5 : .95)
    const low = s.outcome === "playing" && s.hp / s.maxHp() <= .3
    const pulse = low ? this.reduced ? .16 : .16 + .08 * Math.sin(now / 260) : 0
    const k = now < this.flashUntil ? 1 - (now - this.flashAt) / (this.flashUntil - this.flashAt) : 0
    const hit = this.flashPower * k * k, alpha = Math.max(pulse, hit)
    if (alpha < .01) { this.vignette.setVisible(false); return }
    const camera = s.cameras.main
    this.vignette.setVisible(true).setAlpha(alpha).setTint(hit >= pulse ? this.flashColor : 0xd8372b)
      .setDisplaySize(camera.width, camera.height)
  }
}

export function paintCombat(combat) {
  const art = combat.s.art, now = combat.s.elapsed
  combat.graphics.clear()
  combat.flashes = combat.flashes.filter(f => f.until > now)
  combat.expanded?.paint()
  // Rule tests drive combat with a bare scene; without the art layers there is nothing to draw on.
  if (!art?.zoneFloor) return
  art.zoneFloor.clear(); art.zoneGlow.clear()
  paintZones(combat, art, now)
  if (combat.lastSlash?.until > now) {
    if (art.slash?.source !== combat.lastSlash) art.slash = { source: combat.lastSlash, born: now, flip: art.serial++ % 2 === 0 }
  } else art.slash = null
  paintLines(combat, art, now)
  combat.frost?.paint(combat.graphics)
}
