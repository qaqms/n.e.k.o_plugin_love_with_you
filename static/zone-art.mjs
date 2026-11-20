import { paintCelSlash } from "./cel-fx.mjs"
import { palette } from "./fx-art.mjs"

// Painters for standing zones, beams and sword arcs. They read combat state and never change it.
const TAU = Math.PI * 2
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const noise = n => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x) }

// A rounded flame: a bulb at the base that leans and narrows into a tip.
function flameShape(x, y, h, w, lean) {
  return [{ x: x - w, y }, { x: x - w * .92, y: y - h * .28 }, { x: x - w * .42 + lean * .45, y: y - h * .64 },
    { x: x + lean, y: y - h }, { x: x + w * .5 + lean * .4, y: y - h * .56 }, { x: x + w * .95, y: y - h * .24 },
    { x: x + w, y }, { x: x + w * .62, y: y + w * .5 }, { x, y: y + w * .68 }, { x: x - w * .62, y: y + w * .5 }]
}
function flameTongue(G, A, x, y, height, width, pal, lean = 0) {
  G.fillStyle(pal.deep, .6).fillPoints(flameShape(x, y, height, width, lean), true)
  A.fillStyle(pal.mid, .6).fillPoints(flameShape(x, y, height * .72, width * .68, lean * .7), true)
  A.fillStyle(pal.hot, .65).fillPoints(flameShape(x, y, height * .42, width * .38, lean * .4), true)
}
function spike(G, x, y, height, width, light, dark, alpha) {
  G.fillStyle(dark, alpha).fillTriangle(x - width, y + 4, x + width, y + 4, x + 1, y - height)
  G.fillStyle(light, alpha).fillTriangle(x - width, y + 4, x - 1, y + 4, x + 1, y - height)
}

