import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { dependency, pluginRoot, startPreview } from "./ui_preview.mjs"

const { chromium } = dependency("playwright")
const artifacts = process.env.NEKO_UI_ARTIFACTS ? resolve(process.env.NEKO_UI_ARTIFACTS) : resolve(pluginRoot, "../.neko-ui-review/artifacts")
const sections = ["关系概览", "心动记录", "纪念日", "专属称呼", "设置"]
let browser, server, url
before(async () => {
  ;({ server, url } = await startPreview())
  browser = await chromium.launch(process.env.NEKO_UI_BROWSER ? { executablePath: process.env.NEKO_UI_BROWSER } : {})
  mkdirSync(artifacts, { recursive: true })
})
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)) })

async function pageFor(options = {}, query = "") {
  const page = await browser.newPage({ viewport: { width: 980, height: 740 }, reducedMotion: "reduce", ...options })
  page.uiErrors = []
  page.on("pageerror", error => page.uiErrors.push(error.message))
  page.on("console", message => { if (message.type() === "error") page.uiErrors.push(message.text()) })
  await page.goto(`${url}/${query}`)
  await page.locator(".lwy").waitFor()
  return page
}
const navigate = (page, section) => page.locator(".lwy-nav").getByRole("button", { name: section, exact: true }).click()
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
async function noHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll(".lwy-workspace, .neko-modal, .neko-modal-body, .lwy-nav button, .neko-button")]
    return nodes.filter(node => node.getClientRects().length && node.scrollWidth > node.clientWidth + 2)
      .map(node => `${node.className}: ${node.scrollWidth}/${node.clientWidth}`)
  })
  assert.deepEqual(overflow, [])
}

test("all five pages fit desktop, narrow and mobile viewports in both themes", async () => {
  for (const colorScheme of ["light", "dark"]) {
    const page = await pageFor({ colorScheme })
    for (const width of [320, 390, 700, 800, 980, 1440]) {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 740 })
      for (let n = 0; n < sections.length; n++) {
        await navigate(page, sections[n])
        await settle(page)
        await noHorizontalOverflow(page)
        assert.equal(await page.locator('.lwy-nav [aria-current="page"]').count(), 1)
        assert.equal(await page.locator(".lwy-nav button.on").count(), 1)
        if ([390, 980].includes(width)) {
          await page.screenshot({ path: `${artifacts}/${colorScheme}-${width}-${n}.png` })
        }
      }
    }
    assert.deepEqual(page.uiErrors, [])
    await page.close()
  }
})

