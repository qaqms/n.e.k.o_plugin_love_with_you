import { DEPTH } from "./terrain-rules.mjs"

// Presentation only: the rule 15 sword line, sword intent marks and the drawn-cut finisher.
// Pictures are black-backed and drawn additively; without them the shapes fall back to lines on `g`.
export const SWORD_ART = ["line", "ring", "wave", "sever", "phantom", "blade"]
export const DASH_ART = ["star", "domain"]
export class SwordArt {
  constructor(scene) {
    this.s = scene
    const make = (key, count, depth, ox = .5, oy = .5) => scene.textures.exists(key) ? Array.from({ length: count }, () =>
      scene.add.image(0, 0, key).setBlendMode(Phaser.BlendModes.ADD).setDepth(depth).setOrigin(ox, oy).setVisible(false)) : []
    this.lines = make("fx-sword-line", 6, DEPTH.effects + 1, .02, .5)
    this.rings = make("fx-sword-ring", 4, DEPTH.effects + 1)
    this.waves = make("fx-sword-wave", 3, DEPTH.effects + 1, .62, .5)
    this.cuts = make("fx-sword-sever", 2, DEPTH.effects + 2)
    this.phantoms = make("fx-sword-phantom", 9, DEPTH.effects + 1, .12, .9)
    this.blades = make("fx-sword-blade", 8, DEPTH.effects + 1, .5, .9)
    this.g = scene.add.graphics().setDepth(DEPTH.effects + 1)
    // Rule 18 dash line: star bursts, the sword domain and the returning crescents.
    this.stars = make("fx-dash-star", 3, DEPTH.effects + 2)
    this.domains = make("fx-dash-domain", 1, DEPTH.floor + 2)
    this.arcs = make("fx-sword-wave", 4, DEPTH.effects + 1, .62, .5)
  }
  all() { return [...this.lines, ...this.rings, ...this.waves, ...this.cuts, ...this.phantoms, ...this.blades, ...this.stars, ...this.domains, ...this.arcs] }
  reset() { for (const image of this.all()) image.setVisible(false); this.g.clear() }
  paint() {
    const s = this.s, now = s.elapsed, line = s.combat?.swordLine, g = this.g
    g.clear()
    const show = (images, items, draw) => images.forEach((image, index) => {
      const item = items[index]
      if (!item) image.setVisible(false)
      else draw(image.setVisible(true), item, index)
    })
    show(this.lines, line?.lines || [], (image, item) => {
      const t = (now - item.born) / 220
      image.setPosition(item.x, item.y).setRotation(item.angle).setScale(Math.hypot(item.ex - item.x, item.ey - item.y) / 300, .7 * (1 - t * .5)).setAlpha(1 - t * t)
    })
    show(this.rings, line?.rings || [], (image, item) => {
      const t = (now - item.born) / 320
      image.setPosition(item.x, item.y).setRotation(t * (item.counter ? 2.4 : 1.2)).setScale((.75 + .3 * t) * item.radius / 150).setAlpha((item.counter ? 1 : .85) * (1 - t * t))
    })
    show(this.waves, line?.waves || [], (image, item) => {
      const grow = Math.min(1, (now - item.born) / 120)
      image.setPosition(item.x, item.y).setRotation(item.angle).setScale(.55 * (1 + item.bonus * .5) * (.6 + .4 * grow)).setAlpha(.95)
    })
    const severs = (line?.severs || []).filter(cut => cut.done)
    const drawn = s.ultimate?.drawn && now - s.ultimate.drawn.born < 700 ? [{ ...s.ultimate.drawn, done: s.ultimate.drawn.born, big: true }] : []
    show(this.cuts, [...severs, ...drawn], (image, item) => {
      const t = (now - item.done) / 700, wide = item.big ? 4.2 : 3.2
      image.setPosition(item.x, item.y).setRotation(item.big ? -.12 : 0).setScale(wide * Math.min(1, t * 6), (item.big ? 1.3 : 1) * (1 - t * .6)).setAlpha(Math.max(0, 1 - t * t))
    })
    const strikes = line?.phantoms || []
    show(this.phantoms, strikes.filter(item => !item.fall), (image, item) => {
      const t = (now - item.born) / 420, fall = Math.max(0, 1 - t * 4)
      image.setPosition(item.x - fall * 60, item.y - fall * 90).setRotation(item.angle + 2.3).setScale(.7).setAlpha(t < .5 ? 1 : 1 - (t - .5) / .5)
    })
    show(this.blades, strikes.filter(item => item.fall), (image, item) => {
      const t = (now - item.born) / 420, fall = Math.max(0, 1 - t * 5)
      image.setPosition(item.x, item.y - fall * 120).setScale(.8).setAlpha(t < .6 ? 1 : 1 - (t - .6) / .4)
    })
    const dash = s.combat?.dashLine
    show(this.stars, dash?.stars || [], (image, item) => {
      const t = (now - item.born) / 420
      image.setPosition(item.x, item.y).setRotation(t * .8).setScale((.5 + .6 * (1 - (1 - t) ** 2)) * 340 / 384).setAlpha(1 - t * t)
    })
    show(this.domains, dash?.domain ? [dash.domain] : [], (image, item) => {
      const grow = Math.min(1, (now - item.born) / 200), fade = Math.max(0, Math.min(1, (item.until - now) / 300))
      image.setPosition(item.x, item.y).setScale(grow * 260 * 2.1 / 512 * (1 + .03 * Math.sin(now / 90))).setAlpha(.6 * fade)
    })
    show(this.arcs, dash?.arcs || [], (image, item) => {
      const t = (now - item.born) / 300
      image.setPosition(item.x + Math.cos(item.angle) * 90, item.y + Math.sin(item.angle) * 90).setRotation(item.angle).setScale(.6 + .2 * t).setAlpha(1 - t * t)
    })
    for (const path of dash?.paths || []) {
      const t = (now - path.born) / 380
      for (const [width, color, alpha] of [[14, 0x6fa8ff, .35], [6, 0xcfe6ff, .8], [2, 0xffffff, 1]]) {
        g.lineStyle(width * (1 - t * .5), path.echo ? 0x9fd0ff : color, alpha * (1 - t) * (path.echo ? .8 : 1)).lineBetween(path.ax, path.ay, path.bx, path.by)
      }
    }
    // The gathering of the saint-rank cut: a thin line widening across the view.
    for (const cut of line?.severs || []) if (!cut.done) {
      const actor = s.combat.actor(cut.owner), t = Math.max(0, Math.min(1, (now - cut.born) / (cut.at - cut.born)))
      g.lineStyle(2 + 6 * t, 0xcfe6ff, .3 + .6 * t).lineBetween(actor.x - 760 * t, actor.y, actor.x + 760 * t, actor.y)
    }
    // Intent: one small diamond per stack above the enemy, five to a row.
    if (line?.intent.size) for (const enemy of s.enemies.getChildren()) {
      const stacks = enemy.active ? line.stacks(enemy) : 0
      if (!stacks) continue
      const top = enemy.y - (enemy.displayHeight || 40) * .6 - 8
      for (let i = 0; i < Math.min(stacks, 5); i++) {
        const x = enemy.x + (i - (Math.min(stacks, 5) - 1) / 2) * 9, y = top, r = 4.5
        const points = [{ x, y: y - r }, { x: x + r, y }, { x, y: y + r }, { x: x - r, y }]
        g.fillStyle(stacks > 5 && i < stacks - 5 ? 0xffe2a0 : 0xbfe0ff, 1).fillPoints(points, true)
        g.lineStyle(1.5, 0x1d3a66, .9).strokePoints(points, true)
      }
    }
    if (!this.lines.length) for (const item of line?.lines || []) g.lineStyle(3, 0xdff0ff, .9).lineBetween(item.x, item.y, item.ex, item.ey)
    if (!this.rings.length) for (const item of line?.rings || []) g.lineStyle(4, 0x9cc8ff, .8).strokeCircle(item.x, item.y, item.radius)
    if (!this.waves.length) for (const item of line?.waves || []) g.lineStyle(6, 0x9cc8ff, .8).beginPath().arc(item.x, item.y, 70, item.angle - 1, item.angle + 1).strokePath()
  }
}
