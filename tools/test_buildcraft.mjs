import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { SKILLS, BUILD_MODS, LIMITS, installCatalog, installRoutes, installBuildMods,
  newBuild, newSkill, starterSkills, legalChoices, drawChoices, applyChoice,
  parameters, studyOwner, replacementChoices, choiceText } from "../static/skills.mjs"
import { Buildcraft } from "../static/buildcraft.mjs"
import { installEncounters } from "../static/encounter-rules.mjs"

const catalog = file => JSON.parse(readFileSync(new URL(`../static/${file}.json`, import.meta.url), "utf8"))
installCatalog(catalog("skills"), catalog("skills-v2"), catalog("skills-expanded"))
installRoutes(catalog("routes")); installBuildMods(catalog("build-mods")); installEncounters(catalog("encounters"))
const random = seed => ({ between(a, b) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return a + seed % (b - a + 1) } })
const build = (owner = "player", ids = ["fire"]) => ({ ...newBuild(owner, "mage", 7), skills: ids.map(newSkill) })

test("free starts ignore appearance, leave active slots empty and offer ten distinct auto attacks", () => {
  for (const owner of ["player", "companion"]) for (const kind of ["mage", "guardian"]) {
    assert.deepEqual(newBuild(owner, kind, 7).skills, [])
    assert.equal(starterSkills().length, 10)
    assert.ok(starterSkills().every(s => s.slot === "auto"))
  }
  assert.match(choiceText(build(), "meteor:learn").detail, /Q 槽/)
  assert.match(choiceText(build("companion"), "heal:learn", "companion").detail, /同行自动支援/)
})

test("four legal offers across thirty separate growths respect slots, bans, caps and owner isolation", () => {
  for (const starter of starterSkills()) for (let seed = 1; seed <= 30; seed++) {
    const builds = { player: build("player", [starter.id]), companion: build("companion", [starter.id]) }, rng = random(seed)
    builds.player.banished = ["fire", "wind"].filter(id => id !== starter.id)
    const counts = { player: 0, companion: 0 }
    for (let level = 2; level <= 31; level++) {
      const owner = studyOwner(level), other = owner === "player" ? "companion" : "player", current = builds[owner]
      const before = structuredClone(builds[other]), choices = drawChoices(current, owner, rng)
      assert.equal(choices.length, 4)
      assert.equal(new Set(choices).size, 4)
      assert.ok(choices.every(key => legalChoices(current, owner).includes(key)))
      assert.ok(!choices.some(key => current.banished.some(id => key === `${id}:learn`)))
      assert.equal(applyChoice(current, owner, choices[rng.between(0, 3)]), true)
      assert.deepEqual(builds[other], before)
      counts[owner]++
      for (const [slot, cap] of Object.entries(LIMITS[owner])) assert.ok(current.skills.filter(s => SKILLS[s.id].slot === slot).length <= cap)
      for (const [id, rank] of Object.entries(current.mods)) assert.ok(rank <= BUILD_MODS[id].cap)
    }
    assert.deepEqual(counts, { player: 20, companion: 10 })
  }
})

test("tag modifiers change only intended geometry, count and damage, including future learned skills", () => {
  const b = build("player", ["fire", "slash", "spark", "meteor"])
  const before = Object.fromEntries(b.skills.map(s => [s.id, parameters(s, b)]))
  for (const id of ["fork", "piercing", "edge", "circuit", "field"]) assert.equal(applyChoice(b, "player", `mod:${id}`), true)
  assert.equal(parameters(b.skills[0], b).count, before.fire.count + 1)
  assert.equal(parameters(b.skills[0], b).damage, before.fire.damage * .78)
  assert.equal(parameters(b.skills[0], b).pierce, 1)
  assert.equal(parameters(b.skills[1], b).range, before.slash.range + 20)
  assert.equal(parameters(b.skills[1], b).damage, before.slash.damage)
  assert.equal(parameters(b.skills[2], b).jumps, before.spark.jumps + 1)
  assert.equal(parameters(b.skills[3], b).radius, before.meteor.radius + 12)
  assert.equal(parameters(newSkill("stone"), b).count, 2)
  assert.equal(legalChoices(b, "player").includes("mod:follow"), false)
  assert.equal(legalChoices(build("companion"), "companion").includes("mod:follow"), false)
  assert.equal(legalChoices(build("companion", ["wind", "heal"]), "companion").includes("mod:follow"), true)
  const rune = build("player", ["rune"]); rune.mods.field = 2
  assert.equal(parameters(rune.skills[0], rune).trigger, 30)
})

