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
export function spawnPoint(player, rng) {
  for (let i = 0; i < 8; i++) {
    const angle = rng.realInRange(0, Math.PI * 2), d = rng.between(380, 530)
    const point = { x: Math.max(40, Math.min(1760, player.x + Math.cos(angle) * d)),
      y: Math.max(40, Math.min(1160, player.y + Math.sin(angle) * d)) }
    if (Math.hypot(point.x - player.x, point.y - player.y) >= 280) return point
  }
  return { x: player.x < 900 ? 1550 : 250, y: player.y < 600 ? 950 : 250 }
}
