// Yui's day in the cottage, as data and pure functions (no three.js, so Node tests can load it):
// where she is at each minute of the cottage's clock, and the way she walks between places.
// Coordinates are room metres (see cottage-layout.mjs); `y` is the floor she stands on; `turn` is her facing
// (0 faces +z, the open front of the house; positive turns toward +x).

// Places she spends time. `pose` is the body she holds there, `node` the point on the walking graph she reaches it
// from, `enter` how she gets from the node into the place: walking, sitting down (a slide into the seat while the
// pose changes) or getting into bed (out of sight for a moment, like the stairs).
export const SPOTS = {
  rug: { room: "living", x: .25, y: .04, z: 1.5, turn: .55, pose: "stand", node: "rug", enter: "walk" },
  sofa: { room: "living", x: -1.15, y: .04, z: -1.12, turn: 0, pose: "sit", node: "sofa", enter: "sit" },
  counter: { room: "kitchen", x: 4.6, y: 0, z: -1.6, turn: Math.PI, pose: "tablet", node: "counter", enter: "walk" },
  table: { room: "kitchen", x: 4.02, y: 0, z: .7, turn: Math.PI / 2, pose: "sit", node: "table", enter: "sit" },
  bench: { room: "porch", x: 8.5, y: .2, z: -.72, turn: 0, pose: "sit", node: "bench", enter: "sit" },
  desk: { room: "study", x: 3, y: 3.52, z: -1.5, turn: Math.PI, pose: "type", node: "desk", enter: "sit" },
  bedside: { room: "bedroom", x: -.3, y: 3.52, z: .25, turn: .35, pose: "stand", node: "bedside", enter: "walk" },
  bed: { room: "bedroom", x: -1.6, y: 3.99, z: -1.3, turn: 0, pose: "sleep", node: "bedside", enter: "bed" },
}

// Getting into and out of bed (cottage-yui-life.mjs): lying on her back where she sits up, the edge she sits on,
// facing the room, and the floor beside the bed where she stands up from it. `surface`: the mattress top.
export const BED = {
  back: { x: -1.5, y: 3.99, z: -1.38 },
  edge: { x: -.95, y: 3.99, z: -1.15 },
  floor: { x: -.38, y: 3.52, z: -1.15 },
  surface: 3.97,
}

// The walking graph: points she can walk between in a straight line without going through furniture or walls.
export const NODES = {
  rug: { x: .25, y: .04, z: 1.5 },
  living: { x: 1, y: .04, z: .1 },
  sofaWay: { x: .75, y: .04, z: -.45 },
  sofa: { x: -1.15, y: .04, z: -.45 },
  livingMid: { x: 1.3, y: .03, z: 1.25 },
  livingFront: { x: 2.55, y: .02, z: 1.28 },
  livingDoor: { x: 2.9, y: 0, z: 1.8 },
  kitchenDoor: { x: 3.65, y: 0, z: 1.8 },
  kitchen: { x: 3.55, y: 0, z: -.4 },
  counter: { x: 4.6, y: 0, z: -1.6 },
  table: { x: 4.02, y: 0, z: 1.5 },
  stairsFoot: { x: 6.52, y: 0, z: 1.55 },
  porchInside: { x: 6.65, y: 0, z: 1.9 },
  porchDoor: { x: 7.4, y: .2, z: 1.9 },
  bench: { x: 8.5, y: .2, z: -.1 },
  stairsTop: { x: 5.75, y: 3.52, z: -1.75 },
  desk: { x: 3.55, y: 3.52, z: -1.05 },
  studyDoor: { x: 1.9, y: 3.52, z: 1.1 },
  bedroomDoor: { x: 1.1, y: 3.52, z: 1.1 },
  bedside: { x: -.3, y: 3.52, z: .25 },
}
// [from, to, how]: "walk", or "stairs" (out of sight at one end, back in sight at the other).
export const EDGES = [
  ["rug", "living", "walk"], ["rug", "livingFront", "walk"], ["living", "livingMid", "walk"], ["livingMid", "livingFront", "walk"], ["livingFront", "livingDoor", "walk"], ["living", "sofaWay", "walk"], ["sofaWay", "sofa", "walk"],
  ["livingDoor", "kitchenDoor", "walk"], ["kitchenDoor", "kitchen", "walk"], ["kitchenDoor", "table", "walk"],
  ["kitchenDoor", "stairsFoot", "walk"], ["kitchen", "counter", "walk"], ["table", "stairsFoot", "walk"],
  ["stairsFoot", "porchInside", "walk"], ["kitchenDoor", "porchInside", "walk"], ["porchInside", "porchDoor", "walk"],
  ["porchDoor", "bench", "walk"], ["stairsFoot", "stairsTop", "stairs"], ["stairsTop", "desk", "walk"],
  ["desk", "studyDoor", "walk"], ["studyDoor", "bedroomDoor", "walk"], ["bedroomDoor", "bedside", "walk"],
]

