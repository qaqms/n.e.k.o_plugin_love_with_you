import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const require = createRequire(process.env.NEKO_UI_DEPS
  ? join(resolve(process.env.NEKO_UI_DEPS), "package.json") : import.meta.url)
const { chromium } = require("playwright")
const python = process.env.NEKO_PYTHON || resolve(root, "../N.E.K.O/.venv/Scripts/python.exe")
const artifacts = process.env.NEKO_UI_ARTIFACTS || resolve(root, "../.neko-ui-review/artifacts")
mkdirSync(artifacts, { recursive: true })

async function harness(options = {}) {
  const { legacy = true, rules, displayRules, ...browserOptions } = options
  const data = mkdtempSync(join(tmpdir(), "neko-adventure-test-"))
  const server = spawn(python, ["-B", join(root, "tools/adventure_preview.py"), "--port", "0", "--data", data], {
    cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  })
  const url = await new Promise((resolve, reject) => {
    let output = "", errors = ""
    const timer = setTimeout(() => reject(new Error(`preview timeout ${errors}`)), 15000)
    server.stderr.on("data", value => { errors += value })
    server.stdout.on("data", value => {
      output += value
      if (output.includes("\n")) {
        clearTimeout(timer)
        try { resolve(JSON.parse(output.split("\n")[0]).url) } catch (e) { reject(e) }
      }
    })
    server.on("error", reject)
    server.on("exit", code => { if (code) { clearTimeout(timer); reject(new Error(errors)) } })
  })
  const browser = await chromium.launch({
    executablePath: process.env.NEKO_UI_BROWSER, headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, ...browserOptions })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.goto(url)
  const frame = page.frameLocator("#surface")
  try {
    await frame.getByRole("button", { name: "进入林地", exact: true }).waitFor()
  } catch (error) {
    await browser.close(); server.kill()
    throw new Error(`${error.message}\nPage errors: ${errors.join("\n")}`)
  }
  const actual = () => page.frames().find(f => f.url().includes("/ui/index.html"))
  const state = (fn, args) => actual().evaluate(async ({ source, args }) => {
    const { controller } = await import("./adventure.mjs")
    return new Function("c", "args", `return (${source})(c, args)`)(controller, args)
  }, { source: fn.toString(), args })
  const start = async () => {
    if (legacy || rules) {
      await frame.locator("#player-class").focus()
      await state((c, rules) => c.start({ character: "YUI", player_class: rules === 1 ? "guardian" : "mage", companion_class: "mage", rules }), rules || 1)
    } else {
      await frame.locator("#player-class").focus()
      await state(c => c.start({
        character: document.querySelector("#character").value,
        player_class: document.querySelector("#player-class").value,
        companion_class: document.querySelector("#partner-class").value, rules: 3,
      }))
    }
    if (rules === 7) await chooseStarters({ frame, state })
    await frame.locator("#screen").waitFor({ state: "hidden" })
    await poll(() => state(c => !c.saving && c.lastSaved === 0))
  }
  if (displayRules) await state((c, rules) => {
    const read = c.api.read.bind(c.api)
    c.api.read = async () => { const view = await read(); view.rules = rules; return view }
    c.api.view.rules = rules; c.preflight(c.api.view)
  }, displayRules)
  return {
    page, frame, browser, url, state, start, errors,
    async close() { await browser.close(); server.kill(); await new Promise(resolve => server.once("exit", resolve)) },
  }
}
async function chooseStarters(h, player = "fire", companion = "wind") {
  for (const [owner, id] of [["player", player], ["companion", companion]]) {
    await poll(() => h.state((c, owner) =>
      !c.saving && !c.busy && !c.api.pending && c.scene.combat.craft.preparation === owner, owner))
    await h.frame.locator(`[data-starter="${id}"]`).click()
  }
}
async function startFree(h, player = "fire", companion = "wind") {
  await h.frame.getByRole("button", { name: "进入林地", exact: true }).click()
  await chooseStarters(h, player, companion)
  await h.frame.locator("#screen").waitFor({ state: "hidden" })
  await poll(() => h.state(c => !c.saving && !c.busy && !c.api.pending))
}

