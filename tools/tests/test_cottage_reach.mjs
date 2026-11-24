import assert from "node:assert/strict"
import { test } from "node:test"
import * as T from "../../static/engine/three.module.min.js"
import { reach } from "../../static/cottage-reach.mjs"

// A left arm hanging from a shoulder at (0.2, 1.3, 0), bent a little forward at the elbow.
function arm() {
  const body = new T.Group()
  const upper = new T.Bone()
  upper.position.set(.2, 1.3, 0)
  const lower = new T.Bone()
  lower.position.set(0, -.25, 0)
  const hand = new T.Bone()
  hand.position.set(0, -.22, 0)
  body.add(upper)
  upper.add(lower)
  lower.add(hand)
  lower.rotation.x = -.4
  body.updateMatrixWorld(true)
  return { upper, lower, hand }
}
const at = bone => bone.getWorldPosition(new T.Vector3())

test("a hand moves by the asked amount and the arm keeps its length", () => {
  const { upper, lower, hand } = arm()
  const before = at(hand)
  const shift = new T.Vector3(.05, .08, .03)
  reach(upper, lower, hand, shift)
  assert.ok(at(hand).distanceTo(before.add(shift)) < 1e-4, "the hand is where it was asked to go")
  assert.ok(Math.abs(at(upper).distanceTo(at(lower)) - .25) < 1e-6)
  assert.ok(Math.abs(at(lower).distanceTo(at(hand)) - .22) < 1e-6)
})

test("the elbow keeps bending the way it bent", () => {
  const { upper, lower, hand } = arm()
  const side = () => new T.Vector3().subVectors(at(lower), at(upper)).cross(new T.Vector3().subVectors(at(hand), at(lower))).normalize()
  const plane = side()
  reach(upper, lower, hand, new T.Vector3(0, .1, .02))
  assert.ok(side().dot(plane) > .95)
})

test("out of reach the hand goes as far as the arm allows, and nothing changes for no shift", () => {
  const { upper, lower, hand } = arm()
  const before = upper.quaternion.clone()
  reach(upper, lower, hand, new T.Vector3())
  assert.ok(upper.quaternion.equals(before))
  reach(upper, lower, hand, new T.Vector3(0, -2, 0))
  assert.ok(Math.abs(at(upper).distanceTo(at(hand)) - .47) < 1e-3)
})
