import * as T from "./engine/three.module.min.js"
import { RoundedBoxGeometry } from "./engine/three-rounded-box.mjs"

const PI = Math.PI
const standard = (color, options = {}) => new T.MeshStandardMaterial({ color, roughness: .85, ...options })
const unlit = (options) => new T.MeshBasicMaterial(options)

function texture(width, height, draw) {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  draw(canvas.getContext("2d"), width, height)
  const map = new T.CanvasTexture(canvas)
  map.colorSpace = T.SRGBColorSpace
  map.anisotropy = 4
  return map
}

function sampler(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

function woodTexture() {
  return texture(512, 128, (ctx, w, h) => {
    const rand = sampler(18)
    ctx.fillStyle = "#fbecd5"
    ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 320; i++) {
      const y = rand() * h
      const x = rand() * w
      ctx.strokeStyle = `rgba(96,51,30,${rand() * .17})`
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.bezierCurveTo(x + 45, y + rand() * 7 - 3, x + 85, y - 2, x + 150 + rand() * 135, y)
      ctx.stroke()
    }
  })
}

function rugTexture() {
  return texture(768, 512, (ctx, w, h) => {
    const rand = sampler(43)
    ctx.fillStyle = "#cb7969"
    ctx.fillRect(0, 0, w, h)
    for (const [inset, color, line] of [[21, "#e6ae8d", 8], [37, "#f0ce9e", 3], [63, "#b76259", 15], [84, "#e6ae8d", 3]]) {
      ctx.beginPath()
      ctx.ellipse(w / 2, h / 2, w / 2 - inset, h / 2 - inset, 0, 0, 2 * PI)
      ctx.lineWidth = line
      ctx.strokeStyle = color
      ctx.stroke()
    }
    for (let y = 90; y < h - 72; y += 36) {
      for (let x = 100; x < w - 76; x += 34) {
        if (((x - w / 2) / 283) ** 2 + ((y - h / 2) / 156) ** 2 > .92) continue
        ctx.fillStyle = "#dfa188"
        ctx.beginPath()
        ctx.moveTo(x, y - 6)
        ctx.lineTo(x + 4, y)
        ctx.lineTo(x, y + 6)
        ctx.lineTo(x - 4, y)
        ctx.fill()
      }
    }
    for (let i = 0; i < 16000; i++) {
      ctx.fillStyle = i % 2 ? "#fff2d927" : "#60251c24"
      ctx.fillRect(rand() * w, rand() * h, 2 + rand() * 3, 1)
    }
  })
}

const windowPalettes = {
  day: ["#83b8ce", "#f5e2b8", "#fff3cb", "#95b6ad", "#7fa39a", "#5b8980", "#4c796e", "#3d6f63"],
  dusk: ["#716888", "#f6af7e", "#ffdc9f", "#b48b82", "#946f77", "#695b70", "#544f65", "#494255"],
  night: ["#14243c", "#586988", "#e1e9f5", "#586d87", "#425771", "#304761", "#253952", "#1c3047"],
}

function windowTexture(period) {
  const [zenith, horizon, orb, far, mid, near, trees, shade] = windowPalettes[period]
  return texture(1024, 512, (ctx, w, h) => {
    const sky = ctx.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, zenith)
    sky.addColorStop(1, horizon)
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, w, h)
    const circle = (x, y, r, color) => {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x, y, r, 0, 2 * PI)
      ctx.fill()
    }
    circle(732, period === "dusk" ? 292 : 160, period === "night" ? 29 : 37, orb)
    if (period === "night") {
      const random = sampler(112)
      for (let i = 0; i < 34; i++) circle(random() * w, random() * 208, .8 + random() * 1.3, "#c9d9ed")
    }
    const ridge = (color, points) => {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(0, h)
      for (const [x, y] of points) ctx.lineTo(x, y)
      ctx.lineTo(w, h)
      ctx.fill()
    }
    ridge(far, [[0, 355], [152, 248], [307, 332], [452, 208], [652, 351], [830, 275], [1024, 353]])
    ridge(mid, [[0, 384], [144, 344], [275, 386], [427, 311], [576, 386], [765, 341], [1024, 412]])
    ridge(near, [[0, 457], [178, 383], [320, 412], [466, 394], [689, 474], [882, 392], [1024, 427]])
    const rand = sampler(76)
    for (let i = 0; i < 37; i++) {
      const x = rand() * w
      const y = 436 + rand() * 67
      const size = 15 + rand() * 38
      ridgeTree(ctx, x, y, size, i % 3 ? trees : shade)
    }
  })
}

