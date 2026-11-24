// Two-bone reach for Yui's arms (0.9.49): moves a hand by a given amount after the clip has posed her, turning only
// the upper arm and the forearm, with the elbow bending in the plane it already bends in. Used to keep her hands out
// of her own head (the clips were made for a smaller head) and off the seat she sits on.
import * as T from "./engine/three.module.min.js"

const shoulder = new T.Vector3()
const elbow = new T.Vector3()
const wrist = new T.Vector3()
const target = new T.Vector3()
const toElbow = new T.Vector3()
const toWrist = new T.Vector3()
const axis = new T.Vector3()
const turn = new T.Quaternion()
const world = new T.Quaternion()
const parent = new T.Quaternion()

// Turns `bone` by the world rotation `rotation` (about its own position).
export function turnBone(bone, rotation) {
  bone.getWorldQuaternion(world)
  bone.parent.getWorldQuaternion(parent)
  bone.quaternion.copy(parent.invert().multiply(rotation).multiply(world))
  bone.updateMatrixWorld(true)
}

// upper, lower, hand: the arm's bones (matrices up to date). shift: the world vector to move the hand by.
// The hand ends where it is asked to go, or as near as the arm's length allows.
// bend (optional, 0.9.55): the axis the joint should bend about (a leg's knee bends forward), used when the limb is
// nearly straight or bent the other way, where its own plane says little.
export function reach(upper, lower, hand, shift, bend = null) {
  if (shift.lengthSq() < 1e-10) return
  upper.getWorldPosition(shoulder)
  lower.getWorldPosition(elbow)
  hand.getWorldPosition(wrist)
  target.copy(wrist).add(shift)
  const a = shoulder.distanceTo(elbow)
  const b = elbow.distanceTo(wrist)
  const d = T.MathUtils.clamp(shoulder.distanceTo(target), Math.abs(a - b) + 1e-4, a + b - 1e-4)
  // 1. Bend the elbow to the distance the target needs.
  toElbow.subVectors(shoulder, elbow)
  toWrist.subVectors(wrist, elbow)
  axis.crossVectors(toElbow, toWrist)
  if (bend && (axis.lengthSq() < 1e-4 * toElbow.lengthSq() * toWrist.lengthSq() || axis.dot(bend) < 0)) axis.copy(bend)
  if (axis.lengthSq() < 1e-10) axis.set(1, 0, 0).cross(toElbow)
  axis.normalize()
  const now = toElbow.angleTo(toWrist)
  const wanted = Math.acos(T.MathUtils.clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1))
  turnBone(lower, turn.setFromAxisAngle(axis, wanted - now))
  // 2. Swing the whole arm from the shoulder so the hand points at the target.
  hand.getWorldPosition(wrist)
  turnBone(upper, turn.setFromUnitVectors(toWrist.subVectors(wrist, shoulder).normalize(),
    toElbow.subVectors(target, shoulder).normalize()))
}
