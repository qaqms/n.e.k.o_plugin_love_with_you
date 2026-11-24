// The rest of the house around the 0.9.25 living room: kitchen, porch and yard, the upper storey, stairs and roof.
// Rooms, walls and openings come from cottage-layout.mjs; the living room's own walls stay in cottage-scene.mjs.
import * as T from "./engine/three.module.min.js"
import { FRONT, RAILING, ROOMS, STAIRS, STOREYS, WALLS, room as roomById, wallPieces } from "./cottage-layout.mjs?v=0.9.61"
import { furnishFront } from "./cottage-front.mjs?v=0.9.61"
import { furnishHouse } from "./cottage-furnish.mjs?v=0.9.28"
import { createDuvet } from "./cottage-duvet.mjs?v=0.9.59"

const PI = Math.PI
// The upper floor slab sits on the living room's wall caps, so everything upstairs is drawn this much higher.
export const UPPER_LIFT = .12
const lift = storey => storey ? UPPER_LIFT : 0

function tileTexture(texture, colors = ["#e9dfc9", "#c9d6c4"], grout = "#b9ad97") {
  return texture(256, 256, (ctx, w, h) => {
    const size = w / 4
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      ctx.fillStyle = colors[(x + y) % 2]
      ctx.fillRect(x * size, y * size, size, size)
    }
    ctx.strokeStyle = grout
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
  // Every wall drawn here, for cutting it down in front of the camera (cottage-walls.mjs, 0.9.60).
  const wallCuts = []

  // Diorama base under the whole footprint (with the front row since 0.9.61), with a yard beside the porch.
  const [mid, face] = FRONT
  box(ground, standard(0x60796e), 3.4, -.25, (face - 2.72) / 2, 13.44, .44, face + 2.72 + .07, .12, false)
  box(ground, darkWood, 1.87, -.07, 0, 10.26, .12, 5.31, .04, false)
  box(ground, darkWood, 3.375, -.07, (mid + face) / 2, 13.25, .12, face - mid, .04, false)
  box(ground, standard(0x93ad83, { roughness: 1 }), 8.55, -.016, 0, 3.08, .03, 5.38, .01, false)
  const tiles = standard(0xffffff, { map: repeated(tileTexture(texture), 3.7, 5.2), roughness: .7 })
  box(ground, tiles, 5.125, .01, 0, 3.73, .055, 5.29, 0, false)
  // The front row's floors (0.9.61): boards in the storage room, tiles in the bath, the entry and the laundry.
  const frontFloors = {
    storage: standard(0xffffff, { map: repeated(plankTexture(texture, ["#b98f68", "#c29872", "#b08662", "#c7a07a"], 73), .7, 4.5 / 2.4), roughness: .72 }),
    bath: tileTexture(texture, ["#f3f0e8", "#cfe1df"], "#a9bdba"),
    entry: tileTexture(texture, ["#d9b99c", "#c99f86"], "#a5826c"),
    laundry: tileTexture(texture, ["#eeebe3", "#d6dde0"], "#b2b9ba"),
  }
  for (const item of ROOMS.filter(other => other.storey === 0 && other.z[0] === mid)) {
    const map = frontFloors[item.id]
    const width = item.x[1] - item.x[0] - .01
    const depth = face - mid - .04
    const material = map.isMaterial ? map : standard(0xffffff, { map: repeated(map, width / 1.4, depth / 1.4), roughness: .6 })
    box(ground, material, (item.x[0] + item.x[1]) / 2, .01, (mid + face - .03) / 2, width, .055, depth, 0, false).receiveShadow = true
  }

  // Each room's plaster. A wall between two rooms of different colours is drawn as two thin layers, one per room
  // (0.9.61); a wall on the outside keeps its room's colour all through.
  const plaster = color => standard(color, { roughness: .95 })
  const ROOM_PLASTER = {
    living: plaster(0xe3ccbb), kitchen: plaster(0xe9dcc3), bedroom: plaster(0xead2c6), study: plaster(0xd8dfc9),
    storage: plaster(0xdccfb9), bath: plaster(0xd3e2de), entry: plaster(0xeadcc6), laundry: plaster(0xdde5e6),
    closet: plaster(0xecd5d2), balcony: plaster(0xe4d3bc), studio: plaster(0xefe5d0),
  }
  const outerPlaster = plaster(0xe4d3bc)
  // The room on one side of a wall at a point along it (side -1 or 1), if any.
  const roomBeside = (wall, along, side) => ROOMS.find(item => item.storey === wall.storey && !item.outdoor && (wall.axis === "z"
    ? item.x[0] < along && along < item.x[1] && (side < 0 ? item.z[1] === wall.at : item.z[0] === wall.at)
    : item.z[0] < along && along < item.z[1] && (side < 0 ? item.x[1] === wall.at : item.x[0] === wall.at)))
  // The room ids either side of a wall (outdoor ones too), for cutting the walls of the rooms in view.
  const sidesOf = (wall, along) => Object.fromEntries([["minus", -1], ["plus", 1]].map(([name, side]) => [name,
    ROOMS.find(item => item.storey === wall.storey && (wall.axis === "z"
      ? item.x[0] < along && along < item.x[1] && (side < 0 ? item.z[1] === wall.at : item.z[0] === wall.at)
      : item.z[0] < along && along < item.z[1] && (side < 0 ? item.x[1] === wall.at : item.x[0] === wall.at)))?.id || null]))
  // Where a wall along x is drawn: the back one and the new front flush with the floor's edges, the rest centred.
  const drawnZ = wall => wall.at === -2.65 ? -2.62 : wall.at === face ? face - .03 : wall.at

  // Walls from the layout. Downstairs the living room's back and left walls are its own (cottage-scene.mjs).
  // Each wall is split where the rooms beside it change, so each room keeps its own colour.
  const splitWall = wall => {
    const cuts = new Set()
    for (const item of ROOMS.filter(other => other.storey === wall.storey)) {
      const [low, high] = wall.axis === "z" ? item.x : item.z
      const touches = wall.axis === "z" ? item.z.includes(wall.at) : item.x.includes(wall.at)
      if (touches) for (const edge of [low, high]) if (edge > wall.from + .01 && edge < wall.to - .01) cuts.add(edge)
    }
    const edges = [wall.from, ...[...cuts].sort((a, b) => a - b), wall.to]
    return edges.slice(1).map((to, index) => ({ ...wall, from: edges[index], to,
      openings: wall.openings.filter(([from]) => from >= edges[index] && from < to) }))
  }
  const walls = WALLS.flatMap(wall => {
    if (wall.storey === 0 && wall.axis === "z" && wall.at === -2.65) return [{ ...wall, from: 3.23, openings: [] }]
    if (wall.storey === 0 && wall.axis === "x" && wall.at === -3.25 && wall.from < 0) return []
    return splitWall(wall)
  })
  for (const wall of walls) {
    const parent = storeyGroups[wall.storey]
    const along = (wall.from + wall.to) / 2
    const [minus, plus] = [-1, 1].map(side => roomBeside(wall, along, side))
    // Both sides inside, in different colours: two layers. Otherwise the room's colour (or the outside's).
    const layers = minus && plus && minus.id !== plus.id
      ? [[ROOM_PLASTER[minus.id], -1], [ROOM_PLASTER[plus.id], 1]]
      : [[ROOM_PLASTER[(minus || plus)?.id] || outerPlaster, 0]]
    const edge = trim
    const meshes = []
    const solids = []
    const wallZ = wall.axis === "z" ? drawnZ(wall) : 0
    for (const piece of wallPieces(wall)) {
      const [x, y, z] = piece.at
      // Downstairs walls match the living room's 3.43 m walls; upstairs everything is lifted onto the slab.
      const height = piece.size[1] + (wall.storey === 0 && y + piece.size[1] / 2 > 3.3 ? .03 : 0)
      const centre = wall.storey === 0 ? y - piece.size[1] / 2 + height / 2 : y + UPPER_LIFT
      for (const [material, side] of layers) {
        const depth = side ? .09 : .18
        const shift = side * .045
        const solid = box(parent, material, wall.axis === "z" ? x : wall.at + shift, centre, wall.axis === "z" ? wallZ + shift : z,
          ...(wall.axis === "z" ? [piece.size[0], height, depth] : [depth, height, piece.size[2]]), .02, wall.storey === 0)
        solid.receiveShadow = true
        solids.push(solid)
      }
    }
    const top = STOREYS[wall.storey].y + STOREYS[wall.storey].height + lift(wall.storey) + (wall.storey ? 0 : .03)
    meshes.push(wall.axis === "z"
      ? box(parent, edge, along, top + .04, wallZ, wall.to - wall.from, .09, .22, .025, false)
      : box(parent, edge, wall.at, top + .04, along - .04, .21, .09, wall.to - wall.from + .08, .025, false))
    // Which way is out, for the window views: the back and the left end out towards -, the rest towards +; the
    // studio's window over the porch (on the old front, x 7 to 10) looks back.
    const out = wall.axis === "z" ? (wall.at < face - .1 ? -1 : 1) : (wall.at < 0 ? -1 : 1)
    for (const [from, to, low, high, kind] of wall.openings) {
      const bottom = low + lift(wall.storey)
      const head = high + lift(wall.storey)
      const middle = (from + to) / 2
      const alongWall = (offset, y, length, height) => wall.axis === "z"
        ? box(parent, edge, middle + offset, y, wallZ + (Math.sign(wallZ) || 1) * .01, length, height, .22, .015, false)
        : box(parent, edge, wall.at, y, middle + offset, .22, height, length, .015, false)
      for (const side of [-1, 1]) meshes.push(alongWall(side * ((to - from) / 2 + .03), (bottom + head) / 2, .07, head - bottom))
      meshes.push(alongWall(0, head + .035, to - from + .13, .07))
      if (kind === "front door") {
        // The front door (0.9.61): a wooden leaf with a little window and a brass knob, shut.
        const leaf = standard(0x7c5a44, { map: wood.map, roughness: .6 })
        const width = to - from - .02
        meshes.push(box(parent, leaf, middle, (bottom + head) / 2, wallZ, width, head - bottom - .01, .06, .015))
        for (const side of [-1, 1]) {
          meshes.push(box(parent, darkWood, middle, bottom + .55, wallZ + side * .035, width - .16, .7, .015, .01))
          meshes.push(box(parent, standard(0xcfe0e3, { roughness: .15 }), middle, head - .45, wallZ + side * .032, width - .3, .4, .01, .01))
          meshes.push(cylinder(parent, standard(0xc4995a, { metalness: .5, roughness: .35 }), middle + width / 2 - .1, bottom + 1.02,
            wallZ + side * .06, .03, .03, .04, 12))
        }
      }
      if (kind === "window") {
        meshes.push(alongWall(0, bottom - .03, to - from + .13, .07))
        // The period views are shared with the living room window, so every window follows the time of day.
        // Outside the wall, facing in.
        for (const [index, view] of views.entries()) {
          const offset = out * (.13 - index * .002)
          const glass = mesh(parent, new T.PlaneGeometry(to - from, head - bottom), view.material,
            ...(wall.axis === "z" ? [middle, (bottom + head) / 2, wallZ + offset] : [wall.at + offset, (bottom + head) / 2, middle]), false)
          if (wall.axis === "x") glass.rotation.y = -out * PI / 2
          else if (out > 0) glass.rotation.y = PI
          glass.renderOrder = index
          meshes.push(glass)
        }
      }
    }
    // The walls along x in front of the old back cast no shadow: the light comes in as it did while the house was
    // open at the front.
    wallCuts.push({ storey: wall.storey, axis: wall.axis, at: wall.axis === "z" ? wallZ : wall.at, from: wall.from, to: wall.to,
      floor: STOREYS[wall.storey].y + lift(wall.storey), solids, parts: meshes, shadows: !(wall.axis === "z" && wall.at > 0),
      sides: sidesOf(wall, along) })
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
  // The front row upstairs (0.9.61): boards in the closet and the studio, a deck on the balcony, out to x 10.
  const deck = plankTexture(texture, ["#c49a72", "#bb916a", "#caa47c", "#b78c64"], 91)
  const frontEdge = face + .03
  for (const [a, b, map] of [[x0, -.25, boards], [-.25, 3.25, deck], [3.25, 10.09, boards]]) {
    const floorWood = standard(0xffffff, { map: repeated(map, (b - a) / 4, (frontEdge - z1) / 2.4), roughness: map === deck ? .75 : .66 })
    box(upper, floorWood, (a + b) / 2, lifted - .07, (z1 + frontEdge) / 2, b - a, .14, frontEdge - z1, 0, false).receiveShadow = true
  }
  box(upper, darkWood, (x0 + 10.09) / 2, lifted - .07, frontEdge + .02, 10.09 - x0, .15, .05, .01, false)
  // The balcony's railing along its open front.
  const railZ = RAILING.z - .06
  const railLength = RAILING.x[1] - RAILING.x[0] - .1
  box(upper, darkWood, (RAILING.x[0] + RAILING.x[1]) / 2, lifted + RAILING.height, railZ, railLength + .06, .06, .09, .02)
  box(upper, darkWood, (RAILING.x[0] + RAILING.x[1]) / 2, lifted + .1, railZ, railLength, .05, .06, .015)
  for (let index = 0; index <= 20; index += 1) {
    box(upper, wood, RAILING.x[0] + .05 + railLength * index / 20, lifted + RAILING.height / 2 + .05, railZ, .04, RAILING.height - .1, .04, .01)
  }

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
  for (const z of [porch.z[0] + .12, porch.z[1] - .2]) {
    cylinder(ground, darkWood, porch.x[1] - .14, porch.deck + 1.25, z, .055, .06, 2.5, 14)
    box(ground, darkWood, (porch.x[0] + porch.x[1]) / 2 + .1, beamTop, z, porch.x[1] - porch.x[0] + .3, .14, .08, .015)
  }
  for (let i = 0; i < 7; i++) {
    box(ground, wood, porch.x[0] + .25 + i * .45, beamTop + .1, (porch.z[0] + porch.z[1]) / 2 - .1, .07, .07, porch.z[1] - porch.z[0] + .1, .012)
  }
  // A few shrubs in the yard behind the porch.
  const leaves = [0x5f8a64, 0x739a6c, 0x547e5d].map(color => fabric(color, { sheen: .4, roughness: 1 }))
  for (const [x, z, r, i] of [[7.7, -2.15, .42, 0], [8.35, -2.25, .32, 1], [9.65, -2.05, .45, 2], [9.78, 1, .22, 1]]) {
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
  // With every wall up (0.9.60, cottage-walls.mjs "up"), the front half of the roof and the gable ends close the
  // house; otherwise the roof is only its back half, read from the front as the attic's sloped ceiling.
  const roofFront = new T.Group()
  overhead.add(roofFront)
  const frontEave = 2.98
  const frontPitch = Math.atan2(ridgeY - eaveY, frontEave - ridgeZ)
  const frontSlope = (frontEave - ridgeZ) / Math.cos(frontPitch)
  for (const [material, depth, offset] of [[standard(0xb08a68, { map: repeated(wood.map, 3, 6), roughness: .7 }), .12, 0],
    [standard(0xb5715a, { roughness: .82 }), .08, .1]]) {
    const slab = box(roofFront, material, 1.87, (eaveY + ridgeY) / 2 + offset * Math.cos(frontPitch),
      (frontEave + ridgeZ) / 2 + offset * Math.sin(frontPitch), 10.9, depth, frontSlope, .02, false)
    slab.rotation.x = frontPitch
  }
  const gable = new T.Shape([new T.Vector2(-2.71, 0), new T.Vector2(2.71, 0), new T.Vector2(-ridgeZ, ridgeY - roofTop - .08)])
  for (const [x, material] of [[-3.32, standard(0xead2c6, { roughness: .95 })], [7.09, standard(0xd8dfc9, { roughness: .95 })]]) {
    const end = mesh(roofFront, new T.ShapeGeometry(gable), material, x, roofTop, 0, false)
    material.side = T.DoubleSide
    end.rotation.y = PI / 2
  }
  // The front row's own gable roof (0.9.61), lower, from one end of the house to the other: its back slope tucks under
  // the old roof's front half.
  const rowRidgeZ = (mid + face) / 2
  const rowHalf = face + .33 - rowRidgeZ
  const rowPitch = T.MathUtils.degToRad(35)
  const rowRidgeY = eaveY + rowHalf * Math.tan(rowPitch)
  const rowSlope = rowHalf / Math.cos(rowPitch)
  const rowX = [-3.32, 10.09]
  for (const side of [-1, 1]) {
    for (const [material, depth, offset] of [[standard(0xb08a68, { map: repeated(wood.map, 3, 4), roughness: .7 }), .12, 0],
      [standard(0xb5715a, { roughness: .82 }), .08, .1]]) {
      const slab = box(roofFront, material, (rowX[0] + rowX[1]) / 2, (eaveY + rowRidgeY) / 2 + offset * Math.cos(rowPitch),
        rowRidgeZ + side * rowHalf / 2 + side * offset * Math.sin(rowPitch), rowX[1] - rowX[0] + .26, depth, rowSlope, .02, false)
      slab.rotation.x = side * rowPitch
    }
  }
  box(roofFront, standard(0x93573f), (rowX[0] + rowX[1]) / 2, rowRidgeY + .1, rowRidgeZ, rowX[1] - rowX[0] + .34, .12, .18, .03, false)
  const rowGableHalf = (face - mid) / 2 + .03
  const rowGable = new T.Shape([new T.Vector2(-rowGableHalf, 0), new T.Vector2(rowGableHalf, 0),
    new T.Vector2(0, rowRidgeY - roofTop - .08)])
  for (const [x, material] of [[rowX[0], standard(0xecd5d2, { roughness: .95 })], [rowX[1], standard(0xefe5d0, { roughness: .95 })]]) {
    material.side = T.DoubleSide
    mesh(roofFront, new T.ShapeGeometry(rowGable), material, x, roofTop, rowRidgeZ, false).rotation.y = PI / 2
  }
  roofFront.visible = false
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
  // The duvet is soft: it rises over Yui when she sleeps under it (cottage-duvet.mjs). Getting up (0.9.52) she
  // throws the half on the room side (+x, where she gets out) over onto the other half.
  const duvet = createDuvet(bed, fabric(0x9fb4c9, { side: T.DoubleSide }), fabric(0xf4eee2),
    { width: 1.82, from: -.16, to: 1.06, top: .49, fold: { a: [-.25, -.16], b: [-.4, 1.19], toward: 1, squeeze: .5 } })
  for (const x of [-.45, .45]) box(bed, fabric(0xf7f1e6), x, .5, -.78, .66, .14, .36, .07)
  const desk = group(upper, 3, lifted, -2.2)
  box(desk, wood, 0, .74, 0, 1.6, .05, .7, .015)
  for (const x of [-.74, .74]) box(desk, darkWood, x, .36, 0, .06, .72, .62, .01)
  // Desk chair: the backrest faces away from the desk, four legs.
  const chair = group(upper, 3, lifted, -1.55)
  box(chair, fabric(0xcf9f6f), 0, .47, 0, .46, .08, .44, .03)
  box(chair, fabric(0xcf9f6f), 0, .8, .2, .46, .52, .07, .03)
  for (const [x, z] of [[-.19, -.18], [.19, -.18], [-.19, .18], [.19, .18]]) cylinder(chair, darkWood, x, .22, z, .022, .02, .44, 10)
  const furnishing = furnishHouse(scene, kit, { ground, upper, lifted })
  const front = furnishFront(scene, kit, { ground, upper, lifted })
  furnishing.lamps.push(...front.lamps)
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
  // Each front-row ceiling lamp with the room it hangs in.
  const pendants = front.pendants.map(item => ({ object: item.object,
    room: ROOMS.find(other => other.storey === item.storey && other.x[0] < item.x && item.x < other.x[1] && other.z[0] < item.z && item.z < other.z[1]).id }))
  return { storeys: storeyGroups, overhead, roofFront, wallCuts, rooms, duvet, pendants, ...furnishing }
}
