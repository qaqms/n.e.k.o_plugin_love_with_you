// The rest of the house around the 0.9.25 living room: kitchen, porch and yard, the upper storey, stairs and roof.
// Rooms, walls and openings come from cottage-layout.mjs; the living room's own walls stay in cottage-scene.mjs.
import * as T from "./engine/three.module.min.js"
import { ROOMS, STAIRS, STOREYS, WALLS, room as roomById, wallPieces } from "./cottage-layout.mjs?v=0.9.26"
import { furnishHouse } from "./cottage-furnish.mjs?v=0.9.28"

const PI = Math.PI
// The upper floor slab sits on the living room's wall caps, so everything upstairs is drawn this much higher.
export const UPPER_LIFT = .12
const lift = storey => storey ? UPPER_LIFT : 0

function tileTexture(texture) {
  return texture(256, 256, (ctx, w, h) => {
    const size = w / 4
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      ctx.fillStyle = (x + y) % 2 ? "#e9dfc9" : "#c9d6c4"
      ctx.fillRect(x * size, y * size, size, size)
    }
    ctx.strokeStyle = "#b9ad97"
    ctx.lineWidth = 3
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * size, 0); ctx.lineTo(i * size, h); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i * size); ctx.lineTo(w, i * size); ctx.stroke()
    }
  })
}

// Boards with seams and a little tone variation, for the upstairs floor and the porch deck.
function plankTexture(texture, tones, seed) {
  return texture(1024, 512, (ctx, w, h) => {
    let value = seed
    const rand = () => (value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 4294967296
    const rows = 8
    const row = h / rows
    for (let r = 0; r < rows; r++) {
      let x = -rand() * 300
      while (x < w) {
        const length = 260 + rand() * 360
        ctx.fillStyle = tones[Math.floor(rand() * tones.length)]
        ctx.fillRect(x, r * row, length, row)
        for (let i = 0; i < 14; i++) {
          ctx.strokeStyle = `rgba(96,51,30,${.04 + rand() * .08})`
          const y = r * row + rand() * row
          ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x + length * .3, y + rand() * 4 - 2, x + length * .7, y - 1, x + length, y); ctx.stroke()
        }
        ctx.fillStyle = "rgba(70,40,22,.35)"
        ctx.fillRect(x, r * row, 2, row)
        x += length
      }
      ctx.fillStyle = "rgba(70,40,22,.3)"
      ctx.fillRect(0, r * row, w, 2)
    }
  })
}

function repeated(map, x, y) {
  const copy = map.clone()
  copy.wrapS = copy.wrapT = T.RepeatWrapping
  copy.repeat.set(x, y)
  copy.needsUpdate = true
  return copy
}

