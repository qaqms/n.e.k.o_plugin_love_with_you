export const FOES = {}
export const COOPERATIONS = {}
export const MILESTONES = ["sentinel", "oracle"]
export const isBoss = enemy => ["boss", ...MILESTONES].includes(typeof enemy === "string" ? enemy : enemy.getData("kind"))
export function installEncounters(data) {
  if (data?.foes?.map(f => f.id).join(",") !== "charger,caster,sentinel,oracle,boss"
    || data?.cooperations?.map(c => c.id).join(",") !== "cadence,warmth,escort,embers,rime") throw new Error("遭遇目录不完整")
  for (const foe of data.foes) FOES[foe.id] = Object.freeze(foe)
  for (const item of data.cooperations) COOPERATIONS[item.id] = Object.freeze(item)
}
export function legalCooperations(builds, selected) {
  return Object.values(COOPERATIONS).filter(item => !selected.includes(item.id)
    && Object.entries(item.requires).every(([owner, ids]) => builds[owner].skills.some(s => ids.includes(s.id)))).map(item => item.id)
}
export function drawCooperations(builds, selected, rng) {
  const pool = legalCooperations(builds, selected), result = []
  while (pool.length && result.length < 3) result.push(pool.splice(rng.between(0, pool.length - 1), 1)[0])
  return result
}
export function segmentDistance(point, start, end) {
  const dx = end.x - start.x, dy = end.y - start.y
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(point.x - start.x - dx * t, point.y - start.y - dy * t)
}
// Rule 12 elites: an ordinary enemy carrying one affix. Chances rise with the area and on hard doors.
export const AFFIXES = {
  swift: { name: "迅捷", hp: 1.5, speed: 1.6, damage: 1, color: 0xf4d874 },
  armored: { name: "坚甲", hp: 4, speed: .85, damage: 1.5, color: 0x9fc0e8 },
  split: { name: "分裂", hp: 2, speed: 1, damage: 1, color: 0xb9e08a },
}
export const AFFIX_IDS = Object.keys(AFFIXES)
export const eliteChance = (node, hard) => node === 0 ? 0 : (node < 3 ? .04 : node < 6 ? .07 : .09) + (hard ? .04 : 0)
// Rule 12 attack patterns: offsets from the player and a radius for each warning circle.
export function circlePattern(kind, phase, step) {
  const row = count => Array.from({ length: count }, (_, i) => [(i - (count - 1) / 2) * 105, 0])
  const ring = (count, distance) => Array.from({ length: count }, (_, i) => {
    const angle = i / count * Math.PI * 2
    return [Math.cos(angle) * distance, Math.sin(angle) * distance]
  })
  if (kind === "sentinel") return { radius: 52, at: ring(4, 100) }                     // stand still inside the cross
  if (kind === "oracle") return { radius: 72, at: row(phase === 2 ? 5 : 3) }
  if (kind === "boss" && phase === 3) return step % 4 === 1 ? { radius: 120, at: [[0, 0]] } : { radius: 66, at: ring(6, 150) }
  if (kind === "boss") return { radius: 105, at: row(phase === 2 ? 3 : 1) }
  return { radius: 58, at: [[0, 0]] }
}
const FOREST = { left: 24, top: 24, right: 1776, bottom: 1176 }
export function spawnPoint(player, rng, area = FOREST) {
  for (let i = 0; i < 8; i++) {
    const angle = rng.realInRange(0, Math.PI * 2), d = rng.between(380, 530)
    const point = { x: Math.max(area.left + 16, Math.min(area.right - 16, player.x + Math.cos(angle) * d)),
      y: Math.max(area.top + 16, Math.min(area.bottom - 16, player.y + Math.sin(angle) * d)) }
    if (Math.hypot(point.x - player.x, point.y - player.y) >= 280) return point
  }
  const midX = (area.left + area.right) / 2, midY = (area.top + area.bottom) / 2
  return { x: player.x < midX ? area.right - 226 : area.left + 226, y: player.y < midY ? area.bottom - 226 : area.top + 226 }
}
