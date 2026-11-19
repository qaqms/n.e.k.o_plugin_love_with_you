import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { mkdirSync, readFileSync } from "node:fs"
import { createServer } from "node:http"
import { resolve } from "node:path"
import { panelEntry, panelUrl } from "../build/panel_entry.mjs"
import { dependency, fixture, pluginRoot, startPreview } from "../preview/ui_preview.mjs"
import { portraitTouchPresets } from "../../ui/portrait-touch-presets.ts"

const { chromium } = dependency("playwright")
const artifacts = resolve(pluginRoot, "archive/reviews/browser/portrait-touch-097")
let browser, server, url

before(async () => {
  ;({ server, url } = await startPreview())
  browser = await chromium.launch({ headless: true, executablePath: process.env.NEKO_UI_BROWSER })
  mkdirSync(artifacts, { recursive: true })
})
after(async () => {
  await browser?.close()
  await new Promise(resolve => server?.close(resolve))
})

test("portrait moves to the center while the overview layout is preserved", async () => {
  for (const width of [390, 1100]) {
    const page = await browser.newPage({ viewport: { width, height: 780 }, reducedMotion: "reduce" })
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    await page.goto(url)
    const trigger = page.locator(".lwy-art button")
    await page.waitForFunction(() => document.querySelector(".lwy-art img")?.naturalWidth > 0)
    const overview = await page.locator("#lwy-page").boundingBox()
    await trigger.click()
    const dialog = page.locator("dialog.lwy-portrait-lightbox[open]")
    await dialog.getByRole("button", { name: "抚摸", exact: true }).waitFor()
    const art = await dialog.locator("figure").boundingBox()
    assert.ok(art.width > 80 && art.height > 100)
    assert.ok(Math.abs(art.x + art.width / 2 - width / 2) < 2)
    assert.equal(await dialog.evaluate(node => getComputedStyle(node, "::backdrop").backgroundColor), "rgba(0, 0, 0, 0.76)")
    assert.deepEqual(await page.locator("#lwy-page").boundingBox(), overview)
    await page.screenshot({ path: resolve(artifacts, `menu-${width}.png`) })
    await page.keyboard.press("Escape")
    await dialog.waitFor({ state: "hidden" })
    await page.waitForFunction(() => document.activeElement === document.querySelector(".lwy-art button"))
    await trigger.click()
    await dialog.waitFor()
    await page.mouse.click(3, 100)
    await dialog.waitFor({ state: "hidden" })
    assert.deepEqual(errors, [])
    await page.close()
  }
})

test("all catalog portraits have valid presets with separated centers", () => {
  assert.deepEqual(Object.keys(portraitTouchPresets).sort(), fixture().items.map(item => item.id).sort())
  for (const [id, points] of Object.entries(portraitTouchPresets)) {
    assert.ok(points.length === 2 || points.length === 3, id)
    for (const [index, [x, y]] of points.entries()) {
      assert.ok(x > 0 && x < 1 && y > 0 && y < 1, id)
      assert.ok(points.slice(0, index).every(([otherX, otherY]) => Math.hypot(x - otherX, y - otherY) >= .15), id)
    }
  }
})

