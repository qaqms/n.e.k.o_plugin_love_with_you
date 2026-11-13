import { button, element } from "./camp.mjs"
import { icon } from "./icons.mjs"
import { SKILLS, LIMITS, BUILD_MODS, SKILL_TAGS, catalogFor, choiceText, skillName, skillControl, newSkill, parameters, nextStep, starterSkills } from "./skills.mjs"
import { COOPERATIONS } from "./encounter-rules.mjs"
import { actorImage } from "./actor-art.mjs"

export function renderStudy(body, scene) {
  const combat = scene.combat, owner = combat.studyOwner, build = combat.builds[owner]
  const name = owner === "player" ? "玩家" : `同行 · ${scene.meta.character}`
  body.dataset.owner = owner
  const identity = element("div", "", "study-identity"), image = document.createElement("img")
  image.src = actorImage(owner === "player" ? scene.meta.player_class : scene.meta.companion_class, owner)
  image.alt = ""; image.width = 50; image.height = 56
  identity.append(image, element("span", name), element("span", `${build.skills.length} 项已学技能`, "muted"))
  body.append(identity)
  body.append(element("p", `${name}研习 · 本次成长归属于${name}`, "study-owner"))
  const buildList = element("div", "", "study-build")
  for (const skill of build.skills) {
    const item = element("div", "", "study-skill")
    item.append(element("span", `${skillName(skill)} ${skill.level}级 · ${skillControl(build, skill.id)}`),
      element("span", nextStep(build, skill), "study-next"))
    buildList.append(item)
  }
  body.append(buildList)
  if (combat.craft) body.append(element("p", slotSummary(build, owner), "slot-summary"))
  if (scene.meta.rules === 3) body.append(element("p", "凝霜最多3层；玩家迅斩、回势斩或突进直接命中可碎冰。同行施加的凝霜计入双人配合。", "muted"))
  const grid = element("div", "", "upgrade-grid")
  if (combat.craft) grid.classList.add("free-study-grid")
  for (const key of scene.choices) {
    const text = choiceText(build, key, owner)
    const card = button("", () => combat.choose(key), "upgrade")
    card.dataset.upgrade = key; card.dataset.owner = owner
    card.dataset.element = key.split(":")[0]
    card.append(element("span", `${name} · ${text.type}`, "tag"), icon(text.icon),
      element("strong", text.name), element("span", text.change, "study-change"), element("span", text.detail))
    if (combat.craft && key.endsWith(":learn")) {
      const option = element("div", "", "study-option")
      const id = key.split(":")[0], banish = button("", () => combat.craft.banish(id), "banish-button", "Ban")
      banish.title = `放逐${SKILLS[id].name} · 本局不再出现 · 不消耗成长 · 剩余${2 - build.banished.length}次`
      banish.setAttribute("aria-label", `放逐${SKILLS[id].name}`)
      banish.disabled = build.banished.length >= 2
      option.append(card, banish); grid.append(option)
    } else grid.append(card)
  }
  const actions = element("div", "", "actions")
  const reroll = button(`重选 · ${combat.rerolls}`, () => combat.reroll(), "", "RotateCw")
  reroll.disabled = combat.rerolls === 0
  actions.append(reroll, button("技能图鉴", () => scene.controller.codex(), "", "BookOpen"),
    button("保存并返回", () => scene.controller.action(async () => {
    await scene.controller.save(true); scene.activeRun = false; await scene.controller.refresh()
  }), "", "Save"))
  body.append(grid, actions)
}

const slotSummary = (build, owner) => Object.entries(LIMITS[owner]).filter(([, max]) => max).map(([slot, max]) =>
  `${{ auto: "自动", manual: "主动", support: "支援" }[slot]} ${build.skills.filter(s => SKILLS[s.id].slot === slot).length}/${max}`).join(" · ")

export function renderStarter(body, scene) {
  const owner = scene.combat.craft.preparation, build = scene.combat.builds[owner]
  body.dataset.owner = owner
  body.append(element("p", owner === "player" ? "玩家 · 初次研习" : `同行 · ${scene.meta.character} · 初次研习`, "study-owner"),
    element("p", slotSummary(build, owner), "slot-summary"))
  const grid = element("div", "", "upgrade-grid starter-grid")
  for (const spec of starterSkills()) {
    const card = button("", () => scene.combat.craft.chooseStarter(spec.id), "upgrade")
    card.dataset.starter = spec.id; card.dataset.element = spec.id
    card.append(icon(spec.icon), element("strong", spec.name), element("span", "自动攻击 · 1级", "tag"), element("span", spec.description))
    grid.append(card)
  }
  const actions = element("div", "", "actions")
  actions.append(button("技能图鉴", () => scene.controller.codex(), "", "BookOpen"),
    button("保存并返回", () => scene.controller.action(async () => {
      await scene.controller.save(true); scene.activeRun = false; await scene.controller.refresh()
    }), "", "Save"))
  body.append(grid, actions)
}

