import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { MASTERY, installCatalog, installRoutes, installBuildMods, installMastery, newBuild, newSkill, legalChoices, drawChoices,
  applyChoice, parameters, skillName, nextStep, choiceText, resonance, masteryOf, buildRules } from "../static/skills.mjs"

const catalog = file => JSON.parse(readFileSync(new URL(`../static/${file}.json`, import.meta.url), "utf8"))
installCatalog(catalog("skills"), catalog("skills-v2"), catalog("skills-expanded"))
installRoutes(catalog("routes")); installBuildMods(catalog("build-mods")); installMastery(catalog("mastery"))
const random = seed => ({ between(a, b) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return a + seed % (b - a + 1) } })
const skill = (id, level = 1, extra = {}) => ({ ...newSkill(id), level, focus: level > 1 ? "power" : "",
  branch: level > 2 ? { fire: "volley", flame: "burst", meteor: "impact", stone: "lance" }[id] : "", evolution: level === 5 ? "pure" : "", ...extra })
const build = (skills, rules = 10) => ({ ...newBuild("player", "mage", rules), skills })

test("rule 10 builds carry a mastery table; older builds keep their shape and never see mastery", () => {
  assert.deepEqual(newBuild("player", "mage", 10).mastery, { fire: 0, flame: 0, meteor: 0 })
  assert.equal(buildRules(newBuild("player", "mage", 10)), 10)
  assert.equal(Object.hasOwn(newBuild("player", "mage", 9), "mastery"), false)
  const old = build([skill("fire", 5)], 9)
  assert.ok(!legalChoices(old, "player").some(key => key.endsWith(":master")))
  assert.deepEqual(resonance(old), { points: 0, tier: 0 })
  assert.equal(parameters(old.skills[0], old).cooldown, parameters(build([skill("fire", 5)]).skills[0], build([skill("fire", 5)])).cooldown)
})

test("a finished fire skill keeps appearing: three mastery ranks, then nothing more", () => {
  const b = build([skill("fire", 5)])
  assert.ok(!legalChoices(build([skill("fire", 4)]), "player").includes("fire:master"))
  assert.ok(!legalChoices(build([skill("stone", 5)]), "player").includes("stone:master"), "only the fire school has mastery so far")
  for (let rank = 0; rank < 3; rank++) {
    assert.ok(legalChoices(b, "player").includes("fire:master"))
    assert.match(nextStep(b, b.skills[0]), new RegExp(`下次：精通.* · ${MASTERY.skills.fire[rank][0]}`))
    const text = choiceText(b, "fire:master")
    assert.match(text.name, new RegExp(`火丸 · 精通.+ ${MASTERY.skills.fire[rank][0]}`))
    assert.match(text.change, new RegExp(`精通 ${rank} → ${rank + 1}`))
    assert.equal(masteryOf(b, "fire"), rank, "previewing a choice does not change the build")
    assert.equal(applyChoice(b, "player", "fire:master"), true)
    assert.equal(b.skills[0].level, 5)
  }
  assert.equal(b.mastery.fire, 3)
  assert.ok(!legalChoices(b, "player").includes("fire:master"))
  assert.equal(applyChoice(b, "player", "fire:master"), false)
  assert.equal(skillName(b.skills[0], b), "火丸 · 精通Ⅲ")
  assert.equal(skillName(b.skills[0]), "火丸 · 觉醒")
  assert.match(nextStep(b, b.skills[0]), /精通已满/)
})

test("the study draw actually offers mastery once a skill is finished", () => {
  let offered = 0
  for (let seed = 1; seed <= 40; seed++) {
    const b = build([skill("fire", 5)])
    if (drawChoices(b, "player", random(seed)).includes("fire:master")) offered++
  }
  assert.ok(offered >= 30, `mastery was offered in ${offered} of 40 draws`)
})

test("every rank adds power, and the listed rank effects change real parameters", () => {
  const p = (id, rank, level = 5) => { const b = build([skill(id, level)]); b.mastery[id] = rank; return parameters(b.skills[0], b) }
  for (const id of ["fire", "flame", "meteor"]) for (let rank = 1; rank <= 3; rank++) assert.ok(p(id, rank).damage > p(id, rank - 1).damage, `${id} ${rank}`)
  assert.equal(p("fire", 2).count, p("fire", 1).count + 1)
  assert.equal(p("flame", 2).radius, Math.min(200, p("flame", 1).radius + 15))
  assert.ok(Math.abs(p("meteor", 1).damage / p("meteor", 0).damage - 1.25 * 1.12) < 1e-9)
  assert.equal(p("meteor", 2).knockback, p("meteor", 1).knockback + 45)
  assert.ok(p("flame", 3).radius <= 200 && p("meteor", 3).radius <= 200)
})

