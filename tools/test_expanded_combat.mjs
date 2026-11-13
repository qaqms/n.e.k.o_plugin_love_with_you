import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { SkillCombat } from "../static/combat.mjs"
import { TerrainGeometry } from "../static/terrain-rules.mjs"
import { SKILLS, ROUTES, installCatalog, installRoutes, newBuild, newSkill, catalogFor,
  applyChoice, parameters, drawChoices, studyOwner, legalChoices } from "../static/skills.mjs"

const catalog = file => JSON.parse(readFileSync(new URL(`../static/${file}.json`, import.meta.url), "utf8"))
installCatalog(catalog("skills"), catalog("skills-v2"), catalog("skills-expanded"))
installRoutes(catalog("routes"))
const random = seed => ({ between(a, b) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return a + seed % (b - a + 1) } })
const near = (a, b) => assert.ok(Math.abs(a - b) < .00001, `${a} != ${b}`)

function fixture(player = "thunder", companion = "frost", props = []) {
  const geometry = new TerrainGeometry(props), entities = [], drops = [], bolts = []
  const graphics = {}
  for (const method of ["clear", "destroy", "setDepth", "lineStyle", "fillStyle", "strokeCircle", "fillCircle",
    "strokeRect", "lineBetween", "beginPath", "arc", "strokePath", "fillTriangle", "strokeTriangle",
    "fillEllipse", "strokeEllipse", "fillPoints"]) graphics[method] = () => graphics
  const entity = (x, y, hp = 5000) => {
    const data = { id: s.next(), hp, kind: "brute" }
    return { x, y, active: true, body: { velocity: { x: 0, y: 0 } },
      getData: key => data[key], setData(key, value) { if (typeof key === "object") Object.assign(data, key); else data[key] = value; return this },
      setVelocity(x, y = x) { this.body.velocity = { x, y }; return this }, destroy() { this.active = false } }
  }
  const shape = { rx: 7, ry: 7 }
  const s = {
    meta: { rules: 6, player_class: ROUTES[player].class, companion_class: ROUTES[companion].class,
      player_route: player, companion_route: companion, character: "YUI", loadout: { bonuses: { power: 0 } }, bonus: 0 },
    elapsed: 10000, outcome: "playing", activeRun: true, paused: false, hp: 100, shield: 0, kills: 0, partnerKills: 0,
    nextId: 1, next() { return this.nextId++ }, maxHp: () => 100, updateHud() {},
    add: { graphics: () => graphics }, art: { cast() {}, impact() {}, burst() {} },
    enemies: { getChildren: () => entities.filter(e => e.active) },
    bullets: { countActive: () => bolts.filter(b => b.active !== false).length },
    makeBullet(b) { bolts.push(b) }, makeDrop(d) { drops.push(d) },
    end(outcome) { this.outcome = outcome; this.terminal = c.data() },
    terrain: {
      lineClear: (a, b) => geometry.clear(a, b, shape),
      safePoint: p => geometry.safe(p, shape),
      endpoint: (a, b) => geometry.sweep(a, b, shape),
      place(a, b) { Object.assign(a, geometry.sweep(a, b, shape)) },
    },
    physics: { moveTo(e, x, y, speed) { const d = Math.max(1, Math.hypot(x - e.x, y - e.y)); e.setVelocity((x - e.x) / d * speed, (y - e.y) / d * speed) } },
    nearest(source, range) {
      return this.enemies.getChildren().filter(e => Math.hypot(e.x - source.x, e.y - source.y) <= range
        && this.terrain.lineClear(source, e)).sort((a, b) => Math.hypot(a.x - source.x, a.y - source.y) - Math.hypot(b.x - source.x, b.y - source.y))[0]
    },
  }
  s.player = entity(900, 600); s.companion = entity(870, 600)
  const notices = [], controller = { busy: false, api: { pending: null }, notice: text => notices.push(text) }
  const c = new SkillCombat(s, controller)
  s.combat = c
  const add = (x, y, hp) => { const e = entity(x, y, hp); entities.push(e); return e }
  const quiet = () => { for (const b of Object.values(c.builds)) for (const skill of b.skills) skill.ready_at = s.elapsed + 60000 }
  const equip = (owner, id, branch = "", evolution = "") => {
    const skill = { ...newSkill(id), level: evolution ? 5 : branch ? 3 : 1,
      focus: branch || evolution ? "power" : "", branch, evolution }
    const slot = SKILLS[id].slot
    c.builds[owner].skills = c.builds[owner].skills.filter(item => SKILLS[item.id].slot !== slot)
    c.builds[owner].skills.push(skill)
    return skill
  }
  return { c, s, add, equip, quiet, notices, drops, bolts }
}

