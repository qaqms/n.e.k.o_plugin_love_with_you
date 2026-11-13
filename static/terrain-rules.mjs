// Rule 5 fixes this layout for the lifetime of a saved journey.
export const WORLD = { width: 1800, height: 1200, margin: 24 }
export const CELL = 24
export const DEPTH = { ground: -10, floor: 50, effects: 3000, bolts: 3500, warnings: 4000 }
export const groundDepth = y => 100 + y

export function forestLayout() {
  const props = []
  const add = (id, kind, x, y, width, height, scale = 1, variant = 0) => {
    props.push({ id, kind, x, y, scale, variant,
      footprint: { x: x - width / 2, y: y - height, width, height } })
  }
  for (let i = 0; i < 36; i++) {
    const edge = i % 4, step = Math.floor(i / 4), scale = .85 + (i * 7 % 6) * .06
    const x = edge === 0 ? 70 + step % 3 * 37 : edge === 1 ? 1710 - step % 3 * 34 : 75 + step * 201
    const y = edge === 2 ? 76 + step % 3 * 22 : edge === 3 ? 1150 - step % 3 * 19 : 105 + step * 125
    add(`edge-${i}`, "tree", x, y, 27 * scale, 18 * scale, scale, i % 4)
  }
  for (const [i, [x, y]] of [[430, 470], [470, 515], [1345, 500], [1370, 560],
    [550, 940], [605, 970], [1280, 920], [1080, 360]].entries()) {
    add(`tree-${i}`, "tree", x, y, 24, 16, .8, i % 4)
  }
  for (const [i, [x, y]] of [[1160, 390], [1285, 420]].entries()) {
    add(`column-${i}`, "column", x, y, 42, 22, 1, i)
  }
  for (const [i, [x, y]] of [[1180, 429], [1234, 441], [1288, 453],
    [610, 814], [664, 808], [718, 802]].entries()) {
    add(`wall-${i}`, "wall", x, y, 74, 19, 1, i % 3)
  }
  for (const [i, [x, y, scale]] of [[680, 425, 1], [1015, 840, 1.15], [1440, 700, 1.2],
    [725, 295, .9], [390, 700, 1], [1065, 1050, .85]].entries()) {
    add(`rock-${i}`, "rock", x, y, 50 * scale, 28 * scale, scale, i % 3)
  }
  // Four broad entrances keep the paved clearing open even to the final boss.
  for (const i of [3, 4, 5, 10, 11, 12, 18, 19, 20, 25, 26, 27]) {
    const angle = i / 30 * Math.PI * 2
    add(`rim-${i}`, "rubble", 900 + Math.cos(angle) * 188, 600 + Math.sin(angle) * 135, 30, 13, 1, i % 3)
  }
  return props
}

const clamp = (v, low, high) => Math.max(low, Math.min(high, v))
const inside = (p, r) => p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height
const expanded = (r, shape) => ({ x: r.x - shape.rx, y: r.y - shape.ry,
  width: r.width + shape.rx * 2, height: r.height + shape.ry * 2 })

// Slab intersection of a swept body centre against an expanded footprint.
function entryTime(a, b, r) {
  let entry = 0, exit = 1
  for (const [key, size] of [["x", "width"], ["y", "height"]]) {
    const d = b[key] - a[key], lo = r[key], hi = lo + r[size]
    if (Math.abs(d) < 1e-9) {
      if (a[key] <= lo || a[key] >= hi) return 1
    } else {
      const t1 = (lo - a[key]) / d, t2 = (hi - a[key]) / d
      entry = Math.max(entry, Math.min(t1, t2)); exit = Math.min(exit, Math.max(t1, t2))
    }
  }
  return exit > entry && exit > 0 && entry < 1 ? Math.max(0, entry) : 1
}

export class TerrainGeometry {
  constructor(props = forestLayout()) { this.props = props; this.rects = props.map(p => p.footprint) }
  bounded(p, shape) {
    return { x: clamp(p.x, WORLD.margin + shape.rx, WORLD.width - WORLD.margin - shape.rx),
      y: clamp(p.y, WORLD.margin + shape.ry, WORLD.height - WORLD.margin - shape.ry) }
  }
  free(p, shape) {
    const b = this.bounded(p, shape)
    return b.x === p.x && b.y === p.y && !this.rects.some(r => inside(p, expanded(r, shape)))
  }
  sweep(a, b, shape) {
    const end = this.bounded(b, shape)
    let t = 1
    for (const r of this.rects) t = Math.min(t, entryTime(a, end, expanded(r, shape)))
    // A small separation prevents floating-point contact from becoming overlap.
    if (t < 1) t = Math.max(0, t - .5 / Math.max(1, Math.hypot(end.x - a.x, end.y - a.y)))
    return { x: a.x + (end.x - a.x) * t, y: a.y + (end.y - a.y) * t }
  }
  clear(a, b, shape) {
    const end = this.sweep(a, b, shape)
    return Math.hypot(end.x - b.x, end.y - b.y) < .01
  }
  safe(p, shape) {
    const start = this.bounded(p, shape)
    if (this.free(start, shape)) return start
    const candidates = []
    for (const r of this.rects) {
      const box = expanded(r, shape)
      if (!inside(start, box)) continue
      candidates.push({ x: box.x - 1, y: start.y }, { x: box.x + box.width + 1, y: start.y },
        { x: start.x, y: box.y - 1 }, { x: start.x, y: box.y + box.height + 1 })
    }
    candidates.sort((a, b) => Math.hypot(a.x - start.x, a.y - start.y) - Math.hypot(b.x - start.x, b.y - start.y))
    for (const candidate of candidates) if (this.free(candidate, shape)) return candidate
    // Deterministic bounded fallback also handles overlapping trunks / masonry.
    let best = null, bestDistance = Infinity
    for (let x = 36; x < WORLD.width - 24; x += CELL) for (let y = 36; y < WORLD.height - 24; y += CELL) {
      const candidate = { x, y }, d = Math.hypot(x - start.x, y - start.y)
      if (d < bestDistance && this.free(candidate, shape)) { best = candidate; bestDistance = d }
    }
    if (!best) throw new Error("地图没有可用落点")
    return best
  }
}
