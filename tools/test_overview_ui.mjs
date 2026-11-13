import assert from "node:assert/strict"
import { before, after, test } from "node:test"
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { dependency, pluginRoot, startPreview } from "./ui_preview.mjs"

const { chromium } = dependency("playwright")
const artifacts = resolve(pluginRoot, "../.neko-ui-review/artifacts/overview-071")
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
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, reducedMotion: "reduce", ...options })
  page.errors = []
  page.on("pageerror", error => page.errors.push(error.message))
  await page.goto(`${url}/?locale=${locale}`)
  await page.locator(".lwy-together").waitFor()
  return page
}

async function populate(page) {
  await page.evaluate(() => {
    const record = name => ({
      revision: 3,
      note: { id: `draft-${name}`, title: `${name}的草稿`, text: `${name}的第一句`, created_at: 10, invitation: "submitted" },
      memories: [
        { id: `older-${name}`, title: `${name}的旧便签`, text: "旧内容", created_at: 9, recall: true },
        { id: `memory-${name}`, title: `${name}的最新便签`, text: "这一句由我确认留下。\n下一句也留在这里。", created_at: 20, recall: false },
      ],
      followups: [
        { id: `closed-${name}`, summary: `${name}已结束的事`, due: "2026-01-01", status: "closed", outcome: "", pending_outcome: "", prompt_submitted: false },
        { id: `active-${name}`, summary: `${name}已约好的事`, due: "2026-02-01", status: "active", outcome: "", pending_outcome: "", prompt_submitted: true },
        { id: `pending-${name}`, summary: `${name}待确认的事`, due: "2099-01-01", status: "pending", outcome: "", pending_outcome: "", prompt_submitted: false },
      ],
    })
    window.__uiTest.update({ experiences: {
      enabled: true, revision: 1, characters: { YUI: record("YUI"), "茉子": record("茉子") },
    } })
  })
}
const home = page => page.locator(".lwy-nav").getByRole("button", { name: "关系概览", exact: true }).click()
const writes = page => page.evaluate(() => window.__uiTest.calls.filter(call => call.action === "experience_action"))

async function noOverflow(page) {
  assert.deepEqual(await page.evaluate(() =>
    [...document.querySelectorAll(".lwy-together,.lwy-together-row,.lwy-together-copy,.lwy-sidebar,.lwy-workspace,.neko-modal,.neko-button")]
      .filter(node => node.getClientRects().length && node.scrollWidth > node.clientWidth + 2)
      .map(node => node.className)), [])
}

test("overview discovery does not enable saving, submit invitations or create content", async () => {
  const page = await pageFor()
  const summary = page.locator(".lwy-together")
  await summary.getByText("共同经历保存已关闭，角色不会再收到这些内容。", { exact: true }).waitFor()
  await summary.getByRole("button", { name: "查看共同经历", exact: true }).click()
  await page.getByRole("heading", { name: "共同经历", exact: true }).waitFor()
  assert.equal(await page.getByRole("checkbox", { name: "保存共同经历", exact: true }).isChecked(), false)
  assert.deepEqual(await writes(page), [])
  assert.deepEqual(page.errors, [])
  await page.close()
})

