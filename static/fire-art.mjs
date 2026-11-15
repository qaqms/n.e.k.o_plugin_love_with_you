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
  }
  reset() {
    for (const blast of this.blasts) { blast.born = -1e9; blast.image.setVisible(false) }
    for (const image of [...this.runes, ...this.marks, ...this.slashes, ...this.pools, ...this.orbs, ...this.waves]) image.setVisible(false)
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
    this.pools.forEach((image, index) => {
      const pool = line?.pools[index]
      if (!pool) { image.setVisible(false); return }
      const grow = Math.min(1, (now - pool.born) / 260), fade = Math.min(1, (pool.until - now) / 450)
      image.setVisible(true).setPosition(pool.x, pool.y).setScale((.6 + .4 * grow) * pool.radius * 2.15 / 384)
        .setRotation(pool.born % 6 + now / 9000).setAlpha(.92 * Math.max(0, fade))
    })
  }
}