test("eight routes have distinct legal starts and thirty separate growths stay usable with twenty skills", () => {
  assert.equal(Object.keys(SKILLS).length, 20)
  assert.equal(Object.keys(ROUTES).length, 8)
  assert.equal(Object.keys(catalogFor(2)).length, 8)
  for (const rules of [3, 4, 5]) assert.equal(Object.keys(catalogFor(rules)).length, 10)
  assert.equal(new Set(Object.values(ROUTES).map(r => r.player.join())).size, 8)
  for (const route of Object.values(ROUTES)) for (const owner of ["player", "companion"]) {
    const build = newBuild(owner, route.class, 6, route.id), rng = random(17)
    assert.deepEqual(build.skills.map(s => s.id), route[owner])
    assert.equal(Object.keys(build.misses).length, 20)
    for (let level = 2; level <= 31; level++) {
      if (studyOwner(level) !== owner) continue
      const choices = drawChoices(build, owner, rng)
      assert.equal(choices.length, 3)
      assert.ok(choices.every(key => legalChoices(build, owner).includes(key)))
      assert.ok(applyChoice(build, owner, choices[rng.between(0, 2)]))
    }
  }
})

test("each new skill has mechanically distinct branches and finite high-level parameters", () => {
  for (const spec of catalog("skills-expanded")) {
    const build = newBuild(spec.slot === "support" ? "companion" : "player", "mage", 6)
    const branches = spec.branches.map(([branch]) => parameters({ ...newSkill(spec.id), level: 3, focus: "power", branch }, build))
    if (spec.id !== "quake") assert.notDeepEqual(branches[0], branches[1], spec.id)
    for (const [branch] of spec.branches) {
      const p = parameters({ ...newSkill(spec.id), level: 5, focus: "haste", branch, evolution: "pure" }, build)
      assert.ok(Object.values(p).every(Number.isFinite), spec.id)
      assert.ok(p.cooldown >= 250 && p.damage > 0)
    }
  }
})

test("lightning chains to unique nearby targets, decays, stops at gaps, and charge affects only the first hit", () => {
  const { c, s, add } = fixture()
  const first = add(980, 600), second = add(1100, 600), third = add(1220, 600), far = add(1450, 600)
  assert.equal(c.shoot(s.player, "player", c.skill("player", "spark")), true)
  near(5000 - first.getData("hp"), 26)
  near(5000 - second.getData("hp"), 26 * .72)
  near(5000 - third.getData("hp"), 26 * .72 ** 2)
  assert.equal(far.getData("hp"), 5000)
  const skill = c.skill("player", "spark")
  Object.assign(skill, { level: 3, focus: "power", branch: "charge" })
  const p = parameters(skill, c.builds.player), before = second.getData("hp")
  c.shoot(s.player, "player", skill)
  near(before - second.getData("hp"), p.damage * p.decay)
})

test("lightning cannot jump through masonry and frost fusion consumes marks without sword counters", () => {
  const wall = { footprint: { x: 1050, y: 540, width: 20, height: 120 } }
  const { c, s, add } = fixture("thunder", "frost", [wall])
  const first = add(990, 600), blocked = add(1110, 600)
  const spark = c.skill("player", "spark")
  c.builds.player.skills.push({ ...newSkill("ice"), level: 2, focus: "haste" })
  Object.assign(spark, { level: 5, focus: "power", branch: "charge", evolution: "fusion" })
  c.frost.apply(first, "companion", c.skill("companion", "ice"), 2)
  c.shoot(s.player, "player", spark)
  assert.equal(blocked.getData("hp"), 5000)
  assert.equal(c.frost.marks.get(first.getData("id")).stacks, 0)
  assert.equal(c.stats.shatters, 0)
})

