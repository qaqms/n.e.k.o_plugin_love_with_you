import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { SKILLS, LIMITS, installCatalog, newBuild, studyOwner, legalChoices, drawChoices, applyChoice, parameters, choiceText, skillControl, nextStep } from "../static/skills.mjs"
import { FrostEffects } from "../static/frost.mjs"

installCatalog(...["skills.json", "skills-v2.json"].map(file => JSON.parse(readFileSync(new URL(`../static/${file}`, import.meta.url), "utf8"))))
function random(seed) {
  return { between(low, high) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return low + seed % (high - low + 1) } }
}

test("thirty growth opportunities remain separate and every offered choice is usable across builds", () => {
  for (const player of ["mage", "guardian"]) for (const companion of ["mage", "guardian"]) {
    for (let seed = 1; seed <= 20; seed++) {
      const builds = { player: newBuild("player", player), companion: newBuild("companion", companion) }
      const spent = { player: 0, companion: 0 }, rng = random(seed)
      for (let level = 2; level <= 31; level++) {
        const owner = studyOwner(level), other = owner === "player" ? "companion" : "player"
        const before = structuredClone(builds[other])
        const choices = drawChoices(builds[owner], owner, rng)
        assert.equal(choices.length, 3)
        assert.equal(new Set(choices).size, 3)
        assert.ok(choices.every(key => legalChoices(builds[owner], owner).includes(key)))
        assert.ok(applyChoice(builds[owner], owner, choices[rng.between(0, 2)]))
        assert.deepEqual(builds[other], before)
        spent[owner]++
        for (const [slot, max] of Object.entries(LIMITS[owner])) {
          assert.ok(builds[owner].skills.filter(s => SKILLS[s.id].slot === slot).length <= max)
        }
      }
      assert.deepEqual(spent, { player: 20, companion: 10 })
    }
  }
})

test("full slots, opposing branches, maximum ranks and missing same-owner catalysts are excluded", () => {
  const build = newBuild("player", "mage")
  for (const choice of ["wind:learn", "slash:learn", "dash:learn", "fire:power", "fire:blast", "fire:deepen"]) {
    assert.ok(applyChoice(build, "player", choice))
  }
  assert.ok(!legalChoices(build, "player").includes("guard:learn"))
  assert.ok(!applyChoice(build, "player", "fire:volley"))
  assert.ok(!legalChoices(build, "player").includes("fire:fuse"))
  assert.ok(applyChoice(build, "player", "wind:haste"))
  assert.ok(applyChoice(build, "player", "fire:fuse"))
  assert.equal(build.skills.find(s => s.id === "fire").evolution, "fusion")
  assert.equal(build.skills.find(s => s.id === "wind").level, 2)
  assert.ok(!legalChoices(build, "player").some(key => key.startsWith("fire:")))
})

test("branch pity survives rerolls and previewing cards never changes the build", () => {
  const build = newBuild("companion", "mage")
  applyChoice(build, "companion", "pull:power")
  build.misses.pull = 2
  const snapshot = structuredClone(build)
  const choices = drawChoices(build, "companion", random(7), false)
  assert.ok(choices.some(key => key.startsWith("pull:")))
  assert.deepEqual(build, snapshot)
  for (const key of choices) {
    const result = choiceText(build, key, "companion")
    assert.ok(result.name && result.detail && result.change)
    assert.deepEqual(build, snapshot)
  }
})

test("upgrade branches change damage, cadence, area and piercing with finite cooldown floors", () => {
  const build = newBuild("player", "mage")
  const base = parameters(build.skills[0], build)
  applyChoice(build, "player", "fire:haste")
  assert.ok(parameters(build.skills[0], build).cooldown < base.cooldown)
  applyChoice(build, "player", "fire:volley")
  assert.equal(parameters(build.skills[0], build).count, 2)
  for (const skill of Object.values(SKILLS)) for (const branch of skill.branches) {
    const max = { id: skill.id, level: 5, focus: "haste", branch: branch[0], evolution: "pure" }
    const p = parameters(max, build)
    assert.ok(Number.isFinite(p.damage) && p.damage > 0 && p.damage < 1000)
    assert.ok(p.cooldown >= 250 && p.radius <= 200)
  }
})