test("preset areas are usable immediately, and bag and game use their existing flows", async () => {
  const page = await browser.newPage({ viewport: { width: 820, height: 720 }, reducedMotion: "reduce" })
  const { id, version } = fixture().items[0]
  await page.addInitScript(key => {
    localStorage.setItem("love_with_you:portrait-marks", JSON.stringify({
      [key]: { head: { x: .1, y: .9 } },
    }))
  }, `${id}:${version}`)
  await page.goto(url)
  const trigger = page.locator(".lwy-art button")
  await page.waitForFunction(() => document.querySelector(".lwy-art img")?.naturalWidth > 0)
  await trigger.click()
  const dialog = page.locator("dialog.lwy-portrait-lightbox[open]")
  await dialog.getByRole("button", { name: "抚摸", exact: true }).click()
  const image = dialog.locator("figure img")
  const portrait = await image.boundingBox()
  assert.equal(await dialog.getByRole("button", { name: /标记/ }).count(), 0)
  assert.equal(await dialog.locator(".lwy-portrait-mark").count(), 3)
  assert.equal(await dialog.locator(".lwy-portrait-mark *, .lwy-portrait-mark[title]").count(), 0)

  const calls = (action) => page.evaluate(action => window.__uiTest.calls.filter(call => call.action === action), action)
  const outside = { x: portrait.x + portrait.width * .10, y: portrait.y + portrait.height * .40 }
  await page.mouse.move(outside.x, outside.y)
  await page.screenshot({ path: resolve(artifacts, "touch-820.png") })
  assert.equal(await page.evaluate(({x, y}) => getComputedStyle(document.elementFromPoint(x, y)).cursor, outside), "auto")
  await page.mouse.click(outside.x, outside.y)
  assert.deepEqual(await calls("touch_portrait"), [])
  for (const [index, [name, zone]] of [["摸头", "head"], ["摸肚子", "belly"], ["摸腿", "legs"]].entries()) {
    const target = dialog.getByRole("button", { name, exact: true })
    const rect = await target.boundingBox()
    const [x, y] = portraitTouchPresets[id][index]
    const currentPortrait = await image.boundingBox()
    assert.ok(Math.abs(rect.x + rect.width / 2 - (currentPortrait.x + currentPortrait.width * x)) < 1, zone)
    assert.ok(Math.abs(rect.y + rect.height / 2 - (currentPortrait.y + currentPortrait.height * y)) < 1, zone)
    const point = { x: rect.x + rect.width * .77, y: rect.y + rect.height / 2 }
    assert.ok(rect.width * .27 > 15, "point falls away from the center of the hot spot")
    await page.mouse.move(point.x, point.y)
    const hover = await page.evaluate(({ x, y }) => {
      const node = document.elementFromPoint(x, y)
      const style = getComputedStyle(node)
      return { zone: node.dataset.zone, cursor: style.cursor, background: style.backgroundImage,
        color: style.backgroundColor, focusRing: getComputedStyle(node, "::after").content }
    }, point)
    assert.equal(hover.zone, zone)
    assert.match(hover.cursor, /^url\("data:image\/svg\+xml,.*"\) 15 16, grab$/)
    assert.equal(hover.background, "none")
    assert.equal(hover.color, "rgba(0, 0, 0, 0)")
    assert.equal(hover.focusRing, "none")
    await page.mouse.click(point.x, point.y)
    await dialog.getByText("已请求回应，请留意宿主聊天。").waitFor()
  }
  assert.deepEqual((await calls("touch_portrait")).map(call => [call.args.character, call.args.zone]),
    [["YUI", "head"], ["YUI", "belly"], ["YUI", "legs"]])
  const belly = await dialog.getByRole("button", { name: "摸肚子", exact: true }).boundingBox()
  const legs = await dialog.getByRole("button", { name: "摸腿", exact: true }).boundingBox()
  assert.ok(belly.y + belly.height <= legs.y + 1, "neighboring hit areas stay separate")
  await dialog.locator(".lwy-portrait-bar button").last().focus()
  await page.keyboard.press("Tab")
  const head = dialog.getByRole("button", { name: "摸头", exact: true })
  assert.ok(await head.evaluate(node => node.matches(":focus-visible")))
  assert.equal(await head.locator("*").count(), 0)
  assert.equal(await head.evaluate(node => getComputedStyle(node, "::after").borderTopWidth), "2px")
  await page.keyboard.press("Enter")
  await page.waitForFunction(() => window.__uiTest.calls.filter(call => call.action === "touch_portrait").length === 4)
  assert.equal((await calls("touch_portrait")).at(-1).args.zone, "head")
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    state.shop.catalog.find(item => item.id === "tea").quantity = 1
    window.__uiTest.update({ shop: state.shop })
  })
  await dialog.getByRole("button", { name: "返回互动选项" }).click()
  await dialog.getByRole("button", { name: "背包", exact: true }).click()
  await dialog.getByRole("button", { name: "送礼", exact: true }).click()
  await dialog.getByRole("button", { name: "确认送出", exact: true }).click()
  await page.waitForFunction(() => window.__uiTest.snapshot().shop.catalog[0].quantity === 0)
  assert.equal((await calls("send_shop_gift")).length, 1)
  await dialog.getByRole("button", { name: "返回互动选项" }).click()
  await dialog.getByRole("button", { name: "玩游戏", exact: true }).click()
  await page.locator(".lwy-game iframe").waitFor()
  await page.locator(".lwy-game-back").getByRole("button", { name: "关系概览" }).click()
  await trigger.waitFor()
  await trigger.click()
  await dialog.getByRole("button", { name: "抚摸", exact: true }).click()
  await dialog.getByRole("button", { name: "摸腿", exact: true }).waitFor()
  await page.close()
})

test("a touch screen can tap the invisible hot spot on a narrow panel", async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 600 }, hasTouch: true, reducedMotion: "reduce" })
  await page.goto(url)
  await page.locator(".lwy-art button").tap()
  const dialog = page.locator("dialog.lwy-portrait-lightbox[open]")
  await dialog.getByRole("button", { name: "抚摸", exact: true }).tap()
  assert.equal(await dialog.locator(".lwy-portrait-mark *").count(), 0)
  const target = dialog.getByRole("button", { name: "摸腿", exact: true })
  const area = await target.boundingBox()
  await page.touchscreen.tap(area.x + area.width * .75, area.y + area.height * .5)
  await dialog.getByText("已请求回应，请留意宿主聊天。").waitFor()
  assert.equal(await page.evaluate(() => window.__uiTest.calls.find(call => call.action === "touch_portrait").args.zone), "legs")
  await page.screenshot({ path: resolve(artifacts, "touch-320.png") })
  await page.close()
})

