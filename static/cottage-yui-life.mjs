// Yui's day in the house: follows the schedule in cottage-routine.mjs, walks between places, sits down and gets up,
// gets into and out of bed (woken by the visitor, crossly: she grumbles, tosses about, then sits up), goes out of sight
// for a moment on the stairs, and stops for the visitor.
// Presentation only: nothing here is saved or sent anywhere.
import { BED, NODES, SPOTS, activityAt, plan, roomOf, standBy } from "./cottage-routine.mjs?v=0.9.53"
import { walkStep } from "./cottage-walk.mjs?v=0.9.54"

const TURN_RATE = 7
// The steps that start by walking: a walk that goes on into one of them rounds the corner instead of stopping.
const WALKING = new Set(["walk", "arrive", "stairs", "sit", "bed"])
const SIT_SECONDS = 1.3
const FADE_SECONDS = .45
// How far she walks on into the stairs while she goes out of sight.
const STAIRS_STEP = .3
// The one-shot clips play when she reaches a place soon after the activity there began (not when you arrive late).
const FRESH_MINUTES = 10
// Where her eyes go while busy, in her own frame (x her left, y up, z ahead), from her root.
const LOOK = { walk: [0, 1.25, 2.2], sit: [0, .95, 1.8], type: [0, .85, .5], tablet: [-.02, .92, .42] }

// In and out of bed, from the clips (cottage-yui.mjs perform): turning over in her sleep, and the getting-up clip,
// which starts lying on her back, sits up by SAT_UP and has swung round to the edge by OFF_BED. From there (0.9.52)
// she sits on the side of the bed (BED.side) like on a seat and stands up as from one (the clip gets up off the
// floor, not off a bed, and moving her down onto her feet slid them); getting in, the other way round.
const ONTO_BACK = { clip: "sleep-turn", from: 6, to: 8 }
const ONTO_SIDE = { clip: "sleep-turn", from: 8, to: 9.5 }
const BACK_AGAIN = { clip: "sleep-turn", from: 11.5, to: 13 }
const SAT_UP = 1
const OFF_BED = 2.2
// How long the getting-up clip takes to hand over to sitting on the side of the bed, and back.
const SIDE_SECONDS = .5
// When in the getting-up clip she throws the duvet back (cottage-duvet.mjs): as she sits up, before she swings
// round; getting in, she pulls it back over her as she lies down.
const THROW = [.45, 1.25]
// Woken by the visitor: how long she grumbles with her eyes shut before she tosses about, and how long she stays
// cross once up.
const GRUMBLE_SECONDS = 1.1
const CROSS_SECONDS = 4
const WAKE_CROSS = [{ ...ONTO_BACK, speed: 1.6, fade: .5 }, { ...ONTO_SIDE, speed: 1.4, fade: .35 },
  { ...BACK_AGAIN, speed: 1.4, fade: .35 }, { clip: "getup", to: OFF_BED, speed: 1.15, fade: .6 }]
const WAKE = [{ ...ONTO_BACK, speed: 1.2, fade: .6 }, { clip: "getup", to: OFF_BED, fade: .6 }]
// Woken by the visitor (0.9.49) she only sits up in bed and stays there while they are with her: the getting-up
// clip held at PROPPED, leaning back on her hands with her face up (by SAT_UP her head is down over her knees).
// When they leave she lies back down, or, if it is time to be up, gets up from there.
const PROPPED = .7
const LIE_BACK = [{ clip: "getup", from: PROPPED, to: 0, speed: 1.1, fade: .4 }, { ...ONTO_BACK, from: 8, to: 6, fade: .5 }]
// Clicked while seated, she stays seated when the visitor is in front of her (within this angle of the way she
// faces), turning toward them by at most SEAT_TURN; standing busy, she starts and only then turns (after TURN_DELAY).
const STAY_ANGLE = 1.9
const SEAT_TURN = .6
const TURN_DELAY = .9
const INTO_BED = [{ clip: "getup", from: OFF_BED, to: 0, speed: 1.1, fade: SIDE_SECONDS }, { ...ONTO_BACK, from: 8, to: 6, fade: .5 }]

const damp = (value, target, rate, dt) => value + (target - value) * (1 - Math.exp(-rate * dt))
const smooth = t => t * t * (3 - 2 * t)
// The turn from `from` to `to`, the short way round.
const turnBy = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from))

