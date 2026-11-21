// Furnishing for the rooms around the living room (cottage redesign step 4). Everything sits inside the slots
// from cottage-layout.mjs, so a later feature can replace a piece without moving anything else.
// Each room also gets a lamp that comes on by itself after dark.
import * as T from "./engine/three.module.min.js"

const PI = Math.PI

function sampler(seed) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
}

export function furnishHouse(scene, kit, { ground, upper, lifted }) {
  const { box, cylinder, mesh, group, standard, fabric, glaze, wood, darkWood } = kit
  const rand = sampler(311)
  const lamps = []
  const steam = []
  const ceramic = color => glaze(color)
  const brass = standard(0xb08457, { metalness: .3, roughness: .42 })
  const paper = standard(0xf1e4c8)
  const leafColors = [0x4f8763, 0x6f9a68, 0x3f6d58].map(color => standard(color, { side: T.DoubleSide }))
  // A lamp: a warm light in the scene root (so hiding a storey never changes the light count) and a glowing shade.
  const lamp = (storey, position, shade, strength, distance) => {
    const light = new T.PointLight(0xffb36b, 0, distance, 1.7)
    light.position.copy(position)
    scene.add(light)
    lamps.push({ storey, light, shade, strength })
  }
  const glowShade = (color = 0xf6d3a5) => standard(color, { emissive: 0xffa85c, emissiveIntensity: 0, side: T.DoubleSide })
  const books = (parent, x, y, z, width, depth, seed) => {
    const shelfRand = sampler(seed)
    const colors = [0x437a72, 0xbe695b, 0xd4a766, 0xe0c6a2, 0x6b8e9e, 0x8b6f9e]
    let cursor = x - width / 2 + .03
    while (cursor < x + width / 2 - .08) {
      const thick = .045 + shelfRand() * .04
      const tall = .2 + shelfRand() * .1
      const book = box(parent, standard(colors[Math.floor(shelfRand() * colors.length)]), cursor + thick / 2, y + tall / 2, z, thick - .006, tall, depth, .006)
      if (shelfRand() < .12) book.rotation.z = .2
      cursor += thick + (shelfRand() < .15 ? .06 : 0)
    }
  }
  const pottedPlant = (parent, x, y, z, size, potColor) => {
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

  // Kitchen: open shelves, things on the counter and table, notes on the fridge, a pendant over the table.
  const shelves = group(ground, 5.1, 0, -2.37)
  for (const y of [1.92, 2.38]) {
    box(shelves, wood, 0, y, 0, 1.5, .04, .26, .01)
    for (const x of [-.62, .62]) box(shelves, darkWood, x, y - .07, -.06, .04, .1, .12, .008)
  }
  for (const [x, color] of [[-.55, 0xe6c99a], [-.4, 0xa9c3b4], [-.25, 0xdf9d86]]) {
    cylinder(shelves, ceramic(color), x, 2.0, 0, .05, .045, .12, 16)
  }
  for (const [x, color, h] of [[.1, 0xf0e2c4, .2], [.25, 0xd7b98c, .16], [.4, 0xc4d7cb, .22]]) {
    cylinder(shelves, glaze(color, { transparent: true, opacity: .85 }), x, 1.94 + h / 2, 0, .055, .055, h, 18)
    cylinder(shelves, wood, x, 1.95 + h, 0, .058, .058, .025, 18)
  }
  books(shelves, .3, 2.4, 0, .6, .17, 41)
  for (const [x, color] of [[-.5, 0xb85f52], [-.3, 0x5f8f7f]]) {
    const plate = cylinder(shelves, ceramic(color), x, 2.53, -.05, .1, .1, .015, 24)
    plate.rotation.x = PI / 2 - .2
  }
  const counterTop = .91
  const kettle = group(ground, 4.35, counterTop, -2.3)
  cylinder(kettle, glaze(0xd9805f), 0, .1, 0, .09, .11, .2, 24)
  mesh(kettle, new T.SphereGeometry(.09, 18, 10, 0, PI * 2, 0, PI / 2), glaze(0xd9805f), 0, .2, 0)
  cylinder(kettle, darkWood, 0, .3, 0, .02, .02, .03, 10)
  const spout = cylinder(kettle, glaze(0xd9805f), .12, .14, 0, .015, .025, .14, 10)
  spout.rotation.z = -.9
  box(ground, wood, 4.95, counterTop + .015, -2.25, .42, .03, .28, .01)
  for (const [x, color] of [[4.88, 0xd4523f], [5.0, 0xf0c84e], [4.95, 0x7aa65a]]) {
    mesh(ground, new T.SphereGeometry(.045, 14, 10), standard(color, { roughness: .5 }), x, counterTop + .075, -2.22 + (x - 4.95))
  }
  const bowl = group(ground, 4.75, .755, .65)
  mesh(bowl, new T.SphereGeometry(.14, 22, 10, 0, PI * 2, PI / 2, PI / 2), ceramic(0xe8dcc6), 0, .1, 0).scale.y = .7
  for (const [x, z, color] of [[-.05, 0, 0xe07a3f], [.05, .03, 0xd4523f], [0, -.05, 0xe9c34c]]) {
    mesh(bowl, new T.SphereGeometry(.045, 12, 8), standard(color, { roughness: .5 }), x, .09, z)
  }
  const vase = group(ground, 5.15, .755, .78)
  cylinder(vase, glaze(0x8db3b0), 0, .08, 0, .035, .05, .16, 16)
  for (const [x, z, color] of [[-.03, 0, 0xf1d36b], [.03, .02, 0xf2b2b0], [0, -.03, 0xffffff]]) {
    cylinder(vase, standard(0x5f8a5c), x * .5, .2, z * .5, .004, .004, .12, 6)
    mesh(vase, new T.SphereGeometry(.024, 10, 8), standard(color), x, .27, z)
  }
  for (const [x, y, color] of [[3.58, 1.5, 0xe9c06a], [3.82, 1.35, 0xf2b2b0], [3.66, 1.05, 0x9fc6b5], [3.88, 1.62, 0xbfd3ea]]) {
    box(ground, standard(color), x, y, -1.85, .11, .11, .012, .002, false).rotation.z = (rand() - .5) * .3
  }
  const pendantY = 2.25
  cylinder(ground, darkWood, 4.9, (pendantY + 3.43) / 2 + .1, .7, .006, .006, 3.43 - pendantY - .2, 6)
  const pendantShade = glowShade(0xe8c9a0)
  const pendant = mesh(ground, new T.CylinderGeometry(.09, .26, .2, 28, 1, true), pendantShade, 4.9, pendantY, .7, false)
  mesh(ground, new T.SphereGeometry(.055, 14, 10), new T.MeshBasicMaterial({ color: 0xffe2b0 }), 4.9, pendantY - .06, .7, false)
  pendant.castShadow = false
  lamp(0, new T.Vector3(4.9, pendantY - .15, .7), pendantShade, 3.4, 4.6)
  // A woven runner between the doorway and the table.
  const runner = mesh(ground, new T.PlaneGeometry(1.4, .8), fabric(0xc98f6f, { roughness: 1 }), 4.85, .045, 1.85, false)
  runner.rotation.x = -PI / 2

  // Porch: a bench, a planter box, the mailbox and a lantern on the pergola.
  const deck = .2
  const bench = group(ground, 8.5, deck, -.82)
  box(bench, wood, 0, .42, 0, 1.5, .06, .42, .015)
  for (const y of [.62, .78]) box(bench, wood, 0, y, -.19, 1.5, .09, .03, .01)
  for (const x of [-.68, .68]) {
    box(bench, darkWood, x, .21, .14, .06, .42, .06, .01)
    box(bench, darkWood, x, .45, -.19, .06, .9, .06, .01)
  }
  box(bench, fabric(0xe0b06b), -.35, .48, .02, .38, .07, .34, .03)
  const planter = group(ground, 8.7, deck, 1.7)
  box(planter, darkWood, 0, .16, 0, 1.36, .32, .62, .02)
  box(planter, standard(0x4e3a2a), 0, .31, 0, 1.28, .02, .54, 0)
  const petals = [0xf2b2b0, 0xf1d36b, 0xffffff, 0xd98aa8, 0xb9c6f0].map(color => standard(color))
  for (let i = 0; i < 16; i++) {
    const x = -.55 + (i % 8) * .157 + (rand() - .5) * .05
    const z = (i < 8 ? -.13 : .13) + (rand() - .5) * .06
    const h = .15 + rand() * .15
    cylinder(planter, standard(0x5f8a5c), x, .32 + h / 2, z, .006, .006, h, 6)
    mesh(planter, new T.SphereGeometry(.035, 10, 8), petals[i % petals.length], x, .33 + h, z)
  }
  const mailbox = group(ground, 9.6, deck, 2.3)
  box(mailbox, darkWood, 0, .38, 0, .07, .76, .07, .01)
  box(mailbox, glaze(0x5f8f7f), 0, .86, 0, .32, .2, .22, .04)
  box(mailbox, standard(0xc65b4a), .17, .92, .05, .015, .12, .03, .004)
  const lanternShade = glowShade(0xffe1b0)
  const lantern = group(ground, 8.25, 0, 2.53)
  cylinder(lantern, darkWood, 0, 2.6, 0, .005, .005, .16, 6)
  box(lantern, darkWood, 0, 2.5, 0, .16, .03, .16, .01)
  box(lantern, lanternShade, 0, 2.38, 0, .12, .2, .12, .01, false)
  box(lantern, darkWood, 0, 2.27, 0, .16, .03, .16, .01)
  lamp(0, new T.Vector3(8.25, 2.3, 2.45), lanternShade, 4, 4.5)

  // Bedroom: nightstand and lamp, wardrobe, photos on the left wall, a rug and a plant.
  const night = group(upper, -.25, lifted, -2.2)
  box(night, wood, 0, .26, 0, .48, .5, .42, .02)
  box(night, darkWood, 0, .32, .215, .4, .015, .01, 0, false)
  cylinder(night, brass, 0, .53, 0, .06, .07, .03, 16)
  cylinder(night, brass, 0, .63, 0, .012, .012, .2, 8)
  const bedShade = glowShade(0xf3d5c0)
  mesh(night, new T.CylinderGeometry(.08, .13, .16, 24, 1, true), bedShade, 0, .76, 0, false)
  box(night, paper, .14, .52, .05, .12, .025, .16, .004)
  lamp(1, new T.Vector3(-.25, lifted + .72, -2.15), bedShade, 2.6, 4)
  const wardrobe = group(upper, -2.85, lifted, 1.3)
  box(wardrobe, standard(0xe6d8c3), 0, .98, 0, .58, 1.96, 1.56, .03)
  box(wardrobe, standard(0xd8c7ae), .292, .98, -.39, .01, 1.8, .74, .01)
  box(wardrobe, standard(0xd8c7ae), .292, .98, .39, .01, 1.8, .74, .01)
  for (const z of [-.06, .06]) box(wardrobe, brass, .31, 1.05, z, .025, .18, .025, .008)
  for (const [y, z, w, h, color] of [[5.02, -.85, .32, .4, 0xd9a07f], [5.12, -.4, .38, .3, 0x7fa39a], [4.72, -.6, .28, .22, 0xe7c88d]]) {
    const frame = box(upper, darkWood, -3.13, y + .12, z, .03, h, w, .01, false)
    box(upper, standard(color), -3.11, y + .12, z, .01, h - .06, w - .06, 0, false)
    frame.castShadow = false
  }
  const rug = mesh(upper, new T.CircleGeometry(.85, 48), fabric(0xd9b3a6, { roughness: 1 }), -1.6, lifted + .006, .4, false)
  rug.rotation.x = -PI / 2
  rug.scale.y = .7
  pottedPlant(upper, -.05, lifted, 1.85, 1.6, 0xc4846f)
  const pouf = mesh(upper, new T.SphereGeometry(.22, 20, 12), fabric(0xb9c9d8), .25, lifted + .16, 1.55)
  pouf.scale.y = .72

  // Study: laptop, desk lamp and mug; bookshelf; cork board; telescope by the window; a bean bag.
  const deskTop = lifted + .765
  const laptop = group(upper, 3.1, deskTop, -2.25)
  box(laptop, standard(0xc9ccd0, { metalness: .3, roughness: .4 }), 0, .01, .08, .4, .015, .27, .006)
  const screen = box(laptop, standard(0xc9ccd0, { metalness: .3, roughness: .4 }), 0, .14, -.07, .4, .26, .012, .006)
  screen.rotation.x = -.2
  box(laptop, new T.MeshBasicMaterial({ color: 0x9fc2d6 }), 0, .14, -.062, .36, .22, .002, 0, false).rotation.x = -.2
  const deskLamp = group(upper, 2.45, deskTop, -2.35)
  cylinder(deskLamp, darkWood, 0, .015, 0, .08, .09, .03, 18)
  const arm = cylinder(deskLamp, brass, .05, .2, 0, .01, .01, .38, 8)
  arm.rotation.z = -.25
  const deskShade = glowShade(0xe9c07c)
  const head = mesh(deskLamp, new T.CylinderGeometry(.03, .09, .12, 20, 1, true), deskShade, .12, .38, .05, false)
  head.rotation.x = .5
  lamp(1, new T.Vector3(2.6, deskTop + .3, -2.2), deskShade, 2.4, 3.6)
  const mug = group(upper, 3.6, deskTop, -2.1)
  cylinder(mug, glaze(0xe4c486), 0, .055, 0, .045, .04, .11, 18)
  steam.push(new T.Vector3(3.6, deskTop + .13, -2.1))
  const shelf = group(upper, 4.8, lifted, -2.35)
  for (const x of [-.68, .68]) box(shelf, darkWood, x, .9, 0, .04, 1.8, .38, .01)
  box(shelf, darkWood, 0, .9, -.18, 1.36, 1.8, .02, 0)
  for (const y of [.04, .46, .88, 1.3, 1.76]) box(shelf, wood, 0, y, 0, 1.36, .035, .38, .008)
  for (const [y, seed] of [[.06, 3], [.48, 7], [.9, 11], [1.32, 19]]) books(shelf, 0, y, .02, 1.3, .26, seed)
  const board = group(upper, 3, 0, -2.5)
  box(board, standard(0xc69c6d, { roughness: 1 }), 0, 5.22, 0, 1.25, .75, .03, .01, false)
  box(board, darkWood, 0, 5.22, -.005, 1.31, .81, .02, .01, false)
  for (const [x, y, color] of [[-.4, 5.38, 0xfff4c2], [-.1, 5.1, 0xd8ecf4], [.25, 5.33, 0xf9d5d3], [.42, 5.0, 0xe3f1d4], [-.38, 5.02, 0xffffff]]) {
    box(board, standard(color), x, y, .02, .2, .16, .005, 0, false).rotation.z = (rand() - .5) * .25
    mesh(board, new T.SphereGeometry(.012, 8, 6), standard(0xc65b4a), x, y + .06, .03, false)
  }
  const telescope = group(upper, 3.2, lifted, 1.8, -.6)
  const up = new T.Vector3(0, 1, 0)
  for (let i = 0; i < 3; i++) {
    const angle = i * 2 * PI / 3 + .5
    const top = new T.Vector3(0, .86, 0)
    const foot = new T.Vector3(Math.cos(angle) * .3, 0, Math.sin(angle) * .3)
    const leg = cylinder(telescope, darkWood, (top.x + foot.x) / 2, (top.y + foot.y) / 2, (top.z + foot.z) / 2, .012, .016, top.distanceTo(foot), 8)
    leg.quaternion.setFromUnitVectors(up, top.sub(foot).normalize())
  }
  cylinder(telescope, brass, 0, .88, 0, .035, .035, .05, 12)
  const aim = group(telescope, 0, .95, 0)
  aim.rotation.z = -(PI / 2 - .5)
  cylinder(aim, standard(0x3e5d75, { roughness: .4, metalness: .2 }), 0, .05, 0, .06, .045, .95, 22)
  cylinder(aim, brass, 0, .53, 0, .068, .068, .06, 22)
  cylinder(aim, darkWood, 0, -.44, 0, .025, .025, .08, 10)
  const beanBag = mesh(upper, new T.SphereGeometry(.42, 24, 16), fabric(0xd98f5c), 4.6, lifted + .24, 1.4)
  beanBag.scale.set(1, .6, 1)
  const rugStudy = mesh(upper, new T.PlaneGeometry(1.5, 1), fabric(0x9fb39a, { roughness: 1 }), 4.2, lifted + .006, .9, false)
  rugStudy.rotation.x = -PI / 2

  // Living room corner: a woven basket with a folded blanket, ready for a cat later.
  const basket = group(scene, -2.45, .04, 1.95)
  const weave = standard(0xc49a62, { roughness: .95 })
  cylinder(basket, weave, 0, .12, 0, .38, .32, .24, 28).scale.z = .8
  mesh(basket, new T.TorusGeometry(.36, .035, 8, 28), weave, 0, .24, 0).rotation.x = PI / 2
  const blanket = mesh(basket, new T.SphereGeometry(.31, 20, 10), fabric(0xe8d6c0), 0, .2, 0)
  blanket.scale.set(1, .25, .78)

  return { lamps, steam }
}
