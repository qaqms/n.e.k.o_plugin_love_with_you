import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { STRIKES, installCatalog, installRoutes, installBuildMods, installMastery, installLine, installCasts, installSwords, installStrikes, newBuild, newSkill,
  legalChoices, applyChoice, skillName, nextStep, choiceText, swordResonance, strikeStats, buildRules } from "../../static/skills.mjs"

const catalog = file => JSON.parse(readFileSync(new URL(`../../static/${file}.json`, import.meta.url), "utf8"))
installCatalog(catalog("skills"), catalog("skills-v2"), catalog("skills-expanded"))
installRoutes(catalog("routes")); installBuildMods(catalog("build-mods")); installMastery(catalog("mastery"))
installLine(catalog("fire-line")); installCasts(catalog("flame-line")); installSwords(catalog("sword-line")); installStrikes(catalog("dash-line"))
const skill = (id, level = 1) => ({ ...newSkill(id), level, focus: level > 1 ? "power" : "", branch: level > 2 ? { slash: "cleave", dash: "line" }[id] : "", evolution: level === 5 ? "pure" : "" })
const build = (skills, rules = 18) => ({ ...newBuild("player", "guardian", rules), skills })

test("rule 18 builds carry the dash line and older builds do not", () => {
  assert.deepEqual(newBuild("player", "guardian", 18).strikes, [])
  assert.equal(buildRules(newBuild("player", "guardian", 18)), 18)
  assert.equal(Object.hasOwn(newBuild("player", "guardian", 17), "strikes"), false)
  assert.ok(!legalChoices(build([skill("dash", 5)], 17), "player").some(key => key.startsWith("strike:")))
})

test("a finished dash walks two middle forms, two upper forms and the domain, and counts toward sword resonance", () => {
  const b = build([skill("dash", 5)])
  assert.deepEqual(legalChoices(b, "player").filter(key => key.startsWith("strike:")), ["strike:chain", "strike:return"])
  assert.match(choiceText(b, "strike:chain").detail, /一键连招/)
  const before = swordResonance(b).points
  for (const [id, next] of [["return", ["strike:star", "strike:echo"]], ["echo", ["strike:domain"]], ["domain", []]]) {
    for (let level = 1; level <= STRIKES.cap; level++) assert.equal(applyChoice(b, "player", `strike:${id}`), true)
    assert.deepEqual(legalChoices(b, "player").filter(key => key.startsWith("strike:")), next)
  }
  assert.equal(swordResonance(b).points, before + 6)
  assert.equal(skillName(b.skills[0], b), "破阵突进 · 连招 回身斩→残影→剑域")
  assert.match(nextStep(b, b.skills[0]), /连招已经完整/)
  assert.ok(strikeStats(b, "domain").damage > STRIKES.arts.domain.damage)
})