test("learning descriptions name actual automatic or active controls in both starting orders", () => {
  for (const kind of ["mage", "guardian"]) {
    const build = newBuild("player", kind)
    const initial = kind === "mage" ? "flame" : "dash", second = kind === "mage" ? "dash" : "flame"
    assert.equal(skillControl(build, initial), "Q 主动")
    assert.match(choiceText(build, `${second}:learn`).detail, /进入 E 槽/)
    assert.ok(applyChoice(build, "player", `${second}:learn`))
    assert.equal(skillControl(build, second), "E 主动")
    for (const key of legalChoices(build, "player").filter(key => key.endsWith(":learn"))) {
      assert.match(choiceText(build, key).detail, /自动攻击栏/)
      assert.match(choiceText(build, key).detail, /不占 Q \/ E/)
    }
  }
})

test("old builds keep eight-skill choices and original parameters; new builds expose ice", () => {
  const old = newBuild("player", "mage", 2), fresh = newBuild("player", "mage", 3)
  assert.equal(Object.keys(old.misses).length, 8)
  assert.equal(Object.keys(fresh.misses).length, 10)
  assert.ok(!legalChoices(old, "player").some(key => /^(ice|frost):/.test(key)))
  assert.ok(legalChoices(fresh, "player").includes("ice:learn"))
  for (const build of [old, fresh]) for (const key of ["dash:learn", "dash:power", "dash:line", "dash:deepen", "dash:awaken"]) applyChoice(build, "player", key)
  assert.equal(parameters(old.skills.find(s => s.id === "dash"), old).width, 60)
  assert.equal(parameters(fresh.skills.find(s => s.id === "dash"), fresh).width, 105)
})

test("each existing skill has a concrete specialization and awakening outcome", () => {
  const build = newBuild("player", "mage")
  const p = (id, branch, level = 5) => parameters({ id, branch, level, focus: "power", evolution: level === 5 ? "pure" : "" }, build)
  assert.equal(p("fire", "volley").count, 4)
  assert.equal(p("fire", "blast", 4).blastRadius, 62)
  assert.ok(p("slash", "cleave").range > p("slash", "cleave", 3).range)
  assert.ok(p("slash", "rapid", 4).cooldown < p("slash", "rapid", 3).cooldown)
  assert.equal(p("wind", "pierce").pierce, 4)
  assert.equal(p("wind", "fan").count, 5)
  assert.equal(p("guard", "counter").half, Math.PI)
  assert.equal(p("guard", "counter", 4).reactCooldown, 4000)
  assert.equal(p("flame", "linger").duration, 8000)
  assert.equal(p("dash", "line").width, 105)
  assert.equal(p("pull", "hunt").targets, 4)
  assert.equal(p("armor", "retaliate", 4).retaliateRange, 160)
})

function frostHarness() {
  const enemies = [], s = { elapsed: 1000, outcome: "playing", meta: { character: "YUI" },
    enemies: { getChildren: () => enemies } }
  const combat = { s, builds: { player: newBuild("player", "guardian"), companion: newBuild("companion", "mage") },
    stats: { shatters: 0, cross_shatters: 0 }, damage: (_, amount) => amount, flash() {}, controller: { notice() {} } }
  applyChoice(combat.builds.companion, "companion", "ice:learn")
  const ice = combat.builds.companion.skills.find(s => s.id === "ice")
  const enemy = (id, kind = "slime") => {
    const values = { id, kind }, e = { active: true, x: 100, y: 100, body: { velocity: { x: 100, y: 0 } },
      getData: key => values[key], setVelocity(x, y) { this.body.velocity = { x, y } } }
    enemies.push(e); return e
  }
  return { combat, s, ice, enemy, frost: new FrostEffects(combat) }
}