function ridgeTree(ctx, x, y, size, color) {
  ctx.fillStyle = color
  for (let i = 0; i < 3; i++) {
    const base = y - size * i * .25
    const halfWidth = size * (.3 - i * .05)
    ctx.beginPath()
    ctx.moveTo(x, base - size * .72)
    ctx.lineTo(x + halfWidth, base)
    ctx.lineTo(x - halfWidth, base)
    ctx.fill()
  }
}

const picturePaper = "#f6e5c9"

function posterTexture() {
  return texture(320, 400, (ctx, w, h) => {
    ctx.fillStyle = picturePaper
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = "#d2856d"
    ctx.beginPath()
    ctx.arc(206, 113, 48, 0, PI * 2)
    ctx.fill()
    for (const [color, points] of [
      ["#91a99a", [[24, 288], [125, 137], [233, 306]]],
      ["#5a8177", [[68, 314], [193, 190], [296, 300], [296, 350], [24, 350], [24, 323]]],
      ["#344f4a", [[24, 340], [80, 289], [167, 333], [254, 280], [296, 315], [296, 371], [24, 371]]],
    ]) {
      ctx.fillStyle = color
      ctx.beginPath()
      for (const [x, y] of points) ctx.lineTo(x, y)
      ctx.fill()
    }
    ctx.strokeStyle = "#b98f76"
    ctx.lineWidth = 2
    ctx.strokeRect(23, 23, 274, 348)
  })
}

function mesh(parent, geometry, material, x, y, z, shadow = true) {
  const object = new T.Mesh(geometry, material)
  object.position.set(x, y, z)
  object.castShadow = shadow
  object.receiveShadow = material.isMeshStandardMaterial
  parent.add(object)
  return object
}

function box(parent, material, x, y, z, w, h, d, round = 0, shadow = true) {
  const geometry = round ? new RoundedBoxGeometry(w, h, d, 3, round) : new T.BoxGeometry(w, h, d)
  return mesh(parent, geometry, material, x, y, z, shadow)
}

function cylinder(parent, material, x, y, z, top, bottom, h, segments = 28) {
  return mesh(parent, new T.CylinderGeometry(top, bottom, h, segments), material, x, y, z)
}

function group(parent, x, y, z, rotation = 0) {
  const result = new T.Group()
  result.position.set(x, y, z)
  result.rotation.y = rotation
  parent.add(result)
  return result
}

function stem(parent, material, start, end, radius) {
  const a = new T.Vector3(...start)
  const b = new T.Vector3(...end)
  const middle = a.clone().lerp(b, .5)
  const segment = cylinder(parent, material, ...middle, radius * .7, radius, a.distanceTo(b), 8)
  segment.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.sub(a).normalize())
}

function plant(parent, x, y, z, size, potColor) {
  const pot = group(parent, x, y, z)
  pot.scale.setScalar(size)
  const clay = standard(potColor)
  cylinder(pot, clay, 0, .19, 0, .24, .165, .38)
  cylinder(pot, clay, 0, .351, 0, .254, .252, .075)
  cylinder(pot, standard(0x463b2c), 0, .393, 0, .224, .224, .025)
  const greens = [0x477f60, 0x70976c, 0x365f52, 0x8ba474].map(color => standard(color, { side: T.DoubleSide }))
  const rand = sampler(229)
  const stalk = standard(0x658353)
  for (let i = 0; i < 12; i++) {
    const angle = i * 2.399
    const bend = .22 + rand() * .31
    const y = .56 + rand() * .58
    const length = .28 + rand() * .16
    const x = Math.cos(angle) * bend
    const z = Math.sin(angle) * bend
    stem(pot, stalk, [0, .40, 0], [x, y, z], .012)
    const shape = new T.Shape()
    shape.moveTo(0, 0)
    shape.quadraticCurveTo(-length * .46, length * .52, 0, length)
    shape.quadraticCurveTo(length * .46, length * .56, 0, 0)
    const leaf = mesh(pot, new T.ShapeGeometry(shape, 10), greens[i % greens.length], x, y, z)
    leaf.rotation.set(.45 + rand() * .45, -angle, (i % 2 ? 1 : -1) * (.42 + rand() * .48), "YXZ")
  }
}