export function paintZones(combat, art, now) {
  const F = art.zoneFloor, G = combat.graphics, A = art.zoneGlow, reduced = art.reduced
  for (const z of combat.zones) {
    const pal = palette(z.kind), p = combat.expanded?.isZone(z.kind) ? combat.expanded.p(z.owner, z.kind) : null
    const x = z.x, y = z.y, r = z.radius
    if (reduced) { paintReduced(F, G, z, p, pal, now); continue }
    if (z.kind === "flame") {
      const breathe = Math.sin(now / 170)
      F.fillStyle(0x3a1c12, .2).fillCircle(x, y, r)
      F.lineStyle(2.5, pal.mid, .85).strokeCircle(x, y, r)
      A.fillStyle(pal.deep, .16 + .03 * breathe).fillCircle(x, y, r)
      A.fillStyle(pal.mid, .1 + .04 * breathe).fillCircle(x, y, r * .62)
      A.lineStyle(5, pal.deep, .25).strokeCircle(x, y, r)
      const rim = clamp(Math.round(r / 7), 7, 18)
      for (let i = 0; i < rim; i++) {
        const a = i / rim * TAU + now / 2600, flick = Math.sin(now / 95 + i * 1.9)
        flameTongue(G, A, x + Math.cos(a) * r * .95, y + Math.sin(a) * r * .95, 15 + 6 * flick, 5.5, pal, Math.sin(now / 140 + i * 2.3) * 3)
      }
      const inner = clamp(Math.round(r / 12), 3, 9)
      for (let i = 0; i < inner; i++) {
        const a = i * 2.4 - now / 3400, d = r * (.2 + noise(z.id * 3 + i) * .5), flick = Math.sin(now / 120 + i * 2.7)
        flameTongue(G, A, x + Math.cos(a) * d, y + Math.sin(a) * d, 21 + 9 * flick, 8, pal, Math.sin(now / 160 + i * 1.7) * 4)
      }
    } else if (z.kind === "frost") {
      F.fillStyle(pal.mid, .13).fillCircle(x, y, r)
      F.lineStyle(2, pal.hot, .7).strokeCircle(x, y, r)
      const turn = now / 5200
      for (let i = 0; i < 6; i++) {
        const a = turn + i / 6 * TAU, ex = x + Math.cos(a) * r * .6, ey = y + Math.sin(a) * r * .6
        F.lineStyle(1.5, pal.hot, .4).lineBetween(x, y, ex, ey)
        for (const side of [-1, 1]) {
          const mx = x + Math.cos(a) * r * .38, my = y + Math.sin(a) * r * .38
          F.lineBetween(mx, my, mx + Math.cos(a + side * .9) * r * .16, my + Math.sin(a + side * .9) * r * .16)
        }
      }
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * TAU - turn
        spike(G, x + Math.cos(a) * r * .92, y + Math.sin(a) * r * .92, 9 + (i % 3) * 4, 3.5, pal.hot, pal.deep, .75)
      }
      for (let i = 0; i < 7; i++) {
        const twinkle = Math.max(0, Math.sin(now / 210 + i * 2.3)), a = i * 2.4, d = r * (.2 + noise(z.id + i) * .6)
        const sx = x + Math.cos(a) * d, sy = y + Math.sin(a) * d, s = 2 + twinkle * 3
        A.fillStyle(pal.hot, twinkle * .8).fillTriangle(sx - s, sy, sx, sy - s * 1.6, sx + s, sy).fillTriangle(sx - s, sy, sx, sy + s * 1.6, sx + s, sy)
      }
    } else if (z.kind === "pull") {
      F.lineStyle(1.5, pal.mid, .4).strokeCircle(x, y, r)
      for (let arm = 0; arm < 3; arm++) {
        const base = arm / 3 * TAU - now / 260
        for (let i = 0; i < 9; i++) {
          const u0 = i / 9, u1 = (i + 1) / 9
          const p0 = { a: base + u0 * 2.6, d: r * (1 - u0 * .88) }, p1 = { a: base + u1 * 2.6, d: r * (1 - u1 * .88) }
          const ax = x + Math.cos(p0.a) * p0.d, ay = y + Math.sin(p0.a) * p0.d, bx = x + Math.cos(p1.a) * p1.d, by = y + Math.sin(p1.a) * p1.d
          G.lineStyle(4 - u0 * 2.5, pal.deep, .35 + u0 * .3).lineBetween(ax, ay, bx, by)
          A.lineStyle(2 - u0, pal.hot, .3 + u0 * .5).lineBetween(ax, ay, bx, by)
        }
      }
      A.fillStyle(pal.mid, .25).fillCircle(x, y, 9 + 2 * Math.sin(now / 90))
    } else if (z.kind === "orbit") {
      F.lineStyle(1, pal.mid, .16).strokeCircle(x, y, r)
      const wide = p.band === 16 ? 5 : 9
      for (let i = 0; i < p.blades; i++) {
        const a = now / 1000 * p.rotation + i * TAU / p.blades, back = p.rotation >= 0 ? -1 : 1
        for (let j = 0; j < 6; j++) {
          A.lineStyle(wide * (.35 + j * .13), pal.mid, .07 + j * .09).beginPath()
            .arc(x, y, r, a + back * (1.1 - j * .18), a + back * (1.1 - (j + 1) * .18), back > 0).strokePath()
        }
        const point = (da, dr) => ({ x: x + Math.cos(a + da) * (r + dr), y: y + Math.sin(a + da) * (r + dr) })
        const blade = [point(-back * .26, 0), point(0, wide), point(back * .3, 0), point(0, -wide * .55)]
        G.fillStyle(pal.deep, .95).fillPoints(blade, true)
        G.fillStyle(pal.hot, .95).fillPoints([blade[0], point(0, wide * .6), blade[2], point(0, -wide * .1)], true)
        G.lineStyle(1, 0xffffff, .9).strokePoints([blade[0], blade[1], blade[2]])
        const c = point(0, 0)
        A.fillStyle(pal.mid, .32).fillCircle(c.x, c.y, wide + 3)
      }
    } else if (z.kind === "rune") {
      const armed = now >= z.tick_at, alpha = armed ? .95 : .38, spin = now / 900
      F.lineStyle(2, pal.mid, alpha).strokeCircle(x, y, 18)
      F.lineStyle(1, pal.hot, alpha * .8).strokeCircle(x, y, 13)
      for (const [sides, radius, dir] of [[4, 18, 1], [3, 12, -1]]) {
        const points = []
        for (let i = 0; i <= sides; i++) points.push({ x: x + Math.cos(spin * dir + i / sides * TAU) * radius, y: y + Math.sin(spin * dir + i / sides * TAU) * radius })
        F.lineStyle(1.5, pal.mid, alpha).strokePoints(points)
      }
      F.lineStyle(1, pal.mid, .18).strokeCircle(x, y, p.trigger)
      if (armed) {
        const pulse = .5 + .5 * Math.sin(now / 150)
        A.fillStyle(pal.mid, .18 + pulse * .12).fillCircle(x, y, 20)
        A.fillStyle(pal.hot, .5 + pulse * .3).fillCircle(x, y, 4 + pulse * 2)
      }
    } else if (z.kind === "beacon") {
      const pulse = .5 + .5 * Math.sin(now / 240 + z.id)
      F.lineStyle(1, pal.mid, .14).strokeCircle(x, y, r)
      F.fillStyle(0x1d2a36, .5).fillEllipse(x, y + 8, 30, 12)
      G.lineStyle(3, 0x4a5568, 1).lineBetween(x, y + 6, x, y - 12)
      G.fillStyle(0x3b4658, 1).fillTriangle(x - 9, y - 26, x + 9, y - 26, x, y - 34)
      G.fillStyle(pal.hot, .95).fillRect(x - 6, y - 26, 12, 14)
      G.lineStyle(1.5, 0x3b4658, 1).strokeRect(x - 6, y - 26, 12, 14).lineBetween(x, y - 26, x, y - 12)
      A.fillStyle(pal.deep, .1 + pulse * .08).fillCircle(x, y - 19, 19 + pulse * 5)
      A.fillStyle(pal.mid, .28 + pulse * .15).fillCircle(x, y - 19, 8 + pulse * 2)
      A.fillStyle(pal.deep, .07).fillEllipse(x, y + 6, 90, 40)
    } else if (z.kind === "meteor") {
      const progress = 1 - clamp(z.tick_at - now, 0, p.delay) / p.delay
      F.fillStyle(pal.deep, .07 + progress * .12).fillCircle(x, y, r)
      F.lineStyle(2, pal.mid, .75).strokeCircle(x, y, r)
      F.lineStyle(3, pal.hot, .5 + progress * .4).strokeCircle(x, y, r * progress)
      F.lineStyle(1.5, pal.mid, .7).lineBetween(x - 12, y, x + 12, y).lineBetween(x, y - 12, x, y + 12)
      if (progress < 1) {
        const fall = 1 - progress * progress, bx = x + fall * 80, by = y - fall * 360
        for (let i = 6; i >= 1; i--) {
          A.fillStyle(i > 3 ? pal.deep : pal.mid, .12 + (6 - i) * .05).fillCircle(bx + i * 7, by - i * 30, (12 + progress * 8) * (1 - i * .12))
        }
        A.fillStyle(pal.mid, .55).fillCircle(bx, by, 17 + progress * 10)
        A.fillStyle(pal.hot, .95).fillCircle(bx, by, 9 + progress * 6)
        A.fillStyle(pal.mid, .16 * progress).fillCircle(x, y, r * (.4 + progress * .5))
      }
    } else if (z.kind === "whirl") {
      const angle = now / 120
      F.fillStyle(pal.mid, .05).fillCircle(x, y, r)
      for (let arm = 0; arm < 3; arm++) {
        const a = angle + arm / 3 * TAU
        for (let j = 0; j < 6; j++) {
          A.lineStyle(2 + j * 1.1, pal.mid, .08 + j * .1).beginPath().arc(x, y, r, a - 1.3 + j * .2, a - 1.3 + (j + 1) * .2).strokePath()
        }
        G.lineStyle(2, 0xffffff, .9).beginPath().arc(x, y, r, a - .35, a).strokePath()
      }
      for (let arm = 0; arm < 2; arm++) {
        const a = -angle * 1.3 + arm * Math.PI
        A.lineStyle(3, pal.hot, .45).beginPath().arc(x, y, r * .6, a, a + 1.1).strokePath()
      }
    } else {
      // Fault lines and delayed aftershocks.
      const wait = z.tick_at > now ? clamp((z.tick_at - now) / 700, 0, 1) : 0
      F.fillStyle(pal.deep, .12).fillCircle(x, y, r)
      F.lineStyle(1.5, pal.mid, .45).strokeCircle(x, y, r)
      if (wait) F.lineStyle(2.5, pal.hot, .75).strokeCircle(x, y, r * (1 - wait * .7))
      for (let i = 0; i < 5; i++) {
        let a = i / 5 * TAU + noise(z.id + i) * .5 + .6, cx = x + Math.cos(a) * r * .25, cy = y + Math.sin(a) * r * .25
        F.lineStyle(3, 0x3a2c1e, .38).beginPath().moveTo(cx, cy)
        for (let j = 1; j <= 3; j++) {
          a += (noise(z.id * 7 + i * 5 + j) - .5) * .7
          cx += Math.cos(a) * r / 4.6; cy += Math.sin(a) * r / 4.6
          F.lineTo(cx, cy)
        }
        F.strokePath()
      }
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * TAU + noise(z.id) * TAU
        spike(G, x + Math.cos(a) * r * .74, y + Math.sin(a) * r * .74, 17 + (i % 3) * 5, 7, pal.hot, pal.deep, .9)
      }
    }
  }
}