export function renderRefit(body, scene, owner = "player", selected = "") {
  const combat = scene.combat, craft = combat.craft, build = combat.builds[owner]
  const tabs = element("div", "", "actions")
  for (const role of ["player", "companion"]) tabs.append(button(
    `${role === "player" ? "玩家" : scene.meta.character} · ${craft.available(role)}次`,
    () => scene.controller.refit(role), role === owner ? "primary" : ""))
  body.append(tabs, element("p", "替换后新招为1级，原招的等级、分支与觉醒失去。体系改造保留，已用冷却保留；融合前置和已选协同继续生效。", "muted"))
  const label = element("label", "准备替换的招式"), select = element("select")
  label.htmlFor = "refit-skill"; select.id = "refit-skill"
  for (const skill of build.skills) {
    const option = element("option", `${skillName(skill)} · ${skill.level}级`)
    option.value = skill.id; select.append(option)
  }
  select.value = build.skills.some(s => s.id === selected) ? selected : build.skills[0].id
  select.addEventListener("change", () => scene.controller.refit(owner, select.value))
  const row = element("div", "", "refit-selection")
  row.append(label, select); body.append(row)
  const candidates = craft.options(owner, select.value), grid = element("div", "", "refit-grid")
  let choice = ""
  const replace = button("确认换招", () => craft.replace(owner, select.value, choice), "primary", "RotateCw")
  replace.disabled = true
  for (const id of candidates) {
    const spec = SKILLS[id], option = element("label", "", "refit-option"), radio = document.createElement("input")
    radio.type = "radio"; radio.name = "replacement"; radio.value = id
    radio.disabled = !craft.available(owner)
    radio.addEventListener("change", () => { choice = id; replace.disabled = !craft.available(owner) })
    option.append(radio, icon(spec.icon), element("strong", spec.name), element("span", spec.description, "muted"))
    grid.append(option)
  }
  if (!candidates.length) body.append(element("p", "这项招式暂无可替换候选：已放逐的招式、融合前置和协同条件会限制换招。", "muted"))
  if (!craft.available(owner)) body.append(element("p", "本次没有剩余整备机会；击败小首领并完成协同研习后，双方各获得一次。", "muted"))
  const actions = element("div", "", "actions")
  actions.append(replace, button("返回休息", () => scene.controller.pause(true), "", "ArrowLeft"))
  body.append(grid, actions)
}

export function renderCodex(body, scene, owner = "player") {
  const tabs = element("div", "", "actions")
  tabs.setAttribute("role", "group"); tabs.setAttribute("aria-label", "技能归属")
  for (const actor of ["player", "companion"]) {
    const tab = button(actor === "player" ? "玩家" : `同行 · ${scene.meta.character}`, () => {
      body.querySelectorAll(".codex-list, .codex-tabs").forEach(node => node.remove())
      renderCodex(body, scene, actor)
    }, owner === actor ? "primary" : "")
    tab.setAttribute("aria-pressed", String(owner === actor)); tabs.append(tab)
  }
  tabs.classList.add("codex-tabs")
  const list = element("div", "", "codex-list")
  for (const spec of Object.values(catalogFor(scene.meta.rules))) {
    if (!LIMITS[owner][spec.slot]) continue
    const skill = scene.combat.skill(owner, spec.id)
    const build = scene.combat.builds[owner], p = parameters(skill || newSkill(spec.id), build)
    const row = element("article", "", "codex-row")
    const heading = element("h3", `${spec.name} · ${skill ? `${skill.level}级` : "未学习"}`)
    const control = skill ? skillControl(build, spec.id) : { auto: "自动攻击", manual: "主动技能", support: "同行自动支援" }[spec.slot]
    row.append(heading, element("p", `${control} · ${spec.description}`, "codex-use"),
      element("p", `范围 ${Math.round(p.range)} · ${spec.slot === "auto" ? "间隔" : "冷却"} ${(p.cooldown / 1000).toFixed(2)}秒`, "muted"),
      element("p", spec.branches.map(([, name, description]) => `${name}：${description}`).join(" / "), "muted"))
    const branch = skill && spec.branches.find(([key]) => key === skill.branch)
    if (branch) row.append(element("p", `已选分支：${branch[1]}`, "codex-use"))
    if (spec.deepen) row.append(element("p", `4级精研：${spec.deepen} 5级觉醒：${spec.awaken}`, "muted"))
    if (spec.fusion) row.append(element("p", `复合进化：本招 4级 + ${SKILLS[spec.fusion[0]].name} 2级 → ${spec.fusion[1]}；前置技能保留。`, "muted"))
    if (spec.fusion_effect) row.append(element("p", spec.fusion_effect, "muted"))
    list.append(row)
  }
  if (scene.combat.craft) for (const spec of Object.values(BUILD_MODS).filter(m => m.owners.includes(owner))) {
    const row = element("article", "", "codex-row codex-mod")
    row.append(element("h3", `${spec.name} · ${scene.combat.builds[owner].mods[spec.id]}/${spec.cap}阶`),
      element("p", spec.description, "codex-use"))
    list.append(row)
  }
  body.append(tabs, list)
}