function shelves(parent, wood, trim) {
  const shelf = group(parent, -3.08, 0, -.36, PI / 2)
  const books = [0x437a72, 0xbe695b, 0xd4a766, 0xe0c6a2, 0x6b8e9e].map(color => standard(color))
  const pages = standard(0xe9dcc0)
  for (const level of [1.23, 2.04]) {
    box(shelf, wood, 0, level, .18, 1.45, .09, .41, .02)
    for (const x of [-.46, .46]) box(shelf, trim, x, level - .13, .13, .05, .2, .19, .01)
    for (let i = 0; level > 2 && i < 6; i++) {
      const x = -.58 + i * .115
      const height = .27 + ((i * 3 + level) % 6) * .027
      box(shelf, books[i % books.length], x, level + .045 + height / 2, .22, .105, height, .235, .015)
      box(shelf, pages, x, level + .045 + height / 2, .342, .063, .026, .007)
    }
    if (level > 2) plant(shelf, .41, level + .05, .2, .45, 0xb16a56)
  }
  const display = group(shelf, 0, 1.278, .23)
  const slots = [-.38, 0, .38].map(x => group(display, x, 0, 0))
  function showGift(index, item) {
    const slot = slots[index]
    for (const child of slot.children.slice()) {
      child.traverse(object => {
        object.geometry?.dispose()
        object.material?.dispose()
      })
      slot.remove(child)
    }
    if (!item) return
    const ceramic = standard(0xd59c75)
    if (item === "tea") {
      mug(slot, 0, 0, 0, 0x6e9e93)
    } else if (item === "plush") {
      const fur = standard(0xc69370)
      const face = standard(0x614135)
      const sphere = (material, x, y, z, radius) => mesh(slot, new T.SphereGeometry(radius, 16, 12), material, x, y, z)
      sphere(fur, 0, .095, 0, .082).scale.y = 1.2
      sphere(fur, 0, .21, 0, .082)
      for (const x of [-.057, .057]) {
        sphere(fur, x, .274, 0, .031)
        sphere(fur, x, .037, .059, .045)
        sphere(face, x * .55, .222, .073, .009)
      }
      sphere(face, 0, .19, .079, .012)
    } else if (item === "flowers") {
      cylinder(slot, standard(0x68948e), 0, .058, 0, .049, .062, .116)
      const stemMaterial = standard(0x53795b)
      for (const [x, y, z] of [[-.055, .23, .02], [.053, .25, .015], [0, .29, -.016]]) {
        stem(slot, stemMaterial, [0, .08, 0], [x, y, z], .007)
        const petals = standard(x < 0 ? 0xdfa39f : 0xf0d99b)
        for (let i = 0; i < 5; i++) {
          const angle = i * 2 * PI / 5
          mesh(slot, new T.SphereGeometry(.021, 10, 8), petals, x + .023 * Math.cos(angle), y + .023 * Math.sin(angle), z)
        }
      }
    } else if (item === "cake") {
      cylinder(slot, ceramic, 0, .012, 0, .109, .101, .024)
      cylinder(slot, standard(0xeeb7ae), 0, .061, 0, .087, .087, .08)
      cylinder(slot, standard(0xf4ded1), 0, .093, 0, .089, .089, .026)
      mesh(slot, new T.SphereGeometry(.028, 14, 10), standard(0xb95159), 0, .124, 0).scale.y = 1.25
    } else {
      const book = item === "book"
      const binding = standard(book ? 0x527f77 : 0x954f56)
      box(slot, binding, 0, .114, 0, .177, .22, .081, .01)
      box(slot, standard(0xe8cf9e), 0, .114, .044, book ? .095 : .152, book ? .124 : .038, .008, .003)
    }
  }
  return { display, slots, showGift }
}

