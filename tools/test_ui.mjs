import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { mkdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { dependency, pluginRoot, startPreview } from "./ui_preview.mjs"

const { chromium } = dependency("playwright")
const artifacts = process.env.NEKO_UI_ARTIFACTS ? resolve(process.env.NEKO_UI_ARTIFACTS) : resolve(pluginRoot, "../.neko-ui-review/artifacts")
const sections = ["关系概览", "心动记录", "纪念日", "专属称呼", "设置", "礼物商店", "共同经历"]
let browser, server, url
before(async () => {
  ;({ server, url } = await startPreview())
  browser = await chromium.launch({
    ...(process.env.NEKO_UI_BROWSER ? { executablePath: process.env.NEKO_UI_BROWSER } : {}),
    ignoreDefaultArgs: ["--hide-scrollbars"],
  })
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
const nickname = (page, stage) => page.getByLabel(`${stage}的自定义称呼`, { exact: true })
async function editNickname(page, stage, text) {
  await page.getByRole("combobox", { name: stage, exact: true }).selectOption("custom")
  await nickname(page, stage).fill(text)
}
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
async function noHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll(".lwy-sidebar, .lwy-workspace, .neko-modal, .neko-modal-body, .lwy-nav button, .neko-button")]
    return nodes.filter(node => node.getClientRects().length && node.scrollWidth > node.clientWidth + 2)
      .map(node => `${node.className}: ${node.scrollWidth}/${node.clientWidth}`)
  })
  assert.deepEqual(overflow, [])
}

