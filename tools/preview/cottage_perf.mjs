// Cottage frame cost on this machine's GPU: median frame time, draw calls and triangles per quality tier while the
// camera is dragged, for each look (NEKO_PERF_STYLES, default "lofi,classic"). Uncapped frame rate; run from the
// plugin root: node tools/preview/cottage_perf.mjs
// The GPU flags are for Windows (ANGLE on Direct3D 11); set NEKO_PERF_ANGLE to another ANGLE backend elsewhere.
import { dependency, startPreview } from "./ui_preview.mjs"

const { chromium } = dependency("playwright")
const { server, url } = await startPreview(0)
const browser = await chromium.launch({
  args: [`--use-angle=${process.env.NEKO_PERF_ANGLE || "d3d11"}`, "--enable-gpu", "--ignore-gpu-blocklist",
    "--disable-gpu-vsync", "--disable-frame-rate-limit"],
})

const hook = () => {
  const stats = window.__perf = { frames: [], draws: 0, tris: 0, passes: 0, programs: new Set(), textures: 0 }
  const wrap = proto => {
    for (const name of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"]) {
      const original = proto[name]
      proto[name] = function (...args) {
        stats.draws++
        const count = name.startsWith("drawElements") ? args[1] : args[2]
        const instances = name.endsWith("Instanced") ? args[name === "drawElementsInstanced" ? 4 : 3] : 1
        if (args[0] === 4) stats.tris += count / 3 * instances
        return original.apply(this, args)
      }
    }
    const bind = proto.bindFramebuffer
    proto.bindFramebuffer = function (...args) { stats.passes++; return bind.apply(this, args) }
    const use = proto.useProgram
    proto.useProgram = function (p) { if (p) stats.programs.add(p); return use.call(this, p) }
  }
  wrap(WebGL2RenderingContext.prototype)
  let last = 0, snapshot = { draws: 0, tris: 0, passes: 0 }
  const tick = t => {
    if (last) {
      const draws = stats.draws - snapshot.draws
      if (draws) stats.frames.push({ dt: t - last, draws, tris: stats.tris - snapshot.tris, passes: stats.passes - snapshot.passes })
    }
    snapshot = { draws: stats.draws, tris: stats.tris, passes: stats.passes }
    last = t
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

const median = values => { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
const styles = (process.env.NEKO_PERF_STYLES || "lofi,classic").split(",")
for (const style of styles) for (const quality of ["low", "medium", "high"]) {
  for (const view of ["overview", "living"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 })
    await page.addInitScript(hook)
    await page.addInitScript(v => {
      if (v !== "overview") sessionStorage.setItem("love_with_you:cottage:camera", JSON.stringify({ view: v, azimuth: .69, elevation: .52 }))
    }, view)
    await page.clock.setFixedTime(new Date(2026, 10, 22, 20, 30))
    await page.goto(`${url}/plugin/love_with_you/ui/cottage.html?quality=${quality}&style=${style}&locale=zh-CN`)
    await page.locator("canvas").waitFor()
    await page.locator("#room[data-yui]").waitFor({ timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(2500)
    await page.evaluate(() => { window.__perf.frames.length = 0 })
    const box = await page.locator("canvas").boundingBox()
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    for (let i = 0; i < 160; i++) await page.mouse.move(cx + Math.sin(i / 12) * 220, cy + Math.cos(i / 17) * 40)
    await page.mouse.up()
    const r = await page.evaluate(() => ({ frames: window.__perf.frames, programs: window.__perf.programs.size,
      dpr: devicePixelRatio, size: [document.querySelector("canvas").width, document.querySelector("canvas").height],
      yui: document.querySelector("#room")?.dataset.yui, quality: document.querySelector("#room")?.dataset.quality }))
    const f = r.frames.slice(3)
    console.log(JSON.stringify({ style, quality, view, shown: r.quality, yui: r.yui, canvas: r.size, n: f.length,
      dtMedian: +median(f.map(x => x.dt)).toFixed(2), dtP90: +[...f.map(x => x.dt)].sort((a, b) => a - b)[Math.floor(f.length * .9)]?.toFixed(2),
      draws: median(f.map(x => x.draws)), ktris: Math.round(median(f.map(x => x.tris)) / 1000), fbBinds: median(f.map(x => x.passes)), programs: r.programs }))
    await page.close()
  }
}
await browser.close(); server.close()