function structure(scene, wood, darkWood, trim) {
  const plaster = standard(0xc8d5be)
  const sidePlaster = standard(0xe3ccbb)
  box(scene, standard(0x60796e), 0, -.25, 0, 6.64, .44, 5.44, .12, false)
  box(scene, darkWood, 0, -.07, 0, 6.51, .12, 5.31, .04, false)
  const plankColors = [0xd5a775, 0xdcb285, 0xcfa070, 0xe0b78a, 0xc79466, 0xd7a878]
    .map(color => standard(color, { map: wood.map }))
  const rand = sampler(85)
  for (let row = 0; row < 14; row++) {
    let start = -3.23
    while (start < 3.2) {
      const end = Math.min(3.23, start + .9 + rand() * 1.55)
      box(scene, plankColors[Math.floor(rand() * plankColors.length)], (start + end) / 2, .01,
        -2.495 + row * .383, end - start - .012, .055, .372, 0, false)
      start = end
    }
  }
  const back = -2.62
  const left = -3.23
  const windowX = -1.04
  box(scene, sidePlaster, left, 1.74, -.35, .18, 3.43, 4.54, .035, false)
  box(scene, trim, left, 3.47, -.35, .21, .09, 4.58, .025)
  box(scene, plaster, -2.93, 1.74, back, .60, 3.43, .18, .02, false)
  box(scene, plaster, 1.92, 1.74, back, 2.64, 3.43, .18, .02, false)
  box(scene, plaster, windowX, .59, back, 3.20, 1.14, .18, 0, false)
  box(scene, plaster, windowX, 3.25, back, 3.20, .41, .18, 0, false)
  box(scene, trim, .01, 3.47, back, 6.53, .09, .22, .025)
  box(scene, trim, -3.109, .13, -.32, .075, .18, 4.44, .014)
  box(scene, trim, .03, .13, -2.49, 6.38, .18, .074, .014)

  const windowGeometry = new T.PlaneGeometry(3.28, 1.98)
  const views = Object.keys(windowPalettes).map((period, index) => {
    const view = unlit({ map: windowTexture(period), transparent: index > 0, opacity: index ? 0 : 1, depthWrite: index === 0 })
    const landscape = mesh(scene, windowGeometry, view, windowX, 2.095, -2.708 + index * .002, false)
    landscape.renderOrder = index
    return landscape
  })
  for (const x of [-2.64, .56]) box(scene, trim, x, 2.10, -2.5, .105, 1.98, .13, .015)
  for (const y of [1.145, 3.045]) box(scene, trim, windowX, y, -2.5, 3.24, .10, .15, .015)
  box(scene, wood, windowX, 1.105, -2.39, 3.43, .085, .37, .026)
  box(scene, trim, windowX, 2.10, -2.555, .075, 1.9, .08, .014)
  box(scene, trim, windowX, 2.27, -2.555, 3.2, .065, .08, .014)
  const rod = cylinder(scene, darkWood, windowX, 3.20, -2.29, .022, .022, 3.65)
  rod.rotation.z = PI / 2

  const fabric = standard(0xe3c5a2, { side: T.DoubleSide })
  const curtains = [-1, 1].map(side => {
    const curtain = group(scene, windowX + side * 1.62, 0, -2.28)
    const geometry = new T.PlaneGeometry(1, 1, 32, 18)
    const points = geometry.attributes.position
    for (let i = 0; i < points.count; i++) {
      const u = points.getX(i) + .5
      const v = points.getY(i) + .5
      points.setXYZ(i, -side * u, 1.27 + 1.89 * v + .052 * Math.sin(u * PI),
        Math.sin(u * PI * 12) * (.026 + .036 * (1 - v)))
    }
    geometry.computeVertexNormals()
    mesh(curtain, geometry, fabric, 0, 0, 0)
    return curtain
  })
  return { views, curtains }
}

