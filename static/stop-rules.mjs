// Pure rule 14 stop rules: the camp, merchant and encounter doors between fights, and the in-run shards.
// Effects are plain lists such as [["heal", .4]]; the journey applies them to the scene.
export const STOPS = {}
export const STOP_KINDS = ["camp", "shop", "event"]
const EFFECTS = ["heal", "hurt", "vigor", "study", "reroll", "boon", "charm", "shards"]

export function installStops(data) {
  const effects = list => Array.isArray(list) && list.every(([kind]) => EFFECTS.includes(kind))
  if (!Array.isArray(data?.at) || !STOP_KINDS.every(kind => data.kinds?.[kind]) || data.camp?.length !== 3
    || Object.keys(data.items || {}).length < 3 || !Object.values(data.items).every(item => item.price > 0 && effects(item.effects))
    || data.events?.length < 2 || !data.events.every(event => event.options?.length === 2
      && event.options.every(option => option.gamble ? option.gamble.every(side => effects(side.effects)) : effects(option.effects)))) {
    throw new Error("停靠点目录不完整")
  }
  Object.assign(STOPS, structuredClone(data))
}

export const offersStop = index => STOPS.at.includes(index)
export function stopDoor(rng) {
  return { goal: "stop", reward: STOP_KINDS[rng.between(0, STOP_KINDS.length - 1)], hard: false, need: 0 }
}
// What the stop holds is drawn once, when the door is taken, from the saved run RNG.
export function openStop(kind, rng) {
  if (kind === "shop") {
    const pool = Object.keys(STOPS.items), offer = []
    while (offer.length < 3) offer.push(pool.splice(rng.between(0, pool.length - 1), 1)[0])
    return { kind, offer, bought: [] }
  }
  if (kind === "event") return { kind, offer: [STOPS.events[rng.between(0, STOPS.events.length - 1)].id], bought: [] }
  return { kind, offer: [], bought: [] }
}
export const eventOf = stop => STOPS.events.find(event => event.id === stop.offer[0])
export const canBuy = (stop, journey, id) => stop.kind === "shop" && stop.offer.includes(id) && !stop.bought.includes(id) && journey.shards >= STOPS.items[id].price
  && !(id === "charm" && journey.charm)
// Returns { effects, result } for an encounter option; a gamble spends one roll of the run RNG.
export function choose(stop, index, rng) {
  const option = eventOf(stop)?.options[index]
  if (!option) return null
  const side = option.gamble ? option.gamble[rng.between(0, option.gamble.length - 1)] : option
  return { effects: side.effects, result: side.result }
}
// Shards for a cleared node; a "bounty" boon doubles them.
export function shardsFor(type, hard, boon) {
  const base = type === "fight" ? STOPS.shards.fight + (hard ? STOPS.shards.hard : 0) : type === "elite" ? STOPS.shards.elite : 0
  return base * (boon === "bounty" ? 2 : 1)
}
export const emptyStops = () => ({ shards: 0, boon: "", charm: false, vigor: 0, stop: null })
