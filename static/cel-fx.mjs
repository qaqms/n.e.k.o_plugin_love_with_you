// Cel-shaded skill effects: solid colour bands with a dark ink outline, drawn with normal blending so they read on
// bright ground. Shapes change every frame (a fast reveal, a short hold, then the tail erodes) instead of one image
// fading out. Presentation only: nothing here touches saved state or combat rules.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const easeOut = k => 1 - (1 - k) ** 3
const easeIn = k => k * k

// Ink and colour bands for each skill drawn in this style.
export const CEL = {
  slash: { ink: 0x4b2c14, deep: 0xd9902f, mid: 0xf6c94f, core: 0xfff4c8, hot: 0xffffff, dust: 0xe9dcbc },
}
export const CEL_SKILLS = new Set(Object.keys(CEL))
const REVEAL = 55, HOLD = 95, GONE = 230

// One swing of a crescent: the arc sweeps open, holds, then is eaten from its tail toward the tip.
export function paintCelSlash(art, now) {
  const slash = art.slash, G = art.graphics
  if (!slash) return paintMarks(art, now)
  const src = slash.source, ink = CEL[src.kind] || CEL.slash, t = now - slash.born
  if (t > GONE) { art.slash = null; return paintMarks(art, now) }
  const first = src.angle - src.half * 1.15, last = src.angle + src.half * 1.15
  const from = slash.flip ? last : first, to = slash.flip ? first : last
  const head = easeOut(clamp(t / REVEAL, 0, 1)), tail = easeIn(clamp((t - HOLD) / (GONE - HOLD), 0, 1))
  const thin = 1 - .55 * tail
  const point = (a, r) => ({ x: src.x + Math.cos(a) * r, y: src.y + Math.sin(a) * r })
  // The band is widest just behind the leading edge, like a brush stroke that is still moving.
  const band = (u0, u1, outer, depth) => {
    if (u1 - u0 < .01) return null
    const top = [], bottom = []
    for (let i = 0; i <= 22; i++) {
      const u = u0 + (u1 - u0) * i / 22, a = from + (to - from) * u
      const along = (u - u0) / (u1 - u0), d = depth * Math.sin(Math.PI * Math.min(1, along * 1.25)) ** .7 * (.35 + .65 * along)
      top.push(point(a, outer)); bottom.push(point(a, outer * (1 - d)))
    }
    return [...top, ...bottom.reverse()]
  }
  // The blade is drawn through the middle of the reach so it visibly passes over the enemies it cuts.
  const r = Math.min(src.range * .72, 170), fill = (color, pts) => { if (pts) G.fillStyle(color, 1).fillPoints(pts, true) }
  fill(ink.ink, band(tail, head, r * 1.04, .58 * thin + .05))
  fill(ink.deep, band(tail, head, r, .54 * thin))
  fill(ink.mid, band(tail, head, r * .985, .38 * thin))
  fill(ink.core, band(Math.max(tail, head * .35), head, r * .975, .2 * thin))
  fill(ink.hot, band(Math.max(tail, head * .7), head, r * .97, .07 * thin))
  // Speed lines outside the blade, broken into short dashes that lag behind the tip.
  for (const [scale, lag, length] of [[1.12, .1, .35], [1.22, .2, .25]]) {
    const u1 = Math.max(0, head - lag), u0 = Math.max(tail, u1 - length)
    if (u1 - u0 < .03) continue
    const pts = []
    for (let i = 0; i <= 10; i++) pts.push(point(from + (to - from) * (u0 + (u1 - u0) * i / 10), r * scale))
    G.lineStyle(5, ink.ink, 1).strokePoints(pts).lineStyle(2.5, ink.core, 1).strokePoints(pts)
  }
  if (!slash.dusted && t >= REVEAL * .8) {
    slash.dusted = true
    // Where the blade's tip skims the ground it kicks up dust and leaves a short scuff.
    const tip = point(to, r * .88)
    art.spray("fx-puff", tip.x, tip.y + 6, 3, { angle: to + (to > from ? 1.4 : -1.4), spread: 1.2, speed: 60, life: 420,
      tint: ink.dust, from: .45, to: 1.15, alpha: .85, solid: true, drag: 3 })
    art.marks = (art.marks || []).slice(-5)
    art.marks.push({ x: src.x, y: src.y, from, to, r: r * .86, born: now, ink: ink.ink })
  }
  paintMarks(art, now)
}

// Scuffs on the ground under the swing fade over half a second.
function paintMarks(art, now) {
  if (!art.marks?.length) return
  art.marks = art.marks.filter(m => now - m.born < 600)
  for (const m of art.marks) {
    const fade = 1 - (now - m.born) / 600, pts = []
    for (let i = 0; i <= 12; i++) {
      const a = m.from + (m.to - m.from) * (.25 + .6 * i / 12)
      pts.push({ x: m.x + Math.cos(a) * m.r, y: m.y + Math.sin(a) * m.r * .92 + 8 })
    }
    art.floor.lineStyle(3, m.ink, .28 * fade).strokePoints(pts)
  }
}

// A struck enemy gets an inked star that pops, then shrinks away along the cut, plus a few flying chips.
export function celImpact(art, enemy, angle, kind = "slash") {
  const ink = CEL[kind] || CEL.slash
  art.hits = (art.hits || []).slice(-15)
  const size = Math.min(1.1, Math.max(.6, enemy.displayWidth / 100))
  art.hits.push({ x: enemy.x, y: enemy.y - enemy.displayHeight * .15, angle: angle + Math.PI / 2 + ((art.serial++ % 3) - 1) * .35,
    born: art.s.elapsed, size, ink })
  art.spray("fx-chunk", enemy.x, enemy.y - 6, 3, { angle, spread: 1.4, speed: 210, lift: -80, gravity: 700, life: 300,
    tint: ink.mid, from: .38, to: .12, spin: 10, solid: true, hold: .6 })
}

export function paintHits(art, now) {
  if (!art.hits?.length) return
  const G = art.graphics
  art.hits = art.hits.filter(h => now - h.born < 170)
  for (const h of art.hits) {
    const age = now - h.born, pop = age < 40 ? easeOut(age / 40) * 1.2 : 1.2 * (1 - (age - 40) / 130) ** 1.6
    if (pop <= .02) continue
    const s = h.size * pop, c = Math.cos(h.angle), n = Math.sin(h.angle)
    const star = (long, short) => [
      { x: h.x + c * long, y: h.y + n * long }, { x: h.x - n * short, y: h.y + c * short },
      { x: h.x - c * long, y: h.y - n * long }, { x: h.x + n * short, y: h.y - c * short }]
    const cross = (long, short) => star(long, short).map(p => ({ x: h.x + (p.y - h.y), y: h.y - (p.x - h.x) }))
    G.fillStyle(h.ink.ink, 1).fillPoints(star(44 * s, 12 * s), true).fillPoints(cross(22 * s, 9 * s), true)
    G.fillStyle(h.ink.mid, 1).fillPoints(star(38 * s, 8 * s), true).fillPoints(cross(17 * s, 6 * s), true)
    G.fillStyle(h.ink.hot, 1).fillPoints(star(28 * s, 4 * s), true).fillPoints(cross(11 * s, 3.5 * s), true)
  }
}