function sofaThrow(parent, armX) {
  const weave = texture(128, 256, (ctx, width, height) => {
    ctx.fillStyle = "#c38f83"
    ctx.fillRect(0, 0, width, height)
    for (let x = 0; x < width; x += 3) {
      ctx.fillStyle = x % 2 ? "#fce4cb24" : "#592d2920"
      ctx.fillRect(x, 0, 1, height)
    }
    ctx.fillStyle = "#f4d0b333"
    for (let y = 1; y < height; y += 3) ctx.fillRect(0, y, width, 1)
    ctx.fillStyle = "#ebc3a9"
    ctx.fillRect(0, 4, width, 5)
    ctx.fillRect(0, 13, width, 2)
  })
  const textile = new T.PlaneGeometry(1, 1, 24, 40)
  const positions = textile.attributes.position
  const uv = textile.attributes.uv
  const turnStart = .38
  const radius = .15
  const turnEnd = turnStart + radius * PI / 2
  const length = .93

  function drape(u, v) {
    // A continuous arc follows the arm before the free end hangs down.
    const distance = v * length
    const angle = T.MathUtils.clamp((distance - turnStart) / radius, 0, PI / 2)
    const tail = Math.max(0, distance - turnEnd)
    const fall = tail / (length - turnEnd)
    const fold = Math.sin(u * 11 + v * 1.6) + .30 * Math.sin(u * 22 - v * 3)
    const fullness = .016 + (.013 + .019 * fall) * fold
    const x = armX + u * (.34 + .045 * fall) - .022 + .044 * fall
    const y = .951 - radius * (1 - Math.cos(angle)) - tail + fullness * Math.cos(angle)
      + fall * fall * (.065 * u + .026 * Math.cos(u * 7))
    const z = .426 + Math.min(0, distance - turnStart) + radius * Math.sin(angle)
      + fullness * Math.sin(angle) + .048 * fall * fall
    return [x, y, z]
  }

  for (let i = 0; i < positions.count; i++) {
    positions.setXYZ(i, ...drape(uv.getX(i) - .5, uv.getY(i)))
  }
  textile.computeVertexNormals()
  mesh(parent, textile, standard(0xffffff, { map: weave, roughness: 1, side: T.DoubleSide }), 0, 0, 0)

  const fringeCount = 17
  const fringe = new T.InstancedMesh(new T.CylinderGeometry(.0034, .0023, 1, 5), standard(0xe8c5ab), fringeCount)
  const strand = new T.Object3D()
  const rand = sampler(169)
  for (let i = 0; i < fringeCount; i++) {
    const u = T.MathUtils.lerp(-.475, .475, i / (fringeCount - 1))
    const strandLength = .022 + rand() * .014
    strand.position.set(...drape(u, 1))
    strand.position.y -= strandLength * .46
    strand.rotation.set(-.22 + rand() * .30, 0, u * .3 + rand() * .15)
    strand.scale.y = strandLength
    strand.updateMatrix()
    fringe.setMatrixAt(i, strand.matrix)
  }
  fringe.receiveShadow = true
  parent.add(fringe)
}

function sofa(scene, darkWood) {
  const body = group(scene, -1.135, 0, -1.43)
  const upholstery = standard(0x4a8278)
  const cushion = standard(0x64978b)
  const piping = standard(0x3f6e64)
  for (const x of [-1.15, 1.15]) for (const z of [-.41, .41]) {
    cylinder(body, darkWood, x, .145, z, .067, .049, .22, 14)
  }
  box(body, upholstery, 0, .37, 0, 2.76, .37, 1.18, .14)
  box(body, piping, 0, .48, .555, 2.53, .045, .045, .017)
  const backrest = box(body, upholstery, 0, .88, -.49, 2.67, .90, .33, .15)
  backrest.rotation.x = -.08
  for (const x of [-.55, .55]) {
    box(body, cushion, x, .595, .09, 1.08, .214, .90, .10)
    const back = box(body, cushion, x, .96, -.31, 1.08, .61, .22, .105)
    back.rotation.x = -.14
  }
  for (const x of [-1.255, 1.255]) box(body, upholstery, x, .73, .017, .305, .45, 1.07, .135)
  for (const [x, color, angle] of [[-.88, 0xd7906c, .23], [.84, 0xe1c585, -.28]]) {
    const pillow = box(body, standard(color), x, .904, -.13, .45, .416, .17, .082)
    pillow.rotation.set(-.31, -angle * .5, angle)
  }
  sofaThrow(body, 1.255)
  return body
}

function mug(parent, x, y, z, color) {
  const ceramic = standard(color, { roughness: .37 })
  cylinder(parent, ceramic, x, y + .083, z, .097, .078, .166)
  cylinder(parent, standard(0x51362b), x, y + .168, z, .083, .083, .008)
  const lip = mesh(parent, new T.TorusGeometry(.089, .009, 8, 24), ceramic, x, y + .173, z)
  lip.rotation.x = PI / 2
  mesh(parent, new T.TorusGeometry(.044, .014, 8, 21), ceramic, x + .099, y + .093, z)
}