// Reduced effects keep every gameplay-relevant marker and drop the motion.
function paintReduced(F, G, z, p, pal, now) {
  const x = z.x, y = z.y, r = z.radius
  F.fillStyle(pal.mid, .08).fillCircle(x, y, r)
  G.lineStyle(1.5, pal.mid, .65).strokeCircle(x, y, r)
  if (z.kind === "orbit") {
    for (let i = 0; i < p.blades; i++) {
      const a = now / 1000 * p.rotation + i * TAU / p.blades
      G.lineStyle(p.band === 16 ? 4 : 7, pal.mid, .9).beginPath().arc(x, y, r, a - .22, a + .22).strokePath()
    }
  } else if (z.kind === "rune") {
    G.lineStyle(2, pal.mid, now >= z.tick_at ? .9 : .3).strokeRect(x - 16, y - 16, 32, 32)
    G.lineStyle(1, pal.mid, .25).strokeCircle(x, y, p.trigger)
  } else if (z.kind === "beacon") {
    G.lineStyle(2, pal.mid, .9).strokeTriangle(x, y - 24, x - 9, y - 10, x + 9, y - 10).lineBetween(x, y - 10, x, y + 5)
  } else if (z.kind === "meteor") {
    const progress = 1 - clamp(z.tick_at - now, 0, p.delay) / p.delay
    G.lineStyle(2, pal.mid, .7).strokeCircle(x, y, r * progress)
    G.lineBetween(x - 12, y, x + 12, y).lineBetween(x, y - 12, x, y + 12)
  } else if (z.kind === "flame" || z.kind === "frost") {
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * TAU
      G.fillStyle(pal.mid, .5).fillTriangle(x + Math.cos(a) * r * .66 - 4, y + Math.sin(a) * r * .66 + 3,
        x + Math.cos(a) * r * .66 + 4, y + Math.sin(a) * r * .66 + 3, x + Math.cos(a) * r * .66, y + Math.sin(a) * r * .66 - 10)
    }
  }
}

