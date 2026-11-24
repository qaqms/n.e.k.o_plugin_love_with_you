import assert from "node:assert/strict"
import { test } from "node:test"
import * as T from "../../static/engine/three.module.min.js"
import { createSprings } from "../../static/cottage-springs.mjs"

// A pelvis with one skirt chain of two bones hanging from its front, 0.1 m out from its middle.
function skirt() {
  const body = new T.Group()
  const pelvis = new T.Bone()
  pelvis.position.set(0, 1, 0)
  const top = new T.Bone()
  top.position.set(0, 0, .1)
  const lower = new T.Bone()
  lower.position.set(0, -.15, 0)
  const end = new T.Bone()
  end.position.set(0, -.15, 0)
  body.add(pelvis)
  pelvis.add(top)
  top.add(lower)
  lower.add(end)
  body.updateMatrixWorld(true)
  return { body, pelvis, top, lower, end }
}
const at = bone => bone.getWorldPosition(new T.Vector3())

test("targets take the tails where they are asked to go, keeping the bones' lengths", () => {
  const { top, lower, end } = skirt()
  const springs = createSprings([{ ring: false, chains: [{ bones: [top, lower], stiffness: 4, drag: .4, gravity: 0, radius: .01 }] }], [])
  springs.reset()
  // The chain lifted forward, as over a seated thigh.
  const points = [[new T.Vector3(0, .95, .25)], [new T.Vector3(0, .9, .39)]]
  springs.setTargets(0, points, 1)
  springs.update(1 / 60)
  const toward = new T.Vector3().subVectors(points[0][0], at(top)).normalize()
  assert.ok(new T.Vector3().subVectors(at(lower), at(top)).normalize().dot(toward) > .999)
  assert.ok(Math.abs(at(lower).distanceTo(at(top)) - .15) < 1e-6)
  springs.setTargets(0, null, 0)
  for (let i = 0; i < 240; i++) springs.update(1 / 60)
  assert.ok(at(lower).y < at(top).y - .14, "without targets it hangs down again")
  assert.ok(at(end))
})

test("the backstop keeps a panel from swinging in toward the body further than its angle", () => {
  const { pelvis, top, lower } = skirt()
  const springs = createSprings([{ ring: false, backstop: { centre: pelvis, angle: .3 },
    chains: [{ bones: [top, lower], stiffness: 0, drag: 0, gravity: 0, radius: .01 }] }], [])
  springs.reset()
  // Thrown hard inward (toward the pelvis's axis, -z) and then left alone.
  const tail = new T.Vector3(0, .85, .1 - .15)
  springs.setTargets(0, [[tail]], 1)
  springs.update(1 / 60)
  springs.setTargets(0, null, 0)
  for (let i = 0; i < 30; i++) springs.update(1 / 60)
  const swing = new T.Vector3().subVectors(at(lower), at(top)).normalize()
  assert.ok(swing.z > -Math.sin(.3) - 1e-3, `it swings in no further than the backstop allows (${swing.z.toFixed(3)})`)
})