function coffeeTable(scene, wood, darkWood) {
  const table = group(scene, -.51, 0, .45, -.12)
  for (const [x, z] of [[-.55, -.20], [.55, -.20], [0, .26]]) {
    const leg = cylinder(table, darkWood, x, .212, z, .065, .041, .37, 18)
    leg.rotation.z = -.19 * Math.sign(x)
    leg.rotation.x = .14 * Math.sign(z)
  }
  const top = cylinder(table, wood, 0, .437, 0, .76, .73, .115, 48)
  top.scale.z = .68
  const notebook = group(table, -.28, .50, .033, -.28)
  const cover = standard(0x5c777f)
  box(notebook, cover, 0, .01, 0, .35, .027, .38, .018)
  box(notebook, standard(0xecd6b4), 0, .03, 0, .324, .026, .356, .009)
  const spine = group(notebook, -.175, .052, 0)
  box(spine, cover, .175, 0, 0, .35, .019, .38, .009)
  box(spine, standard(0xe0bc7f), .175, .011, 0, .123, .005, .12, .002)
  box(spine, standard(0xeedfc1), .174, -.012, 0, .322, .008, .356, .003)
  box(notebook, standard(0xf4e8ce), 0, .046, 0, .326, .006, .356, .003)
  cylinder(table, darkWood, .30, .50, -.11, .14, .15, .02)
  mug(table, .30, .51, -.11, 0xe4c486)
  const company = group(table, .34, .50, .19)
  cylinder(company, standard(0x687b67), 0, 0, 0, .14, .145, .02)
  const secondCup = group(company, 0, .01, 0)
  mug(secondCup, 0, 0, 0, 0x7fae9e)
  secondCup.visible = false
  const card = group(table, -.02, .51, -.27, .2)
  const cardFront = box(card, standard(0xffdda6), 0, .083, 0, .25, .161, .017, .006)
  cardFront.rotation.x = -.31
  const fold = box(card, standard(0xf0c888), 0, .076, -.047, .25, .149, .014, .006)
  fold.rotation.x = .42
  box(card, standard(0xb2695b), 0, .104, .014, .115, .016, .008)
  card.visible = false
  return { body: notebook, spine, company, secondCup, card }
}

function calendarOnWall(scene, wood) {
  const calendar = group(scene, 2.84, 2.70, -2.397)
  box(calendar, wood, 0, 0, 0, .57, .74, .053, .018)
  const paper = unlit({ color: 0xf2e8d2 })
  box(calendar, paper, 0, -.013, .032, .514, .665, .018, .005, false)
  const front = group(calendar, 0, .314, .054)
  box(front, paper, 0, -.317, 0, .508, .643, .014, .006, false)
  box(front, unlit({ color: 0x568176 }), 0, -.103, .009, .461, .126, .008, .003, false)
  const ink = unlit({ color: 0xb0a58d })
  for (const y of [-.236, -.327, -.418, -.509]) box(front, ink, 0, y, .009, .389, .004, .005, 0, false)
  for (const x of [-.17, .17]) {
    mesh(calendar, new T.TorusGeometry(.032, .006, 8, 14), standard(0xb09969), x, .309, .065)
  }
  return { body: calendar, front }
}

function projectionScreen(scene, trim) {
  const roller = group(scene, -.19, 3.23, -2.14)
  box(roller, standard(0x426b65), 0, 0, 0, 2.73, .105, .14, .024)
  for (const x of [-1.34, 1.34]) box(roller, trim, x, 0, 0, .095, .13, .16, .017)
  box(roller, standard(0xc6b083), 0, -.080, .02, .087, .046, .035, .006)
  const cloth = unlit({ color: 0xe3e1d0 })
  const rollerBar = standard(0x48625c)
  const width = 2.54, height = 1.45
  const top = group(roller, 0, -.064, .035)
  const screen = group(top, 0, 0, 0)
  box(screen, cloth, 0, -height / 2, 0, width, height, .014, 0, false)
  const bar = box(top, rollerBar, 0, -height, .015, width + .06, .04, .041, .012, false)
  function reveal(amount) {
    screen.visible = bar.visible = amount > 0
    screen.scale.y = Math.max(.001, amount)
    bar.position.y = -height * amount
  }
  reveal(0)
  return { body: roller, top, width, height, reveal }
}

function pocketProjector(scene, wood) {
  const stand = group(scene, 2.21, .04, .85, .67)
  const metal = standard(0x48615c)
  for (const x of [-.18, .18]) box(stand, metal, x, .31, 0, .043, .59, .33, .011)
  box(stand, wood, 0, .61, 0, .49, .068, .37, .023)
  box(stand, standard(0xd4d8c9), 0, .71, 0, .34, .127, .24, .034)
  const lens = cylinder(stand, metal, .077, .708, -.128, .041, .041, .027, 20)
  lens.rotation.x = Math.PI / 2
  const glass = cylinder(stand, standard(0x445a65, { roughness: .22 }), .077, .708, -.145, .030, .030, .009, 20)
  glass.rotation.x = Math.PI / 2
  box(stand, standard(0x6e9f8c), -.098, .777, -.055, .035, .008, .030, .005)
  return stand
}