test("continue writing follows the displayed relationship rather than another stored participant", async () => {
  const page = await pageFor()
  await populate(page)
  await page.getByLabel("选择角色", { exact: true }).selectOption("茉子")
  const summary = page.locator(".lwy-together")
  await summary.getByText("参与角色：茉子", { exact: true }).waitFor()
  assert.equal(await summary.getByText("YUI的草稿", { exact: true }).count(), 0)
  await summary.getByRole("button", { name: "继续写", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("便签内容", { exact: true }).waitFor()
  assert.equal(await page.getByLabel("参与角色", { exact: true }).inputValue(), "茉子")
  assert.equal(await dialog.getByLabel("便签内容", { exact: true }).inputValue(), "茉子的第一句")
  assert.deepEqual(await writes(page), [])
  await dialog.getByLabel("便签内容", { exact: true }).fill("给茉子的新一句")
  await dialog.getByRole("button", { name: "只更新草稿", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  const characters = await page.evaluate(() => window.__uiTest.snapshot().experiences.characters)
  assert.equal(characters["茉子"].note.text, "给茉子的新一句")
  assert.equal(characters.YUI.note.text, "YUI的第一句")
  assert.deepEqual(page.errors, [])
  await page.close()
})

test("shared affection keeps experiences with the explicitly shown current character", async () => {
  const page = await pageFor()
  await populate(page)
  await page.evaluate(() => {
    const state = window.__uiTest.snapshot()
    window.__uiTest.update({ per_character: false, current_character: "茉子",
      scopes: [{ ...state.scopes[0], key: "shared", label: null }] })
  })
  await page.locator(".lwy-together").getByText("参与角色：茉子", { exact: true }).waitFor()
  await page.locator(".lwy-together").getByRole("button", { name: "查看约定", exact: true }).click()
  await page.locator('[data-experience-id="pending-茉子"]').waitFor()
  assert.equal(await page.getByLabel("参与角色", { exact: true }).inputValue(), "茉子")
  assert.equal(await page.getByRole("tab", { name: "以后关心", exact: true }).getAttribute("aria-selected"), "true")
  await page.waitForFunction(() => document.activeElement?.dataset.experienceId === "pending-茉子")
  assert.deepEqual(await writes(page), [])
  await home(page)
  await page.evaluate(() => window.__uiTest.update({ current_character: null }))
  assert.equal(await page.locator(".lwy-together").getByText("茉子的草稿", { exact: true }).count(), 0)
  await page.locator(".lwy-together").getByText("尚未读取到角色。", { exact: true }).waitFor()
  assert.deepEqual(page.errors, [])
  await page.close()
})

test("summary distinguishes unconfirmed invitations, pending agreements and the newest kept note", async () => {
  const page = await pageFor()
  await populate(page)
  const summary = page.locator(".lwy-together")
  await summary.getByText("邀请已提交，请以宿主聊天中的实际回应为准", { exact: true }).waitFor()
  await summary.getByText("YUI待确认的事", { exact: true }).waitFor()
  assert.equal(await summary.getByText("YUI已结束的事", { exact: true }).count(), 0)
  assert.equal(await summary.getByText("YUI的旧便签", { exact: true }).count(), 0)
  await summary.getByRole("button", { name: "打开便签", exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.dataset.experienceId === "memory-YUI")
  assert.equal(await page.getByRole("checkbox", { name: "允许角色在聊天中回忆", exact: true }).last().isChecked(), false)
  assert.deepEqual(await writes(page), [])
  assert.deepEqual(page.errors, [])
  await page.close()
})

test("empty enabled overview opens an explicit draft form without saving", async () => {
  const page = await pageFor()
  await page.evaluate(() => window.__uiTest.update({ experiences: { enabled: true, revision: 1, characters: {} } }))
  await page.locator(".lwy-together").getByRole("button", { name: "开始一张便签", exact: true }).click()
  await page.getByRole("dialog").getByLabel("便签内容", { exact: true }).waitFor()
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click()
  await home(page)
  await page.locator(".lwy-together").getByRole("button", { name: "添加关心事项", exact: true }).click()
  await page.getByRole("dialog").getByLabel("想让她以后关心的事", { exact: true }).waitFor()
  await page.keyboard.press("Escape")
  assert.deepEqual(await writes(page), [])
  assert.deepEqual(page.errors, [])
  await page.close()
})

test("returning home and reopening a shortcut preserves the selected participant and tab", async () => {
  const page = await pageFor()
  await populate(page)
  await page.locator(".lwy-together").getByRole("button", { name: "查看约定", exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.dataset.experienceId === "pending-YUI")
  await page.getByLabel("参与角色", { exact: true }).selectOption("茉子")
  await home(page)
  await page.locator(".lwy-together").getByRole("button", { name: "打开便签", exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.dataset.experienceId === "memory-YUI")
  assert.equal(await page.getByLabel("参与角色", { exact: true }).inputValue(), "YUI")
  assert.equal(await page.getByRole("tab", { name: "一起写便签", exact: true }).getAttribute("aria-selected"), "true")
  assert.deepEqual(await writes(page), [])
  assert.deepEqual(page.errors, [])
  await page.close()
})

test("overview shortcuts fit long content in all locales and both themes", async () => {
  for (const locale of ["zh-CN", "zh-TW", "en", "ja", "ko", "es", "ru", "pt"]) {
    const page = await pageFor({}, locale)
    await populate(page)
    await page.evaluate(() => {
      const state = window.__uiTest.snapshot()
      state.experiences.characters.YUI.note.title = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCD"
      state.experiences.characters.YUI.memories[1].text = "长句ABC".repeat(100)
      window.__uiTest.update({ experiences: state.experiences })
    })
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme })
      for (const width of [320, 390, 700, 800, 1100, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await noOverflow(page)
        if (locale === "zh-CN" && [390, 1100].includes(width)) {
          await page.locator(".lwy-together").scrollIntoViewIfNeeded()
          await page.screenshot({ path: `${artifacts}/${colorScheme}-${width}.png` })
        }
      }
    }
    assert.deepEqual(page.errors, [], locale)
    await page.close()
  }
})
