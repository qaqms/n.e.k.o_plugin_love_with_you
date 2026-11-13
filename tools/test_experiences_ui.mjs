import assert from "node:assert/strict"
import { before, after, test } from "node:test"
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { dependency, pluginRoot, startPreview } from "./ui_preview.mjs"

const { chromium } = dependency("playwright")
const artifacts = resolve(pluginRoot, "../.neko-ui-review/artifacts/experiences")
let browser, server, url
before(async () => {
  ;({ server, url } = await startPreview())
  browser = await chromium.launch({
    ...(process.env.NEKO_UI_BROWSER ? { executablePath: process.env.NEKO_UI_BROWSER } : {}),
  })
  mkdirSync(artifacts, { recursive: true })
})
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)) })

async function pageFor(options = {}, locale = "zh-CN") {
  const page = await browser.newPage({ viewport: { width: 980, height: 740 }, reducedMotion: "reduce", ...options })
  page.errors = []
  page.on("pageerror", error => page.errors.push(error.message))
  await page.goto(`${url}/?page=experiences&art=off&locale=${locale}`)
  await page.locator(".lwy-xp").waitFor()
  return page
}

async function enable(page) {
  await page.getByRole("checkbox", { name: "保存共同经历", exact: true }).check()
  await page.getByRole("dialog").getByRole("button", { name: "同意并开启", exact: true }).click()
  await page.getByRole("button", { name: "开始一张便签", exact: true }).waitFor()
}

