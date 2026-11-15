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

// Rule 8 plays each journey node in a smaller arena cut from the same world.
const ARENA_BOUNDS = { x: 250, y: 150, width: 1300, height: 900 }
export const ARENAS = {
  glade: { name: "林间空地", bounds: ARENA_BOUNDS },
  lanes: { name: "断墙小径", bounds: ARENA_BOUNDS },
}

export function arenaLayout(id) {
  if (!ARENAS[id]) throw new Error("未知场地")
  const props = [], b = ARENAS[id].bounds
  const add = (name, kind, x, y, width, height, scale = 1, variant = 0, decor = false) => {
    props.push({ id: name, kind, x, y, scale, variant, ...(decor ? { decor } : {}),
      footprint: { x: x - width / 2, y: y - height, width, height } })
  }
  // The treeline stands outside the playable rectangle; it is scenery, not collision.
  let n = 0
  for (let x = b.x - 60; x <= b.x + b.width + 60; x += 82) {
    add(`border-${n}`, "tree", x + (n % 3) * 9, b.y - 6 - (n % 2) * 26, 27, 18, .95 + (n % 3) * .08, n % 4, true); n++
    add(`border-${n}`, "tree", x + (n % 3) * 11, b.y + b.height + 168 + (n % 2) * 24, 27, 18, 1 + (n % 3) * .07, n % 4, true); n++
  }
  for (let y = b.y + 70; y <= b.y + b.height + 120; y += 96) {
    add(`border-${n}`, "tree", b.x - 52 - (n % 2) * 30, y, 27, 18, .95 + (n % 3) * .08, n % 4, true); n++
    add(`border-${n}`, "tree", b.x + b.width + 52 + (n % 2) * 30, y + 30, 27, 18, 1 + (n % 3) * .07, n % 4, true); n++
  }
  if (id === "glade") {
    for (const i of [3, 4, 5, 10, 11, 12, 18, 19, 20, 25, 26, 27]) {
      const angle = i / 30 * Math.PI * 2
      add(`rim-${i}`, "rubble", 900 + Math.cos(angle) * 188, 600 + Math.sin(angle) * 135, 30, 13, 1, i % 3)
    }
    for (const [i, [x, y, scale]] of [[520, 380, 1.1], [1290, 400, 1], [470, 830, 1], [1300, 840, 1.15]].entries()) {
      add(`rock-${i}`, "rock", x, y, 50 * scale, 28 * scale, scale, i % 3)
    }
    for (const [i, [x, y]] of [[660, 262], [1170, 968], [1420, 620], [385, 590]].entries()) {
      add(`tree-${i}`, "tree", x, y, 24, 16, .8, i % 4)
    }
  } else {
    for (const [i, [x, y]] of [[520, 420], [594, 420], [668, 420], [1132, 420], [1206, 420], [1280, 420],
      [520, 830], [594, 830], [668, 830], [1132, 830], [1206, 830], [1280, 830]].entries()) {
      add(`wall-${i}`, "wall", x, y, 74, 19, 1, i % 3)
    }
    for (const [i, [x, y]] of [[770, 478], [1030, 478], [770, 772], [1030, 772]].entries()) {
      add(`column-${i}`, "column", x, y, 42, 22, 1, i % 2)
    }
    for (const [i, [x, y, scale]] of [[900, 300, 1], [900, 950, 1.1], [390, 620, .9], [1410, 640, .9]].entries()) {
      add(`rock-${i}`, "rock", x, y, 50 * scale, 28 * scale, scale, i % 3)
    }
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
  constructor(props = forestLayout(), bounds = null) {
    this.props = props; this.rects = props.filter(p => !p.decor).map(p => p.footprint)
    this.area = bounds ? { left: bounds.x, top: bounds.y, right: bounds.x + bounds.width, bottom: bounds.y + bounds.height }
      : { left: WORLD.margin, top: WORLD.margin, right: WORLD.width - WORLD.margin, bottom: WORLD.height - WORLD.margin }
  }
  bounded(p, shape) {
    return { x: clamp(p.x, this.area.left + shape.rx, this.area.right - shape.rx),
      y: clamp(p.y, this.area.top + shape.ry, this.area.bottom - shape.ry) }
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
    const a = this.area
    for (let x = a.left + 12; x < a.right; x += CELL) for (let y = a.top + 12; y < a.bottom; y += CELL) {
      const candidate = { x, y }, d = Math.hypot(x - start.x, y - start.y)
      if (d < bestDistance && this.free(candidate, shape)) { best = candidate; bestDistance = d }
    }
    if (!best) throw new Error("地图没有可用落点")
    return best
  }
}