test("free preparation separates appearance from starters and resumes the companion step without advancing time", async () => {
  const h = await harness()
  try {
    assert.equal(await h.frame.locator("#player-class option").count(), 2)
    assert.equal(await h.frame.locator(".route-style").count(), 0)
    assert.match(await h.frame.locator(".party").textContent(), /你的装束/)
    await h.frame.getByRole("button", { name: "进入林地", exact: true }).click()
    await poll(() => h.state(c => !c.busy && !c.saving))
    assert.equal(await h.frame.locator("[data-starter]").count(), 10)
    assert.equal(await h.state(c => c.scene.elapsed), 0)
    await h.frame.locator('[data-starter="stone"]').click()
    await poll(() => h.state(c => !c.busy && !c.saving && c.scene.combat.craft.preparation === "companion"))
    await h.frame.getByRole("button", { name: "保存并返回", exact: true }).click()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).waitFor()
    await h.page.reload()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).click()
    await poll(() => h.state(c => !c.busy && c.scene.combat?.craft.preparation === "companion"))
    assert.deepEqual(await h.state(c => c.scene.combat.builds.player.skills.map(s => s.id)), ["stone"])
    assert.equal(await h.state(c => c.scene.elapsed), 0)
    await h.frame.getByRole("button", { name: "技能图鉴", exact: true }).click()
    assert.equal(await h.frame.locator(".codex-row").count(), 21)
    await h.frame.getByRole("button", { name: "返回", exact: true }).click()
    await h.frame.locator('[data-starter="rune"]').click()
    await h.frame.locator("#screen").waitFor({ state: "hidden" })
    assert.equal(await h.frame.locator('.skill-button[data-state="empty"]').count(), 2)
    assert.match(await h.frame.locator("#support-state").textContent(), /支援未学/)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("free learned Q and E cast, projectile mods affect real shots and shared follow triggers unbranched healing", async () => {
  const h = await harness({ rules: 7 })
  try {
    await h.start()
    assert.match(await learn(h, "meteor:learn"), /进入 Q 槽/)
    assert.match(await learn(h, "flame:learn"), /进入 E 槽/)
    await learn(h, "heal:learn")
    await learn(h, "mod:fork")
    await learn(h, "fire:power")
    await learn(h, "mod:follow")
    const fired = await h.state(c => {
      const s = c.scene
      s.enemies.clear(true, true); s.bullets.clear(true, true); s.drops.clear(true, true)
      s.spawnAt = 1200000; s.hurtUntil = 1200000
      for (const b of Object.values(s.combat.builds)) for (const skill of b.skills) skill.ready_at = 1200000
      const p = s.terrain.safePoint({ x: s.player.x + 80, y: s.player.y })
      s.makeEnemy({ id: s.next(), kind: "brute", x: p.x, y: p.y, hp: 5000 })
      s.combat.shoot(s.player, "player", s.combat.skill("player", "fire"))
      s.hp = 60; s.combat.skill("player", "meteor").ready_at = 0
      s.combat.skill("player", "flame").ready_at = 0; s.combat.skill("companion", "heal").ready_at = 0
      return s.bullets.countActive()
    })
    assert.equal(fired, 2)
    await h.page.keyboard.press("q")
    await poll(() => h.state(c => c.scene.combat.stats.followups === 1))
    assert.ok(await h.state(c => c.scene.hp > 60))
    assert.equal(await h.state(c => c.scene.combat.skill("companion", "heal").branch), "")
    await h.page.keyboard.press("e")
    await h.state(async c => { c.scene.setPaused(true); c.pause(true); await c.save(true); c.scene.activeRun = false })
    assert.deepEqual(await h.state(c => [...new Set(c.scene.combat.zones.map(z => z.kind))].sort()), ["flame", "meteor"])
    const saved = await h.state(c => c.scene.snapshot())
    await h.page.reload()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).click()
    await h.frame.locator("#screen").waitFor({ state: "hidden" })
    const restored = await h.state(c => { c.scene.setPaused(true); return c.scene.snapshot() })
    assert.deepEqual(restored.builds, saved.builds)
    assert.deepEqual(restored.zones, saved.zones)
    assert.equal(restored.stats.followups, 1)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("free banishment and reroll persist exact decisions and replay a lost response without spending twice", async () => {
  const h = await harness({ rules: 7 }), requests = []
  try {
    await h.start()
    await h.state(c => { c.scene.xp = c.scene.xpNeeded(); c.scene.checkLevel() })
    await poll(() => h.state(c => !c.saving && !c.busy))
    assert.equal(await h.frame.locator("[data-upgrade]").count(), 4)
    let lost = false
    await h.page.route("**/preview/action", async route => {
      const args = route.request().postDataJSON()
      if (args.operation === "checkpoint" && args.values?.snapshot?.builds.player.banished.length) {
        requests.push(args.request_id)
        const response = await route.fetch()
        if (!lost) { lost = true; await route.abort(); return }
        await route.fulfill({ response }); return
      }
      await route.continue()
    })
    await h.frame.locator(".banish-button").first().click()
    await h.frame.getByRole("button", { name: "确认上次操作", exact: true }).click()
    await poll(() => h.state(c => !c.busy && !c.api.pending && c.scene.choices.length === 4))
    assert.equal(requests.length, 2); assert.equal(requests[0], requests[1])
    const banned = await h.state(c => c.scene.combat.builds.player.banished[0])
    assert.equal(await h.frame.locator(`[data-upgrade="${banned}:learn"]`).count(), 0)
    assert.equal(await h.state(c => c.scene.combat.rerolls), 2)
    await h.frame.getByRole("button", { name: "重选 · 2", exact: true }).click()
    await poll(() => h.state(c => !c.busy && !c.saving && c.scene.combat.rerolls === 1))
    const saved = await h.state(c => c.scene.snapshot())
    await h.page.reload()
    h.page.once("dialog", dialog => dialog.accept())
    await h.frame.getByRole("button", { name: "接管此旅程", exact: true }).click()
    await h.frame.locator("[data-upgrade]").first().waitFor()
    const restored = await h.state(c => c.scene.snapshot())
    assert.deepEqual(restored.choices, saved.choices)
    assert.equal(restored.rng, saved.rng)
    assert.deepEqual(restored.builds, saved.builds)
    assert.equal(restored.rerolls, 1)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("free miniboss cooperation earns per-owner refits and a lost swap acknowledgement cannot grant extra refits", async () => {
  const h = await harness({ rules: 7 }), requests = []
  try {
    await h.start()
    await h.state(c => {
      const s = c.scene
      s.setPaused(true); s.level = 31; s.elapsed = 360000; s.spawnAt = 1200000; s.hurtUntil = 1200000
      s.enemies.clear(true, true); s.bullets.clear(true, true); s.drops.clear(true, true)
      s.encounters.spawn()
      const boss = s.enemies.getChildren().find(e => e.getData("kind") === "sentinel")
      s.combat.deal(boss, 10000, "player"); s.encounters.openReward(true)
    })
    await h.frame.locator("[data-cooperation]").first().waitFor()
    await poll(() => h.state(c => !c.saving && !c.busy))
    await h.frame.locator("[data-cooperation]").first().click()
    await h.frame.locator("#screen").waitFor({ state: "hidden" })
    await h.frame.getByRole("button", { name: "暂停", exact: true }).click()
    await h.frame.getByRole("button", { name: "战后整备 · 2", exact: true }).click()
    await h.state(c => { c.scene.combat.skill("player", "fire").ready_at = 390000 })
    let lost = false
    await h.page.route("**/preview/action", async route => {
      const args = route.request().postDataJSON()
      if (args.operation === "checkpoint" && args.values?.snapshot?.swaps.player === 1) {
        requests.push(args.request_id); const response = await route.fetch()
        if (!lost) { lost = true; await route.abort(); return }
        await route.fulfill({ response }); return
      }
      await route.continue()
    })
    await h.frame.locator('input[name="replacement"][value="stone"]').check()
    await h.frame.getByRole("button", { name: "确认换招", exact: true }).click()
    await h.frame.getByRole("button", { name: "确认上次操作", exact: true }).click()
    await poll(() => h.state(c => !c.busy && !c.api.pending))
    assert.equal(requests.length, 2); assert.equal(requests[0], requests[1])
    assert.deepEqual(await h.state(c => c.scene.combat.craft.swaps), { player: 1, companion: 0 })
    assert.equal(await h.state(c => c.scene.combat.skill("player", "stone").ready_at), 390000)
    await h.page.reload()
    h.page.once("dialog", dialog => dialog.accept())
    await h.frame.getByRole("button", { name: "接管此旅程", exact: true }).click()
    await h.frame.locator("#screen").waitFor({ state: "hidden" })
    await h.frame.getByRole("button", { name: "暂停", exact: true }).click()
    await h.frame.getByRole("button", { name: "战后整备 · 1", exact: true }).click()
    assert.equal(await h.frame.locator('input[name="replacement"]:not(:disabled)').count(), 0)
    await h.frame.getByRole("button", { name: "YUI · 1次", exact: true }).click()
    assert.ok(await h.frame.locator('input[name="replacement"]:not(:disabled)').count() > 0)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

for (const viewport of [{ width: 1280, height: 820 }, { width: 390, height: 844 }]) {
  test(`free starters, four offers and refit controls fit at ${viewport.width}px`, async () => {
    const h = await harness({ viewport })
    try {
      await h.page.screenshot({ path: join(artifacts, `adventure-free-camp-${viewport.width}.png`) })
      await h.frame.getByRole("button", { name: "进入林地", exact: true }).click()
      await poll(() => h.state(c => !c.busy && !c.saving))
      await h.page.screenshot({ path: join(artifacts, `adventure-free-starters-${viewport.width}.png`) })
      await chooseStarters(h, "thrust", "spark")
      await h.frame.locator("#screen").waitFor({ state: "hidden" })
      await poll(() => h.state(c => !c.busy && !c.saving))
      await h.state(c => { c.scene.xp = c.scene.xpNeeded(); c.scene.checkLevel() })
      await h.frame.locator("[data-upgrade]").first().waitFor()
      await poll(() => h.state(c => !c.saving))
      assert.equal(await h.state(() => document.getElementById("screen").scrollTop), 0)
      await h.page.screenshot({ path: join(artifacts, `adventure-free-study-${viewport.width}.png`) })
      const fit = await h.state(() => {
        const grid = document.querySelector(".free-study-grid")
        return { columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
          overflow: [...document.querySelectorAll("#screen-body button, #screen-body select")].some(el => el.scrollWidth > el.clientWidth + 1),
          fits: document.documentElement.scrollWidth <= innerWidth }
      })
      assert.equal(fit.columns, viewport.width > 600 ? 2 : 1)
      assert.equal(fit.overflow, false); assert.equal(fit.fits, true)
      await h.state(c => {
        const s = c.scene
        s.choices = []; s.combat.studyOwner = ""
        s.encounters.state.resolved = ["sentinel"]; s.encounters.state.selected = ["escort"]
        c.refit()
      })
      await h.frame.locator('input[name="replacement"]').first().waitFor()
      assert.equal(await h.state(() => document.getElementById("screen").scrollTop), 0)
      await h.page.screenshot({ path: join(artifacts, `adventure-free-refit-${viewport.width}.png`) })
      assert.equal(await h.state(() => document.documentElement.scrollWidth <= innerWidth), true)
      assert.deepEqual(h.errors, [])
    } finally { await h.close() }
  })
}
async function poll(fn, expected = true) {
  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    if (await fn() === expected) return
    await new Promise(resolve => setTimeout(resolve, 80))
  }
  assert.fail("condition timed out")
}

async function learn(h, key) {
  await h.state(async (c, key) => {
    const { drawChoices, studyOwner } = await import("./skills.mjs")
    const s = c.scene, owner = studyOwner(s.level + 1)
    // Seed the real draw, then select its card through the UI and save normally.
    for (let seed = 0; seed < 1000; seed++) {
      s.rng.sow([`${key}:${seed}`])
      const state = s.rng.state()
      if (!drawChoices(structuredClone(s.combat.builds[owner]), owner, s.rng, false).includes(key)) continue
      s.rng.state(state); s.xp = s.xpNeeded(); s.checkLevel()
      return
    }
    throw new Error(`No legal draw for ${key}`)
  }, key)
  const card = h.frame.locator(`[data-upgrade="${key}"]`)
  await card.waitFor()
  const text = await card.textContent()
  await poll(() => h.state(c => !c.saving && !c.api.pending && !c.busy))
  await card.click()
  await h.frame.locator("#screen").waitFor({ state: "hidden" })
  await poll(() => h.state(c => !c.saving && !c.api.pending && !c.busy))
  return text
}

test("eight selectable routes launch distinct owner skills, show their tradeoffs and preserve route identities", async () => {
  const h = await harness({ displayRules: 6 })
  try {
    assert.equal(await h.frame.locator("#player-class option").count(), 8)
    assert.equal(await h.frame.locator("#partner-class option").count(), 8)
    for (const route of ["guardian", "mage", "frost", "thunder", "earth", "blade", "trapper", "lancer"]) {
      await h.frame.locator("#player-class").selectOption(route)
      await h.frame.locator("#partner-class").selectOption(route)
      assert.ok((await h.frame.locator('.party-member[data-owner="player"] .route-style').textContent()).length > 15)
      const result = await h.state(async (c, route) => {
        const { ROUTES } = await import("./skills.mjs")
        await c.start({ character: "YUI", player_class: ROUTES[route].class, companion_class: ROUTES[route].class,
          player_route: route, companion_route: route })
        c.scene.setPaused(true)
        return { player: c.scene.combat.builds.player.skills.map(s => s.id), companion: c.scene.combat.builds.companion.skills.map(s => s.id),
          expected: ROUTES[route], playerAtlas: c.scene.player.frame.name, companionAtlas: c.scene.companion.frame.name }
      }, route)
      assert.deepEqual(result.player, result.expected.player)
      assert.deepEqual(result.companion, result.expected.companion)
      assert.match(result.playerAtlas, new RegExp(`^${result.expected.class}-`))
      assert.match(result.companionAtlas, new RegExp(`^companion-${result.expected.class}-`))
      await h.state(c => c.scene.end("retreated"))
      await h.frame.getByRole("button", { name: "返回营地", exact: true }).click()
      await h.frame.getByRole("button", { name: "进入林地", exact: true }).waitFor()
    }
    await h.frame.locator("#player-class").selectOption("lancer")
    await h.frame.locator("#partner-class").selectOption("frost")
    await h.frame.getByRole("button", { name: "进入林地", exact: true }).click()
    await h.frame.locator("#screen").waitFor({ state: "hidden" })
    await poll(() => h.state(c => !c.saving && !c.busy))
    await h.state(async c => { c.scene.setPaused(true); await c.save(true); c.scene.activeRun = false; await c.refresh() })
    await h.page.reload()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).click()
    await h.frame.locator("#screen").waitFor({ state: "hidden" })
    assert.deepEqual(await h.state(c => [c.scene.meta.player_route, c.scene.meta.companion_route]), ["lancer", "frost"])
    assert.match(await h.frame.locator("#build-label").textContent(), /贯锋剑 × 凝霜术/)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("expanded skills learned from real cards attack and bind E; a pending meteor resumes exactly once", async () => {
  const h = await harness({ legacy: false, rules: 6 })
  try {
    await h.start()
    assert.match(await learn(h, "spark:learn"), /自动攻击栏/)
    assert.match(await learn(h, "meteor:learn"), /E 主动/)
    await h.state(c => {
      const s = c.scene
      s.enemies.clear(true, true); s.bullets.clear(true, true); s.drops.clear(true, true)
      s.spawnAt = 1200000; s.hurtUntil = 1200000
      for (const build of Object.values(s.combat.builds)) for (const skill of build.skills) skill.ready_at = 1200000
      s.combat.skill("player", "spark").ready_at = 0
      s.combat.skill("player", "meteor").ready_at = 0
      s.makeEnemy({ id: s.next(), kind: "brute", x: s.player.x + 90, y: s.player.y, hp: 5000 })
    })
    await poll(() => h.state(c => c.scene.combat.stats.player_damage > 0))
    assert.equal(await h.frame.locator('.auto-skill[data-owner="player"][data-skill="spark"]').count(), 1)
    await h.page.keyboard.press("e")
    await h.state(c => { c.scene.setPaused(true); c.pause(true) })
    assert.equal(await h.state(c => c.scene.combat.zones.filter(z => z.kind === "meteor").length), 1)
    const saved = await h.state(async c => {
      c.scene.enemies.getFirstAlive().setVelocity(0)
      await c.save(true)
      return c.scene.snapshot()
    })
    await h.page.reload()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).click()
    await h.frame.locator("#screen").waitFor({ state: "hidden" })
    const resumed = await h.state(c => {
      const s = c.scene
      s.setPaused(true)
      const zones = structuredClone(s.combat.zones), stats = { ...s.combat.stats }
      s.elapsed = zones[0].tick_at
      s.combat.update(0)
      const damage = s.combat.stats.player_damage
      s.combat.update(0)
      return { zones, before: stats.player_damage, after: damage, twice: s.combat.stats.player_damage,
        remaining: s.combat.zones.filter(z => z.kind === "meteor").length, ready: s.combat.skill("player", "meteor").ready_at }
    })
    assert.deepEqual(resumed.zones, saved.zones)
    assert.ok(resumed.after > resumed.before)
    assert.equal(resumed.twice, resumed.after)
    assert.equal(resumed.remaining, 0)
    assert.equal(resumed.ready, saved.builds.player.skills.find(s => s.id === "meteor").ready_at)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("real scene rocks, mines, blades, lamps and healing produce distinct effects and save valid checkpoints", async () => {
  const h = await harness({ legacy: false, rules: 6 })
  try {
    await h.start()
    const result = await h.state(async c => {
      const { newBuild, newSkill } = await import("./skills.mjs")
      const s = c.scene, combat = s.combat
      s.setPaused(true); s.spawnAt = 1200000
      s.enemies.clear(true, true); s.bullets.clear(true, true); s.drops.clear(true, true)
      combat.zones = []
      combat.builds = { player: newBuild("player", "guardian", 6, "blade"), companion: newBuild("companion", "mage", 6, "thunder") }
      combat.builds.player.skills.push(newSkill("rune"), newSkill("stone"), newSkill("quake"))
      s.makeEnemy({ id: s.next(), kind: "brute", x: s.player.x + 84, y: s.player.y, hp: 5000 })
      const close = s.makeEnemy({ id: s.next(), kind: "brute", x: s.player.x + 10, y: s.player.y, hp: 5000 })
      for (const owner of ["player", "companion"]) for (const skill of combat.builds[owner].skills) skill.ready_at = 1200000
      for (const id of ["orbit", "rune", "stone"]) combat.shoot(s.player, "player", combat.skill("player", id))
      combat.skill("companion", "beacon").ready_at = 0
      combat.support(combat.skill("companion", "beacon"))
      combat.zones.find(z => z.kind === "beacon").tick_at = s.elapsed + 1000
      const textures = s.bullets.getChildren().map(b => b.texture.key), kinds = combat.zones.map(z => z.kind)
      const slow = Math.hypot(s.bullets.getFirstAlive().body.velocity.x, s.bullets.getFirstAlive().body.velocity.y)
      const before = close.getData("hp")
      s.elapsed += 499; combat.update(499); const unarmed = close.getData("hp")
      s.elapsed++; combat.update(1); const exploded = close.getData("hp")
      combat.builds.companion = newBuild("companion", "mage", 6, "frost")
      combat.zones = combat.zones.filter(z => z.owner === "player")
      s.hp = 70
      const healed = combat.support(combat.skill("companion", "heal"))
      combat.paint(); s.art.update()
      const saved = s.snapshot()
      await c.save()
      return { textures, kinds, slow, before, unarmed, exploded, healed, hp: s.hp, expectedHp: 70 + 12 * (1 + s.meta.bonus / 100), saved,
        persisted: (await c.api.read()).run.snapshot }
    })
    assert.ok(result.textures.includes("bolt-stone"))
    assert.ok(Math.abs(result.slow - 245) < .001)
    assert.deepEqual(result.kinds.sort(), ["beacon", "orbit", "rune"])
    assert.equal(result.unarmed, result.before)
    assert.ok(result.exploded < result.unarmed)
    assert.equal(result.healed, true); assert.equal(result.hp, result.expectedHp)
    assert.deepEqual(result.persisted, result.saved)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

for (const viewport of [{ width: 1280, height: 820 }, { width: 390, height: 844 }]) {
  test(`expanded route, effects and skill study render at ${viewport.width}px`, async () => {
    const h = await harness({ viewport, displayRules: 6 })
    try {
      await h.frame.locator("#player-class").selectOption("blade")
      await h.frame.locator("#partner-class").selectOption("thunder")
      await h.page.screenshot({ path: join(artifacts, `adventure-expanded-preparation-${viewport.width}.png`) })
      await h.frame.getByRole("button", { name: "进入林地", exact: true }).click()
      await h.frame.locator("#screen").waitFor({ state: "hidden" })
      await poll(() => h.state(c => !c.saving && !c.busy))
      await h.state(async c => {
        const { newSkill } = await import("./skills.mjs")
        const s = c.scene, combat = s.combat
        s.enemies.clear(true, true); s.bullets.clear(true, true); s.drops.clear(true, true)
        s.spawnAt = 1200000; s.hurtUntil = 1200000
        combat.builds.player.skills.push(newSkill("meteor"), newSkill("rune"))
        for (let i = 0; i < 10; i++) {
          const a = i / 10 * Math.PI * 2
          const point = s.terrain.safePoint({ x: s.player.x + Math.cos(a) * 115, y: s.player.y + Math.sin(a) * 115 })
          s.makeEnemy({ id: s.next(), kind: "brute", x: point.x, y: point.y, hp: 5000 })
        }
        combat.castManual(0); combat.castManual(1)
        combat.shoot(s.player, "player", combat.skill("player", "orbit"))
        combat.shoot(s.player, "player", combat.skill("player", "rune"))
        combat.support(combat.skill("companion", "beacon"))
        combat.shoot(s.companion, "companion", combat.skill("companion", "spark"))
        combat.paint(); s.art.update(); c.play(); s.activeRun = false; s.physics.world.pause()
      })
      await h.page.screenshot({ path: join(artifacts, `adventure-expanded-effects-${viewport.width}.png`) })
      const drawn = await h.state(c => ({ zones: c.scene.combat.zones.length, lines: c.scene.combat.expanded.lines.length,
        fits: document.documentElement.scrollWidth <= innerWidth }))
      const png = await h.frame.locator("canvas").screenshot()
      const colors = await h.page.evaluate(async base64 => {
        const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
        const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height
        const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0)
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data, colors = new Set()
        for (let i = 0; i < pixels.length; i += 204) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`)
        return colors.size
      }, png.toString("base64"))
      assert.ok(drawn.zones >= 4); assert.ok(drawn.lines > 0); assert.equal(drawn.fits, true); assert.ok(colors > 100)
      await h.state(c => {
        const s = c.scene
        s.activeRun = true; s.setPaused(false); s.xp = s.xpNeeded(); s.checkLevel()
      })
      await h.frame.locator(".upgrade").first().waitFor()
      await h.page.screenshot({ path: join(artifacts, `adventure-expanded-study-${viewport.width}.png`) })
      await h.frame.getByRole("button", { name: "技能图鉴", exact: true }).click()
      assert.equal(await h.frame.locator(".codex-row").count(), 16)
      await h.frame.getByRole("button", { name: "同行 · YUI", exact: true }).click()
      assert.equal(await h.frame.locator(".codex-row").count(), 14)
      assert.equal(await h.state(() => document.documentElement.scrollWidth <= innerWidth), true)
      assert.deepEqual(h.errors, [])
    } finally { await h.close() }
  })
}

test("expanded dense builds keep entity and visual budgets and persist without changing RNG while painting", async () => {
  const h = await harness({ legacy: false, rules: 6 })
  try {
    await h.start()
    const result = await h.state(async c => {
      const { newBuild, newSkill } = await import("./skills.mjs")
      const s = c.scene, combat = s.combat
      s.setPaused(true); s.spawnAt = 1200000
      s.enemies.clear(true, true); s.bullets.clear(true, true); s.drops.clear(true, true)
      combat.zones = []
      combat.builds = { player: newBuild("player", "guardian", 6, "blade"), companion: newBuild("companion", "mage", 6, "thunder") }
      combat.builds.player.skills.push(newSkill("spark"), newSkill("rune"), newSkill("meteor"))
      combat.builds.companion.skills.push(newSkill("rune"))
      for (let i = 0; i < 150; i++) {
        const a = i * 2.399, d = 20 + (i % 13) * 20
        const point = s.terrain.safePoint({ x: s.player.x + Math.cos(a) * d, y: s.player.y + Math.sin(a) * d })
        s.makeEnemy({ id: s.next(), kind: "brute", x: point.x, y: point.y, hp: 5000 })
      }
      combat.castManual(0); combat.castManual(1)
      let zones = 0, particles = 0, lines = 0
      for (let i = 0; i < 120; i++) {
        s.elapsed += 50; combat.update(50); s.art.update()
        zones = Math.max(zones, combat.zones.length)
        particles = Math.max(particles, s.art.particles.length)
        lines = Math.max(lines, combat.expanded.lines.length)
      }
      const before = JSON.stringify(s.snapshot()), rng = s.rng.state()
      for (let i = 0; i < 40; i++) { combat.paint(); s.art.update() }
      const stable = JSON.stringify(s.snapshot()) === before && s.rng.state() === rng
      await c.save()
      return { zones, particles, lines, stable, shots: s.bullets.countActive(), pending: c.api.pending,
        damage: combat.stats.player_damage + combat.stats.companion_damage }
    })
    assert.ok(result.zones <= 12 && result.particles <= 180 && result.lines <= 48 && result.shots <= 160)
    assert.ok(result.damage > 0); assert.equal(result.stable, true); assert.equal(result.pending, null)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("new automatic skills learned from upgrade cards attack for the correct owner", async () => {
  const h = await harness({ legacy: false })
  try {
    await h.start()
    assert.match(await learn(h, "wind:learn"), /自动攻击栏/)
    assert.equal(await h.frame.locator('.auto-skill[data-owner="player"][data-skill="wind"]').count(), 1)
    assert.match(await h.frame.locator('.skill-button[data-slot="1"]').getAttribute("aria-label"), /尚未学习主动技能/)
    await h.state(c => {
      const s = c.scene
      s.enemies.clear(true, true); s.bullets.clear(true, true)
      s.spawnAt = s.elapsed + 60000; s.hurtUntil = s.elapsed + 60000
      for (const build of Object.values(s.combat.builds)) for (const skill of build.skills) skill.ready_at = s.elapsed + 60000
      s.combat.skill("player", "wind").ready_at = 0
      s.makeEnemy({ id: s.next(), kind: "brute", x: s.player.x + 200, y: s.player.y, hp: 5000 })
    })
    await poll(() => h.state(c => c.scene.combat.stats.player_damage > 0))
    assert.ok(await h.state(c => c.scene.combat.skill("player", "wind").ready_at > 0))
    await learn(h, "slash:learn")
    const damage = await h.state(c => {
      const s = c.scene
      s.enemies.clear(true, true); s.bullets.clear(true, true)
      s.spawnAt = s.elapsed + 60000
      for (const build of Object.values(s.combat.builds)) for (const skill of build.skills) skill.ready_at = s.elapsed + 60000
      s.combat.skill("player", "slash").ready_at = 0
      s.makeEnemy({ id: s.next(), kind: "brute", x: s.player.x + 250, y: s.player.y, hp: 5000 })
      return s.combat.stats.player_damage
    })
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.equal(await h.state(c => c.scene.combat.skill("player", "slash").ready_at), 0)
    await poll(async () => await h.frame.locator('.auto-skill[data-owner="player"][data-skill="slash"] .auto-state').textContent() === "待近敌")
    await h.page.screenshot({ path: join(artifacts, "adventure-learned-auto-skills.png") })
    await h.state(c => c.scene.enemies.getFirstAlive().setPosition(c.scene.player.x + 70, c.scene.player.y))
    await poll(async () => await h.state(c => c.scene.combat.stats.player_damage) > damage)
    assert.equal(await h.state(c => c.scene.bullets.countActive()), 0)
    await learn(h, "fire:learn")
    const companionDamage = await h.state(c => {
      const s = c.scene
      s.enemies.clear(true, true); s.bullets.clear(true, true)
      s.spawnAt = s.elapsed + 60000
      for (const build of Object.values(s.combat.builds)) for (const skill of build.skills) skill.ready_at = s.elapsed + 60000
      s.combat.skill("companion", "fire").ready_at = 0
      s.makeEnemy({ id: s.next(), kind: "brute", x: s.companion.x - 180, y: s.companion.y, hp: 5000 })
      return s.combat.stats.companion_damage
    })
    await poll(async () => await h.state(c => c.scene.combat.stats.companion_damage) > companionDamage)
    assert.equal(await h.frame.locator('.auto-skill[data-owner="companion"][data-skill="fire"]').count(), 1)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("learning a second active skill through its card binds E, casts, and survives reopening", async () => {
  const h = await harness({ legacy: false })
  try {
    await h.start()
    assert.match(await learn(h, "dash:learn"), /E 主动/)
    await h.frame.locator('.skill-button[data-slot="1"]:not(:disabled)').waitFor()
    const before = await h.state(c => c.scene.player.x)
    await h.page.keyboard.press("e")
    assert.ok(await h.state(c => c.scene.player.x) > before + 100)
    const readyAt = await h.state(c => c.scene.combat.skill("player", "dash").ready_at)
    await h.frame.getByRole("button", { name: "暂停", exact: true }).click()
    await h.frame.getByRole("button", { name: "保存并返回", exact: true }).click()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).waitFor()
    await h.page.reload()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).click()
    await h.frame.locator("#screen").waitFor({ state: "hidden" })
    assert.match(await h.frame.locator('.skill-button[data-slot="1"]').getAttribute("aria-label"), /破阵突进/)
    assert.equal(await h.state(c => c.scene.combat.skill("player", "dash").ready_at), readyAt)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("learned close-range and active spells expose their conditions and execute on valid targets", async () => {
  const h = await harness({ legacy: false })
  try {
    await h.frame.locator("#player-class").selectOption("guardian")
    await h.start()
    await learn(h, "guard:learn")
    await h.state(c => {
      const s = c.scene
      s.enemies.clear(true, true); s.bullets.clear(true, true)
      s.spawnAt = s.elapsed + 5000; s.hurtUntil = s.elapsed + 5000
      for (const build of Object.values(s.combat.builds)) for (const skill of build.skills) skill.ready_at = s.elapsed + 5000
      s.combat.skill("player", "guard").ready_at = 0
      s.makeEnemy({ id: s.next(), kind: "brute", x: s.player.x + 70, y: s.player.y, hp: 5000 })
    })
    await poll(() => h.state(c => c.scene.combat.stats.player_damage > 0 && c.scene.combat.skill("player", "guard").ready_at > 0))
    assert.match(await learn(h, "flame:learn"), /学会后进入 E 槽/)
    await h.state(c => {
      const s = c.scene
      s.enemies.clear(true, true); s.bullets.clear(true, true)
      s.spawnAt = s.elapsed + 5000
    })
    await h.page.keyboard.press("e")
    await poll(async () => /范围内没有敌人/.test(await h.frame.locator("#notice").textContent()))
    assert.equal(await h.state(c => c.scene.combat.skill("player", "flame").ready_at), 0)
    const damage = await h.state(c => {
      const s = c.scene
      s.makeEnemy({ id: s.next(), kind: "brute", x: s.player.x + 200, y: s.player.y, hp: 5000 })
      return s.combat.stats.player_damage
    })
    await h.frame.locator('.skill-button[data-slot="1"]').click()
    await poll(() => h.state(c => c.scene.combat.zones.some(z => z.kind === "flame")))
    await poll(async () => await h.state(c => c.scene.combat.stats.player_damage) > damage)
    await h.state(c => {
      const s = c.scene
      s.player.setPosition(1765, 600); s.combat.facing = { x: 1, y: 0 }
      s.combat.skill("player", "dash").ready_at = 0
    })
    await h.page.keyboard.press("q")
    await poll(async () => /地图边界/.test(await h.frame.locator("#notice").textContent()))
    assert.equal(await h.state(c => c.scene.combat.skill("player", "dash").ready_at), 0)
    await h.frame.getByRole("button", { name: "暂停", exact: true }).click()
    await h.frame.getByRole("button", { name: "技能图鉴", exact: true }).click()
    assert.match(await h.frame.locator(".codex-list").textContent(), /E 主动.*无目标时不消耗冷却/s)
    assert.match(await h.frame.locator(".codex-list").textContent(), /进入近身范围/)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("canvas renders original sprites and a forest; keyboard movement and pause work", async () => {
  const h = await harness()
  try {
    await h.start()
    const before = await h.state(c => c.scene.player.x)
    await h.page.keyboard.down("d")
    await poll(async () => await h.state(c => c.scene.player.x) > before + 25)
    await h.page.keyboard.up("d")
    assert.ok(await h.state(c => c.scene.player.x) > before + 25)
    await h.frame.getByRole("button", { name: "暂停", exact: true }).click()
    const paused = await h.state(c => c.scene.elapsed)
    await new Promise(resolve => setTimeout(resolve, 250))
    assert.equal(await h.state(c => c.scene.elapsed), paused)
    await h.frame.getByRole("button", { name: "继续", exact: true }).click()
    await h.frame.locator("#screen").waitFor({ state: "hidden" })
    const png = await h.frame.locator("canvas").screenshot({ path: join(artifacts, "adventure-desktop.png") })
    const colors = await h.page.evaluate(async base64 => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height
      const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      const colors = new Set()
      for (let i = 0; i < pixels.length; i += 204) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`)
      return colors.size
    }, png.toString("base64"))
    assert.ok(colors > 35, `canvas has only ${colors} colors`)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("new builds have separate owner choices and save pending companion study exactly", async () => {
  const h = await harness({ legacy: false })
  try {
    await h.start()
    assert.equal(await h.state(c => c.scene.snapshot().rules), 3)
    for (const owner of ["player", "player", "companion"]) {
      await h.state(c => { c.scene.xp = c.scene.xpNeeded(); c.scene.checkLevel() })
      await h.frame.locator(".upgrade").first().waitFor()
      await poll(() => h.state(c => !c.saving && !c.api.pending && !c.busy))
      assert.equal(await h.state(c => c.scene.combat.studyOwner), owner)
      assert.equal(await h.frame.locator(`.upgrade[data-owner="${owner}"]`).count(), 3)
      if (owner === "companion") break
      await h.frame.locator(".upgrade").first().click()
      await h.frame.locator("#screen").waitFor({ state: "hidden" })
    }
    await h.frame.getByRole("button", { name: "重选 · 2", exact: true }).click()
    await poll(() => h.state(c => !c.saving && !c.api.pending))
    assert.equal(await h.state(c => c.scene.combat.rerolls), 1)
    const saved = await h.state(c => c.scene.snapshot())
    await h.page.screenshot({ path: join(artifacts, "adventure-study-companion.png") })
    await h.frame.getByRole("button", { name: "保存并返回", exact: true }).click()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).waitFor()
    await h.page.reload()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).click()
    await h.frame.locator(".upgrade").first().waitFor()
    const restored = await h.state(c => c.scene.snapshot())
    assert.deepEqual(restored, saved)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("Q creates a saved fire field; companion follows once and cooldown prevents duplicate support", async () => {
  const h = await harness({ legacy: false })
  try {
    await h.frame.locator("#player-class").selectOption("mage")
    await h.start()
    await h.state(c => {
      const s = c.scene, pull = s.combat.skill("companion", "pull")
      pull.level = 3; pull.focus = "power"; pull.branch = "follow"; pull.ready_at = 0
      s.makeEnemy({ id: s.next(), kind: "brute", x: s.player.x + 140, y: s.player.y, hp: 5000 })
    })
    await h.page.keyboard.press("q")
    assert.equal(await h.state(c => c.scene.combat.stats.followups), 1)
    assert.ok(await h.state(c => c.scene.combat.zones.some(z => z.kind === "flame")))
    await h.page.keyboard.press("q")
    assert.equal(await h.state(c => c.scene.combat.stats.followups), 1)
    await h.page.screenshot({ path: join(artifacts, "adventure-fire-followup.png") })
    await h.frame.getByRole("button", { name: "暂停", exact: true }).click()
    const saved = await h.state(c => c.scene.snapshot())
    await h.frame.getByRole("button", { name: "保存并返回", exact: true }).click()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).waitFor()
    await h.page.reload()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).click()
    await h.frame.locator("#screen").waitFor({ state: "hidden" })
    await h.frame.getByRole("button", { name: "暂停", exact: true }).click()
    const restored = await h.state(c => c.scene.snapshot())
    assert.deepEqual(restored.builds, saved.builds)
    assert.equal(restored.stats.followups, 1)
    assert.ok(restored.zones.some(z => z.kind === "flame"))
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("sword is an area slash, dash links armor, and paused keys cannot cast", async () => {
  const h = await harness({ legacy: false })
  try {
    await h.frame.locator("#player-class").selectOption("guardian")
    await h.frame.locator("#partner-class").selectOption("guardian")
    await h.start()
    const values = await h.state(c => {
      const s = c.scene
      const target = s.makeEnemy({ id: s.next(), kind: "brute", x: s.player.x + 80, y: s.player.y, hp: 5000 })
      const bullets = s.bullets.countActive(), hp = target.getData("hp")
      s.shoot(s.player, "player")
      const armor = s.combat.skill("companion", "armor")
      armor.level = 3; armor.focus = "power"; armor.branch = "follow"; armor.ready_at = 0
      return { bullets: s.bullets.countActive() - bullets, damage: hp - target.getData("hp"), x: s.player.x }
    })
    assert.equal(values.bullets, 0)
    assert.ok(values.damage > 0)
    await h.page.keyboard.press("q")
    assert.ok(await h.state(c => c.scene.player.x) > values.x + 100)
    assert.equal(await h.state(c => c.scene.combat.stats.followups), 1)
    assert.ok(await h.state(c => c.scene.shield) > 0)
    await h.frame.getByRole("button", { name: "暂停", exact: true }).click()
    const before = await h.state(c => c.scene.snapshot())
    await h.page.keyboard.press("q")
    assert.deepEqual(await h.state(c => c.scene.snapshot()), before)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("learning an E skill and a same-owner evolution update controls without losing the catalyst", async () => {
  const h = await harness({ legacy: false })
  try {
    await h.start()
    await h.state(async c => {
      const { applyChoice } = await import("./skills.mjs")
      const build = c.scene.combat.builds.player
      for (const key of ["dash:learn", "wind:learn", "wind:power", "fire:power", "fire:blast", "fire:deepen", "fire:fuse"]) {
        if (!applyChoice(build, "player", key)) throw new Error(`Illegal fixture ${key}`)
      }
      c.play()
      const s = c.scene
      s.makeEnemy({ id: s.next(), kind: "brute", x: s.player.x + 80, y: s.player.y, hp: 5000 })
    })
    await h.frame.locator('.skill-button[data-slot="1"]:not(:disabled)').waitFor()
    const before = await h.state(c => c.scene.player.x)
    await h.page.keyboard.press("e")
    assert.ok(await h.state(c => c.scene.player.x) > before + 100)
    await h.frame.getByRole("button", { name: "暂停", exact: true }).click()
    await h.frame.getByRole("button", { name: "技能图鉴", exact: true }).click()
    assert.match(await h.frame.locator(".codex-list").textContent(), /前置技能保留/)
    await h.frame.getByRole("button", { name: "返回", exact: true }).click()
    await h.frame.getByRole("button", { name: "保存并返回", exact: true }).click()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).waitFor()
    await h.page.reload()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).click()
    await h.frame.locator("#screen").waitFor({ state: "hidden" })
    assert.equal(await h.state(c => c.scene.combat.skill("player", "fire").evolution), "fusion")
    assert.equal(await h.state(c => c.scene.combat.skill("player", "wind").level), 2)
    assert.equal(await h.frame.locator(".skill-button").count(), 2)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("lost upgrade-save responses keep the chosen build paused and replay the same choice once", async () => {
  const h = await harness({ legacy: false })
  try {
    await h.start()
    await h.state(c => { c.scene.xp = c.scene.xpNeeded(); c.scene.checkLevel() })
    await poll(() => h.state(c => !c.saving && !c.api.pending))
    let dropped = false
    const ids = []
    await h.page.route("**/preview/action", async route => {
      const args = route.request().postDataJSON()
      if (args.operation === "checkpoint") {
        ids.push(args.request_id)
        const response = await route.fetch()
        if (!dropped) { dropped = true; await route.abort("failed"); return }
        await route.fulfill({ response }); return
      }
      await route.continue()
    })
    await h.frame.locator(".upgrade").first().click()
    await h.frame.getByRole("button", { name: "确认上次操作", exact: true }).waitFor()
    const selected = await h.state(c => c.scene.snapshot())
    assert.equal(await h.state(c => c.scene.paused), true)
    await h.frame.getByRole("button", { name: "确认上次操作", exact: true }).click()
    await h.frame.getByRole("button", { name: "继续", exact: true }).waitFor()
    assert.deepEqual(await h.state(c => c.scene.snapshot()), selected)
    assert.equal(ids.length, 2)
    assert.equal(ids[0], ids[1])
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("dense new builds keep effects bounded and save a valid checkpoint", async () => {
  const h = await harness({ legacy: false })
  try {
    await h.start()
    await h.state(async c => {
      const { applyChoice } = await import("./skills.mjs")
      const s = c.scene, build = s.combat.builds.player
      for (const key of ["wind:learn", "slash:learn", "fire:power", "fire:blast", "fire:deepen", "fire:fuse",
        "wind:haste", "wind:fan", "wind:deepen", "wind:awaken"]) applyChoice(build, "player", key)
      for (const key of ["ice:learn", "ice:power", "ice:rime", "ice:deepen", "ice:awaken"]) {
        applyChoice(s.combat.builds.companion, "companion", key)
      }
      s.level = 31; s.hurtUntil = 1200000
      for (let i = 0; i < 150; i++) {
        const a = i * Math.PI * 2 / 150
        s.makeEnemy({ id: s.next(), kind: "brute", x: s.player.x + Math.cos(a) * 250,
          y: s.player.y + Math.sin(a) * 250, hp: 5000 })
      }
      s.combat.castManual(0)
    })
    await poll(() => h.state(c => c.scene.elapsed > 700 && c.scene.combat.stats.player_damage > 0
      && c.scene.combat.frost.marks.size > 0))
    const values = await h.state(c => ({
      zones: c.scene.combat.zones.length, bullets: c.scene.bullets.countActive(),
      marks: c.scene.combat.frost.marks.size,
      hits: c.scene.combat.stats.player_damage, elapsed: c.scene.elapsed,
    }))
    assert.ok(values.hits > 0 && values.elapsed > 700, JSON.stringify(values))
    assert.ok(values.zones <= 12 && values.bullets <= 160)
    assert.ok(values.marks > 0 && values.marks <= 160)
    await h.frame.getByRole("button", { name: "暂停", exact: true }).click()
    await h.page.screenshot({ path: join(artifacts, "adventure-skills-density.png") })
    await h.frame.getByRole("button", { name: "保存并返回", exact: true }).click()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).waitFor()
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("new touch controls cast skills and keep the joystick and HUD apart at 390px", async () => {
  const h = await harness({ legacy: false, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  try {
    await h.frame.locator("#player-class").selectOption("mage")
    await h.start()
    for (const key of ["wind:learn", "slash:learn", "wind:power", "dash:learn"]) await learn(h, key)
    await h.state(c => {
      const s = c.scene
      s.makeEnemy({ id: s.next(), kind: "brute", x: s.player.x + 130, y: s.player.y, hp: 5000 })
    })
    await h.frame.locator('.skill-button[data-slot="0"]').click()
    assert.ok(await h.state(c => c.scene.combat.zones.some(z => z.kind === "flame")))
    const stick = await h.frame.locator("#joystick").boundingBox()
    const skills = await h.frame.locator("#skill-bar").boundingBox()
    assert.ok(stick.x + stick.width <= skills.x)
    const auto = await h.frame.locator("#auto-skills").boundingBox()
    assert.ok(auto.y + auto.height < stick.y && auto.y + auto.height < skills.y)
    assert.equal(await h.frame.locator('.auto-skill[data-owner="player"]').count(), 3)
    assert.equal(await h.state(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await h.frame.locator("#auto-skills").evaluate(node =>
      [...node.querySelectorAll(".auto-skill, .auto-name, .auto-state")].every(item =>
        item.scrollWidth <= item.clientWidth && item.scrollHeight <= item.clientHeight)), true)
    await h.page.screenshot({ path: join(artifacts, "adventure-skills-mobile.png") })
    await h.page.setViewportSize({ width: 844, height: 390 })
    try {
      await poll(() => h.state(() => {
        const canvas = document.querySelector("canvas"), box = canvas.getBoundingClientRect()
        return canvas.width === Math.round(box.width) && canvas.height === Math.round(box.height)
      }))
    } catch {
      assert.fail(`Canvas resize ${JSON.stringify(await h.state(c => {
        const canvas = document.querySelector("canvas"), box = canvas.getBoundingClientRect()
        return { buffer: [canvas.width, canvas.height], display: [box.width, box.height],
          camera: [c.scene.cameras.main.width, c.scene.cameras.main.height],
          parent: [canvas.parentElement.clientWidth, canvas.parentElement.clientHeight],
          scale: [c.scene.scale.width, c.scene.scale.height], paused: c.scene.paused }
      }))}`)
    }
    await h.state(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const compact = await h.frame.locator("#auto-skills").boundingBox()
    const landscapeStick = await h.frame.locator("#joystick").boundingBox()
    const landscapeSkills = await h.frame.locator("#skill-bar").boundingBox()
    assert.ok(compact.x > landscapeStick.x + landscapeStick.width)
    assert.ok(compact.x + compact.width < landscapeSkills.x)
    const notice = await h.frame.locator("#notice").boundingBox()
    assert.ok(notice.y + notice.height <= compact.y)
    assert.equal(await h.state(() => document.documentElement.scrollWidth <= innerWidth), true)
    await h.page.screenshot({ path: join(artifacts, "adventure-skills-landscape.png") })
    await h.state(c => { c.scene.xp = c.scene.xpNeeded(); c.scene.checkLevel() })
    await h.frame.locator(".upgrade").first().waitFor()
    assert.ok(await h.frame.locator(".study-next").count() > 0)
    assert.equal(await h.frame.locator("#notice").isVisible(), false)
    assert.equal(await h.state(() => document.documentElement.scrollWidth <= innerWidth), true)
    await h.frame.locator("#screen").evaluate(node => { node.scrollTop = 0 })
    await h.page.screenshot({ path: join(artifacts, "adventure-study-landscape.png") })
    await h.page.setViewportSize({ width: 390, height: 844 })
    await h.frame.locator(".upgrade").last().scrollIntoViewIfNeeded()
    assert.equal(await h.frame.locator(".upgrade").last().evaluate(node => {
      const box = node.getBoundingClientRect(), screen = document.getElementById("screen").getBoundingClientRect()
      return box.left >= screen.left && box.right <= screen.right && box.bottom <= screen.bottom
    }), true)
    await h.frame.locator("#screen").evaluate(node => { node.scrollTop = 0 })
    await h.page.screenshot({ path: join(artifacts, "adventure-study-mobile.png") })
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("Arcade collisions resolve companion attacks and shared experience upgrades", async () => {
  const h = await harness()
  try {
    await h.start()
    await h.state(c => {
      const s = c.scene
      s.makeEnemy({ id: s.next(), kind: "slime", x: s.companion.x - 35, y: s.companion.y, hp: 1 })
      s.shoot(s.companion, "companion")
    })
    await poll(() => h.state(c => c.scene.partnerKills > 0))
    await h.state(c => { c.scene.xp = c.scene.xpNeeded(); c.scene.checkLevel() })
    await h.frame.locator(".upgrade").first().waitFor()
    const choices = await h.state(c => c.scene.choices)
    assert.ok(choices.includes("partner") || choices.includes("ward"))
    const elapsed = await h.state(c => c.scene.elapsed)
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.equal(await h.state(c => c.scene.elapsed), elapsed)
    const selected = choices[0]
    await h.frame.locator(".upgrade").first().click()
    assert.equal((await h.state(c => c.scene.ranks))[selected], 1)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("save and reopen preserve actual enemy, rank, RNG and health state", async () => {
  const h = await harness()
  try {
    await h.start()
    await h.state(c => { c.scene.hp = 62; c.scene.ranks.power = 2; c.scene.spawn() })
    await h.frame.getByRole("button", { name: "暂停", exact: true }).click()
    const saved = await h.state(c => c.scene.snapshot())
    await h.frame.getByRole("button", { name: "保存并返回", exact: true }).click()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).waitFor()
    await h.page.reload()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).click()
    await h.frame.locator("#screen").waitFor({ state: "hidden" })
    await h.frame.getByRole("button", { name: "暂停", exact: true }).click()
    const restored = await h.state(c => c.scene.snapshot())
    assert.equal(restored.player.hp, saved.player.hp)
    assert.deepEqual(restored.ranks, saved.ranks)
    assert.equal(restored.rng, saved.rng)
    assert.equal(restored.enemies.length, saved.enemies.length)
    assert.ok(restored.elapsed >= saved.elapsed && restored.elapsed < saved.elapsed + 500)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("lost checkpoint response preserves request identity and retries without another save", async () => {
  const h = await harness()
  try {
    await h.start()
    let dropped = false
    const ids = []
    await h.page.route("**/preview/action", async route => {
      const args = route.request().postDataJSON()
      if (args.operation === "release") {
        ids.push(args.request_id)
        const response = await route.fetch()
        if (!dropped) { dropped = true; await route.abort("failed"); return }
        await route.fulfill({ response }); return
      }
      await route.continue()
    })
    await h.frame.getByRole("button", { name: "暂停", exact: true }).click()
    await h.frame.getByRole("button", { name: "保存并返回", exact: true }).click()
    await h.frame.getByRole("button", { name: "确认上次操作", exact: true }).waitFor()
    const revision = await h.state(c => c.api.view.revision)
    await h.frame.getByRole("button", { name: "确认上次操作", exact: true }).click()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).waitFor()
    assert.equal(ids.length, 2)
    assert.equal(ids[0], ids[1])
    assert.equal(await h.state(c => c.api.view.revision), revision + 1)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("blur pauses, death saves a terminal result and reopening never resumes a dead run", async () => {
  const h = await harness()
  try {
    await h.start()
    await h.state(() => window.dispatchEvent(new Event("blur")))
    await h.frame.getByRole("button", { name: "继续", exact: true }).waitFor()
    const elapsed = await h.state(c => c.scene.elapsed)
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.equal(await h.state(c => c.scene.elapsed), elapsed)
    await h.frame.getByRole("button", { name: "继续", exact: true }).click()
    await h.state(c => {
      const s = c.scene
      s.hp = 1; s.shield = 0; s.hurtUntil = 0
      s.makeEnemy({ id: s.next(), kind: "slime", x: s.player.x, y: s.player.y, hp: 100 })
    })
    await h.frame.getByRole("button", { name: "返回营地", exact: true }).waitFor()
    assert.equal(await h.state(c => c.scene.outcome), "defeated")
    await h.page.reload()
    await h.frame.getByRole("button", { name: "进入林地", exact: true }).waitFor()
    assert.equal(await h.frame.getByRole("button", { name: "继续旅程", exact: true }).count(), 0)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("390px touch viewport has no horizontal overflow and provides a working joystick", async () => {
  const h = await harness({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  try {
    assert.equal(await h.state(() => document.documentElement.scrollWidth <= innerWidth), true)
    await h.start()
    await h.frame.locator("#joystick").waitFor({ state: "visible" })
    const box = await h.frame.locator("#joystick").boundingBox()
    const before = await h.state(c => c.scene.player.x)
    await h.page.mouse.move(box.x + box.width - 12, box.y + box.height / 2)
    await h.page.mouse.down()
    try {
      await poll(async () => await h.state(c => c.scene.player.x) > before + 15)
    } finally { await h.page.mouse.up() }
    const movement = await h.state(c => ({ x: c.scene.player.x, paused: c.scene.paused, elapsed: c.scene.elapsed,
      touch: c.scene.touch, fps: c.scene.game.loop.actualFps, velocity: c.scene.player.body.velocity.x }))
    assert.ok(movement.x > before + 15, JSON.stringify({ before, ...movement }))
    await h.page.screenshot({ path: join(artifacts, "adventure-mobile.png") })
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("pending upgrade choices survive a reload and an explicit takeover", async () => {
  const h = await harness()
  try {
    await h.start()
    await h.state(c => { c.scene.xp = c.scene.xpNeeded(); c.scene.checkLevel() })
    await h.frame.locator(".upgrade").first().waitFor()
    await poll(() => h.state(c => !c.saving && !c.api.pending))
    const choices = await h.state(c => c.scene.choices)
    const rng = await h.state(c => c.scene.rng.state())
    await h.page.reload()
    h.page.once("dialog", dialog => dialog.accept())
    await h.frame.getByRole("button", { name: "接管此旅程", exact: true }).click()
    await h.frame.locator(".upgrade").first().waitFor()
    assert.deepEqual(await h.state(c => c.scene.choices), choices)
    assert.equal(await h.state(c => c.scene.rng.state()), rng)
    await h.page.screenshot({ path: join(artifacts, "adventure-upgrades.png") })
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("another window requires takeover and the original window cannot overwrite its progress", async () => {
  const h = await harness()
  try {
    await h.start()
    const other = await h.page.context().newPage()
    await other.goto(h.url)
    const otherFrame = other.frameLocator("#surface")
    other.once("dialog", dialog => dialog.accept())
    await otherFrame.getByRole("button", { name: "接管此旅程", exact: true }).click()
    await otherFrame.locator("#screen").waitFor({ state: "hidden" })
    await h.page.bringToFront()
    await h.state(c => c.pause(true))
    await h.frame.getByRole("button", { name: "保存并返回", exact: true }).click()
    await h.frame.getByRole("button", { name: "确认上次操作", exact: true }).waitFor()
    assert.equal(await h.state(async c => (await c.api.read()).owns_control), false)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("final boss spawns at eighteen minutes and its defeat saves a cleared result", async () => {
  const h = await harness()
  try {
    await h.start()
    await h.state(c => { c.scene.elapsed = 1080000 })
    await poll(() => h.state(c => c.scene.bossSpawned))
    await h.state(c => {
      const s = c.scene, boss = s.enemies.getChildren().find(e => e.getData("kind") === "boss")
      boss.setPosition(s.player.x + 65, s.player.y); boss.setData("hp", 1)
      s.shoot(s.player, "player")
    })
    await h.frame.getByRole("button", { name: "返回营地", exact: true }).waitFor()
    assert.equal(await h.state(c => c.scene.outcome), "cleared")
    assert.equal(await h.state(async c => (await c.api.read()).run.status), "ended")
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("fully upgraded builds keep playing instead of opening an empty choice screen", async () => {
  const h = await harness()
  try {
    await h.start()
    await h.state(c => {
      for (const key of Object.keys(c.scene.ranks)) c.scene.ranks[key] = key === "multishot" ? 3 : 8
      c.scene.xp = c.scene.xpNeeded(); c.scene.checkLevel()
    })
    assert.equal(await h.state(c => c.scene.paused), false)
    assert.deepEqual(await h.state(c => c.scene.choices), [])
    await h.frame.getByRole("button", { name: "暂停", exact: true }).click()
    await h.frame.getByRole("button", { name: "保存并返回", exact: true }).click()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).waitFor()
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("the static page also works in a standalone tab through the existing action endpoint", async () => {
  const h = await harness()
  try {
    await h.page.goto(`${h.url}/plugin/love_with_you/ui/index.html`)
    await h.page.getByRole("button", { name: "进入林地", exact: true }).click()
    await h.page.locator('[data-starter="fire"]').click()
    await h.page.locator('#screen-body[data-owner="companion"]').waitFor()
    await h.page.locator('[data-starter="wind"]').click()
    await h.page.locator("#screen").waitFor({ state: "hidden" })
    await h.page.getByRole("button", { name: "暂停", exact: true }).click()
    await h.page.getByRole("button", { name: "保存并返回", exact: true }).click()
    await h.page.getByRole("button", { name: "继续旅程", exact: true }).waitFor()
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("a failed journey earns coins and buying health changes the next start and survives reload", async () => {
  const h = await harness()
  try {
    await h.start()
    await h.state(c => { c.scene.elapsed = 420000; c.scene.hp = 0; c.scene.end("defeated") })
    await h.frame.locator(".reward-total").waitFor()
    assert.equal(await h.frame.locator(".reward-total").textContent(), "冒险金币 +42")
    await h.frame.getByRole("button", { name: "冒险商店", exact: true }).click()
    const product = h.frame.locator('[data-product="vitality"]')
    await product.locator(".buy-upgrade").click()
    await poll(() => h.state(c => c.api.view.economy.levels.vitality === 1 && !c.busy))
    assert.equal(await h.frame.locator(".wallet strong").textContent(), "2")
    await h.frame.getByRole("button", { name: "返回营地", exact: true }).click()
    await h.start()
    assert.equal(await h.state(c => c.scene.maxHp()), 104)
    assert.equal(await h.state(c => c.scene.hp), 104)
    await h.frame.getByRole("button", { name: "暂停", exact: true }).click()
    await h.frame.getByRole("button", { name: "保存并返回", exact: true }).click()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).waitFor()
    await h.page.reload()
    await h.frame.getByRole("button", { name: "冒险商店", exact: true }).click()
    assert.equal(await h.frame.locator(".buy-upgrade:not(:disabled)").count(), 0)
    assert.equal(await h.frame.locator(".refund-upgrade:not(:disabled)").count(), 0)
    await h.frame.getByRole("button", { name: "返回营地", exact: true }).click()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).click()
    await h.frame.locator("#screen").waitFor({ state: "hidden" })
    assert.equal(await h.state(c => c.scene.maxHp()), 104)
    assert.equal(await h.state(c => c.scene.meta.loadout.levels.vitality), 1)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("all four permanent upgrades affect actual combat values and stay fixed in a saved run", async () => {
  const h = await harness()
  try {
    await h.start()
    await h.state(c => { c.scene.elapsed = 1200000; c.scene.bossSpawned = true; c.scene.end("cleared") })
    await h.frame.locator(".reward-total").waitFor()
    await h.page.screenshot({ path: join(artifacts, "adventure-economy-result.png") })
    await h.frame.getByRole("button", { name: "冒险商店", exact: true }).click()
    for (const key of ["vitality", "power", "stride", "reach"]) {
      await h.frame.locator(`[data-product="${key}"] .buy-upgrade`).click()
      await poll(async () => {
        const current = await h.state(c => ({ levels: c.api.view.economy.levels, busy: c.busy }))
        return current.levels[key] === 1 && !current.busy
      })
    }
    assert.equal(await h.frame.locator(".wallet strong").textContent(), "40")
    await h.page.screenshot({ path: join(artifacts, "adventure-shop-desktop.png") })
    await h.frame.getByRole("button", { name: "返回营地", exact: true }).click()
    await h.start()
    await h.frame.getByRole("button", { name: "暂停", exact: true }).click()
    const values = await h.state(c => {
      const s = c.scene
      s.makeEnemy({ id: s.next(), kind: "slime", x: s.player.x + 60, y: s.player.y, hp: 100 })
      s.shoot(s.player, "player"); s.shoot(s.companion, "companion")
      return { hp: s.maxHp(), speed: s.moveSpeed(), pickup: s.pickupRange(), loadout: s.meta.loadout,
        playerDamage: s.bullets.getChildren().find(b => b.getData("owner") === "player").getData("damage"),
        partnerDamage: s.bullets.getChildren().find(b => b.getData("owner") === "companion").getData("damage") }
    })
    assert.equal(values.hp, 104)
    assert.ok(Math.abs(values.speed - 173.4) < .001)
    assert.ok(Math.abs(values.pickup - 63.6) < .001)
    assert.ok(Math.abs(values.playerDamage - 28.56) < .001)
    assert.ok(Math.abs(values.partnerDamage - 15.912) < .001)
    await h.frame.getByRole("button", { name: "保存并返回", exact: true }).click()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).waitFor()
    await h.page.reload()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).click()
    await h.frame.locator("#screen").waitFor({ state: "hidden" })
    assert.deepEqual(await h.state(c => c.scene.meta.loadout), values.loadout)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("lost finish, purchase and refund responses replay without duplicate income or charges", async () => {
  const h = await harness()
  try {
    await h.start()
    const calls = new Map(), dropped = new Set()
    await h.page.route("**/preview/action", async route => {
      const args = route.request().postDataJSON()
      if (["finish", "buy", "refund"].includes(args.operation)) {
        calls.set(args.operation, [...(calls.get(args.operation) || []), args.request_id])
        const response = await route.fetch()
        if (!dropped.has(args.operation)) { dropped.add(args.operation); await route.abort("failed"); return }
        await route.fulfill({ response }); return
      }
      await route.continue()
    })
    await h.state(c => { c.scene.elapsed = 420000; c.scene.end("retreated") })
    await h.frame.getByRole("button", { name: "确认上次操作", exact: true }).click()
    await h.frame.locator(".reward-total").waitFor()
    assert.equal(await h.frame.locator(".reward-total").textContent(), "冒险金币 +42")
    await h.frame.getByRole("button", { name: "冒险商店", exact: true }).click()
    await h.frame.locator('[data-product="vitality"] .buy-upgrade').click()
    await h.frame.getByRole("button", { name: "确认上次操作", exact: true }).click()
    await h.frame.locator('[data-product="vitality"] .refund-upgrade:not(:disabled)').waitFor()
    assert.equal(await h.frame.locator(".wallet strong").textContent(), "2")
    await h.frame.locator('[data-product="vitality"] .refund-upgrade').click()
    await h.frame.getByRole("button", { name: "确认上次操作", exact: true }).click()
    await poll(() => h.state(c => c.api.view.economy.balance === 42 && !c.busy))
    for (const operation of ["finish", "buy", "refund"]) {
      assert.equal(calls.get(operation).length, 2)
      assert.equal(calls.get(operation)[0], calls.get(operation)[1])
    }
    await h.page.reload()
    await h.frame.getByRole("button", { name: "冒险商店", exact: true }).click()
    assert.equal(await h.frame.locator(".wallet strong").textContent(), "42")
    assert.equal(await h.state(c => c.api.view.economy.levels.vitality), 0)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("a confirmed purchase followed by a failed refresh only retries the read", async () => {
  const h = await harness()
  try {
    await h.start()
    await h.state(c => { c.scene.elapsed = 420000; c.scene.end("retreated") })
    await h.frame.getByRole("button", { name: "冒险商店", exact: true }).click()
    let purchases = 0, failRead = false
    await h.page.route("**/preview/action", async route => {
      const args = route.request().postDataJSON()
      if (args.operation === "buy") { purchases++; failRead = true }
      if (args.operation === "read" && failRead) { failRead = false; await route.abort("failed"); return }
      await route.continue()
    })
    await h.frame.locator('[data-product="vitality"] .buy-upgrade').click()
    await h.frame.getByRole("button", { name: "重新读取商店", exact: true }).waitFor()
    assert.equal(await h.state(c => c.api.pending), null)
    assert.match(await h.frame.locator("#save-state").textContent(), /交易已保存/)
    await h.frame.getByRole("button", { name: "重新读取商店", exact: true }).click()
    await h.frame.locator(".shop-row").first().waitFor()
    assert.equal(purchases, 1)
    assert.equal(await h.frame.locator(".wallet strong").textContent(), "2")
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("the mobile shop scrolls without horizontal overflow and supports full-price refunds", async () => {
  const h = await harness({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  try {
    await h.start()
    await h.state(c => { c.scene.elapsed = 420000; c.scene.end("retreated") })
    await h.frame.getByRole("button", { name: "冒险商店", exact: true }).click()
    const product = h.frame.locator('[data-product="reach"]')
    await product.locator(".buy-upgrade").click()
    await poll(() => h.state(c => c.api.view.economy.levels.reach === 1 && !c.busy))
    assert.equal(await h.state(() => document.documentElement.scrollWidth <= innerWidth), true)
    await h.frame.locator("#screen").evaluate(node => { node.scrollTop = 0 })
    await h.page.screenshot({ path: join(artifacts, "adventure-shop-mobile.png") })
    await product.locator(".refund-upgrade").click()
    await poll(() => h.state(c => c.api.view.economy.levels.reach === 0 && !c.busy))
    assert.equal(await h.frame.locator(".wallet strong").textContent(), "42")
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("ice and frost learned through real cards attack, bind E and connect companion frost to player sword", async () => {
  const h = await harness({ legacy: false })
  try {
    await h.frame.locator("#player-class").selectOption("guardian")
    await h.start()
    assert.match(await learn(h, "ice:learn"), /自动攻击栏/)
    assert.match(await learn(h, "frost:learn"), /E 主动/)
    await learn(h, "ice:learn")
    await h.state(c => {
      const s = c.scene
      s.enemies.clear(true, true); s.bullets.clear(true, true); s.combat.frost.marks.clear()
      s.spawnAt = 1200000; s.hurtUntil = 1200000
      for (const build of Object.values(s.combat.builds)) for (const skill of build.skills) skill.ready_at = 1200000
      s.combat.skill("companion", "ice").ready_at = 0
      s.makeEnemy({ id: s.next(), kind: "brute", x: s.companion.x + 210, y: s.companion.y, hp: 5000 })
    })
    await poll(() => h.state(c => [...c.scene.combat.frost.marks.values()].some(m => m.source === "companion" && m.stacks)))
    const combo = await h.state(c => {
      const s = c.scene, combat = s.combat, enemy = s.enemies.getFirstAlive()
      s.setPaused(true); s.bullets.clear(true, true)
      enemy.setPosition(s.player.x + 100, s.player.y)
      const before = { ...combat.stats }, hp = enemy.getData("hp")
      combat.melee("player", combat.skill("player", "slash"), enemy)
      const once = { ...combat.stats }, after = enemy.getData("hp")
      combat.melee("player", combat.skill("player", "slash"), enemy)
      return { before, once, twice: combat.stats, firstDamage: hp - after, secondDamage: after - enemy.getData("hp") }
    })
    assert.ok(combo.before.companion_damage > 0)
    assert.equal(combo.once.shatters, combo.before.shatters + 1)
    assert.equal(combo.once.cross_shatters, combo.before.cross_shatters + 1)
    assert.equal(combo.twice.shatters, combo.once.shatters)
    assert.ok(combo.firstDamage > combo.secondDamage)
    await h.state(c => {
      const s = c.scene
      s.enemies.clear(true, true); s.combat.frost.marks.clear()
      s.combat.skill("player", "frost").ready_at = 0
      c.play()
    })
    await h.page.keyboard.press("e")
    await poll(async () => /霜爆范围内没有敌人/.test(await h.frame.locator("#notice").textContent()))
    assert.equal(await h.state(c => c.scene.combat.skill("player", "frost").ready_at), 0)
    await h.state(c => {
      const s = c.scene
      s.makeEnemy({ id: s.next(), kind: "brute", x: s.player.x + 220, y: s.player.y, hp: 5000 })
    })
    await h.page.keyboard.press("e")
    await poll(() => h.state(c => c.scene.combat.skill("player", "frost").ready_at > c.scene.elapsed))
    assert.ok(await h.state(c => [...c.scene.combat.frost.marks.values()].some(m => m.source === "player" && m.stacks === 2)))
    assert.match(await h.frame.locator("#notice").textContent(), /霜爆 · 已施放/)
    await poll(async () => /秒/.test(await h.frame.locator('.skill-button[data-slot="1"] .skill-cooldown').textContent()))
    await h.page.screenshot({ path: join(artifacts, "adventure-frost-combo.png") })
    await h.frame.getByRole("button", { name: "暂停", exact: true }).click()
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("frost marks, freeze immunity, sword cooldown, mist ticks and awakened projectiles survive reopening", async () => {
  const h = await harness({ legacy: false })
  try {
    await h.start()
    await h.state(async c => {
      const { applyChoice } = await import("./skills.mjs")
      const s = c.scene, combat = s.combat
      s.setPaused(true); s.enemies.clear(true, true); s.bullets.clear(true, true)
      s.spawnAt = 1200000; s.hurtUntil = 1200000
      for (const key of ["ice:learn", "ice:power", "ice:rime", "ice:deepen", "ice:awaken", "frost:learn", "frost:power", "frost:mist"]) {
        assertChoice(applyChoice(combat.builds.player, "player", key), key)
      }
      for (const key of ["ice:learn", "ice:power", "ice:rime"]) assertChoice(applyChoice(combat.builds.companion, "companion", key), key)
      function assertChoice(ok, key) { if (!ok) throw new Error(key) }
      const a = s.makeEnemy({ id: s.next(), kind: "brute", x: s.player.x + 220, y: s.player.y, hp: 5000 })
      const b = s.makeEnemy({ id: s.next(), kind: "boss", x: s.player.x + 245, y: s.player.y + 10, hp: 5000 })
      combat.frost.apply(a, "companion", combat.skill("companion", "ice"), 3)
      combat.frost.apply(b, "companion", combat.skill("companion", "ice"), 3)
      combat.frost.strike(b, "player", "slash", 30)
      combat.frost.apply(b, "companion", combat.skill("companion", "ice"), 2)
      combat.shoot(s.player, "player", combat.skill("player", "ice"))
      c.play(); combat.castManual(1); s.setPaused(true)
      for (const build of Object.values(combat.builds)) for (const skill of build.skills) skill.ready_at = 1200000
      combat.update(0)
      s.bullets.getFirstAlive().setVelocity(0, 0)
      c.pause(true)
    })
    const saved = await h.state(c => c.scene.snapshot())
    assert.ok(saved.frosts.some(mark => mark.frozen_until > saved.elapsed))
    assert.equal(saved.frosts.find(mark => mark.target === saved.enemies.find(e => e.kind === "boss").id).frozen_until, 0)
    assert.equal(saved.bullets[0].form, "awakened")
    assert.ok(saved.zones.some(zone => zone.kind === "frost"))
    await h.frame.getByRole("button", { name: "保存并返回", exact: true }).click()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).waitFor()
    await h.page.reload()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).click()
    await h.frame.locator("#screen").waitFor({ state: "hidden" })
    await h.state(c => c.pause(true))
    const restored = await h.state(c => c.scene.snapshot())
    assert.deepEqual(restored.stats, saved.stats)
    assert.deepEqual(restored.frosts, saved.frosts)
    assert.equal(restored.shatter_at, saved.shatter_at)
    assert.ok(restored.frosts.every(mark => mark.freeze_at === saved.frosts.find(m => m.target === mark.target).freeze_at))
    assert.equal(restored.bullets[0].form, "awakened")
    assert.equal(await h.state(c => c.scene.bullets.getFirstAlive().texture.key), "bolt-awakened")
    assert.equal(restored.zones[0].tick_at, saved.zones[0].tick_at)
    const check = await h.state(c => {
      const s = c.scene, combat = s.combat
      const boss = s.enemies.getChildren().find(e => e.getData("kind") === "boss")
      boss.setVelocity(100, 0); combat.frost.update()
      const velocity = boss.body.velocity.x
      const before = combat.stats.shatters
      combat.frost.strike(boss, "player", "dash", 30)
      return { velocity, before, after: combat.stats.shatters }
    })
    assert.ok(check.velocity >= 88 && check.velocity < 100)
    assert.equal(check.after, check.before)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("frost branches consume stacks once or add timed mist and awakening expands control", async () => {
  const h = await harness({ legacy: false })
  try {
    await h.start()
    const values = await h.state(async c => {
      const { newSkill } = await import("./skills.mjs")
      const s = c.scene, combat = s.combat
      s.setPaused(true); s.enemies.clear(true, true); s.bullets.clear(true, true)
      s.spawnAt = 1200000; s.hurtUntil = 1200000
      const frost = { ...newSkill("frost"), level: 3, focus: "power", branch: "shatter" }
      combat.builds.player.skills[1] = frost
      const a = s.makeEnemy({ id: s.next(), kind: "brute", x: s.player.x + 200, y: s.player.y, hp: 5000 })
      combat.frost.apply(a, "player", frost, 3)
      c.play(); combat.castManual(0); s.setPaused(true)
      const first = 5000 - a.getData("hp"), stacks = combat.frost.marks.get(a.getData("id")).stacks
      combat.frost.marks.clear(); a.setData("hp", 5000); frost.ready_at = 0
      c.play(); combat.castManual(0); s.setPaused(true)
      const plain = 5000 - a.getData("hp")
      frost.branch = "mist"; frost.ready_at = 0
      c.play(); combat.castManual(0); s.setPaused(true)
      const zone = combat.zones.find(z => z.kind === "frost")
      combat.update(0)
      const tick1 = a.getData("hp"), nextTick = zone.tick_at
      combat.update(0)
      const sameTick = a.getData("hp")
      s.elapsed += 1000; combat.update(0)
      const tick2 = a.getData("hp")
      frost.level = 5; frost.evolution = "pure"; frost.ready_at = 0
      combat.frost.marks.clear()
      c.play(); combat.castManual(0); s.setPaused(true)
      return { first, plain, stacks, tick1, sameTick, tick2, nextTick, now: s.elapsed,
        awakened: combat.frost.marks.get(a.getData("id")), radius: combat.zones.at(-1).radius,
        shatters: combat.stats.shatters }
    })
    assert.ok(values.first > values.plain + 30)
    assert.equal(values.stacks, 1)
    assert.equal(values.tick1, values.sameTick)
    assert.ok(values.tick2 < values.sameTick)
    assert.equal(values.awakened.stacks, 3)
    assert.ok(values.awakened.frozen_until > values.now)
    assert.equal(values.radius, 145)
    assert.equal(values.shatters, 0)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("new sword widths, circle guard, four-target pull and first-hit fusion affect real enemies", async () => {
  const h = await harness({ legacy: false })
  try {
    await h.start()
    const values = await h.state(async c => {
      const { newSkill } = await import("./skills.mjs")
      const s = c.scene, combat = s.combat
      s.setPaused(true); s.enemies.clear(true, true); s.bullets.clear(true, true)
      s.spawnAt = 1200000; s.hurtUntil = 1200000
      const skill = (id, branch, evolution = "pure") => ({ ...newSkill(id), level: 5, focus: "power", branch, evolution })
      const enemy = (dx, dy) => s.makeEnemy({ id: s.next(), kind: "brute", x: s.player.x + dx, y: s.player.y + dy, hp: 5000 })
      const back = enemy(-100, 0), front = enemy(100, 0), guard = skill("guard", "counter")
      combat.builds.player.skills = [guard, skill("dash", "line")]
      combat.melee("player", guard, front)
      const circle = back.getData("hp") < 5000
      s.enemies.clear(true, true)
      const wide = enemy(100, 100), outside = enemy(100, 115)
      c.play(); combat.castManual(0); s.setPaused(true)
      const dash = [wide.getData("hp") < 5000, outside.getData("hp") === 5000]
      s.enemies.clear(true, true)
      for (let i = 0; i < 5; i++) enemy(50 + i * 10, 0)
      const pull = skill("pull", "hunt"); combat.builds.companion.skills[1] = pull
      combat.support(pull, s.enemies.getFirstAlive())
      const targets = combat.zones.find(z => z.kind === "pull").targets.length
      s.enemies.clear(true, true); combat.zones = []
      combat.builds.player.skills = [skill("fire", "volley", "fusion"), { ...newSkill("wind"), level: 2, focus: "power" }, newSkill("flame")]
      const first = enemy(100, 0), second = enemy(135, 0), third = enemy(170, 0)
      combat.shoot(s.player, "player", combat.skill("player", "fire"))
      const bolt = s.bullets.getFirstAlive(); bolt.setPosition(first.x, first.y)
      c.play(); combat.hit(bolt, first); s.setPaused(true)
      const afterFirst = third.getData("hp")
      bolt.setPosition(second.x, second.y)
      c.play(); combat.hit(bolt, second); s.setPaused(true)
      const noRepeatSplash = third.getData("hp") === afterFirst
      s.bullets.clear(true, true)
      combat.builds.player.skills[0] = skill("slash", "cleave", "fusion")
      const count = s.bullets.countActive()
      combat.melee("player", combat.skill("player", "slash"), first)
      return { circle, dash, targets, noRepeatSplash, echo: s.bullets.countActive() === count + 1,
        shatters: combat.stats.shatters }
    })
    assert.equal(values.circle, true)
    assert.deepEqual(values.dash, [true, true])
    assert.equal(values.targets, 4)
    assert.equal(values.noRepeatSplash, true)
    assert.equal(values.echo, true)
    assert.equal(values.shatters, 0)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("rule2 retains the frozen catalog, original geometry and exact saved candidates", async () => {
  const h = await harness({ legacy: false, rules: 2 })
  try {
    await h.start()
    const choices = await h.state(async c => {
      const { legalChoices, applyChoice, parameters } = await import("./skills.mjs")
      const s = c.scene, build = s.combat.builds.player
      for (const key of ["dash:learn", "dash:power", "dash:line", "dash:deepen", "dash:awaken"]) applyChoice(build, "player", key)
      if (parameters(s.combat.skill("player", "dash"), build).width !== 60) throw new Error("old geometry changed")
      const legal = legalChoices(build, "player")
      s.xp = s.xpNeeded(); s.checkLevel()
      return legal
    })
    assert.ok(!choices.some(key => /^(ice|frost):/.test(key)))
    await poll(() => h.state(c => !c.saving && !c.api.pending))
    const saved = await h.state(c => c.scene.snapshot())
    await h.frame.getByRole("button", { name: "技能图鉴", exact: true }).click()
    assert.doesNotMatch(await h.frame.locator(".codex-list").textContent(), /冰针|霜爆/)
    await h.frame.getByRole("button", { name: "返回", exact: true }).click()
    await h.frame.getByRole("button", { name: "保存并返回", exact: true }).click()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).waitFor()
    await h.page.reload()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).click()
    await h.frame.locator(".upgrade").first().waitFor()
    assert.deepEqual(await h.state(c => c.scene.snapshot()), saved)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("killing the boss stops a multi-target sword before more frost contributions or damage", async () => {
  const h = await harness({ legacy: false })
  try {
    await h.frame.locator("#player-class").selectOption("guardian")
    await h.start()
    await h.state(async c => {
      const { applyChoice } = await import("./skills.mjs")
      const s = c.scene, combat = s.combat
      s.setPaused(true); s.enemies.clear(true, true); s.bullets.clear(true, true)
      s.elapsed = 1080000; s.bossSpawned = true; s.spawnAt = 1200000
      applyChoice(combat.builds.companion, "companion", "ice:learn")
      const boss = s.makeEnemy({ id: s.next(), kind: "boss", x: s.player.x + 70, y: s.player.y, hp: 1 })
      const other = s.makeEnemy({ id: s.next(), kind: "brute", x: s.player.x + 80, y: s.player.y, hp: 5000 })
      combat.frost.apply(other, "companion", combat.skill("companion", "ice"), 3)
      combat.melee("player", combat.skill("player", "slash"), boss)
    })
    await h.frame.getByRole("button", { name: "返回营地", exact: true }).waitFor()
    const terminal = await h.state(c => ({ current: c.scene.snapshot(), saved: c.api.view.run.snapshot }))
    assert.deepEqual(terminal.current, terminal.saved)
    assert.equal(terminal.saved.stats.shatters, 0)
    assert.equal(terminal.saved.enemies[0].hp, 5000)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("rule4 milestone death grants normal study then one saved cooperation that resumes exactly", async () => {
  const h = await harness({ legacy: false, rules: 4 })
  try {
    await h.start()
    assert.equal(await h.state(c => c.scene.snapshot().rules), 4)
    await h.state(c => {
      const s = c.scene
      s.elapsed = 360000; s.encounters.spawn()
      const sentinel = s.enemies.getChildren().find(e => e.getData("kind") === "sentinel")
      sentinel.setData("hp", 1)
      s.combat.deal(sentinel, 20, "player")
    })
    await poll(() => h.state(c => c.scene.encounters.state.milestones.sentinel.defeated))
    await h.frame.locator(".upgrade").first().waitFor()
    assert.equal(await h.state(c => c.scene.encounters.state.milestones.sentinel.defeated), true)
    await poll(() => h.state(c => !c.saving && !c.api.pending))
    await h.frame.locator(".upgrade").first().click()
    await h.frame.locator('[data-cooperation]').first().waitFor()
    await poll(() => h.state(c => !c.saving && !c.api.pending && !c.busy))
    assert.equal(await h.frame.locator('[data-cooperation]').count(), 3)
    const candidates = await h.state(c => c.scene.encounters.state.choices)
    const pending = await h.state(c => c.scene.snapshot())
    assert.equal(pending.encounters.pending, "sentinel")
    assert.deepEqual(pending.encounters.choices, candidates)
    await h.frame.getByRole("button", { name: "保存并返回", exact: true }).click()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).waitFor()
    await h.page.reload()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).click()
    await h.frame.locator('[data-cooperation]').first().waitFor()
    await poll(() => h.state(c => !c.saving && !c.api.pending && !c.busy))
    assert.deepEqual(await h.state(c => c.scene.encounters.state.choices), candidates)
    await h.frame.locator(`[data-cooperation="${candidates[0]}"]`).click()
    await h.frame.locator("#screen").waitFor({ state: "hidden" })
    assert.equal(await h.state(c => c.scene.encounters.state.resolved[0]), "sentinel")
    assert.equal(await h.state(c => c.scene.encounters.state.selected.length), 1)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("charger and caster telegraphs are dodgeable, deal bounded damage, and restore before impact", async () => {
  const h = await harness({ legacy: false, rules: 4 })
  try {
    await h.start()
    const value = await h.state(c => {
      const s = c.scene, encounters = s.encounters
      s.elapsed = 10000; s.hurtUntil = 0; s.hp = 100; s.shield = 0
      const charger = s.makeEnemy({ id: s.next(), kind: "charger", x: s.player.x + 260, y: s.player.y, hp: 48 })
      const chargerAi = encounters.foes.get(charger.getData("id")); chargerAi.ready_at = 0
      encounters.prepare(charger, chargerAi)
      const line = encounters.threats[0], target = { x: line.ex, y: line.ey }
      s.player.setPosition(s.player.x, s.player.y + 140)
      s.elapsed = line.trigger_at; encounters.update()
      const dodged = s.hp
      const caster = s.makeEnemy({ id: s.next(), kind: "caster", x: s.player.x + 300, y: s.player.y, hp: 36 })
      const casterAi = encounters.foes.get(caster.getData("id")); casterAi.ready_at = 0
      encounters.prepare(caster, casterAi)
      const circle = encounters.threats.find(t => t.source === caster.getData("id"))
      const hp = s.hp
      s.elapsed = circle.trigger_at; encounters.update()
      encounters.threats = []
      encounters.prepare(caster, casterAi)
      s.setPaused(true)
      return { dodged, hp, after: s.hp, target, circle, state: s.snapshot(), chargerId: charger.getData("id") }
    })
    assert.equal(value.dodged, 100)
    assert.equal(value.after, value.hp - 13)
    assert.ok(value.target && value.circle.kind === "circle")
    assert.equal(value.state.threats.some(t => t.source === value.chargerId), false)
    await h.state(c => c.pause(true))
    await h.frame.getByRole("button", { name: "保存并返回", exact: true }).waitFor({ timeout: 3000 })
    await h.frame.getByRole("button", { name: "保存并返回", exact: true }).click()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).waitFor()
    await h.page.reload()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).click()
    await h.frame.locator("#screen").waitFor({ state: "hidden" })
    const restored = await h.state(c => c.scene.snapshot())
    assert.deepEqual(restored.threats, value.state.threats)
    assert.equal(restored.foes.length, value.state.foes.length)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("milestone breaks grant a short wave respite and the final boss has a readable second phase", async () => {
  const h = await harness({ legacy: false, rules: 4 })
  try {
    await h.start()
    const bossState = await h.state(c => {
      const s = c.scene, encounters = s.encounters
      s.setPaused(true); s.enemies.clear(true, true); encounters.foes.clear(); encounters.threats = []
      encounters.state.milestones.sentinel = { spawned: true, defeated: true, enemy: 0 }
      encounters.state.milestones.oracle = { spawned: true, defeated: true, enemy: 0 }
      encounters.state.resolved = ["sentinel", "oracle"]; encounters.state.selected = ["cadence", "warmth"]
      s.elapsed = 1080000; s.bossSpawned = false; s.spawnAt = 1200000; c.lastSaved = s.elapsed; encounters.spawn()
      const boss = s.enemies.getChildren().find(e => e.getData("kind") === "boss")
      const ai = encounters.foes.get(boss.getData("id"))
      boss.setData("hp", 1500); ai.step = 1
      s.setPaused(false); encounters.update()
      encounters.prepare(boss, ai)
      encounters.updateHud()
      return { hp: boss.getData("hp"), phase: ai.phase, count: encounters.threats.length,
        paused: s.paused, outcome: s.outcome, active: s.activeRun, snapshot: s.snapshot() }
    })
    assert.equal(bossState.phase, 2)
    assert.equal(bossState.count, 3)
    assert.equal(bossState.hp, 1500)
    assert.ok(await h.frame.locator("#encounter-status .encounter-name").textContent().then(text => /第二阶段/.test(text)))
    assert.ok(await h.frame.locator("#encounter-status .encounter-fill").evaluate(node => parseFloat(node.style.width) > 0))
    await h.state(c => { c.scene.setPaused(true); c.pause(true) })
    await h.frame.getByRole("button", { name: "保存并返回", exact: true }).waitFor({ timeout: 3000 })
    await h.frame.getByRole("button", { name: "保存并返回", exact: true }).click()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).waitFor()
    await h.page.reload()
    await h.frame.getByRole("button", { name: "继续旅程", exact: true }).click()
    await h.frame.locator("#screen").waitFor({ state: "hidden" })
    const resumed = await h.state(c => c.scene.snapshot())
    assert.equal(resumed.foes.find(foe => foe.target === resumed.enemies.find(e => e.kind === "boss").id).phase, 2)
    assert.equal(resumed.threats.length, 3)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("a lost cooperation acknowledgement retries the chosen reward without granting another one", async () => {
  const h = await harness({ legacy: false, rules: 4 })
  try {
    await h.start()
    await h.state(c => {
      const s = c.scene
      s.level = 31; s.elapsed = 360000; s.encounters.spawn()
      const enemy = s.enemies.getChildren().find(e => e.getData("kind") === "sentinel")
      s.combat.deal(enemy, 10000, "player")
    })
    await h.frame.locator("[data-cooperation]").first().waitFor()
    await poll(() => h.state(c => !c.saving && !c.api.pending && !c.busy))
    const ids = []
    let dropped = false
    await h.page.route("**/preview/action", async route => {
      const args = route.request().postDataJSON()
      if (args.operation !== "checkpoint") return route.continue()
      ids.push(args.request_id)
      const response = await route.fetch()
      if (!dropped) { dropped = true; return route.abort("failed") }
      await route.fulfill({ response })
    })
    await h.frame.locator("[data-cooperation]").first().click()
    await h.frame.getByRole("button", { name: "确认上次操作", exact: true }).waitFor()
    const selected = await h.state(c => c.scene.encounters.data())
    assert.equal(selected.encounters.selected.length, 1)
    await h.frame.getByRole("button", { name: "确认上次操作", exact: true }).click()
    await h.frame.getByRole("button", { name: "继续", exact: true }).waitFor()
    assert.deepEqual(await h.state(c => c.scene.encounters.data()), selected)
    assert.equal(ids.length, 2)
    assert.equal(ids[0], ids[1])
    await h.frame.getByRole("button", { name: "技能图鉴", exact: true }).click()
    await h.frame.getByRole("button", { name: "返回", exact: true }).click()
    await h.frame.getByRole("button", { name: "继续", exact: true }).waitFor()
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("cooperations affect actual spell cooldowns, support healing, damage and companion shatter", async () => {
  const h = await harness({ legacy: false, rules: 4 })
  try {
    await h.start()
    const result = await h.state(async c => {
      const { applyChoice, parameters } = await import("./skills.mjs")
      const s = c.scene, combat = s.combat, selected = s.encounters.state.selected
      s.setPaused(true); s.enemies.clear(true, true); s.bullets.clear(true, true)
      s.elapsed = 10000; s.hp = 50
      const enemy = s.makeEnemy({ id: s.next(), kind: "brute", x: s.player.x + 80, y: s.player.y, hp: 5000 })
      const base = combat.damage("companion", 100)
      s.encounters.state.selected = ["escort"]
      const boosted = combat.damage("companion", 100)
      s.encounters.state.selected = ["cadence"]
      const flame = combat.skill("player", "flame"), p = parameters(flame, combat.builds.player)
      flame.ready_at = 0; s.paused = false
      const cast = combat.castManual(0), cooldown = flame.ready_at - s.elapsed
      s.encounters.state.selected = ["warmth"]
      const pull = combat.skill("companion", "pull")
      pull.ready_at = 0
      const supported = combat.support(pull, enemy), healed = s.hp
      const repeated = combat.support(pull, enemy), afterRepeat = s.hp
      s.encounters.state.selected = ["embers"]
      combat.zones = []; pull.ready_at = 0
      combat.support(pull, enemy)
      const radius = combat.zones[0].radius, normalRadius = parameters(pull, combat.builds.companion).radius
      combat.zones = []; flame.ready_at = 0
      combat.castManual(0)
      const flameDamage = combat.zones[0].damage, normalDamage = combat.damage("player", p.damage)
      applyChoice(combat.builds.player, "player", "slash:learn")
      applyChoice(combat.builds.companion, "companion", "ice:learn")
      s.encounters.state.selected = ["rime"]
      combat.frost.apply(enemy, "companion", combat.skill("companion", "ice"), 3)
      const shatter = combat.frost.strike(enemy, "player", "slash", 0)
      s.encounters.state.selected = selected; s.setPaused(true)
      return { base, boosted, cast, cooldown, normalCooldown: p.cooldown, supported, healed, repeated,
        afterRepeat, radius, normalRadius, flameDamage, normalDamage, shatter,
        expectedShatter: combat.damage("player", 45), cross: combat.stats.cross_shatters }
    })
    assert.ok(Math.abs(result.boosted - result.base * 1.12) < 1e-6)
    assert.equal(result.cast, true)
    assert.equal(result.cooldown, result.normalCooldown * .9)
    assert.equal(result.supported, true)
    assert.equal(result.healed, 54)
    assert.equal(result.repeated, false)
    assert.equal(result.afterRepeat, 54)
    assert.equal(result.radius, result.normalRadius + 20)
    assert.ok(Math.abs(result.flameDamage - result.normalDamage * 1.15) < 1e-6)
    assert.equal(result.shatter, result.expectedShatter)
    assert.equal(result.cross, 1)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("freezing a charger cancels its warning and encounter movement keeps the frost slowdown", async () => {
  const h = await harness({ legacy: false, rules: 4 })
  try {
    await h.start()
    const result = await h.state(async c => {
      const { applyChoice } = await import("./skills.mjs")
      const s = c.scene, encounters = s.encounters, combat = s.combat
      s.setPaused(true); s.enemies.clear(true, true); s.elapsed = 10000
      applyChoice(combat.builds.companion, "companion", "ice:learn")
      const enemy = s.makeEnemy({ id: s.next(), kind: "charger", x: s.player.x + 220, y: s.player.y, hp: 5000 })
      const ai = encounters.foes.get(enemy.getData("id"))
      encounters.prepare(enemy, ai)
      const before = encounters.threats.length
      combat.frost.apply(enemy, "companion", combat.skill("companion", "ice"), 3)
      encounters.update()
      const cancelled = encounters.threats.length === 0 && ai.state === "recover"
      s.elapsed += 800
      combat.frost.marks.get(enemy.getData("id")).stacks = 1
      ai.state = "move"; ai.ready_at = s.elapsed + 2000
      s.paused = false; s.spawnAt = s.elapsed + 5000; c.lastSaved = s.elapsed
      for (const build of Object.values(combat.builds)) for (const skill of build.skills) skill.ready_at = 1200000
      s.update(0, 16)
      const speed = Math.hypot(enemy.body.velocity.x, enemy.body.velocity.y)
      s.setPaused(true)
      return { before, cancelled, speed, hp: s.hp }
    })
    assert.equal(result.before, 1)
    assert.equal(result.cancelled, true)
    assert.ok(Math.abs(result.speed - 46 * .88) < 1e-6)
    assert.equal(result.hp, 100)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

for (const viewport of [{ width: 1280, height: 820 }, { width: 390, height: 844 }]) {
  test(`default rule7 launch renders readable boss warnings at ${viewport.width}px`, async () => {
    const h = await harness({ viewport })
    try {
      await startFree(h)
      assert.equal(await h.state(c => c.scene.meta.rules), 7)
      await h.state(c => {
        const s = c.scene
        s.elapsed = 360000; s.spawnAt = 1200000; s.hurtUntil = 1200000; c.lastSaved = s.elapsed
        for (const build of Object.values(s.combat.builds)) for (const skill of build.skills) skill.ready_at = 1200000
        s.encounters.spawn()
        const enemy = s.enemies.getChildren().find(e => e.getData("kind") === "sentinel")
        s.terrain.place(enemy, { x: s.player.x + 150, y: s.player.y - 80 }, false)
        s.encounters.prepare(enemy, s.encounters.foes.get(enemy.getData("id")))
        s.encounters.paint(); s.updateHud()
      })
      await h.frame.locator("#encounter-status").waitFor({ state: "visible" })
      await h.page.screenshot({ path: join(artifacts, `adventure-encounters-${viewport.width}.png`) })
      const png = await h.frame.locator("canvas").screenshot()
      const colors = await h.page.evaluate(async base64 => {
        const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
        const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height
        const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0)
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data, colors = new Set()
        for (let i = 0; i < pixels.length; i += 204) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`)
        return colors.size
      }, png.toString("base64"))
      assert.ok(colors > 20)
      assert.equal(await h.state(() => document.documentElement.scrollWidth <= innerWidth), true)
      const rects = await h.state(() => ["hud", "encounter-status", "notice"].map(id => {
        const r = document.getElementById(id).getBoundingClientRect()
        return { top: r.top, bottom: r.bottom }
      }))
      assert.ok(rects[1].top >= rects[0].bottom)
      assert.ok(rects[2].top >= rects[1].bottom)
      await h.frame.getByRole("button", { name: "暂停", exact: true }).click()
      await h.frame.locator("#encounter-status").waitFor({ state: "hidden" })
      await h.state(c => {
        const s = c.scene
        s.level = 31
        const enemy = s.enemies.getChildren().find(e => e.getData("kind") === "sentinel")
        s.combat.deal(enemy, 10000, "player")
        s.encounters.openReward(true)
      })
      await h.frame.locator("[data-cooperation]").first().waitFor()
      await poll(() => h.state(c => !c.saving && !c.api.pending && !c.busy))
      await h.frame.getByRole("button", { name: "技能图鉴", exact: true }).click()
      await h.frame.getByRole("button", { name: "返回", exact: true }).click()
      await h.frame.locator("[data-cooperation]").first().waitFor()
      assert.equal(await h.state(() => document.documentElement.scrollWidth <= innerWidth), true)
      await h.page.screenshot({ path: join(artifacts, `adventure-cooperation-${viewport.width}.png`) })
      assert.deepEqual(h.errors, [])
    } finally { await h.close() }
  })
}

test("rule 5 walking hits a rock, can walk around it, and companions and enemies route around it", async () => {
  const h = await harness({ legacy: false, rules: 5 })
  try {
    await h.start()
    await h.state(c => {
      const s = c.scene
      s.enemies.clear(true, true); s.bullets.clear(true, true); s.spawnAt = 1200000; s.hurtUntil = 1200000
      for (const build of Object.values(s.combat.builds)) for (const skill of build.skills) skill.ready_at = 1200000
      s.terrain.place(s.player, { x: 600, y: 400 }, false)
    })
    await h.page.keyboard.down("d")
    await poll(() => h.state(c => c.scene.player.body.blocked.right))
    await h.page.keyboard.up("d")
    const stopped = await h.state(c => ({ x: c.scene.player.x, y: c.scene.player.y }))
    assert.ok(stopped.x > 630 && stopped.x < 646, JSON.stringify(stopped))
    await h.page.keyboard.down("w")
    await poll(() => h.state(c => c.scene.player.y < 360))
    await h.page.keyboard.up("w")
    await h.page.keyboard.down("d")
    await poll(() => h.state(c => c.scene.player.x > 750))
    await h.page.keyboard.up("d")
    await h.page.keyboard.down("s")
    await poll(() => h.state(c => c.scene.player.y > 410))
    await h.page.keyboard.up("s")
    await h.state(c => {
      const s = c.scene
      s.terrain.place(s.player, { x: 800, y: 372 }, false)
      s.terrain.place(s.companion, { x: 600, y: 400 }, false)
      s.makeEnemy({ id: s.next(), kind: "wisp", x: 600, y: 400, hp: 1000 })
      s.mapCrossings = []
      s.events.on("postupdate", () => {
        const actor = s.companion
        if (actor.x > 640 && actor.x < 720) s.mapCrossings.push({ x: actor.x, y: actor.y })
      })
    })
    await poll(() => h.state(c => c.scene.companion.x > 735))
    await poll(() => h.state(c => c.scene.enemies.getFirstAlive().x > 735))
    const result = await h.state(c => ({ points: c.scene.mapCrossings, searches: c.scene.terrain.searches }))
    assert.ok(result.searches > 0)
    assert.ok(result.points.length > 0)
    assert.ok(result.points.every(p => p.x < 646 || p.x > 714 || p.y < 378 || p.y > 426), JSON.stringify(result.points.slice(0, 15)))
    const charger = await h.state(c => {
      const s = c.scene
      s.setPaused(true); s.enemies.clear(true, true)
      s.terrain.place(s.player, { x: 800, y: 400 }, false)
      const enemy = s.makeEnemy({ id: s.next(), kind: "charger", x: 600, y: 400, hp: 1000 })
      const ai = s.encounters.foes.get(enemy.getData("id")); ai.ready_at = 0
      s.terrain.beginFrame(); s.encounters.update()
      return { state: ai.state, warnings: s.encounters.threats.length, speed: enemy.body.velocity.length() }
    })
    assert.equal(charger.state, "move"); assert.equal(charger.warnings, 0); assert.ok(charger.speed > 0)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("rule 5 dash, knockback, projectiles and enemy charge respect the same obstacle", async () => {
  const h = await harness({ legacy: false, rules: 5 })
  try {
    await h.start()
    const result = await h.state(async c => {
      const { applyChoice } = await import("./skills.mjs")
      const s = c.scene, combat = s.combat
      s.setPaused(true); s.elapsed = 1000; s.enemies.clear(true, true); s.bullets.clear(true, true)
      s.spawnAt = 1200000; s.shield = 0; s.hurtUntil = 0
      for (const build of Object.values(combat.builds)) for (const skill of build.skills) skill.ready_at = 1200000
      applyChoice(combat.builds.player, "player", "dash:learn")
      const dash = combat.skill("player", "dash")
      s.terrain.place(s.player, { x: 600, y: 400 }, false); combat.facing = { x: 1, y: 0 }
      const victim = s.makeEnemy({ id: s.next(), kind: "brute", x: 750, y: 400, hp: 1000 })
      s.setPaused(false); const cast = combat.castManual(1); s.setPaused(true)
      const dashX = s.player.x, hp = victim.getData("hp")
      dash.ready_at = 0; s.setPaused(false); const blocked = combat.castManual(1); s.setPaused(true)
      const cooldown = dash.ready_at
      s.terrain.place(victim, { x: 600, y: 400 }, false)
      combat.push(victim, { x: 550, y: 400 }, 300)
      const pushX = victim.x
      s.enemies.clear(true, true)
      s.terrain.place(s.player, { x: 780, y: 400 }, false); s.hp = 100; s.hurtUntil = 0
      const charger = s.makeEnemy({ id: s.next(), kind: "charger", x: 580, y: 400, hp: 1000 })
      const ai = s.encounters.foes.get(charger.getData("id"))
      s.encounters.prepare(charger, ai)
      const warning = { ...s.encounters.threats[0] }
      s.elapsed = warning.trigger_at; s.setPaused(false); s.encounters.update(); s.setPaused(true)
      const chargeX = charger.x, playerHp = s.hp
      s.enemies.clear(true, true); s.encounters.threats = []
      s.makeBullet({ id: s.next(), x: 600, y: 410, vx: 430, vy: 0, life: 1200, damage: 20,
        owner: "player", skill: "fire", form: "base", pierce: 0, hit_ids: [] })
      s.setPaused(false)
      return { cast, dashX, hp, blocked, cooldown, pushX, chargeX, playerHp, warning }
    })
    assert.equal(result.cast, true)
    assert.ok(result.dashX > 630 && result.dashX < 646)
    assert.equal(result.hp, 1000)
    assert.equal(result.blocked, false); assert.equal(result.cooldown, 0)
    assert.ok(result.pushX > 620 && result.pushX < 640)
    assert.ok(result.warning.ex < 640 && result.chargeX < 640)
    assert.equal(result.playerHp, 100)
    await poll(() => h.state(c => c.scene.bullets.countActive() === 0))
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("rule 5 depth follows the feet, foliage fades, and safe recovery preserves RNG across resume", async () => {
  const h = await harness({ legacy: false, rules: 5 })
  try {
    await h.start()
    const result = await h.state(c => {
      const s = c.scene
      s.setPaused(true); s.spawnAt = 1200000
      const tree = s.terrain.visuals.find(v => v.prop.id === "tree-0" && v.canopy)
      const wall = s.terrain.visuals.find(v => v.prop.id === "wall-0")
      s.terrain.place(s.player, { x: 430, y: 400 }, false); s.terrain.updateDepth()
      const behind = { actor: s.player.depth, tree: tree.image.depth, alpha: tree.image.alpha }
      s.terrain.place(s.player, { x: 430, y: 500 }, false); s.terrain.updateDepth()
      const front = { actor: s.player.depth, alpha: tree.image.alpha }
      const rng = s.rng.state()
      s.terrain.place(s.player, { x: 680, y: 410 }, false)
      s.terrain.place(s.companion, { x: 1234, y: 432 }, false)
      s.terrain.updateDepth()
      return { behind, front, rng, after: s.rng.state(), position: { x: s.player.x, y: s.player.y },
        snapshot: s.snapshot(), warningDepth: s.encounters.graphics.depth, wallDepth: wall.image.depth }
    })
    assert.ok(result.behind.actor < result.behind.tree); assert.ok(result.behind.alpha < .5)
    assert.ok(result.front.actor > result.behind.tree); assert.equal(result.front.alpha, 1)
    assert.equal(result.rng, result.after); assert.notDeepEqual(result.position, { x: 680, y: 410 })
    assert.ok(result.warningDepth > result.wallDepth)
    await h.state(async c => { await c.save(); await c.resume(false); c.scene.setPaused(true) })
    const restored = await h.state(c => c.scene.snapshot())
    assert.deepEqual(restored, result.snapshot)
    await h.state(c => c.scene.loadRun({ ...c.scene.meta, rules: 4, snapshot: null }))
    assert.equal(await h.state(c => c.scene.terrain.enabled), false)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("rule 5 resumes occupied saved positions safely without changing combat facts or random state", async () => {
  const h = await harness({ legacy: false, rules: 5 })
  try {
    await h.start()
    const before = await h.state(async c => {
      const s = c.scene
      s.setPaused(true); s.spawnAt = 1200000
      s.enemies.clear(true, true); s.bullets.clear(true, true)
      s.player.setPosition(680, 410); s.companion.setPosition(1234, 432)
      const enemy = s.makeEnemy({ id: s.next(), kind: "brute", x: 600, y: 410, hp: 123 })
      enemy.setPosition(680, 410)
      const state = s.snapshot()
      await c.save(); await c.resume(false); s.setPaused(true)
      return state
    })
    const after = await h.state(async c => {
      const { bodyShape } = await import("./forest-map.mjs")
      const s = c.scene
      const safe = [s.player, s.companion, ...s.enemies.getChildren()].every(actor => {
        const shape = bodyShape(actor)
        return s.terrain.geometry.free({ x: actor.x + shape.ox, y: actor.y + shape.oy }, shape)
      })
      return { safe, state: s.snapshot() }
    })
    assert.equal(after.safe, true)
    assert.notDeepEqual({ x: after.state.player.x, y: after.state.player.y }, { x: before.player.x, y: before.player.y })
    for (const key of ["rng", "elapsed", "builds", "stats", "kills", "xp", "foes", "threats"]) assert.deepEqual(after.state[key], before[key])
    assert.equal(after.state.enemies[0].hp, 123)
    await h.state(async c => { await c.save(); await c.resume(false); c.scene.setPaused(true) })
    assert.deepEqual(await h.state(c => c.scene.snapshot()), after.state)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("rule 5 clips a saved charge warning and never replays a fired charge after reload", async () => {
  const h = await harness({ legacy: false, rules: 5 })
  try {
    await h.start()
    const before = await h.state(async c => {
      const s = c.scene
      s.setPaused(true); s.elapsed = 1000; s.spawnAt = 1200000; s.hurtUntil = 0
      s.enemies.clear(true, true); s.bullets.clear(true, true); s.shield = 0
      s.terrain.place(s.player, { x: 780, y: 400 }, false)
      const charger = s.makeEnemy({ id: s.next(), kind: "charger", x: 580, y: 400, hp: 1000 })
      s.encounters.prepare(charger, s.encounters.foes.get(charger.getData("id")))
      const state = s.snapshot()
      await c.save(); await c.resume(false); s.setPaused(true)
      return state
    })
    assert.ok(before.threats[0].ex < 640)
    assert.deepEqual(await h.state(c => c.scene.snapshot().threats), before.threats)
    const fired = await h.state(async c => {
      const s = c.scene
      s.elapsed = s.encounters.threats[0].trigger_at
      s.setPaused(false); s.encounters.update(); s.setPaused(true)
      const state = s.snapshot()
      await c.save(); await c.resume(false); s.setPaused(true)
      s.setPaused(false); s.encounters.update(); s.setPaused(true)
      return { state, after: s.snapshot() }
    })
    assert.equal(fired.state.threats[0].fired, true)
    assert.deepEqual(fired.after, fired.state)
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

test("rule 5 dense navigation keeps a per-frame search budget with all enemy sizes spawning clear", async () => {
  const h = await harness({ legacy: false, rules: 5 })
  try {
    await h.start()
    const result = await h.state(async c => {
      const { bodyShape } = await import("./forest-map.mjs")
      const s = c.scene
      s.setPaused(true); s.enemies.clear(true, true); s.bullets.clear(true, true)
      s.terrain.place(s.player, { x: 800, y: 372 }, false)
      const rng = s.rng.state(), actors = []
      for (const kind of ["slime", "wisp", "brute", "charger", "caster", "sentinel", "oracle", "boss"]) {
        const enemy = s.makeEnemy({ id: s.next(), kind, x: 680, y: 410, hp: 1000 })
        const shape = bodyShape(enemy)
        actors.push(s.terrain.geometry.free({ x: enemy.x + shape.ox, y: enemy.y + shape.oy }, shape))
      }
      s.enemies.clear(true, true)
      for (let i = 0; i < 145; i++) {
        s.makeEnemy({ id: s.next(), kind: "slime", x: 600, y: 400, hp: 1000 })
      }
      let max = 0
      for (let frame = 0; frame < 40; frame++) {
        s.terrain.beginFrame()
        for (const enemy of s.enemies.getChildren()) s.terrain.move(enemy, s.player, 40)
        max = Math.max(max, s.terrain.searchesThisFrame)
      }
      return { actors, max, searches: s.terrain.searches, rng, after: s.rng.state(), graphs: s.terrain.graphs.size }
    })
    assert.ok(result.actors.every(Boolean)); assert.ok(result.max <= 4)
    assert.equal(result.searches, 145); assert.equal(result.rng, result.after)
    assert.ok(result.graphs <= 4)
    await h.state(c => { c.scene.scene.stop(); c.scene.terrain.destroy() })
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

for (const viewport of [{ width: 1280, height: 820 }, { width: 390, height: 844 }]) {
  test(`rule 5 terrain layers render around ruins at ${viewport.width}px`, async () => {
    const h = await harness({ legacy: false, rules: 5, viewport })
    try {
      await h.start()
      await h.state(c => {
        const s = c.scene
        s.enemies.clear(true, true); s.spawnAt = 1200000; s.hurtUntil = 1200000
        for (const build of Object.values(s.combat.builds)) for (const skill of build.skills) skill.ready_at = 1200000
        s.terrain.place(s.player, { x: 1190, y: 375 }, false)
        s.terrain.place(s.companion, { x: 1110, y: 415 }, false)
        s.makeEnemy({ id: s.next(), kind: "slime", x: 1250, y: 520, hp: 1000 })
        s.terrain.updateDepth()
        s.cameras.main.stopFollow(); s.cameras.main.centerOn(1180, 430)
      })
      await h.page.screenshot({ path: join(artifacts, `adventure-map-ruins-${viewport.width}.png`) })
      const result = await h.state(async c => {
        const image = await new Promise(resolve => c.scene.game.renderer.snapshot(resolve))
        const context = document.createElement("canvas").getContext("2d")
        context.canvas.width = image.width; context.canvas.height = image.height
        context.drawImage(image, 0, 0)
        const pixels = context.getImageData(0, 0, image.width, image.height).data
        const colors = new Set()
        for (let i = 0; i < pixels.length; i += 64) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`)
        return { colors: colors.size, props: c.scene.terrain.visuals.length,
          fits: document.documentElement.scrollWidth <= innerWidth }
      })
      assert.ok(result.colors > 100, JSON.stringify(result)); assert.ok(result.props > 50); assert.equal(result.fits, true)
      assert.deepEqual(h.errors, [])
    } finally { await h.close() }
  })
}

test("pausing during an in-flight automatic checkpoint opens the pause menu after acknowledgement", async () => {
  const h = await harness({ legacy: false, rules: 4 })
  let releaseResponse
  try {
    await h.start()
    await h.page.route("**/preview/action", async route => {
      if (route.request().postDataJSON().operation !== "checkpoint") return route.continue()
      const response = await route.fetch()
      await new Promise(resolve => { releaseResponse = resolve })
      await route.fulfill({ response })
    })
    await h.state(c => { c.scene.elapsed = 10001; c.autosave() })
    await poll(() => Boolean(releaseResponse))
    await h.frame.getByRole("button", { name: "暂停", exact: true }).click()
    await h.frame.getByRole("heading", { name: "正在保存进度", exact: true }).waitFor()
    const time = await h.state(c => c.scene.elapsed)
    assert.equal(await h.state(c => c.scene.paused), true)
    releaseResponse()
    await h.frame.getByRole("button", { name: "继续", exact: true }).waitFor()
    assert.equal(await h.state(c => c.scene.elapsed), time)
    assert.equal(await h.state(c => c.api.pending), null)
    await h.frame.getByRole("button", { name: "继续", exact: true }).click()
    await poll(async () => await h.state(c => c.scene.elapsed) > time)
    assert.deepEqual(h.errors, [])
  } finally { releaseResponse?.(); await h.close() }
})

test("art sample animation and particles preserve the saved simulation, RNG and collision bodies", async () => {
  const h = await harness({ legacy: false, rules: 4 })
  try {
    await h.start()
    const result = await h.state(c => {
      const s = c.scene
      s.setPaused(true); s.elapsed = 1000
      s.enemies.clear(true, true); s.bullets.clear(true, true)
      const enemy = s.makeEnemy({ id: s.next(), kind: "slime", x: s.player.x + 180, y: s.player.y, hp: 100 })
      s.player.setVelocity(-80, 0); s.companion.setVelocity(0, 80)
      const bodies = () => [s.player, s.companion, enemy].map(actor =>
        [actor.body.width, actor.body.height, actor.body.offset.x, actor.body.offset.y, actor.body.radius])
      const before = JSON.stringify(s.snapshot()), bodyBefore = bodies()
      for (let i = 0; i < 100; i++) {
        s.art.burst(s.player.x, s.player.y, 30, 0xb2e6f0, "shatter")
        s.art.update()
      }
      const preserved = before === JSON.stringify(s.snapshot())
      const first = s.player.frame.name
      s.elapsed += 100; s.art.update()
      const second = s.player.frame.name
      return { preserved, bodyBefore, bodyAfter: bodies(), first, second, partner: s.companion.frame.name,
        particles: s.art.particles.length, bursts: s.art.bursts.length }
    })
    assert.equal(result.preserved, true)
    assert.deepEqual(result.bodyAfter, result.bodyBefore)
    assert.match(result.first, /^mage-left-walk-/)
    assert.notEqual(result.first, result.second)
    assert.match(result.partner, /^companion-mage-down-walk-/)
    assert.ok(result.particles <= 180 && result.bursts <= 24)
    const paused = await h.state(c => [c.scene.elapsed, c.scene.player.frame.name])
    await new Promise(resolve => setTimeout(resolve, 180))
    assert.deepEqual(await h.state(c => [c.scene.elapsed, c.scene.player.frame.name]), paused)
    await h.state(c => c.scene.art.reset())
    assert.deepEqual(await h.state(c => [c.scene.art.particles.length, c.scene.art.bursts.length]), [0, 0])
    assert.deepEqual(h.errors, [])
  } finally { await h.close() }
})

for (const viewport of [{ width: 1280, height: 820 }, { width: 390, height: 844 }]) {
  test(`art sample renders skills, study and reduced effects at ${viewport.width}px`, async () => {
    const h = await harness({ legacy: false, rules: 4, viewport })
    try {
      await h.page.screenshot({ path: join(artifacts, `adventure-art-preparation-${viewport.width}.png`) })
      await h.start()
      await h.state(async c => {
        const { applyChoice } = await import("./skills.mjs")
        const s = c.scene
        s.enemies.clear(true, true); s.bullets.clear(true, true)
        s.spawnAt = 1200000; s.hurtUntil = 1200000
        for (const build of Object.values(s.combat.builds)) for (const skill of build.skills) skill.ready_at = 1200000
        applyChoice(s.combat.builds.player, "player", "slash:learn")
        applyChoice(s.combat.builds.companion, "companion", "ice:learn")
        const enemy = s.makeEnemy({ id: s.next(), kind: "slime", x: s.player.x + 60, y: s.player.y + 8, hp: 5000 })
        s.combat.frost.apply(enemy, "companion", s.combat.skill("companion", "ice"), 3)
        s.combat.melee("player", s.combat.skill("player", "slash"), enemy)
        for (let i = 0; i < 12; i++) s.makeEnemy({ id: s.next(), kind: i % 2 ? "wisp" : "slime",
          x: s.player.x + Math.cos(i) * 180, y: s.player.y + Math.sin(i) * 150, hp: 1000 })
        s.combat.shoot(s.player, "player", s.combat.skill("player", "fire"))
        s.combat.skill("player", "slash").ready_at = 1200000
        s.combat.skill("companion", "ice").ready_at = 1200000
      })
      await poll(() => h.state(c => c.scene.art.particles.length > 0))
      await h.page.screenshot({ path: join(artifacts, `adventure-art-battle-${viewport.width}.png`) })
      assert.equal(await h.state(c => c.scene.combat.stats.cross_shatters), 1)
      await h.frame.getByRole("button", { name: "简化特效", exact: true }).click()
      assert.equal(await h.frame.locator("#effects").getAttribute("aria-pressed"), "true")
      assert.equal(await h.state(c => c.scene.art.reduced), true)
      assert.equal(await h.state(c => c.scene.art.particles.length), 0)
      await h.state(c => { c.scene.level = 3; c.scene.xp = c.scene.xpNeeded(); c.scene.checkLevel() })
      await h.frame.locator("[data-upgrade]").first().waitFor()
      await poll(() => h.state(c => !c.saving && !c.api.pending && !c.busy))
      assert.match(await h.frame.locator(".study-identity").textContent(), /同行/)
      await h.page.screenshot({ path: join(artifacts, `adventure-art-study-${viewport.width}.png`) })
      const layout = await h.state(() => ({
        fits: document.documentElement.scrollWidth <= innerWidth,
        cards: [...document.querySelectorAll("[data-upgrade]")].every(card => card.scrollWidth <= card.clientWidth + 1),
        images: [...document.querySelectorAll(".study-identity img, #player-avatar, #companion-avatar")]
          .every(image => image.complete && image.naturalWidth > 0),
      }))
      assert.equal(layout.fits, true); assert.equal(layout.cards, true); assert.equal(layout.images, true)
      assert.deepEqual(h.errors, [])
    } finally { await h.close() }
  })
}