export function mountSkillHud(scene) {
  const bar = document.getElementById("skill-bar"), auto = document.getElementById("auto-skills")
  bar.replaceChildren(); auto.replaceChildren()
  scene.skillHud = null
  if (!scene.combat) { bar.hidden = auto.hidden = true; return }
  const hud = { updatedAt: -Infinity, manual: [], auto: [], support: null, synergy: null }
  scene.skillHud = hud
  for (const owner of ["player", "companion"]) {
    const group = element("div", "", "auto-group")
    group.append(element("div", `${owner === "player" ? "玩家" : scene.meta.character} · 自动`, "auto-owner"))
    for (const skill of scene.combat.builds[owner].skills.filter(s => SKILLS[s.id].slot === "auto")) {
      const row = element("div", "", "auto-skill")
      row.dataset.owner = owner; row.dataset.skill = skill.id
      row.title = `${skillName(skill)} · ${catalogFor(scene.meta.rules)[skill.id].description}`
      const state = element("span", "", "auto-state")
      row.append(icon(SKILLS[skill.id].icon), element("span", `${skill.evolution === "fusion" ? SKILLS[skill.id].fusion[1] : SKILLS[skill.id].name} ${skill.level}级`, "auto-name"), state)
      group.append(row); hud.auto.push({ row, state, skill, owner })
    }
    auto.append(group)
  }
  if (scene.meta.rules === 3) {
    hud.synergy = element("div", "", "synergy-state")
    hud.synergy.id = "synergy-state"; auto.append(hud.synergy)
  }
  const manual = scene.combat.builds.player.skills.filter(s => SKILLS[s.id].slot === "manual")
  for (let slot = 0; slot < 2; slot++) {
    const skill = manual[slot], key = slot === 0 ? "Q" : "E"
    const control = button("", () => scene.combat.castManual(slot), "skill-button", skill ? SKILLS[skill.id].icon : "Plus")
    control.dataset.slot = slot
    control.title = skill ? `${key} · ${skillName(skill)} ${skill.level}级 · ${catalogFor(scene.meta.rules)[skill.id].description}` : `${key} · 尚未学习主动技能`
    control.setAttribute("aria-label", control.title)
    const state = element("span", "", "skill-cooldown")
    control.append(element("span", key, "skill-key"), element("span", skill ? skill.evolution === "fusion" ? SKILLS[skill.id].fusion[1] : SKILLS[skill.id].name : "未学主动", "skill-name"), state)
    bar.append(control); hud.manual.push({ control, skill, state })
  }
  const support = element("span", "", "support-state")
  support.id = "support-state"
  bar.append(support)
  hud.support = support
}