test("rock projectiles are slower, knock back, and splash excludes their primary victim", () => {
  const { c, s, add, equip, bolts } = fixture("earth")
  const stone = equip("player", "stone", "shrapnel")
  const first = add(1000, 600), other = add(1040, 600)
  assert.ok(c.shoot(s.player, "player", stone))
  near(Math.hypot(bolts[0].vx, bolts[0].vy), 245)
  const data = { ...bolts[0] }, bolt = { ...data, active: true,
    getData: k => data[k], setData(k, v) { data[k] = v }, destroy() { this.active = false } }
  bolt.x = first.x; bolt.y = first.y
  c.hit(bolt, first)
  near(5000 - first.getData("hp"), data.damage)
  near(5000 - other.getData("hp"), data.damage * .4)
  assert.ok(first.x > 1000)
  assert.equal(bolt.active, false)
})

test("narrow thrust distinguishes aligned from side targets and sword-frost cooperation", () => {
  const { c, s, add, equip } = fixture("lancer")
  const thrust = equip("player", "thrust", "skewer")
  const first = add(980, 600), second = add(1060, 600), side = add(1000, 650)
  c.frost.apply(first, "companion", c.skill("companion", "ice"), 2)
  c.shoot(s.player, "player", thrust)
  assert.ok(first.getData("hp") < second.getData("hp"))
  assert.ok(second.getData("hp") < 5000)
  assert.equal(side.getData("hp"), 5000)
  assert.equal(c.stats.cross_shatters, 1)
})

test("orbit has an inner blind spot, follows its owner, and refreshed rings inherit upgraded damage", () => {
  const { c, s, add, quiet } = fixture("blade")
  const skill = c.skill("player", "orbit"), inner = add(920, 600)
  const angle = s.elapsed / 1000 * 1.8, rim = add(900 + Math.cos(angle) * 84, 600 + Math.sin(angle) * 84)
  c.shoot(s.player, "player", skill)
  quiet(); c.update(0)
  assert.equal(inner.getData("hp"), 5000)
  assert.ok(rim.getData("hp") < 5000)
  const old = c.zones[0].damage
  Object.assign(skill, { level: 3, focus: "power", branch: "twins" })
  c.shoot(s.player, "player", skill)
  assert.equal(c.zones.length, 1)
  assert.ok(c.zones[0].damage > old)
  s.player.x += 50; s.elapsed += 50; c.update(50)
  assert.equal(c.zones[0].x, s.player.x)
})

test("runes arm after half a second, trigger once, keep per-owner caps and survive saved clocks", () => {
  const { c, s, add, quiet } = fixture("trapper")
  const enemy = add(910, 600), skill = c.skill("player", "rune")
  assert.ok(c.shoot(s.player, "player", skill)); quiet(); c.update(0)
  assert.equal(enemy.getData("hp"), 5000)
  s.elapsed += 499; c.update(499); assert.equal(enemy.getData("hp"), 5000)
  const snapshot = c.data(), restored = new SkillCombat(s, c.controller, snapshot)
  near(restored.zones[0].tick_at, 10500)
  s.elapsed++; restored.update(1)
  const hp = enemy.getData("hp")
  assert.ok(hp < 5000); assert.equal(restored.zones.length, 0)
  restored.update(1); assert.equal(enemy.getData("hp"), hp)
  for (let i = 0; i < 3; i++) assert.ok(c.shoot(s.player, "player", skill) || i === 2)
  assert.equal(c.zones.length, 3)
  assert.equal(c.shoot(s.player, "player", skill), false)
})

test("quake can miss with delayed echoes and fault fields slow only ordinary enemies", () => {
  const { c, s, add, equip, quiet } = fixture("earth")
  const skill = equip("player", "quake", "echo"), enemy = add(1000, 600)
  quiet(); skill.ready_at = 0
  assert.ok(c.castManual(0))
  const after = enemy.getData("hp")
  enemy.x = 1300; s.elapsed += 700; c.update(700)
  assert.equal(enemy.getData("hp"), after)
  assert.equal(c.zones.length, 0)
  const fault = equip("player", "quake", "fault")
  enemy.x = 950; enemy.setVelocity(100, 0)
  assert.ok(c.castManual(0)); quiet(); s.elapsed += 10; c.update(10)
  near(enemy.body.velocity.x, 60)
  assert.equal(c.zones[0].kind, fault.id)
})

