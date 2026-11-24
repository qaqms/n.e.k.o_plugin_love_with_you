// The duvet on the bed upstairs: a soft sheet that lies flat when the bed is empty and rises over Yui when she is under
// it, so her legs and hips never show through (a box blanket cannot cover a body that turns over).
// 0.9.59: `edge`, where she takes hold of it to pull it back over her.
// 0.9.52: it is thrown back when she gets up — the part on the side she gets out pushed over onto the other half,
// bunched up — and stays so while the bed is empty; getting in, she pulls it back over her.
// Presentation only: it follows her body each frame and saves nothing.
import * as T from "./engine/three.module.min.js"

const damp = (value, target, rate, dt) => value + (target - value) * (1 - Math.exp(-rate * dt))

// bed: the bed's group (its own frame: x across, y up from the floor, z from the headboard toward the foot).
// width: across the bed; from, to: z of the folded top edge and of the foot; top: height of the flat duvet;
// hang: how far it drapes over the sides and the foot; floor: the lowest it hangs to.
// fold: where it is thrown back, { a: [x, z], b: [x, z], toward: 1 | -1, squeeze }: the line it folds along (from the
// head end to the foot), which side of it is thrown over (+x or -x), and how much narrower the thrown part lies.
export function createDuvet(bed, material, cuffMaterial, { width, from, to, top, hang = .13, floor = .3, fold = null }) {
  const columns = 38
  const rows = 34
  const left = -width / 2 - hang
  const right = width / 2 + hang
  const far = to + hang
  const geometry = new T.PlaneGeometry(1, 1, columns, rows)
  geometry.rotateX(-Math.PI / 2)
  const position = geometry.attributes.position
  const count = position.count
  // Over the edge it bends down steeply, like cloth over a mattress corner.
  const flatAt = (x, z) => {
    const over = Math.max(0, Math.abs(x) - width / 2, z - to)
    const rounded = Math.min(over, .03)
    return Math.max(floor, top - rounded * rounded / .06 - Math.max(0, over - .03) * 1.6)
  }
  // The fold line: a point on it, its direction, and the way across it to the side that is thrown over.
  const line = fold && (() => {
    const [ax, az] = fold.a
    const dx = fold.b[0] - ax
    const dz = fold.b[1] - az
    const length = Math.hypot(dx, dz)
    let nx = dz / length
    let nz = -dx / length
    if (Math.sign(nx) !== Math.sign(fold.toward || 1)) { nx = -nx; nz = -nz }
    return { ax, az, nx, nz, squeeze: fold.squeeze ?? .5 }
  })()
  // Each vertex: its place on the bed, the height it lies at when nothing is under it, the height shown, and how far
  // it is across the fold line (> 0: on the part that is thrown back).
  const xs = new Float32Array(count)
  const zs = new Float32Array(count)
  const flat = new Float32Array(count)
  const shown = new Float32Array(count)
  const across = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const u = position.getX(i) + .5
    const v = position.getZ(i) + .5
    xs[i] = left + (right - left) * u
    zs[i] = from + (far - from) * v
    flat[i] = flatAt(xs[i], zs[i])
    shown[i] = flat[i]
    across[i] = line ? (xs[i] - line.ax) * line.nx + (zs[i] - line.az) * line.nz : 0
    position.setXYZ(i, xs[i], flat[i], zs[i])
  }
  geometry.computeVertexNormals()
  const sheet = new T.Mesh(geometry, material)
  sheet.receiveShadow = true
  bed.add(sheet)
  // The top edge turned back over itself: a light band across the bed at the head end.
  const cuffLength = width - .02
  const cuff = new T.Mesh(new T.CapsuleGeometry(.03, cuffLength, 4, 12), cuffMaterial)
  cuff.rotation.z = Math.PI / 2
  cuff.position.set(0, top + .005, from + .03)
  cuff.receiveShadow = true
  bed.add(cuff)
  // Thrown back, the band goes with the part that is thrown over: it shows from the other side to the fold.
  function placeCuff(open) {
    if (!line) return
    const z = from + .03
    // Where the fold line crosses the band.
    const t = line.nz === 0 ? line.ax : line.ax - (z - line.az) * line.nz / line.nx
    const keep = Math.max(-cuffLength / 2, Math.min(cuffLength / 2, t))
    // It goes early, before the part it lies on has moved far.
    open = Math.sqrt(open)
    const [lo, hi] = line.nx > 0 ? [-cuffLength / 2, cuffLength / 2 + (keep - cuffLength / 2) * open]
      : [-cuffLength / 2 + (keep + cuffLength / 2) * open, cuffLength / 2]
    cuff.scale.y = Math.max(.02, (hi - lo) / cuffLength)
    cuff.position.x = (lo + hi) / 2
  }

  const toBed = new T.Matrix4()
  const local = []
  let resting = true
  let shownOpen = 0

  // The highest the body lifts the duvet at (x, z) on the bed (0 where it does not reach).
  function liftAt(x, z) {
    let raised = 0
    for (const { a, b, radius, cap } of local) {
      // The nearest point of the capsule's axis, seen from above, and the height of its top there.
      const dx = b.x - a.x
      const dz = b.z - a.z
      const length = dx * dx + dz * dz
      const t = length > 1e-8 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / length)) : 0
      const px = a.x + dx * t
      const pz = a.z + dz * t
      const distance = Math.hypot(x - px, z - pz)
      const height = a.y + (b.y - a.y) * t
      const reach = radius + .025
      // Over the body it follows its round top; beyond it, it falls away like cloth pulled over a shape.
      const lift = distance < reach ? height + Math.sqrt(reach * reach - distance * distance)
        : height + reach * .2 - (distance - reach) * 1.25
      const capped = Math.min(lift, top + cap)
      if (capped > raised) raised = capped
    }
    return raised
  }

  // body: world capsules [{ a, b, radius, cap }] (cottage-yui.mjs capsules; cap: how far above the flat duvet it may
  // lift it, 0 leaves it out), or null; cover: 0..1, how far she is under it; open: 0..1, how far it is thrown back.
  // Returns whether it moved (the frame should be drawn again).
  function update(dt, body, cover, open = 0) {
    open = line ? Math.max(0, Math.min(1, open)) : 0
    const hasBody = Boolean(body)
    const covering = hasBody && cover > .001
    if (!covering && resting && open === shownOpen) return false
    if (hasBody) {
      toBed.copy(bed.matrixWorld).invert()
      let used = 0
      for (const item of body) {
        if (!(item.cap > 0)) continue
        const entry = local[used] || (local[used] = { a: new T.Vector3(), b: new T.Vector3(), radius: 0, cap: 0 })
        entry.a.copy(item.a).applyMatrix4(toBed)
        entry.b.copy(item.b).applyMatrix4(toBed)
        entry.radius = item.radius
        entry.cap = item.cap
        used++
      }
      local.length = used
    } else local.length = 0
    // Already under it when she first shows (the cottage opened while she sleeps), or the bed made up or thrown back
    // when the cottage opens: no rising.
    const at = covering && resting && cover > .99 || shownOpen === 0 && open === 1 && resting ? 1e3 : dt
    // While it is thrown over her it rides over her (her legs come out from under it, not through it).
    const thrown = Math.min(1, open * 3)
    let moving = false
    for (let i = 0; i < count; i++) {
      let x = xs[i]
      let z = zs[i]
      let goal = flat[i]
      const d = across[i]
      if (open > 0 && d > 0) {
        // Over onto the other half: across the fold line and squeezed narrower, in a few rolls, lifted a little
        // on the way.
        const moved = d - open * d * (1 + line.squeeze)
        x += line.nx * (moved - d)
        z += line.nz * (moved - d)
        goal = flatAt(x, z)
        if (local.length) goal = Math.max(goal, liftAt(x, z) * Math.max(cover, thrown) + goal * (1 - Math.max(cover, thrown)))
        if (moved < 0) goal += Math.min(1, open * 2) * (.035 + .03 * (.5 + .5 * Math.sin(d * 11)))
        goal += Math.sin(Math.PI * open) * .06 * Math.min(1, d * 3)
      } else if (covering) goal = Math.max(goal, liftAt(x, z) * cover + goal * (1 - cover))
      const next = damp(shown[i], goal, 14, at)
      if (Math.abs(next - shown[i]) > 1e-4) moving = true
      shown[i] = Math.abs(next - goal) < 1e-4 ? goal : next
      position.setXYZ(i, x, shown[i], z)
    }
    shownOpen = open
    placeCuff(open)
    resting = !covering && !moving
    position.needsUpdate = true
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
    return true
  }

  // Where she takes hold of it to pull it back over her (0.9.59): the top corner of the part that is thrown back, as
  // it lies with the duvet `open` that far, into `target` (world). Null without a fold.
  const corner = new T.Vector3()
  function edge(open, target) {
    if (!line) return null
    const x = right - .1
    const z = from + .12
    const d = (x - line.ax) * line.nx + (z - line.az) * line.nz
    const shift = -open * d * (1 + line.squeeze)
    corner.set(x + line.nx * shift, top + .05 + Math.sin(Math.PI * open) * .06, z + line.nz * shift)
    return target.copy(bed.localToWorld(corner))
  }

  return { sheet, update, edge }
}