// What she does when. Times are minutes after midnight; each entry lasts until the next.
// `then` plays once when she arrives (a yawn on getting up, a stretch before bed).
const DAY = ["rug", "sofa", "desk", "bench"]
export const SCHEDULE = [
  [0, { id: "sleep", spot: "bed" }],
  [7 * 60, { id: "wake", spot: "bedside", then: ["yawn", "stretch"] }],
  [7 * 60 + 15, { id: "breakfast-cook", spot: "counter" }],
  [7 * 60 + 45, { id: "breakfast", spot: "table" }],
  [8 * 60 + 15, { id: "day", spot: null }],
  [11 * 60 + 45, { id: "lunch-cook", spot: "counter" }],
  [12 * 60 + 10, { id: "lunch", spot: "table" }],
  [12 * 60 + 40, { id: "day", spot: null }],
  [18 * 60, { id: "dinner-cook", spot: "counter" }],
  [18 * 60 + 30, { id: "dinner", spot: "table" }],
  [19 * 60, { id: "evening", spot: "sofa" }],
  [22 * 60 + 30, { id: "bedtime", spot: "bedside", then: ["yawn"] }],
  [23 * 60, { id: "sleep", spot: "bed" }],
]
// In the daytime she moves on every 40 minutes: rug, sofa, desk, porch bench, and round again.
export const DAY_BLOCK = 40

// The cottage's periods (cottage-living.mjs localPeriod): night before 6:00 and from 20:00, dusk from 17:00.
const PERIODS = { day: [6 * 60, 17 * 60], dusk: [17 * 60, 20 * 60], night: [20 * 60, 30 * 60] }
const MINUTES = 24 * 60

export function periodOf(minutes) {
  const hour = Math.floor(minutes / 60) % 24
  return hour < 6 || hour >= 20 ? "night" : hour >= 17 ? "dusk" : "day"
}

// The cottage's own clock: the computer's time when the period is automatic; with a period chosen in the room, the
// computer's time when it falls inside that period, and otherwise a time inside it that still moves along
// (the real minutes since midnight, wrapped into the period).
export function cottageMinutes(period, date = new Date()) {
  const minutes = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60
  if (!PERIODS[period] || periodOf(minutes) === period) return minutes
  const [start, end] = PERIODS[period]
  return (start + minutes % (end - start)) % MINUTES
}

// The activity at a minute of the day: { id, spot, then?, since (minute it started), until }.
export function activityAt(minutes) {
  const at = ((minutes % MINUTES) + MINUTES) % MINUTES
  let index = SCHEDULE.length - 1
  while (SCHEDULE[index][0] > at) index--
  const [start, entry] = SCHEDULE[index]
  const end = index + 1 < SCHEDULE.length ? SCHEDULE[index + 1][0] : MINUTES
  if (entry.spot) return { ...entry, since: start, until: end }
  const block = Math.floor((at - start) / DAY_BLOCK)
  const since = start + block * DAY_BLOCK
  return { id: `day-${DAY[block % DAY.length]}`, spot: DAY[block % DAY.length], since, until: Math.min(end, since + DAY_BLOCK) }
}

// The shortest way between two nodes: [{ node, how }], where `how` is the way the step into that node is made.
export function route(from, to) {
  if (!NODES[from] || !NODES[to]) throw new Error(`no node ${NODES[from] ? to : from}`)
  const distance = new Map([[from, 0]])
  const back = new Map()
  const open = new Set([from])
  const length = (a, b, how) => how === "stairs" ? 4 : Math.hypot(NODES[a].x - NODES[b].x, NODES[a].z - NODES[b].z)
  while (open.size) {
    const node = [...open].reduce((best, item) => distance.get(item) < distance.get(best) ? item : best)
    open.delete(node)
    if (node === to) break
    for (const [a, b, how] of EDGES) {
      const next = a === node ? b : b === node ? a : null
      if (!next) continue
      const total = distance.get(node) + length(node, next, how)
      if (total < (distance.get(next) ?? Infinity)) {
        distance.set(next, total)
        back.set(next, [node, how])
        open.add(next)
      }
    }
  }
  if (from !== to && !back.has(to)) throw new Error(`no way from ${from} to ${to}`)
  const steps = []
  for (let node = to; node !== from; node = back.get(node)[0]) steps.unshift({ node, how: back.get(node)[1] })
  return steps
}

// The steps from a place (a spot she is in, or a node she stands at) to a spot:
// [{ kind: "rise" | "walk" | "stairs" | "sit" | "bed" | "leave-bed" | "arrive", to: {x, y, z, turn?}, node?, spot? }].
export function plan(place, spot) {
  const target = SPOTS[spot]
  if (!target) throw new Error(`no spot ${spot}`)
  if (place.spot === spot) return []
  const steps = []
  let node = place.node
  if (place.spot) {
    const from = SPOTS[place.spot]
    node = from.node
    if (from.enter === "sit") steps.push({ kind: "rise", to: NODES[node], node })
    else if (from.enter === "bed") steps.push({ kind: "leave-bed", to: NODES[node], node })
  }
  for (const step of route(node, target.node)) {
    steps.push({ kind: step.how === "stairs" ? "stairs" : "walk", to: NODES[step.node], node: step.node })
  }
  const kind = target.enter === "walk" ? "arrive" : target.enter
  steps.push({ kind, to: target, spot })
  return steps
}

export function roomOf(point) {
  if (point.y > 2) return point.x < 1.5 ? "bedroom" : "study"
  return point.x < 3.25 ? "living" : point.x < 7 ? "kitchen" : "porch"
}