test("shop shows unclaimed income, purchase, explicit recipient and affection feedback", async () => {
  const page = await pageFor()
  await navigate(page, "礼物商店")
  await page.getByText("今日已领取 0 / 30 金币", { exact: true }).waitFor()
  assert.equal(await page.getByRole("button", { name: "领取", exact: true }).count(), 2)
  assert.equal(await page.locator(".lwy-shop-balance strong").textContent(), "100")
  await page.locator('[data-product="cake"]').getByRole("button", { name: "购买", exact: true }).click()
  await page.getByRole("status").filter({ hasText: "已购买草莓蛋糕，背包中共 1 份" }).waitFor()
  await page.getByRole("button", { name: "背包", exact: true }).click()
  await page.getByLabel("送礼对象", { exact: true }).selectOption("茉子")
  await page.getByRole("button", { name: "送礼", exact: true }).click()
  await page.getByRole("dialog").getByText("将一份草莓蛋糕送给茉子？", { exact: true }).waitFor()
  await page.getByRole("dialog").getByRole("button", { name: "确认送出", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  await page.getByRole("status").filter({ hasText: "已将草莓蛋糕送给茉子，好感 +2" }).waitFor()
  const state = await page.evaluate(() => window.__uiTest.snapshot())
  assert.equal(state.scopes[0].affection, 67)
  assert.equal(state.scopes[1].affection, 25)
  assert.equal(state.shop.catalog.find(item => item.id === "cake").quantity, 0)
  assert.equal(state.shop.coins, 60)
  await page.getByRole("button", { name: "赠送记录", exact: true }).click()
  await page.getByText("草莓蛋糕 → 茉子", { exact: true }).waitFor()
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("lost purchase response retries the same request without spending twice", async () => {
  const page = await pageFor({}, "?page=shop")
  await page.evaluate(() => { window.__uiTest.failAfterAction = "buy_shop_item" })
  await page.locator('[data-product="cake"]').getByRole("button", { name: "购买", exact: true }).click()
  await page.getByRole("button", { name: "确认上次操作", exact: true }).waitFor()
  assert.equal(await page.locator('[data-product="tea"]').getByRole("button").isDisabled(), true)
  await page.evaluate(() => { window.__uiTest.failAfterAction = "" })
  await page.getByRole("button", { name: "确认上次操作", exact: true }).click()
  await page.getByRole("status").filter({ hasText: "已购买草莓蛋糕，背包中共 1 份" }).waitFor()
  const details = await page.evaluate(() => ({
    state:window.__uiTest.snapshot(),
    calls:window.__uiTest.calls.filter(call => call.action === "buy_shop_item"),
  }))
  assert.equal(details.calls.length, 2)
  assert.deepEqual(details.calls[0].args, details.calls[1].args)
  assert.equal(details.state.shop.coins, 60)
  assert.equal(details.state.shop.catalog.find(item => item.id === "cake").quantity, 1)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("an incomplete purchase response requires checking the same request", async () => {
  const page = await pageFor({}, "?page=shop")
  await page.evaluate(() => {
    window.__uiTest.responseOverrideAction = "buy_shop_item"
    window.__uiTest.responseOverride = { quantity: 1 }
  })
  await page.locator('[data-product="cake"]').getByRole("button", { name: "购买", exact: true }).click()
  await page.getByRole("button", { name: "确认上次操作", exact: true }).waitFor({ timeout: 2500 })
  await page.evaluate(() => { window.__uiTest.responseOverrideAction = "" })
  await page.locator(".lwy-shop-wallet").getByRole("button", { name: "刷新", exact: true }).click()
  await page.getByRole("button", { name: "确认上次操作", exact: true }).click()
  await page.getByRole("status").filter({ hasText: "已购买草莓蛋糕，背包中共 1 份" }).waitFor()
  const calls = await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "buy_shop_item"))
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].args, calls[1].args)
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().shop.coins), 60)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("a transport error containing a longer error token keeps the original request", async () => {
  const page = await pageFor({}, "?page=shop")
  await page.evaluate(() => {
    window.__uiTest.failAction = "buy_shop_item"
    window.__uiTest.failMessage = "transport: shop_stale_extra"
  })
  await page.locator('[data-product="cake"]').getByRole("button", { name: "购买", exact: true }).click()
  await page.getByRole("button", { name: "确认上次操作", exact: true }).waitFor({ timeout: 2500 })
  await page.evaluate(() => { window.__uiTest.failAction = "" })
  await page.getByRole("button", { name: "确认上次操作", exact: true }).click()
  await page.getByRole("status").filter({ hasText: "已购买草莓蛋糕" }).waitFor()
  const calls = await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "buy_shop_item"))
  assert.deepEqual(calls[0].args, calls[1].args)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("a structured rejection code clears the rejected request and requires refresh", async () => {
  const page = await pageFor({}, "?page=shop")
  await page.evaluate(() => {
    window.__uiTest.failAction = "buy_shop_item"
    window.__uiTest.failMessage = "Request rejected"
    window.__uiTest.failCode = "shop_stale"
  })
  await page.locator('[data-product="cake"]').getByRole("button", { name: "购买", exact: true }).click()
  await page.getByRole("alert").filter({ hasText: "商店数据已更新" }).waitFor({ timeout: 2500 })
  assert.equal(await page.getByRole("button", { name: "确认上次操作", exact: true }).count(), 0)
  await page.evaluate(() => { window.__uiTest.failAction = "" })
  await page.locator(".lwy-shop-wallet").getByRole("button", { name: "刷新", exact: true }).click()
  await page.locator('[data-product="cake"]').getByRole("button", { name: "购买", exact: true }).click()
  await page.getByRole("status").filter({ hasText: "已购买草莓蛋糕" }).waitFor()
  const calls = await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "buy_shop_item"))
  assert.notEqual(calls[0].args.request_id, calls[1].args.request_id)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("lost gift response can be checked in the modal without another gift or affection change", async () => {
  const page = await pageFor({}, "?page=shop")
  await page.locator('[data-product="cake"]').getByRole("button", { name: "购买", exact: true }).click()
  await page.getByRole("status").filter({ hasText: "已购买草莓蛋糕" }).waitFor()
  await page.getByRole("button", { name: "背包", exact: true }).click()
  await page.getByRole("button", { name: "送礼", exact: true }).click()
  await page.evaluate(() => { window.__uiTest.failAfterAction = "send_shop_gift" })
  await page.getByRole("dialog").getByRole("button", { name: "确认送出", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: "确认上次操作", exact: true }).waitFor()
  await page.evaluate(() => { window.__uiTest.failAfterAction = "" })
  await page.getByRole("dialog").getByRole("button", { name: "确认上次操作", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  const result = await page.evaluate(() => ({
    state:window.__uiTest.snapshot(), calls:window.__uiTest.calls.filter(call => call.action === "send_shop_gift"),
  }))
  assert.equal(result.state.shop.history.length, 1)
  assert.equal(result.state.scopes[0].affection, 69)
  assert.deepEqual(result.calls[0].args, result.calls[1].args)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("shop purchases work inside the same opaque sandbox used by Hosted UI", async () => {
  const page = await pageFor({}, "?art=off")
  const response = await page.request.get(`${url}/?page=shop&art=off`)
  await page.setContent('<iframe title="Hosted shop" sandbox="allow-scripts" style="width:980px;height:740px"></iframe>')
  await page.locator("iframe").evaluate((frame, html) => { frame.srcdoc = html }, await response.text())
  const frame = page.frameLocator("iframe")
  await frame.locator('[data-product="cake"]').getByRole("button", { name: "购买", exact: true }).click()
  await frame.getByRole("status").filter({ hasText: "已购买草莓蛋糕，背包中共 1 份" }).waitFor()
  assert.equal(await frame.locator(".lwy-shop-balance strong").textContent(), "60")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("gift response failure offers response retry without consuming another gift", async () => {
  const page = await pageFor({ viewport: { width: 390, height: 844 } }, "?page=shop")
  await page.locator('[data-product="cake"]').getByRole("button", { name: "购买", exact: true }).click()
  await page.getByRole("status").filter({ hasText: "已购买草莓蛋糕" }).waitFor()
  await page.getByRole("button", { name: "背包", exact: true }).click()
  await page.getByRole("button", { name: "送礼", exact: true }).click()
  await page.evaluate(() => { window.__uiTest.reaction = "unavailable"; window.__uiTest.delay = 250 })
  await page.getByRole("dialog").getByRole("button", { name: "确认送出", exact: true }).click()
  await page.keyboard.press("Escape")
  assert.equal(await page.getByRole("dialog").isVisible(), true)
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  await page.getByRole("button", { name: "赠送记录", exact: true }).click()
  await page.getByRole("button", { name: "重新请求回应", exact: true }).waitFor()
  const before = await page.evaluate(() => window.__uiTest.snapshot())
  await page.screenshot({ path: `${artifacts}/shop-response-failure-mobile.png` })
  await page.evaluate(() => { window.__uiTest.reaction = "submitted" })
  await page.getByRole("button", { name: "重新请求回应", exact: true }).click()
  await page.locator(".lwy-shop-log-status").getByText("已请求猫娘回应，等待聊天中的回复", { exact: true }).waitFor()
  const after = await page.evaluate(() => window.__uiTest.snapshot())
  assert.deepEqual(after.shop.catalog, before.shop.catalog)
  assert.equal(after.shop.coins, before.shop.coins)
  assert.equal(after.scopes[0].affection, before.scopes[0].affection)
  assert.equal(after.shop.history.length, 1)
  await noHorizontalOverflow(page)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("shop blocks stale purchases until a successful refresh and never repeats an acknowledged purchase", async () => {
  const page = await pageFor({}, "?page=shop")
  await page.evaluate(() => { window.__uiTest.failRefresh = true })
  await page.locator('[data-product="cake"]').getByRole("button", { name: "购买", exact: true }).click()
  await page.getByRole("status").filter({ hasText: "已购买草莓蛋糕" }).waitFor()
  assert.equal(await page.locator('[data-product="tea"]').getByRole("button").isDisabled(), true)
  assert.equal(await page.getByRole("button", { name: "确认上次操作", exact: true }).count(), 0)
  await page.evaluate(() => { window.__uiTest.failRefresh = false })
  await page.locator(".lwy-notices").getByRole("button", { name: "刷新", exact: true }).click()
  await page.locator(".lwy-notices").waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "buy_shop_item").length), 1)
  assert.equal(await page.locator(".lwy-shop-balance strong").textContent(), "60")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("full affection leaves gifts in the bag and the shop works without characters", async () => {
  const page = await pageFor({}, "?page=shop")
  await page.locator('[data-product="tea"]').getByRole("button", { name: "购买", exact: true }).click()
  await page.getByRole("status").filter({ hasText: "已购买暖心红茶" }).waitFor()
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    state.scopes[0].affection = 100
    window.__uiTest.update({scopes:state.scopes})
  })
  await page.getByRole("button", { name: "背包", exact: true }).click()
  assert.equal(await page.getByRole("button", { name: "送礼", exact: true }).isDisabled(), true)
  await page.getByText("今天可增加的好感已用完，或对方好感已满。礼物保留在背包中。", { exact: true }).waitFor()
  await page.evaluate(() => window.__uiTest.update({current_character:null, known_characters:[], scopes:[]}))
  await page.getByText("还没有可选角色，请先在设置中刷新角色。", { exact: true }).waitFor()
  assert.equal(await page.getByRole("button", { name: "送礼", exact: true }).isDisabled(), true)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("chat progress never credits gold before a manual claim and each step is independent", async () => {
  const page = await pageFor({}, "?page=shop")
  await page.evaluate(() => {
    window.__incomeShopNode = document.querySelector(".lwy-shop-wallet")
    const state = window.__uiTest.snapshot()
    state.shop.income.count = 8
    state.shop.income.steps.forEach(step => { step.ready = true })
    window.__uiTest.update({shop:state.shop})
  })
  assert.equal(await page.locator(".lwy-shop-balance strong").textContent(), "100")
  assert.equal(await page.locator(".lwy-shop-income-notice").textContent(), "")
  assert.equal(await page.getByRole("button", {name:"领取",exact:true}).count(), 3)
  await page.locator(".lwy-shop-step").nth(2).getByRole("button", {name:"领取",exact:true}).click()
  await page.getByText("相伴奖励已领取 +10 金币", { exact:true }).waitFor()
  assert.equal(await page.evaluate(() => window.__incomeShopNode === document.querySelector(".lwy-shop-wallet")), true)
  await page.getByText("今日已领取 10 / 30 金币", { exact:true }).waitFor()
  assert.equal(await page.getByRole("button", {name:"领取",exact:true}).count(), 2)
  await page.locator(".lwy-shop-step").nth(2).getByText("已领取 +10", {exact:true}).waitFor()
  assert.equal(await page.locator(".lwy-shop-balance strong").textContent(), "110")
  await page.getByRole("button", {name:"收支记录",exact:true}).click()
  await page.getByRole("region", {name:"收支记录",exact:true}).getByText("相伴奖励", {exact:true}).waitFor()
  await page.getByText("当时余额 110", {exact:true}).waitFor()
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

for (const failure of ["before", "after"]) test(`manual claim retries a ${failure}-save failure without duplicate gold`, async () => {
  const page = await pageFor({}, "?page=shop")
  await page.evaluate(failure => {
    if (failure === "before") window.__uiTest.failAction = "claim_shop_coins"
    else window.__uiTest.failAfterAction = "claim_shop_coins"
  }, failure)
  await page.locator(".lwy-shop-step").nth(0).getByRole("button", {name:"领取",exact:true}).click()
  await page.getByRole("button", {name:"确认上次操作",exact:true}).waitFor()
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().shop.coins), failure === "before" ? 100 : 110)
  assert.equal(await page.locator(".lwy-shop-step").nth(1).getByRole("button").isDisabled(), true)
  await page.evaluate(() => { window.__uiTest.failAction = ""; window.__uiTest.failAfterAction = "" })
  await page.getByRole("button", {name:"确认上次操作",exact:true}).click()
  await page.getByText("今日已领取 10 / 30 金币", {exact:true}).waitFor()
  const detail = await page.evaluate(() => ({
    shop:window.__uiTest.snapshot().shop,
    calls:window.__uiTest.calls.filter(call => call.action === "claim_shop_coins"),
  }))
  assert.equal(detail.shop.coins, 110)
  assert.equal(detail.shop.ledger.length, 1)
  assert.deepEqual(detail.calls[0].args, detail.calls[1].args)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("rapid claim clicks submit once and block other shop actions until saved", async () => {
  const page = await pageFor({}, "?page=shop")
  await page.evaluate(() => { window.__uiTest.delay = 250 })
  await page.locator(".lwy-shop-step").nth(0).getByRole("button").evaluate(button => {
    button.click(); button.click(); button.click()
  })
  assert.equal(await page.locator('[data-product="tea"]').getByRole("button").isDisabled(), true)
  await page.getByText("今日已领取 10 / 30 金币", {exact:true}).waitFor()
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "claim_shop_coins").length), 1)
  assert.equal(await page.locator(".lwy-shop-balance strong").textContent(), "110")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("weekly and previous-period rewards can be claimed individually on mobile", async () => {
  const page = await pageFor({viewport:{width:320,height:740}}, "?page=shop")
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    state.shop.income.weekly_days = 4
    state.shop.income.weekly.ready = true
    const yesterday = new Date(state.today+"T12:00:00Z")
    yesterday.setUTCDate(yesterday.getUTCDate()-1)
    state.shop.income.pending = [{
      reward:"daily_8",period:yesterday.toISOString().slice(0,10),coins:10,claimed:false,ready:true,
    }]
    window.__uiTest.update({shop:state.shop})
  })
  const weeklyClaim = page.locator(".lwy-shop-income > .lwy-shop-week").getByRole("button", {name:"领取",exact:true})
  await weeklyClaim.waitFor()
  await noHorizontalOverflow(page)
  await page.screenshot({path:`${artifacts}/gold-claims-mobile.png`,fullPage:true})
  await weeklyClaim.click()
  await page.getByText("已领取 +40", {exact:true}).waitFor()
  await page.locator(".lwy-shop-unclaimed").getByRole("button", {name:"领取",exact:true}).click()
  await page.locator(".lwy-shop-unclaimed").waitFor({state:"hidden"})
  const state = await page.evaluate(() => window.__uiTest.snapshot())
  assert.equal(state.shop.coins, 150)
  assert.equal(state.shop.income.earned, 0)
  assert.equal(state.shop.income.weekly_paid, true)
  assert.deepEqual(state.shop.ledger.map(item => item.source), ["daily_8","weekly"])
  await noHorizontalOverflow(page)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("care-only gifting at full affection is explicit and cannot be used twice", async () => {
  const page = await pageFor({viewport:{width:390,height:844}}, "?page=shop")
  await page.locator('[data-product="tea"]').getByRole("button", {name:"购买",exact:true}).click()
  await page.getByRole("status").filter({hasText:"已购买暖心红茶"}).waitFor()
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    state.scopes[0].affection = 100
    window.__uiTest.update({scopes:state.scopes})
  })
  await page.getByRole("button", {name:"背包",exact:true}).click()
  assert.equal(await page.getByRole("button", {name:"送礼",exact:true}).isDisabled(), true)
  await page.getByLabel("赠送方式", {exact:true}).selectOption("gesture")
  await page.getByRole("button", {name:"送礼",exact:true}).click()
  await page.getByRole("dialog").getByText("本次好感 +0，将消耗背包中的一份礼物。", {exact:true}).waitFor()
  await page.screenshot({path:`${artifacts}/economy-gesture-mobile.png`})
  await page.getByRole("dialog").getByRole("button", {name:"确认送出",exact:true}).click()
  await page.getByRole("dialog").waitFor({state:"hidden"})
  const state = await page.evaluate(() => window.__uiTest.snapshot())
  assert.equal(state.scopes[0].affection, 100)
  assert.equal(state.shop.gift_remaining, 4)
  assert.equal(state.shop.can_gesture, false)
  assert.equal(state.shop.history[0].applied, 0)
  await page.getByText("今天已经表达过心意了，礼物保留在背包中。", {exact:true}).waitFor()
  await noHorizontalOverflow(page)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("partially effective gifts offer smaller stocked gifts before consumption", async () => {
  const page = await pageFor({}, "?page=shop")
  await page.locator('[data-product="plush"]').getByRole("button", {name:"购买",exact:true}).click()
  await page.getByRole("status").filter({hasText:"已购买柔软玩偶"}).waitFor()
  await page.locator('[data-product="tea"]').getByRole("button", {name:"购买",exact:true}).click()
  await page.getByRole("status").filter({hasText:"已购买暖心红茶"}).waitFor()
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    state.scopes[0].affection = 99
    window.__uiTest.update({scopes:state.scopes})
  })
  await page.getByRole("button", {name:"背包",exact:true}).click()
  await page.locator('[data-product="plush"]').getByRole("button", {name:"送礼",exact:true}).click()
  await page.getByRole("dialog").getByText("这份礼物原本最多 +4，本次受剩余额度或好感上限限制。", {exact:true}).waitFor()
  await page.getByRole("dialog").getByRole("button", {name:"暖心红茶",exact:true}).click()
  await page.getByRole("dialog").getByRole("button", {name:"确认送出",exact:true}).click()
  await page.getByRole("dialog").waitFor({state:"hidden"})
  const state = await page.evaluate(() => window.__uiTest.snapshot())
  assert.equal(state.scopes[0].affection, 100)
  assert.equal(state.shop.catalog.find(item => item.id === "plush").quantity, 1)
  assert.equal(state.shop.history[0].item_id, "tea")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("a changed relationship rejects the gift and requires refresh and a fresh confirmation", async () => {
  const page = await pageFor({}, "?page=shop")
  await page.locator('[data-product="cake"]').getByRole("button", {name:"购买",exact:true}).click()
  await page.getByRole("status").filter({hasText:"已购买草莓蛋糕"}).waitFor()
  await page.getByRole("button", {name:"背包",exact:true}).click()
  await page.getByRole("button", {name:"送礼",exact:true}).click()
  await page.evaluate(() => {
    window.__uiTest.failAction = "send_shop_gift"
    window.__uiTest.failMessage = "shop_gain_changed"
  })
  await page.getByRole("dialog").getByRole("button", {name:"确认送出",exact:true}).click()
  await page.getByRole("dialog").getByText("好感或额度已变化，请刷新后重新确认，礼物未消耗。", {exact:true}).waitFor()
  assert.equal(await page.getByRole("dialog").getByRole("button", {name:"确认送出",exact:true}).isDisabled(), true)
  assert.equal(await page.getByRole("dialog").getByRole("button", {name:"确认上次操作",exact:true}).count(), 0)
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().shop.catalog.find(item => item.id === "cake").quantity), 1)
  await page.evaluate(() => { window.__uiTest.failAction = "" })
  await page.getByRole("dialog").getByRole("button", {name:"刷新",exact:true}).click()
  await page.getByRole("dialog").getByRole("button", {name:"确认送出",exact:true}).click()
  await page.getByRole("dialog").waitFor({state:"hidden"})
  const calls = await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "send_shop_gift"))
  assert.notEqual(calls[0].args.request_id, calls[1].args.request_id)
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().shop.history.length), 1)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("income connection, date and upgrade states remain visible without fabricating progress", async () => {
  const page = await pageFor({viewport:{width:320,height:740}}, "?page=shop")
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    state.shop.bus_ok = false
    state.shop.income_error = "save_failed"
    state.shop.income.clock_error = true
    state.shop.income.legacy_claimed = true
    state.scopes[0].quota_blocked = true
    window.__uiTest.update({shop:state.shop,scopes:state.scopes})
  })
  await page.getByText("暂时读不到聊天，收入进度尚未同步。", {exact:true}).waitFor()
  await page.getByText("本机日期早于已记录日期，请校正日期后刷新。", {exact:true}).waitFor()
  await page.getByText("今天已领取旧版签到奖励，日常奖励不重复发放。", {exact:true}).waitFor()
  await noHorizontalOverflow(page)
  assert.equal(await page.locator(".lwy-shop-balance strong").textContent(), "100")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("all six pages fit desktop, narrow and mobile viewports in both themes", async () => {
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

test("overview artwork stays with its content and scales smoothly in compact host panels", async () => {
  const page = await pageFor({ viewport: { width: 980, height: 510 } })
  await page.locator(".lwy-art img").waitFor()
  await page.locator(".lwy-art img").evaluate(image => image.decode())
  const geometry = () => page.evaluate(() => {
    const art = document.querySelector(".lwy-art").getBoundingClientRect()
    const footer = document.querySelector(".lwy-overview-footer").getBoundingClientRect()
    return { top: art.top, bottom: art.bottom, width: art.width, height: art.height,
      footerTop: footer.top, scroll: document.querySelector(".lwy-workspace").scrollTop }
  })
  const initial = await geometry()
  await page.locator(".lwy-workspace").evaluate(node => { node.scrollTop = 180 })
  await settle(page)
  const scrolled = await geometry()
  assert.ok(scrolled.scroll > 0)
  assert.ok(Math.abs(initial.top - scrolled.top - scrolled.scroll) < 1,
    "artwork must leave the viewport with its original content")
  assert.ok(scrolled.bottom <= scrolled.footerTop, "artwork must not cover the overview footer")
  await page.screenshot({ path: `${artifacts}/portrait-scrolled.png` })
  await page.locator(".lwy-workspace").evaluate(node => { node.scrollTop = 0 })
  let previous
  for (const width of [980, 961, 960, 900, 899, 848, 740, 701, 700, 601, 600, 481, 480, 390, 320]) {
    await page.setViewportSize({ width, height: 510 })
    await settle(page)
    const current = await geometry()
    if (width >= 740) assert.ok(current.height >= 296, `portrait remains prominent at ${width}px`)
    if (previous) {
      const allowance = (previous.viewport - width) * 0.5 + 1
      assert.ok(Math.abs(current.width - previous.width) <= allowance, `smooth width at ${width}px`)
      assert.ok(Math.abs(current.height - previous.height) <= allowance, `smooth height at ${width}px`)
    }
    assert.ok(current.bottom <= current.footerTop, `footer stays clear at ${width}px`)
    await noHorizontalOverflow(page)
    if ([900, 899, 848, 600, 390].includes(width)) {
      await page.screenshot({ path: `${artifacts}/portrait-${width}.png` })
    }
    previous = { ...current, viewport: width }
  }
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("pointer hover, press and release are distinct without moving controls or firing early", async () => {
  const page = await pageFor({ reducedMotion: "no-preference" })
  const button = page.locator(".lwy-nav").getByRole("button", { name: "纪念日", exact: true })
  const before = await button.boundingBox()
  await page.mouse.move(940, 700)
  const idle = await button.evaluate(node => getComputedStyle(node).boxShadow)
  await button.hover()
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.lwy-nav button[aria-label="纪念日"]')).boxShadow !== "none")
  assert.notEqual(await button.evaluate(node => getComputedStyle(node).boxShadow), idle)
  assert.deepEqual(await button.boundingBox(), before)
  await page.mouse.down()
  assert.equal(await button.getAttribute("data-lwy-pressed"), "")
  assert.equal(await page.locator("h1").textContent(), "关系概览")
  assert.deepEqual(await button.boundingBox(), before)
  await page.screenshot({ path: `${artifacts}/interaction-pressed.png` })
  // Pause just the short confirmation animation to inspect it deterministically.
  await page.evaluate(() => document.addEventListener("click", event => {
    for (const animation of event.target.closest("button")?.getAnimations() || []) {
      if (animation.effect.getTiming().duration === 180) animation.pause()
    }
  }, { once: true }))
  await page.mouse.up()
  assert.equal(await button.getAttribute("data-lwy-pressed"), null)
  assert.equal(await page.locator("h1").textContent(), "纪念日")
  assert.equal(await button.evaluate(node => node.getAnimations().filter(animation =>
    animation.effect.getTiming().duration === 180).length), 1)
  assert.deepEqual(await button.boundingBox(), before)
  assert.equal(await page.locator(".lwy-feedback").count(), 0)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("dragging out, cancellation, scrolling and losing focus clear press feedback without activation", async () => {
  const page = await pageFor({ reducedMotion: "no-preference" })
  const button = page.locator(".lwy-nav").getByRole("button", { name: "礼物商店", exact: true })
  await button.hover()
  await page.mouse.down()
  await page.mouse.move(600, 450)
  assert.equal(await button.getAttribute("data-lwy-pressed"), null)
  await page.mouse.up()
  assert.equal(await page.locator("h1").textContent(), "关系概览")
  await button.hover()
  await page.mouse.down()
  await page.mouse.move(600, 450)
  await button.hover()
  assert.equal(await button.getAttribute("data-lwy-pressed"), "")
  await page.evaluate(() => window.dispatchEvent(new Event("blur")))
  assert.equal(await page.locator("[data-lwy-pressed]").count(), 0)
  await page.mouse.move(600, 450)
  await page.mouse.up()
  for (const cancel of ["pointercancel", "scroll"]) {
    await button.hover()
    await page.mouse.down()
    await page.evaluate(type => document.dispatchEvent(new Event(type)), cancel)
    assert.equal(await page.locator("[data-lwy-pressed]").count(), 0)
    await page.mouse.move(600, 450)
    await page.mouse.up()
  }
  assert.equal(await page.locator("h1").textContent(), "关系概览")
  assert.equal(await page.evaluate(() => window.__uiTest.calls.some(call => call.action === "buy_shop_item")), false)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("keyboard and reduced motion keep immediate feedback and touch does not retain hover", async () => {
  const page = await pageFor()
  const button = page.locator(".lwy-nav").getByRole("button", { name: "心动记录", exact: true })
  await button.focus()
  await page.keyboard.down(" ")
  assert.equal(await button.getAttribute("data-lwy-pressed"), "")
  assert.equal(await page.locator("h1").textContent(), "关系概览")
  await page.keyboard.up(" ")
  assert.equal(await page.locator("h1").textContent(), "心动记录")
  assert.equal(await page.locator("[data-lwy-pressed]").count(), 0)
  assert.equal(await button.evaluate(node => getComputedStyle(node).transitionDuration), "0s")
  assert.equal(await button.evaluate(node => node.getAnimations().length), 0)
  await navigate(page, "设置")
  const save = page.locator(".lwy-appearance").getByRole("button", { name: "保存", exact: true })
  await save.dispatchEvent("pointerdown", { button: 0, pointerId: 1, isPrimary: true, pointerType: "mouse" })
  assert.equal(await save.getAttribute("data-lwy-pressed"), null)
  await page.getByRole("button", { name: "调整", exact: true }).click()
  const cancel = page.getByRole("dialog").getByRole("button", { name: "取消", exact: true })
  await cancel.focus()
  await page.keyboard.down("Enter")
  await page.keyboard.up("Enter")
  assert.equal(await page.getByRole("dialog").count(), 0)
  assert.equal(await page.locator("[data-lwy-pressed]").count(), 0)
  assert.deepEqual(page.uiErrors, [])
  await page.close()

  const touch = await pageFor({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  const shop = touch.locator(".lwy-nav").getByRole("button", { name: "礼物商店", exact: true })
  await shop.tap()
  assert.equal(await touch.locator("h1").textContent(), "礼物商店")
  assert.equal(await touch.locator("[data-lwy-pressed]").count(), 0)
  assert.equal(await touch.evaluate(() => document.documentElement.dataset.lwyPointer), "touch")
  assert.equal(await shop.evaluate(node => getComputedStyle(node).boxShadow), "none")
  assert.deepEqual(touch.uiErrors, [])
  await touch.close()
})

test("purchase marks only its source busy, preserves dimensions and confirms the real result", async () => {
  const page = await pageFor({}, "?page=shop")
  const buy = page.locator('[data-product="cake"]').getByRole("button", { name: "购买", exact: true })
  await buy.scrollIntoViewIfNeeded()
  const before = await buy.boundingBox()
  await page.evaluate(() => { window.__uiTest.delay = 450; window.__uiTest.refreshDelay = 450 })
  await buy.click()
  await page.waitForFunction(() => document.querySelector('[data-product="cake"] button').getAttribute("aria-busy") === "true")
  assert.equal(await page.locator("[data-lwy-pending]").count(), 1)
  assert.equal(await buy.isDisabled(), true)
  assert.deepEqual(await buy.boundingBox(), before)
  assert.equal(await page.locator(".lwy-shop-balance strong").textContent(), "100")
  await page.locator(".lwy-feedback-dock").getByRole("status").filter({ hasText: "已购买草莓蛋糕" }).waitFor()
  assert.equal(await page.locator(".lwy-shop-balance strong").textContent(), "60")
  assert.equal(await page.locator("[data-lwy-pending], [aria-busy='true']").count(), 0)
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "buy_shop_item").length), 1)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("save labels reserve their size during a slow request and expose only the current label", async () => {
  for (const locale of ["zh-CN", "en"]) {
    const page = await pageFor({}, `?page=settings&locale=${locale}`)
    await page.locator('.lwy-custom-color input[type="color"]').fill("#8cb878")
    const save = page.locator('.lwy-appearance button[data-tone="primary"]')
    await save.scrollIntoViewIfNeeded()
    const before = await save.boundingBox()
    await page.evaluate(() => { window.__uiTest.delay = 350; window.__uiTest.refreshDelay = 450 })
    await save.click()
    await page.waitForFunction(() => document.querySelector(".lwy-appearance [data-lwy-pending]"))
    const pending = await save.boundingBox()
    assert.equal(pending.width, before.width)
    assert.equal(pending.height, before.height)
    assert.equal(await save.getAttribute("aria-busy"), "true")
    assert.equal(await page.locator(".lwy-appearance").getByRole("button", {
      name: locale === "en" ? "Saving..." : "保存中…", exact: true,
    }).count(), 1)
    await page.locator(".lwy-feedback-dock[data-tone='success']").waitFor()
    const after = await save.boundingBox()
    assert.equal(after.width, before.width)
    assert.equal(after.height, before.height)
    assert.equal(await save.getAttribute("aria-busy"), null)
    assert.deepEqual(page.uiErrors, [])
    await page.close()
  }
})

test("pending switches keep the requested state and rejected or canceled changes restore the saved value", async () => {
  const page = await pageFor({}, "?page=settings")
  const toggle = page.getByRole("checkbox", { name: "自动判断好感", exact: true })
  await page.evaluate(() => { window.__uiTest.delay = 450; window.__uiTest.failAction = "set_settings" })
  await toggle.click()
  assert.equal(await toggle.getAttribute("data-lwy-pending-checked"), "false")
  assert.equal(await toggle.getAttribute("aria-busy"), "true")
  assert.equal(await toggle.evaluate(node => getComputedStyle(node, "::after").transform), "matrix(1, 0, 0, 1, 0, 0)")
  await page.locator(".lwy-feedback-dock[data-tone='danger']").waitFor()
  assert.equal(await toggle.isChecked(), true)
  assert.equal(await toggle.getAttribute("aria-busy"), null)
  await page.evaluate(() => { window.__uiTest.failAction = "" })
  await toggle.click()
  await page.locator(".lwy-feedback-dock[data-tone='success']").waitFor()
  assert.equal(await toggle.isChecked(), false)
  assert.equal(await toggle.getAttribute("data-lwy-pending-checked"), null)
  for (const label of ["成为恋人需要告白", "每个角色独立好感", "好感随时间变淡"]) {
    const input = page.getByRole("checkbox", { name: label, exact: true })
    const saved = await input.isChecked()
    await input.click()
    await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click()
    assert.equal(await input.isChecked(), saved, label)
  }
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call =>
    call.action === "set_settings" || call.action === "set_per_character").length), 2)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("success notices dismiss quietly but pause for hover and keyboard reading", async () => {
  const page = await pageFor({ reducedMotion: "no-preference" }, "?page=shop")
  await page.clock.install()
  await page.locator('[data-product="tea"]').getByRole("button", { name: "购买", exact: true }).click()
  const notice = page.locator(".lwy-feedback-dock")
  await notice.getByRole("status").filter({ hasText: "已购买" }).waitFor()
  await page.clock.runFor(1000)
  await notice.hover()
  await page.clock.runFor(14000)
  assert.equal(await notice.count(), 1)
  await page.mouse.move(2, 2)
  await notice.getByRole("button", { name: "关闭提示", exact: true }).focus()
  await page.clock.runFor(14000)
  assert.equal(await notice.count(), 1)
  await page.locator(".lwy-nav button").first().focus()
  await page.clock.runFor(5200)
  assert.equal(await notice.count(), 0)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("rapid presses replace release feedback and color choices do not submit or shift", async () => {
  const page = await pageFor({ reducedMotion: "no-preference" }, "?page=settings")
  const palette = page.getByRole("button", { name: "晴空蓝", exact: true })
  await palette.scrollIntoViewIfNeeded()
  const before = await palette.boundingBox()
  await palette.hover()
  for (let n = 0; n < 6; n++) {
    await page.mouse.down()
    assert.equal(await palette.getAttribute("data-lwy-pressed"), "")
    await page.mouse.up()
  }
  assert.equal(await palette.getAttribute("aria-pressed"), "true")
  assert.equal(await palette.getAttribute("data-lwy-pressed"), null)
  assert.deepEqual(await palette.boundingBox(), before)
  assert.ok(await palette.evaluate(node => node.getAnimations().filter(animation =>
    animation.effect.getTiming().duration === 180).length) <= 1)
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "set_appearance").length), 0)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await settle(page)
  assert.equal(await palette.evaluate(node => node.getAnimations().length), 0)
  await palette.click()
  assert.equal(await palette.evaluate(node => node.getAnimations().length), 0)
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme })
    const mint = page.getByRole("button", { name: "薄荷绿", exact: true })
    await mint.hover()
    await page.mouse.down()
    await page.screenshot({ path: `${artifacts}/interaction-palette-${colorScheme}.png` })
    await page.mouse.move(940, 700)
    await page.mouse.up()
    assert.equal(await page.locator("[data-lwy-pressed]").count(), 0)
  }
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("warnings and errors persist and a new operation never inherits an old success timer", async () => {
  const page = await pageFor({}, "?page=shop")
  await page.clock.install()
  const buy = id => page.locator(`[data-product="${id}"]`).getByRole("button", { name: "购买", exact: true })
  await buy("tea").click()
  await page.locator(".lwy-feedback-dock[data-tone='success']").waitFor()
  await page.clock.runFor(3000)
  await page.evaluate(() => { window.__uiTest.failAction = "buy_shop_item" })
  await buy("tea").click()
  await page.locator(".lwy-feedback-dock[data-tone='danger']").waitFor()
  await page.clock.runFor(20000)
  assert.equal(await page.locator(".lwy-feedback-dock[data-tone='danger']").count(), 1)
  assert.equal(await page.locator("[data-lwy-pending], [aria-busy='true']").count(), 0)
  await page.evaluate(() => { window.__uiTest.failAction = ""; window.__uiTest.failRefresh = true })
  await page.getByRole("button", { name: "确认上次操作", exact: true }).click()
  await page.locator(".lwy-feedback-dock[data-tone='warning']").waitFor()
  await page.clock.runFor(20000)
  assert.equal(await page.locator(".lwy-feedback-dock[data-tone='warning']").count(), 1)
  assert.equal(await page.locator("[data-lwy-pending], [aria-busy='true']").count(), 0)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("desktop navigation groups daily activities, keeps settings last and preserves manual toggles", async () => {
  const page = await pageFor()
  assert.equal(await page.locator(".sidebar-collapsed").count(), 0)
  assert.deepEqual(await page.locator(".lwy-nav button").evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label"))),
    ["关系概览", "共同经历", "礼物商店", "心动记录", "纪念日", "专属称呼", "设置"])
  assert.equal(await page.getByRole("group", { name: "日常相处", exact: true }).getByRole("button").count(), 3)
  assert.equal(await page.getByRole("group", { name: "关系记录", exact: true }).getByRole("button").count(), 3)
  assert.equal(await page.locator(".lwy-nav button:visible").count(), 7)
  await page.getByRole("button", { name: "收起侧栏", exact: true }).click()
  await navigate(page, "纪念日")
  await page.evaluate(() => window.__uiTest.update({ host_online: false }))
  assert.equal(await page.locator(".sidebar-collapsed").count(), 1)
  assert.equal(await page.locator("h1").textContent(), "纪念日")
  await page.getByRole("button", { name: "展开侧栏", exact: true }).click()
  await page.evaluate(() => window.__uiTest.update({ host_online: true }))
  assert.equal(await page.locator(".sidebar-collapsed").count(), 0)
  await page.getByRole("button", { name: "收起侧栏", exact: true }).click()
  assert.equal(await page.locator(".sidebar-collapsed").count(), 1)
  await noHorizontalOverflow(page)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("nickname edits survive navigation, character changes and background updates", async () => {
  const page = await pageFor()
  await navigate(page, "专属称呼")
  await editNickname(page, "陌生", "初见的称呼")
  await page.locator(".lwy-scope select").selectOption("茉子")
  await editNickname(page, "陌生", "另一个称呼")
  await page.locator(".lwy-scope select").selectOption("YUI")
  assert.equal(await nickname(page, "陌生").inputValue(), "初见的称呼")
  await navigate(page, "关系概览")
  await navigate(page, "专属称呼")
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    state.scopes[0].nicknames.familiar = "后台更新的称呼"
    window.__uiTest.update({ scopes: state.scopes })
  })
  assert.equal(await nickname(page, "陌生").inputValue(), "初见的称呼")
  await page.getByRole("button", { name: "撤销修改", exact: true }).click()
  assert.equal(await nickname(page, "熟悉").inputValue(), "后台更新的称呼")
  assert.equal(await page.getByRole("combobox", { name: "陌生", exact: true }).inputValue(), "inherit")
  await page.locator(".lwy-scope select").selectOption("茉子")
  assert.equal(await nickname(page, "陌生").inputValue(), "另一个称呼")
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await page.waitForFunction(() => window.__uiTest.calls.some(call => call.action === "set_addressing"))
  const call = await page.evaluate(() => window.__uiTest.calls.find(call => call.action === "set_addressing"))
  assert.equal(call.args.scope, "茉子")
  assert.equal(call.args.changes.stages.stranger.text, "另一个称呼")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("nickname save merges background changes to untouched stages", async () => {
  const page = await pageFor()
  await navigate(page, "专属称呼")
  await editNickname(page, "陌生", "my draft")
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    state.scopes[0].nicknames.familiar = "new friend"
    window.__uiTest.update({ scopes: state.scopes })
  })
  assert.equal(await nickname(page, "熟悉").inputValue(), "new friend")
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await page.waitForFunction(() => window.__uiTest.snapshot().scopes[0].nicknames.stranger === "my draft")
  const saved = await page.evaluate(() => window.__uiTest.snapshot().scopes[0].nicknames)
  assert.equal(saved.familiar, "new friend")
  const call = await page.evaluate(() => window.__uiTest.calls.find(call => call.action === "set_addressing"))
  assert.deepEqual(call.args.changes, { stages: { stranger: { mode: "custom", text: "my draft" } } })
  assert.deepEqual(call.args.expected, { stages: { stranger: { mode: "inherit", text: "" } } })
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("nickname save preserves unrelated changes made while the request is pending", async () => {
  const page = await pageFor()
  await navigate(page, "专属称呼")
  await editNickname(page, "陌生", "my draft")
  await page.evaluate(() => { window.__uiTest.delay = 350 })
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await page.waitForFunction(() => window.__uiTest.calls.some(call => call.action === "set_addressing"))
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    state.scopes[0].nicknames.familiar = "new friend"
    window.__uiTest.update({ scopes: state.scopes })
  })
  await page.waitForFunction(() => window.__uiTest.snapshot().scopes[0].nicknames.stranger === "my draft")
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().scopes[0].nicknames.familiar), "new friend")
  assert.equal(await nickname(page, "熟悉").inputValue(), "new friend")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("nickname conflicts preserve drafts and allow refresh, discard and a new edit", async () => {
  const page = await pageFor()
  await navigate(page, "专属称呼")
  await editNickname(page, "陌生", "my draft")
  await page.evaluate(() => { window.__uiTest.delay = 350 })
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await page.waitForFunction(() => window.__uiTest.calls.some(call => call.action === "set_addressing"))
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    state.scopes[0].nicknames.stranger = "other panel"
    window.__uiTest.update({ scopes: state.scopes })
  })
  await page.getByRole("alert").filter({ hasText: "称呼已在其他位置更新" }).waitFor()
  assert.equal(await nickname(page, "陌生").inputValue(), "my draft")
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().scopes[0].nicknames.stranger), "other panel")
  await page.locator(".lwy-feedback-dock").getByRole("button", { name: "刷新", exact: true }).click()
  await page.getByRole("button", { name: "撤销修改", exact: true }).click()
  assert.equal(await nickname(page, "陌生").inputValue(), "other panel")
  await editNickname(page, "陌生", "revised")
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await page.waitForFunction(() => window.__uiTest.snapshot().scopes[0].nicknames.stranger === "revised")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("nickname save uses normalized server values even when refreshing fails", async () => {
  const page = await pageFor()
  await navigate(page, "专属称呼")
  await editNickname(page, "陌生", "hi  pal")
  await page.evaluate(() => { window.__uiTest.failRefresh = true })
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await page.getByText("称呼已保存 · 显示数据尚未更新，请刷新。", { exact: true }).waitFor()
  assert.equal(await nickname(page, "陌生").inputValue(), "hi pal")
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().scopes[0].nicknames.stranger), "hi pal")
  assert.equal(await page.getByRole("button", { name: "保存", exact: true }).isDisabled(), true)
  await page.evaluate(() => { window.__uiTest.failRefresh = false })
  await page.locator(".lwy-feedback-dock").getByRole("button", { name: "刷新", exact: true }).click()
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "set_addressing").length), 1)
  assert.equal(await nickname(page, "陌生").inputValue(), "hi pal")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("nickname save can retry a committed request whose response was lost", async () => {
  const page = await pageFor()
  await navigate(page, "专属称呼")
  await editNickname(page, "陌生", "saved name")
  await page.evaluate(() => { window.__uiTest.failAfterAction = "set_addressing" })
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await page.getByRole("alert").filter({ hasText: "操作未完成" }).waitFor()
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().scopes[0].nicknames.stranger), "saved name")
  assert.equal(await nickname(page, "陌生").inputValue(), "saved name")
  await page.evaluate(() => { window.__uiTest.failAfterAction = "" })
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await page.getByText("称呼已保存", { exact: true }).waitFor()
  const calls = await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "set_addressing"))
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].args, calls[1].args)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("failed nickname save preserves the draft and supports retry", async () => {
  const page = await pageFor()
  await navigate(page, "专属称呼")
  await editNickname(page, "陌生", "还没保存")
  await page.evaluate(() => { window.__uiTest.failAction = "set_addressing" })
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await page.getByRole("alert").filter({ hasText: "操作未完成，请稍后重试。" }).waitFor()
  assert.equal(await nickname(page, "陌生").inputValue(), "还没保存")
  await page.evaluate(() => { window.__uiTest.failAction = "" })
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await page.waitForFunction(() => window.__uiTest.snapshot().scopes[0].nicknames.stranger === "还没保存")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("address modes preview inheritance barriers, validate empty custom names and reset defaults", async () => {
  const page = await pageFor()
  await navigate(page, "专属称呼")
  const row = stage => page.locator(`[data-stage="${stage}"]`)
  await row("lover").getByText("生效：小可爱 · 自定义 · 好感", { exact: true }).waitFor()
  await page.getByRole("combobox", { name: "好感", exact: true }).selectOption("persona")
  await row("lover").getByText("生效：人设原称呼 · 角色人设 · 好感", { exact: true }).waitFor()
  await page.getByRole("combobox", { name: "陌生", exact: true }).selectOption("custom")
  await page.getByRole("alert").filter({ hasText: "自定义模式需要填写称呼" }).waitFor()
  assert.equal(await page.getByRole("button", { name: "保存", exact: true }).isDisabled(), true)
  await nickname(page, "陌生").fill("阁下")
  await row("familiar").getByText("生效：朋友 · 自定义", { exact: true }).waitFor()
  await page.getByRole("button", { name: "恢复陌生的阶段默认", exact: true }).click()
  assert.equal(await page.getByRole("combobox", { name: "陌生", exact: true }).inputValue(), "auto")
  assert.equal(await nickname(page, "陌生").count(), 0)
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await page.getByText("称呼已保存", { exact: true }).waitFor()
  const saved = await page.evaluate(() => window.__uiTest.snapshot().scopes[0].addressing)
  assert.equal(saved.stages.fond.mode, "persona")
  assert.equal(saved.stages.stranger.mode, "auto")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("modern address defaults, preferred names and avoid-list conflicts are usable", async () => {
  const page = await pageFor()
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    state.scopes[0].confessed = true
    state.scopes[0].addressing = { version: 1,
      stages: Object.fromEntries(state.stages.map(({ key }) => [key, { mode: "auto", text: "" }])),
      endearments: true, preferred_name: "", avoided: [] }
    window.__uiTest.update({ scopes: state.scopes })
  })
  await navigate(page, "专属称呼")
  const lover = page.locator('[data-stage="lover"]')
  await lover.getByText(/人设称呼；可偶尔用「亲爱的」/).waitFor()
  await page.getByLabel("恋爱确认后，允许偶尔使用通用亲昵称呼", { exact: true }).uncheck()
  await lover.getByText("生效：人设原称呼 · 阶段默认", { exact: true }).waitFor()
  await page.getByLabel("偏好名字", { exact: true }).fill("小林")
  await lover.getByText("生效：小林 · 偏好名字", { exact: true }).waitFor()
  await page.getByLabel("添加不接受的称呼", { exact: true }).fill("小林")
  await page.getByRole("button", { name: "添加称呼禁用词", exact: true }).click()
  await page.getByRole("alert").filter({ hasText: "所选名字与禁用词冲突" }).waitFor()
  assert.equal(await page.getByRole("button", { name: "保存", exact: true }).isDisabled(), true)
  await page.getByRole("button", { name: "解除禁用「小林」", exact: true }).click()
  await page.getByLabel("添加不接受的称呼", { exact: true }).fill("宝贝")
  await page.getByRole("button", { name: "添加称呼禁用词", exact: true }).click()
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await page.getByText("称呼已保存", { exact: true }).waitFor()
  const saved = await page.evaluate(() => window.__uiTest.snapshot().scopes[0].addressing)
  assert.deepEqual(saved.avoided, ["宝贝"])
  assert.equal(saved.preferred_name, "小林")
  assert.equal(saved.endearments, false)
  await page.locator(".lwy-workspace").evaluate(node => { node.scrollTop = 0 })
  await page.screenshot({ path: resolve(artifacts, "addressing-desktop.png") })
  await page.locator(".lwy-workspace").evaluate(node => { node.scrollTop = node.scrollHeight })
  await page.screenshot({ path: resolve(artifacts, "addressing-preferences-desktop.png") })
  await noHorizontalOverflow(page)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("address preferences survive concurrent character updates and reject conflicting preferred names", async () => {
  const page = await pageFor()
  await navigate(page, "专属称呼")
  await page.getByLabel("偏好名字", { exact: true }).fill("my name")
  await page.evaluate(() => { window.__uiTest.delay = 350 })
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await page.waitForFunction(() => window.__uiTest.calls.some(call => call.action === "set_addressing"))
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    const names = state.scopes[0].nicknames
    state.scopes[0].addressing = { version: 1, stages: Object.fromEntries(state.stages.map(({ key }) => [
      key, { mode: names[key] ? "custom" : "inherit", text: names[key] || "" },
    ])), endearments: false, preferred_name: "chat name", avoided: ["宝贝"] }
    window.__uiTest.update({ scopes: state.scopes })
  })
  await page.getByRole("alert").filter({ hasText: "称呼已在其他位置更新" }).waitFor()
  assert.equal(await page.getByLabel("偏好名字", { exact: true }).inputValue(), "my name")
  await page.getByRole("button", { name: "解除禁用「宝贝」", exact: true }).waitFor()
  await page.getByRole("button", { name: "撤销修改", exact: true }).click()
  assert.equal(await page.getByLabel("偏好名字", { exact: true }).inputValue(), "chat name")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("one click restores all address defaults immediately and keeps the other role intact", async () => {
  const page = await pageFor({}, "?page=nicknames")
  const before = await page.evaluate(() => window.__uiTest.snapshot())
  await editNickname(page, "陌生", "draft")
  await page.getByLabel("偏好名字", { exact: true }).fill("draft name")
  await page.getByLabel("添加不接受的称呼", { exact: true }).fill("draft avoid")
  await page.getByRole("button", { name: "恢复全部默认", exact: true }).click()
  await page.getByText("当前关系的称呼已全部恢复默认", { exact: true }).waitFor()
  const saved = await page.evaluate(() => window.__uiTest.snapshot())
  assert.deepEqual(saved.scopes[0].addressing, {
    version: 1, stages: Object.fromEntries(saved.stages.map(({ key }) => [key, { mode: "auto", text: "" }])),
    endearments: true, preferred_name: "", avoided: [],
  })
  assert.deepEqual(saved.scopes[0].nicknames, {})
  assert.deepEqual(saved.scopes[1], before.scopes[1])
  for (const key of ["affection", "stage", "history", "milestones"]) assert.deepEqual(saved.scopes[0][key], before.scopes[0][key])
  assert.equal(await page.getByLabel("偏好名字", { exact: true }).inputValue(), "")
  assert.equal(await page.getByLabel("添加不接受的称呼", { exact: true }).inputValue(), "")
  assert.equal(await page.getByRole("button", { name: "恢复全部默认", exact: true }).isDisabled(), true)
  await page.screenshot({ path: resolve(artifacts, "addressing-reset-defaults-desktop.png") })
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("restore defaults keeps drafts on failure and retries a lost response without overwriting changes", async () => {
  const page = await pageFor({}, "?page=nicknames")
  await page.getByLabel("偏好名字", { exact: true }).fill("my draft")
  await page.evaluate(() => { window.__uiTest.failAction = "set_addressing" })
  await page.getByRole("button", { name: "恢复全部默认", exact: true }).click()
  await page.getByRole("alert").filter({ hasText: "操作未完成" }).waitFor()
  assert.equal(await page.getByLabel("偏好名字", { exact: true }).inputValue(), "my draft")
  await page.evaluate(() => { window.__uiTest.failAction = ""; window.__uiTest.failAfterAction = "set_addressing" })
  await page.getByRole("button", { name: "恢复全部默认", exact: true }).click()
  await page.getByRole("alert").filter({ hasText: "操作未完成" }).waitFor()
  await page.evaluate(() => { window.__uiTest.failAfterAction = "" })
  await page.getByRole("button", { name: "恢复全部默认", exact: true }).click()
  await page.getByText("当前关系的称呼已全部恢复默认", { exact: true }).waitFor()
  const calls = await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "set_addressing"))
  assert.equal(calls.length, 3)
  assert.deepEqual(calls[0].args, calls[1].args)
  assert.deepEqual(calls[1].args, calls[2].args)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("a confirmed relationship remains a partnership when closeness falls", async () => {
  const page = await pageFor()
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    Object.assign(state.scopes[0], { confessed: true, stage: "fond", stage_index: 2,
      affection: 42, next_stage: "ambiguous", points_to_next: 18 })
    window.__uiTest.update({ scopes: state.scopes })
  })
  await page.getByText("恋人 · 近期较疏远", { exact: true }).waitFor()
  await page.getByText("当前亲近程度：好感", { exact: true }).waitFor()
  assert.equal(await page.getByText("再 18 点就是「暧昧」", { exact: true }).count(), 0)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

async function prepareRomance(page, affection = 90) {
  await page.evaluate(affection => {
    const state = window.__uiTest.snapshot()
    Object.assign(state.scopes[0], {confessed:true,confessed_on:"2026-11-01",confession:"old romance",
      affection,stage:affection ? "lover" : "stranger",stage_index:affection ? 4 : 0,
      next_stage:affection ? null : "familiar",points_to_next:affection ? 0 : 20})
    state.scopes[0].milestones.lover = "2026-11-01"
    window.__uiTest.update({scopes:state.scopes})
  }, affection)
}

test("zeroing affection explicitly keeps romance and canceling never changes data", async () => {
  const page = await pageFor({}, "?page=settings")
  await prepareRomance(page)
  await page.getByRole("button", {name:"清零好感",exact:true}).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByText(/已确认的恋爱关系、在一起日期和历史保留/).waitFor()
  await dialog.getByRole("button", {name:"取消",exact:true}).click()
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "reset_affection").length), 0)
  await page.getByRole("button", {name:"清零好感",exact:true}).click()
  await dialog.getByRole("button", {name:"清零好感",exact:true}).click()
  await page.getByText("好感已清零，已确认关系保留", {exact:true}).waitFor()
  const state = await page.evaluate(() => window.__uiTest.snapshot())
  assert.equal(state.scopes[0].affection, 0)
  assert.equal(state.scopes[0].confessed, true)
  assert.equal(state.scopes[0].milestones.lover, "2026-11-01")
  await navigate(page, "关系概览")
  await page.getByText("恋人 · 近期较疏远", {exact:true}).waitFor()
  await page.getByText("当前亲近程度：陌生", {exact:true}).waitFor()
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("relationship restart clears zero-affection romance and dates while keeping history and assets", async () => {
  const page = await pageFor({}, "?page=settings")
  await prepareRomance(page, 0)
  const before = await page.evaluate(() => window.__uiTest.snapshot())
  await page.getByRole("button", {name:"重新开始关系",exact:true}).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByText(/将「YUI」的好感清零/).waitFor()
  await page.screenshot({path:`${artifacts}/restart-confirm-desktop.png`})
  await dialog.getByRole("button", {name:"取消",exact:true}).click()
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "restart_relationship").length), 0)
  await page.getByRole("button", {name:"重新开始关系",exact:true}).click()
  await dialog.getByRole("button", {name:"重新开始关系",exact:true}).click()
  await page.getByText("关系已重新开始，当前为陌生", {exact:true}).waitFor()
  const state = await page.evaluate(() => window.__uiTest.snapshot())
  assert.equal(state.scopes[0].confessed, false)
  assert.equal(state.scopes[0].confessed_on, null)
  assert.equal(state.scopes[0].milestones.lover, undefined)
  assert.equal(state.scopes[0].first_met, before.scopes[0].first_met)
  assert.equal(state.scopes[0].history[0].source, "restart")
  assert.equal(state.scopes[0].history.length, before.scopes[0].history.length+1)
  assert.deepEqual(state.scopes[0].nicknames, before.scopes[0].nicknames)
  assert.deepEqual(state.scopes[1], before.scopes[1])
  assert.deepEqual(state.shop, before.shop)
  await navigate(page, "关系概览")
  assert.equal(await page.locator(".lwy-stage-name").textContent(), "陌生")
  assert.equal(await page.getByText("恋人 · 近期较疏远", {exact:true}).count(), 0)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("restart rejects changes made while confirmation is open and requires a fresh confirmation", async () => {
  const page = await pageFor({}, "?page=settings")
  await prepareRomance(page)
  await page.getByRole("button", {name:"重新开始关系",exact:true}).click()
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    state.scopes[0].gain_revision += 1
    state.scopes[0].affection = 95
    window.__uiTest.update({scopes:state.scopes})
  })
  await page.getByRole("dialog").getByRole("button", {name:"重新开始关系",exact:true}).click()
  await page.getByRole("alert").filter({hasText:"关系已发生变化，请刷新后重新确认。"}).waitFor()
  assert.equal(await page.getByRole("button", {name:"重新开始关系",exact:true}).isDisabled(), true)
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().scopes[0].affection), 95)
  await page.locator(".lwy-feedback-dock").getByRole("button", {name:"刷新",exact:true}).click()
  await page.getByRole("button", {name:"重新开始关系",exact:true}).click()
  await page.getByRole("dialog").getByRole("button", {name:"重新开始关系",exact:true}).click()
  await page.getByText("关系已重新开始，当前为陌生", {exact:true}).waitFor()
  const calls = await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "restart_relationship"))
  assert.equal(calls.length, 2)
  assert.equal(calls[1].args.expected_revision, calls[0].args.expected_revision+1)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("failed restart keeps romance and retry needs explicit confirmation again", async () => {
  const page = await pageFor({}, "?page=settings")
  await prepareRomance(page)
  await page.evaluate(() => { window.__uiTest.failAction = "restart_relationship" })
  await page.getByRole("button", {name:"重新开始关系",exact:true}).click()
  await page.getByRole("dialog").getByRole("button", {name:"重新开始关系",exact:true}).click()
  await page.getByRole("alert").filter({hasText:"操作未完成"}).waitFor()
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().scopes[0].confessed), true)
  await page.evaluate(() => { window.__uiTest.failAction = ""; window.__uiTest.delay = 250 })
  await page.getByRole("button", {name:"重新开始关系",exact:true}).click()
  await page.getByRole("dialog").getByRole("button", {name:"重新开始关系",exact:true}).click()
  await page.getByText("关系已重新开始，当前为陌生", {exact:true}).waitFor()
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "restart_relationship").length), 2)
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().scopes[0].history.filter(item => item.source === "restart").length), 1)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("restart confirmation stays with the selected relationship during a character change", async () => {
  const page = await pageFor({}, "?page=settings")
  await prepareRomance(page)
  await page.getByRole("button", {name:"重新开始关系",exact:true}).click()
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    state.current_character = "茉子"
    state.scopes.forEach(item => { item.is_current = item.label === "茉子" })
    window.__uiTest.update({current_character:state.current_character,scopes:state.scopes})
  })
  await page.getByRole("dialog").getByRole("button", {name:"重新开始关系",exact:true}).click()
  await page.getByText("关系已重新开始，当前为陌生", {exact:true}).waitFor()
  const detail = await page.evaluate(() => ({state:window.__uiTest.snapshot(),
    call:window.__uiTest.calls.find(call => call.action === "restart_relationship")}))
  assert.equal(detail.call.args.scope, "YUI")
  assert.equal(detail.state.scopes[0].confessed, false)
  assert.equal(detail.state.scopes[1].affection, 23)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("zeroing and restart confirmations fit all eight languages at 320px", async () => {
  for (const locale of ["zh-CN","zh-TW","en","ja","ko","es","pt","ru"]) {
    const messages = JSON.parse(readFileSync(resolve(pluginRoot, "i18n", `${locale}.json`), "utf8"))
    const page = await pageFor({viewport:{width:320,height:640}}, `?page=settings&locale=${locale}`)
    await prepareRomance(page)
    for (const key of ["settings.reset","restart.confirm"]) {
      await page.getByRole("button", {name:messages[key],exact:true}).click()
      const dialog = page.getByRole("dialog")
      await dialog.waitFor()
      await noHorizontalOverflow(page)
      const box = await dialog.boundingBox()
      assert.ok(box.x >= 0 && box.y >= 0 && box.x+box.width <= 320 && box.y+box.height <= 640)
      if (key === "restart.confirm" && ["zh-CN","en"].includes(locale))
        await page.screenshot({path:`${artifacts}/restart-confirm-${locale}-mobile.png`})
      await page.keyboard.press("Escape")
      await dialog.waitFor({state:"hidden"})
    }
    assert.deepEqual(page.uiErrors, [])
    await page.close()
  }
})