test("moving sword dance grants speed only while active and respects walls and the outer-edge branch", () => {
  const { c, s, add, equip, quiet } = fixture("blade")
  const whirl = equip("player", "whirl", "travel")
  quiet(); whirl.ready_at = 0
  assert.ok(c.castManual(0))
  near(c.expanded.stride(), .2)
  s.player.x += 60
  const enemy = add(s.player.x + 60, 600)
  c.update(0); assert.ok(enemy.getData("hp") < 5000); assert.equal(c.zones[0].x, s.player.x)
  s.elapsed += 3001; c.update(3001); near(c.expanded.stride(), 0)
  const edge = equip("player", "whirl", "edge")
  quiet(); edge.ready_at = 0
  const inside = add(s.player.x + 30, 600), outside = add(s.player.x + 100, 600)
  c.castManual(0); c.update(0)
  assert.ok(5000 - outside.getData("hp") > 5000 - inside.getData("hp"))
})

test("meteor fixes its warned point, waits before damage, and does not track escaped enemies", () => {
  const { c, s, add, quiet } = fixture()
  const enemy = add(1120, 600), skill = c.skill("player", "meteor")
  quiet(); skill.ready_at = 0
  c.castManual(0)
  assert.equal(enemy.getData("hp"), 5000)
  s.elapsed += 899; c.update(899); assert.equal(enemy.getData("hp"), 5000)
  enemy.x = 1400; s.elapsed++; c.update(1)
  assert.equal(enemy.getData("hp"), 5000); assert.equal(c.zones.length, 0)
  enemy.x = 1300
  Object.assign(skill, { ready_at: 0, level: 3, focus: "power", branch: "rain" })
  c.castManual(0)
  assert.equal(c.zones.length, 3)
  const saved = c.data(), restored = new SkillCombat(s, c.controller, saved)
  s.elapsed += 900; restored.update(900)
  assert.ok(enemy.getData("hp") < 5000); assert.equal(restored.zones.length, 2)
})

test("healing preserves cooldown at full life, overflow becomes shield, and failed casts never follow up", () => {
  const { c, s, equip, add } = fixture("earth", "frost")
  const heal = c.skill("companion", "heal")
  assert.equal(c.support(heal), false)
  assert.equal(heal.ready_at, 0); assert.equal(c.stats.supports, 0)
  s.hp = 80
  assert.ok(c.support(heal)); near(s.hp, 92); assert.equal(c.stats.supports, 1)
  Object.assign(heal, { level: 3, focus: "power", branch: "overflow", ready_at: 0 })
  s.hp = 99; s.shield = 0
  assert.ok(c.support(heal)); near(s.hp, 100); assert.ok(s.shield > 0)
  const follow = equip("companion", "heal", "follow")
  s.hp = 90
  assert.equal(c.castManual(0), false)
  assert.equal(follow.ready_at, 0); assert.equal(c.stats.followups, 0)
  add(980, 600)
  assert.ok(c.castManual(0))
  assert.ok(follow.ready_at > s.elapsed); assert.equal(c.stats.followups, 1)
})

test("beacons stay fixed, check range, chain only with fusion and preserve shields above their ward cap", () => {
  const { c, s, add, equip, quiet } = fixture("earth", "thunder")
  const beacon = equip("companion", "beacon", "ward")
  const first = add(1040, 600), next = add(1140, 600)
  assert.ok(c.support(beacon))
  quiet(); c.update(0)
  assert.ok(first.getData("hp") < 5000); assert.equal(next.getData("hp"), 5000); near(s.shield, 2)
  const x = c.zones[0].x
  s.player.x += 300; s.shield = 70; s.elapsed += 900; c.update(900)
  assert.equal(c.zones[0].x, x); near(s.shield, 70)
  Object.assign(beacon, { level: 5, evolution: "fusion" })
  c.builds.companion.skills.push({ ...newSkill("spark"), level: 2, focus: "power" })
  s.elapsed += 900; c.update(900)
  assert.ok(next.getData("hp") < 5000)
})

test("companion new auto attacks credit companion damage and bosses resist new displacement", () => {
  const { c, s, add, equip } = fixture()
  const thrust = equip("companion", "thrust")
  const enemy = add(980, 600)
  c.shoot(s.companion, "companion", thrust)
  assert.ok(c.stats.companion_damage > 0); assert.equal(c.stats.player_damage, 0)
  const boss = add(1000, 600); boss.setData("kind", "sentinel")
  const stone = equip("player", "stone")
  const old = boss.x
  c.expanded.stoneImpact(boss, boss, stone, "player", 50, true)
  assert.equal(boss.x, old); assert.equal(enemy.active, true)
})