test("frost caps stacks, freezes briefly with immunity, slows bosses and survives a saved clock", () => {
  const h = frostHarness(), normal = h.enemy(1), boss = h.enemy(2, "boss")
  for (let i = 0; i < 5; i++) { h.frost.apply(normal, "companion", h.ice); h.frost.apply(boss, "companion", h.ice) }
  h.frost.update()
  assert.equal(h.frost.marks.get(1).stacks, 3)
  assert.equal(normal.body.velocity.x, 0)
  assert.equal(boss.body.velocity.x, 88)
  assert.equal(h.frost.marks.get(2).frozen_until, 0)
  const saved = h.frost.data()
  const restored = new FrostEffects(h.combat, saved)
  assert.deepEqual(restored.data(), saved)
  h.s.elapsed = 1700; normal.setVelocity(100, 0)
  restored.apply(normal, "companion", h.ice); restored.update()
  assert.equal(normal.body.velocity.x, 64)
  h.s.elapsed = 5000; normal.setVelocity(100, 0); restored.update()
  assert.equal(normal.body.velocity.x, 100)
  assert.equal(restored.marks.size, 0)
})

test("only direct player sword hits shatter, cooldowns persist and expired marks cannot trigger", () => {
  const h = frostHarness(), target = h.enemy(1)
  h.frost.apply(target, "companion", h.ice, 2)
  assert.equal(h.frost.strike(target, "companion", "guard", 30), 30)
  assert.equal(h.frost.strike(target, "player", "fire", 30), 30)
  assert.equal(h.frost.strike(target, "player", "slash", 30), 54)
  assert.deepEqual(h.combat.stats, { shatters: 1, cross_shatters: 1 })
  const restored = new FrostEffects(h.combat, h.frost.data())
  restored.apply(target, "companion", h.ice)
  assert.equal(restored.strike(target, "player", "dash", 30), 30)
  h.s.elapsed = 1800
  assert.equal(restored.strike(target, "player", "dash", 30), 30)
  h.s.elapsed = 3000
  assert.equal(restored.strike(target, "player", "guard", 30), 42)
  restored.apply(target, "companion", h.ice)
  h.s.elapsed = 6100
  assert.equal(restored.strike(target, "player", "slash", 30), 30)
  target.active = false
  assert.deepEqual(restored.data().frosts, [])
})

test("ice branches and roadmap previews preserve choices and distinguish control from burst", () => {
  const build = newBuild("player", "mage")
  applyChoice(build, "player", "ice:learn"); applyChoice(build, "player", "ice:power")
  assert.match(nextStep(build, build.skills.find(s => s.id === "ice")), /凝霜 \/ 双棱/)
  const before = structuredClone(build)
  for (const key of ["ice:rime", "ice:shards"]) {
    const copy = structuredClone(build); applyChoice(copy, "player", key)
    const ice = copy.skills.find(s => s.id === "ice"), p = parameters(ice, copy)
    assert.equal(p.frostStacks, key.endsWith("rime") ? 2 : 1)
    assert.equal(p.count, key.endsWith("shards") ? 2 : 1)
    assert.ok(choiceText(build, key).detail)
  }
  assert.deepEqual(build, before)
})

test("terminal combat cannot consume frost or increase shatter contributions", () => {
  const h = frostHarness(), target = h.enemy(1)
  h.frost.apply(target, "companion", h.ice, 3)
  h.s.outcome = "cleared"
  const saved = h.frost.data()
  assert.equal(h.frost.strike(target, "player", "slash", 30), 30)
  assert.equal(h.frost.consume(target, 12), 0)
  h.frost.apply(target, "companion", h.ice)
  assert.deepEqual(h.frost.data(), saved)
  assert.deepEqual(h.combat.stats, { shatters: 0, cross_shatters: 0 })
})
