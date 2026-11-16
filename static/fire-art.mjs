import { DEPTH } from "./terrain-rules.mjs"

// Presentation only: painted fire explosions and ground runes for the fire school.
// Pictures are black-backed and drawn additively, so they need no cut-out.
export class FireArt {
  constructor(scene) {
    this.s = scene
    const make = (key, count, depth) => scene.textures.exists(key) ? Array.from({ length: count }, () =>
      ({ image: scene.add.image(0, 0, key).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth).setVisible(false), born: -1e9 })) : []
    this.blasts = make("ult-fire-blast", 22, DEPTH.effects + 1)
    this.runes = make("ult-fire-rune", 6, DEPTH.floor + 1).map(item => item.image)
    this.marks = make("ult-fire-rune", 6, DEPTH.floor + 2).map(item => item.image)
    this.slashes = make("fx-fire-slash", 4, DEPTH.effects + 1).map(item => item.image.setOrigin(.4, .5))
    this.pools = make("fx-lava-pool", 3, DEPTH.floor + 1).map(item => item.image.setBlendMode(Phaser.BlendModes.NORMAL))
    this.orbs = make("fx-hellfire", 2, DEPTH.effects).map(item => item.image.setBlendMode(Phaser.BlendModes.NORMAL))
    this.waves = make("ult-fire-rune", 2, DEPTH.floor + 2).map(item => item.image)
    // Rule 13 manual line. Missing pictures fall back to simple shapes drawn on `ground`.
    this.walls = make("fx-flame-wall", 21, DEPTH.effects).map(item => item.image.setOrigin(.5, .92))
    this.balls = make("fx-flame-orb", 2, DEPTH.effects + 1).map(item => item.image)
    this.fields = make("fx-flame-domain", 1, DEPTH.floor + 1).map(item => item.image.setBlendMode(Phaser.BlendModes.NORMAL))
    this.columns = make("fx-flame-pillar", 16, DEPTH.effects + 1).map(item => item.image.setOrigin(.5, .9))
    this.seals = make("ult-fire-rune", 3, DEPTH.floor + 2).map(item => item.image)
    this.ground = scene.add.graphics().setDepth(DEPTH.floor + 2)
  }
  reset() {
    for (const blast of this.blasts) { blast.born = -1e9; blast.image.setVisible(false) }
    for (const image of [...this.runes, ...this.marks, ...this.slashes, ...this.pools, ...this.orbs, ...this.waves,
      ...this.walls, ...this.balls, ...this.fields, ...this.columns, ...this.seals]) image.setVisible(false)
    this.ground.clear()
  }
  // Returns false when the picture is unavailable so the caller can fall back to the vector burst.
  boom(x, y, radius) {
    if (!this.blasts.length) return false
    const blast = this.blasts.reduce((oldest, item) => item.born < oldest.born ? item : oldest)
    Object.assign(blast, { x, y, radius, born: this.s.elapsed, spin: (x * 7 + y * 13) % 6.28 })
    return true
  }
  paint() {
    const s = this.s, now = s.elapsed
    for (const blast of this.blasts) {
      const t = (now - blast.born) / 400
      if (t < 0 || t >= 1) { blast.image.setVisible(false); continue }
      blast.image.setVisible(true).setPosition(blast.x, blast.y).setRotation(blast.spin + t * .5)
        .setScale((.5 + .8 * (1 - (1 - t) ** 3)) * blast.radius * 2 / 512).setAlpha(t < .3 ? 1 : 1 - (t - .3) / .7)
    }
    // A mastered flame ring burns on a slowly turning rune.
    const zones = (s.combat?.zones || []).filter(zone => zone.kind === "flame" && s.combat.mastery(zone.owner, "flame") >= 1)
    this.runes.forEach((rune, index) => {
      const zone = zones[index]
      if (!zone) { rune.setVisible(false); return }
      const left = zone.expires_at - now
      rune.setVisible(true).setPosition(zone.x, zone.y).setScale(zone.radius * 2.2 / 512).setRotation(now / 4200 + index)
        .setAlpha(.75 * Math.max(0, Math.min(1, left / 400)))
    })
    // Rule 11 fire line: the warning circle of a pending blast, sword arcs and lava pools.
    const line = s.combat?.line
    this.marks.forEach((mark, index) => {
      const blast = line?.pending[index]
      if (!blast) { mark.setVisible(false); return }
      const t = Math.max(0, Math.min(1, (now - blast.born) / (blast.at - blast.born)))
      mark.setVisible(true).setPosition(blast.x, blast.y).setScale((.45 + .55 * t) * blast.radius * 2.1 / 512).setRotation(t * 1.4).setAlpha(.35 + .6 * t)
    })
    this.slashes.forEach((image, index) => {
      const slash = line?.slashes[index]
      if (!slash) { image.setVisible(false); return }
      const t = (now - slash.born) / 260
      image.setVisible(true).setPosition(slash.x, slash.y).setRotation(slash.angle).setScale((.8 + .25 * t) * slash.range * 2.05 / 384).setAlpha(1 - t * t)
    })
    this.orbs.forEach((image, index) => {
      const orb = line?.orbs[index]
      if (!orb) { image.setVisible(false); return }
      const size = orb.radius * (1 + orb.grow) * Math.min(1, .35 + (now - orb.born) / 300)
      image.setVisible(true).setPosition(orb.x, orb.y).setScale(size * 2.15 / 384).setRotation(now / 420 + index * 2).setAlpha(.96)
    })
    // The saint-rank flash: a rune gathers under the caster, then races outward across the field.
    this.waves.forEach((image, index) => {
      const flash = line?.flashes[index]
      if (!flash) { image.setVisible(false); return }
      const actor = flash.done ? flash : s.combat.actor(flash.owner)
      if (!flash.done) {
        const t = Math.max(0, Math.min(1, (now - flash.born) / (flash.at - flash.born)))
        image.setVisible(true).setPosition(actor.x, actor.y).setScale((1.1 - .6 * t) * 300 / 512).setRotation(-t * 3).setAlpha(.3 + .7 * t)
      } else {
        const t = (now - flash.done) / 700
        image.setVisible(true).setPosition(actor.x, actor.y).setScale((.5 + 5.5 * (1 - (1 - t) ** 2)) * 300 / 512).setRotation(t * 1.2).setAlpha(Math.max(0, 1 - t))
      }
    })
    this.paintCasts(now)
    this.pools.forEach((image, index) => {
      const pool = line?.pools[index]
      if (!pool) { image.setVisible(false); return }
      const grow = Math.min(1, (now - pool.born) / 260), fade = Math.min(1, (pool.until - now) / 450)
      image.setVisible(true).setPosition(pool.x, pool.y).setScale((.6 + .4 * grow) * pool.radius * 2.15 / 384)
        .setRotation(pool.born % 6 + now / 9000).setAlpha(.92 * Math.max(0, fade))
    })
  }
  // The manual line: flame walls, rolling orbs, the burning field, rift cracks and pillars.
  paintCasts(now) {
    const s = this.s, line = s.combat?.flameLine, g = this.ground
    g.clear()
    const show = (images, items, draw) => images.forEach((image, index) => {
      const item = items[index]
      if (!item) image.setVisible(false)
      else draw(image.setVisible(true), item, index)
    })
    const walls = line?.walls || [], orbs = line?.orbs || [], field = line?.field, columns = line?.pillars || []
    const seals = (line?.pending || []).filter(blast => !blast.small)
    // Each wall is seven upright flame tufts along its line, so the flames always rise up the screen.
    const pieces = walls.flatMap(wall => [-3, -2, -1, 0, 1, 2, 3].map(k => ({ wall, k })))
    show(this.walls, pieces, (image, { wall, k }, index) => {
      const grow = Math.min(1, (now - wall.born - (k + 3) * 35) / 200), fade = Math.max(0, Math.min(1, (wall.until - now) / 500))
      const step = wall.half * 2 / 7, x = wall.x + Math.cos(wall.angle) * step * k, y = wall.y + Math.sin(wall.angle) * step * k
      image.setPosition(x, y + 14).setDepth(DEPTH.effects + y / 10000).setFlipX(k % 2 !== 0)
        .setScale(step * 1.75 / 256, Math.max(0, grow) * (.85 + .15 * Math.sin(now / 85 + index * 1.7)) * 140 / 320).setAlpha(.95 * fade)
    })
    show(this.balls, orbs, (image, orb, index) => image.setPosition(orb.x, orb.y).setRotation(now / 160 + index).setScale(orb.radius * 2.6 / 384).setAlpha(1))
    show(this.fields, field ? [field] : [], (image, item) => {
      const grow = Math.min(1, (now - item.born) / 300), fade = Math.max(0, Math.min(1, (item.until - now) / 500))
      image.setPosition(s.player.x, s.player.y).setRotation(now / 6000).setScale((.5 + .5 * grow) * item.radius * 2.1 / 512).setAlpha(.6 * fade)
    })
    show(this.columns, columns, (image, pillar) => {
      const t = (now - pillar.born) / 900, rise = Math.min(1, t * 6), height = pillar.big ? 560 : 230
      image.setPosition(pillar.x, pillar.y + pillar.radius * .25).setScale(pillar.radius * 2.2 / 320, rise * height / 480)
        .setAlpha(t < .5 ? 1 : Math.max(0, 1 - (t - .5) / .5))
    })
    show(this.seals, seals, (image, blast) => {
      const t = Math.max(0, Math.min(1, (now - blast.born) / (blast.at - blast.born)))
      image.setPosition(blast.x, blast.y).setScale((1.4 - .6 * t) * 300 / 512).setRotation(-t * 2.4).setAlpha(.4 + .6 * t)
    })
    for (const rift of line?.rifts || []) {
      const lit = rift.segments.filter(segment => segment.done), age = now - rift.born, fade = Math.max(0, 1 - Math.max(0, age - 110 * rift.segments.length) / 900)
      if (lit.length < 1) continue
      const first = rift.segments[0], last = lit.at(-1), dx = Math.cos(rift.angle) * 40, dy = Math.sin(rift.angle) * 40
      for (const [width, color, alpha] of [[16, 0x8a1d0c, .55], [8, 0xff7a24, .8], [3, 0xfff1b0, .95]]) {
        g.lineStyle(width, color, alpha * fade).beginPath().moveTo(first.x - dx, first.y - dy)
        lit.forEach((segment, index) => g.lineTo(segment.x + (index % 2 ? -1 : 1) * Math.sin(rift.angle) * 9, segment.y - (index % 2 ? -1 : 1) * Math.cos(rift.angle) * 9))
        g.strokePath()
      }
    }
    if (!this.walls.length) for (const wall of walls) {
      const dx = Math.cos(wall.angle) * wall.half, dy = Math.sin(wall.angle) * wall.half
      g.lineStyle(30, 0xff6a1f, .55).lineBetween(wall.x - dx, wall.y - dy, wall.x + dx, wall.y + dy)
    }
    if (!this.fields.length && field) g.fillStyle(0xff6a1f, .14).fillCircle(s.player.x, s.player.y, field.radius)
    if (!this.balls.length) for (const orb of orbs) g.fillStyle(0xffb347, .85).fillCircle(orb.x, orb.y, orb.radius)
  }
}