test("max branches and modifiers keep finite capped saved projectile and zone parameters", () => {
  for (const spec of Object.values(SKILLS)) for (const [branch] of spec.branches) {
    const owner = spec.slot === "support" ? "companion" : "player", b = build(owner, [spec.id])
    for (const [id, mod] of Object.entries(BUILD_MODS)) b.mods[id] = mod.owners.includes(owner) ? mod.cap : 0
    Object.assign(b.skills[0], { level: 5, focus: "power", branch, evolution: "pure" })
    const p = parameters(b.skills[0], b)
    assert.ok(Object.values(p).every(Number.isFinite))
    assert.ok(p.pierce <= 5 && p.radius <= (spec.id === "beacon" ? 280 : 200))
    assert.ok(p.damage > 0 && p.damage < 1000 && p.cooldown >= 250)
  }
})

function decisions() {
  const saved = [], c = {
    builds: { player: build(), companion: build("companion", ["wind"]) }, rerolls: 2, studyOwner: "",
    zones: [], frost: { marks: new Map() }, expanded: { lines: [] },
    s: { activeRun: true, paused: true, outcome: "playing", elapsed: 1000, choices: [],
      rng: random(12), bullets: { getChildren: () => [] },
      encounters: { state: { resolved: [], selected: [], pending: "" } } },
  }
  c.controller = { busy: false, api: { pending: null },
    async action(task) { this.busy = true; try { await task() } finally { this.busy = false } },
    async save() { saved.push(structuredClone({ builds: c.builds, choices: c.s.choices, rerolls: c.rerolls, ...craft.data() })) },
    initialStudy() {}, play() {}, upgrades() {}, refit() {},
  }
  const craft = new Buildcraft(c, { preparation: "", swaps: { player: 0, companion: 0 } })
  return { c, craft, saved }
}

test("starter steps, banishment and reroll save immediately and reject repeated busy or pending actions", async () => {
  const { c, craft, saved } = decisions()
  craft.preparation = "player"; c.builds.player.skills = []; c.builds.companion.skills = []
  await craft.chooseStarter("meteor"); assert.equal(saved.length, 0)
  await craft.chooseStarter("stone"); assert.equal(saved[0].preparation, "companion")
  c.controller.api.pending = {}; await craft.chooseStarter("wind"); assert.equal(saved.length, 1)
  c.controller.api.pending = null; await craft.chooseStarter("wind"); assert.equal(saved[1].preparation, "")
  c.studyOwner = "player"; c.s.choices = ["fire:learn", "stone:power", "mod:fork", "talent:power"]
  await craft.banish("fire")
  assert.deepEqual(saved[2].builds.player.banished, ["fire"])
  assert.ok(!saved[2].choices.includes("fire:learn"))
  assert.equal(saved[2].rerolls, 2)
  await craft.banish("fire"); assert.equal(saved.length, 3)
  await craft.reroll(); assert.equal(saved[3].rerolls, 1); assert.equal(saved[3].choices.length, 4)
})

test("replacement uses earned owner credits, same slot, cooldown and cleanup while preserving passive ranks", async () => {
  const { c, craft, saved } = decisions()
  await craft.replace("player", "fire", "stone"); assert.equal(saved.length, 0)
  c.s.encounters.state.resolved = ["sentinel"]
  c.builds.player.mods.fork = 1; c.builds.player.skills[0].ready_at = 20000
  c.zones = [{ owner: "player" }, { owner: "companion" }]
  c.frost.marks.set(1, { source: "player" }); c.frost.marks.set(2, { source: "companion" })
  assert.ok(!craft.options("player", "fire").includes("meteor"))
  await craft.replace("player", "fire", "stone")
  assert.equal(saved[0].swaps.player, 1); assert.equal(saved[0].swaps.companion, 0)
  assert.equal(c.builds.player.skills[0].level, 1); assert.equal(c.builds.player.skills[0].ready_at, 20000)
  assert.equal(c.builds.player.mods.fork, 1)
  assert.deepEqual(c.zones, [{ owner: "companion" }]); assert.deepEqual([...c.frost.marks.keys()], [2])
  await craft.replace("player", "stone", "fire"); assert.equal(saved.length, 1)
  assert.equal(craft.available("companion"), 1)
})

test("replacement protects fusion catalysts and selected cooperation prerequisites", () => {
  const { c, craft } = decisions()
  c.builds.player.skills = [newSkill("fire"), newSkill("wind"), newSkill("flame")]
  Object.assign(c.builds.player.skills[0], { level: 5, evolution: "fusion" })
  c.builds.player.skills[1].level = 2
  assert.deepEqual(replacementChoices(c.builds.player, "wind"), [])
  c.builds.companion.skills.push(newSkill("pull"))
  c.s.encounters.state.selected = ["embers"]
  assert.deepEqual(craft.options("player", "flame"), [])
  assert.ok(craft.options("player", "fire").includes("stone"))
})
