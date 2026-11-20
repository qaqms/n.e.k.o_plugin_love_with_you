import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { SLOTS } from "../../static/cottage-layout.mjs"
import { dependency, startPreview } from "../preview/ui_preview.mjs"

const { chromium } = dependency("playwright")
let browser, server, url
before(async () => {
  ;({ server, url } = await startPreview())
  browser = await chromium.launch({
    executablePath: process.env.NEKO_UI_BROWSER || undefined,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  })
})
after(async () => {
  await browser?.close()
  server?.close()
})

test("the gray-box viewer opens every room and lists that room's slots", async () => {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
  const errors = []
  page.on("pageerror", error => errors.push(String(error)))
  page.on("console", message => message.type() === "error" && errors.push(message.text()))
  await page.goto(`${url}/blockout`)
  await page.waitForFunction(() => window.__blockout?.ready)
  assert.equal(await page.locator("#info li").count(), SLOTS.length)
  for (const id of ["living", "kitchen", "porch", "bedroom", "study", "overview"]) {
    await page.click(`#view-${id}`)
    await page.waitForFunction(() => !window.__blockout.moving)
    assert.equal(await page.evaluate(() => window.__blockout.view), id)
    assert.equal(await page.getAttribute(`#view-${id}`, "aria-pressed"), "true")
    const expected = id === "overview" ? SLOTS.length : SLOTS.filter(slot => slot.room === id).length
    assert.equal(await page.locator("#info li").count(), expected, `${id} lists its slots`)
  }
  await page.click("#view-living")
  await page.locator('#info li[data-slot="living-sofa"]').click()
  assert.equal(await page.locator("#info li.picked").getAttribute("data-slot"), "living-sofa")
  // WebGL clears its buffer after each frame, so read the composited screenshot instead of the canvas.
  const png = await page.locator("#stage").screenshot()
  const pixels = await page.evaluate(async encoded => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${encoded}`)).blob())
    const probe = document.createElement("canvas")
    probe.width = 64
    probe.height = 40
    const context = probe.getContext("2d")
    context.drawImage(image, 0, 0, 64, 40)
    const data = context.getImageData(0, 0, 64, 40).data
    return new Set(Array.from({ length: data.length / 4 }, (_, index) => data[index * 4] >> 4 << 8 | data[index * 4 + 1] >> 4 << 4 | data[index * 4 + 2] >> 4)).size
  }, png.toString("base64"))
  assert.ok(pixels > 20, `canvas should show the house, saw ${pixels} colours`)
  assert.deepEqual(errors, [])
  await page.close()
})
