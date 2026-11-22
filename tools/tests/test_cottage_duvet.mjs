import assert from "node:assert/strict"
import { test } from "node:test"
import * as T from "../../static/engine/three.module.min.js"
import { createDuvet } from "../../static/cottage-duvet.mjs"

const options = { width: 1.8, from: -.2, to: 1, top: .5 }
const heights = duvet => {
  const position = duvet.sheet.geometry.attributes.position
  return Array.from({ length: position.count }, (_, i) => [position.getX(i), position.getY(i), position.getZ(i)])
}
// A leg lying along the bed under the duvet, and her head on the pillow (left out with cap 0).
const leg = () => [{ a: new T.Vector3(.2, .52, .1), b: new T.Vector3(.2, .52, .8), radius: .08, cap: .4 },
  { a: new T.Vector3(.2, .7, -.6), b: new T.Vector3(.2, .7, -.6), radius: .1, cap: 0 }]

test("the duvet lies flat on an empty bed and drapes over the sides", () => {
  const bed = new T.Group()
  bed.updateMatrixWorld()
  const duvet = createDuvet(bed, new T.MeshBasicMaterial(), new T.MeshBasicMaterial(), options)
  for (const [x, y, z] of heights(duvet)) {
    if (Math.abs(x) <= .9 && z <= 1) assert.equal(y, .5)
    else assert.ok(y < .5 && y >= .3, "over the edge it hangs down")
  }
  assert.equal(duvet.update(.016, null, 0), false, "nothing to do while the bed is empty")
})

test("the duvet rises over her body, never lets it through, and settles flat again when she gets out", () => {
  const bed = new T.Group()
  bed.position.set(-1.6, 3.52, -1.45)
  bed.updateMatrixWorld()
  const duvet = createDuvet(bed, new T.MeshBasicMaterial(), new T.MeshBasicMaterial(), options)
  const body = leg().map(item => ({ ...item, a: item.a.clone().applyMatrix4(bed.matrixWorld), b: item.b.clone().applyMatrix4(bed.matrixWorld) }))
  // Already in bed when the room opens: it is over her at once.
  assert.equal(duvet.update(.016, body, 1), true)
  for (const [x, y, z] of heights(duvet)) {
    if (Math.abs(x - .2) < .07 && z > .15 && z < .75) assert.ok(y > .52 + .08, `covers the leg at ${x.toFixed(2)}, ${z.toFixed(2)}`)
    if (Math.abs(x - .2) < .1 && z < -.15) assert.equal(y, .5, "the head (cap 0) does not lift it")
    assert.ok(y <= .5 + .4 + 1e-6, "no higher than the leg's cap")
  }
  for (let i = 0; i < 200; i++) duvet.update(.05, null, 0)
  assert.ok(heights(duvet).every(([x, y, z]) => Math.abs(x) > .9 || z > 1 || Math.abs(y - .5) < 1e-6), "flat again")
  assert.equal(duvet.update(.05, null, 0), false)
})
