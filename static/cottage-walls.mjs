// Walls cut away in front of the camera (0.9.60, docs/plans/cottage-full-house-proposal-2026-11-24.md step 2).
// Until 0.9.59 the house was open at the front like a dollhouse and only the side walls faded. Now it is closed all
// round and the camera can go all the way round it; each wall standing between the camera and what it looks at goes
// down to a low stub with a dark band along the cut, like the cutaway walls of life-sim games. Three modes: "cut"
// (that), "up" (every wall standing) and "down" (every wall low).
//
// The walls are shortened, not clipped: the ambient occlusion and outline passes draw the scene again with their own
// materials, which would ignore clipping planes. Their shadows stay those of the whole walls (stand-ins drawn only
// into the shadow maps, SHADOW_LAYER), so the light in a room does not change as the camera goes round. Things hung
// on a wall (pictures, shelves, curtains, the window views) go with it once the cut passes them.
import * as T from "./engine/three.module.min.js"

export const WALL_MODES = ["cut", "up", "down"]
// How high a cut wall stays above its floor (m).
export const CUT_HEIGHT = .4
// The layer the shadow stand-ins are on: the shadow cameras draw it, the view camera does not.
export const SHADOW_LAYER = 3
const BAND = .03

const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

// Whether the camera looks at `target` through a wall along `axis` at `at` (they are on opposite sides of it).
export function blocks(wall, camera, target) {
  const key = wall.axis === "x" ? "x" : "z"
  return (camera[key] - wall.at) * (target[key] - wall.at) < 0
}

// Whether a wall stands in front of a room as seen from the camera (0.9.61): nearer the camera than the room along one
// axis and not beyond it along the other (a wall of the front row in front of the living room, not the kitchen's
// back wall beside it).
export function inFront(wall, camera, room) {
  const span = wall.axis === "x" ? { x: [wall.at, wall.at], z: [wall.from, wall.to] } : { x: [wall.from, wall.to], z: [wall.at, wall.at] }
  let nearer = false
  for (const key of ["x", "z"]) {
    const [low, high] = room[key]
    const [from, to] = span[key]
    if (camera[key] > high) {
      if (from >= high - .05) nearer = true
      else if (to <= low + .05) return false
    } else if (camera[key] < low) {
      if (to <= low + .05) nearer = true
      else if (from >= high - .05) return false
    }
  }
  return nearer
}

// Whether the room on a wall's far side from the camera is one being looked at (0.9.61): in the whole-house view
// every room, so the walls inside the house come down and only its far outside walls stand.
export function facesView(wall, camera, viewing) {
  const key = wall.axis === "x" ? "x" : "z"
  const far = camera[key] > wall.at ? wall.sides?.minus : wall.sides?.plus
  return Boolean(far && viewing(far))
}

// How a wall's goal follows the mode: 1 cut down, 0 standing.
export function wallGoal(mode, blocking) {
  return mode === "down" || mode === "cut" && blocking ? 1 : 0
}