export function updateSkillHud(scene) {
  const hud = scene.skillHud
  if (!scene.combat || !hud || scene.elapsed - hud.updatedAt < 100) return
  hud.updatedAt = scene.elapsed
  const setText = (node, text) => { if (node.textContent !== text) node.textContent = text }
  for (const { row, state, skill, owner } of hud.auto) {
    const remaining = Math.max(0, skill.ready_at - scene.elapsed)
    const p = parameters(skill, scene.combat.builds[owner])
    const target = !remaining && scene.nearest(scene.combat.actor(owner), p.range)
    const zones = scene.combat.zones.filter(z => z.owner === owner && z.kind === skill.id && z.expires_at > scene.elapsed)
    const text = skill.id === "rune" && zones.length >= p.cap ? `伏印 ${zones.length} / ${p.cap}` : skill.id === "orbit" && zones.length ? "刃环中"
      : remaining ? `${(remaining / 1000).toFixed(1)}秒` : target ? "就绪"
        : ["slash", "guard", "thrust"].includes(skill.id) ? "待近敌" : "索敌中"
    row.dataset.state = remaining ? "cooldown" : target ? "ready" : "waiting"
    row.style.setProperty("--cooldown", `${Math.min(100, remaining / p.cooldown * 100)}%`)
    setText(state, text)
  }
  for (const { control, skill, state } of hud.manual) {
    const remaining = skill ? Math.max(0, skill.ready_at - scene.elapsed) : 0
    control.disabled = !skill || scene.paused || remaining > 0 || scene.controller.busy || Boolean(scene.controller.api.pending)
    const noTarget = ["flame", "frost", "quake", "meteor"].includes(skill?.id) && !remaining && !scene.nearest(scene.player, parameters(skill, scene.combat.builds.player).range)
    const text = skill ? remaining ? `${(remaining / 1000).toFixed(1)}秒` : noTarget ? "待敌" : "就绪" : ""
    control.dataset.state = remaining ? "cooldown" : skill ? "ready" : "empty"
    control.style.setProperty("--cooldown", `${skill ? Math.min(100, remaining / parameters(skill, scene.combat.builds.player).cooldown * 100) : 0}%`)
    setText(state, text)
  }
  const support = scene.combat.builds.companion.skills.find(s => SKILLS[s.id].slot === "support")
  if (!support) { setText(hud.support, `${scene.meta.character} · 支援未学`); return }
  const remaining = Math.max(0, support.ready_at - scene.elapsed)
  const supportParams = parameters(support, scene.combat.builds.companion)
  const idle = support.id === "armor" && scene.shield >= 8 ? "护盾充足"
    : support.id === "heal" && scene.hp / scene.maxHp() > .85 && !(support.branch === "overflow" && scene.shield < 8) ? "生命充足"
      : support.id === "beacon" && scene.combat.zones.some(z => z.kind === "beacon") ? "灵灯守备中"
        : ["heal", "beacon"].includes(support.id) && Math.hypot(scene.player.x - scene.companion.x, scene.player.y - scene.companion.y) > supportParams.range ? "距离过远"
          : ["pull", "beacon"].includes(support.id) && !scene.nearest(scene.companion, supportParams.range) ? "待敌" : "就绪"
  const text = `${scene.meta.character} · ${skillName(support)} ${support.level}级 · ${remaining ? `${(remaining / 1000).toFixed(1)}秒` : idle}`
  setText(hud.support, text)
  if (hud.synergy) {
    const marks = [...scene.combat.frost.marks.values()].filter(mark => mark.stacks && mark.expires_at > scene.elapsed).length
    setText(hud.synergy, `凝霜 ${marks} · 碎冰 ${scene.combat.stats.shatters} · 同行配合 ${scene.combat.stats.cross_shatters}`)
  }
}

export function buildDetails(snapshot) {
  const summary = element("div", "", "build-details")
  if (snapshot.rules < 2) return summary
  for (const owner of ["player", "companion"]) {
    const names = snapshot.builds[owner].skills.map(skill => `${skillName(skill)} ${skill.level}级`).join(" / ")
    summary.append(element("p", `${owner === "player" ? "玩家" : "同行"}：${names}`, "muted"))
    if (snapshot.rules >= 7) {
      const build = snapshot.builds[owner]
      const mods = Object.entries(build.mods).filter(([, rank]) => rank).map(([id, rank]) =>
        `${BUILD_MODS[id].name}${rank}阶${build.skills.some(s => SKILL_TAGS[s.id].includes(BUILD_MODS[id].tag)) ? "" : "（暂无适用招式）"}`)
      if (mods.length) summary.append(element("p", `体系改造：${mods.join(" / ")}`, "muted"))
      if (build.banished.length) summary.append(element("p", `已放逐：${build.banished.map(id => SKILLS[id].name).join(" / ")}`, "muted"))
    }
  }
  summary.append(element("p", `玩家伤害 ${Math.round(snapshot.stats.player_damage)} · 同行伤害 ${Math.round(snapshot.stats.companion_damage)} · 支援 ${snapshot.stats.supports} 次 · 接续 ${snapshot.stats.followups} 次`, "muted"))
  if (snapshot.rules === 3) summary.append(element("p", `碎冰 ${snapshot.stats.shatters} 次 · 其中同行凝霜配合 ${snapshot.stats.cross_shatters} 次`, "muted"))
  if (snapshot.rules >= 4) {
    const cleared = Object.values(snapshot.encounters.milestones).filter(mark => mark.defeated).length
    summary.append(element("p", `小首领 ${cleared} / 2 · 双人协同 ${snapshot.encounters.selected.map(id => COOPERATIONS[id].name).join(" / ") || "尚未取得"}`, "muted"))
    summary.append(element("p", `碎冰 ${snapshot.stats.shatters} 次 · 其中同行凝霜配合 ${snapshot.stats.cross_shatters} 次`, "muted"))
  }
  return summary
}