test("addressing fits eight languages at 320px with all modes and preference controls", async () => {
  for (const locale of ["zh-CN", "zh-TW", "en", "ja", "ko", "es", "pt", "ru"]) {
    const messages = JSON.parse(readFileSync(resolve(pluginRoot, "i18n", `${locale}.json`), "utf8"))
    const page = await pageFor({ viewport: { width: 320, height: 800 } }, `?locale=${locale}`)
    await navigate(page, messages["nav.nicknames"] || "Nicknames")
    for (const control of await page.locator(".lwy-nick-controls select").all()) {
      await control.selectOption("custom")
    }
    for (const input of await page.locator(".lwy-nick-custom input").all()) await input.fill("Alexandra💙")
    await page.getByLabel(messages["nick.preferred"], { exact: true }).fill("Alex")
    await page.getByLabel(messages["nick.avoidInput"], { exact: true }).fill("Darling")
    await page.getByRole("button", { name: messages["nick.addAvoid"], exact: true }).click()
    await noHorizontalOverflow(page)
    const overflow = await page.locator(".lwy-nick-controls, .lwy-nick-custom, .lwy-address-prefs").evaluateAll(nodes =>
      nodes.filter(node => node.scrollWidth > node.clientWidth + 2).map(node => node.className))
    assert.deepEqual(overflow, [], locale)
    await page.locator(".lwy-workspace").evaluate(node => { node.scrollTop = 0 })
    await page.screenshot({ path: resolve(artifacts, `addressing-${locale}-mobile.png`) })
    await page.locator(".lwy-workspace").evaluate(node => { node.scrollTop = node.scrollHeight })
    await page.screenshot({ path: resolve(artifacts, `addressing-${locale}-preferences-mobile.png`) })
    assert.deepEqual(page.uiErrors, [], locale)
    await page.close()
  }
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

test("first-met import previews source and dates without saving, and cancel preserves the date", async () => {
  const page = await pageFor()
  await navigate(page, "纪念日")
  const original = await page.evaluate(() => window.__uiTest.snapshot().scopes[0].first_met)
  await page.getByRole("button", { name: "从宿主历史导入", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByText("2026年3月4日", { exact: true }).waitFor()
  await dialog.getByText("YUI · 宿主保留的普通聊天", { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().scopes[0].first_met), original)
  assert.equal(await page.evaluate(() => window.__uiTest.calls.some(call => call.action === "set_first_met")), false)
  await dialog.getByRole("button", { name: "取消", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().scopes[0].first_met), original)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("first-met import saves only after confirmation and stays pinned to the previewed role", async () => {
  const page = await pageFor()
  await navigate(page, "纪念日")
  await page.getByRole("button", { name: "从宿主历史导入", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByText("2026年3月4日", { exact: true }).waitFor()
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    state.scopes[1].is_current = true; state.scopes[0].is_current = false
    window.__uiTest.update({ scopes: state.scopes })
  })
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  const calls = await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "set_first_met"))
  assert.deepEqual(calls[0].args, { scope: "YUI", date: "2026-03-04", expected_date: "2026-06-29", source: "host" })
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().scopes[0].first_met), "2026-03-04")
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().scopes[1].first_met), "2026-06-29")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("first-met import errors keep the saved date and support searching again", async () => {
  for (const code of ["host_history_empty", "host_history_unavailable", "host_history_incomplete"]) {
    const page = await pageFor()
    await navigate(page, "纪念日")
    await page.evaluate(code => {
      window.__uiTest.failAction = "preview_first_met"; window.__uiTest.failMessage = code
    }, code)
    await page.getByRole("button", { name: "从宿主历史导入", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("alert").waitFor()
    assert.equal(await dialog.getByRole("button", { name: "确认导入", exact: true }).isDisabled(), true)
    assert.equal(await page.evaluate(() => window.__uiTest.snapshot().scopes[0].first_met), "2026-06-29")
    await page.evaluate(() => { window.__uiTest.failAction = "" })
    await dialog.getByRole("button", { name: "重新查询", exact: true }).click()
    await dialog.getByText("2026年3月4日", { exact: true }).waitFor()
    assert.equal(await dialog.getByRole("button", { name: "确认导入", exact: true }).isEnabled(), true)
    assert.deepEqual(page.uiErrors, [])
    await page.close()
  }
})

test("first-met import detects a concurrent manual edit and requires a fresh preview", async () => {
  const page = await pageFor()
  await navigate(page, "纪念日")
  await page.getByRole("button", { name: "从宿主历史导入", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByText("2026年3月4日", { exact: true }).waitFor()
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    state.scopes[0].first_met = "2026-05-06"
    window.__uiTest.update({ scopes: state.scopes })
  })
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click()
  await dialog.getByRole("alert").filter({ hasText: "相识日已在其他位置修改" }).waitFor()
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().scopes[0].first_met), "2026-05-06")
  await dialog.getByRole("button", { name: "重新查询", exact: true }).click()
  await dialog.getByText("2026年5月6日", { exact: true }).waitFor()
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().scopes[0].first_met), "2026-03-04")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("first-met lookup blocks dismissal while pending and saved imports survive refresh failure", async () => {
  const page = await pageFor()
  await navigate(page, "纪念日")
  await page.evaluate(() => { window.__uiTest.delay = 350 })
  await page.getByRole("button", { name: "从宿主历史导入", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await page.keyboard.press("Escape")
  assert.equal(await dialog.isVisible(), true)
  assert.equal(await dialog.getByRole("button", { name: "取消", exact: true }).isDisabled(), true)
  await dialog.getByText("2026年3月4日", { exact: true }).waitFor()
  await page.evaluate(() => { window.__uiTest.failRefresh = true })
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  await page.getByText("相识日已更新 · 显示数据尚未更新，请刷新。", { exact: true }).waitFor()
  await page.evaluate(() => { window.__uiTest.failRefresh = false })
  await page.locator(".lwy-feedback-dock").getByRole("button", { name: "刷新", exact: true }).click()
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "set_first_met").length), 1)
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().scopes[0].first_met), "2026-03-04")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("first-met import fits narrow translated dialogs and supports shared relationships", async () => {
  for (const locale of ["zh-CN", "en"]) {
    const page = await pageFor({ viewport: { width: 320, height: 640 } }, `?locale=${locale}`)
    await page.evaluate(() => {
      const state = window.__uiTest.snapshot()
      state.per_character = false
      state.scopes = [{ ...state.scopes[0], key: "shared", label: null }]
      window.__uiTest.update({ per_character: false, scopes: state.scopes })
    })
    await page.locator(".lwy-nav").getByRole("button", { name: locale === "en" ? "Dates" : "纪念日", exact: true }).click()
    await page.getByRole("button", { name: locale === "en" ? "Import From Host History" : "从宿主历史导入", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.locator(".lwy-import-dates").waitFor()
    await noHorizontalOverflow(page)
    assert.equal(await page.evaluate(() => window.__uiTest.calls.find(call => call.action === "preview_first_met").args.scope), "shared")
    await page.screenshot({ path: `${artifacts}/first-met-import-${locale}-mobile.png` })
    assert.deepEqual(page.uiErrors, [])
    await page.close()
  }
})

test("first-met choices restore the plugin date and reuse the imported date while offline", async () => {
  const page = await pageFor()
  await navigate(page, "纪念日")
  await page.getByRole("button", { name: "修改相识日", exact: true }).click()
  await page.getByLabel("你们相识的日子", { exact: true }).fill("2026-05-06")
  await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  await page.getByRole("button", { name: "从宿主历史导入", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByText("2026年3月4日", { exact: true }).waitFor()
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  await page.evaluate(() => { window.__uiTest.failAction = "preview_first_met" })
  for (const [label, expected, source] of [
    ["插件原始日期", "2026-06-29", "plugin"], ["上次导入的宿主日期", "2026-03-04", "host"],
    ["自定义日期", "2026-05-06", "custom"],
  ]) {
    await page.getByRole("button", { name: "修改相识日", exact: true }).click()
    await dialog.getByRole("radio", { name: new RegExp(label) }).check()
    assert.equal(await page.getByLabel("你们相识的日子", { exact: true }).inputValue(), expected)
    assert.equal(await page.getByLabel("你们相识的日子", { exact: true }).isDisabled(), source !== "custom")
    await dialog.getByRole("button", { name: "保存", exact: true }).click()
    await dialog.waitFor({ state: "hidden" })
    const current = await page.evaluate(() => window.__uiTest.snapshot().scopes[0])
    assert.equal(current.first_met, expected)
    assert.equal(current.first_met_source, source)
    assert.equal(current.plugin_first_met, "2026-06-29")
    assert.equal(current.host_first_met, "2026-03-04")
    assert.equal(current.custom_first_met, "2026-05-06")
  }
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "preview_first_met").length), 1)
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().scopes[1].first_met), "2026-06-29")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("first-met choices preserve custom drafts and cancellation never applies a preset", async () => {
  const page = await pageFor()
  await navigate(page, "纪念日")
  await page.getByRole("button", { name: "修改相识日", exact: true }).click()
  const dialog = page.getByRole("dialog")
  assert.equal(await dialog.getByRole("radio", { name: /上次导入的宿主日期/ }).isDisabled(), true)
  const field = page.getByLabel("你们相识的日子", { exact: true })
  await field.fill("2026-05-06")
  await dialog.getByRole("radio", { name: /插件原始日期/ }).check()
  assert.equal(await field.inputValue(), "2026-06-29")
  await dialog.getByRole("radio", { name: "自定义日期", exact: true }).check()
  assert.equal(await field.inputValue(), "2026-05-06")
  await dialog.getByRole("button", { name: "取消", exact: true }).click()
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "set_first_met").length), 0)
  await page.getByRole("button", { name: "修改相识日", exact: true }).click()
  await field.fill("2026-04-05")
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  const current = await page.evaluate(() => window.__uiTest.snapshot().scopes[0])
  assert.equal(current.first_met_source, "custom")
  assert.equal(current.plugin_first_met, "2026-06-29")
  assert.equal(current.host_first_met, null)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("legacy first-met choices label the upgrade restore point explicitly", async () => {
  const page = await pageFor()
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    state.scopes[0].plugin_first_met_legacy = true
    state.scopes[0].first_met = state.scopes[0].host_first_met = "2026-03-04"
    state.scopes[0].first_met_source = "host"
    window.__uiTest.update({ scopes: state.scopes })
  })
  await navigate(page, "纪念日")
  await page.getByRole("button", { name: "修改相识日", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByText("旧版未单独保存插件原始日期，已保留升级时的相识日作为恢复日期。", { exact: true }).waitFor()
  assert.equal(await dialog.getByRole("radio", { name: /插件原始日期/ }).count(), 0)
  await dialog.getByRole("radio", { name: /升级前的相识日/ }).check()
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().scopes[0].first_met), "2026-06-29")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("first-met restore retains its choice after save failure or a lost response and retries safely", async () => {
  for (const failure of ["failAction", "failAfterAction"]) {
    const page = await pageFor()
    await page.evaluate(() => {
      const state = window.__uiTest.snapshot()
      state.scopes[0].first_met = state.scopes[0].host_first_met = "2026-03-04"
      state.scopes[0].first_met_source = "host"
      window.__uiTest.update({ scopes: state.scopes })
    })
    await navigate(page, "纪念日")
    await page.getByRole("button", { name: "修改相识日", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("radio", { name: /插件原始日期/ }).check()
    await page.evaluate(failure => { window.__uiTest[failure] = "set_first_met" }, failure)
    await dialog.getByRole("button", { name: "保存", exact: true }).click()
    await dialog.getByRole("alert").waitFor()
    assert.equal(await dialog.getByRole("radio", { name: /插件原始日期/ }).isChecked(), true)
    await page.evaluate(failure => { window.__uiTest[failure] = "" }, failure)
    await dialog.getByRole("button", { name: "保存", exact: true }).click()
    await dialog.waitFor({ state: "hidden" })
    const current = await page.evaluate(() => window.__uiTest.snapshot().scopes[0])
    assert.equal(current.first_met, "2026-06-29")
    assert.equal(current.host_first_met, "2026-03-04")
    const calls = await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "set_first_met"))
    assert.deepEqual(calls[0].args, calls[1].args)
    assert.deepEqual(page.uiErrors, [])
    await page.close()
  }
})

test("first-met restore pins its relationship and rejects intervening date changes", async () => {
  const page = await pageFor()
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    state.scopes[0].first_met = state.scopes[0].host_first_met = "2026-03-04"
    state.scopes[0].first_met_source = "host"
    window.__uiTest.update({ scopes: state.scopes })
  })
  await navigate(page, "纪念日")
  await page.getByRole("button", { name: "修改相识日", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("radio", { name: /插件原始日期/ }).check()
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    state.scopes[0].first_met = "2026-05-06"
    state.scopes[0].is_current = false
    state.scopes[1].is_current = true
    window.__uiTest.update({ scopes: state.scopes })
  })
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await dialog.getByRole("alert").filter({ hasText: "相识日已在其他位置修改" }).waitFor()
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().scopes[0].first_met), "2026-05-06")
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().scopes[1].first_met), "2026-06-29")
  assert.equal(await page.evaluate(() => window.__uiTest.calls.find(call => call.action === "set_first_met").args.scope), "YUI")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("first-met choices fit translated narrow dialogs including legacy restore notes", async () => {
  for (const locale of ["zh-CN", "en", "zh-TW", "ja", "ko", "es", "pt", "ru"]) {
    const page = await pageFor({ viewport: { width: 320, height: 640 } }, `?locale=${locale}`)
    await page.evaluate(() => {
      const state = window.__uiTest.snapshot()
      state.per_character = false
      state.scopes = [{ ...state.scopes[0], key: "shared", label: null,
        plugin_first_met_legacy: true, host_first_met: "2026-03-04" }]
      window.__uiTest.update({ per_character: false, scopes: state.scopes })
    })
    const dateLabel = await page.evaluate(() => window.__NEKO_PAYLOAD.i18n.messages[document.documentElement.lang]["nav.dates"]
      || window.__NEKO_PAYLOAD.i18n.messages.en["nav.dates"])
    await page.locator(".lwy-nav").getByRole("button", { name: dateLabel, exact: true }).click()
    await page.locator(".lwy-card-head .lwy-btns button").last().click()
    const dialog = page.getByRole("dialog")
    await dialog.locator(".lwy-met-options").waitFor()
    await noHorizontalOverflow(page)
    assert.equal(await dialog.getByRole("radio").count(), 3)
    if (["zh-CN", "en"].includes(locale)) await page.screenshot({ path: `${artifacts}/first-met-choices-${locale}-mobile.png` })
    assert.deepEqual(page.uiErrors, [])
    await page.close()
  }
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

test("short host panels keep navigation usable without horizontal or unnecessary vertical scrollbars", async () => {
  for (const [width, height] of [[846, 368], [640, 300], [390, 520], [320, 180]]) {
    const page = await pageFor({ viewport: { width, height }, reducedMotion: height === 368 ? "no-preference" : "reduce" })
    await noHorizontalOverflow(page)
    const sidebar = page.locator(".lwy-sidebar")
    const sizes = await sidebar.evaluate(node => ({
      client: node.clientHeight, scroll: node.scrollHeight, width: node.clientWidth, contentWidth: node.scrollWidth,
    }))
    assert.ok(sizes.contentWidth <= sizes.width + 1)
    assert.equal(await page.evaluate(() => document.documentElement.clientWidth), width, "document has no extra outer scrollbar")
    if (height >= 300) assert.ok(sizes.scroll <= sizes.client + 1, `navigation fits at ${width}x${height}`)
    await navigate(page, "设置")
    await page.getByRole("heading", { name: "设置", exact: true }).waitFor()
    await navigate(page, "共同经历")
    await page.getByRole("heading", { name: "共同经历", exact: true }).waitFor()
    const experienceBox = await page.locator('.lwy-nav button[aria-current="page"]').boundingBox()
    assert.ok(experienceBox.y >= 0 && experienceBox.y + experienceBox.height <= height + 1)
    await navigate(page, "设置")
    const settingsBox = await page.locator(".lwy-nav button").last().boundingBox()
    assert.ok(settingsBox.y >= 0 && settingsBox.y + settingsBox.height <= height + 1)
    await noHorizontalOverflow(page)
    if (height === 368) await page.screenshot({ path: `${artifacts}/scrollbars-short-panel.png` })
    assert.deepEqual(page.uiErrors, [])
    await page.close()
  }
})

test("scrollbars reveal near the edge and while scrolling without shifting content, and retain native dragging", async () => {
  const page = await pageFor({ viewport: { width: 846, height: 368 }, reducedMotion: "no-preference", colorScheme: "dark" })
  const workspace = page.locator(".lwy-workspace")
  await page.mouse.move(300, 110)
  const before = await page.locator(".lwy-head").boundingBox()
  assert.equal(await workspace.getAttribute("data-lwy-scroll-visible"), null)
  await page.screenshot({ path: `${artifacts}/scrollbars-idle.png` })
  const box = await workspace.boundingBox()
  await page.mouse.move(box.x + box.width - 12, 90)
  await page.waitForFunction(() => document.querySelector(".lwy-workspace").hasAttribute("data-lwy-scroll-visible"))
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".lwy-workspace"), "::-webkit-scrollbar-thumb").backgroundColor !== "rgba(0, 0, 0, 0)")
  assert.deepEqual(await page.locator(".lwy-head").boundingBox(), before)
  await page.screenshot({ path: `${artifacts}/scrollbars-edge.png` })
  await page.mouse.move(box.x + box.width - 5, 28)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 5, 115, { steps: 8 })
  await page.mouse.up()
  assert.ok(await workspace.evaluate(node => node.scrollTop > 0), "native thumb can be dragged")
  await page.mouse.move(300, 110)
  await page.waitForFunction(() => !document.querySelector(".lwy-workspace").hasAttribute("data-lwy-scroll-visible"))
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".lwy-workspace"), "::-webkit-scrollbar-thumb").backgroundColor === "rgba(0, 0, 0, 0)")
  const previous = await workspace.evaluate(node => node.scrollTop)
  await page.mouse.wheel(0, 100)
  await page.waitForFunction(previous => document.querySelector(".lwy-workspace").scrollTop > previous, previous)
  assert.notEqual(await workspace.getAttribute("data-lwy-scroll-visible"), null)
  await page.waitForFunction(() => !document.querySelector(".lwy-workspace").hasAttribute("data-lwy-scroll-visible"))
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("keyboard, touch and high contrast retain scroll access and modal scrolling stays inside the dialog", async () => {
  const page = await pageFor({ viewport: { width: 846, height: 368 } }, "?page=settings")
  const workspace = page.locator(".lwy-workspace")
  await workspace.focus()
  await page.keyboard.press("PageDown")
  await page.waitForFunction(() => document.querySelector(".lwy-workspace").scrollTop > 0)
  assert.equal(await page.evaluate(() => document.documentElement.dataset.lwyPointer), "keyboard")
  await page.getByRole("button", { name: "选择立绘", exact: true }).click()
  await page.locator(".lwy-portrait-choice").first().waitFor()
  const modalBody = page.locator(".neko-modal-body")
  const bodyBox = await modalBody.boundingBox()
  const parentScroll = await workspace.evaluate(node => node.scrollTop)
  await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + bodyBox.height / 2)
  await page.mouse.wheel(0, 250)
  await page.waitForFunction(() => document.querySelector(".neko-modal-body").scrollTop > 0)
  assert.equal(await workspace.evaluate(node => node.scrollTop), parentScroll)
  await noHorizontalOverflow(page)
  await page.emulateMedia({ forcedColors: "active" })
  await page.screenshot({ path: `${artifacts}/scrollbars-high-contrast.png` })
  assert.equal(await modalBody.evaluate(node => getComputedStyle(node).scrollbarColor), "auto")
  assert.deepEqual(page.uiErrors, [])
  await page.close()
  const touchPage = await pageFor({ viewport: { width: 390, height: 520 }, isMobile: true, hasTouch: true }, "?page=settings")
  const thumb = await touchPage.locator(".lwy-workspace").evaluate(node => getComputedStyle(node).getPropertyValue("--lwy-scroll-thumb").trim())
  assert.notEqual(thumb, "rgba(0, 0, 0, 0)")
  await noHorizontalOverflow(touchPage)
  assert.deepEqual(touchPage.uiErrors, [])
  await touchPage.close()
})

