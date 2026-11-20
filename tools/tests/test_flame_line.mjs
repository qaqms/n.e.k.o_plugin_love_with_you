import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { CASTS, installCatalog, installRoutes, installBuildMods, installMastery, installLine, installCasts, newBuild, newSkill,
  legalChoices, drawChoices, applyChoice, skillName, nextStep, choiceText, resonance, castStats, buildRules, levelCap } from "../../static/skills.mjs"

const catalog = file => JSON.parse(readFileSync(new URL(`../../static/${file}.json`, import.meta.url), "utf8"))
installCatalog(catalog("skills"), catalog("skills-v2"), catalog("skills-expanded"))
installRoutes(catalog("routes")); installBuildMods(catalog("build-mods")); installMastery(catalog("mastery"))
installLine(catalog("fire-line")); installCasts(catalog("flame-line"))
const random = seed => ({ between(a, b) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return a + seed % (b - a + 1) } })
const skill = (id, level = 1) => ({ ...newSkill(id), level, focus: level > 1 ? "power" : "",
  branch: level > 2 ? { fire: "volley", flame: "burst" }[id] : "", evolution: level === 5 ? "pure" : "" })
const build = (skills, rules = 13) => ({ ...newBuild("player", "mage", rules), skills })

test("rule 13 builds carry the manual line; older builds keep their shape", () => {
  assert.deepEqual(newBuild("player", "mage", 13).casts, [])
  assert.equal(buildRules(newBuild("player", "mage", 13)), 13)
  assert.equal(Object.hasOwn(newBuild("player", "mage", 12), "casts"), false)
  assert.equal(levelCap(newBuild("player", "mage", 13)), 50)
  const old = build([skill("flame", 5)], 12)
  assert.ok(legalChoices(old, "player").includes("flame:master"), "rule 12 keeps the flame mastery")
  assert.ok(!legalChoices(old, "player").some(key => key.startsWith("cast:")))
})

test("a finished flame ring walks the manual line rank by rank and no longer offers mastery", () => {
  const b = build([skill("flame", 5)])
  assert.ok(!legalChoices(build([skill("flame", 4)]), "player").some(key => key.startsWith("cast:")))
  assert.ok(!legalChoices(b, "player").includes("flame:master"))
  assert.match(nextStep(b, b.skills[0]), /下次：进阶中级 · 炎墙 \/ 大炎球/)
  assert.deepEqual(legalChoices(b, "player").filter(key => key.startsWith("cast:")), ["cast:wall", "cast:orb"])
  const preview = choiceText(b, "cast:wall")
  assert.match(preview.name, /进阶中级 · 炎墙/); assert.match(preview.type, /Q 主动/); assert.match(preview.detail, /一键连招/)
  assert.deepEqual(b.casts, [], "previewing a choice does not change the build")
  for (const [id, next] of [["wall", ["cast:rift", "cast:domain"]], ["domain", ["cast:pillar"]], ["pillar", []]]) {
    for (let level = 1; level <= CASTS.cap; level++) {
      assert.equal(applyChoice(b, "player", `cast:${id}`), true)
      assert.equal(b.casts.at(-1).level, level)
      if (level < CASTS.cap) assert.deepEqual(legalChoices(b, "player").filter(key => key.startsWith("cast:")), [`cast:${id}`])
    }
    assert.deepEqual(legalChoices(b, "player").filter(key => key.startsWith("cast:")), next)
  }
  assert.equal(applyChoice(b, "player", "cast:orb"), false)
  assert.equal(skillName(b.skills[0], b), "焰环 · 连招 炎墙→燃域→炎柱")
  assert.match(nextStep(b, b.skills[0]), /连招已经完整/)
  assert.match(choiceText(build([skill("flame", 5)]), "cast:wall").change, /连招冷却 9\.0 秒/)
})

test("levels add power and shorten the cooldown; the line counts toward fire resonance", () => {
  const b = build([skill("flame", 5)])
  applyChoice(b, "player", "cast:orb")
  const first = castStats(b, "orb")
  applyChoice(b, "player", "cast:orb")
  const second = castStats(b, "orb")
  assert.ok(second.damage > first.damage && second.cooldown < first.cooldown)
  const before = resonance(build([skill("flame", 5)])).points
  for (let i = 0; i < 3; i++) applyChoice(b, "player", "cast:orb")
  assert.equal(resonance(b).points, before + 2, "one point for the form, one more once it is full")
})

test("the study draw offers the next form once the ring is finished", () => {
  let offered = 0
  for (let seed = 1; seed <= 40; seed++) if (drawChoices(build([skill("flame", 5)]), "player", random(seed)).some(key => key.startsWith("cast:"))) offered++
  assert.ok(offered >= 30, `the line was offered in ${offered} of 40 draws`)
})

test("the catalog is complete and each rank is its own rhythm", () => {
  assert.deepEqual(CASTS.stages.flat(), ["wall", "orb", "rift", "domain", "pillar"])
  assert.ok(CASTS.stages.flat().every(id => CASTS.arts[id].rank === CASTS.stages.findIndex(stage => stage.includes(id)) + 1))
  assert.ok(CASTS.arts.pillar.damage > CASTS.arts.rift.damage && CASTS.arts.pillar.cooldown > CASTS.arts.domain.cooldown)
  assert.throws(() => installCasts({ ...catalog("flame-line"), stages: [["wall"]] }))
})