function consoleCabinet(scene, wood, darkWood, trim) {
  const cabinet = group(scene, 2.08, 0, -1.99)
  for (const x of [-.71, .71]) for (const z of [-.24, .24]) cylinder(cabinet, darkWood, x, .155, z, .046, .034, .24)
  box(cabinet, darkWood, 0, .61, 0, 1.86, .76, .64, .038)
  box(cabinet, wood, 0, 1.015, 0, 1.96, .095, .72, .035)
  for (const x of [-.62, 0, .62]) {
    box(cabinet, wood, x, .61, .34, .565, .64, .075, .021)
    for (let i = 0; i < 7; i++) box(cabinet, darkWood, x - .22 + i * .073, .59, .379, .012, .47, .008, 0)
    box(cabinet, trim, x, .848, .388, .17, .028, .028, .01)
  }
  const record = group(cabinet, -.395, 1.075, 0, .05)
  const charcoal = standard(0x303a37, { roughness: .48 })
  box(record, trim, 0, .072, 0, .88, .14, .56, .03)
  const vinyl = group(record, -.09, 0, 0)
  cylinder(vinyl, charcoal, 0, .156, 0, .232, .232, .042, 64)
  const grooves = texture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#26302e"
    ctx.fillRect(0, 0, w, h)
    for (let radius = 50; radius < 127; radius += 4) {
      ctx.strokeStyle = radius % 3 ? "#37413e" : "#45504a"
      ctx.beginPath()
      ctx.arc(w / 2, h / 2, radius, 0, PI * 2)
      ctx.stroke()
    }
  })
  const surface = mesh(vinyl, new T.CircleGeometry(.231, 64),
    standard(0xffffff, { map: grooves, roughness: .58 }), 0, .178, 0, false)
  surface.rotation.x = -PI / 2
  const label = cylinder(vinyl, standard(0xca7969), 0, .184, 0, .083, .083, .012)
  box(vinyl, trim, 0, .191, .048, .059, .002, .012, 0)
  cylinder(record, trim, -.09, .194, 0, .014, .014, .027)
  cylinder(record, charcoal, .286, .176, -.16, .049, .05, .059)
  stem(record, charcoal, [.286, .21, -.16], [.18, .212, .076], .019)
  box(record, charcoal, .176, .209, .091, .062, .061, .075, .014)
  plant(cabinet, .58, 1.06, .015, .54, 0xc4846f)
  return { body: record, vinyl, label: label.material }
}

function connectLamp(scene, wood, darkWood) {
  const stand = group(scene, .63, 0, -1.435)
  const brass = standard(0xb08457, { metalness: .24, roughness: .45 })
  cylinder(stand, darkWood, 0, .09, 0, .26, .28, .10)
  cylinder(stand, brass, 0, .435, 0, .065, .075, .66)
  cylinder(stand, wood, 0, .81, 0, .35, .33, .073, 42)
  cylinder(stand, brass, 0, .873, 0, .133, .155, .066)
  cylinder(stand, brass, 0, 1.053, 0, .027, .033, .319)
  const shade = standard(0xf1c59b, { emissive: 0xffa85c, emissiveIntensity: 0, side: T.DoubleSide })
  const geometry = new T.LatheGeometry([
    new T.Vector2(.255, 1.17), new T.Vector2(.251, 1.203),
    new T.Vector2(.14, 1.524), new T.Vector2(.134, 1.55),
  ], 50)
  const p = geometry.attributes.position
  for (let i = 0; i < p.count; i++) {
    const angle = Math.atan2(p.getX(i), p.getZ(i))
    const pleat = 1 + .052 * Math.cos(25 * angle)
    p.setXYZ(i, p.getX(i) * pleat, p.getY(i), p.getZ(i) * pleat)
  }
  geometry.computeVertexNormals()
  mesh(stand, geometry, shade, 0, 0, 0, false)
  const rim = standard(0xb48863)
  for (const [radius, y] of [[.251, 1.18], [.135, 1.55]]) {
    const ring = mesh(stand, new T.TorusGeometry(radius, .011, 8, 50), rim, 0, y, 0)
    ring.rotation.x = PI / 2
  }
  const bulb = unlit({ color: 0xbb9572 })
  mesh(stand, new T.SphereGeometry(.075, 18, 12), bulb, 0, 1.28, 0, false)
  const lampLight = new T.PointLight(0xffae62, 0, 4.4, 1.75)
  lampLight.position.set(.63, 1.20, -1.435)
  scene.add(lampLight)
  return { shade, bulb, lampLight }
}

