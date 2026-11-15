// Pure rule 8 journey rules: nine nodes, a goal per node and a choice of doors between them.
export const JOURNEY = {}

export function installJourney(data) {
  if (!Array.isArray(data?.nodes) || data.nodes.length !== 9 || data.nodes[0].type !== "fight"
    || data.nodes.at(-1).type !== "boss" || data.areas?.map(area => area.id).join(",") !== "edge,ruin,deep"
    || ["hold", "clear", "elite", "boss"].some(id => !data.goals?.[id])
    || ["study", "mend", "insight"].some(id => !data.rewards?.[id])) throw new Error("旅程目录不完整")
  Object.assign(JOURNEY, structuredClone(data))
}

export const nodeAt = index => JOURNEY.nodes[index]
export const areaAt = index => JOURNEY.areas.find(area => area.id === JOURNEY.nodes[index].area)
export const lastNode = () => JOURNEY.nodes.length - 1

function need(index, goal) {
  return goal === "hold" ? JOURNEY.goals.hold.need : goal === "clear" ? areaAt(index).clear : 0
}

export function firstNode() {
  return { node: 0, phase: "fight", goal: "hold", reward: "study", hard: false, need: need(0, "hold"),
    started_at: 0, kills_at: 0, doors: [], hard_cleared: 0 }
}

// Doors show the goal and the reward of the next node. Draws consume the saved run RNG.
export function drawDoors(index, build, rng) {
  const type = nodeAt(index).type
  if (type !== "fight") return [{ goal: type, reward: "", hard: false, need: 0 }]
  const pool = ["mend"]
  if (build.level < (build.cap ?? 31) - 1) pool.push("study")
  if (build.rerolls < 2) pool.push("insight")
  const rewards = []
  while (pool.length) rewards.push(pool.splice(rng.between(0, pool.length - 1), 1)[0])
  const goals = rng.between(0, 1) ? ["hold", "clear"] : ["clear", "hold"]
  const doors = goals.map((goal, i) => ({ goal, reward: rewards[i % rewards.length], hard: false, need: need(index, goal) }))
  if (index >= (build.hardFrom ?? JOURNEY.hard.from)) {
    const goal = goals[rng.between(0, 1)]
    doors.push({ goal, reward: rewards[2 % rewards.length], hard: true, need: need(index, goal) })
  }
  return doors
}

export function enter(journey, door, elapsed, kills) {
  Object.assign(journey, { node: journey.node + 1, phase: "fight", goal: door.goal, reward: door.reward,
    hard: door.hard, need: door.need, started_at: elapsed, kills_at: kills, doors: [] })
}

export function progress(journey, elapsed, kills, eliteDefeated = false) {
  const spent = elapsed - journey.started_at
  if (journey.goal === "hold") return { done: spent >= journey.need, ratio: Math.min(1, spent / journey.need), left: Math.max(0, journey.need - spent) }
  if (journey.goal === "clear") {
    const count = Math.min(journey.need, kills - journey.kills_at)
    return { done: count >= journey.need || spent >= JOURNEY.goals.clear.cap, ratio: count / journey.need, count }
  }
  return { done: journey.goal === "elite" && eliteDefeated, ratio: 0 }
}

// Difficulty follows the node, not the wall clock, so a slow clear never makes later nodes harder.
export const pace = (journey, elapsed) => nodeAt(journey.node).pace + Math.min(150000, elapsed - journey.started_at)
export const hpScale = journey => areaAt(journey.node).hp * (journey.hard ? JOURNEY.hard.hp : 1)
export function interval(journey, elapsed) {
  const rate = areaAt(journey.node).rate * JOURNEY.goals[journey.goal].rate * (journey.hard ? JOURNEY.hard.rate : 1)
  return Math.max(170, Math.max(210, 1000 - pace(journey, elapsed) / 1200) / rate)
}

export function clearedNodes(snapshot) {
  const journey = snapshot.journey
  return snapshot.outcome === "cleared" ? JOURNEY.nodes.length : journey.node + Number(journey.phase === "doors")
}

export function settlementFor(snapshot) {
  const done = JOURNEY.nodes.slice(0, clearedNodes(snapshot)), c = JOURNEY.coins
  const journey = done.filter(node => node.type === "fight").length * c.fight
    + snapshot.journey.hard_cleared * c.hard + done.filter(node => node.type === "elite").length * c.elite
  const clear = snapshot.outcome === "cleared" ? c.clear : 0
  return { formula: 2, nodes: done.length, hard: snapshot.journey.hard_cleared, journey, clear, total: journey + clear }
}