test("full effect budgets reject new casts without cooldowns and cosmetic lines stay bounded", () => {
  const { c, s, add } = fixture()
  add(1000, 600)
  for (let i = 0; i < 12; i++) c.zones.push({ kind: "flame", owner: "player", expires_at: s.elapsed + 1000 })
  assert.equal(c.castManual(0), false); assert.equal(c.skill("player", "meteor").ready_at, 0)
  for (let i = 0; i < 60; i++) c.expanded.beam([s.player, s.companion], 0xffffff)
  assert.equal(c.expanded.lines.length, 48)
})

test("one-shot removal is committed before terminal boss damage and later targets are untouched", () => {
  const { c, s, add, quiet } = fixture("trapper")
  const boss = add(910, 600, 1); boss.setData("kind", "boss")
  const other = add(920, 600)
  c.shoot(s.player, "player", c.skill("player", "rune"))
  quiet()
  s.elapsed += 500; c.update(500)
  assert.equal(s.outcome, "cleared")
  assert.equal(other.getData("hp"), 5000)
  assert.equal(s.terminal.zones.filter(z => z.kind === "rune").length, 0)
  assert.equal(s.kills, 1)
})

test("new fusions retain owned catalysts and create the promised additional attacks without exceeding budgets", () => {
  for (const [id, catalyst, branch] of [["whirl", "wind", "travel"], ["rune", "stone", "wide"]]) {
    const { c, s, add, equip, quiet, bolts } = fixture("blade")
    const skill = equip("player", id, branch, "fusion")
    c.builds.player.skills.push({ ...newSkill(catalyst), level: 2, focus: "power" })
    add(910, 600)
    if (id === "whirl") {
      assert.ok(c.castManual(0)); assert.equal(bolts.length, 5)
      assert.ok(bolts.every(b => b.skill === "wind" && b.form === "base"))
    } else {
      c.shoot(s.player, "player", skill); quiet(); s.elapsed += 500; c.update(500)
      assert.equal(bolts.length, 3)
      assert.ok(bolts.every(b => b.skill === "stone" && b.form === "base"))
    }
    assert.ok(c.skill("player", catalyst))
  }
})

test("frost-thrust applies new frost after breaking existing frost and wind-meteor attracts ordinary enemies", () => {
  const { c, s, add, equip, quiet } = fixture("lancer")
  const thrust = equip("player", "thrust", "duel", "fusion")
  c.builds.player.skills.push({ ...newSkill("ice"), level: 2, focus: "power" })
  const enemy = add(980, 600)
  c.frost.apply(enemy, "companion", c.skill("companion", "ice"), 2)
  c.shoot(s.player, "player", thrust)
  const mark = c.frost.marks.get(enemy.getData("id"))
  assert.equal(c.stats.cross_shatters, 1); assert.equal(mark.stacks, 1); assert.equal(mark.source, "player")
  const meteor = equip("player", "meteor", "impact", "fusion")
  c.builds.player.skills.push({ ...newSkill("wind"), level: 2, focus: "power" })
  quiet(); meteor.ready_at = 0
  const other = add(1010, 640), boss = add(1020, 610); boss.setData("kind", "sentinel")
  c.castManual(0); c.update(0)
  assert.ok(Math.hypot(other.body.velocity.x, other.body.velocity.y) > 0)
  near(Math.hypot(boss.body.velocity.x, boss.body.velocity.y), 0)
})

test("healing and lamp wards honor the existing companion stage and ward bonuses", () => {
  const { c, s, add, equip } = fixture("earth", "frost")
  s.meta.bonus = 8; c.builds.companion.talents.ward = 2; s.hp = 60
  assert.ok(c.support(c.skill("companion", "heal")))
  near(s.hp, 60 + 12 * 1.24 * 1.08)
  const beacon = equip("companion", "beacon", "ward")
  add(980, 600); assert.ok(c.support(beacon))
  c.expanded.updateZone(c.zones[0])
  near(s.shield, 2 * 1.24 * 1.08)
})
