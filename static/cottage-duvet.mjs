// The duvet on the bed upstairs: a soft sheet that lies flat when the bed is empty and rises over Yui when she is under
// it, so her legs and hips never show through (a box blanket cannot cover a body that turns over).
// Presentation only: it follows her body each frame and saves nothing.
import * as T from "./engine/three.module.min.js"

const damp = (value, target, rate, dt) => value + (target - value) * (1 - Math.exp(-rate * dt))

// bed: the bed's group (its own frame: x across, y up from the floor, z from the headboard toward the foot).
// width: across the bed; from, to: z of the folded top edge and of the foot; top: height of the flat duvet;
// hang: how far it drapes over the sides and the foot; floor: the lowest it hangs to.
export function createDuvet(bed, material, cuffMaterial, { width, from, to, top, hang = .13, floor = .3 }) {
  const columns = 38
  const rows = 34
  const left = -width / 2 - hang
  const right = width / 2 + hang
  const far = to + hang
  const geometry = new T.PlaneGeometry(1, 1, columns, rows)
  geometry.rotateX(-Math.PI / 2)
  const position = geometry.attributes.position
  const count = position.count
  // Each vertex: its place on the bed, the height it lies at when nothing is under it, and the height shown.
  const xs = new Float32Array(count)
  const zs = new Float32Array(count)
  const flat = new Float32Array(count)
  const shown = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const u = position.getX(i) + .5
    const v = position.getZ(i) + .5
    xs[i] = left + (right - left) * u
    zs[i] = from + (far - from) * v
    // Over the edge it bends down steeply, like cloth over a mattress corner.
    const over = Math.max(0, Math.abs(xs[i]) - width / 2, zs[i] - to)
    const rounded = Math.min(over, .03)
    flat[i] = Math.max(floor, top - rounded * rounded / .06 - Math.max(0, over - .03) * 1.6)
    shown[i] = flat[i]
    position.setXYZ(i, xs[i], flat[i], zs[i])
  }
  geometry.computeVertexNormals()
  const sheet = new T.Mesh(geometry, material)
  sheet.receiveShadow = true
  bed.add(sheet)
  // The top edge turned back over itself: a light band across the bed at the head end.
  const cuff = new T.Mesh(new T.CapsuleGeometry(.03, width - .02, 4, 12), cuffMaterial)
  cuff.rotation.z = Math.PI / 2
  cuff.position.set(0, top + .005, from + .03)
  cuff.receiveShadow = true
  bed.add(cuff)

  const toBed = new T.Matrix4()
  const local = []
  let resting = true

  // body: world capsules [{ a, b, radius, cap }] (cottage-yui.mjs capsules; cap: how far above the flat duvet it may
  // lift it, 0 leaves it out), or null; cover: 0..1, how far she is under it.
  // Returns whether it moved (the frame should be drawn again).
  function update(dt, body, cover) {
    const covering = body && cover > .001
    if (!covering && resting) return false
    if (covering) {
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
    }
    // Already under it when she first shows (the cottage opened while she sleeps): no rising.
    const at = covering && resting && cover > .99 ? 1e3 : dt
    let moving = false
    for (let i = 0; i < count; i++) {
      let goal = flat[i]
      if (covering) {
        const x = xs[i]
        const z = zs[i]
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
        goal = Math.max(goal, raised * cover + goal * (1 - cover))
      }
      const next = damp(shown[i], goal, 14, at)
      if (Math.abs(next - shown[i]) > 1e-4) moving = true
      shown[i] = Math.abs(next - goal) < 1e-4 ? goal : next
      position.setY(i, shown[i])
    }
    resting = !covering && !moving
    position.needsUpdate = true
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
    return true
  }

  return { sheet, update }
}