async function startNote(page) {
  await page.getByRole("button", { name: "开始一张便签", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("便签内容", { exact: true }).fill("今天一起写下第一句。")
  await dialog.getByRole("button", { name: "保存待确认草稿", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
}

async function noOverflow(page) {
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll(".lwy-xp,.neko-modal,.neko-modal-body,.neko-button")]
    .filter(node => node.getClientRects().length && node.scrollWidth > node.clientWidth + 2)
    .map(node => node.className)), [])
}

test("saving is opt-in and can be declined before any content is created", async () => {
  const page = await pageFor()
  assert.equal(await page.getByRole("checkbox", { name: "保存共同经历", exact: true }).isChecked(), false)
  await page.getByRole("checkbox", { name: "保存共同经历", exact: true }).check()
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click()
  assert.equal(await page.evaluate(() => window.__uiTest.calls.length), 0)
  assert.equal(await page.getByRole("checkbox", { name: "保存共同经历", exact: true }).isChecked(), false)
  assert.deepEqual(page.errors, [])
  await page.close()
})

test("note drafting, invitation, review, recall opt-out and deletion stay separate", async () => {
  const page = await pageFor()
  await enable(page)
  await startNote(page)
  let state = await page.evaluate(() => window.__uiTest.snapshot())
  assert.equal(state.experiences.characters.YUI.memories.length, 0)
  await page.getByRole("button", { name: "邀请一起写", exact: true }).click()
  await page.getByRole("status").filter({ hasText: "邀请已提交，请以宿主聊天中的实际回应为准" }).waitFor()
  await page.getByRole("button", { name: "编辑并留存", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("便签内容", { exact: true }).fill("今天一起写下第一句。\n她写下了第二句，我确认留下。")
  await dialog.getByRole("button", { name: "确认留存", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  await page.getByRole("checkbox", { name: "允许角色在聊天中回忆", exact: true }).uncheck()
  state = await page.evaluate(() => window.__uiTest.snapshot())
  assert.equal(state.experiences.characters.YUI.memories.length, 1)
  assert.equal(state.experiences.characters.YUI.memories[0].recall, false)
  assert.equal(state.shop.coins, 100)
  assert.equal(state.scopes[0].affection, 67)
  await page.screenshot({ path: `${artifacts}/notes-desktop.png` })
  await page.getByRole("button", { name: "删除", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: "删除", exact: true }).click()
  await page.getByText("这里还没有留存的便签。", { exact: true }).waitFor()
  assert.deepEqual(page.errors, [])
  await page.close()
})

test("lost note creation response replays the same request once", async () => {
  const page = await pageFor()
  await enable(page)
  await page.evaluate(() => { window.__uiTest.failAfterAction = "experience_action" })
  await page.getByRole("button", { name: "开始一张便签", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("便签内容", { exact: true }).fill("第一句")
  await dialog.getByRole("button", { name: "保存待确认草稿", exact: true }).click()
  await dialog.getByRole("button", { name: "确认上次操作", exact: true }).waitFor()
  await page.evaluate(() => { window.__uiTest.failAfterAction = "" })
  await dialog.getByRole("button", { name: "确认上次操作", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  const calls = await page.evaluate(() => window.__uiTest.calls.filter(call => call.args.operation === "start_note"))
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].args, calls[1].args)
  assert.deepEqual(page.errors, [])
  await page.close()
})

for (const response of [null, { operation: "save_note", revision: 1, id: "wrong-operation" }]) {
  test(`an unverifiable note response stays pending and replays the original request: ${JSON.stringify(response)}`, async () => {
    const page = await pageFor()
    await enable(page)
    await page.evaluate(response => {
      window.__uiTest.responseOverrideAction = "experience_action"
      window.__uiTest.responseOverride = response
    }, response)
    await page.getByRole("button", { name: "开始一张便签", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("便签内容", { exact: true }).fill("需要核对的草稿")
    await dialog.getByRole("button", { name: "保存待确认草稿", exact: true }).click()
    await dialog.getByRole("button", { name: "确认上次操作", exact: true }).waitFor({ timeout: 2500 })
    assert.equal(await dialog.getByLabel("便签内容", { exact: true }).inputValue(), "需要核对的草稿")
    await page.evaluate(() => { window.__uiTest.responseOverrideAction = "" })
    await dialog.getByRole("button", { name: "确认上次操作", exact: true }).click()
    await dialog.waitFor({ state: "hidden" })
    const calls = await page.evaluate(() => window.__uiTest.calls.filter(call => call.args.operation === "start_note"))
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[0].args, calls[1].args)
    assert.equal(await page.evaluate(() => window.__uiTest.snapshot().experiences.characters.YUI.revision), 1)
    assert.deepEqual(page.errors, [])
    await page.close()
  })
}

test("updating only the draft preserves both edited title and body", async () => {
  const page = await pageFor()
  await enable(page)
  await startNote(page)
  await page.getByRole("button", { name: "编辑并留存", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("便签标题", { exact: true }).fill("修改后的标题")
  await dialog.getByLabel("便签内容", { exact: true }).fill("这句还只是草稿。")
  await dialog.getByRole("button", { name: "只更新草稿", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  await page.getByRole("heading", { name: "修改后的标题", exact: true }).waitFor()
  const record = await page.evaluate(() => window.__uiTest.snapshot().experiences.characters.YUI)
  assert.equal(record.note.title, "修改后的标题")
  assert.equal(record.note.text, "这句还只是草稿。")
  assert.equal(record.memories.length, 0)
  await page.getByRole("button", { name: "编辑并留存", exact: true }).click()
  assert.equal(await dialog.getByLabel("便签标题", { exact: true }).inputValue(), "修改后的标题")
  assert.deepEqual(page.errors, [])
  await page.close()
})

test("follow-up is pending until reviewed, can be postponed, and needs a confirmed outcome", async () => {
  const page = await pageFor()
  await enable(page)
  await page.getByRole("tab", { name: "以后关心", exact: true }).click()
  await page.getByRole("button", { name: "添加关心事项", exact: true }).click()
  let dialog = page.getByRole("dialog")
  await dialog.getByLabel("想让她以后关心的事", { exact: true }).fill("我想聊聊面试的结果")
  await dialog.getByRole("button", { name: "保存待确认草稿", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  await page.getByText("待你确认", { exact: false }).waitFor()
  await page.getByRole("button", { name: "确认约定", exact: true }).click()
  dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "确认留存", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().experiences.characters.YUI.followups[0].status), "active")
  await page.screenshot({ path: `${artifacts}/followups-desktop.png` })
  await page.getByRole("button", { name: "记录结果", exact: true }).click()
  dialog = page.getByRole("dialog")
  await dialog.getByLabel("记录结果", { exact: true }).fill("面试聊得不错，我还在等回复。")
  await dialog.getByRole("button", { name: "确认留存", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().experiences.characters.YUI.followups[0].status), "closed")
  assert.deepEqual(page.errors, [])
  await page.close()
})

test("shared affection does not merge participants and an open dialog keeps its original participant", async () => {
  const page = await pageFor()
  await enable(page)
  await page.evaluate(() => window.__uiTest.update({ per_character: false }))
  await startNote(page)
  await page.getByLabel("参与角色", { exact: true }).selectOption("茉子")
  await page.getByText("还没有正在创作的便签。", { exact: true }).waitFor()
  await page.getByRole("button", { name: "开始一张便签", exact: true }).click()
  await page.getByRole("dialog").getByLabel("便签内容", { exact: true }).fill("茉子的草稿")
  await page.evaluate(() => window.__uiTest.update({ current_character: "YUI" }))
  await page.getByRole("dialog").getByRole("button", { name: "保存待确认草稿", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  const characters = await page.evaluate(() => window.__uiTest.snapshot().experiences.characters)
  assert.equal(characters.YUI.note.text, "今天一起写下第一句。")
  assert.equal(characters["茉子"].note.text, "茉子的草稿")
  assert.deepEqual(page.errors, [])
  await page.close()
})

test("all locales fit mobile layouts and review dialogs", async () => {
  for (const locale of ["zh-CN", "zh-TW", "en", "ja", "ko", "es", "ru", "pt"]) {
    const page = await pageFor({ viewport: { width: 320, height: 740 }, colorScheme: "dark" }, locale)
    const labels = await page.evaluate(() => {
      const dict = window.__NEKO_PAYLOAD.i18n.messages[document.documentElement.lang]
      return { start: dict["xp.start"], notes: dict["xp.notes"], title: dict["xp.noteTitle"], enabled: dict["xp.enabled"] }
    })
    await page.getByRole("checkbox", { name: labels.enabled, exact: true }).check()
    await noOverflow(page)
    await page.keyboard.press("Escape")
    await page.evaluate(() => window.__uiTest.update({
      experiences: { enabled: true, revision: 1, characters: {} },
    }))
    await page.getByRole("button", { name: labels.start, exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel(labels.title, { exact: true }).fill("a".repeat(40))
    await noOverflow(page)
    if (["zh-CN", "en"].includes(locale)) await page.screenshot({ path: `${artifacts}/note-${locale}-320.png` })
    assert.deepEqual(page.errors, [], locale)
    await page.close()
  }
})

test("concurrent note edits preserve input and require an explicit review before rebasing", async () => {
  const page = await pageFor()
  await enable(page)
  await startNote(page)
  await page.getByRole("button", { name: "编辑并留存", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("便签内容", { exact: true }).fill("我希望保留的修改")
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    state.experiences.characters.YUI.note.text = "角色刚刚提交的另一版内容"
    state.experiences.characters.YUI.revision += 1
    window.__uiTest.update({ experiences: state.experiences })
  })
  assert.equal(await dialog.getByLabel("便签内容", { exact: true }).inputValue(), "我希望保留的修改")
  assert.equal(await dialog.getByRole("button", { name: "确认留存", exact: true }).isDisabled(), true)
  await dialog.getByText("查看当前已保存内容", { exact: true }).click()
  await dialog.getByText("角色刚刚提交的另一版内容", { exact: false }).waitFor()
  await dialog.getByRole("button", { name: "核对后保留我的输入", exact: true }).click()
  await page.getByRole("dialog").last().getByRole("button", { name: "确定", exact: true }).click()
  await dialog.getByRole("button", { name: "确认留存", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => window.__uiTest.snapshot().experiences.characters.YUI.memories[0].text), "我希望保留的修改")
  assert.deepEqual(page.errors, [])
  await page.close()
})

test("acknowledged saves close the dialog even when refresh fails and refresh never resubmits", async () => {
  const page = await pageFor()
  await enable(page)
  await startNote(page)
  await page.getByRole("button", { name: "编辑并留存", exact: true }).click()
  await page.evaluate(() => { window.__uiTest.failRefresh = true })
  await page.getByRole("dialog").getByRole("button", { name: "确认留存", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.args.operation === "save_note").length), 1)
  await page.evaluate(() => { window.__uiTest.failRefresh = false })
  await page.locator(".lwy-xp-toolbar").first().getByRole("button", { name: "刷新", exact: true }).click()
  await page.getByRole("checkbox", { name: "允许角色在聊天中回忆", exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.__uiTest.calls.filter(call => call.args.operation === "save_note").length), 1)
  assert.deepEqual(page.errors, [])
  await page.close()
})

test("disabled saving keeps existing notes readable and deletable", async () => {
  const page = await pageFor()
  await enable(page)
  await startNote(page)
  await page.getByRole("button", { name: "编辑并留存", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: "确认留存", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  await page.getByRole("checkbox", { name: "保存共同经历", exact: true }).uncheck()
  assert.equal(await page.getByRole("button", { name: "开始一张便签", exact: true }).isDisabled(), true)
  await page.getByRole("button", { name: "删除", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: "删除", exact: true }).click()
  await page.getByText("这里还没有留存的便签。", { exact: true }).waitFor()
  assert.deepEqual(page.errors, [])
  await page.close()
})
