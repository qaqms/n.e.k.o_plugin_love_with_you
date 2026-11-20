import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { SWORDS, installCatalog, installRoutes, installBuildMods, installMastery, installLine, installCasts, installSwords, newBuild, newSkill,
  legalChoices, drawChoices, applyChoice, skillName, nextStep, choiceText, swordResonance, swordStats, parameters, buildRules, levelCap } from "../../static/skills.mjs"
import { schoolOf } from "../../static/ultimate.mjs"

const catalog = file => JSON.parse(readFileSync(new URL(`../../static/${file}.json`, import.meta.url), "utf8"))
installCatalog(catalog("skills"), catalog("skills-v2"), catalog("skills-expanded"))
installRoutes(catalog("routes")); installBuildMods(catalog("build-mods")); installMastery(catalog("mastery"))
installLine(catalog("fire-line")); installCasts(catalog("flame-line")); installSwords(catalog("sword-line"))
const random = seed => ({ between(a, b) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return a + seed % (b - a + 1) } })
const skill = (id, level = 1) => ({ ...newSkill(id), level, focus: level > 1 ? "power" : "",
  branch: level > 2 ? { fire: "volley", flame: "burst", slash: "cleave", dash: "line" }[id] : "", evolution: level === 5 ? "pure" : "" })
const build = (skills, rules = 15) => ({ ...newBuild("player", "guardian", rules), skills })

test("rule 15 builds carry the sword line; older builds keep their shape", () => {
  assert.deepEqual(newBuild("player", "guardian", 15).swords, [])
  assert.equal(buildRules(newBuild("player", "guardian", 15)), 15)
  assert.equal(Object.hasOwn(newBuild("player", "guardian", 14), "swords"), false)
  assert.equal(levelCap(newBuild("player", "guardian", 15)), 50)
  assert.ok(!legalChoices(build([skill("slash", 5)], 14), "player").some(key => key.startsWith("sword:")))
})

test("a finished swift slash walks three schools, two upper forms and the saint cut", () => {
  const b = build([skill("slash", 5)])
  assert.ok(!legalChoices(build([skill("slash", 4)]), "player").some(key => key.startsWith("sword:")))
  assert.match(nextStep(b, b.skills[0]), /下次：进阶中级 · 瞬光 \/ 流返 \/ 幻剑/)
  assert.deepEqual(legalChoices(b, "player").filter(key => key.startsWith("sword:")), ["sword:flash", "sword:ripple", "sword:phantom"])
  const preview = choiceText(b, "sword:ripple")
  assert.match(preview.name, /进阶中级 · 流返/); assert.match(preview.detail, /静水流/)
  assert.deepEqual(b.swords, [])
  for (const [id, next] of [["ripple", ["sword:wave", "sword:rain"]], ["wave", ["sword:sever"]], ["sever", []]]) {
    for (let level = 1; level <= SWORDS.cap; level++) assert.equal(applyChoice(b, "player", `sword:${id}`), true)
    assert.deepEqual(legalChoices(b, "player").filter(key => key.startsWith("sword:")), next)
  }
  assert.equal(skillName(b.skills[0], b), "迅斩 · 断界")
  assert.match(nextStep(b, b.skills[0]), /走到尽头/)
})

test("earlier forms and the root slow down; levels add power; resonance counts and speeds the sword", () => {
  const b = build([skill("slash", 5), skill("dash", 5)])
  const plain = parameters(b.skills[0], b).cooldown
  assert.deepEqual(swordResonance(b), { points: 4, tier: 2 })
  applyChoice(b, "player", "sword:flash")
  assert.ok(parameters(b.skills[0], b).cooldown > plain * 1.5, "the root slows once the line begins")
  const first = swordStats(b, "flash")
  applyChoice(b, "player", "sword:flash")
  assert.ok(swordStats(b, "flash").damage > first.damage)
  for (let i = 0; i < 3; i++) applyChoice(b, "player", "sword:flash")
  applyChoice(b, "player", "sword:wave")
  assert.equal(swordResonance(b).tier, 3)
  assert.equal(swordStats(b, "flash").cooldown, Math.round(SWORDS.arts.flash.cooldown * (1 - 4 * .04) * SWORDS.slow * .88))
})

test("the finishing move goes to the school with more resonance; rule 14 keeps fire only", () => {
  const sword = build([skill("slash", 5), skill("dash", 3), skill("fire", 1)])
  assert.equal(schoolOf(sword, 15), "sword")
  assert.equal(schoolOf(sword, 14), "fire")
  const fire = build([skill("fire", 5), skill("flame", 5), skill("slash", 1)])
  assert.equal(schoolOf(fire, 15), "fire")
  assert.equal(schoolOf(build([skill("wind", 1)]), 15), "")
})

test("the study draw offers the next sword form once the slash is finished", () => {
  let offered = 0
  for (let seed = 1; seed <= 40; seed++) if (drawChoices(build([skill("slash", 5)]), "player", random(seed)).some(key => key.startsWith("sword:"))) offered++
  assert.ok(offered >= 30, `offered in ${offered} of 40 draws`)
})