export function buildRoom(scene) {
  const map = woodTexture()
  const wood = standard(0xad7953, { map })
  const darkWood = standard(0x835943, { map })
  const trim = standard(0xf1e1c9)
  const { curtains, views } = structure(scene, wood, darkWood, trim)
  const rugMap = rugTexture()
  const rugGeometry = new T.CircleGeometry(1, 72)
  const rug = mesh(scene, rugGeometry, standard(0xffffff, { map: rugMap }), -.18, .045, .43, false)
  rug.rotation.x = -PI / 2
  rug.scale.set(2, 1.44, 1)
  const rugEdge = cylinder(scene, standard(0xa25c51), -.18, .04, .43, 2.003, 2.003, .018, 72)
  rugEdge.scale.z = .722
  rug.position.y = .052
  const seat = sofa(scene, darkWood)
  const shelf = shelves(scene, wood, trim)
  const notebook = coffeeTable(scene, wood, darkWood)
  scene.updateMatrixWorld(true)
  const record = consoleCabinet(scene, wood, darkWood, trim)
  const calendar = calendarOnWall(scene, darkWood)
  const projector = projectionScreen(scene, trim)
  const projectorDevice = pocketProjector(scene, wood)
  plant(scene, 2.72, .04, .72, 1.22, 0xb7755f)
  const frame = box(scene, darkWood, 1.99, 2.29, -2.483, 1.13, 1.35, .085, .032)
  const paperGeometry = new T.PlaneGeometry(1.013, 1.235)
  mesh(frame, paperGeometry, unlit({ color: picturePaper }), 0, 0, .047, false)
  const print = mesh(frame, paperGeometry, unlit({ map: posterTexture() }), 0, 0, .048, false)
  const picture = {
    print,
    reveal(amount) {
      // The print stays flush with the mat as it settles into the upper half.
      const scale = T.MathUtils.lerp(1, .48, amount)
      print.scale.set(scale, scale, 1)
      print.position.y = .24 * paperGeometry.parameters.height * amount
    },
  }
  box(scene, trim, 2.88, 2.04, -2.476, .39, .42, .066, .018)
  const badge = mesh(scene, new T.CircleGeometry(.123, 28), unlit({ color: 0xb57462 }), 2.88, 2.04, -2.439, false)
  badge.scale.x = .87
  const lamp = connectLamp(scene, wood, darkWood)
  const shadowMap = texture(192, 192, (ctx, w, h) => {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 28, w / 2, h / 2, w / 2)
    gradient.addColorStop(0, "#24494078")
    gradient.addColorStop(.55, "#24494042")
    gradient.addColorStop(1, "#24494000")
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, w, h)
  })
  const shadow = mesh(scene, new T.PlaneGeometry(9.8, 8.3), unlit({ map: shadowMap, transparent: true, depthWrite: false }),
    .22, -.483, .28, false)
  shadow.rotation.x = -PI / 2

  const hits = [
    ["lamp", [.66, .76, .65], [.63, 1.18, -1.435]],
    ["curtains", [3.3, 1.78, .25], [-1.04, 2.21, -2.34]],
    ["record", [1.03, .34, .68], [1.685, 1.218, -1.99]],
    ["picture", [1.20, 1.41, .17], [1.99, 2.29, -2.43]],
    ["notebook", [.47, .17, .36], notebook.body.getWorldPosition(new T.Vector3()).toArray()],
    ["shelf", [.57, .98, 1.42], [-2.88, 1.67, -.36]],
    ["seat", [2.2, .52, .9], [-1.135, .67, -1.38]],
    ["calendar", [.61, .78, .13], [2.84, 2.70, -2.34]],
    ["projector", [2.75, .18, .20], [-.19, 3.23, -2.14]],
    ["projector", [.45, .25, .37], projectorDevice.localToWorld(new T.Vector3(0, .72, 0)).toArray()],
    ["occasion", [.30, .19, .19], notebook.card.localToWorld(new T.Vector3(0, .09, 0)).toArray()],
  ].map(([id, dimensions, position]) => {
    const object = new T.Mesh(new T.BoxGeometry(...dimensions))
    object.position.set(...position)
    object.updateMatrixWorld()
    return { id, object }
  })
  return { ...lamp, curtains, views, hits, record, picture, notebook, seat, shelf, calendar, projector }
}