export function createLife(yui, Vector3) {
  const root = yui.root
  const position = new Vector3().copy(root.position)
  let yaw = root.rotation.y
  let lift = 0
  const between = new Vector3()
  let place = null
  let activity = null
  let steps = []
  let step = null
  // The visitor clicked her: she stops what she is doing and turns to them until `resume`.
  let attending = false
  let facing = yaw
  let resumeAt = 0
  let fresh = false
  // Out of bed crossly: 1 while it lasts, then easing off once she is up (seconds left).
  let crossLeft = 0
  // Startled by the visitor: seconds before she turns to them.
  let turnDelay = 0
  const look = new Vector3()
  // Kept where she is for the visitor (place.stay: seated; place.up: sat up in bed).
  const inPlace = () => Boolean(place && (place.stay || place.up))

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
    if (place?.up) {
      // Sat up in bed for the visitor: lie back down, or get up from there.
      place = { spot: "bed" }
      steps = activity.spot === "bed" ? [{ kind: "bed", to: SPOTS.bed, spot: "bed", lieBack: true }] : plan(place, activity.spot)
      if (steps[0]?.kind === "leave-bed") steps[0].fromSatUp = true
      return
    }
    if (place?.stay) {
      // Stayed seated for the visitor: carry on there, or get up and go.
      place = { spot: place.spot }
      if (place.spot === activity.spot) { steps = []; return }
    }
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

  // The point in front of (or beside) a seat where she stands to sit down and gets up to (cottage-routine.mjs).
  function approachOf(spot) {
    const { x, y, z } = standBy(spot)
    return new Vector3(x, y, z)
  }

  function begin(next) {
    step = { ...next, time: 0, from: position.clone(), fromYaw: yaw, phase: 0 }
    const spot = next.spot && SPOTS[next.spot]
    if (next.kind === "walk" || next.kind === "arrive" || next.kind === "stairs") yui.setPose("walk", .35)
    else if (next.kind === "rise") {
      // Getting up (0.9.51): leaning forward she stands up to the point in front of the seat, then walks on.
      const seat = SPOTS[next.seatOf]
      Object.assign(step, { phase: "up", upTo: seat ? approachOf(seat) : position.clone() })
      yui.setPose("stand", SIT_SECONDS * .8)
    } else if (next.kind === "sit") {
      // Sitting down (0.9.51): to the point in front of the seat, round with her back to it, then down onto it
      // with her feet where they stand.
      step.at = approachOf(spot)
      const near = Math.hypot(step.at.x - position.x, step.at.z - position.z) < .05
      step.phase = near ? "turn" : "approach"
      yui.setPose(near ? "stand" : "walk", .35)
    } else if (next.kind === "bed") yui.setPose("walk", .35)
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

  // Walks toward a point (0.9.53, cottage-walk.mjs): steering as she goes, speeding up and slowing down; true on
  // arrival. `through`: the way goes on past it, so she rounds the corner without stopping (true once round it).
  const walking = { x: 0, z: 0, yaw: 0, pace: 0, off: 0 }
  let walked = false
  function walkTo(point, dt, through = false) {
    Object.assign(walking, { x: position.x, z: position.z, yaw })
    const done = walkStep(walking, point, dt, through)
    walked = true
    position.x = walking.x
    position.z = walking.z
    yaw = walking.yaw
    // Up or down (a step between rooms) by how much of the way is behind her.
    const total = Math.hypot(point.x - step.from.x, point.z - step.from.z) || 1
    const left = Math.hypot(point.x - position.x, point.z - position.z)
    position.y = done && !through ? point.y : step.from.y + (point.y - step.from.y) * Math.min(1, Math.max(0, 1 - left / total))
    return done
  }
  // Whether the way goes on walking after the step she is on.
  const goesOn = () => WALKING.has(steps[0]?.kind)

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
      if (walkTo(to, dt, goesOn())) {
        // A walk that continues does not stop to change pose.
        const next = steps[0]
        finish()
        if (next && !WALKING.has(next.kind)) yui.setPose("stand", .4)
      }
    } else if (kind === "arrive") {
      if (step.phase === 0 && walkTo(to, dt)) {
        step.phase = 1
        yui.setPose("stand", .4)
      }
      if (step.phase === 1 && turnTo(to.turn, dt)) finish()
    } else if (kind === "sit") {
      if (step.phase === "approach" && walkTo(step.at, dt)) {
        step.phase = "turn"
        yui.setPose("stand", .4)
      }
      if (step.phase === "turn" && turnTo(to.turn, dt)) {
        Object.assign(step, { phase: "down", down: 0, downFrom: position.clone() })
        yaw = to.turn
        yui.setPose(SPOTS[step.spot].pose, SIT_SECONDS * .9)
      }
      if (step.phase === "down") {
        step.down += dt
        const t = smooth(Math.min(1, step.down / SIT_SECONDS))
        position.lerpVectors(step.downFrom, to, t)
        if (t === 1) finish()
      }
    } else if (kind === "rise") {
      if (step.phase === "up") {
        const t = smooth(Math.min(1, step.time / SIT_SECONDS))
        position.lerpVectors(step.from, step.upTo, t)
        if (t === 1) {
          if (attending) {
            // For the visitor she stays where she stood up; afterwards she first walks on to the node.
            place = { node: step.node, on: true }
            step = null
            return true
          }
          step.phase = "away"
          step.from = position.clone()
          yui.setPose("walk", .35)
        }
      } else if (walkTo(to, dt, goesOn())) {
        const next = steps[0]
        finish()
        if (!WALKING.has(next?.kind)) yui.setPose("stand", .4)
      }
    } else if (kind === "leave-bed" && !step.fading) {
      leaveBed(dt)
    } else if (kind === "bed" && !step.fading) {
      intoBed(dt)
    } else {
      // Stairs (and the bed when its clips are missing): out of sight, across, back in sight.
      if (step.phase === 0) {
        const t = Math.min(1, step.time / FADE_SECONDS)
        yui.setFade(1 - t)
        if (kind === "stairs") {
          position.x = step.from.x + Math.sin(yaw) * STAIRS_STEP * t
          position.z = step.from.z + Math.cos(yaw) * STAIRS_STEP * t
          yaw += damp(0, turnBy(yaw, Math.PI), TURN_RATE, dt)
          // Still walking on as she goes out of sight.
          walked = true
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

  // Where she is on the bed while a getting-up clip plays at `time` (the same path backwards getting in), up to the
  // edge.
  function onBed(time, into = false) {
    if (time < SAT_UP) {
      // Getting up she moves over from where she slept; getting in she stays there to turn over.
      if (into) position.copy(BED.back)
      else position.lerpVectors(SPOTS.bed, BED.back, smooth(Math.min(1, time / .6)))
      yaw = SPOTS.bed.turn
    } else {
      const t = smooth(Math.min(1, (time - SAT_UP) / (OFF_BED - SAT_UP)))
      position.lerpVectors(BED.back, BED.edge, t)
      yaw = SPOTS.bed.turn + Math.PI / 2 * t
    }
  }

  // Out of bed: grumbling first when the visitor woke her, turning over, sitting up, standing beside the bed; then
  // (unless the visitor is waiting for her there) on to the bedside.
  function leaveBed(dt) {
    if (step.phase === 0 && step.fromSatUp) {
      // Already sitting up (she stayed in bed for the visitor): the rest of the getting-up clip.
      if (!yui.perform([{ clip: "getup", from: PROPPED, to: OFF_BED, fade: .3 }])) Object.assign(step, { fading: true, phase: 0, time: 0 })
      else {
        yui.setPose("sit")
        step.phase = "acting"
      }
      return
    }
    if (step.phase === 0) {
      step.phase = step.cross ? "grumble" : "start"
      if (step.cross) crossLeft = CROSS_SECONDS
    }
    if (step.phase === "grumble") {
      if (step.time < GRUMBLE_SECONDS) return
      step.phase = "start"
    }
    if (step.phase === "start") {
      const parts = step.cross ? WAKE_CROSS : WAKE
      // For the visitor she only sits up, and stays so.
      if (!yui.perform(step.stayUp ? [...parts.slice(0, -1), { ...parts.at(-1), to: PROPPED, hold: true }] : parts)) {
        // Without the clips: out of sight and back, as before.
        Object.assign(step, { fading: true, phase: 0, time: 0 })
        return
      }
      // When the clip has her on the edge, the sitting clip follows (perform).
      yui.setPose("sit")
      step.phase = "acting"
    }
    if (step.phase === "acting") {
      const acting = yui.acting
      if (acting?.held) {
        onBed(PROPPED)
        step = null
        place = { spot: "bed", up: true }
        return
      }
      if (acting?.part.clip === "getup") onBed(acting.time)
      else if (!acting) Object.assign(step, { phase: "side", time: 0, from: position.clone() })
      if (step.cross) crossLeft = CROSS_SECONDS
      if (step.phase === "acting") return
    }
    if (step.phase === "side") {
      // Down off the mattress onto the side of the bed, her feet on the floor, as the sitting clip fades in.
      position.lerpVectors(step.from, BED.side, smooth(Math.min(1, step.time / SIDE_SECONDS)))
      yaw = BED.side.turn
      if (step.cross) crossLeft = CROSS_SECONDS
      if (step.time < SIDE_SECONDS) return
      Object.assign(step, { phase: "up", time: 0, from: position.clone() })
      yui.setPose("stand", SIT_SECONDS * .8)
    }
    if (step.phase === "up") {
      // Standing up as from a seat: leaning forward, feet where they are (footing, bend).
      const t = smooth(Math.min(1, step.time / SIT_SECONDS))
      position.lerpVectors(step.from, BED.stand, t)
      if (step.cross) crossLeft = CROSS_SECONDS
      if (t < 1) return
      if (attending) {
        // She stays where she stood up; afterwards she first walks on to the bedside.
        step = null
        place = { node: "bedside", on: true }
        return
      }
      Object.assign(step, { phase: "walk", from: position.clone() })
      yui.setPose("walk", .35)
      return
    }
    if (walkTo(step.to, dt, goesOn())) {
      const next = steps[0]
      finish()
      if (!WALKING.has(next?.kind)) yui.setPose("stand", .4)
    }
  }

  // Into bed: to the floor beside it, round with her back to it, sitting on the edge, lying back, turning over.
  function intoBed(dt) {
    if (step.phase === 0 && step.lieBack) {
      // Sitting up in bed already: lying back and turning over.
      if (!yui.perform(LIE_BACK)) {
        Object.assign(step, { fading: true, phase: 0, time: 0 })
        return
      }
      yui.setPose("sleep")
      step.phase = "acting"
    }
    if (step.phase === 0) {
      if (step.from.distanceTo(BED.stand) > .02 && !walkTo(BED.stand, dt)) return
      step.phase = "turn"
      yui.setPose("stand", .4)
    }
    if (step.phase === "turn") {
      // Round with her back to the bed, then down onto its side as onto a seat (footing, bend).
      if (!turnTo(BED.side.turn, dt)) return
      Object.assign(step, { phase: "down", down: 0, downFrom: position.clone() })
      yaw = BED.side.turn
      yui.setPose("sit", SIT_SECONDS * .9)
    }
    if (step.phase === "down") {
      step.down += dt
      const t = smooth(Math.min(1, step.down / SIT_SECONDS))
      position.lerpVectors(step.downFrom, BED.side, t)
      if (t < 1) return
      if (!yui.perform(INTO_BED)) {
        Object.assign(step, { fading: true, phase: 0, time: 0 })
        return
      }
      yui.setPose("sleep")
      Object.assign(step, { phase: "acting", onto: 0 })
    }
    const acting = yui.acting
    if (acting?.part.clip === "getup") {
      onBed(acting.time, true)
      // From the side of the bed up onto the mattress as the getting-up clip (backwards) fades in.
      step.onto = Math.min(1, step.onto + dt / SIDE_SECONDS)
      if (step.onto < 1) position.copy(between.lerpVectors(BED.side, position, smooth(step.onto)))
    } else if (acting) {
      // Turning over onto her front, from where she lay back to where she sleeps.
      const t = smooth(Math.min(1, (8 - acting.time) / 2))
      position.lerpVectors(BED.back, SPOTS.bed, t)
      yaw = SPOTS.bed.turn
    } else {
      position.set(SPOTS.bed.x, SPOTS.bed.y, SPOTS.bed.z)
      yaw = SPOTS.bed.turn
      finish()
    }
  }

  // The visitor clicked her. Whatever she was in the middle of stops. Seated with the visitor in front of her she
  // stays seated and turns toward them; asleep she sits up in bed; seated facing away, she gets up first.
  // Returns how she takes it, for her reaction (cottage-yui.mjs react): "seat", "bed", "startle" (busy on her
  // feet), "rise", or "" (free, standing).
  function interrupt(viewer) {
    if (!place) return ""
    const wasAttending = attending
    attending = true
    resumeAt = 0
    facing = Math.atan2(viewer.x - position.x, viewer.z - position.z)
    let kind = ""
    if (step && (step.kind === "walk" || step.kind === "arrive" || step.kind === "sit" && step.phase === "approach")) {
      place = { node: step.node || SPOTS[step.spot].node, on: true }
      step = null
      yui.setPose("stand", .4)
      kind = "startle"
    }
    steps = []
    const spot = !step && place.spot && SPOTS[place.spot]
    if (place.up) {
      facing = SPOTS.bed.turn + Math.max(-SEAT_TURN, Math.min(SEAT_TURN, turnBy(SPOTS.bed.turn, facing)))
      return "bed"
    }
    if (spot?.enter === "sit" && (place.stay || Math.abs(turnBy(spot.turn, facing)) < STAY_ANGLE)) {
      place = { spot: place.spot, stay: true }
      facing = spot.turn + Math.max(-SEAT_TURN, Math.min(SEAT_TURN, turnBy(spot.turn, facing)))
      return "seat"
    }
    if (spot?.enter === "bed") kind = "bed"
    else if (spot?.enter === "sit") kind = "rise"
    else if (!kind && !wasAttending && (yui.pose === "tablet" || yui.playing)) kind = "startle"
    turnDelay = kind === "startle" ? TURN_DELAY : 0
    if (!step) getUp()
    return kind
  }

  // Seated (facing away from the visitor) she gets up to face them; in bed she sits up; standing, she leaves what
  // she has in hand.
  function getUp() {
    if (inPlace()) return
    const spot = place.spot && SPOTS[place.spot]
    if (spot?.enter === "sit") begin({ kind: "rise", to: NODES[spot.node], node: spot.node, seatOf: place.spot })
    else if (spot?.enter === "bed") {
      begin({ kind: "leave-bed", to: NODES[spot.node], node: spot.node })
      // Woken in the night (not getting up anyway): cross about it. While the visitor is there she stays in bed.
      step.cross = activity?.spot === "bed"
      step.stayUp = attending
    }
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
    if (crossLeft > 0 && !(step?.kind === "leave-bed" && step.cross)) crossLeft = Math.max(0, crossLeft - dt)
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
        if (place.spot && SPOTS[place.spot].enter !== "walk" && !place.stay) {
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
    walked = false
    const active = advance(dt) || attending
    // Not walking this frame (stopped, turning on the spot, seated): no pace for the walking clip to keep up with.
    if (!walked) walking.pace = walking.off = 0
    if (attending && !step && !place.up) {
      // Seated she turns in her seat (the clip's hips carry the rest), standing she turns round to face them.
      if (turnDelay > 0) turnDelay = Math.max(0, turnDelay - dt)
      else turnTo(place.stay ? SPOTS[place.spot].turn : facing, dt)
    }
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
    // Asleep, or still with her eyes shut, grumbling and tossing about after being woken.
    get asleep() {
      if (step?.kind === "leave-bed" && !step.fading) {
        return Boolean(step.cross) && (step.phase === "grumble" || step.phase === "start" || yui.acting?.part.clip === "sleep-turn")
      }
      if (step?.kind === "bed" && !step.fading) return step.phase === "acting" && yui.acting?.part.clip !== "getup"
      return !attending && yui.pose === "sleep"
    },
    // How cross she is at being woken (0..1).
    get grumpy() { return Math.min(1, crossLeft / 1.5) },
    // The mattress under her while she lies or sits on the bed (her limbs rest on it), else null.
    // (Not once she is off the edge, where she drops onto her feet.)
    get support() {
      const acting = yui.acting
      const inBed = acting ? !(acting.part.clip === "getup" && acting.time > OFF_BED) : yui.pose === "sleep" && place?.spot === "bed" ||
        step?.kind === "leave-bed" && ["grumble", "start"].includes(step.phase)
      return inBed && position.y > BED.surface - .1 ? BED.surface + lift : null
    },
    // The seat under her hips ({ height, weight }), or null: seated, her hips rest on its top; sitting down and
    // getting up it takes over and lets go gradually (weight 0..1).
    get seat() {
      let spot = null
      let weight = 1
      if (step?.kind === "sit") {
        spot = SPOTS[step.spot]
        weight = step.phase === "down" ? smooth(Math.min(1, step.down / SIT_SECONDS)) : 0
      } else if (step?.kind === "rise") {
        spot = SPOTS[step.seatOf]
        weight = step.phase === "up" ? 1 - smooth(Math.min(1, step.time / (SIT_SECONDS * .7))) : 0
      } else if (step?.kind === "leave-bed" && (step.phase === "side" || step.phase === "up")) {
        // On the side of the bed (0.9.52).
        spot = BED.side
        weight = step.phase === "side" ? smooth(Math.min(1, step.time / SIDE_SECONDS))
          : 1 - smooth(Math.min(1, step.time / (SIT_SECONDS * .7)))
      } else if (step?.kind === "bed" && (step.phase === "down" || step.phase === "acting" && step.onto < 1)) {
        spot = BED.side
        weight = step.phase === "down" ? smooth(Math.min(1, step.down / SIT_SECONDS)) : 1 - smooth(step.onto)
      } else if (!step && place?.spot && (yui.pose === "sit" || yui.pose === "type")) spot = SPOTS[place.spot]
      if (!spot || spot.seat === undefined || weight <= 0) return null
      const y = spot.y + (spot.y > 2 ? lift : 0)
      const [front, back, top] = spot.chair || [0, 0, 0]
      return { height: y + spot.seat, weight, x: spot.x, y, z: spot.z, turn: spot.turn, front, back, top }
    },
    // How far she is under the duvet (0..1).
    get cover() {
      const acting = yui.acting
      if (acting?.part.clip === "getup") return 1 - smooth(Math.min(1, Math.max(0, (acting.time - SAT_UP) / (OFF_BED - SAT_UP))))
      if (acting) return 1
      if (step?.kind === "leave-bed" && ["grumble", "start"].includes(step.phase)) return 1
      return yui.pose === "sleep" && place?.spot === "bed" && !step ? 1 : 0
    },
    // How far the duvet is thrown back (0..1, cottage-duvet.mjs, 0.9.52): she pushes it over as she sits up to get
    // out, and it stays so while the bed is empty; getting in, she pulls it back over her as she lies
    // down.
    get duvetOpen() {
      const acting = yui.acting
      if (acting?.part.clip === "getup" && (step?.kind === "leave-bed" || step?.kind === "bed")) {
        return smooth(Math.min(1, Math.max(0, (acting.time - THROW[0]) / (THROW[1] - THROW[0]))))
      }
      if (step?.kind === "leave-bed") return step.fading ? Number(step.phase === 1) : Number(["side", "up", "walk"].includes(step.phase))
      if (step?.kind === "bed") {
        if (step.fading) return Number(step.phase === 0)
        return step.lieBack || step.phase === "acting" ? 0 : 1
      }
      return place?.spot === "bed" ? 0 : 1
    },
    // How fast she is walking (m/s): the walking clip keeps up with it (cottage-yui.mjs, cottage-walk.mjs stride).
    get pace() { return walking.pace },
    // How far round she still has to turn toward where she is walking (radians, + to her left).
    get turning() { return walking.off },
    get attending() { return attending },
    // Feet on the floor (cottage-yui.mjs plantFeet): turning on the spot, sitting down, getting up.
    get footing() {
      if (step?.kind === "sit") return step.phase === "turn" || step.phase === "down"
      if (step?.kind === "rise" || step?.kind === "leave-bed") return step.phase === "up"
      if (step?.kind === "bed") return step.phase === "turn" || step.phase === "down"
      if (step?.kind === "arrive") return step.phase === 1
      if (!step && attending && !place?.stay && !place?.up && yui.pose === "stand") {
        return turnDelay <= 0 && Math.abs(turnBy(yaw, facing)) > .03
      }
      return false
    },
    // How far she leans forward from the hips (0..1): most halfway down into a seat, and early on getting up.
    get bend() {
      const down = (step?.kind === "sit" || step?.kind === "bed") && step.phase === "down"
      if (down) return Math.sin(Math.PI * Math.min(1, step.down / SIT_SECONDS)) * .9
      if ((step?.kind === "rise" || step?.kind === "leave-bed") && step.phase === "up") return Math.sin(Math.PI * Math.min(1, step.time / SIT_SECONDS) ** .7)
      return 0
    },
    // The way she faces the visitor once stopped (the closeup looks at her from there).
    get facing() { return facing },
    get room() { return roomOf(position) },
    get upstairs() { return position.y > 2 },
    get activity() { return activity?.id || "" },
    // The spot she is settled at ("" while walking): the lofi medium shot frames each spot its own way.
    get spot() { return !step && place?.spot || "" },
    // Out of sight for a moment, or still getting up: not to be clicked or framed yet.
    get settled() { return !step },
  }
}