function portraitFiles() {
  const root = resolve(pluginRoot, "assets/portraits")
  const items = JSON.parse(readFileSync(resolve(root, "catalog.json"), "utf8")).items
  return [items[0], items.at(-1)].map((item, index) => ({
    name: `custom-${index}.webp`, mimeType: "image/webp", buffer: readFileSync(resolve(root, item.file)),
  }))
}

test("portrait import previews before saving and supports games, duplicates, rename and deletion", async () => {
  const page = await pageFor({ viewport: { width: 390, height: 740 } }, "?page=settings")
  await page.getByRole("button", { name: "导入立绘", exact: true }).click()
  let dialog = page.getByRole("dialog")
  await dialog.locator('input[type=file]').setInputFiles(portraitFiles())
  await dialog.locator(".lwy-import-row").nth(1).waitFor()
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "import_portrait").length), 0)
  await dialog.getByLabel("游戏", { exact: true }).selectOption("__new__")
  await dialog.getByLabel("游戏名称", { exact: true }).fill("我的游戏")
  await dialog.getByLabel("立绘名称", { exact: true }).first().fill("自定义角色")
  await noHorizontalOverflow(page)
  await page.screenshot({ path: `${artifacts}/portrait-import-mobile.png` })
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click()
  await dialog.getByRole("status").filter({ hasText: "已导入 2 张" }).waitFor()
  await dialog.getByRole("button", { name: "完成", exact: true }).click()
  await page.getByRole("button", { name: "导入立绘", exact: true }).click()
  dialog = page.getByRole("dialog")
  await dialog.locator('input[type=file]').setInputFiles(portraitFiles()[0])
  await dialog.locator(".lwy-import-row").waitFor()
  await dialog.getByLabel("游戏", { exact: true }).selectOption("我的游戏")
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click()
  await dialog.getByRole("status").filter({ hasText: "重复 1 张" }).waitFor()
  await dialog.getByRole("button", { name: "完成", exact: true }).click()
  await page.getByRole("button", { name: "选择立绘", exact: true }).click()
  dialog = page.getByRole("dialog")
  await dialog.getByLabel("游戏", { exact: true }).selectOption("我的游戏")
  await dialog.locator(".lwy-portrait-choice").filter({ hasText: "自定义角色" }).waitFor()
  assert.equal(await dialog.locator(".lwy-portrait-choice").count(), 2)
  await dialog.getByRole("button", { name: "编辑「自定义角色」", exact: true }).click()
  await dialog.getByLabel("立绘名称", { exact: true }).fill("改名角色")
  await dialog.getByLabel("游戏", { exact: true }).fill("新分类")
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await dialog.getByLabel("游戏", { exact: true }).selectOption("新分类")
  await dialog.getByRole("button", { name: "编辑「改名角色」", exact: true }).click()
  await dialog.getByRole("button", { name: "删除立绘", exact: true }).click()
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click()
  await dialog.getByLabel("游戏", { exact: true }).selectOption("我的游戏")
  await dialog.locator(".lwy-portrait-choice").filter({ hasText: "custom-1" }).waitFor()
  assert.equal(await dialog.locator(".lwy-portrait-choice").count(), 1)
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().portraits.count), 65)
  await noHorizontalOverflow(page)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("portrait import keeps failed rows for retry and handles a lost response without duplicates", async () => {
  const page = await pageFor({}, "?page=settings")
  await page.getByRole("button", { name: "导入立绘", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.locator('input[type=file]').setInputFiles(portraitFiles()[0])
  await dialog.locator(".lwy-import-row").waitFor()
  await dialog.getByLabel("游戏", { exact: true }).selectOption("千恋万花")
  await page.evaluate(() => { window.__uiTest.failAfterAction = "import_portrait" })
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click()
  await dialog.getByRole("alert").waitFor()
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().portraits.count), 65)
  await page.evaluate(() => { window.__uiTest.failAfterAction = "" })
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click()
  await dialog.getByRole("status").filter({ hasText: "重复 1 张" }).waitFor()
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().portraits.count), 65)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("portrait import cancel and invalid images never write to the library", async () => {
  const page = await pageFor({}, "?page=settings")
  await page.getByRole("button", { name: "导入立绘", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.locator('input[type=file]').setInputFiles({ name: "bad.png", mimeType: "image/png", buffer: Buffer.from("invalid") })
  await dialog.getByRole("alert").waitFor()
  await dialog.locator('input[type=file]').setInputFiles(portraitFiles()[0])
  await dialog.locator(".lwy-import-row").waitFor()
  await dialog.getByRole("button", { name: "取消", exact: true }).click()
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "import_portrait").length), 0)
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().portraits.count), 64)
  await page.close()
})

