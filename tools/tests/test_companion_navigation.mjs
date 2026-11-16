import assert from "node:assert/strict"
import { before, after, beforeEach, afterEach, test } from "node:test"
import { spawn } from "node:child_process"
import { readFileSync, readdirSync, mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { dependency, fixture, pluginRoot, startPreview } from "../preview/ui_preview.mjs"

const { chromium } = dependency("playwright")
const artifacts = resolve(process.env.NEKO_UI_ARTIFACTS || join(pluginRoot, "archive/reviews/navigation"))
let browser, backend, preview, backendUrl
async function waitForPlay(frame, elapsed) {
  const deadline = Date.now() + 12000
  let state
  while (Date.now() < deadline) {
    state = await frame.evaluate(async () => {
      const { controller } = await import("./adventure.mjs")
      return { paused: controller.scene.paused, elapsed: controller.scene.elapsed, pending: !!controller.api.pending }
    })
    if (!state.paused && !state.pending && state.elapsed > elapsed) return
    await new Promise(resolve => setTimeout(resolve, 80))
  }
  assert.fail(`Game did not advance past ${elapsed}ms: ${JSON.stringify(state)}`)
}
before(async () => {
  mkdirSync(artifacts, { recursive: true })
  preview = await startPreview()
  browser = await chromium.launch({
    executablePath: process.env.NEKO_UI_BROWSER,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  })
})
beforeEach(async () => {
  backend = spawn(process.env.NEKO_PYTHON || "python", ["-B", "tools/preview/adventure_preview.py", "--port", "0"], {
    cwd: pluginRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  })
  backendUrl = await new Promise((resolve, reject) => {
    let output = "", errors = ""
    const timer = setTimeout(() => reject(new Error(`Preview did not start: ${errors}`)), 15000)
    backend.stderr.on("data", data => { errors += data })
    backend.stdout.on("data", data => {
      output += data
      if (output.includes("\n")) {
        clearTimeout(timer)
        resolve(JSON.parse(output.split("\n")[0]).url)
      }
    })
    backend.on("error", reject)
  })
})
after(async () => {
  await browser?.close()
  await new Promise(resolve => preview?.server.close(resolve))
})
afterEach(async () => {
  if (backend && backend.exitCode === null) {
    const exited = new Promise(resolve => backend.once("exit", resolve))
    backend.kill()
    await exited
  }
})

for (const [width, staleFocus] of [[1100, false], [390, false], [1100, true]]) test(`static panel preserves playable game at ${width}px${staleFocus ? " with stale document focus" : ""}`, async () => {
  const page = await browser.newPage({ viewport: { width, height: 820 } })
  page.setDefaultTimeout(12000)
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  const data = fixture()
  data.state.portraits.settings.mode = "off"
  const messages = Object.fromEntries(readdirSync(join(pluginRoot, "i18n")).filter(name => name.endsWith(".json"))
    .map(name => [name.slice(0, -5), JSON.parse(readFileSync(join(pluginRoot, "i18n", name), "utf8"))]))
  const context = { state: data.state, plugin: { id: "love_with_you" }, actions: [], entries: [],
    config: { schema: {}, value: {} }, i18n: { default_locale: "zh-CN", messages } }
  await page.route(`${preview.url}/companion-host`, route => route.fulfill({
    contentType: "text/html; charset=utf-8", body: `<!doctype html><meta charset="utf-8"><style>html,body{height:100%;margin:0}iframe{width:100%;height:100%;border:0;display:block}</style>
<iframe id="surface" sandbox="allow-scripts allow-forms allow-same-origin allow-modals" src="/plugin/love_with_you/ui/panel.html"></iframe>
<script>
const frame=document.getElementById("surface"), context=${JSON.stringify(context)};
window.addEventListener("message",async event=>{
  if(event.source!==frame.contentWindow || event.origin!==location.origin)return;
  const d=event.data;
  if(d?.type!=="neko-hosted-surface-request")return;
  let response;
  if(d.method==="refresh")response={ok:true,result:context};
  else if(d.method==="call" && d.payload.actionId==="adventure_action"){
    response=await (await fetch("/preview/action",{method:"POST",body:JSON.stringify(d.payload.args)})).json();
  }else response={ok:true,result:{ok:true}};
  frame.contentWindow.postMessage({type:"neko-hosted-surface-response",requestId:d.requestId,...response},location.origin);
});
</script>`,
  }))
  await page.route(`${preview.url}/preview/action`, async route => {
    const result = await page.request.post(`${backendUrl}/preview/action`, { data: route.request().postDataJSON() })
    await route.fulfill({ response: result })
  })
  await page.route(`${preview.url}/plugin/love_with_you/ui/**`, async route => {
    const path = new URL(route.request().url()).pathname.split("/ui/")[1]
    const file = resolve(pluginRoot, "static", path)
    assert.ok(file.startsWith(resolve(pluginRoot, "static") + "\\"))
    const suffix = file.split(".").pop()
    const mime = { html: "text/html", mjs: "text/javascript", js: "text/javascript", css: "text/css",
      json: "application/json", png: "image/png", jpg: "image/jpeg" }[suffix] || "application/octet-stream"
    await route.fulfill({ body: readFileSync(file), contentType: mime, headers: { "X-Frame-Options": "SAMEORIGIN" } })
  })
  try {
    await page.goto(`${preview.url}/companion-host`)
    const panel = page.frameLocator("#surface")
    await panel.getByRole("heading", { name: "关系概览", exact: true }).waitFor()
    await panel.getByText("67", { exact: true }).first().waitFor()
    assert.deepEqual(await panel.locator(".lwy-nav button").evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label"))),
      ["关系概览", "共同经历", "礼物商店", "心动记录", "纪念日", "专属称呼", "同行游戏", "设置"])
    assert.equal(await panel.locator(".lwy-game iframe").count(), 0)
    await page.screenshot({ path: join(artifacts, `navigation-${width}.png`) })
    await panel.getByRole("button", { name: "同行游戏", exact: true }).click()
    const game = panel.frameLocator(".lwy-game iframe")
    await game.getByRole("heading", { name: "同行游戏", exact: true }).waitFor()
    await game.getByRole("button", { name: "进入林地", exact: true }).waitFor()
    const gameFrame = page.frames().find(frame => frame.url().includes("/ui/index.html"))
    if (staleFocus) await gameFrame.evaluate(() => {
      Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false })
    })
    const identity = await panel.locator(".lwy-game iframe").elementHandle()
    await page.screenshot({ path: join(artifacts, `companion-game-${width}.png`) })
    await game.getByRole("button", { name: "进入林地", exact: true }).click()
    for (const id of ["fire", "wind"]) {
      await game.locator(`[data-starter="${id}"]`).click()
      await page.waitForTimeout(200)
    }
    await game.locator("#screen").waitFor({ state: "hidden" })
    await panel.getByRole("button", { name: "专属称呼", exact: true }).click()
    await panel.getByRole("heading", { name: "专属称呼", exact: true }).waitFor()
    const hiddenCanvas = await gameFrame.evaluate(async () => {
      const { game } = await import("./adventure.mjs")
      game.scale.getParentBounds()
      game.scale.refresh()
      return { width: game.canvas.width, height: game.canvas.height }
    })
    assert.ok(hiddenCanvas.width > 0 && hiddenCanvas.height > 0, `Hidden canvas must remain renderable: ${JSON.stringify(hiddenCanvas)}`)
    assert.equal(await gameFrame.evaluate(async () => {
      const { controller } = await import("./adventure.mjs")
      window.dispatchEvent(new Event("focus"))
      controller.play()
      return controller.scene.paused
    }), true)
    await panel.getByRole("button", { name: "同行游戏", exact: true }).click()
    assert.equal(await identity.evaluate(node => node === document.querySelector(".lwy-game iframe")), true)
    await game.getByRole("button", { name: "继续", exact: true }).waitFor()
    await game.getByRole("button", { name: "继续", exact: true }).click()
    await game.locator("#screen").waitFor({ state: "hidden" })
    await waitForPlay(gameFrame, 1500)
    assert.match(await game.locator("#clock").textContent(), /^00:0[1-9]/)
    const canvasBounds = await game.locator("#game canvas").evaluate(node => {
      const rect = node.getBoundingClientRect()
      return { width: node.width, height: node.height, displayWidth: rect.width, displayHeight: rect.height }
    })
    assert.ok(Math.abs(canvasBounds.width - canvasBounds.displayWidth) <= 2
      && Math.abs(canvasBounds.height - canvasBounds.displayHeight) <= 2, JSON.stringify(canvasBounds))
    const position = await gameFrame.evaluate(async () => {
      const { controller } = await import("./adventure.mjs")
      return controller.scene.player.x
    })
    await page.keyboard.down("d")
    await page.waitForTimeout(400)
    await page.keyboard.up("d")
    assert.ok(await gameFrame.evaluate(async x => {
      const { controller } = await import("./adventure.mjs")
      return controller.scene.player.x > x + 10
    }, position))
    const panelFrame = page.frames().find(frame => frame.url().includes("/ui/panel.html"))
    await panelFrame.evaluate(() => window.NekoUiKit.api.refresh())
    assert.equal(await identity.evaluate(node => node === document.querySelector(".lwy-game iframe")), true)
    assert.equal(await gameFrame.evaluate(async () => {
      const { controller } = await import("./adventure.mjs")
      return controller.scene.paused
    }), false)
    await page.screenshot({ path: join(artifacts, `companion-playing-${width}.png`) })
    await game.getByRole("button", { name: "暂停", exact: true }).click()
    const pausedTime = await gameFrame.evaluate(async () => {
      const { controller } = await import("./adventure.mjs")
      return controller.scene.elapsed
    })
    await page.waitForTimeout(250)
    assert.equal(await gameFrame.evaluate(async () => {
      const { controller } = await import("./adventure.mjs")
      return controller.scene.elapsed
    }), pausedTime)
    await game.getByRole("button", { name: "继续", exact: true }).click()
    await waitForPlay(gameFrame, pausedTime + 250)
    if (!staleFocus && width === 1100) {
      // Reload creates a new client while the real isolated backend retains the old owner.
      await page.reload()
      await panel.getByRole("button", { name: "同行游戏", exact: true }).click()
      await game.getByRole("button", { name: "继续旅程", exact: true }).click()
      await game.getByRole("heading", { name: "旅程由其他页面持有", exact: true }).waitFor()
      await page.screenshot({ path: join(artifacts, "companion-control-conflict.png") })
      page.once("dialog", dialog => dialog.dismiss())
      await game.getByRole("button", { name: "接管此旅程", exact: true }).click()
      await game.getByRole("heading", { name: "旅程由其他页面持有", exact: true }).waitFor()
      page.once("dialog", dialog => dialog.accept())
      await game.getByRole("button", { name: "接管此旅程", exact: true }).click()
      await game.locator("#screen").waitFor({ state: "hidden" })
      const recovered = page.frames().find(frame => frame.url().includes("/ui/index.html"))
      await waitForPlay(recovered, 1500)
      assert.match(await game.locator("#clock").textContent(), /^00:0[1-9]/)
      assert.ok(await recovered.evaluate(async () => {
        const { controller } = await import("./adventure.mjs")
        await controller.save()
        return controller.lastSaved
      }) > 1500)
      await page.screenshot({ path: join(artifacts, "companion-takeover-playing.png") })
    }
    assert.equal(await panel.locator(".lwy-workspace").evaluate(node => node.scrollWidth <= node.clientWidth + 2), true)
    assert.deepEqual(errors, [])
  } catch (error) {
    await page.screenshot({ path: join(artifacts, `failed-${width}.png`) })
    throw new Error(`${error.message}\nBrowser errors: ${errors.join("\n")}\n${(await page.frameLocator("#surface").locator("body").innerText()).slice(0, 2500)}`)
  } finally { await page.close() }
})
