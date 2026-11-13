// Pure build rules. The scene supplies its saved RNG; rendering never draws choices.
export const SKILLS = {}
export const LEGACY_SKILLS = {}
export const FROST_SKILLS = {}
export const ROUTES = {}
export const BUILD_MODS = {}
export const SKILL_TAGS = {}
export const TALENTS = {
  power: ["磨砺", "攻击强度 +8%", ["player", "companion"]],
  vitality: ["坚韧", "生命上限 +12，恢复等量生命", ["player"]],
  stride: ["轻步", "移动速度 +4%", ["player"]],
  reach: ["牵引", "拾取范围 +12", ["player"]],
  ward: ["守望", "同行护盾强度 +12%", ["companion"]],
}
export const LIMITS = { player: { auto: 3, manual: 2, support: 0 }, companion: { auto: 2, manual: 0, support: 1 } }
export function installCatalog(items, legacy, expanded = []) {
  const ids = ["fire", "slash", "wind", "guard", "flame", "dash", "pull", "armor"]
  const valid = (entries, keys) => Array.isArray(entries) && entries.length === keys.length
    && new Set(entries.map(s => s.id)).size === keys.length && entries.every(s => keys.includes(s.id))
  if (!valid(items, [...ids, "ice", "frost"]) || !valid(legacy, ids)) throw new Error("技能目录不完整")
  if (expanded.length && !valid(expanded, ["spark", "stone", "thrust", "orbit", "rune", "quake", "whirl", "meteor", "heal", "beacon"])) throw new Error("扩展技能目录不完整")
  for (const item of items) SKILLS[item.id] = Object.freeze(item)
  for (const item of items) FROST_SKILLS[item.id] = Object.freeze(item)
  for (const item of expanded) SKILLS[item.id] = Object.freeze(item)
  for (const item of legacy) LEGACY_SKILLS[item.id] = Object.freeze(item)
}
export function installRoutes(routes) {
  if (!Array.isArray(routes) || routes.length !== 8 || new Set(routes.map(r => r.id)).size !== 8
    || !routes.every(route => ["guardian", "mage"].includes(route.class)
      && ["player", "companion"].every(owner => route[owner]?.length === 2 && route[owner].every(id => SKILLS[id])))) throw new Error("流派目录不完整")
  for (const route of routes) ROUTES[route.id] = Object.freeze(route)
}
export function installBuildMods(data) {
  const ids = ["fork", "piercing", "circuit", "edge", "field", "follow"]
  if (!data?.tags || Object.keys(data.tags).length !== 20 || !Object.keys(data.tags).every(id => SKILLS[id])
    || !Array.isArray(data.mods) || data.mods.length !== ids.length || new Set(data.mods.map(m => m.id)).size !== ids.length
    || !data.mods.every(m => ids.includes(m.id) && m.cap >= 1 && m.cap <= 2
      && m.owners.every(owner => ["player", "companion"].includes(owner)))) throw new Error("构筑改造目录不完整")
  Object.assign(SKILL_TAGS, data.tags)
  for (const spec of data.mods) BUILD_MODS[spec.id] = Object.freeze(spec)
}
export const buildRules = build => Object.hasOwn(build, "mods") ? 7 : Object.hasOwn(build.misses, "spark") ? 6 : Object.hasOwn(build.misses, "ice") ? 3 : 2
export const catalogFor = rules => rules >= 6 ? SKILLS : rules === 2 ? LEGACY_SKILLS : FROST_SKILLS
export const studyOwner = level => (level - 1) % 3 === 0 ? "companion" : "player"
export function newSkill(id) { return { id, level: 1, focus: "", branch: "", evolution: "", ready_at: 0, react_at: 0 } }
export function newBuild(owner, kind, rules = 3, route = kind) {
  const starting = rules >= 7 ? [] : rules === 6 ? ROUTES[route]?.[owner] : null
  return {
    skills: (starting || (owner === "player" ? kind === "mage" ? ["fire", "flame"] : ["slash", "dash"]
      : kind === "mage" ? ["wind", "pull"] : ["guard", "armor"])).map(newSkill),
    talents: Object.fromEntries(Object.keys(TALENTS).map(key => [key, 0])),
    misses: Object.fromEntries(Object.keys(catalogFor(rules)).map(key => [key, 0])),
    ...(rules >= 7 ? { mods: Object.fromEntries(Object.keys(BUILD_MODS).map(key => [key, 0])), banished: [] } : {}),
  }
}
export function legalChoices(build, owner) {
  const result = []
  for (const spec of Object.values(catalogFor(buildRules(build)))) {
    const skill = build.skills.find(s => s.id === spec.id)
    if (!skill) {
      if (!build.banished?.includes(spec.id) && build.skills.filter(s => SKILLS[s.id].slot === spec.slot).length < LIMITS[owner][spec.slot]) result.push(`${spec.id}:learn`)
    } else if (skill.level === 1) result.push(`${spec.id}:power`, `${spec.id}:haste`)
    else if (skill.level === 2) result.push(...spec.branches.map(([branch]) => `${spec.id}:${branch}`))
    else if (skill.level === 3) result.push(`${spec.id}:deepen`)
    else if (skill.level === 4) {
      result.push(`${spec.id}:awaken`)
      if (spec.fusion && build.skills.some(s => s.id === spec.fusion[0] && s.level >= 2)
        && !build.skills.some(s => s.evolution === "fusion")) result.push(`${spec.id}:fuse`)
    }
  }
  for (const [key, [, , owners]] of Object.entries(TALENTS)) {
    if (owners.includes(owner) && build.talents[key] < 4) result.push(`talent:${key}`)
  }
  if (buildRules(build) >= 7) for (const spec of Object.values(BUILD_MODS)) {
    if (spec.owners.includes(owner) && build.mods[spec.id] < spec.cap && build.skills.some(s => SKILL_TAGS[s.id].includes(spec.tag))) result.push(`mod:${spec.id}`)
  }
  return result
}
export function drawChoices(build, owner, rng, advance = true) {
  if (buildRules(build) >= 7) return drawFreeChoices(build, owner, rng, advance)
  const pool = legalChoices(build, owner), chosen = []
  const take = candidates => {
    const available = candidates.filter(key => pool.includes(key) && !chosen.includes(key))
    if (available.length && chosen.length < 3) chosen.push(available[rng.between(0, available.length - 1)])
  }
  const branches = build.skills.filter(s => s.level === 2)
  take(branches.filter(s => build.misses[s.id] >= 2).flatMap(s => pool.filter(key => key.startsWith(`${s.id}:`))))
  take(pool.filter(key => !key.startsWith("talent:") && !key.endsWith(":learn")))
  const learning = pool.filter(key => key.endsWith(":learn"))
  const catalysts = buildRules(build) >= 6 ? build.skills.flatMap(s => SKILLS[s.id].fusion?.[0] || []) : []
  take([...learning, ...learning.filter(key => catalysts.includes(key.split(":")[0])), ...learning.filter(key => catalysts.includes(key.split(":")[0]))])
  while (chosen.length < Math.min(3, pool.length)) take(pool)
  if (advance) for (const skill of branches) {
    build.misses[skill.id] = chosen.some(key => key.startsWith(`${skill.id}:`)) ? 0 : Math.min(2, build.misses[skill.id] + 1)
  }
  return chosen
}
function drawFreeChoices(build, owner, rng, advance) {
  const pool = legalChoices(build, owner), chosen = [], branches = build.skills.filter(s => s.level === 2)
  const take = options => {
    const available = options.filter(key => !chosen.includes(key))
    if (available.length && chosen.length < 4) chosen.push(available[rng.between(0, available.length - 1)])
  }
  const growth = pool.filter(key => !key.startsWith("talent:") && !key.startsWith("mod:") && !key.endsWith(":learn"))
  take(growth.filter(key => branches.some(s => build.misses[s.id] >= 2 && key.startsWith(`${s.id}:`))))
  take(growth)
  const learning = pool.filter(key => key.endsWith(":learn"))
  const missing = owner === "player" ? "manual" : "support"
  const opening = !build.skills.some(s => SKILLS[s.id].slot === missing) ? learning.filter(key => SKILLS[key.split(":")[0]].slot === missing) : []
  take([...learning, ...opening])
  take(pool.filter(key => key.startsWith("mod:")))
  while (chosen.length < Math.min(4, pool.length)) take(pool)
  if (advance) for (const skill of branches) build.misses[skill.id] =
    chosen.some(key => key.startsWith(`${skill.id}:`)) ? 0 : Math.min(2, build.misses[skill.id] + 1)
  return chosen
}
export const starterSkills = () => Object.values(catalogFor(7)).filter(s => s.slot === "auto")
export function replacementChoices(build, id) {
  if (buildRules(build) < 7 || !build.skills.some(s => s.id === id)) return []
  if (build.skills.some(s => s.id !== id && s.evolution === "fusion" && SKILLS[s.id].fusion[0] === id)) return []
  return Object.values(catalogFor(7)).filter(spec => spec.slot === SKILLS[id].slot
    && !build.skills.some(s => s.id === spec.id) && !build.banished.includes(spec.id)).map(s => s.id)
}
export function applyChoice(build, owner, key) {
  if (!legalChoices(build, owner).includes(key)) return false
  const [id, action] = key.split(":")
  if (id === "talent") { build.talents[action]++; return true }
  if (id === "mod") { build.mods[action]++; return true }
  if (action === "learn") { build.skills.push(newSkill(id)); return true }
  const skill = build.skills.find(s => s.id === id)
  if (skill.level === 1) skill.focus = action
  else if (skill.level === 2) skill.branch = action
  else if (skill.level === 4) skill.evolution = action === "fuse" ? "fusion" : "pure"
  skill.level++
  return true
}
export function skillName(skill) {
  const spec = SKILLS[skill.id]
  return skill.evolution === "fusion" ? spec.fusion[1] : `${spec.name}${skill.level === 5 ? " · 觉醒" : ""}`
}
export function skillControl(build, id) {
  const slot = SKILLS[id].slot
  if (slot === "auto") return "自动攻击"
  if (slot === "support") return "同行自动支援"
  const manual = build.skills.filter(s => SKILLS[s.id].slot === "manual")
  const index = manual.findIndex(s => s.id === id)
  return `${(index < 0 ? manual.length : index) === 0 ? "Q" : "E"} 主动`
}
export function nextStep(build, skill) {
  const spec = catalogFor(buildRules(build))[skill.id]
  const branch = spec.branches.find(([key]) => key === skill.branch)
  const selected = branch ? `已选${branch[1]} · ` : ""
  if (skill.level === 5) return `${selected}${skill.evolution === "fusion" ? "复合进化完成，前置技能保留" : "本系觉醒完成"}`
  if (skill.level === 1) return "下次：凝练 / 节律"
  if (skill.level === 2) return `下次：${spec.branches.map(([, name]) => name).join(" / ")}`
  if (skill.level === 3) return `${selected}下次：精研`
  if (!spec.fusion) return `${selected}下次：觉醒`
  const catalyst = build.skills.find(s => s.id === spec.fusion[0])
  const allowed = catalyst?.level >= 2 && !build.skills.some(s => s.evolution === "fusion")
  return `${selected}下次：觉醒${allowed ? ` / ${spec.fusion[1]}（前置保留）`
    : `；复合需同角色${SKILLS[spec.fusion[0]].name}2级（当前${catalyst?.level || 0}级），每人限一项`}`
}
export function parameters(skill, build) {
  const modern = buildRules(build) >= 3, spec = catalogFor(buildRules(build))[skill.id]
  let damage = spec.damage * (1 + (skill.level - 1) * .18) * (skill.focus === "power" ? 1.25 : 1)
    * (1 + build.talents.power * .08) * (skill.level === 5 ? 1.3 : 1)
  let cooldown = spec.cooldown * (skill.focus === "haste" ? .82 : 1) * (skill.level >= 4 ? .9 : 1)
  let range = spec.range, count = 1, radius = 90, duration = 4000, pierce = skill.id === "wind" ? 1 : 0
  if (skill.branch === "volley") { count = 2; damage *= .72 }
  if (skill.branch === "fan") { count = 3; damage *= .65 }
  if (skill.branch === "rapid") { cooldown *= .62; damage *= .85 }
  if (["cleave", "sweep"].includes(skill.branch)) range *= 1.3
  if (skill.branch === "pierce") pierce = 3
  if (skill.branch === "linger") duration = 6000
  if (skill.branch === "burst") { radius = 120; damage *= 1.2 }
  if (skill.branch === "hunt") radius = 145
  if (skill.branch === "line") range = 240
  if (skill.evolution === "fusion") { pierce = 3; range *= 1.2; damage *= 1.18 }
  let half = ["cleave", "sweep"].includes(skill.branch) || skill.evolution === "fusion" ? 1.5 : .9
  let width = 60, knockback = 25, reactCooldown = 5000, targets = 3, shieldBonus = 0, followBonus = 1.3, retaliateRange = 130
  let blastRadius = 48, blastDuration = 1000, frostStacks = 1, frostDuration = 3000, breakDamage = 12
  if (modern) {
    if (skill.branch === "line") width = 80
    if (skill.id === "frost") { radius = 115; duration = 3000; frostStacks = 2 }
    if (skill.branch === "rime") { frostStacks = 2; damage *= .9; cooldown *= 1.15 }
    if (skill.branch === "shards") { count = 2; damage *= .68 }
    if (skill.branch === "shatter") frostStacks = 1
    if (skill.level >= 4) {
      if (skill.branch === "volley") count++
      if (skill.branch === "blast") { blastRadius = 62; blastDuration = 1500 }
      if (skill.branch === "cleave") range *= 1.1
      if (skill.branch === "rapid") cooldown *= .9
      if (skill.branch === "pierce") pierce++
      if (skill.branch === "fan" || skill.branch === "shards") { count++; damage *= .85 }
      if (skill.branch === "counter") reactCooldown = 4000
      if (skill.branch === "sweep") knockback = 40
      if (skill.branch === "linger") duration += 1000
      if (skill.branch === "burst") radius += 15
      if (skill.branch === "line") width += 10
      if (skill.branch === "guarded") shieldBonus = 8
      if (skill.id === "pull") radius += 15
      if (skill.id === "armor" && skill.branch === "follow") followBonus = 1.5
      if (skill.id === "armor" && skill.branch === "retaliate") retaliateRange = 160
      if (skill.id === "ice") frostDuration += 1000
      if (skill.id === "frost" && skill.branch === "shatter") breakDamage = 18
      if (skill.id === "frost" && skill.branch === "mist") duration += 1000
    }
    if (skill.level === 5 && skill.evolution === "pure") {
      if (["fire", "wind"].includes(skill.id)) { count++; damage *= .85 }
      if (skill.id === "slash") { range *= 1.12; half = Math.min(Math.PI, half + .3) }
      if (skill.id === "guard") half = Math.PI
      if (skill.id === "flame") { radius *= 1.2; duration += 1000 }
      if (skill.id === "dash") width += 15
      if (skill.id === "pull") targets = 4
      if (skill.id === "ice") { pierce++; frostDuration += 1000 }
      if (skill.id === "frost") { radius = 145; frostStacks = 3 }
    }
  }
  const extra = {}
  if (buildRules(build) >= 6) {
    const deep = skill.level >= 4, pure = skill.level === 5 && skill.evolution === "pure", branch = skill.branch
    if (skill.id === "spark") {
      Object.assign(extra, { jumps: branch === "relay" ? 5 + Number(deep) : branch === "charge" ? 2 : 3,
        hop: branch === "relay" ? 185 : 145, decay: pure ? .84 : .72, first: branch === "charge" ? deep ? 1.85 : 1.6 : 1 })
      if (branch === "relay") damage *= .9
      if (pure) extra.jumps += 2
    }
    if (skill.id === "stone") {
      Object.assign(extra, { speed: 245, splash: branch === "shrapnel" ? deep ? 78 : 65 : 0, splashDamage: .4 })
      knockback = pure ? 48 : 32
      if (branch === "lance") { pierce = 2 + Number(deep) + Number(pure); damage *= .85 }
      if (pure && extra.splash) extra.splash = 90
    }
    if (skill.id === "thrust") {
      width = 18 + (branch === "skewer" && deep ? 6 : 0) + (pure ? 4 : 0)
      targets = branch === "skewer" ? 3 + Number(pure) : 1
      if (branch === "duel") damage *= 1.6 * (deep ? 1.1 : 1) * (pure ? 1.2 : 1)
      if (pure) range += 35
    }
    if (skill.id === "orbit") {
      radius = pure ? 92 : 84; duration = 1600
      Object.assign(extra, { blades: (branch === "twins" ? 2 : 1) + Number(pure),
        band: branch === "broad" ? deep ? 36 : 30 : 16, rotation: branch === "twins" ? deep ? 2.6 : 2.1 : 1.8 })
    }
    if (skill.id === "rune") {
      radius = (branch === "wide" ? deep ? 110 : 95 : 68) + (pure ? 15 : 0); duration = 8000
      Object.assign(extra, { trigger: 30, cap: pure ? 4 : 3 })
      if (branch === "quick") { cooldown *= deep ? .51 : .6; damage *= .8 }
    }
    if (skill.id === "quake") {
      radius = pure ? 185 : 165; range = radius; duration = deep ? 4000 : 3000
      knockback = pure ? 110 : 75
      extra.echoDamage = deep ? .7 : .55
    }
    if (skill.id === "whirl") {
      radius = pure ? 128 : 112; range = radius; duration = pure ? 4000 : 3000
      Object.assign(extra, { stride: branch === "travel" ? deep ? .3 : .2 : 0, edge: branch === "edge" ? deep ? 1.85 : 1.6 : 1 })
    }
    if (skill.id === "meteor") {
      radius = branch === "rain" ? 78 : branch === "impact" ? deep ? 145 : 132 : 110
      Object.assign(extra, { waves: (branch === "rain" ? deep ? 4 : 3 : 1) + Number(pure), delay: 900 })
      if (branch === "rain") damage *= .48
      knockback = branch === "impact" ? 65 : 0
    }
    if (skill.id === "heal") {
      extra.overflow = branch === "overflow" ? deep ? 1 : .7 : 0
      extra.healBonus = branch === "follow" && deep ? 1.3 : 1
      extra.ward = pure ? 6 : 0
    }
    if (skill.id === "beacon") {
      radius = 260; duration = branch === "follow" && deep ? 7500 : 6000
      Object.assign(extra, { lamps: pure ? 2 : 1, ward: branch === "ward" ? deep ? 4 : 2 : 0 })
    }
  }
  if (buildRules(build) >= 7) {
    const tags = SKILL_TAGS[skill.id], mods = build.mods
    if (tags.includes("projectile")) {
      if (mods.fork) { count++; damage *= .78 }
      pierce = Math.min(5, pierce + mods.piercing)
    }
    if (tags.includes("chain")) extra.jumps = (extra.jumps ?? (skill.evolution === "fusion" ? 3 : 1)) + mods.circuit
    if (mods.edge && tags.includes("melee")) {
      if (["slash", "guard", "thrust"].includes(skill.id)) range += 20 * mods.edge
      if (skill.id === "dash") width += 10 * mods.edge
      if (skill.id === "orbit") extra.band += 6 * mods.edge
      if (skill.id === "whirl") radius += 10 * mods.edge
    }
    if (mods.field && tags.includes("area")) {
      radius = Math.min(skill.id === "beacon" ? 280 : 200, radius + 12 * mods.field)
      if (skill.id === "quake") range = radius
    }
  }
  return { damage, cooldown: Math.max(250, Math.round(cooldown)), range, count, radius, duration, pierce,
    half, width, knockback, reactCooldown, targets, shieldBonus, followBonus, retaliateRange,
    blastRadius, blastDuration, frostStacks, frostDuration, breakDamage, ...extra }
}
export function choiceText(build, key, owner = "player") {
  const [id, action] = key.split(":")
  if (id === "talent") return { name: TALENTS[action][0], type: "基础强化",
    detail: action === "ward" && buildRules(build) >= 6 ? "同行护盾与治疗强度 +12%" : TALENTS[action][1],
    change: `${build.talents[action]} → ${build.talents[action] + 1} 阶`, icon: action === "vitality" ? "Heart" : "Plus" }
  if (id === "mod") {
    const spec = BUILD_MODS[action], affected = build.skills.filter(s => SKILL_TAGS[s.id].includes(spec.tag)).map(s => SKILLS[s.id].name)
    return { name: spec.name, type: action === "follow" ? "双人协同" : "体系改造",
      detail: `${spec.description} 当前适用：${affected.join("、")}；以后学到的同类技能也生效。`,
      change: `${build.mods[action]} → ${build.mods[action] + 1} 阶`, icon: spec.icon }
  }
  const spec = catalogFor(buildRules(build))[id], skill = build.skills.find(s => s.id === id)
  const slot = skillControl(build, id)
  if (action === "learn") return {
    name: `学会 · ${spec.name}`, type: `学招 / ${slot}`,
    detail: `${spec.description} ${spec.slot === "auto" ? "学会后立即加入自动攻击栏，不占 Q / E。" : spec.slot === "manual" ? `学会后进入 ${slot[0]} 槽。` : "学会后由同行自动支援。"}`,
    change: "未学习 → 1 级", icon: spec.icon,
  }
  const branch = spec.branches.find(([value]) => value === action)
  const after = structuredClone(build)
  // Description is a preview, never a mutation of the live build.
  applyChoice(after, owner, key)
  const beforeStats = parameters(skill, build), afterSkill = after.skills.find(s => s.id === id), next = parameters(afterSkill, after)
  const detail = branch?.[2] || (action === "fuse" ? `进化为${spec.fusion[1]}；${SKILLS[spec.fusion[0]].name}保留。${spec.fusion_effect || ""}`
    : action === "awaken" ? spec.awaken || "本系觉醒，提高招式强度。"
      : action === "deepen" ? spec.deepen || "强化当前分支，提高强度并缩短间隔。"
      : action === "haste" ? "选择施放节律，保留当前单次强度的成长。" : "选择单次威力，保留当前施放节律。")
  return {
    name: `${spec.name} · ${branch?.[1] || ({ power: "凝练", haste: "节律", deepen: "精研", awaken: "觉醒", fuse: "复合进化" }[action])}`,
    type: `${branch ? "分支" : action === "fuse" ? "融合" : "强化"} / ${slot}`, detail,
    change: `${skill.level} → ${skill.level + 1} 级 · 强度 ${Math.round(beforeStats.damage)} → ${Math.round(next.damage)} · 间隔 ${(beforeStats.cooldown / 1000).toFixed(2)} → ${(next.cooldown / 1000).toFixed(2)} 秒`,
    icon: spec.icon,
  }
}
