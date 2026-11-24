// Up and down the stairs (0.9.55): where Yui is and where each of her feet is on the treads as she climbs. Pure
// functions; cottage-yui-life.mjs moves her with them and cottage-yui.mjs puts her feet there.
//
// Until 0.9.54 she walked into the foot of the stairs, went out of sight and came back in sight at the top. Now she
// climbs them: one tread a step, a foot on every other tread (each foot goes up two at a time, past the other),
// her body rising with the treads under it.
//
// Progress up the stairs is counted in steps (`u`): tread k is the k-th from the bottom (0..13), the floor in front
// of them counts as -1, -2, ... and the last tread is level with the upper floor.
import { STAIRS, STOREYS } from "./cottage-layout.mjs?v=0.9.26"

const COUNT = 14
// The upper floor's surface: cottage-house.mjs draws the upper storey UPPER_LIFT (.12) above its storey line.
export const STAIRS_TOP = STOREYS[1].y + .12
const RUN = (STAIRS.z[1] - STAIRS.z[0]) / COUNT
const RISE = STAIRS_TOP / COUNT
// The boards on top of each tread (cottage-house.mjs).
const BOARD = .03
const MIDDLE = (STAIRS.x[0] + STAIRS.x[1]) / 2

export const CLIMB = {
  // Steps a second, going up and coming down.
  up: 1.7,
  down: 1.9,
  // Starting and stopping (steps/s²).
  speedUp: 4,
  // From standing at the foot, both feet on the floor, to standing on the last tread with both feet on it.
  first: -1.1,
  last: 13.9,
  // How much of each foot's cycle it is off the ground; and where in the walking clip's cycle (0..1) the left foot
  // lifts (measured: it swings from .72 to 1.17, the right from .22 to .67), so her arms swing with her steps.
  swing: .45,
  clipLift: .72,
  // How much lower her hips go than on a level floor: the lower leg has to reach a tread down.
  sink: .15,
  // How high over the edge of the tread it passes a swinging foot lifts.
  clear: .05,
  // Off the side of the last tread, clear of the rail round the opening: where she steps onto the upper floor.
  landing: { x: 5.85, y: STAIRS_TOP, z: -2.3 },
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
const smoothstep = (value, low, high) => {
  const t = clamp((value - low) / (high - low), 0, 1)
  return t * t * (3 - 2 * t)
}

// Where a foot stands on tread k: { x, y, z } (y: the top of the tread, or of the floor before and after them).
// Her ankle goes a little back from the middle of the tread, so her toes stay off the riser of the next one as the
// foot comes down (the walking clip lands it toes up and forward).
const FOOT_BACK = .05
export function tread(k) {
  const i = Math.min(k, COUNT - 1)
  return { x: MIDDLE, y: k < 0 ? 0 : RISE * (i + 1) + BOARD, z: STAIRS.z[1] - RUN * (i + .5) + FOOT_BACK }
}

// The way she faces going up (toward the back of the house) and coming down.
export const UP_YAW = Math.PI
export const DOWN_YAW = 0

// Her body goes up a step at a time (0.9.57), not at an even rate: going up, mostly while she straightens the leg
// she has just put on the next tread (a foot comes down every time `u` passes .9, when her body is at s = .5);
// coming down, while she lowers herself onto the next tread below, which is most of each step.
// [where in each step (s) the rise starts, how long it takes, how much of the rise goes this way rather than evenly]
const BY_STEP = { up: [.5, .7, .6], down: [-.4, .9, .3] }
function stepwise(s, up) {
  const [start, length, share] = BY_STEP[up ? "up" : "down"]
  const along = s - start
  const whole = Math.floor(along)
  // Centred on the even rise: on average neither ahead nor behind.
  const stepped = start + whole + smoothstep(along - whole, 0, length) - (.5 - length / 2)
  // Evenly again onto the floor at either end, so she starts and stops exactly on it.
  return s + (stepped - s) * share * smoothstep(s, -1, 0) * (1 - smoothstep(s, COUNT - 2, COUNT - 1))
}

// Where she is (her root, on the floor under her) `u` steps up: midway between her feet, as high as the treads
// under her on average, less a little while her feet stand on different treads. `up`: which way she is going.
export function climbBody(u, up = true) {
  const s = clamp(u - .4, CLIMB.first - .4, COUNT - 1)
  const height = clamp(RISE * (stepwise(s, up) + 1) + BOARD * smoothstep(s, -1, -.5), 0, STAIRS_TOP + BOARD)
  const sloped = smoothstep(s, -1.4, -.4) * (1 - smoothstep(s, COUNT - 1.5, COUNT - 1))
  return { x: MIDDLE, y: height - CLIMB.sink * sloped, z: STAIRS.z[1] - RUN * (s + .5) }
}

// Where each foot ([left, right]) is `u` steps up: the left foot comes down on odd treads, the right on even ones.
// A foot off the ground lifts first and then goes forward over the edge of the tread between, and the other way
// round coming down (the same path backwards).
export function climbFeet(u) {
  return [0, 1].map(side => {
    const cycle = (u - side) / 2
    const n = Math.floor(cycle)
    const into = cycle - n
    const to = tread(2 * n + side + 1)
    if (into >= CLIMB.swing) return to
    const from = tread(2 * n + side - 1)
    const t = into / CLIMB.swing
    const across = smoothstep(t, .25, 1)
    const up = smoothstep(t, 0, .55)
    return {
      x: MIDDLE,
      y: from.y + (to.y - from.y) * up + CLIMB.clear * Math.sin(Math.PI * t),
      z: from.z + (to.z - from.z) * across,
    }
  })
}

// The handrail (cottage-house.mjs): from above the first tread to above the second from the top, .9 m over the
// treads, along the side of the stairs by the kitchen. Where her hand holds it beside `z` (null off its ends).
const RAIL_X = STAIRS.x[0] + .04
const RAIL_ENDS = [STAIRS.z[1] - RUN / 2, STAIRS.z[0] + RUN * 1.5]
const railHeight = z => STAIRS_TOP * (STAIRS.z[1] - z) / (STAIRS.z[1] - STAIRS.z[0]) + .03 + .9
export function railAt(z) {
  if (z > RAIL_ENDS[0] - .05 || z < RAIL_ENDS[1] + .05) return null
  return { x: RAIL_X, y: railHeight(z), z }
}

// Where in the walking clip's cycle (0..1) she is `u` steps up, so her arms swing with her steps.
export const climbPhase = u => ((u / 2 + CLIMB.clipLift) % 1 + 1) % 1

// Whether a point is on the stairs (the upper storey's lift, cottage-yui-life.mjs, does not carry her there).
export const onStairs = point => point.x > STAIRS.x[0] - .02 && point.x < STAIRS.x[1] + .02 &&
  point.z > STAIRS.z[0] - .02 && point.z < STAIRS.z[1] + .02