export function paintLines(combat, art, now) {
  const lines = combat.expanded?.lines
  if (!lines) return
  const G = combat.graphics, A = art.zoneGlow
  for (const line of lines) {
    const fade = clamp((line.until - now) / 220, 0, 1), fresh = !art.seenLines.has(line)
    if (fresh) art.seenLines.add(line)
    if (art.reduced) {
      G.lineStyle(line.width, line.color, fade * .9)
      for (let i = 1; i < line.points.length; i++) G.lineBetween(line.points[i - 1].x, line.points[i - 1].y, line.points[i].x, line.points[i].y)
      continue
    }
    const pal = palette(line.color)
    if (line.width > 3) {
      // A thrust: a lance of light that is widest just ahead of the hand.
      const a = line.points[0], b = line.points.at(-1), d = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
      const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d, nx = -uy, ny = ux
      const lance = width => [a, { x: a.x + ux * d * .22 + nx * width, y: a.y + uy * d * .22 + ny * width }, b,
        { x: a.x + ux * d * .22 - nx * width, y: a.y + uy * d * .22 - ny * width }]
      A.fillStyle(pal.deep, fade * .4).fillPoints(lance(line.width * 1.5), true)
      A.fillStyle(pal.mid, fade * .7).fillPoints(lance(line.width * .9), true)
      A.fillStyle(0xffffff, fade * .9).fillPoints(lance(line.width * .35), true)
      if (fresh) {
        art.flare(b.x, b.y, 26, pal.mid, { life: 180 })
        art.spray("fx-streak", a.x + ux * d * .5, a.y + uy * d * .5, 6, { angle: Math.atan2(uy, ux), spread: .25, speed: 420,
          life: 190, tint: pal.hot, from: .9, to: .15, aim: true, offset: d * .3 })
      }
      continue
    }
    // Chain lightning: the bolt re-rolls its kinks a few times while it fades.
    const flicker = Math.floor(now / 45), seed = line.until
    for (let i = 1; i < line.points.length; i++) {
      const a = line.points[i - 1], b = line.points[i], d = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
      const nx = -(b.y - a.y) / d, ny = (b.x - a.x) / d, steps = Math.max(2, Math.ceil(d / 24)), path = [a]
      for (let j = 1; j < steps; j++) {
        const offset = (noise(seed + i * 31 + j * 7 + flicker * 13) - .5) * 20
        path.push({ x: a.x + (b.x - a.x) * j / steps + nx * offset, y: a.y + (b.y - a.y) * j / steps + ny * offset })
      }
      path.push(b)
      A.lineStyle(8, pal.deep, fade * .28).strokePoints(path)
      A.lineStyle(4, pal.mid, fade * .65).strokePoints(path)
      G.lineStyle(1.6, 0xffffff, fade * .95).strokePoints(path)
      A.fillStyle(pal.mid, fade * .45).fillCircle(b.x, b.y, 9)
      if (fresh) {
        art.flare(b.x, b.y, 24, pal.mid, { life: 160 })
        art.spray("fx-streak", b.x, b.y, 3, { speed: 210, life: 180, tint: pal.hot, from: .5, to: .08, aim: true })
      }
    }
  }
}