test("portrait import reads files and encodes transparent images in the host opaque sandbox", async () => {
  const page = await pageFor({}, "?art=off")
  const response = await page.request.get(`${url}/?page=settings&art=off`)
  await page.setContent('<iframe title="Hosted portraits" sandbox="allow-scripts" style="width:980px;height:740px"></iframe>')
  await page.locator("iframe").evaluate((frame, html) => { frame.srcdoc = html }, await response.text())
  const frame = page.frameLocator("iframe")
  await frame.getByRole("button", { name: "导入立绘", exact: true }).click()
  const dialog = frame.getByRole("dialog")
  await dialog.locator('input[type=file]').setInputFiles(portraitFiles()[0])
  await dialog.locator(".lwy-import-row").waitFor()
  await dialog.getByLabel("游戏", { exact: true }).selectOption("千恋万花")
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click()
  await dialog.getByRole("status").filter({ hasText: "已导入 1 张" }).waitFor()
  const result = await page.frames()[1].evaluate(async () => {
    const args = window.__uiTest.calls.find(call => call.action === "import_portrait").args
    const image = document.createElement("img")
    image.src = args.data_url
    await image.decode()
    const canvas = document.createElement("canvas")
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const context = canvas.getContext("2d")
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let transparent = 0, visible = 0
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index]) visible++
      else transparent++
    }
    return {width:canvas.width,height:canvas.height,transparent,visible}
  })
  assert.ok(result.width > 0 && result.width <= 960 && result.height > 0 && result.height <= 1440)
  assert.ok(result.transparent > 0 && result.visible > 0)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("portrait import fits all translated dialogs at 320px", async () => {
  const labels = { "zh-CN": "导入立绘", "zh-TW": "匯入立繪", en: "Import portraits",
    ja: "立ち絵をインポート", ko: "일러스트 가져오기", es: "Importar retratos",
    pt: "Importar retratos", ru: "Импорт портретов" }
  for (const [locale, label] of Object.entries(labels)) {
    const page = await pageFor({ viewport: { width: 320, height: 620 }, colorScheme: "dark" }, `?page=settings&locale=${locale}`)
    await page.getByRole("button", { name: label, exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.locator('input[type=file]').setInputFiles(portraitFiles()[0])
    await dialog.locator(".lwy-import-row").waitFor()
    await dialog.locator("select").selectOption("__new__")
    await noHorizontalOverflow(page)
    if (locale === "en") await page.screenshot({ path: `${artifacts}/portrait-import-dark-320.png` })
    assert.deepEqual(page.uiErrors, [])
    await page.close()
  }
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
  await navigate(page, "关系概览")
  await page.locator(".lwy-notices").getByRole("button", { name: "重试", exact: true }).waitFor()
  await page.getByRole("button", { name: "重试", exact: true }).click()
  await page.waitForFunction(() => {
    const image = document.querySelector(".lwy-art img")
    return image?.complete && image.naturalWidth > 0
  })
  await navigate(page, "设置")
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
  assert.equal(await page.locator(".lwy-nav button:visible").count(), 7)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("translated labels and long character names fit all six mobile pages", async () => {
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
  await page.getByRole("alert").filter({ hasText: "操作未完成，请稍后重试。" }).waitFor()
  assert.equal(await page.getByLabel("自选颜色", { exact: true }).inputValue(), "#2468ac")
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().appearance.accent_color), "#7db9e8")
  await page.evaluate(() => { window.__uiTest.failAction = "" })
  await appearance.getByRole("button", { name: "保存", exact: true }).click()
  await page.waitForFunction(() => window.__uiTest.snapshot().appearance.accent_color === "#2468ac")
  await page.reload()
  await navigate(page, "设置")
  assert.equal(await page.getByLabel("自选颜色", { exact: true }).inputValue(), "#2468ac")
  await appearance.getByRole("button", { name: "恢复默认", exact: true }).click()
  assert.equal(await page.getByLabel("自选颜色", { exact: true }).inputValue(), "#7db9e8")
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

test("overview keeps the relationship first and links the latest change to full history", async () => {
  const page = await pageFor({ viewport: { width: 390, height: 844 } })
  await page.locator(".lwy-art img").waitFor()
  const positions = await page.evaluate(() => ({
    hero: document.querySelector(".lwy-hero").getBoundingClientRect().top,
    dates: document.querySelector(".lwy-overview-footer").getBoundingClientRect().top,
    recent: document.querySelector(".lwy-recent").getBoundingClientRect().top,
  }))
  assert.ok(positions.hero < positions.dates && positions.dates < positions.recent)
  assert.match(await page.locator(".lwy-recent").textContent(), /你记得她说过的小事/)
  await page.getByRole("button", { name: "查看全部", exact: true }).click()
  assert.equal(await page.locator("h1").textContent(), "心动记录")
  assert.equal(await page.locator(".lwy-workspace").evaluate(node => node.scrollTop), 0)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("modal save failures stay beside the actions, retain input and restore focus after retry", async () => {
  const page = await pageFor({ viewport: { width: 320, height: 540 } })
  await navigate(page, "设置")
  await page.getByRole("button", { name: "调整", exact: true }).click()
  await page.getByRole("spinbutton").fill("72")
  await page.evaluate(() => { window.__uiTest.failAction = "set_affection" })
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await dialog.getByRole("alert").filter({ hasText: "操作未完成，请稍后重试。" }).waitFor()
  assert.equal(await page.getByRole("alert").count(), 1)
  assert.equal(await page.locator(".lwy-feedback-dock").count(), 0)
  assert.equal(await dialog.getByRole("spinbutton").inputValue(), "72")
  const bounds = await dialog.locator(".neko-modal-footer").boundingBox()
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 540)
  await noHorizontalOverflow(page)
  await page.screenshot({ path: `${artifacts}/feedback-modal-failure.png` })
  await page.evaluate(() => { window.__uiTest.failAction = "" })
  await dialog.getByRole("button", { name: "保存", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  await page.locator(".lwy-feedback-dock").getByRole("status").filter({ hasText: "好感已调整为 72" }).waitFor()
  assert.equal(await page.getByRole("button", { name: "调整", exact: true }).evaluate(node => node === document.activeElement), true)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("saving and refreshing are distinct phases and unrelated save buttons keep their labels", async () => {
  const page = await pageFor()
  await navigate(page, "设置")
  await page.evaluate(() => { window.__uiTest.delay = 400; window.__uiTest.refreshDelay = 650 })
  await page.getByRole("checkbox", { name: "自动判断好感", exact: true }).uncheck()
  await page.locator(".lwy-feedback-dock").getByRole("status").filter({ hasText: "保存中" }).waitFor()
  assert.equal(await page.locator(".lwy-appearance").getByRole("button", { name: "保存", exact: true }).count(), 1)
  await page.locator(".lwy-feedback-dock").getByRole("status").filter({ hasText: "操作已完成，正在更新面板" }).waitFor()
  assert.equal(await page.getByRole("checkbox", { name: "自动判断好感", exact: true }).isDisabled(), true)
  await page.locator(".lwy-feedback-dock").getByRole("status").filter({ hasText: "关系规则已更新" }).waitFor()
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "set_settings").length), 1)
  assert.equal(await page.getByRole("checkbox", { name: "自动判断好感", exact: true }).isChecked(), false)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("refresh failures show the acknowledged save and retry refresh without resubmitting", async () => {
  const page = await pageFor({ viewport: { width: 390, height: 620 } })
  await navigate(page, "设置")
  await page.evaluate(() => { window.__uiTest.failRefresh = true })
  await page.getByRole("button", { name: "调整", exact: true }).click()
  await page.getByRole("spinbutton").fill("74")
  await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  const dock = page.locator(".lwy-feedback-dock")
  await dock.getByRole("status").filter({ hasText: "好感已调整为 74 · 显示数据尚未更新，请刷新。" }).waitFor()
  const box = await dock.boundingBox()
  assert.ok(box.x >= 56 && box.y >= 0 && box.x + box.width <= 390 && box.y + box.height <= 620)
  await page.screenshot({ path: `${artifacts}/feedback-saved-stale.png` })
  await page.evaluate(() => { window.__uiTest.failRefresh = false })
  await dock.getByRole("button", { name: "刷新", exact: true }).click()
  await dock.getByRole("status").filter({ hasText: "已刷新" }).waitFor()
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "set_affection").length), 1)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})

test("settings shortcuts focus visible headings and detailed rules remain available", async () => {
  for (const width of [320, 700, 980]) {
    const page = await pageFor({ viewport: { width, height: 740 } })
    await navigate(page, "设置")
    const navigation = page.getByRole("navigation", { name: "设置分区", exact: true })
    await navigation.getByRole("button", { name: "关系规则", exact: true }).click()
    const heading = page.locator("#lwy-rules-heading")
    assert.equal(await heading.evaluate(node => node === document.activeElement), true)
    const navBox = await navigation.boundingBox(), headingBox = await heading.boundingBox()
    assert.ok(headingBox.y >= navBox.y + navBox.height && headingBox.y < 740)
    const details = page.locator(".lwy-details").first()
    assert.equal(await details.getAttribute("open"), null)
    await details.locator("summary").click()
    assert.notEqual(await details.getAttribute("open"), null)
    await details.getByText(/Plugin API/).waitFor()
    await page.evaluate(() => {
      const settings = window.__uiTest.snapshot().settings
      window.__uiTest.update({ settings: { ...settings, auto_score: false } })
    })
    assert.equal(await page.getByRole("checkbox", { name: "允许猫娘主动告白", exact: true }).isDisabled(), true)
    await page.getByText("先开启「自动判断好感」和「成为恋人需要告白」。", { exact: true }).waitFor()
    await noHorizontalOverflow(page)
    if (width === 980) await page.screenshot({ path: `${artifacts}/rules-desktop.png` })
    assert.deepEqual(page.uiErrors, [])
    await page.close()
  }
})

test("feedback preserves page nodes and scroll, and stays readable across widths and languages", async () => {
  for (const locale of ["zh-CN", "en"]) {
    const page = await pageFor({}, `?locale=${locale}`)
    await page.locator(".lwy-nav").getByRole("button", { name: locale === "en" ? "Settings" : "设置", exact: true }).click()
    await page.evaluate(() => {
      window.__workspaceNode = document.querySelector(".lwy-workspace")
      window.__uiTest.failAction = "sync_characters"
    })
    const syncLabel = locale === "en" ? "Refresh characters" : "刷新角色"
    await page.getByRole("button", { name: syncLabel, exact: true }).click()
    await page.locator(".lwy-feedback-dock [role='alert']").waitFor()
    assert.equal(await page.evaluate(() => window.__workspaceNode === document.querySelector(".lwy-workspace")), true)
    const scrollTop = await page.locator(".lwy-workspace").evaluate(node => node.scrollTop)
    await page.evaluate(() => window.__uiTest.update({ host_online: true }))
    assert.equal(await page.locator(".lwy-workspace").evaluate(node => node.scrollTop), scrollTop)
    for (const width of [320, 390, 700, 800, 980, 1440]) {
      await page.setViewportSize({ width, height: 620 })
      await settle(page)
      await noHorizontalOverflow(page)
      const box = await page.locator(".lwy-feedback-dock").boundingBox()
      assert.ok(box.x >= 56 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 620)
      await page.locator(".lwy-workspace").evaluate(node => { node.scrollTop = node.scrollHeight })
      const reset = page.getByRole("button", { name: locale === "en" ? "Zero affection" : "清零好感", exact: true })
      const resetBox = await reset.boundingBox()
      assert.ok(resetBox.y + resetBox.height <= box.y)
    }
    await page.locator(".lwy-feedback-dock button").last().click()
    assert.equal(await page.getByRole("button", { name: syncLabel, exact: true }).evaluate(node => node === document.activeElement), true)
    assert.deepEqual(page.uiErrors, [])
    await page.close()
  }
})

test("name limits count Unicode characters without splitting emoji", async () => {
  const page = await pageFor()
  await navigate(page, "专属称呼")
  const nickname = "小".repeat(11) + "💙"
  await editNickname(page, "陌生", nickname + "尾")
  assert.equal(await page.getByLabel("陌生的自定义称呼", { exact: true }).inputValue(), nickname)
  assert.equal(await page.locator(".lwy-nick-row").first().locator(".lwy-counter").textContent(), "12/12")
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await page.waitForFunction(expected => window.__uiTest.snapshot().scopes[0].nicknames.stranger === expected, nickname)
  await navigate(page, "纪念日")
  await page.getByRole("button", { name: "添加", exact: true }).click()
  const title = "纪".repeat(19) + "💙"
  await page.getByLabel("名称", { exact: true }).fill(title + "尾")
  assert.equal(await page.getByLabel("名称", { exact: true }).inputValue(), title)
  await page.getByRole("dialog").getByRole("button", { name: "添加", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().anniversaries.at(-1).title), title)
  assert.deepEqual(page.uiErrors, [])
  await page.close()
})