// walls: [{ storey, axis, at, from, to, floor, solids: [Mesh], parts: [Object3D], shadows = true, sides }]
//   sides: { minus, plus } the room ids on either side (null outside).
//   solids: the wall's own boxes (shortened, with a band on top); parts: frames, trims, glass (shortened when they
//   are upright boxes, else hidden once the cut reaches them). floor: the floor height under it (storey frame).
// scene, groups: where to look for things hung on the walls (direct children), [scene, ground, upper].
export function createWallCuts(walls, { scene, groups, bandMaterial }) {
  const box = new T.Box3()
  const owned = new Set()
  const entries = walls.map(wall => {
    const items = []
    const add = (object, solid) => {
      owned.add(object)
      box.setFromObject(object)
      if (box.isEmpty()) return
      const upright = object.isMesh && object.rotation.x === 0 && object.rotation.z === 0 && object.parent &&
        groups.includes(object.parent)
      const item = { object, solid, upright, bottom: box.min.y, top: box.max.y, y: object.position.y, scale: object.scale.y,
        hidden: false, band: null }
      if (solid && upright && box.min.y < wall.floor + CUT_HEIGHT) {
        const band = new T.Mesh(new T.BoxGeometry(box.max.x - box.min.x + .012, BAND, box.max.z - box.min.z + .012), bandMaterial)
        band.position.set((box.min.x + box.max.x) / 2, 0, (box.min.z + box.max.z) / 2)
        band.visible = false
        band.castShadow = false
        object.parent.add(band)
        item.band = band
      }
      if (solid && wall.shadows !== false && object.isMesh) {
        // The whole wall's shadow, whatever is shown.
        const stand = new T.Mesh(object.geometry, object.material)
        stand.position.copy(object.position)
        stand.quaternion.copy(object.quaternion)
        stand.scale.copy(object.scale)
        stand.castShadow = true
        stand.receiveShadow = false
        stand.layers.set(SHADOW_LAYER)
        object.parent.add(stand)
        object.castShadow = false
      } else if (solid && wall.shadows === false) object.castShadow = false
      items.push(item)
    }
    for (const object of wall.solids) add(object, true)
    for (const object of wall.parts || []) add(object, false)
    const top = Math.max(...items.map(item => item.top))
    return { wall, items, top, cut: 0, goal: 0 }
  })

  // Things hung on a wall: off the floor (higher than a table top), against its face, along it.
  const hung = []
  for (const group of groups) {
    for (const object of group.children) {
      if (owned.has(object) || groups.includes(object) || object.isLight) continue
      box.setFromObject(object)
      if (box.isEmpty()) continue
      for (const entry of entries) {
        const { wall } = entry
        if (box.min.y < wall.floor + 1.05 || box.max.y > entry.top + .3) continue
        const across = wall.axis === "x" ? [box.min.x, box.max.x] : [box.min.z, box.max.z]
        const along = wall.axis === "x" ? [box.min.z, box.max.z] : [box.min.x, box.max.x]
        if (along[1] < wall.from - .05 || along[0] > wall.to + .05) continue
        // Its nearer side close to the wall, flat against it (wider along it than it stands out; a note on the
        // side of the fridge is not), not deep.
        const near = Math.min(Math.abs(across[0] - wall.at), Math.abs(across[1] - wall.at))
        const depth = across[1] - across[0]
        if (near > .45 || depth > .8 || depth > along[1] - along[0]) continue
        entry.items.push({ object, solid: false, upright: false, bottom: box.min.y, top: box.max.y, hidden: false, band: null })
        hung.push(object)
        break
      }
    }
  }

  // mode, camera (world position), target (what is framed), room ({ x, z } of the room in view, if one),
  // viewing(id) whether a room is being looked at, freeze (keep each wall as it is), instant, dt,
  // shown(storey) whether a storey is in sight.
  function update({ mode, camera, target, room = null, viewing = () => false, freeze = false, instant = false, dt = 0,
    shown = () => true }) {
    let moving = false
    for (const entry of entries) {
      const { wall } = entry
      if (!freeze) {
        const blocking = blocks(wall, camera, target) || facesView(wall, camera, viewing) || Boolean(room && inFront(wall, camera, room))
        entry.goal = shown(wall.storey) ? wallGoal(mode, blocking) : 0
      }
      const goal = entry.goal
      entry.cut = instant || Math.abs(entry.cut - goal) < .004 ? goal : entry.cut + (goal - entry.cut) * (1 - Math.exp(-9 * dt))
      if (entry.cut !== goal) moving = true
      const height = entry.top - (entry.top - (wall.floor + CUT_HEIGHT)) * entry.cut
      for (const item of entry.items) {
        const { object } = item
        if (item.upright && item.bottom < height - .005) {
          // Shortened from the top.
          const amount = clamp((height - item.bottom) / (item.top - item.bottom), 0, 1)
          object.scale.y = item.scale * amount
          object.position.y = item.y - (item.top - item.bottom) * (1 - amount) / 2
          if (item.hidden) { object.visible = true; item.hidden = false }
          if (item.band) {
            item.band.visible = amount < .999
            item.band.position.y = item.bottom + (item.top - item.bottom) * amount + BAND / 2 - .004
          }
          continue
        }
        if (item.band) item.band.visible = false
        // Not upright, or wholly above the cut: hidden once the cut reaches its top.
        const away = height < item.top - .005
        if (away && !item.hidden && object.visible) { object.visible = false; item.hidden = true }
        else if (!away && item.hidden) { object.visible = true; item.hidden = false }
      }
    }
    return moving
  }

  return { update, entries, hung }
}
