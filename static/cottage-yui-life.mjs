// Yui's day in the house: follows the schedule in cottage-routine.mjs, walks between places, sits down and gets up,
// goes out of sight for a moment on the stairs and getting into or out of bed, and stops for the visitor.
// Presentation only: nothing here is saved or sent anywhere.
import { NODES, SPOTS, activityAt, plan, roomOf } from "./cottage-routine.mjs?v=0.9.40"

const WALK_SPEED = .6
const TURN_RATE = 7
const SIT_SECONDS = 1.15
const FADE_SECONDS = .45
// How far she walks on into the stairs while she goes out of sight.
const STAIRS_STEP = .3
// The one-shot clips play when she reaches a place soon after the activity there began (not when you arrive late).
const FRESH_MINUTES = 10
// Where her eyes go while busy, in her own frame (x her left, y up, z ahead), from her root.
const LOOK = { walk: [0, 1.25, 2.2], sit: [0, .95, 1.8], type: [0, .85, .5], tablet: [-.02, .92, .42] }

const damp = (value, target, rate, dt) => value + (target - value) * (1 - Math.exp(-rate * dt))
const smooth = t => t * t * (3 - 2 * t)
// The turn from `from` to `to`, the short way round.
const turnBy = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from))

export function createLife(yui, Vector3) {
  const root = yui.root
  const position = new Vector3().copy(root.position)
  let yaw = root.rotation.y
  let lift = 0
  let place = null
  let activity = null
  let steps = []
  let step = null
  // The visitor clicked her: she stops what she is doing and turns to them until `resume`.
  let attending = false
  let facing = yaw
  let resumeAt = 0
  let fresh = false
  const look = new Vector3()

  const show = () => {
    root.position.set(position.x, position.y + (position.y > 2 ? lift : 0), position.z)
    root.rotation.y = yaw
  }

  // Straight into the activity, without walking there (the first frame, and whenever motion is off).
  function jump(spot) {
    const target = SPOTS[spot]
    position.set(target.x, target.y, target.z)
    yaw = target.turn
    place = { spot }
    steps = []
    step = null
    yui.setPose(target.pose, .01)
    yui.setFade(1)
    show()
    yui.settle()
  }

  function replan() {
    if (!activity || attending) return
    try {
      // In the middle of a step, the new way starts where that step ends.
      const from = step ? step.spot ? { spot: step.spot } : { node: step.node } : place
      steps = plan(from, activity.spot)
      // Stopped on the way somewhere: she first finishes walking to that point.
      if (!step && place.on) steps.unshift({ kind: "walk", to: NODES[place.node], node: place.node })
      // Already there (she turned round for the visitor, or put the tablet down): turn back and carry on.
      if (!step && !steps.length && place.spot === activity.spot) {
        steps = [{ kind: "arrive", to: SPOTS[place.spot], spot: place.spot }]
      }
    } catch (error) {
      console.warn("cottage: Yui cannot walk there", error)
      jump(activity.spot)
    }
  }

  function begin(next) {
    step = { ...next, time: 0, from: position.clone(), fromYaw: yaw, phase: 0 }
    const spot = next.spot && SPOTS[next.spot]
    if (next.kind === "walk" || next.kind === "arrive" || next.kind === "stairs") yui.setPose("walk", .35)
    else if (next.kind === "rise") yui.setPose("stand", .9)
    else if (next.kind === "sit") yui.setPose(spot.pose, SIT_SECONDS * .9)
  }

  function finish() {
    const done = step
    step = null
    place = done.spot ? { spot: done.spot } : { node: done.node }
    if (done.spot) {
      yui.setPose(SPOTS[done.spot].pose, .6)
      if (fresh && activity?.then && done.spot === activity.spot) yui.playOnce(activity.then)
      fresh = false
    }
  }

  // Walks toward a point, turning as she goes; true on arrival.
  function walkTo(point, dt) {
    const dx = point.x - position.x
    const dz = point.z - position.z
    const left = Math.hypot(dx, dz)
    if (left < .015) {
      position.set(point.x, point.y, point.z)
      return true
    }
    const heading = Math.atan2(dx, dz)
    yaw += damp(0, turnBy(yaw, heading), TURN_RATE, dt)
    // Slower while still turning, so she does not walk sideways.
    const speed = WALK_SPEED * Math.max(.15, Math.cos(turnBy(yaw, heading))) ** 2
    const move = Math.min(left, speed * dt)
    const total = Math.hypot(point.x - step.from.x, point.z - step.from.z) || 1
    position.x += dx / left * move
    position.z += dz / left * move
    position.y = step.from.y + (point.y - step.from.y) * Math.min(1, 1 - (left - move) / total)
    return false
  }

  // Turns in place toward `wanted`; true once she faces it.
  function turnTo(wanted, dt) {
    yaw += damp(0, turnBy(yaw, wanted), 5, dt)
    return Math.abs(turnBy(yaw, wanted)) < .04
  }

  function advance(dt) {
    if (!step) {
      if (!steps.length) return false
      begin(steps.shift())
    }
    step.time += dt
    const { kind, to } = step
    if (kind === "walk") {
      if (walkTo(to, dt)) {
        // A walk that continues does not stop to change pose.
        const next = steps[0]
        finish()
        if (next && next.kind !== "walk" && next.kind !== "arrive" && next.kind !== "stairs") yui.setPose("stand", .4)
      }
    } else if (kind === "arrive") {
      if (step.phase === 0 && walkTo(to, dt)) {
        step.phase = 1
        yui.setPose("stand", .4)
      }
      if (step.phase === 1 && turnTo(to.turn, dt)) finish()
    } else if (kind === "rise" || kind === "sit") {
      // Sliding into or out of the seat while the pose changes.
      const t = smooth(Math.min(1, step.time / SIT_SECONDS))
      position.lerpVectors(step.from, to, t)
      if (kind === "sit") yaw = step.fromYaw + turnBy(step.fromYaw, to.turn) * Math.min(1, t * 1.6)
      if (t === 1) finish()
    } else {
      // Stairs, bed: out of sight, across, back in sight.
      if (step.phase === 0) {
        const t = Math.min(1, step.time / FADE_SECONDS)
        yui.setFade(1 - t)
        if (kind === "stairs") {
          position.x = step.from.x + Math.sin(yaw) * STAIRS_STEP * t
          position.z = step.from.z + Math.cos(yaw) * STAIRS_STEP * t
          yaw += damp(0, turnBy(yaw, Math.PI), TURN_RATE, dt)
        }
        if (t === 1) {
          step.phase = 1
          step.time = 0
          position.set(to.x, to.y, to.z)
          const spot = step.spot && SPOTS[step.spot]
          if (kind === "bed") {
            yaw = spot.turn
            yui.setPose("sleep", .01)
          } else if (kind === "leave-bed") {
            yaw = SPOTS.bedside.turn
            yui.setPose("stand", .01)
          } else {
            // Up the stairs she comes out facing into the study; down them, into the kitchen.
            yaw = to.y > 2 ? -Math.PI / 2 : 0
          }
          show()
          yui.settle()
        }
      } else {
        const t = Math.min(1, step.time / FADE_SECONDS)
        yui.setFade(t)
        if (t === 1) finish()
      }
    }
    return true
  }

  // The visitor clicked her. Whatever she was in the middle of stops; seated or asleep she gets up first.
  function interrupt(viewer) {
    if (!place) return
    attending = true
    facing = Math.atan2(viewer.x - position.x, viewer.z - position.z)
    if (step && (step.kind === "walk" || step.kind === "arrive")) {
      place = { node: step.node || SPOTS[step.spot].node, on: true }
      step = null
      yui.setPose("stand", .4)
    }
    steps = []
    if (!step) getUp()
  }

  // Seated or in bed, she gets up to face the visitor; standing, she leaves what she has in hand.
  function getUp() {
    const spot = place.spot && SPOTS[place.spot]
    if (spot?.enter === "sit") begin({ kind: "rise", to: NODES[spot.node], node: spot.node })
    else if (spot?.enter === "bed") begin({ kind: "leave-bed", to: NODES[spot.node], node: spot.node })
    else if (yui.pose !== "stand") yui.setPose("stand", .5)
  }

  // The visitor left her: after a moment she goes back to what the time of day has her doing.
  function resume(now = performance.now()) {
    if (!attending) return
    attending = false
    resumeAt = now + 1600
  }

  // minutes: the cottage clock; moving: whether motion is allowed (otherwise she is simply where she should be);
  // upperLift: how far the upper storey is lifted away, which carries her with it when she is upstairs.
  function update(dt, { minutes, moving, upperLift = 0, now = performance.now() }) {
    lift = upperLift
    const wanted = activityAt(minutes)
    let changed = false
    if (!activity) {
      activity = wanted
      fresh = minutes - wanted.since < FRESH_MINUTES
      jump(wanted.spot)
      if (fresh && wanted.then) yui.playOnce(wanted.then)
      changed = true
    } else if (wanted.id !== activity.id || wanted.since !== activity.since) {
      const spotChanged = wanted.spot !== activity.spot
      activity = wanted
      fresh = true
      if (spotChanged && !attending) replan()
      else if (wanted.then && !attending && !steps.length && !step) yui.playOnce(wanted.then)
      changed = true
    }
    if (!moving) {
      // Without motion she does not walk: she is already where the time has her.
      if (attending) {
        if (step) { step = null; place = { node: SPOTS[activity.spot].node } }
        if (place.spot && SPOTS[place.spot].enter !== "walk") {
          const node = SPOTS[place.spot].node
          position.copy(NODES[node])
          place = { node }
          yui.setPose("stand", .01)
          yui.setFade(1)
          changed = true
        }
        if (yaw !== facing) { yaw = facing; changed = true }
      } else if (step || steps.length || place.spot !== activity.spot) {
        jump(activity.spot)
        changed = true
      }
      const was = root.position.y
      show()
      return { changed: changed || root.position.y !== was }
    }
    if (!attending && resumeAt && now >= resumeAt) {
      resumeAt = 0
      replan()
    }
    // A step already under way when she was stopped (sitting down, the stairs) ends first; then she gets up.
    if (attending && !step) getUp()
    const active = advance(dt) || attending
    if (attending && !step) turnTo(facing, dt)
    show()
    return { changed: true, active }
  }

  // While busy, where her eyes go (null when she is free to watch the visitor).
  function task() {
    if (attending || !place) return null
    const pose = yui.pose
    const offset = LOOK[pose]
    if (!offset || yui.playing) return null
    const sin = Math.sin(yaw)
    const cos = Math.cos(yaw)
    return look.set(root.position.x + offset[0] * cos + offset[2] * sin, root.position.y + offset[1],
      root.position.z - offset[0] * sin + offset[2] * cos)
  }

  return {
    update, interrupt, resume, task,
    get asleep() { return !attending && yui.pose === "sleep" },
    get attending() { return attending },
    // The way she faces the visitor once stopped (the closeup looks at her from there).
    get facing() { return facing },
    get room() { return roomOf(position) },
    get upstairs() { return position.y > 2 },
    get activity() { return activity?.id || "" },
    // Out of sight for a moment, or still getting up: not to be clicked or framed yet.
    get settled() { return !step },
  }
}