test("collapsed desktop navigation remains usable and survives data refresh", async () => {
  const page = await pageFor()
  await page.getByRole("button", { name: "收起侧栏", exact: true }).click()
  assert.equal(await page.locator(".lwy-nav button:visible").count(), 5)
  await navigate(page, "纪念日")
  await page.evaluate(() => window.__uiTest.update({ host_online: false }))
  assert.equal(await page.locator(".sidebar-collapsed").count(), 1)
  assert.equal(await page.locator("h1").textContent(), "纪念日")
  await page.getByRole("button", { name: "展开侧栏", exact: true }).click()
  await noHorizontalOverflow(page)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("nickname edits survive navigation, character changes and background updates", async () => {
  const page = await pageFor()
  await navigate(page, "专属称呼")
  await page.getByLabel("陌生", { exact: true }).fill("初见的称呼")
  await page.locator(".lwy-scope select").selectOption("茉子")
  await page.getByLabel("陌生", { exact: true }).fill("另一个称呼")
  await page.locator(".lwy-scope select").selectOption("YUI")
  assert.equal(await page.getByLabel("陌生", { exact: true }).inputValue(), "初见的称呼")
  await navigate(page, "关系概览")
  await navigate(page, "专属称呼")
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    state.scopes[0].nicknames.familiar = "后台更新的称呼"
    window.__uiTest.update({ scopes: state.scopes })
  })
  assert.equal(await page.getByLabel("陌生", { exact: true }).inputValue(), "初见的称呼")
  await page.getByRole("button", { name: "撤销修改", exact: true }).click()
  assert.equal(await page.getByLabel("熟悉", { exact: true }).inputValue(), "后台更新的称呼")
  assert.equal(await page.getByLabel("陌生", { exact: true }).inputValue(), "")
  await page.locator(".lwy-scope select").selectOption("茉子")
  assert.equal(await page.getByLabel("陌生", { exact: true }).inputValue(), "另一个称呼")
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await page.waitForFunction(() => window.__uiTest.calls.some(call => call.action === "set_nicknames"))
  const call = await page.evaluate(() => window.__uiTest.calls.find(call => call.action === "set_nicknames"))
  assert.equal(call.args.scope, "茉子")
  assert.equal(call.args.nicknames.stranger, "另一个称呼")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("failed nickname save preserves the draft and supports retry", async () => {
  const page = await pageFor()
  await navigate(page, "专属称呼")
  await page.getByLabel("陌生", { exact: true }).fill("还没保存")
  await page.evaluate(() => { window.__uiTest.failAction = "set_nicknames" })
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await page.getByRole("alert").filter({ hasText: "Preview save failed" }).first().waitFor()
  assert.equal(await page.getByLabel("陌生", { exact: true }).inputValue(), "还没保存")
  await page.evaluate(() => { window.__uiTest.failAction = "" })
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await page.waitForFunction(() => window.__uiTest.snapshot().scopes[0].nicknames.stranger === "还没保存")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("successful save followed by refresh failure closes the modal and offers refresh only", async () => {
  const page = await pageFor()
  await navigate(page, "设置")
  await page.getByRole("button", { name: "调整", exact: true }).click()
  await page.getByRole("spinbutton").fill("72")
  await page.evaluate(() => { window.__uiTest.failRefresh = true })
  await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  await page.locator(".lwy-notices").getByRole("button", { name: "刷新", exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().scopes[0].affection), 72)
  await page.evaluate(() => { window.__uiTest.failRefresh = false })
  await page.locator(".lwy-notices").getByRole("button", { name: "刷新", exact: true }).click()
  await page.locator(".lwy-notices").waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "set_affection").length), 1)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("saving blocks Escape, backdrop dismissal and duplicate submissions", async () => {
  const page = await pageFor()
  await navigate(page, "设置")
  await page.getByRole("button", { name: "调整", exact: true }).click()
  await page.getByRole("spinbutton").fill("45")
  await page.evaluate(() => { window.__uiTest.delay = 350 })
  await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click()
  await page.keyboard.press("Escape")
  assert.equal(await page.getByRole("dialog").count(), 1)
  assert.equal(await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).isDisabled(), true)
  await page.locator(".neko-modal-backdrop").click({ position: { x: 2, y: 2 } })
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "set_affection").length), 1)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("anniversary date keeps focus while editing and labels name each field", async () => {
  const page = await pageFor()
  await navigate(page, "纪念日")
  await page.getByRole("button", { name: "添加", exact: true }).click()
  await page.getByLabel("名称", { exact: true }).fill("生日")
  await page.getByLabel("日期", { exact: true }).fill("2026-02-28")
  await settle(page)
  assert.equal(await page.getByLabel("日期", { exact: true }).evaluate(node => node === document.activeElement), true)
  await page.getByRole("dialog").getByRole("button", { name: "添加", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().anniversaries.at(-1).month), 2)
  assert.equal(await page.getByRole("button", { name: "添加", exact: true }).evaluate(node => node === document.activeElement), true)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("first-met dates are bounded and pending edits cannot retarget another character", async () => {
  const page = await pageFor()
  await navigate(page, "纪念日")
  await page.getByRole("button", { name: "修改相识日", exact: true }).click()
  const field = page.getByLabel("你们相识的日子", { exact: true })
  await field.fill("2026-03-04")
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    state.scopes[1].is_current = true
    state.scopes[0].is_current = false
    window.__uiTest.update({ scopes: state.scopes })
  })
  await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => window.__uiTest.calls.find(call => call.action === "set_first_met").args.scope), "YUI")
  await page.getByRole("button", { name: "修改相识日", exact: true }).click()
  await field.fill("2099-01-01")
  assert.equal(await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).isDisabled(), true)
  await field.fill("1969-12-31")
  assert.equal(await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).isDisabled(), true)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("gallery supports search, pagination, pool editing and short windows", async () => {
  const page = await pageFor({ viewport: { width: 390, height: 620 } })
  await navigate(page, "设置")
  await page.getByRole("button", { name: "选择立绘", exact: true }).click()
  await page.locator(".lwy-portrait-choice").first().waitFor()
  await noHorizontalOverflow(page)
  await page.getByRole("button", { name: "下一页", exact: true }).click()
  await page.locator(".lwy-gallery-pager").filter({ hasText: "第 2" }).waitFor()
  await page.getByLabel("搜索", { exact: true }).fill("不存在的立绘")
  await page.getByText("没有符合条件的立绘。", { exact: true }).waitFor()
  await page.getByLabel("搜索", { exact: true }).fill("丛雨")
  await page.locator(".lwy-portrait-choice").first().waitFor()
  await page.locator(".lwy-portrait-choice").first().click()
  await page.screenshot({ path: `${artifacts}/gallery-mobile.png` })
  await page.getByRole("button", { name: "使用此立绘", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  await page.getByRole("button", { name: "随机", exact: true }).click()
  await page.getByRole("button", { name: "选择随机范围", exact: true }).waitFor()
  await page.getByRole("button", { name: "选择随机范围", exact: true }).click()
  await page.locator(".lwy-portrait-choice").first().waitFor()
  await page.getByRole("button", { name: "清空选择", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  assert.deepEqual(await page.evaluate(() => window.__uiTest.snapshot().portraits.settings.pool_ids), [])
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("scoring errors remain visible after earlier successful scores", async () => {
  const page = await pageFor()
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    window.__uiTest.update({ auto_status: { ...state.auto_status, failed: 2, last_error: "judge failed" } })
  })
  await navigate(page, "设置")
  assert.match(await page.locator(".lwy-status").textContent(), /2.*判断失败/)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("a broken artwork preview clears cached image data and can be retried", async () => {
  const page = await pageFor()
  await page.locator(".lwy-art img").waitFor()
  await navigate(page, "设置")
  let failed = false
  await page.route("**/image/**", async route => {
    if (!failed) {
      failed = true
      await route.fulfill({ contentType: "text/plain", body: "data:image/webp;base64,AAAA" })
    } else await route.continue()
  })
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    state.portraits.settings.selected_id = state.portraits.ids[1]
    window.__uiTest.update({ portraits: state.portraits })
  })
  await page.getByRole("button", { name: "重试", exact: true }).waitFor()
  await page.getByRole("button", { name: "重试", exact: true }).click()
  await page.waitForFunction(() => {
    const image = document.querySelector(".lwy-portrait-preview img")
    return image?.complete && image.naturalWidth > 0
  })
  await page.getByRole("button", { name: "重试", exact: true }).waitFor({ state: "hidden" })
  const reads = await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "get_portrait" &&
    call.args.item_id === window.__uiTest.snapshot().portraits.ids[1]).length)
  assert.equal(reads, 2)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("empty and artwork-off states recover without blank navigation", async () => {
  const page = await pageFor({}, "?empty=1&art=off")
  assert.equal(await page.locator(".lwy-art").count(), 0)
  await page.getByRole("button", { name: "刷新角色", exact: true }).click()
  assert.equal(await page.evaluate(() => window.__uiTest.calls.at(-1).action), "sync_characters")
  await navigate(page, "设置")
  assert.equal(await page.locator(".lwy-nav button:visible").count(), 5)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("translated labels and long character names fit all five mobile pages", async () => {
  for (const locale of ["en", "ja", "ko", "zh-TW", "ru", "es", "pt"]) {
    const page = await pageFor({ viewport: { width: 390, height: 844 } }, `?locale=${locale}`)
    await page.evaluate(() => {
      const state = window.__uiTest.snapshot()
      state.scopes[0].label = "这是一个很长的角色名称ABCDEFGHIJKLMNOPQRSTUVWXYZ"
      window.__uiTest.update({ scopes: state.scopes })
    })
    for (let index = 0; index < sections.length; index++) {
      await page.locator(".lwy-nav button").nth(index).click()
      await settle(page)
      await noHorizontalOverflow(page)
    }
    assert.deepEqual(page.uiErrors, [])
    await page.close()
  }
})

test("all six palettes preview across pages and modes without writing preferences", async () => {
  const page = await pageFor({ viewport: { width: 390, height: 844 } })
  const presets = [["樱粉", "#c74768"], ["晴空蓝", "#7db9e8"], ["薄荷绿", "#70bda5"],
    ["雾紫", "#aaa0d8"], ["杏桃", "#edac8c"], ["湖水青", "#66b8c5"]]
  for (const [name, color] of presets) for (const scheme of ["浅色", "深色"]) {
    await navigate(page, "设置")
    await page.getByRole("group", { name: "主题配色", exact: true }).getByRole("button", { name, exact: true }).click()
    await page.getByRole("group", { name: "显示模式", exact: true }).getByRole("button", { name: scheme, exact: true }).click()
    assert.equal(await page.getByLabel("自选颜色", { exact: true }).inputValue(), color)
    await noHorizontalOverflow(page)
    if (name === "晴空蓝") await page.screenshot({ path: `${artifacts}/sky-${scheme === "深色" ? "dark" : "light"}-settings.png` })
    await navigate(page, "关系概览")
    await noHorizontalOverflow(page)
    if (name === "晴空蓝") await page.screenshot({ path: `${artifacts}/sky-${scheme === "深色" ? "dark" : "light"}-overview.png` })
  }
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "set_appearance").length), 0)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("explicit color modes override the OS and system mode follows changes", async () => {
  const page = await pageFor({ colorScheme: "dark" })
  await navigate(page, "设置")
  const mode = page.getByRole("group", { name: "显示模式", exact: true })
  const background = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim())
  assert.equal(await background(), "#191b20")
  await mode.getByRole("button", { name: "浅色", exact: true }).click()
  assert.equal(await background(), "#fafafb")
  await mode.getByRole("button", { name: "深色", exact: true }).click()
  await page.emulateMedia({ colorScheme: "light" })
  assert.equal(await background(), "#191b20")
  await mode.getByRole("button", { name: "跟随系统", exact: true }).click()
  assert.equal(await background(), "#fafafb")
  await page.emulateMedia({ colorScheme: "dark" })
  assert.equal(await background(), "#191b20")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("custom color validates input, preserves failed saves and survives a saved reload", async () => {
  const page = await pageFor()
  await navigate(page, "设置")
  const appearance = page.locator(".lwy-appearance")
  await page.getByLabel("色号", { exact: true }).fill("#bad")
  assert.equal(await appearance.getByRole("button", { name: "保存", exact: true }).isDisabled(), true)
  await page.getByText("请输入 #RRGGBB 格式的色号", { exact: true }).waitFor()
  await page.getByLabel("色号", { exact: true }).fill("#2468AC")
  assert.equal(await page.getByLabel("自选颜色", { exact: true }).inputValue(), "#2468ac")
  await page.evaluate(() => { window.__uiTest.failAction = "set_appearance" })
  await appearance.getByRole("button", { name: "保存", exact: true }).click()
  await page.getByRole("alert").filter({ hasText: "Preview save failed" }).waitFor()
  assert.equal(await page.getByLabel("自选颜色", { exact: true }).inputValue(), "#2468ac")
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().appearance.accent_color), "#c74768")
  await page.evaluate(() => { window.__uiTest.failAction = "" })
  await appearance.getByRole("button", { name: "保存", exact: true }).click()
  await page.waitForFunction(() => window.__uiTest.snapshot().appearance.accent_color === "#2468ac")
  await page.reload()
  await navigate(page, "设置")
  assert.equal(await page.getByLabel("自选颜色", { exact: true }).inputValue(), "#2468ac")
  await appearance.getByRole("button", { name: "恢复默认", exact: true }).click()
  assert.equal(await page.getByLabel("自选颜色", { exact: true }).inputValue(), "#c74768")
  await appearance.getByRole("button", { name: "撤销修改", exact: true }).click()
  assert.equal(await page.getByLabel("自选颜色", { exact: true }).inputValue(), "#2468ac")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("theme drafts survive background refreshes and acknowledged saves need no repeat", async () => {
  const page = await pageFor()
  await navigate(page, "设置")
  const appearance = page.locator(".lwy-appearance")
  await page.getByLabel("自选颜色", { exact: true }).fill("#70bda5")
  await page.evaluate(() => window.__uiTest.update({ appearance: { accent_color: "#aaa0d8", color_scheme: "system" } }))
  assert.equal(await page.getByLabel("自选颜色", { exact: true }).inputValue(), "#70bda5")
  await appearance.getByRole("button", { name: "撤销修改", exact: true }).click()
  assert.equal(await page.getByLabel("自选颜色", { exact: true }).inputValue(), "#aaa0d8")
  await page.getByLabel("自选颜色", { exact: true }).fill("#edac8c")
  await page.evaluate(() => { window.__uiTest.failRefresh = true })
  await appearance.getByRole("button", { name: "保存", exact: true }).click()
  await page.locator(".lwy-notices").getByRole("button", { name: "刷新", exact: true }).waitFor()
  assert.equal(await page.getByLabel("自选颜色", { exact: true }).inputValue(), "#edac8c")
  assert.equal(await appearance.getByRole("button", { name: "保存", exact: true }).isDisabled(), true)
  await page.evaluate(() => { window.__uiTest.failRefresh = false })
  await page.locator(".lwy-notices").getByRole("button", { name: "刷新", exact: true }).click()
  await page.locator(".lwy-notices").waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "set_appearance").length), 1)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})