test("resonance counts school skills, awakenings and mastery, and its third tier shortens fire cooldowns only", () => {
  assert.deepEqual(resonance(build([skill("fire"), skill("stone", 5)])), { points: 1, tier: 0 })
  assert.deepEqual(resonance(build([skill("fire"), skill("flame")])), { points: 2, tier: 1 })
  assert.deepEqual(resonance(build([skill("fire", 5), skill("flame", 5)])), { points: 4, tier: 2 })
  const b = build([skill("fire", 5), skill("flame", 5), skill("stone", 3)])
  const before = Object.fromEntries(b.skills.map(s => [s.id, parameters(s, b).cooldown]))
  b.mastery.flame = 2
  assert.deepEqual(resonance(b), { points: 6, tier: 3 })
  assert.equal(parameters(b.skills[0], b).cooldown, Math.max(250, Math.round(before.fire * .88)))
  assert.equal(parameters(b.skills[2], b).cooldown, before.stone)
  assert.deepEqual(MASTERY.resonance.tiers.map(tier => tier[0]), [2, 4, 6])
})

// Rule 11: the fire line.
import { LINE, installLine, artOf, artStats, levelCap } from "../static/skills.mjs"
installLine(catalog("fire-line"))

test("rule 11 fire line: three middle forms to choose from, five levels each, then the upper form", () => {
  const b = build([skill("fire", 5)], 11)
  assert.deepEqual([b.arts, levelCap(b), levelCap(build([skill("fire", 5)], 10)), buildRules(b)], [[], 50, 31, 11])
  assert.ok(!legalChoices(build([skill("fire", 4)], 11), "player").some(key => key.startsWith("art:")))
  assert.deepEqual(legalChoices(b, "player").filter(key => key.startsWith("art:")), ["art:blade", "art:spray", "art:burst"])
  assert.ok(!legalChoices(b, "player").includes("fire:master"), "the line replaces fire mastery")
  assert.match(nextStep(b, b.skills[0]), /下次：进阶中级 · 焰刃 \/ 喷焰 \/ 爆炎/)
  assert.match(choiceText(b, "art:spray").name, /进阶中级 · 喷焰/)
  const base = parameters(b.skills[0], b).cooldown
  applyChoice(b, "player", "art:spray")
  assert.equal(parameters(b.skills[0], b).cooldown, base * 2, "the fire bolt keeps firing at half pace")
  for (let level = 1; level < 5; level++) {
    assert.deepEqual(legalChoices(b, "player").filter(key => key.startsWith("art:")), ["art:spray"])
    assert.match(choiceText(b, "art:spray").change, new RegExp(`${level} → ${level + 1} 级`))
    const before = artStats(b, "spray")
    applyChoice(b, "player", "art:spray")
    assert.ok(artStats(b, "spray").damage > before.damage && artStats(b, "spray").cooldown <= before.cooldown)
  }
  assert.deepEqual(legalChoices(b, "player").filter(key => key.startsWith("art:")), ["art:magma", "art:hellfire"])
  const alone = artStats(b, "spray").cooldown
  applyChoice(b, "player", "art:magma")
  assert.equal(artStats(b, "spray").cooldown, alone * 2, "the middle form slows once the upper form arrives")
  assert.deepEqual(b.arts.map(art => art.id), ["spray", "magma"])
  for (let i = 0; i < 4; i++) applyChoice(b, "player", "art:magma")
  assert.equal(artOf(b, "magma").level, 5)
  assert.deepEqual(resonance(b), { points: 6, tier: 3 })
  assert.deepEqual(legalChoices(b, "player").filter(key => key.startsWith("art:")), ["art:flash"])
  assert.match(nextStep(b, b.skills[0]), /下次：进阶圣级 · 瞬燃/)
  assert.match(choiceText(b, "art:flash").name, /进阶圣级 · 瞬燃/)
  const upper = artStats(b, "magma").cooldown
  for (let i = 0; i < 5; i++) applyChoice(b, "player", "art:flash")
  assert.equal(artStats(b, "magma").cooldown, upper * 2, "the upper form slows once the saint form arrives")
  assert.deepEqual(b.arts.map(art => [art.id, art.level]), [["spray", 5], ["magma", 5], ["flash", 5]])
  assert.ok(!legalChoices(b, "player").some(key => key.startsWith("art:")))
  assert.match(nextStep(b, b.skills[0]), /圣级已满/)
  assert.equal(applyChoice(b, "player", "art:blade"), false)
  const other = build([skill("fire", 5)], 11)
  other.arts = [{ id: "burst", level: 5 }]
  applyChoice(other, "player", "art:hellfire")
  assert.deepEqual(other.arts.map(art => art.id), ["burst", "hellfire"])
  assert.deepEqual(legalChoices(other, "player").filter(key => key.startsWith("art:")), ["art:hellfire"])
})

test("the study draw offers the advance as soon as the fire bolt is finished", () => {
  let offered = 0
  for (let seed = 1; seed <= 40; seed++) if (drawChoices(build([skill("fire", 5)], 11), "player", random(seed)).some(key => key.startsWith("art:"))) offered++
  assert.ok(offered >= 36, `an advance was offered in ${offered} of 40 draws`)
  assert.deepEqual(Object.keys(LINE.arts), ["blade", "spray", "burst", "magma", "hellfire", "flash"])
  assert.deepEqual(LINE.stages.map(stage => stage.length), [3, 2, 1])
})