test("half-body portraits have no leg target and custom portraits have no preset", async () => {
  const page = await browser.newPage({ viewport: { width: 820, height: 720 }, reducedMotion: "reduce" })
  const portrait = fixture().items.find(item => item.id === "game-d714d4ea2c1b")
  const trigger = page.locator(".lwy-art button")
  const dialog = page.locator(".lwy-portrait-lightbox[open]")
  try {
    await page.goto(url)
    const choose = custom => page.evaluate(({ portrait, custom }) => {
      const test = window.__uiTest
      test.responseOverrideAction = "choose_portrait"
      test.responseOverride = { ...portrait, custom }
      const { portraits } = test.snapshot()
      portraits.revision += "x"
      portraits.settings.selected_id = portrait.id
      test.update({ portraits })
    }, { portrait, custom })
    await choose(false)
    await page.waitForFunction(id => window.__uiTest.calls.some(call => call.action === "get_portrait" && call.args.item_id === id), portrait.id)
    await trigger.click()
    await dialog.getByRole("button", { name: "抚摸", exact: true }).click()
    assert.deepEqual(await dialog.locator("figure button").evaluateAll(nodes => nodes.map(node => node.dataset.zone)), ["head", "belly"])
    await page.screenshot({ path: resolve(artifacts, "touch-half-body.png") })
    await page.keyboard.press("Escape")
    await choose(true)
    await trigger.click()
    await dialog.getByRole("button", { name: "抚摸", exact: true }).click()
    await dialog.getByText("这张立绘暂无可抚摸的区域。").waitFor()
    assert.equal(await dialog.locator("figure button").count(), 0)
  } finally {
    await page.close()
  }
})

test("the released static panel opens the portrait even with pre-upgrade HTML in the browser cache", async () => {
  const { state, items: [portrait] } = fixture()
  const { file: portraitFile, version } = portrait
  const dataUrl = `data:image/webp;base64,${readFileSync(resolve(pluginRoot, "assets/portraits", portraitFile)).toString("base64")}`
  const released = readFileSync(resolve(pluginRoot, panelEntry))
  const unversioned = "/plugin/love_with_you/ui/panel.html"
  let upgraded = false
  let oldRequests = 0
  const host = createServer((request, response) => {
    const path = request.url
    if (path === unversioned || path === panelUrl) {
      if (path === unversioned) oldRequests++
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" })
      response.end(upgraded ? released : `<aside class="lwy-art"><img src="${dataUrl}" width="84" alt=""></aside>`)
      return
    }
    if (!["/before", "/same-url", "/versioned-url"].includes(path)) {
      response.writeHead(404).end()
      return
    }
    const src = path === "/versioned-url" ? panelUrl : unversioned
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
    response.end(`<!doctype html><meta charset="utf-8">
<iframe id="surface" sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-modals"
  style="width:100%;height:540px;border:0"></iframe>
<script>
const frame = document.getElementById("surface");
window.addEventListener("message", event => {
  if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
  const d = event.data;
  if (d?.type !== "neko-hosted-surface-request") return;
  const actions = {
    choose_portrait: ${JSON.stringify(portrait)},
    get_portrait: ${JSON.stringify({ available: true, version, data_url: dataUrl })},
  };
  const result = d.method === "refresh" ? {state:${JSON.stringify(state)}} : actions[d.payload?.actionId];
  frame.contentWindow.postMessage({type:"neko-hosted-surface-response",requestId:d.requestId,ok:true,result},location.origin);
});
frame.src = ${JSON.stringify(src)};
</script>`)
  })
  await new Promise(resolve => host.listen(0, "127.0.0.1", resolve))
  const page = await browser.newPage({ viewport: { width: 818, height: 650 } })
  page.setDefaultTimeout(6000)
  const origin = `http://127.0.0.1:${host.address().port}`
  try {
    const panel = page.frameLocator("#surface")
    await page.goto(`${origin}/before`)
    await panel.locator(".lwy-art img").waitFor()
    assert.equal(oldRequests, 1)

    upgraded = true
    await page.goto(`${origin}/same-url`)
    await panel.locator(".lwy-art img").waitFor()
    assert.equal(await panel.locator(".lwy-art button").count(), 0)
    assert.equal(oldRequests, 1, "Chromium reused the pre-upgrade HTML")

    await page.goto(`${origin}/versioned-url`)
    await panel.locator(".lwy-art button").click()
    const lightbox = panel.locator(".lwy-portrait-lightbox[open]")
    for (const label of ["抚摸", "背包", "玩游戏"]) {
      await lightbox.getByRole("button", { name: label, exact: true }).waitFor()
    }
    await page.screenshot({ path: resolve(artifacts, "upgraded-iframe.png"), animations: "disabled" })
    await lightbox.getByRole("button", { name: "抚摸", exact: true }).click()
    await lightbox.getByRole("button", { name: "摸腿", exact: true }).waitFor()
  } finally {
    await page.close()
    await new Promise(resolve => host.close(resolve))
  }
})