export function buildHouse(scene, kit) {
  const { box, cylinder, mesh, group, standard, fabric, glaze, texture, wood, darkWood, trim, views } = kit
  const ground = new T.Group()
  const upper = new T.Group()
  const overhead = new T.Group()
  scene.add(ground, upper, overhead)
  const storeyGroups = [ground, upper]
  const fadeWalls = []

  // Diorama base under the whole footprint, with a yard beside the porch.
  box(ground, standard(0x60796e), 3.4, -.25, 0, 13.44, .44, 5.44, .12, false)
  box(ground, darkWood, 1.87, -.07, 0, 10.26, .12, 5.31, .04, false)
  box(ground, standard(0x93ad83, { roughness: 1 }), 8.55, -.016, 0, 3.08, .03, 5.38, .01, false)
  const tiles = standard(0xffffff, { map: repeated(tileTexture(texture), 3.7, 5.2), roughness: .7 })
  box(ground, tiles, 5.125, .01, 0, 3.73, .055, 5.29, 0, false)

  const kitchenPlaster = standard(0xe9dcc3, { roughness: .95 })
  const outerPlaster = standard(0xe4d3bc, { roughness: .95 })
  const plasterFor = (storey, at) => storey === 0
    ? at > 6 ? outerPlaster : kitchenPlaster
    : at < 1.5 ? standard(0xead2c6, { roughness: .95 }) : standard(0xd8dfc9, { roughness: .95 })

  // Walls from the layout. Downstairs only the kitchen and porch walls are new.
  const walls = WALLS.flatMap(wall => {
    if (wall.axis === "z" && wall.storey === 0) return [{ ...wall, from: 3.23, openings: [] }]
    // Split the upstairs back wall at the partition so each room keeps its own colour.
    if (wall.axis === "z") return [{ ...wall, to: 1.5, openings: wall.openings.filter(([from]) => from < 1.5) },
      { ...wall, from: 1.5, openings: wall.openings.filter(([from]) => from >= 1.5) }]
    return wall.storey === 0 && wall.at < 0 ? [] : [wall]
  })
  for (const wall of walls) {
    const parent = storeyGroups[wall.storey]
    // Side walls fade when they stand in front of the room being viewed, so they need materials of their own.
    const fades = wall.axis === "x"
    const shared = plasterFor(wall.storey, fades ? wall.at : (wall.from + wall.to) / 2)
    const material = fades ? shared.clone() : shared
    const edge = fades ? trim.clone() : trim
    const meshes = []
    for (const piece of wallPieces(wall)) {
      const [x, y, z] = piece.at
      // Downstairs walls match the living room's 3.43 m walls; upstairs everything is lifted onto the slab.
      const height = piece.size[1] + (wall.storey === 0 && y + piece.size[1] / 2 > 3.3 ? .03 : 0)
      const centre = wall.storey === 0 ? y - piece.size[1] / 2 + height / 2 : y + UPPER_LIFT
      const solid = box(parent, material, x, centre, wall.axis === "z" ? -2.62 : z,
        ...(wall.axis === "z" ? [piece.size[0], height, .18] : [.18, height, piece.size[2]]), .02, wall.storey === 0)
      solid.receiveShadow = true
      meshes.push(solid)
    }
    const top = STOREYS[wall.storey].y + STOREYS[wall.storey].height + lift(wall.storey) + (wall.storey ? 0 : .03)
    meshes.push(wall.axis === "z"
      ? box(parent, edge, (wall.from + wall.to) / 2, top + .04, -2.62, wall.to - wall.from, .09, .22, .025, false)
      : box(parent, edge, wall.at, top + .04, (wall.from + wall.to) / 2 - .04, .21, .09, wall.to - wall.from + .08, .025, false))
    for (const [from, to, low, high, kind] of wall.openings) {
      const bottom = low + lift(wall.storey)
      const head = high + lift(wall.storey)
      const middle = (from + to) / 2
      const along = (offset, y, length, height) => wall.axis === "z"
        ? box(parent, edge, middle + offset, y, wall.at + .02, length, height, .22, .015, false)
        : box(parent, edge, wall.at, y, middle + offset, .22, height, length, .015, false)
      for (const side of [-1, 1]) meshes.push(along(side * ((to - from) / 2 + .03), (bottom + head) / 2, .07, head - bottom))
      meshes.push(along(0, head + .035, to - from + .13, .07))
      if (kind === "window") {
        meshes.push(along(0, bottom - .03, to - from + .13, .07))
        // The period views are shared with the living room window, so every window follows the time of day.
        for (const [index, view] of views.entries()) {
          const glass = mesh(parent, new T.PlaneGeometry(to - from, head - bottom), view.material,
            ...(wall.axis === "z" ? [middle, (bottom + head) / 2, wall.at - .1 + index * .002] : [wall.at + .1 - index * .002, (bottom + head) / 2, middle]), false)
          if (wall.axis === "x") glass.rotation.y = -PI / 2
          glass.renderOrder = index
        }
      }
    }
    if (fades) fadeWalls.push({ at: wall.at, storey: wall.storey, materials: [material, edge], meshes, opacity: 1 })
  }

  // The upper floor, with an opening over the stairs.
  const lifted = STOREYS[1].y + UPPER_LIFT
  // One texture repeat covers 4 m by 2.4 m: eight 30 cm boards, like the living room planks.
  const boards = plankTexture(texture, ["#d9ab79", "#dfb487", "#d2a06f", "#e2ba8c", "#cd9a6a"], 31)
  const [x0, x1, z0, z1] = [-3.32, 7.09, -2.71, 2.65]
  const hole = STAIRS.hole
  for (const [a, b, c, d] of [[x0, hole.x[0], z0, z1], [hole.x[1], x1, z0, z1], [hole.x[0], hole.x[1], hole.z[1], z1]]) {
    // Each piece repeats the boards by its own size so narrow strips keep the same plank width.
    const floorWood = standard(0xffffff, { map: repeated(boards, (b - a) / 4, (d - c) / 2.4), roughness: .66 })
    box(upper, floorWood, (a + b) / 2, lifted - .07, (c + d) / 2, b - a, .14, d - c, 0, false).receiveShadow = true
  }
  box(upper, darkWood, (x0 + x1) / 2, lifted - .07, z1 + .02, x1 - x0, .15, .05, .01, false)

  // Stairs climb from the kitchen front to the opening at the back.
  const steps = 14
  const run = (STAIRS.z[1] - STAIRS.z[0]) / steps
  const stairX = (STAIRS.x[0] + STAIRS.x[1]) / 2
  const stairWidth = STAIRS.x[1] - STAIRS.x[0]
  for (let i = 0; i < steps; i++) {
    const height = lifted * (i + 1) / steps
    box(ground, darkWood, stairX, height / 2, STAIRS.z[1] - run * (i + .5), stairWidth, height, run, .01)
    box(ground, wood, stairX, height + .015, STAIRS.z[1] - run * (i + .5) + .01, stairWidth + .03, .03, run + .03, .008)
  }
  const treadTop = z => lifted * (STAIRS.z[1] - z) / (STAIRS.z[1] - STAIRS.z[0])
  const posts = [STAIRS.z[1] - run / 2, STAIRS.z[0] + run * 1.5].map(z => new T.Vector3(STAIRS.x[0] + .04, treadTop(z) + .03, z))
  for (const post of posts) cylinder(ground, darkWood, post.x, post.y + .45, post.z, .025, .025, .9, 10)
  const [low, high] = posts.map(post => post.clone().setY(post.y + .9))
  const rail = cylinder(ground, darkWood, ...low.clone().lerp(high, .5).toArray(), .022, .022, low.distanceTo(high), 10)
  rail.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), high.clone().sub(low).normalize())
  // Guard rail around the opening upstairs.
  for (const z of [hole.z[1] - .02]) {
    box(upper, darkWood, stairX, lifted + .92, z, stairWidth, .05, .05, .015)
    for (const x of [hole.x[0] + .03, stairX, hole.x[1] - .03]) box(upper, darkWood, x, lifted + .46, z, .04, .92, .04, .01)
  }
  box(upper, darkWood, hole.x[0] + .02, lifted + .92, (hole.z[0] + hole.z[1]) / 2 + .3, .05, .05, hole.z[1] - hole.z[0] - .6, .015)
  for (const z of [hole.z[0] + .6, hole.z[0] + 1.4]) box(upper, darkWood, hole.x[0] + .02, lifted + .46, z, .04, .92, .04, .01)

  // Porch deck and pergola.
  const porch = roomById("porch")
  const deckWood = standard(0xffffff, { map: repeated(plankTexture(texture, ["#c49a72", "#bb916a", "#caa47c", "#b78c64"], 57), 3 / 4, 3.85 / 2.4), roughness: .75 })
  box(ground, deckWood, (porch.x[0] + porch.x[1]) / 2 + .02, (porch.deck - .03) / 2, (porch.z[0] + porch.z[1]) / 2,
    porch.x[1] - porch.x[0] - .04, porch.deck + .03, porch.z[1] - porch.z[0], .02)
  box(ground, darkWood, porch.x[1] - .02, porch.deck / 2 - .06, 1.1, .38, .12, 1, .02)
  // An open pergola: it frames the porch without hiding it from above.
  const beamTop = porch.deck + 2.55
  for (const z of [porch.z[0] + .12, porch.z[1] - .12]) {
    cylinder(ground, darkWood, porch.x[1] - .14, porch.deck + 1.25, z, .055, .06, 2.5, 14)
    box(ground, darkWood, (porch.x[0] + porch.x[1]) / 2 + .1, beamTop, z, porch.x[1] - porch.x[0] + .3, .14, .08, .015)
  }
  for (let i = 0; i < 7; i++) {
    box(ground, wood, porch.x[0] + .25 + i * .45, beamTop + .1, (porch.z[0] + porch.z[1]) / 2, .07, .07, porch.z[1] - porch.z[0] + .3, .012)
  }
  // A few shrubs in the yard behind the porch.
  const leaves = [0x5f8a64, 0x739a6c, 0x547e5d].map(color => fabric(color, { sheen: .4, roughness: 1 }))
  for (const [x, z, r, i] of [[7.7, -2.15, .42, 0], [8.35, -2.25, .32, 1], [9.65, -2.05, .45, 2], [9.75, 2.45, .22, 1]]) {
    const shrub = mesh(ground, new T.SphereGeometry(r, 18, 12), leaves[i], x, r * .72, z)
    shrub.scale.y = .82
  }
  for (const [x, z] of [[8.2, 2.35], [8.75, 2.2], [9.3, 2.4]]) {
    const stone = cylinder(ground, standard(0xc7c1b3), x, .005, z, .16, .17, .03, 16)
    stone.scale.z = .75
  }

  // The back half of a steep gable roof: from the front it reads as the attic's sloped ceiling.
  const roofTop = STOREYS[1].y + STOREYS[1].height + UPPER_LIFT
  const pitch = T.MathUtils.degToRad(40)
  const eaveZ = -2.98
  const ridgeZ = -.35
  const eaveY = roofTop - .27
  const ridgeY = eaveY + (ridgeZ - eaveZ) * Math.tan(pitch)
  const slope = (ridgeZ - eaveZ) / Math.cos(pitch)
  const roofSlab = (material, depth, offset) => {
    const slab = box(overhead, material, 1.87, (eaveY + ridgeY) / 2 + offset * Math.cos(pitch), (eaveZ + ridgeZ) / 2 - offset * Math.sin(pitch),
      10.9, depth, slope, .02, false)
    slab.rotation.x = -pitch
    return slab
  }
  roofSlab(standard(0xb08a68, { map: repeated(wood.map, 3, 6), roughness: .7 }), .12, 0)
  roofSlab(standard(0xb5715a, { roughness: .82 }), .08, .1)
  box(overhead, standard(0x93573f), 1.87, ridgeY + .12, ridgeZ + .08, 10.98, .12, .18, .03, false)
  const chimneyZ = -1.7
  const chimneyBase = eaveY + (chimneyZ - eaveZ) * Math.tan(pitch)
  // The chimney starts just above the underside's front edge so it never shows through the attic ceiling.
  box(overhead, standard(0x9a6b55), 4.9, chimneyBase + .62, chimneyZ, .45, 1, .45, .03, false)
  box(overhead, standard(0x7d5444), 4.9, chimneyBase + 1.14, chimneyZ, .53, .08, .53, .02, false)

  // Furniture placeholders until the rooms are furnished (cottage redesign step 4).
  const sage = standard(0x8fae9c)
  const counterTop = standard(0xe9e2d3, { roughness: .5 })
  const fridge = group(ground, 3.75, 0, -2.2)
  box(fridge, glaze(0xd6e5da), 0, .95, 0, .78, 1.9, .68, .08)
  box(fridge, standard(0xbdcdc2), 0, 1.24, .345, .74, .012, .01, 0, false)
  for (const y of [.8, 1.5]) box(fridge, darkWood, .3, y, .36, .035, .3, .035, .012)
  const counter = group(ground, 5, 0, -2.25)
  box(counter, sage, 0, .44, 0, 1.98, .84, .56, .02)
  box(counter, counterTop, 0, .885, .01, 2.02, .05, .6, .015)
  for (const x of [-.66, 0, .66]) box(counter, standard(0x9fbcab), x, .44, .285, .6, .7, .02, .01)
  box(counter, standard(0x6d7d78, { roughness: .35, metalness: .3 }), .45, .87, 0, .5, .04, .36, .01, false)
  cylinder(counter, standard(0xb08457, { metalness: .3, roughness: .4 }), .45, 1.0, -.2, .018, .018, .22, 10)
  const table = group(ground, 4.9, 0, .7)
  cylinder(table, wood, 0, .73, 0, .62, .6, .05, 40).scale.z = .72
  for (const [x, z] of [[-.42, -.24], [.42, -.24], [-.42, .24], [.42, .24]]) cylinder(table, darkWood, x, .36, z, .03, .025, .7, 10)
  for (const side of [-1, 1]) {
    const chair = group(table, side * .86, 0, 0, side * PI / 2)
    box(chair, wood, 0, .45, 0, .42, .05, .42, .02)
    box(chair, wood, 0, .78, .19, .42, .55, .04, .02)
    for (const [x, z] of [[-.17, -.17], [.17, -.17], [-.17, .17], [.17, .17]]) box(chair, darkWood, x, .22, z, .035, .44, .035, .01)
  }
  const bed = group(upper, -1.6, lifted, -1.45)
  box(bed, wood, 0, .17, 0, 1.9, .26, 2.2, .04)
  box(bed, darkWood, 0, .55, -1.06, 1.9, 1.05, .08, .03)
  box(bed, fabric(0xf4eee2), 0, .36, .02, 1.78, .18, 2.08, .07)
  box(bed, fabric(0x9fb4c9), 0, .44, .35, 1.82, .1, 1.42, .05)
  for (const x of [-.45, .45]) box(bed, fabric(0xf7f1e6), x, .5, -.78, .66, .14, .36, .07)
  const desk = group(upper, 3, lifted, -2.2)
  box(desk, wood, 0, .74, 0, 1.6, .05, .7, .015)
  for (const x of [-.74, .74]) box(desk, darkWood, x, .36, 0, .06, .72, .62, .01)
  const chair = group(upper, 3, lifted, -1.55, PI)
  box(chair, fabric(0xcf9f6f), 0, .47, 0, .46, .08, .44, .03)
  box(chair, fabric(0xcf9f6f), 0, .8, .2, .46, .52, .07, .03)
  cylinder(chair, darkWood, 0, .23, 0, .03, .03, .44, 10)
  const furnishing = furnishHouse(scene, kit, { ground, upper, lifted })
  // Upstairs pieces do not cast into the shadow map: they would darken the open rooms below.
  upper.traverse(object => { object.castShadow = false })
  overhead.traverse(object => { object.castShadow = false })

  // Invisible volumes for choosing a room by clicking it.
  const rooms = ROOMS.map(item => {
    const storey = STOREYS[item.storey]
    const volume = new T.Mesh(new T.BoxGeometry(item.x[1] - item.x[0], storey.height, item.z[1] - item.z[0]))
    volume.position.set((item.x[0] + item.x[1]) / 2, storey.y + lift(item.storey) + storey.height / 2, (item.z[0] + item.z[1]) / 2)
    volume.updateMatrixWorld()
    return { id: item.id, object: volume }
  })
  return { storeys: storeyGroups, overhead, fadeWalls, rooms, ...furnishing }
}
