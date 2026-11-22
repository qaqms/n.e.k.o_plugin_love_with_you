import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { after, before, test } from "node:test"
import { dependency, pluginRoot, startPreview } from "../preview/ui_preview.mjs"

const { chromium } = dependency("playwright")
const artifacts = resolve(process.env.NEKO_UI_ARTIFACTS || resolve(pluginRoot, "archive/reviews/cottage"))
let browser, server, url
before(async () => {
  ;({ server, url } = await startPreview())
  browser = await chromium.launch({
    executablePath: process.env.NEKO_UI_BROWSER || undefined,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  })
  mkdirSync(artifacts, { recursive: true })
})
after(async () => {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
})

const CAMERA_KEY = "love_with_you:cottage:camera"
// The cottage's clock places Yui (cottage-routine.mjs): at 8:30 she stands on the living-room rug. The cottage opens
// on the view it was left in during this session; most tests start in the living room (`view: null` starts fresh).
async function roomPage(viewport, isMobile = false, demo = false, reducedMotion = "reduce", clock = false,
  { at = [8, 30], view = "living" } = {}) {
  const page = await browser.newPage({ viewport, isMobile, hasTouch: isMobile, reducedMotion })
  const time = new Date(2026, 10, 22, ...at)
  if (clock) await page.clock.install({ time })
  else await page.clock.setFixedTime(time)
  if (view) {
    await page.addInitScript(([key, view]) => {
      if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify({ view, azimuth: .69, elevation: .52 }))
    }, [CAMERA_KEY, view])
  }
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.goto(`${url}/?locale=zh-CN${demo ? "&cottageDemo=1" : ""}`)
  const nav = page.locator(".lwy-nav")
  await nav.getByRole("button", { name: "我们的小屋" }).click()
  const frame = page.frameLocator('iframe[title="我们的小屋"]')
  await frame.locator("canvas").waitFor()
  await frame.getByRole("button", { name: "台灯" }).waitFor()
  // Yui's model arrives a moment after the room; pixel comparisons must not race it.
  await frame.locator("#room[data-yui]").waitFor({ timeout: 30000 })
  return { page, frame, nav, errors }
}

async function capture(page, frame, filename, selector = "#room") {
  // Every capture is reduced to 100x100; pass a smaller selector when only text inside it changes.
  const png = await frame.locator(selector).screenshot({
    path: filename && resolve(artifacts, filename),
    animations: "disabled",
  })
  return page.evaluate(async encoded => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${encoded}`)).blob())
    const canvas = document.createElement("canvas")
    canvas.width = 100
    canvas.height = 100
    const context = canvas.getContext("2d")
    context.drawImage(image, 0, 0, 100, 100)
    return Array.from(context.getImageData(0, 0, 100, 100).data)
  }, png.toString("base64"))
}

function verifyPixels(pixels, minimumCoverage) {
  const background = pixels.slice(0, 3)
  let colored = 0
  const swatches = new Set()
  for (let y = 18; y < 84; y++) for (let x = 0; x < 100; x++) {
    const index = (y * 100 + x) * 4
    const rgb = pixels.slice(index, index + 3)
    if (rgb.some((value, channel) => Math.abs(value - background[channel]) > 18)) {
      // The neighbouring kitchen may run off the right edge; the room's own left wall must stay in frame.
      assert.ok(x > 0, `model is clipped at ${x},${y}`)
      colored++
    }
    swatches.add(rgb.map(value => Math.floor(value / 12)).join(","))
  }
  assert.ok(colored > minimumCoverage && swatches.size > 55, `scene was blank or too small (${colored} px)`)
}

// Keepsakes are reached through the item list in the toolbar.
async function openItem(frame, name, action = "click") {
  // Wait for the toolbar: after a closeup the list may reopen by itself once the camera is back.
  await frame.locator("#items").waitFor()
  if (await frame.locator("#item-menu").isHidden()) await frame.locator("#items")[action]()
  await frame.getByRole("button", { name, exact: true })[action]()
}

function changedPixels(a, b) {
  let count = 0
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) count++
  }
  return count
}

test("software rendering picks the plain pipeline and every quality tier renders the night room", async () => {
  const shots = {}
  for (const [query, expected] of [["", "low"], ["&quality=medium", "medium"], ["&quality=high", "high"]]) {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 }, reducedMotion: "reduce" })
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    try {
      await page.addInitScript(() => localStorage.setItem("love_with_you:cottage:v1",
        JSON.stringify({ period: "night", lamp: true, curtains: true })))
      await page.goto(`${url}/plugin/love_with_you/ui/cottage.html?locale=zh-CN${query}`)
      await page.locator(`#room[data-quality="${expected}"][data-period="night"]`).waitFor()
      await page.getByRole("button", { name: "台灯" }).waitFor()
      shots[expected] = await capture(page, page, `cottage-quality-${expected}.png`)
      verifyPixels(shots[expected], 1800)
      assert.deepEqual(errors, [])
    } finally { await page.close() }
  }
  // Bloom, occlusion and grading must visibly change the frame, not silently fall back.
  assert.ok(changedPixels(shots.low, shots.high) > 300)
})

