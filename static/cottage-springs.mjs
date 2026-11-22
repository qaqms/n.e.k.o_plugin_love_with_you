// Spring bones for Yui's skirt and ponytails, in the style of VRM spring bones: each joint's tip keeps its
// momentum, is pulled back toward the direction the animated parent gives it, and is pushed out of a few
// capsules around the legs and body. Runs in fixed 60 Hz steps so it behaves the same at any frame rate.
// Chains in a ring (the skirt) are solved level by level, and neighbouring tips may not drift much further
// apart than at rest, so the skirt panels do not open gaps when a leg pushes one of them out.
import * as T from "./engine/three.module.min.js"

const STEP = 1 / 60
const RING_SLACK = 1.08
const head = new T.Vector3()
const rest = new T.Vector3()
const next = new T.Vector3()
const scratch = new T.Vector3()
const start = new T.Vector3()
const end = new T.Vector3()
const parentTurn = new T.Quaternion()
const swing = new T.Quaternion()
const ignored = new T.Vector3()
const down = new T.Vector3(0, -1, 0)
const baseTurn = new T.Quaternion()
const limbTurn = new T.Quaternion()
const follow = new T.Quaternion()
const identity = new T.Quaternion()
const partial = new T.Quaternion()

// groups: [{ ring: boolean, chains: [{ bones: [root ... leaf], stiffness: number or [per joint], drag, gravity,
//   radius, tip, follow }] }]; tip is the leaf's virtual tail as a share of the bone's own offset; follow is
//   [{ limb, base, weight }]: the chain's root turns by that share of the limb's turn relative to base.
// Create it while the model is in its rest pose, with matrices updated.
// colliders: [{ from: bone, to: bone (optional), radius, start }] — capsules between two bones (beginning at
// the share "start" of the way along), or spheres.
export function createSprings(groups, colliders) {
  const worldTurn = bone => {
    const turn = new T.Quaternion()
    bone.matrixWorld.decompose(ignored, turn, scratch)
    return turn
  }
  const built = groups.map(({ ring, chains }) => {
    const joints = chains.map(chain => chain.bones.map((bone, i) => {
      const child = chain.bones[i + 1]
      // The tail direction in the bone's own space: toward the child, or straight on for the leaf.
      const axis = (child ? child.position : bone.position).clone().normalize()
      const local = child ? child.position.length() : bone.position.length() * (chain.tip || .8)
      return {
        bone, axis, local, length: 0, rest: bone.quaternion.clone(), tail: new T.Vector3(), prev: new T.Vector3(),
        head: new T.Vector3(), turn: new T.Quaternion(), parentTurn: new T.Quaternion(), restDir: new T.Vector3(),
        stiffness: Array.isArray(chain.stiffness) ? chain.stiffness[Math.min(i, chain.stiffness.length - 1)] : chain.stiffness,
        drag: chain.drag, gravity: chain.gravity, radius: chain.radius,
        // Only the root of a chain follows limbs; the rest of the chain is carried along by its parent.
        follow: i === 0 ? (chain.follow || []).filter(item => item.weight > 0).map(item => ({
          ...item, restInverse: worldTurn(item.base).invert().multiply(worldTurn(item.limb)).invert(),
        })) : [],
      }
    }))
    const depth = Math.max(...joints.map(chain => chain.length))
    const levels = Array.from({ length: depth }, (_, k) => joints.map(chain => chain[k]).filter(Boolean))
    return { ring, levels, gaps: levels.map(() => []) }
  })
  let pending = 0

  // Back to the rest pose with tails at rest; call after the body has been posed for the frame.
  function reset() {
    pending = 0
    for (const group of built) {
      for (const level of group.levels) for (const joint of level) {
        const { bone } = joint
        bone.quaternion.copy(joint.rest)
        bone.updateMatrixWorld(true)
        head.setFromMatrixPosition(bone.matrixWorld)
        joint.tail.copy(joint.axis).multiplyScalar(joint.local).applyMatrix4(bone.matrixWorld)
        joint.length = joint.tail.distanceTo(head)
        joint.prev.copy(joint.tail)
      }
      if (group.ring) group.gaps = group.levels.map(level =>
        level.map((joint, i) => joint.tail.distanceTo(level[(i + 1) % level.length].tail)))
    }
  }

  function collide(point, radius) {
    for (const collider of colliders) {
      start.setFromMatrixPosition(collider.from.matrixWorld)
      if (collider.to) {
        end.setFromMatrixPosition(collider.to.matrixWorld)
        if (collider.start) start.lerp(end, collider.start)
        scratch.subVectors(end, start)
        const t = T.MathUtils.clamp(scratch.dot(next.subVectors(point, start)) / Math.max(scratch.lengthSq(), 1e-8), 0, 1)
        start.addScaledVector(scratch, t)
      }
      const reach = collider.radius + radius
      scratch.subVectors(point, start)
      const distance = scratch.length()
      if (distance < reach && distance > 1e-6) point.copy(start).addScaledVector(scratch, reach / distance)
    }
  }

  // Keep a tail on its bone's length from the bone's head, outside the colliders.
  function settle(joint) {
    collide(joint.tail, joint.radius)
    joint.tail.sub(joint.head).normalize().multiplyScalar(joint.length).add(joint.head)
  }

  function step() {
    for (const group of built) group.levels.forEach((level, k) => {
      for (const joint of level) {
        const { bone } = joint
        bone.parent.matrixWorld.decompose(ignored, joint.parentTurn, scratch)
        joint.turn.copy(joint.parentTurn).multiply(joint.rest)
        // A skirt panel next to a leg swings part of the way with the thigh (its turn relative to the hips).
        // In world space that turn is limb * (base^-1 * limb at rest)^-1 * base^-1.
        for (const { limb, base, weight, restInverse } of joint.follow) {
          limb.matrixWorld.decompose(ignored, limbTurn, scratch)
          base.matrixWorld.decompose(ignored, baseTurn, scratch)
          follow.copy(limbTurn).multiply(restInverse).multiply(baseTurn.invert())
          joint.turn.premultiply(partial.slerpQuaternions(identity, follow, weight))
        }
        joint.head.setFromMatrixPosition(bone.matrixWorld)
        joint.restDir.copy(joint.axis).applyQuaternion(joint.turn)
        // Verlet: keep the motion of the last step, damped; spring back toward the rest direction; gravity.
        next.subVectors(joint.tail, joint.prev).multiplyScalar(1 - joint.drag).add(joint.tail)
          .addScaledVector(joint.restDir, joint.stiffness * STEP).addScaledVector(down, joint.gravity * STEP)
        joint.prev.copy(joint.tail)
        joint.tail.copy(next)
        settle(joint)
      }
      if (group.ring) {
        const gaps = group.gaps[k]
        for (let pass = 0; pass < 2; pass++) {
          level.forEach((joint, i) => {
            const other = level[(i + 1) % level.length]
            scratch.subVectors(other.tail, joint.tail)
            const distance = scratch.length()
            const limit = gaps[i] * RING_SLACK
            if (distance <= limit) return
            scratch.multiplyScalar((distance - limit) / distance / 2)
            joint.tail.add(scratch)
            other.tail.sub(scratch)
          })
          for (const joint of level) settle(joint)
        }
      }
      for (const joint of level) {
        // Turn the bone so its rest direction points at the new tail.
        swing.setFromUnitVectors(joint.restDir, scratch.subVectors(joint.tail, joint.head).normalize())
        joint.bone.quaternion.copy(joint.parentTurn).invert().multiply(swing).multiply(joint.turn)
        joint.bone.updateMatrixWorld(true)
      }
    })
  }

  // Advance by dt seconds. The body (and every collider bone) must already be posed and its matrices updated.
  function update(dt) {
    pending = Math.min(pending + dt, 4 * STEP)
    if (pending < STEP) {
      // No full step due: keep the last result on top of the newly posed parents.
      for (const group of built) for (const level of group.levels) for (const joint of level) joint.bone.updateMatrixWorld(true)
      return
    }
    while (pending >= STEP) {
      pending -= STEP
      step()
    }
  }

  return { reset, update }
}
