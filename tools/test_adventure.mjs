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
  const { legacy = true, rules, ...browserOptions } = options
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
  await frame.getByRole("button", { name: "进入林地", exact: true }).waitFor()
  const actual = () => page.frames().find(f => f.url().includes("/ui/index.html"))
  const state = (fn, args) => actual().evaluate(async ({ source, args }) => {
    const { controller } = await import("./adventure.mjs")
    return new Function("c", "args", `return (${source})(c, args)`)(controller, args)
  }, { source: fn.toString(), args })
  const start = async () => {
    if (legacy || rules) {
      await frame.locator("#player-class").focus()
      await state((c, rules) => c.start({ character: "YUI", player_class: rules === 1 ? "guardian" : "mage", companion_class: "mage", rules }), rules || 1)
    } else await frame.getByRole("button", { name: "进入林地", exact: true }).click()
    await frame.locator("#screen").waitFor({ state: "hidden" })
    await poll(() => state(c => !c.saving && c.lastSaved === 0))
  }
  return {
    page, frame, browser, url, state, start, errors,
    async close() { await browser.close(); server.kill(); await new Promise(resolve => server.once("exit", resolve)) },
  }
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
    await new Promise(resolve => setTimeout(resolve, 2200))
    const values = await h.state(c => ({
      zones: c.scene.combat.zones.length, bullets: c.scene.bullets.countActive(),
      marks: c.scene.combat.frost.marks.size,
      hits: c.scene.combat.stats.player_damage, elapsed: c.scene.elapsed,
    }))
    assert.ok(values.hits > 0 && values.elapsed > 500)
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
    await new Promise(resolve => setTimeout(resolve, 400))
    await h.page.mouse.up()
    assert.ok(await h.state(c => c.scene.player.x) > before + 15)
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