test("the sofa empty seat places a second cup and only chat sends an invitation", async () => {
  const { page, frame, errors } = await roomPage({ width: 1100, height: 760 }, false, true)
  try {
    await frame.locator("#seat").click()
    const emptySeat = frame.getByRole("button", { name: "沙发空位" })
    const before = await capture(page, frame, "cottage-empty-seat.png")
    await emptySeat.click()
    const quiet = frame.getByRole("button", { name: "一起坐会儿" })
    const chat = frame.getByRole("button", { name: "聊聊今天" })
    await quiet.waitFor()
    const second = await capture(page, frame, "cottage-two-cups.png")
    assert.ok(changedPixels(before, second) > 1000)
    await quiet.click()
    await chat.waitFor({ state: "hidden" })
    const invites = () => page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "invite_cottage_chat"))
    assert.equal((await invites()).length, 0)
    await quiet.click()
    await chat.click()
    await frame.locator("#company-status").getByText("已发出邀请", { exact: false }).waitFor()
    assert.equal((await invites())[0].args.character, "YUI")
    await frame.locator("#cottage-back").click()
    await emptySeat.waitFor()
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test("the cottage calendar flips between events and opens an anniversary notebook page", async () => {
  const { page, frame, errors } = await roomPage({ width: 390, height: 700 }, true, true)
  try {
    const overview = await capture(page, frame)
    await openItem(frame, "小屋日历", "tap")
    await frame.locator("#calendar-name").getByText("我们的小屋纪念日").waitFor()
    const closeup = await capture(page, frame, "cottage-calendar-mobile.png")
    assert.ok(changedPixels(overview, closeup) > 700)
    await frame.getByRole("button", { name: "下一页" }).tap()
    await frame.locator("#calendar-name").getByText("一起看初雪").waitFor()
    assert.equal(await frame.getByRole("button", { name: "写一张纪念便签" }).isVisible(), false)
    await frame.getByRole("button", { name: "上一页" }).tap()
    await frame.getByRole("button", { name: "写一张纪念便签" }).tap()
    const subject = frame.getByRole("textbox", { name: "便签标题" })
    await subject.waitFor()
    assert.equal(await subject.inputValue(), "我们的小屋纪念日")
    await frame.getByRole("textbox", { name: "便签内容" }).fill("今天在小屋碰面。")
    await frame.getByRole("button", { name: "确认留存" }).tap()
    await frame.locator("#notebook-status").getByText("共同经历已更新").waitFor()
    await frame.locator("#cottage-back").tap()
    await openItem(frame, "相框", "tap")
    await frame.locator("#picture-entry-title").getByText("我们的小屋纪念日").waitFor()
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test("the projection screen rolls down and clears its resume link when tracking turns off", async () => {
  const { page, frame, errors } = await roomPage({ width: 390, height: 700 }, true, true)
  try {
    const before = await capture(page, frame)
    await openItem(frame, "投影幕", "tap")
    await frame.locator("#projector-item").getByText("山间旅行纪录片").waitFor()
    assert.match(await frame.locator("#projector-progress").innerText(), /12:42/)
    assert.match(await frame.getByRole("link", { name: "继续看" }).getAttribute("href"), /\/watch_together\?/)
    const pulledDown = await capture(page, frame, "cottage-projector-mobile.png")
    assert.ok(changedPixels(before, pulledDown) > 1200)
    await page.evaluate(() => {
      const experiences = window.__uiTest.snapshot().experiences
      window.__uiTest.update({ experiences: { ...experiences, watch_tracking: false } })
    })
    await frame.locator("#projector-item").getByText("暂无观看进度").waitFor()
    assert.equal(await frame.getByRole("link", { name: "继续看" }).count(), 0)
    await frame.locator("#cottage-back").press("Escape")
    await frame.locator("#items").waitFor()
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test("a notebook entry can be drafted and kept in the frame after retrying a lost receipt", async () => {
  const { page, frame, errors } = await roomPage({ width: 1100, height: 760 }, false, true, "no-preference")
  try {
    await openItem(frame, "茶几便签本", "click")
    const title = frame.getByRole("textbox", { name: "便签标题" })
    await title.fill("第一张小屋便签")
    await frame.getByRole("textbox", { name: "便签内容" }).fill("一起在窗边看日落。")
    await frame.getByRole("button", { name: "只更新草稿" }).click()
    await frame.locator("#notebook-status").getByText("共同经历已更新").waitFor()
    assert.equal(await title.inputValue(), "第一张小屋便签")
    await capture(page, frame, "cottage-notebook.png")
    await page.evaluate(() => { window.__uiTest.failAfterAction = "experience_action" })
    await frame.getByRole("button", { name: "确认留存" }).click()
    const retry = frame.getByRole("button", { name: "确认上次操作" })
    await retry.waitFor()
    await page.evaluate(() => { window.__uiTest.failAfterAction = "" })
    await retry.click()
    await frame.locator("#notebook-status").getByText("共同经历已更新").waitFor()
    const state = await page.evaluate(() => window.__uiTest.snapshot())
    assert.equal(state.experiences.characters.YUI.note, null)
    assert.equal(state.experiences.characters.YUI.memories.filter(item => item.title === "第一张小屋便签").length, 1)
    await frame.locator("#cottage-back").click()
    await openItem(frame, "相框", "click")
    await frame.locator("#picture-entry-title").getByText("第一张小屋便签").waitFor()
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test("mobile gift shelf models are placed, persisted and removable", async () => {
  const { page, frame, nav, errors } = await roomPage({ width: 390, height: 760 }, true, true)
  try {
    await openItem(frame, "礼物陈列架", "tap")
    const picker = frame.getByRole("combobox", { name: "选择已送出的礼物" })
    const before = await capture(page, frame)
    await picker.selectOption("demo-plush")
    await frame.locator("#gift-details").getByText("YUI", { exact: false }).waitFor()
    const filled = await capture(page, frame, "cottage-gifts-mobile.png")
    assert.ok(changedPixels(before, filled) > 70)
    await frame.getByRole("button", { name: "展示位 2" }).tap()
    await picker.selectOption("demo-flowers")
    await nav.getByRole("button", { name: "关系概览" }).click()
    await nav.getByRole("button", { name: "我们的小屋" }).click()
    await openItem(frame, "礼物陈列架", "tap")
    await frame.getByRole("button", { name: "展示位 2 · 当季花束" }).tap()
    assert.equal(await picker.inputValue(), "demo-flowers")
    await frame.getByRole("button", { name: "移下陈列架" }).tap()
    assert.equal(await picker.inputValue(), "")
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test("a new mobile notebook page can be kept directly for a different character", async () => {
  const { page, frame, errors } = await roomPage({ width: 390, height: 700 }, true, true)
  try {
    await openItem(frame, "茶几便签本", "tap")
    await frame.locator("#notebook-role").selectOption("茉子")
    const title = frame.getByRole("textbox", { name: "便签标题" })
    const text = frame.getByRole("textbox", { name: "便签内容" })
    await title.fill("窗边的黄昏")
    await text.fill("晚霞照到了茶几。")
    await capture(page, frame, "cottage-notebook-mobile.png")
    await frame.getByRole("button", { name: "确认留存" }).tap()
    await frame.locator("#notebook-status").getByText("共同经历已更新").waitFor()
    const result = await page.evaluate(() => window.__uiTest.snapshot().experiences.characters)
    assert.equal(result["茉子"].note, null)
    assert.equal(result["茉子"].memories[0].title, "窗边的黄昏")
    assert.ok(!result.YUI.memories.some(item => item.title === "窗边的黄昏"))
    await frame.locator("#cottage-back").tap()
    await openItem(frame, "相框", "tap")
    await frame.locator("#picture-entry-title").getByText("窗边的黄昏").waitFor()
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test("the sofa changes the actual viewpoint and time of day, and resumes after looking at the record", async () => {
  const { page, frame, errors } = await roomPage({ width: 1100, height: 760 }, false, true)
  try {
    const overview = await capture(page, frame)
    await frame.locator("#seat").click()
    await frame.getByRole("button", { name: "白天" }).click()
    const day = await capture(page, frame, "cottage-sofa-day.png")
    assert.ok(changedPixels(overview, day) > 1600)
    await frame.getByRole("button", { name: "黄昏" }).click()
    const dusk = await capture(page, frame)
    await frame.getByRole("button", { name: "夜晚" }).click()
    const night = await capture(page, frame, "cottage-sofa-night.png")
    assert.ok(changedPixels(day, dusk) > 400)
    assert.ok(changedPixels(dusk, night) > 400)
    await frame.locator("#seat-lamp").click()
    const lit = await capture(page, frame)
    assert.ok(changedPixels(night, lit) > 100)
    await frame.locator("#seat-record").click()
    await frame.locator("#record-sleeves button").first().click()
    await frame.locator("#cottage-back").click()
    await frame.locator('#room[data-view="seat"] #seat-record').waitFor()
    assert.equal(await frame.locator("#period-night").getAttribute("aria-pressed"), "true")
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

for (const [device, width, height, mobile, target, trigger] of [
  ["desktop", 1100, 760, false, "company", "#seat-empty"],
  ["mobile", 390, 760, true, "record", "#seat-record"],
]) {
  test(`${device} sofa camera moves directly to ${target} and reverses without a jump`, async () => {
    const { page, frame, errors } = await roomPage({ width, height }, mobile, true, "no-preference", true)
    try {
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 200))
      const room = frame.locator("#room")
      const canvas = frame.locator("canvas")
      const button = frame.locator(trigger)
      const click = selector => frame.locator(selector).evaluate(node => node.click())
      const view = () => room.getAttribute("data-view")
      const pixels = () => canvas.evaluate(node => {
        const sample = document.createElement("canvas")
        sample.width = sample.height = 100
        const context = sample.getContext("2d")
        context.drawImage(node, 0, 0, 100, 100)
        return Array.from(context.getImageData(0, 0, 100, 100).data)
      })
      const overview = await pixels()
      await click("#seat")
      await page.clock.runFor(740)
      assert.equal(await view(), "seat")
      const seated = await pixels()
      await room.evaluate(node => {
        node.cameraViews = []
        new MutationObserver(() => node.cameraViews.push(node.dataset.view))
          .observe(node, { attributes: true, attributeFilter: ["data-view"] })
      })

      await click(trigger)
      await page.clock.runFor(16)
      assert.ok(changedPixels(seated, await pixels()) < 30, "departure starts from the sofa")
      await page.clock.runFor(320)
      assert.equal(await view(), "approaching")
      const midway = await pixels()
      assert.ok(changedPixels(seated, midway) > 500)
      assert.ok(changedPixels(overview, midway) > 1000, "the midpoint stays close to the furniture")
      await canvas.screenshot({ path: resolve(artifacts, `cottage-sofa-${target}-travel-${device}.png`) })

      await frame.locator("body").evaluate(node => {
        node.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      })
      await page.clock.runFor(16)
      assert.ok(changedPixels(midway, await pixels()) < 30, "reversal starts from the interrupted frame")
      await page.clock.runFor(570)
      assert.equal(await view(), "seat")
      assert.ok(changedPixels(seated, await pixels()) < 120)
      assert.ok(await button.evaluate(node => node === document.activeElement))

      await click(trigger)
      await page.clock.runFor(740)
      assert.equal(await view(), target)
      const arrived = await capture(page, frame, `cottage-sofa-${target}-${device}.png`)
      if (target === "record") await verifyVinylAnchor(frame, arrived)
      await click("#cottage-back")
      await page.clock.runFor(620)
      assert.equal(await view(), "seat")
      assert.ok(changedPixels(seated, await pixels()) < 120)
      assert.deepEqual(await room.evaluate(node => node.cameraViews),
        ["approaching", "returning", "seat", "approaching", target, "returning", "seat"])
      assert.deepEqual(errors, [])
    } finally { await page.close() }
  })
}

async function verifyVinylAnchor(frame, pixels) {
  const center = await frame.locator("#record-thread").evaluate(node => ({
    x: 100 * parseFloat(node.style.left) / innerWidth,
    y: 100 * parseFloat(node.style.top) / innerHeight,
  }))
  // Sample just inside the bright marker so the check measures the rendered groove.
  const index = (Math.floor(center.y - 1) * 100 + Math.floor(center.x - 1.4)) * 4
  assert.ok(pixels.slice(index, index + 3).every(channel => channel < 110),
    `guide starts outside the vinyl grooves at ${center.x}, ${center.y}`)
}

test("desktop room renders, responds to furniture clicks and drag, and retains preferences", async () => {
  const { page, frame, nav, errors } = await roomPage({ width: 1360, height: 900 })
  try {
    const initial = await capture(page, frame, "cottage-desktop.png")
    verifyPixels(initial, 2200)
    const lamp = frame.getByRole("button", { name: "台灯" })
    const curtains = frame.getByRole("button", { name: "窗帘" })
    const canvas = frame.locator("canvas")
    const roomBounds = await canvas.boundingBox()
    const point = (x, y) => [roomBounds.x + roomBounds.width * x, roomBounds.y + roomBounds.height * y]
    let lampPoint
    for (let y = .46; y <= .70 && !lampPoint; y += .04) {
      for (let x = .52; x <= .71 && !lampPoint; x += .025) {
        await page.mouse.move(...point(x, y))
        if (await canvas.getAttribute("data-target") === "lamp") lampPoint = point(x, y)
      }
    }
    assert.ok(lampPoint, "lamp hit area did not respond on canvas")
    await page.mouse.click(...lampPoint)
    assert.equal(await lamp.getAttribute("aria-pressed"), "true")
    const lit = await capture(page, frame)
    assert.ok(changedPixels(initial, lit) > 190, "lamp should visibly light surrounding furniture")
    await curtains.press("Space")
    assert.equal(await curtains.getAttribute("aria-pressed"), "false")
    const night = await capture(page, frame, "cottage-lamp.png")
    assert.ok(changedPixels(lit, night) > 900, "curtains should change room lighting")
    await page.mouse.move(...point(.62, .68))
    await page.mouse.down()
    await page.mouse.move(...point(.78, .77), { steps: 5 })
    await page.mouse.up()
    const rotated = await capture(page, frame)
    assert.ok(changedPixels(night, rotated) > 1000, "drag should move the camera")
    await frame.getByRole("button", { name: "重置视角" }).click()
    assert.ok(changedPixels(night, await capture(page, frame)) < 120, "reset should restore the original framing")
    await nav.getByRole("button", { name: "关系概览" }).click()
    assert.equal(await page.locator('iframe[title="我们的小屋"]').count(), 0)
    await nav.getByRole("button", { name: "我们的小屋" }).click()
    await lamp.waitFor()
    assert.equal(await lamp.getAttribute("aria-pressed"), "true")
    assert.equal(await curtains.getAttribute("aria-pressed"), "false")
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test("mobile room remains framed and its controls respond to touch", async () => {
  const { page, frame, errors } = await roomPage({ width: 390, height: 760 }, true)
  try {
    const initial = await capture(page, frame, "cottage-mobile.png")
    verifyPixels(initial, 1250)
    const lamp = frame.getByRole("button", { name: "台灯" })
    await lamp.tap()
    assert.equal(await lamp.getAttribute("aria-pressed"), "true")
    await frame.getByRole("button", { name: "向右转" }).tap()
    const turned = await capture(page, frame)
    assert.ok(changedPixels(initial, turned) > 500)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

async function clickObject(page, frame, id, xs, ys) {
  const canvas = frame.locator("canvas")
  const rect = await canvas.boundingBox()
  for (let y = ys[0]; y <= ys[1]; y += .025) {
    for (let x = xs[0]; x <= xs[1]; x += .025) {
      const point = [rect.x + x * rect.width, rect.y + y * rect.height]
      await page.mouse.move(...point)
      if (await canvas.getAttribute("data-target") !== id) continue
      await page.mouse.click(...point)
      return
    }
  }
  assert.fail(`No clickable area for ${id}`)
}

test("the record player approaches first, reveals sleeves, and returns to the same view", async () => {
  const { page, frame, errors } = await roomPage({ width: 1360, height: 900 }, false, true, "no-preference")
  try {
    await page.evaluate(() => window.postMessage({ type: "love-with-you-cottage-object", object: "record" }, location.origin))
    const canvas = frame.locator("canvas")
    const initial = await capture(page, frame)
    await canvas.evaluate(node => { node.dataset.testMounted = "yes" })
    await frame.locator("#room").evaluate(node => {
      const trace = []
      node.recordTrace = trace
      new MutationObserver(() => trace.push([node.dataset.view, node.querySelector("#record-station").hidden]))
        .observe(node, { attributes: true, attributeFilter: ["data-view"] })
    })
    await clickObject(page, frame, "record", [.65, .79], [.46, .59])
    const station = frame.getByRole("region", { name: "唱片收藏" })
    await station.getByRole("button", { name: "雨后爵士" }).waitFor()
    assert.deepEqual(await frame.locator("#room").evaluate(node => node.recordTrace.slice(0, 2)),
      [["approaching", true], ["record", false]])
    const revealed = await capture(page, frame, "cottage-record-sleeves.png")
    assert.ok(changedPixels(initial, revealed) > 2500)
    await verifyVinylAnchor(frame, revealed)
    assert.equal(await station.getByText("听到第三首").count(), 0)
    assert.deepEqual(await station.locator(".sleeve-title").allTextContents(), ["雨后爵士", "窗边的钢琴", "深夜电台"])
    const thread = await frame.locator("#record-thread").boundingBox()
    // The thread runs from the vinyl to the edge of the paper card.
    const card = await station.boundingBox()
    const heading = await station.getByRole("heading", { level: 2 }).boundingBox()
    assert.ok(Math.abs(thread.x + thread.width - card.x) <= 2)
    assert.ok(Math.abs(thread.y - (heading.y + heading.height / 2)) <= 2)
    await station.getByRole("button", { name: "雨后爵士" }).click()
    await station.getByText("听到第三首").waitFor()
    await station.getByText("最后那段钢琴独奏，我们又听了一遍。").waitFor()
    assert.equal(await station.getByRole("button", { name: "雨后爵士" }).getAttribute("aria-pressed"), "true")
    await frame.locator("#room").screenshot({ path: resolve(artifacts, "cottage-record.png"), animations: "disabled" })
    await station.getByRole("combobox").selectOption("茉子")
    await station.getByRole("button", { name: "晚风里的吉他" }).click()
    await station.getByText("一起听完了整张唱片。").waitFor()
    assert.equal(await station.getByText("雨后爵士").count(), 0)
    assert.equal(await station.getByRole("button", { name: "打开原记录" }).count(), 0)
    await page.keyboard.press("Escape")
    // Opened from the scene, so focus lands on the item list button.
    await frame.locator("#items:focus").waitFor()
    assert.ok(changedPixels(initial, await capture(page, frame)) < 120)
    assert.equal(await canvas.getAttribute("data-test-mounted"), "yes")
    assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "experience_action").length), 0)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test("record sleeves stay below the turntable on touch and clear when memories are disabled", async () => {
  const { page, frame, errors } = await roomPage({ width: 320, height: 760 }, true, true)
  try {
    const initial = await capture(page, frame)
    await openItem(frame, "唱机", "tap")
    const station = frame.getByRole("region", { name: "唱片收藏" })
    await station.locator(".record-sleeve").first().tap()
    await station.getByText("听到第三首").waitFor()
    const panel = await station.boundingBox()
    const thread = await frame.locator("#record-thread").boundingBox()
    assert.ok(Math.abs(thread.y + thread.height - panel.y) <= 3)
    assert.equal(await station.getAttribute("data-compact"), "true")
    const revealed = await capture(page, frame, "cottage-record-mobile.png")
    assert.ok(changedPixels(initial, revealed) > 2200)
    await verifyVinylAnchor(frame, revealed)
    const size = await station.evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }))
    assert.ok(size.scroll <= size.width + 1)
    await page.evaluate(() => window.__uiTest.update({
      experiences: { ...window.__uiTest.snapshot().experiences, enabled: false },
    }))
    await station.getByText("共同经历保存已关闭", { exact: false }).waitFor()
    assert.equal(await station.locator(".record-sleeve").count(), 0)
    assert.equal(await station.getByText("听到第三首").count(), 0)
    await frame.getByRole("button", { name: "回到小屋" }).tap()
    await frame.locator("#items").waitFor()
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test("the wall frame approaches, flips one memory at a time, and restores the room", async () => {
  const { page, frame, errors } = await roomPage({ width: 1360, height: 850 }, false, true, "no-preference")
  try {
    const initial = await capture(page, frame)
    const canvas = frame.locator("canvas")
    await canvas.evaluate(node => { node.dataset.testMounted = "yes" })
    await frame.locator("#room").evaluate(node => {
      const trace = []
      node.pictureTrace = trace
      new MutationObserver(() => trace.push([node.dataset.view, node.querySelector("#picture-pages").hidden]))
        .observe(node, { attributes: true, attributeFilter: ["data-view"] })
    })
    await clickObject(page, frame, "picture", [.62, .83], [.20, .46])
    const pages = frame.getByRole("region", { name: "相框" })
    await pages.getByRole("heading", { name: "下雨的傍晚" }).waitFor()
    await frame.locator('#room[data-view="picture"]').waitFor()
    assert.deepEqual(await frame.locator("#room").evaluate(node => node.pictureTrace.slice(0, 2)),
      [["approaching", true], ["picture", false]])
    const first = await capture(page, frame, "cottage-picture-desktop.png")
    assert.ok(changedPixels(initial, first) > 2300)
    const firstCaption = await capture(page, frame, undefined, "#picture-caption")
    assert.ok(await pages.getByRole("button", { name: "上一段回忆" }).isDisabled())
    await pages.getByRole("button", { name: "下一段回忆" }).click()
    await pages.getByRole("heading", { name: "山间旅行纪录片" }).waitFor()
    assert.equal(await pages.locator("h3:visible").count(), 1)
    assert.equal(await pages.locator("#picture-count").innerText(), "2 / 2")
    await pages.getByText("12:42", { exact: true }).waitFor()
    await capture(page, frame, "cottage-picture-screen.png")
    // Compare the caption alone: at full-room scale a text-only page turn falls below the noise floor on Windows fonts.
    assert.ok(changedPixels(firstCaption, await capture(page, frame, undefined, "#picture-caption")) > 100)
    assert.ok(await pages.getByRole("button", { name: "下一段回忆" }).isDisabled())
    await page.keyboard.press("Escape")
    await frame.locator("#items:focus").waitFor()
    assert.ok(changedPixels(initial, await capture(page, frame)) < 120)
    assert.equal(await canvas.getAttribute("data-test-mounted"), "yes")
    await openItem(frame, "相框", "click")
    await pages.getByRole("button", { name: "打开原记录" }).click()
    await page.locator('[data-experience-id="demo-film"]').getByRole("heading", { name: "山间旅行纪录片" }).waitFor()
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test("the picture frame fits touch screens, switches roles, and clears disabled memories", async () => {
  const { page, frame, errors } = await roomPage({ width: 320, height: 760 }, true, true)
  try {
    await openItem(frame, "相框", "tap")
    const pages = frame.getByRole("region", { name: "相框" })
    await pages.getByText("下雨的傍晚").waitFor()
    const size = await pages.locator("#picture-caption").evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }))
    assert.ok(size.scroll <= size.width + 1)
    await pages.getByRole("button", { name: "下一段回忆" }).tap()
    await pages.getByText("12:42", { exact: true }).waitFor()
    const canvas = await frame.locator("canvas").boundingBox()
    const pager = await pages.locator("#picture-pager").boundingBox()
    assert.ok(pager.y + pager.height <= canvas.y + canvas.height)
    await capture(page, frame, "cottage-picture-mobile.png")
    await pages.getByRole("combobox").selectOption("茉子")
    await pages.getByText("还没有留存便签或其他相处回忆。").waitFor()
    await pages.getByRole("combobox").selectOption("YUI")
    await pages.getByText("下雨的傍晚").waitFor()
    await frame.getByRole("button", { name: "回到小屋" }).tap()
    await frame.locator("#picture:focus").waitFor()
    await openItem(frame, "相框", "tap")
    await page.evaluate(() => window.__uiTest.update({
      experiences: { ...window.__uiTest.snapshot().experiences, enabled: false },
    }))
    await pages.getByText("共同经历保存已关闭", { exact: false }).waitFor()
    assert.equal(await pages.getByRole("heading", { level: 3 }).count(), 0)
    assert.equal(await pages.getByRole("button", { name: "打开原记录" }).count(), 0)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test("the same picture continues moving as the caption appears and reverses from mid-flight", async () => {
  const { page, frame, errors } = await roomPage({ width: 1360, height: 850 }, false, true, "no-preference", true)
  try {
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 200))
    const room = frame.locator("#room")
    const canvas = frame.locator("canvas")
    const open = () => frame.locator("#picture").evaluate(node => node.click())
    const close = () => frame.locator("body").evaluate(node => {
      node.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    const overlay = () => room.evaluate(node => {
      const pages = node.querySelector("#picture-pages")
      const opacity = id => Number(getComputedStyle(node.querySelector(id)).opacity)
      return {
        view: node.dataset.view,
        hidden: pages.hidden,
        inert: pages.inert,
        text: opacity("#picture-pages"),
        controls: opacity("#picture-pager"),
      }
    })
    const pixels = () => canvas.evaluate(node => {
      const sample = document.createElement("canvas")
      sample.width = sample.height = 160
      const context = sample.getContext("2d")
      context.drawImage(node, 0, 0, 160, 160)
      return Array.from(context.getImageData(0, 0, 160, 160).data)
    })
    const initial = await pixels()
    await open()
    await page.clock.runFor(780)
    const beforeCaption = await pixels()
    assert.deepEqual(await overlay(), { view: "approaching", hidden: true, inert: true, text: 0, controls: 0 })
    await page.clock.runFor(100)
    const duringCaption = await pixels()
    const emerging = await overlay()
    assert.equal(emerging.view, "approaching")
    assert.ok(!emerging.hidden && emerging.inert && emerging.text > 0 && emerging.text < 1)
    assert.equal(emerging.controls, 0)
    // The camera has arrived beside the frame; the paper card unfolds over a still scene.
    assert.ok(changedPixels(beforeCaption, duringCaption) < 30, "the frame should hold still while the card unfolds")
    const intermediate = await canvas.evaluate(node => node.toDataURL("image/png").split(",")[1])
    writeFileSync(resolve(artifacts, "cottage-picture-transition.png"), Buffer.from(intermediate, "base64"))
    await page.clock.runFor(210)
    assert.deepEqual(await overlay(), { view: "picture", hidden: false, inert: false, text: 1, controls: 1 })
    const settled = await pixels()
    await close()
    await page.clock.runFor(170)
    const returning = await overlay()
    assert.equal(returning.view, "returning")
    assert.ok(returning.inert && returning.text > 0 && returning.text < 1 && returning.controls === 0)
    assert.ok(changedPixels(settled, await pixels()) < 300, "the camera should hold while the caption fades")
    await page.clock.runFor(740)
    assert.equal((await overlay()).view, "room")
    assert.ok(changedPixels(initial, await pixels()) < 120)

    await open()
    await page.clock.runFor(660)
    const beforeEscape = await pixels()
    await close()
    await page.clock.runFor(16)
    assert.equal((await overlay()).view, "returning")
    assert.ok(changedPixels(beforeEscape, await pixels()) < 20, "the first returning frame should match the interrupted pose")
    await page.clock.runFor(600)
    assert.equal((await overlay()).view, "room")
    assert.ok(changedPixels(initial, await pixels()) < 120)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test("ambient motion runs only above low quality and stops for reduced motion", async () => {
  const { page, frame, errors } = await roomPage({ width: 1000, height: 700 }, false, false, "no-preference")
  try {
    const room = frame.locator("#room")
    await frame.locator('#room[data-ambient="false"]').waitFor()
    assert.equal(await room.getAttribute("data-quality"), "low", "the software renderer starts on low, without ambient motion")
    await frame.locator("#mood").click()
    await frame.locator("#mood-menu").getByRole("button", { name: "中", exact: true }).click()
    await frame.locator('#room[data-ambient="true"]').waitFor()
    await page.emulateMedia({ reducedMotion: "reduce" })
    await frame.locator('#room[data-ambient="false"]').waitFor()
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test("Yui loads with her motion clips, answers hover with her name, and a click brings the camera to her card", async () => {
  const { page, frame, errors } = await roomPage({ width: 1000, height: 700 }, false, false, "no-preference")
  try {
    const room = frame.locator("#room")
    await frame.locator('#room[data-yui="ready"]').waitFor({ timeout: 30000 })
    await frame.locator("#room[data-yui-motion]").waitFor({ timeout: 30000 })
    assert.equal(await room.getAttribute("data-yui-motion"), "15", "five idles, two gestures and her day's eight clips load")
    const canvas = frame.locator("canvas")
    const box = await canvas.boundingBox()
    let spot = null
    for (let y = .3; y < .95 && !spot; y += .03) for (let x = .2; x < .8 && !spot; x += .02) {
      await page.mouse.move(box.x + box.width * x, box.y + box.height * y)
      if (await canvas.getAttribute("data-target") === "yui") spot = [box.x + box.width * x, box.y + box.height * y]
    }
    assert.ok(spot, "Yui can be pointed at in the living room")
    assert.equal(await frame.locator("#hover-label").innerText(), "Yui")
    await page.mouse.click(...spot)
    await frame.locator('#room[data-view="yui"]').waitFor()
    assert.equal(await room.getAttribute("data-room"), "living", "clicking her does not move the camera to another room")
    const card = frame.locator("#yui-card")
    for (const name of ["摸摸她", "送礼物", "说说话"]) assert.ok(await card.getByRole("button", { name }).isVisible(), name)
    await capture(page, frame, "cottage-yui-card.png")
    await page.keyboard.press("Escape")
    await frame.locator('#room[data-view="room"]').waitFor()
    assert.ok(await card.isHidden())
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test("touching Yui tells the companion each time, waits for her reaction, and the bag opens for a gift", async () => {
  const { page, frame, errors } = await roomPage({ width: 1000, height: 700 }, false, false, "no-preference")
  try {
    await frame.locator("#room[data-yui-motion]").waitFor({ timeout: 30000 })
    const canvas = frame.locator("canvas")
    const box = await canvas.boundingBox()
    let spot = null
    for (let y = .3; y < .95 && !spot; y += .03) for (let x = .2; x < .8 && !spot; x += .02) {
      await page.mouse.move(box.x + box.width * x, box.y + box.height * y)
      if (await canvas.getAttribute("data-target") === "yui") spot = [box.x + box.width * x, box.y + box.height * y]
    }
    await page.mouse.click(...spot)
    const card = frame.locator("#yui-card")
    await card.getByRole("button", { name: "摸摸她" }).click()
    const head = card.getByRole("button", { name: "摸摸头" })
    assert.equal(await card.getByRole("button", { name: "说说话" }).isVisible(), false, "touch mode shows the parts instead")
    // In touch mode the pointer over the room becomes the 3D hand.
    await page.mouse.move(box.x + box.width * .3, box.y + box.height * .5)
    await frame.locator("canvas[data-hand]").waitFor({ timeout: 5000 })
    const touches = () => page.evaluate(() => window.__cottageTouches || [])
    // Held for a while on the head: one touch of length "while"; the parts wait while she reacts.
    const area = await head.boundingBox()
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(900)
    assert.equal(await canvas.getAttribute("data-hand"), "", "a button touch moves the hand to her by itself")
    await page.mouse.up()
    await page.waitForFunction(() => (window.__cottageTouches || []).length === 1)
    assert.ok(await card.getByRole("button", { name: "尾巴" }).isDisabled(), "a new touch waits for her reaction")
    await frame.locator("#yui-status").filter({ hasText: "已告诉桌宠。" }).waitFor()
    await frame.locator('#yui-zones button[data-zone="tail"]:not([disabled])').waitFor({ timeout: 8000 })
    const [first] = await touches()
    assert.deepEqual({ character: first.character, zone: first.zone }, { character: "YUI", zone: "head" })
    // Held for 0.9 s: not a tap. (The software renderer can hold the release back by seconds, so "while" or "long";
    // the key touches below have set lengths and are checked exactly.)
    assert.ok(["while", "long"].includes(first.length), first.length)
    assert.match(first.request_id, /^[0-9a-f-]{36}$/)
    // No gap between messages: the next touch goes as soon as she has finished.
    await card.getByRole("button", { name: "尾巴" }).focus()
    await page.keyboard.press("Enter")
    await page.waitForFunction(() => (window.__cottageTouches || []).length === 2)
    const second = (await touches())[1]
    assert.deepEqual([second.zone, second.length], ["tail", "tap"])
    await frame.locator('#yui-zones button[data-zone="tail"]:not([disabled])').waitFor({ timeout: 8000 })
    // Scratching under her chin is a part of its own; a button touch never counts as a stroke or a pinch.
    await card.getByRole("button", { name: "挠下巴" }).focus()
    await page.keyboard.press("Enter")
    await page.waitForFunction(() => (window.__cottageTouches || []).length === 3)
    const third = (await touches())[2]
    assert.deepEqual([third.zone, third.moved], ["chin", false])
    assert.equal(first.moved, false)
    await frame.locator('#yui-zones button[data-zone="tail"]:not([disabled])').waitFor({ timeout: 8000 })
    // Stroking her head back and forth with the pointer: a stroke, and roughly how many times.
    let crown = null
    for (let y = .05; y < .6 && !crown; y += .03) for (let x = .1; x < .7 && !crown; x += .03) {
      await page.mouse.move(box.x + box.width * x, box.y + box.height * y)
      if (await canvas.getAttribute("data-touch") === "head") crown = [box.x + box.width * x, box.y + box.height * y]
    }
    assert.ok(crown, "her head can be found under the pointer")
    await page.mouse.move(...crown)
    await page.mouse.down()
    for (const shift of [30, -30, 30, -30]) await page.mouse.move(crown[0] + shift, crown[1], { steps: 6 })
    await page.mouse.up()
    await page.waitForFunction(() => (window.__cottageTouches || []).length === 4)
    const stroke = (await touches())[3]
    assert.deepEqual([stroke.zone, stroke.moved, stroke.strokes], ["head", true, "some"])
    await frame.locator('#yui-zones button[data-zone="tail"]:not([disabled])').waitFor({ timeout: 8000 })
    await card.getByRole("button", { name: "好了" }).click()
    await frame.locator("canvas:not([data-hand])").waitFor({ timeout: 5000 })
    await card.getByRole("button", { name: "送礼物" }).click()
    const bag = page.getByRole("group", { name: "背包" })
    await bag.waitFor()
    await bag.getByRole("button", { name: "收起背包" }).click()
    assert.equal(await bag.count(), 0)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test("Yui's motion keeps her feet on the floor and blends clips without snapping", async () => {
  // Runs her layers headless for 50 simulated seconds: the opening after days apart, idles and two clicked gestures.
  const page = await browser.newPage()
  try {
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    const probe = `<!doctype html><meta charset="utf-8"><script type="module">
      import * as T from "./engine/three.module.min.js"
      import { loadYui } from "./cottage-yui.mjs"
      const yui = await loadYui(new T.Scene(), "./models")
      const clips = await yui.motion
      const ankles = ["左足首", "右足首"].map(name => yui.root.getObjectByName(name))
      const pelvis = yui.root.getObjectByName("下半身")
      const point = new T.Vector3(), turn = new T.Quaternion(), last = new T.Quaternion()
      yui.setMood({ warmth: .75, missed: true })
      let floor = null, sink = 0, snap = 0, drift = 0
      for (let frame = 0; frame < 60 * 50; frame++) {
        if (frame === 60 * 12 || frame === 60 * 30) yui.react()
        yui.update(1 / 60, { moving: true, viewer: new T.Vector3(4, 4, 6) })
        yui.root.updateMatrixWorld(true)
        const lowest = Math.min(...ankles.map(ankle => ankle.getWorldPosition(point).y))
        floor ??= lowest
        sink = Math.max(sink, Math.abs(lowest - floor))
        pelvis.getWorldQuaternion(turn)
        if (frame) snap = Math.max(snap, 2 * Math.acos(Math.min(1, Math.abs(turn.dot(last)))))
        last.copy(turn)
        // Her body stays over her own spot; gestures sway it a little (0.9.31-0.9.35 stood her about 1.5 m away).
        pelvis.getWorldPosition(point)
        drift = Math.max(drift, Math.hypot(point.x - yui.root.position.x, point.z - yui.root.position.z))
      }
      window.result = { clips, sink, snap, drift }
    </script>`
    await page.route("**/plugin/love_with_you/ui/yui-probe.html", route =>
      route.fulfill({ contentType: "text/html; charset=utf-8", body: probe }))
    await page.goto(`${url}/plugin/love_with_you/ui/yui-probe.html`)
    const { clips, sink, snap, drift } = await page.waitForFunction(() => window.result, null, { timeout: 90000 }).then(handle => handle.jsonValue())
    assert.equal(clips, 15)
    assert.ok(sink < .005, `the lower ankle stays on the floor (moved ${sink.toFixed(3)} m)`)
    assert.ok(snap < .06, `the hips never turn more than a smooth step in one frame (${snap.toFixed(3)} rad)`)
    assert.ok(drift < .3, `her body stays on her spot (${drift.toFixed(3)} m away)`)
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test("the cottage opens on the whole house, and on the view it was left in when it is opened again", async () => {
  const { page, frame, nav, errors } = await roomPage({ width: 1100, height: 760 }, false, true, "reduce", false, { view: null })
  try {
    const room = frame.locator("#room")
    assert.equal(await room.getAttribute("data-room"), "overview")
    await frame.locator("#rooms").click()
    await frame.locator("#room-menu").getByRole("button", { name: "厨房", exact: true }).click()
    await frame.locator('#room[data-room="kitchen"]').waitFor()
    await frame.getByRole("button", { name: "向右转" }).click()
    await nav.getByRole("button", { name: "关系概览" }).click()
    await nav.getByRole("button", { name: "我们的小屋" }).click()
    await frame.locator('#room[data-room="kitchen"]').waitFor()
    const saved = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), CAMERA_KEY)
    assert.equal(saved.view, "kitchen")
    assert.ok(Math.abs(saved.azimuth - .93) < 1e-6, "the turned camera is kept")
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

// Points at her by sweeping the canvas until the pointer is over her.
async function findYui(page, frame) {
  const canvas = frame.locator("canvas")
  const box = await canvas.boundingBox()
  for (let y = .15; y < .95; y += .03) for (let x = .1; x < .9; x += .02) {
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y)
    if (await canvas.getAttribute("data-target") === "yui") return [box.x + box.width * x, box.y + box.height * y]
  }
  return null
}

test("Yui keeps her day: the clock puts her somewhere, the room menu says where, and a click wakes her", async () => {
  const cooking = await roomPage({ width: 1100, height: 760 }, false, true, "reduce", false, { at: [7, 20], view: "living" })
  try {
    const { frame } = cooking
    await frame.locator('#room[data-yui-doing="breakfast-cook"]').waitFor({ timeout: 30000 })
    assert.equal(await frame.locator("#room").getAttribute("data-yui-room"), "kitchen")
    await frame.locator("#rooms").click()
    const menu = frame.locator("#room-menu")
    assert.ok(await menu.locator('button[data-view="kitchen"] .yui-here').isVisible(), "the kitchen is marked")
    assert.ok(await menu.locator('button[data-view="living"] .yui-here').isHidden())
    assert.ok(await menu.getByRole("button", { name: "厨房", exact: true }).isVisible(), "the mark is not part of the name")
    assert.deepEqual(cooking.errors, [])
  } finally { await cooking.page.close() }

  const { page, frame, errors } = await roomPage({ width: 1100, height: 760 }, false, false, "reduce", false, { at: [3, 0], view: "bedroom" })
  try {
    const room = frame.locator("#room")
    await frame.locator('#room[data-yui-doing="sleep"]').waitFor({ timeout: 30000 })
    assert.equal(await room.getAttribute("data-yui-room"), "bedroom")
    const spot = await findYui(page, frame)
    assert.ok(spot, "she can be pointed at in bed")
    await page.mouse.click(...spot)
    await frame.locator('#room[data-view="yui"]').waitFor()
    assert.equal(await room.getAttribute("data-room"), "bedroom", "the closeup is where she is")
    assert.equal(await room.getAttribute("data-yui-doing"), "with-you", "she got up for the visitor")
    await capture(page, frame, "cottage-yui-woken.png")
    await page.keyboard.press("Escape")
    await frame.locator('#room[data-view="room"]').waitFor()
    await frame.locator('#room[data-yui-doing="sleep"]').waitFor({ timeout: 10000 })
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})

test("Yui's mood follows the relationship stage, time apart and a bad day", async () => {
  for (const [bond, expected] of [["", "warmth:0.75"], ["missed", "warmth:0.75 missed"], ["low", "warmth:0.75 low"]]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    try {
      const errors = []
      page.on("pageerror", error => errors.push(error.message))
      await page.goto(`${url}/?locale=zh-CN${bond && `&bond=${bond}`}`)
      await page.locator(".lwy-nav").getByRole("button", { name: "我们的小屋" }).click()
      const frame = page.frameLocator('iframe[title="我们的小屋"]')
      await frame.locator("#room[data-yui-mood]").waitFor()
      assert.equal(await frame.locator("#room").getAttribute("data-yui-mood"), expected, bond || "default")
      assert.deepEqual(errors, [])
    } finally { await page.close() }
  }
})

test("the room menu moves through the house, items open from any room, and the quality choice is kept", async () => {
  const { page, frame, nav, errors } = await roomPage({ width: 1200, height: 800 }, false, true)
  try {
    const room = frame.locator("#room")
    assert.equal(await room.getAttribute("data-room"), "living")
    assert.equal(await frame.locator("#room-name").innerText(), "客厅")
    const living = await capture(page, frame)
    for (const [name, id] of [["厨房", "kitchen"], ["阁楼书房", "study"], ["总览", "overview"]]) {
      await frame.locator("#rooms").click()
      await frame.locator("#room-menu").getByRole("button", { name, exact: true }).click()
      await frame.locator(`#room[data-room="${id}"]`).waitFor()
      assert.equal(await frame.locator("#room-name").innerText(), name)
      assert.ok(await frame.locator("#room-menu").isHidden(), "choosing a room closes the menu")
    }
    const overview = await capture(page, frame, "cottage-overview.png")
    verifyPixels(overview, 1800)
    assert.ok(changedPixels(living, overview) > 1500, "the whole house should be framed")
    // The record player lives in the living room: choosing it elsewhere walks back there first.
    await openItem(frame, "唱机")
    await frame.getByRole("region", { name: "唱片收藏" }).getByRole("button", { name: "雨后爵士" }).waitFor()
    assert.equal(await room.getAttribute("data-room"), "living")
    await page.keyboard.press("Escape")
    await frame.locator("#record:focus").waitFor()
    await page.keyboard.press("Escape")
    assert.ok(await frame.locator("#item-menu").isHidden(), "Escape closes the reopened list")
    await frame.locator("#mood").click()
    await frame.locator("#mood-menu").getByRole("button", { name: "中", exact: true }).click()
    assert.equal(await room.getAttribute("data-quality"), "medium")
    assert.equal(await room.getAttribute("data-ambient"), "false", "reduced motion keeps ambient motion off")
    await nav.getByRole("button", { name: "关系概览" }).click()
    await nav.getByRole("button", { name: "我们的小屋" }).click()
    await frame.locator('#room[data-quality="medium"]').waitFor()
    assert.equal(await frame.locator("#quality-medium").getAttribute("aria-pressed"), "true")
    assert.deepEqual(errors, [])
  } finally { await page.close() }
})
