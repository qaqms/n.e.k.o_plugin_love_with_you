// Seated skirt bake, step 1 of 2 (0.9.50): poses Yui in the cottage's own code (clip, seat fit, hand clearance) and
// writes what Blender needs to drape her skirt as cloth over her seated legs (tools/assets/skirt_bake.py):
//   meta.json  – the collision body's faces, the skirt sheet (rows and columns through her skirt bones), the seat,
//                and per job the frames and her pelvis matrix in each;
//   <job>-body.pc2 – a point cache (Blender's Mesh Cache modifier) of the body;
//   <job>-skirt.pc2 – the skirt sheet carried rigidly by her pelvis, for checking only (the bake moves the cloth
//                with her pelvis matrices: a Mesh Cache under Blender's cloth upsets its rest shape).
// Blender is Z up: points are written as (x, -z, y).
// Usage (from tools/): node assets/skirt_bake_export.mjs <out dir>
import { mkdirSync, openSync, writeSync, closeSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { dependency, startPreview } from "../preview/ui_preview.mjs"

const out = process.argv[2]
if (!out) throw new Error("usage: node assets/skirt_bake_export.mjs <out dir>")
mkdirSync(out, { recursive: true })
const FPS = 30
// What is baked: the looping seated clips over two loops (Blender keeps the second), and the part of the seated
// laugh she plays (cottage-yui.mjs SEAT_LAUGH, with some time either side for the fades).
// Seats as in cottage-routine.mjs (top above the floor, front edge and backrest from her root); the sitting clip
// is used on the sofa, the bench and at the table, so its seat is between them.
export const JOBS = [
  { name: "sit", pose: "sit", loops: 2, seat: { seat: .45, front: .2, back: .3 } },
  { name: "type", pose: "type", loops: 2, seat: { seat: .51, front: .3, back: .085 } },
  { name: "sit-laugh", pose: "sit", part: { clip: "sit-laugh", from: .4, to: 3.9 }, seat: { seat: .45, front: .2, back: .3 } },
]
// Her legs (the hands rest on top of the skirt in the game, and lifting off they would drag the cloth up with them).
const BODY = ["Yui_Skin_LowerBody", "Base_Stockings", "Yui_ShoeUpper_L", "Yui_ShoeUpper_R"]

const { chromium } = dependency("playwright")
const { server, url } = await startPreview(0)
const browser = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] })
const meta = { fps: FPS, jobs: {} }
try {
  for (const job of JOBS) {
    const page = await browser.newPage()
    page.on("pageerror", error => console.error("page:", error.message))
    const files = { body: openSync(join(out, `${job.name}-body.pc2`), "w"), skirt: openSync(join(out, `${job.name}-skirt.pc2`), "w") }
    let counts = null
    const header = (points, samples) => {
      const buffer = Buffer.alloc(32)
      buffer.write("POINTCACHE2\0", 0, "latin1")
      buffer.writeInt32LE(1, 12)
      buffer.writeInt32LE(points, 16)
      buffer.writeFloatLE(0, 20)
      buffer.writeFloatLE(1, 24)
      buffer.writeInt32LE(samples, 28)
      return buffer
    }
    // Frames arrive one at a time (base64 float32); the header is written last, once the count is known.
    for (const file of Object.values(files)) writeSync(file, Buffer.alloc(32))
    let frames = 0
    await page.exposeFunction("sendFrame", (body, skirt) => {
      writeSync(files.body, Buffer.from(body, "base64"))
      writeSync(files.skirt, Buffer.from(skirt, "base64"))
      frames++
    })
    await page.route("**/plugin/love_with_you/ui/skirt-bake.html", route => route.fulfill({
      contentType: "text/html; charset=utf-8", body: `<!doctype html><meta charset="utf-8"><script type="module">
import * as T from "./engine/three.module.min.js"
import { loadYui } from "./cottage-yui.mjs"
const job = ${JSON.stringify(job)}
const BODY = ${JSON.stringify(BODY)}
const FPS = ${FPS}
const yui = await loadYui(new T.Scene(), "./models")
await yui.motion
const root = yui.root
root.position.set(0, 0, 0)
root.rotation.set(0, 0, 0)
root.updateMatrixWorld(true)
const pelvis = root.getObjectByName("下半身")
const blender = (array, offset, v) => { array[offset] = v.x; array[offset + 1] = -v.z; array[offset + 2] = v.y }
// The skirt sheet, at rest, in her pelvis's frame: 8 chains of root head and three tails (rows), with three
// columns between neighbouring chains (round her waist) and two rows between joints.
const COLUMNS = 4, ROWS = 3
const rest = new T.Matrix4().copy(pelvis.matrixWorld).invert()
const chains = Array.from({ length: 8 }, (_, i) => {
  const bones = [1, 2, 3].map(n => root.getObjectByName(\`スカート_\${i}_\${n}\`))
  const points = bones.map(bone => bone.getWorldPosition(new T.Vector3()))
  const leaf = bones[2]
  points.push(leaf.position.clone().normalize().multiplyScalar(leaf.position.length() * .9).applyMatrix4(leaf.matrixWorld))
  return points.map(point => point.applyMatrix4(rest))
})
const rows = []
for (let level = 0; level < 3; level++) for (let k = 0; k < ROWS; k++) rows.push([level, k / ROWS])
rows.push([3, 0])
const sheet = []
for (const [level, t] of rows) for (let c = 0; c < 8; c++) for (let k = 0; k < COLUMNS; k++) {
  const along = (a, b) => a[level].clone().lerp(a[Math.min(3, level + 1)], t)
  const here = along(chains[c]), there = along(chains[(c + 1) % 8])
  // Round the waist: angle and radius about the pelvis's vertical axis, height straight.
  const angle = Math.atan2(here.x, here.z), angle2 = Math.atan2(there.x, there.z)
  let turn = angle2 - angle
  turn = Math.atan2(Math.sin(turn), Math.cos(turn))
  const s = k / COLUMNS
  const radius = Math.hypot(here.x, here.z) * (1 - s) + Math.hypot(there.x, there.z) * s
  const a = angle + turn * s
  sheet.push(new T.Vector3(Math.sin(a) * radius, here.y * (1 - s) + there.y * s, Math.cos(a) * radius))
}
// Which sheet points are the chain joints (row, chain) -> index; rows 1..3 are what the game reads back.
const jointRow = level => rows.findIndex(([l, t]) => l === level && t === 0)
const joints = [1, 2, 3].map(level => Array.from({ length: 8 }, (_, c) => jointRow(level) * 8 * COLUMNS + c * COLUMNS))
// The collision body: selected meshes, skinned on the CPU each frame.
const meshes = []
root.traverse(object => { if (object.isSkinnedMesh && BODY.includes(object.name)) meshes.push(object) })
let offset = 0
const faces = []
for (const mesh of meshes) {
  const index = mesh.geometry.index
  for (let i = 0; i < index.count; i += 3) faces.push([index.getX(i) + offset, index.getX(i + 1) + offset, index.getX(i + 2) + offset])
  offset += mesh.geometry.attributes.position.count
}
const bodyBuffer = new Float32Array(offset * 3)
const skirtBuffer = new Float32Array(sheet.length * 3)
const point = new T.Vector3()
const encode = array => { let s = ""; const bytes = new Uint8Array(array.buffer); for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(s) }
const pelvisFrames = []
const clipFrames = []
async function record() {
  root.updateMatrixWorld(true)
  let at = 0
  for (const mesh of meshes) {
    const count = mesh.geometry.attributes.position.count
    for (let v = 0; v < count; v++) {
      mesh.getVertexPosition(v, point).applyMatrix4(mesh.matrixWorld)
      blender(bodyBuffer, (at + v) * 3, point)
    }
    at += count
  }
  sheet.forEach((local, i) => blender(skirtBuffer, i * 3, point.copy(local).applyMatrix4(pelvis.matrixWorld)))
  pelvisFrames.push(pelvis.matrixWorld.toArray())
  const clip = yui.clip
  clipFrames.push(clip ? [clip.name, clip.time] : null)
  await window.sendFrame(encode(bodyBuffer), encode(skirtBuffer))
}
const viewer = new T.Vector3(0, 1.2, 3)
const seat = { height: job.seat.seat, weight: 1, x: 0, y: 0, z: 0, turn: 0, front: job.seat.front, back: job.seat.back, top: 1 }
// Standing first (the lead-in starts from here), then straight into the seated pose.
for (let i = 0; i < 10; i++) yui.update(1 / FPS, { moving: true, viewer })
await record()
yui.setPose(job.pose, .01)
const step = 1 / FPS
let first = null
if (job.part) {
  for (let i = 0; i < 5; i++) yui.update(step, { moving: true, viewer, seat })
  yui.perform([{ ...job.part, fade: .01 }])
}
const total = job.part ? Math.round((job.part.to - job.part.from) * FPS) : null
for (let frame = 0; ; frame++) {
  yui.update(step, { moving: true, viewer, task: viewer, seat })
  const clip = yui.clip
  if (!first) first = { name: clip.name, duration: clip.duration }
  if (job.part ? frame >= total : frame >= Math.round(first.duration * FPS) * job.loops) break
  await record()
}
window.result = { faces, sheetCount: sheet.length, columns: 8 * COLUMNS, rows: rows.length, joints, bodyCount: offset,
  pelvis: pelvisFrames, clips: clipFrames, clip: first, seat: job.seat, sheetRest: sheet.map(v => v.toArray()) }
</script>` }))
    await page.goto(`${url}/plugin/love_with_you/ui/skirt-bake.html`)
    const result = await page.waitForFunction(() => window.result, null, { timeout: 600000, polling: 500 }).then(handle => handle.jsonValue())
    writeSync(files.body, header(result.bodyCount, frames), 0, 32, 0)
    writeSync(files.skirt, header(result.sheetCount, frames), 0, 32, 0)
    for (const file of Object.values(files)) closeSync(file)
    meta.faces ??= result.faces
    meta.sheet ??= { columns: result.columns, rows: result.rows, joints: result.joints, rest: result.sheetRest }
    meta.jobs[job.name] = { frames, clip: result.clip, clips: result.clips, pelvis: result.pelvis, seat: result.seat, part: job.part || null, loops: job.loops || 1 }
    console.log(job.name, frames, "frames,", result.bodyCount, "body points,", result.clip)
    await page.close()
  }
  writeFileSync(join(out, "meta.json"), JSON.stringify(meta))
} finally {
  await browser.close()
  server.close()
}
