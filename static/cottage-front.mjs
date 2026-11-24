// Furnishing for the front row of rooms (0.9.61, docs/plans/cottage-full-house-proposal-2026-11-24.md step 3):
// storage room, bath, entry and laundry downstairs; closet, balcony and art studio upstairs. The big pieces stand
// where the FURNITURE placeholders in cottage-layout.mjs say (the layout tests keep them clear of walls and doors).
// Each room gets a shade that glows after dark; only the bath, the entry and the studio carry a real light, to keep
// the light count (and so every material's shading cost) low.
import * as T from "./engine/three.module.min.js"

const PI = Math.PI

function sampler(seed) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
}

export function furnishFront(scene, kit, { ground, upper, lifted }) {
  const { box, cylinder, mesh, group, standard, fabric, glaze, wood, darkWood } = kit
  const rand = sampler(613)
  const lamps = []
  // The ceiling lamps by room: with the ceiling lifted away they would hang in the air in front of the room being
  // looked at, so cottage.mjs shows a room's lamp only while that room (or the whole house) is in view.
  const pendants = []
  const white = glaze(0xf4f1ea)
  const chrome = standard(0xc9cfd2, { metalness: .6, roughness: .25 })
  const brass = standard(0xb08457, { metalness: .3, roughness: .42 })
  const cardboard = standard(0xc59b6b, { roughness: .95 })
  const leafColors = [0x4f8763, 0x6f9a68, 0x3f6d58].map(color => standard(color, { side: T.DoubleSide }))
  const glowShade = (color = 0xf6d3a5) => standard(color, { emissive: 0xffa85c, emissiveIntensity: 0, side: T.DoubleSide })
  // A lamp that glows after dark; `light` [strength, distance] adds a real point light in the scene root.
  const lamp = (storey, position, shade, light) => {
    let source = { intensity: 0 }
    if (light) {
      source = new T.PointLight(0xffb36b, 0, light[1], 1.7)
      source.position.copy(position)
      scene.add(source)
    }
    lamps.push({ storey, light: source, shade, strength: light ? light[0] : 0 })
  }
  // A ceiling lamp: a cord and a shade under the ceiling of `storey`.
  const pendant = (parent, storey, x, z, ceiling, color, light) => {
    const shade = glowShade(color)
    const hanging = group(parent, x, 0, z)
    cylinder(hanging, darkWood, 0, ceiling - .2, 0, .008, .008, .4, 6)
    cylinder(hanging, shade, 0, ceiling - .5, 0, .1, .22, .2, 24).castShadow = false
    lamp(storey, new T.Vector3(x, ceiling - .65, z), shade, light)
    pendants.push({ object: hanging, x, z, storey })
  }
  const plant = (parent, x, y, z, size, potColor) => {
    const pot = group(parent, x, y, z)
    pot.scale.setScalar(size)
    cylinder(pot, standard(potColor), 0, .15, 0, .17, .12, .3, 20)
    cylinder(pot, standard(0x4a3b2c), 0, .29, 0, .155, .155, .02, 20)
    for (let i = 0; i < 9; i++) {
      const angle = i * 2.4
      const length = .3 + rand() * .2
      const shape = new T.Shape()
      shape.moveTo(0, 0)
      shape.quadraticCurveTo(-length * .4, length * .5, 0, length)
      shape.quadraticCurveTo(length * .4, length * .5, 0, 0)
      const leaf = mesh(pot, new T.ShapeGeometry(shape, 8), leafColors[i % 3], Math.cos(angle) * .06, .3, Math.sin(angle) * .06)
      leaf.rotation.set(.3 + rand() * .5, -angle, (i % 2 ? 1 : -1) * (.3 + rand() * .4), "YXZ")
    }
    return pot
  }
  const rug = (parent, x, y, z, w, d, color, round = false) => {
    const geometry = round ? new T.CircleGeometry(.5, 40) : new T.PlaneGeometry(1, 1)
    const piece = mesh(parent, geometry, fabric(color, { roughness: 1 }), x, y + .008, z, false)
    piece.rotation.x = -PI / 2
    piece.scale.set(w, d, 1)
    return piece
  }
  const groundCeiling = 3.4
  const upperCeiling = lifted + 3

  // Storage room: a tall shelf of boxes and jars on the left wall, stacked boxes, a bicycle, a broom and a bucket.
  const rack = group(ground, -2.9, 0, 4.9)
  for (const z of [-1.18, 1.18]) for (const x of [-.2, .2]) box(rack, darkWood, x, .9, z, .04, 1.8, .04, .01)
  const jarColors = [0xd9a066, 0xc7d9d2, 0xe8c9a0, 0xa7c4a0]
  for (const [index, y] of [.08, .55, 1.05, 1.55].entries()) {
    box(rack, wood, 0, y, 0, .44, .03, 2.38, .01)
    let z = -1.08
    while (z < 1.05) {
      const kind = rand()
      if (kind < .45) {
        const w = .28 + rand() * .2
        box(rack, cardboard, -.02, y + .12, z + w / 2, .36, .22, w - .02, .01)
        z += w
      } else if (kind < .8) {
        cylinder(rack, glaze(jarColors[Math.floor(rand() * jarColors.length)]), 0, y + .1, z + .08, .065, .065, .17, 14)
        z += .16
      } else z += .14
    }
    if (index === 3) cylinder(rack, standard(0x7e8e8a), 0, y + .14, .9, .1, .12, .25, 16)
  }
  for (const [x, y, z, w, h, d, turn] of [[-1.35, .2, 6.72, .7, .4, .55, .05], [-1.1, .58, 6.72, .6, .36, .5, -.12],
    [-1.75, .17, 6.4, .45, .34, .45, .3]]) {
    box(ground, cardboard, x, y, z, w, h, d, .015).rotation.y = turn
  }
  const bike = group(ground, -1, 0, 4.6)
  const frame = standard(0x5d8a8c, { roughness: .45, metalness: .2 })
  const tyre = standard(0x2f3133, { roughness: .8 })
  for (const z of [-.55, .55]) {
    mesh(bike, new T.TorusGeometry(.32, .025, 8, 32), tyre, 0, .34, z).rotation.y = PI / 2
    cylinder(bike, chrome, 0, .34, z, .03, .03, .06, 10).rotation.z = PI / 2
  }
  for (const [a, b] of [[[0, .34, -.55], [0, .7, -.1]], [[0, .7, -.1], [0, .72, .45]], [[0, .34, -.55], [0, .38, .05]],
    [[0, .38, .05], [0, .7, -.1]], [[0, .38, .05], [0, .72, .45]], [[0, .72, .45], [0, .34, .55]], [[0, .72, .45], [0, .92, .5]]]) {
    const start = new T.Vector3(...a)
    const end = new T.Vector3(...b)
    const bar = cylinder(bike, frame, ...start.clone().lerp(end, .5).toArray(), .018, .018, start.distanceTo(end), 8)
    bar.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), end.sub(start).normalize())
  }
  box(bike, standard(0x4a3a30), 0, .74, -.18, .1, .04, .24, .015)
  box(bike, tyre, 0, .93, .5, .5, .03, .03, .01)
  const broom = group(ground, -.75, 0, 3.05, 0)
  const handle = cylinder(broom, wood, 0, .7, 0, .015, .015, 1.3, 8)
  handle.rotation.x = -.12
  box(broom, standard(0xc9a55c, { roughness: 1 }), 0, .1, .08, .26, .2, .06, .02).rotation.x = -.12
  cylinder(ground, standard(0x8aa7b5, { roughness: .5 }), -.95, .14, 3.2, .15, .12, .28, 18)
  pendant(ground, 0, -1.9, 4.9, groundCeiling, 0xf0dfc0)

  // Bath: a tub under the window, a vanity with a mirror, a toilet in the corner, towels and a mat.
  const tub = group(ground, 1.3, 0, 6.62)
  box(tub, white, 0, .3, 0, 1.58, .58, .78, .12)
  box(tub, standard(0xbfdde0, { roughness: .1 }), 0, .54, 0, 1.38, .02, .58, .01, false)
  cylinder(tub, chrome, .62, .66, .3, .025, .025, .18, 10)
  box(tub, chrome, .62, .74, .24, .03, .03, .14, .01)
  const towels = [0xe9b8a8, 0xb9d3c8, 0xf3e6cc]
  for (const [index, x] of [.6, 1.25].entries()) {
    box(ground, fabric(towels[index]), x, .82, 7.03, .42, .55, .035, .015)
  }
  box(ground, chrome, .92, 1.1, 7.04, 1.2, .025, .025, .01)
  const vanity = group(ground, -.1, 0, 4.3)
  box(vanity, standard(0xd7c3a6, { roughness: .7 }), 0, .4, 0, .52, .8, .88, .02)
  for (const z of [-.2, .2]) box(vanity, brass, .27, .6, z, .015, .02, .14, .005)
  box(vanity, white, .02, .83, 0, .55, .07, .9, .02)
  cylinder(vanity, standard(0xe8f0ef, { roughness: .2 }), .05, .86, 0, .2, .17, .04, 24)
  cylinder(vanity, chrome, -.18, .95, 0, .02, .02, .18, 10)
  box(vanity, chrome, -.12, 1.03, 0, .13, .025, .025, .008)
  // The mirror hangs on the wall above (so it goes with the wall when the wall is cut).
  const mirror = group(ground, -.37, 1.6, 4.3)
  box(mirror, standard(0xd7c3a6), 0, 0, 0, .04, .78, .58, .015)
  box(mirror, standard(0xdfeef0, { roughness: .05, metalness: .3 }), .025, 0, 0, .01, .7, .5, .01, false)
  const toilet = group(ground, -.08, 0, 6.6)
  cylinder(toilet, white, .04, .2, 0, .17, .14, .4, 22)
  cylinder(toilet, white, .06, .42, 0, .21, .19, .05, 22).scale.x = 1.15
  box(toilet, white, -.2, .6, 0, .16, .38, .42, .03)
  cylinder(ground, chrome, .5, .55, 6.95, .012, .012, .2, 8)
  rug(ground, .8, .055, 5.4, 1, .6, 0xa9c8c4)
  plant(ground, 2, .055, 3.1, .8, 0xe2d7c4)
  pendant(ground, 0, .9, 4.9, groundCeiling, 0xf6e7cf, [2.4, 4])

  // Entry: the shoe cabinet, a bench, a coat rack by the door, a mat and an umbrella stand.
  const shoes = group(ground, 4.9, 0, 5.6)
  box(shoes, wood, 0, .5, 0, .43, 1, 1.48, .02)
  for (const z of [-.37, .37]) {
    box(shoes, standard(0xe8d8c0), -.22, .5, z, .015, .9, .7, .01)
    box(shoes, brass, -.24, .5, z + (z < 0 ? .28 : -.28), .02, .12, .02, .005)
  }
  cylinder(shoes, glaze(0x6f9bb0), 0, 1.13, -.4, .07, .05, .26, 16)
  for (const [z, color] of [[.1, 0xb4846a], [.35, 0x6b5f57]]) box(shoes, standard(color), 0, 1.04, z, .1, .08, .26, .03)
  const bench = group(ground, 4.9, 0, 4.1)
  box(bench, wood, 0, .4, 0, .42, .06, 1.08, .02)
  for (const z of [-.45, .45]) box(bench, darkWood, 0, .19, z, .36, .38, .05, .01)
  box(bench, fabric(0xc7826b), 0, .46, 0, .38, .06, .9, .03)
  for (const [z, color] of [[-.2, 0x8a5a44], [.25, 0xd7c7b0]]) {
    const pair = group(ground, 4.62, 0, 4.1 + z)
    for (const side of [-.06, .06]) box(pair, standard(color), 0, .05, side, .26, .1, .1, .04)
  }
  const coats = group(ground, 2.6, 0, 6.75)
  cylinder(coats, darkWood, 0, .9, 0, .025, .03, 1.8, 10)
  cylinder(coats, darkWood, 0, .03, 0, .2, .22, .06, 18)
  for (const [index, color] of [0xc27b5f, 0x5f7f8c, 0xe2c79a].entries()) {
    const angle = index * 2.1 + .4
    const coat = mesh(coats, new T.CapsuleGeometry(.13, .5, 6, 12), fabric(color), Math.cos(angle) * .15, 1.32, Math.sin(angle) * .15)
    coat.scale.z = .55
    coat.rotation.y = -angle
  }
  mesh(coats, new T.SphereGeometry(.14, 16, 10), fabric(0xd8b25a), .1, 1.72, -.1).scale.y = .45
  rug(ground, 3.75, .055, 6.75, 1, .55, 0x9a6f55)
  const umbrellas = group(ground, 4.55, 0, 6.88)
  cylinder(umbrellas, glaze(0x7a9a8a), 0, .22, 0, .12, .1, .44, 18)
  for (const [x, color, tilt] of [[-.03, 0x3e5d75, .1], [.04, 0xc65b4a, -.12]]) {
    const umbrella = cylinder(umbrellas, standard(color), x, .5, 0, .03, .05, .75, 10)
    umbrella.rotation.z = tilt
  }
  pendant(ground, 0, 3.75, 4.9, groundCeiling, 0xf6d3a5, [2.8, 4.6])

  // Laundry: washer and dryer under a shelf, a sink, a drying rack with clothes, a basket.
  for (const [x, glass] of [[9.55, 0x9fc3cf], [8.85, 0xd9d3c4]]) {
    const machine = group(ground, x, 0, 6.72, PI)
    box(machine, white, 0, .45, 0, .62, .88, .6, .04)
    box(machine, standard(0xd8dcdc), 0, .82, .3, .56, .1, .01, .005)
    mesh(machine, new T.TorusGeometry(.17, .025, 8, 28), chrome, 0, .42, .31)
    mesh(machine, new T.CircleGeometry(.16, 28), standard(glass, { roughness: .15 }), 0, .42, .305, false)
    cylinder(machine, standard(0x8c9596), .18, .82, .31, .025, .025, .02, 12).rotation.x = PI / 2
  }
  box(ground, wood, 9.2, 1.45, 6.95, 1.4, .04, .3, .01)
  for (const [x, color, h] of [[8.7, 0x7fb7c9, .24], [8.9, 0xf2c1b6, .2], [9.6, 0xd7e3a6, .26], [9.75, 0xf3efe6, .18]]) {
    box(ground, standard(color), x, 1.47 + h / 2, 6.95, .13, h, .1, .03)
  }
  const sink = group(ground, 9.6, 0, 4.5)
  box(sink, standard(0xb7c9c6), 0, .42, 0, .53, .84, .98, .02)
  box(sink, white, 0, .87, 0, .55, .06, 1, .02)
  box(sink, standard(0xdde6e6, { roughness: .2 }), -.02, .88, 0, .4, .03, .6, .01, false)
  cylinder(sink, chrome, .2, .98, 0, .018, .018, .2, 10)
  box(sink, chrome, .13, 1.07, 0, .15, .025, .025, .008)
  const rack2 = group(ground, 6.9, 0, 5, 0)
  for (const x of [-.75, .75]) for (const z of [-.22, .22]) {
    const leg = cylinder(rack2, chrome, x, .67, z * .5, .012, .012, 1.36, 8)
    leg.rotation.x = z > 0 ? .17 : -.17
  }
  const clothes = [0xe7a99a, 0x9cc0d6, 0xf2e2b8, 0xb5cfa6, 0xffffff]
  for (const [index, y] of [1.33, 1.1, .86].entries()) {
    for (const z of [-.18, .18]) {
      box(rack2, chrome, 0, y, z * (1 - index * .15), 1.56, .012, .012, 0, false)
    }
    for (let i = 0; i < 3; i++) {
      const x = -.55 + i * .5 + index * .1
      const cloth = box(rack2, fabric(clothes[(i + index * 2) % clothes.length], { side: T.DoubleSide }), x, y - .17, 0, .3, .34, .02, .01)
      cloth.rotation.y = .05 * (i - 1)
    }
  }
  const basket = group(ground, 6, 0, 6.6)
  cylinder(basket, standard(0xc49a62, { roughness: .95 }), 0, .2, 0, .26, .22, .4, 22)
  mesh(basket, new T.SphereGeometry(.22, 16, 8), fabric(0xe6d8c6), 0, .38, 0).scale.y = .4
  pendant(ground, 0, 7.6, 4.9, groundCeiling, 0xeef0e6)

  // Closet: a long wardrobe, a dressing table with a mirror and a stool, a standing mirror, a round rug.
  const wardrobe = group(upper, -2.85, lifted, 4.9)
  box(wardrobe, standard(0xf0e4d6, { roughness: .7 }), 0, 1, 0, .58, 2, 2.98, .03)
  for (const z of [-1, 0, 1]) {
    box(wardrobe, standard(0xe6d5c2, { roughness: .7 }), .295, 1, z, .015, 1.86, .94, .01)
    for (const side of [-1, 1]) box(wardrobe, brass, .31, 1.05, z + side * .08, .02, .2, .02, .005)
  }
  box(wardrobe, wood, 0, .04, 0, .6, .08, 3, .01)
  const dresser = group(upper, -.9, lifted, 6.8, PI)
  box(dresser, wood, 0, .74, 0, .95, .05, .44, .015)
  box(dresser, wood, 0, .58, -.02, .9, .26, .4, .015)
  for (const x of [-.43, .43]) box(dresser, darkWood, x, .36, 0, .05, .72, .4, .01)
  box(dresser, standard(0xdfeef0, { roughness: .05, metalness: .3 }), 0, 1.28, .2, .55, .75, .02, .02)
  box(dresser, wood, 0, 1.28, .21, .62, .82, .015, .01)
  for (const [x, color] of [[-.3, 0xf2b8c6], [-.18, 0xb9a6e8], [.3, 0xffd27a]]) cylinder(dresser, glaze(color), x, .83, .05, .03, .035, .12, 12)
  const stool = group(upper, -.9, lifted, 6.25)
  cylinder(stool, fabric(0xd9a1a0), 0, .45, 0, .2, .2, .08, 22)
  for (const angle of [0, 2.1, 4.2]) cylinder(stool, darkWood, Math.cos(angle) * .13, .21, Math.sin(angle) * .13, .015, .015, .42, 8)
  const glass = group(upper, -.55, lifted, 3.6, -PI / 2)
  box(glass, wood, 0, .85, 0, .5, 1.7, .05, .02)
  box(glass, standard(0xdfeef0, { roughness: .05, metalness: .3 }), 0, .87, .03, .42, 1.58, .01, .01, false)
  rug(upper, -1.5, lifted, 5, 1.6, 1.6, 0xe9c8c0, true)
  pendant(upper, 1, -1.75, 4.9, upperCeiling, 0xf3d9d0)

  // Balcony: a small table with two chairs, a lounger, pots along the railing, a lantern.
  const table = group(upper, 2.2, lifted, 5.6)
  cylinder(table, standard(0xe8e2d4), 0, .7, 0, .36, .36, .04, 28)
  cylinder(table, darkWood, 0, .35, 0, .03, .04, .7, 10)
  cylinder(table, darkWood, 0, .02, 0, .2, .22, .04, 18)
  for (const side of [-1, 1]) {
    const chair = group(table, 0, 0, side * .58, side > 0 ? PI : 0)
    box(chair, standard(0x6f8f7a), 0, .44, 0, .4, .04, .38, .02)
    box(chair, standard(0x6f8f7a), 0, .72, -.18, .4, .5, .03, .015)
    for (const [x, z] of [[-.17, -.16], [.17, -.16], [-.17, .16], [.17, .16]]) cylinder(chair, darkWood, x, .22, z, .015, .015, .44, 8)
  }
  cylinder(table, glaze(0xe9b8a8), .1, .77, .05, .045, .04, .1, 14)
  const lounger = group(upper, .35, lifted, 4.7)
  box(lounger, wood, 0, .28, .15, .62, .06, 1.25, .02)
  const back = box(lounger, wood, 0, .5, -.6, .62, .06, .55, .02)
  back.rotation.x = .9
  box(lounger, fabric(0xf2e2b8), 0, .33, .15, .56, .06, 1.15, .03)
  for (const [x, z] of [[-.27, .7], [.27, .7], [-.27, -.4], [.27, -.4]]) box(lounger, darkWood, x, .13, z, .04, .26, .04, .01)
  for (const [x, size, color] of [[-.05, 1, 0xb7755f], [.55, .75, 0xd6a77a], [3, .9, 0x8c9f86]]) plant(upper, x, lifted, 6.85, size, color)
  pendant(upper, 1, 1.5, 4.9, upperCeiling, 0xf6d3a5)

  // Art studio: an easel with a painting, the painting desk under the window, an armchair, a paint cabinet, canvases.
  const easel = group(upper, 4.6, lifted, 5.3, -.5)
  for (const [x, tilt] of [[-.28, .12], [.28, -.12]]) {
    const leg = box(easel, wood, x, .8, 0, .04, 1.62, .04, .01)
    leg.rotation.z = tilt
  }
  const prop = box(easel, wood, 0, .7, -.25, .04, 1.4, .04, .01)
  prop.rotation.x = -.35
  box(easel, wood, 0, .62, .04, .7, .04, .08, .01)
  const canvas = new T.CanvasTexture(paintingCanvas())
  canvas.colorSpace = T.SRGBColorSpace
  box(easel, standard(0xf4efe4), 0, 1.02, .05, .62, .72, .03, .005)
  mesh(easel, new T.PlaneGeometry(.58, .68), standard(0xffffff, { map: canvas, roughness: .9 }), 0, 1.02, .068, false)
  const studioDesk = group(upper, 9.45, lifted, 5.3, -PI / 2)
  box(studioDesk, wood, 0, .74, 0, 1.58, .05, .88, .015)
  for (const x of [-.74, .74]) box(studioDesk, darkWood, x, .36, 0, .06, .72, .82, .01)
  for (const [x, color] of [[-.55, 0x6b8e9e], [-.4, 0xd4a766], [-.25, 0xbe695b]]) {
    cylinder(studioDesk, glaze(color), x, .82, -.2, .045, .04, .12, 12)
    for (let i = 0; i < 3; i++) {
      const brush = cylinder(studioDesk, darkWood, x + (i - 1) * .015, .92, -.2, .006, .006, .2, 6)
      brush.rotation.z = (i - 1) * .2
    }
  }
  box(studioDesk, standard(0xf4efe4), .3, .78, .05, .6, .01, .42, .005, false)
  for (const [x, z, color] of [[.15, 0, 0xc65b4a], [.32, .1, 0x437a72], [.45, -.05, 0xffd27a]]) {
    cylinder(studioDesk, standard(color), x, .79, z, .03, .03, .01, 12)
  }
  const armchair = group(upper, 3.85, lifted, 6.55, PI - .4)
  const cloth = fabric(0x8fae9c)
  box(armchair, cloth, 0, .3, 0, .8, .3, .74, .08)
  box(armchair, cloth, 0, .62, -.31, .8, .55, .14, .06)
  for (const x of [-.36, .36]) box(armchair, cloth, x, .5, 0, .1, .3, .74, .04)
  box(armchair, fabric(0xf2e2b8), .1, .5, -.18, .32, .26, .1, .05).rotation.z = .2
  const cabinet = group(upper, 4.3, lifted, 3.02)
  box(cabinet, wood, 0, .7, 0, 1.58, 1.4, .48, .02)
  for (const [index, y] of [.25, .7, 1.15].entries()) {
    box(cabinet, standard(0xe6d5c2), 0, y, .245, 1.5, .38, .01, .008)
    box(cabinet, brass, 0, y, .26, .2, .02, .02, .005)
    if (index === 2) for (let i = 0; i < 5; i++) {
      cylinder(cabinet, glaze([0xbe695b, 0x437a72, 0xd4a766, 0x6b8e9e, 0x8b6f9e][i]), -.6 + i * .3, 1.46, 0, .05, .05, .12, 12)
    }
  }
  for (const [x, z, w, h, turn] of [[9.85, 3.4, .7, .9, -PI / 2], [9.83, 3.95, .55, .7, -PI / 2]]) {
    const leaning = box(upper, standard(0xf4efe4), x, lifted + h / 2, z, w, h, .03, .005)
    leaning.rotation.set(0, turn, 0)
    leaning.rotateX(-.12)
  }
  rug(upper, 5.5, lifted, 5.4, 2.6, 1.8, 0xc7b29a)
  pendant(upper, 1, 6.6, 4.9, upperCeiling, 0xf6d3a5, [2.4, 4.4])

  return { lamps, pendants }
}

// A little landscape on the easel.
function paintingCanvas() {
  const canvas = document.createElement("canvas")
  canvas.width = 232
  canvas.height = 272
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#f3e3c3"
  ctx.fillRect(0, 0, 232, 272)
  ctx.fillStyle = "#f0a37f"
  ctx.beginPath()
  ctx.arc(150, 80, 34, 0, PI * 2)
  ctx.fill()
  for (const [color, points] of [["#8fb29b", [[0, 190], [70, 120], [140, 185], [232, 130], [232, 272], [0, 272]]],
    ["#4f7f6f", [[0, 230], [90, 180], [180, 225], [232, 205], [232, 272], [0, 272]]]]) {
    ctx.fillStyle = color
    ctx.beginPath()
    for (const [x, y] of points) ctx.lineTo(x, y)
    ctx.fill()
  }
  return canvas
}
