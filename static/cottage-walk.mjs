// How Yui walks (0.9.53): steering along her way, speeding up and slowing down, and how the walking clip keeps up
// with her pace. Pure functions; cottage-yui-life.mjs moves her with them and cottage-yui.mjs plays the clip.
//
// The walking clip was made for a brisker walk than suits the cottage: one cycle a second, with each foot carried
// back about 1.15 m during it. Played as it is at a slower walk, her feet slid forward on the floor on every step.
// Now the clip slows down with her and its strides shorten (`stride`), so her feet keep up with the floor.

export const WALK = {
  // Her usual pace (m/s).
  speed: .85,
  // The pace the walking clip was made for (m/s), at its own rate.
  natural: 1.15,
  // How fast she can turn while walking (rad/s), and how much faster from standing.
  turn: 2.6,
  pivot: 4,
  // Speeding up and slowing down (m/s²).
  accel: 1.6,
  brake: 1.1,
  // How far before a corner she starts round it (m), when the way goes on.
  corner: .32,
  // The slowest she walks into a stop, so she does not creep.
  creep: .1,
}

const damp = (value, target, rate, dt) => value + (target - value) * (1 - Math.exp(-rate * dt))
const turnBy = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from))

// How the walking clip keeps up with a pace: its playback rate and how far its strides reach (1: as captured).
// Part of the slowing comes from a slower cycle and part from shorter steps, so that her feet move back at the
// pace she goes: natural × rate × reach = pace.
export function stride(pace) {
  const share = Math.max(.25, Math.min(1.2, pace / WALK.natural))
  return { rate: share ** .6, reach: share ** .4 }
}

// One frame of walking toward `target` ({ x, z }). `state` ({ x, z, yaw, pace }) is updated in place.
// `through`: the way goes on past it, so she rounds the corner without stopping (true once she is round);
// otherwise she slows down into it and stops on it (true on arrival).
export function walkStep(state, target, dt, through = false) {
  const dx = target.x - state.x
  const dz = target.z - state.z
  const left = Math.hypot(dx, dz)
  if (through && left < WALK.corner) return true
  if (!through && left < .015) {
    state.x = target.x
    state.z = target.z
    return true
  }
  // Turning: smoothly, at no more than a walking turn (faster while she has barely started).
  const heading = Math.atan2(dx, dz)
  const off = turnBy(state.yaw, heading)
  // How far round she still has to turn (her head leads into it, cottage-yui.mjs).
  state.off = off
  const most = (WALK.turn + WALK.pivot * Math.max(0, 1 - state.pace / WALK.speed)) * dt
  state.yaw += Math.max(-most, Math.min(most, damp(0, off, 7, dt)))
  // Her pace: slower for a sharp turn, and braking in time to stop where she is going.
  let wanted = WALK.speed * Math.max(.2, Math.cos(turnBy(state.yaw, heading))) ** 2
  if (!through) wanted = Math.min(wanted, Math.max(WALK.creep, Math.sqrt(2 * WALK.brake * left)))
  state.pace = wanted > state.pace ? Math.min(wanted, state.pace + WALK.accel * dt) : Math.max(wanted, state.pace - WALK.brake * 2 * dt)
  // Forward the way she faces, drawn toward where she is going; the last stretch to a stop goes straight there.
  const move = Math.min(left, state.pace * dt)
  let mx = Math.sin(state.yaw)
  let mz = Math.cos(state.yaw)
  const pull = !through && left < .25 ? 1 : .35
  mx = mx * (1 - pull) + dx / left * pull
  mz = mz * (1 - pull) + dz / left * pull
  const length = Math.hypot(mx, mz) || 1
  state.x += mx / length * move
  state.z += mz / length * move
  return false
}