export function paintSlash(art, now) {
  const slash = art.slash
  if (!art.reduced && (slash?.source.kind || !slash)) return paintCelSlash(art, now)
  if (!slash) return
  const src = slash.source, G = art.graphics, A = art.glow
  const life = Math.max(1, src.until - slash.born), fade = clamp(1 - (now - slash.born) / life, 0, 1)
  const first = src.angle - src.half, last = src.angle + src.half
  if (art.reduced) {
    G.lineStyle(3, 0xf7efcb, fade * .8).beginPath().arc(src.x, src.y, src.range, first, last).strokePath()
    return
  }
  const pal = palette(src.color), reveal = clamp((now - slash.born) / 70, .15, 1)
  const from = slash.flip ? last : first, to = slash.flip ? first : last
  // A crescent: full thickness at the middle of the swing, pointed at both ends.
  const crescent = (u0, u1, range, thick) => {
    const outer = [], inner = []
    for (let i = 0; i <= 18; i++) {
      const u = u0 + (u1 - u0) * i / 18, a = from + (to - from) * u, depth = thick * Math.sin(Math.PI * u) ** .8
      outer.push({ x: src.x + Math.cos(a) * range, y: src.y + Math.sin(a) * range })
      inner.push({ x: src.x + Math.cos(a) * range * (1 - depth), y: src.y + Math.sin(a) * range * (1 - depth) })
    }
    return [...outer, ...inner.reverse()]
  }
  G.fillStyle(pal.deep, fade * .2).fillPoints(crescent(0, reveal, src.range * .98, .78), true)
  G.fillStyle(pal.mid, fade * .36).fillPoints(crescent(0, reveal, src.range, .6), true)
  A.fillStyle(pal.hot, fade * .5).fillPoints(crescent(0, reveal, src.range, .3), true)
  A.fillStyle(0xffffff, fade * .9).fillPoints(crescent(Math.max(0, reveal - .55), reveal, src.range, .09), true)
  const edge = []
  for (let i = 0; i <= 18; i++) {
    const a = from + (to - from) * reveal * i / 18
    edge.push({ x: src.x + Math.cos(a) * src.range, y: src.y + Math.sin(a) * src.range })
  }
  G.lineStyle(2, 0xffffff, fade).strokePoints(edge)
  if (!slash.sparked) {
    slash.sparked = true
    const turn = to > from ? 1 : -1
    for (let i = 0; i < 6; i++) {
      const a = from + (to - from) * (i + .5) / 6
      art.spray("fx-streak", src.x + Math.cos(a) * src.range * .92, src.y + Math.sin(a) * src.range * .92, 1,
        { angle: a + turn * 1.1, spread: .4, speed: 230, life: 200, tint: pal.hot, from: .6, to: .1, aim: true })
    }
  }
}
