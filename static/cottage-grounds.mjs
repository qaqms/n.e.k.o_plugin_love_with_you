// The land around the cottage (0.9.45): the yard becomes a small grassy rise in a meadow valley, with a dirt road
// to a little village, a windmill, a sheep pen and cows, layered hills and a sky that follow the time of day.
// Purely decorative: nothing here is clickable or saved. Static props are merged into a handful of meshes so the
// whole surroundings cost about a dozen draw calls; only the yard casts shadows. What moves (herds, smoke, birds)
// is in cottage-grounds-life.mjs (0.9.47); the clouds drift and the wind crosses the meadow here.
import * as T from "./engine/three.module.min.js"
import { mergeGeometries } from "./engine/three-gltf.mjs"
import { buildLife } from "./cottage-grounds-life.mjs?v=0.9.47"

// The cottage's footprint is x -3.4..10.1, z -2.7..7.2 (the front row since 0.9.61); the yard is centred a little in
// front of it (YARD), the sky and the far scenery around CENTER as before.
const CENTER = new T.Vector2(3.4, .6)
const YARD = new T.Vector2(3.4, 2.8)
const TOP = -.06
const FIELD = TOP - .3
const VILLAGE = { x: -17, z: -25, r: 9 }
const PASTURE = { x: -13.5, z: -6.5, w: 7, d: 5 }
const MILL = [6, -22]
const COWS = [[13, -8.5, .6, true], [14.2, -5.8, 2.2, false], [11.3, -10.3, -.8, true], [-17, 1.5, 1.4, true]]
const STRAYS = [[-11, 9], [-12.5, 10.2], [-10.2, 11]]
const ROAD = [[4.4, 11.6], [9.5, 11.2], [14.2, 9], [15.5, 5.5], [17.2, 1], [16, -6], [10.5, -13], [2, -19], [-6, -22], [-12, -24]]
const LEAVES = [0x6f9a63, 0x5e8a5c, 0x83a86c]

const random = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647
const near = (x, z, cx, cz, r) => (x - cx) ** 2 + (z - cz) ** 2 < r * r

// One material per colour and finish, so merging can put everything of a colour into a single mesh.
const materials = new Map()
function material(color, { rough = 1, flat = false, side = T.FrontSide } = {}) {
  const key = `${color}:${rough}:${flat}:${side}`
  if (!materials.has(key)) materials.set(key, new T.MeshStandardMaterial({ color, roughness: rough, flatShading: flat, side }))
  return materials.get(key)
}
function put(parent, geometry, mat, x = 0, y = 0, z = 0) {
  const mesh = new T.Mesh(geometry, mat)
  mesh.position.set(x, y, z)
  parent.add(mesh)
  return mesh
}

// Bakes every mesh under `group` into one merged mesh per material.
function bake(group, { shadows = false } = {}) {
  group.updateMatrixWorld(true)
  const buckets = new Map()
  group.traverse(object => {
    if (!object.isMesh) return
    let geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone()
    for (const name of Object.keys(geometry.attributes)) if (name !== "position" && name !== "normal") geometry.deleteAttribute(name)
    geometry.applyMatrix4(object.matrixWorld)
    if (!buckets.has(object.material)) buckets.set(object.material, [])
    buckets.get(object.material).push(geometry)
  })
  const baked = new T.Group()
  for (const [mat, geometries] of buckets) {
    const mesh = new T.Mesh(mergeGeometries(geometries), mat)
    for (const geometry of geometries) geometry.dispose()
    mesh.castShadow = shadows
    mesh.receiveShadow = true
    baked.add(mesh)
  }
  return baked
}

// An organic outline around the cottage.
function outline(rx, rz, seed, wobble = .12, points = 72) {
  const r = random(seed), phase = [r() * 6, r() * 6, r() * 6]
  return Array.from({ length: points }, (_, i) => {
    const a = i / points * Math.PI * 2
    const k = 1 + wobble * (Math.sin(a * 3 + phase[0]) * .5 + Math.sin(a * 5 + phase[1]) * .3 + Math.sin(a * 9 + phase[2]) * .2)
    return new T.Vector2(YARD.x + Math.cos(a) * rx * k, YARD.y + Math.sin(a) * rz * k)
  })
}

// The yard: a grass top following the outline with a short soil bank down to the fields.
function rise(points) {
  const group = new T.Group()
  const top = new T.ShapeGeometry(new T.Shape(points.map(p => new T.Vector2(p.x, -p.y))), 8)
  top.rotateX(-Math.PI / 2)
  top.translate(0, TOP, 0)
  const grass = new T.Mesh(top, new T.MeshStandardMaterial({ color: 0x8fb07a, roughness: 1 }))
  grass.receiveShadow = true
  group.add(grass)
  const rings = [[TOP, 0x8fb07a], [TOP - .1, 0x9c7a5a], [FIELD - .02, 0x9c7a5a]]
  const position = [], color = [], index = [], n = points.length, r = random(7)
  for (const [y, hex] of rings) for (const p of points) {
    position.push(p.x, y, p.y)
    const c = new T.Color(hex).multiplyScalar(.92 + r() * .16)
    color.push(c.r, c.g, c.b)
  }
  for (let ring = 0; ring < rings.length - 1; ring++) for (let i = 0; i < n; i++) {
    const a = ring * n + i, b = ring * n + (i + 1) % n
    index.push(a, a + n, b, b, a + n, b + n)
  }
  const bank = new T.BufferGeometry()
  bank.setAttribute("position", new T.Float32BufferAttribute(position, 3))
  bank.setAttribute("color", new T.Float32BufferAttribute(color, 3))
  bank.setIndex(index)
  bank.computeVertexNormals()
  group.add(new T.Mesh(bank, new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })))
  return group
}

// The meadow: lit near the cottage, melting into the horizon colour further out.
// Gusts: soft lighter bands sweep across it while ambient motion runs.
function meadow(horizon, wind) {
  const mat = new T.MeshStandardMaterial({ color: 0x9cba84, roughness: 1 })
  mat.onBeforeCompile = shader => {
    shader.uniforms.horizon = horizon
    shader.uniforms.wind = wind
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vGround;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvGround = (modelMatrix * vec4(transformed, 1.)).xz;")
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vGround;\nuniform vec3 horizon;\nuniform float wind;")
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>
        float gust = smoothstep(.55, 1., sin(dot(vGround, vec2(.32, -.12)) * .55 - wind * 1.4) * .5 + .5);
        gust *= .6 + .4 * sin(dot(vGround, vec2(-.11, .3)) * .7 + wind * .5);
        gl_FragColor.rgb *= 1. + .07 * gust;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, horizon, smoothstep(18., 60., distance(vGround, vec2(${CENTER.x}, ${CENTER.y}))));`)
  }
  const field = new T.Mesh(new T.CircleGeometry(72, 64), mat)
  field.rotation.x = -Math.PI / 2
  field.position.set(CENTER.x, FIELD, CENTER.y)
  field.receiveShadow = true
  return field
}

function broadleaf(parent, x, z, size, r) {
  const trunk = put(parent, new T.CylinderGeometry(.07 * size, .11 * size, 1.1 * size, 8), material(0x7a5a43), x, .55 * size, z)
  const leaf = material(LEAVES[Math.floor(r() * LEAVES.length)])
  for (const [dx, dy, dz, s] of [[0, 1.35, 0, .62], [-.3, 1.1, .15, .45], [.32, 1.15, -.1, .48], [.05, 1.75, .05, .42]]) {
    put(parent, new T.IcosahedronGeometry(s * size, 1), leaf, x + dx * size, dy * size, z + dz * size).scale.y = .88
  }
  return trunk
}

function pine(parent, x, z, size) {
  for (let i = 0; i < 3; i++) put(parent, new T.ConeGeometry((.55 - i * .14) * size, .8 * size, 7), material(0x4f7a5a, { flat: true }), x, (.55 + i * .38) * size, z)
  put(parent, new T.CylinderGeometry(.05 * size, .07 * size, .4 * size, 6), material(0x6e5040), x, .2 * size, z)
}

function yard(parent) {
  const r = random(11)
  broadleaf(parent, -5.4, -2.6, 1.9, r)
  broadleaf(parent, 12.4, -2.4, 1.35, r)
  broadleaf(parent, -6.2, 3.6, 1.1, r)
  for (const [x, z, s] of [[1.5, -4.6, 1.4], [4.3, -4.9, 1.7], [7.6, -4.4, 1.3], [-2.5, -4.5, 1.2], [10.8, -4.1, 1.1]]) pine(parent, x, z, s)
  // Stepping stones from the porch step round the house to the road, and from the front door (0.9.61) to the gate.
  const stone = material(0xcfc6b4, { rough: .95 })
  for (let i = 0; i < 9; i++) {
    const t = i / 8
    put(parent, new T.CylinderGeometry(.24, .26, .05, 9), stone,
      10.5 + t * 1.6 - Math.sin(t * Math.PI) * .6 + (r() - .5) * .15, .02, 1.1 + t * 6.8).scale.z = .7
  }
  for (let i = 0; i < 6; i++) {
    put(parent, new T.CylinderGeometry(.26, .28, .05, 9), stone, 3.75 + (r() - .5) * .2 + Math.sin(i * .9) * .12, .02, 7.75 + i * .65).scale.z = .7
  }
  // A low picket fence along the front, open where the path from the door leaves.
  const paint = material(0xe8dcc6, { rough: .9 })
  for (let i = 0; i < 26; i++) {
    const x = -2.6 + i * .5
    if (x > 9.8 || (x > 3 && x < 4.6)) continue
    put(parent, new T.BoxGeometry(.07, .5, .05), paint, x, .25, 11.3 + Math.sin(i * .5) * .08)
  }
  put(parent, new T.BoxGeometry(5.7, .05, .03), paint, .15, .34, 11.3)
  put(parent, new T.BoxGeometry(5.3, .05, .03), paint, 7.25, .34, 11.3)
  // Flower beds either side of the front path, bushes, rocks and a little pond.
  const petals = [0xf2a7b5, 0xffd27a, 0xffffff, 0xb9a6e8, 0xf08a6c]
  const bud = new T.SphereGeometry(.07, 6, 5)
  for (let i = 0; i < 70; i++) {
    const left = i % 2
    put(parent, bud, material(petals[i % petals.length], { rough: .8 }), left ? -2.6 + r() * 5 : 4.9 + r() * 4.2, .1 + r() * .08, 8.2 + r() * 1.3)
  }
  for (const [x, z, s] of [[-3.9, 2.9, .45], [-4.3, .3, .55], [-4.1, -1.6, .5], [-3.9, 6.6, .4], [2.9, 7.75, .35], [4.6, 7.75, .35],
    [12.2, 1.6, .45], [10.6, 6.4, .38]]) {
    put(parent, new T.IcosahedronGeometry(s, 1), material(0x6a9562), x, s * .6, z).scale.y = .8
  }
  for (const [x, z, s] of [[-1.5, 10.2, .25], [7.6, 9.9, .2], [13, -.5, .3], [-6.8, -.5, .35]]) {
    put(parent, new T.DodecahedronGeometry(s, 0), material(0xa79f94, { flat: true }), x, s * .4, z)
  }
  const pond = put(parent, new T.CircleGeometry(1, 28), material(0x7fb3c4, { rough: .15 }), -5.4, .015, 1.9)
  pond.rotation.x = -Math.PI / 2
  pond.scale.set(1.5, 1, 1)
}

function house(parent, x, z, w, d, h, wall, roof, windows) {
  const g = new T.Group()
  g.position.set(x, 0, z)
  g.rotation.y = Math.atan2(CENTER.x - x, CENTER.y - z)
  parent.add(g)
  put(g, new T.BoxGeometry(w, h, d), material(wall, { rough: .95 }), 0, h / 2, 0)
  const gable = new T.Shape([new T.Vector2(-w / 2 - .18, 0), new T.Vector2(w / 2 + .18, 0), new T.Vector2(0, h * .55)])
  const prism = new T.ExtrudeGeometry(gable, { depth: d + .3, bevelEnabled: false })
  prism.translate(0, 0, -(d + .3) / 2)
  put(g, prism, material(roof, { rough: .9, flat: true }), 0, h, 0)
  put(g, new T.BoxGeometry(.25, .7, .25), material(0x8b6f62), w * .25, h + h * .45, -d * .2)
  g.userData.chimney = new T.Vector3(w * .25, h * 1.45 + .35, -d * .2)
  const count = Math.max(1, Math.round(w / 1.1)), span = w - .9
  const pane = new T.PlaneGeometry(.32, .38)
  for (const side of [1, -1]) for (let i = 0; i < count; i++) {
    const win = put(g, pane, windows, count > 1 ? -span / 2 + span * i / (count - 1) : 0, h * .58, side * (d / 2 + .01))
    if (side < 0) win.rotation.y = Math.PI
  }
  put(g, new T.PlaneGeometry(.38, .7), material(0x6b4a39), w * .3, .35, d / 2 + .012)
  return g
}

function road(parent) {
  const curve = new T.CatmullRomCurve3(ROAD.map(([x, z]) => new T.Vector3(x, 0, z)))
  const n = 90, position = [], index = []
  for (let i = 0; i <= n; i++) {
    const p = curve.getPoint(i / n), t = curve.getTangent(i / n)
    const side = new T.Vector3(-t.z, 0, t.x).normalize().multiplyScalar(.55)
    position.push(p.x + side.x, .012, p.z + side.z, p.x - side.x, .012, p.z - side.z)
    if (i < n) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
  }
  const geometry = new T.BufferGeometry()
  geometry.setAttribute("position", new T.Float32BufferAttribute(position, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  put(parent, geometry, material(0xc9ad84, { side: T.DoubleSide }))
}

// Everything on the meadow below the yard: road, village, pasture, cows and trees.
// Returns the tops of the village chimneys that smoke (in the meadow's frame).
function countryside(parent, windows) {
  const r = random(77)
  road(parent)
  const walls = [0xf1e4cf, 0xe8d2c0, 0xdfe5d6, 0xf3ead8, 0xe2cdb3]
  const roofs = [0xb35f48, 0x8d5a44, 0x6f7f8f, 0xa86b4d]
  const chimneys = []
  ;[[-12, -27.5], [-14.5, -21], [-20, -22], [-22.5, -27.5], [-18, -30], [-13, -32], [-24.5, -20], [-9, -24], [-26, -24.5], [-8, -30]]
    .forEach(([x, z], i) => {
      const home = house(parent, x, z, 2 + r() * 1.4, 1.6 + r() * .6, 1.4 + r() * .7, walls[i % walls.length], roofs[i % roofs.length], windows)
      if (i % 2 === 0) chimneys.push(home)
    })
  // A taller hall with a little bell tower in the middle of the village.
  const hall = house(parent, -17.5, -25.5, 2.6, 2.2, 2.2, 0xf4ecdc, 0x7d5246, windows)
  put(hall, new T.BoxGeometry(.8, 1.6, .8), material(0xf4ecdc), -.6, 3.4, 0)
  put(hall, new T.ConeGeometry(.65, 1.2, 4), material(0x7d5246, { flat: true }), -.6, 4.8, 0).rotation.y = Math.PI / 4
  // The windmill's tower and cap; its sails are a separate, turning mesh.
  put(parent, new T.CylinderGeometry(.75, 1.25, 4.2, 10), material(0xeee5d3, { rough: .95 }), MILL[0], 2.1, MILL[1])
  put(parent, new T.ConeGeometry(1, 1.2, 10), material(0x9c5a46, { rough: .9 }), MILL[0], 4.8, MILL[1])
  // The sheep pen.
  const wood = material(0x9b7a5c)
  const { x: px, z: pz, w, d } = PASTURE
  for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
    const length = Math.hypot((bx - ax) * w / 2, (bz - az) * d / 2), steps = Math.round(length / 1.2)
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      put(parent, new T.BoxGeometry(.08, .55, .08), wood, px + (ax + (bx - ax) * t) * w / 2, .27, pz + (az + (bz - az) * t) * d / 2)
    }
    put(parent, new T.BoxGeometry(length, .05, .04), wood, px + (ax + bx) / 4 * w, .42, pz + (az + bz) / 4 * d)
      .rotation.y = -Math.atan2((bz - az) * d, (bx - ax) * w)
  }
  // The sheep and cows themselves move, so they live in cottage-grounds-life.mjs (see herds()).
  // Crop strips and trees scattered over the fields, kept off the village, pen, mill and road bend.
  const crops = [0xc9b874, 0xa9c27c, 0xd6c48a]
  for (let i = 0; i < 6; i++) {
    const strip = put(parent, new T.PlaneGeometry(9, 1.6), material(crops[i % 3]), -14 + i * 1.75, .02, -12 + i * .6)
    strip.rotation.set(-Math.PI / 2, 0, .35)
  }
  const trees = random(31)
  for (let i = 0; i < 30; i++) {
    const a = -Math.PI + trees() * Math.PI * 2, distance = 14 + trees() * 20
    const x = CENTER.x + Math.cos(a) * distance, z = CENTER.y + Math.sin(a) * distance * .8
    const kind = trees(), size = 1 + trees() * 1.2
    if (z > 12 || near(x, z, VILLAGE.x, VILLAGE.z, VILLAGE.r) || near(x, z, MILL[0], MILL[1], 3) ||
      near(x, z, PASTURE.x, PASTURE.z, 6) || near(x, z, 13, -8, 3.5) || near(x, z, 16.5, -4, 2.2)) continue
    if (kind < .5) pine(parent, x, z, size + .2)
    else broadleaf(parent, x, z, size, trees)
  }
  parent.updateMatrixWorld(true)
  return chimneys.map(home => home.localToWorld(home.userData.chimney.clone()))
}

// Where each animal starts and may wander: the pen sheep inside the fence, the others near where they stand.
function herds() {
  const r = random(77)
  const { x: px, z: pz, w, d } = PASTURE
  const pen = { x: px, z: pz, w: w - 1.4, d: d - 1.4 }
  const sheep = [
    ...Array.from({ length: 8 }, () => ({ x: px + (r() - .5) * pen.w, z: pz + (r() - .5) * pen.d, turn: r() * Math.PI * 2, grazing: r() < .6, within: pen })),
    ...STRAYS.map(([x, z]) => ({ x, z, turn: r() * 6, grazing: true, within: { x: -11.2, z: 10, r: 1.6 } })),
  ]
  const cows = COWS.map(([x, z, turn, grazing]) => ({ x, z, turn, grazing, within: { x, z, r: 1.2 } }))
  return { sheep, cows }
}

function sails() {
  const hub = new T.Group()
  const cloth = new T.MeshStandardMaterial({ color: 0xf6efe2, roughness: .9, side: T.DoubleSide })
  const spar = new T.MeshStandardMaterial({ color: 0x7a5a43, roughness: 1 })
  const arms = new T.Group()
  for (let i = 0; i < 4; i++) {
    const arm = new T.Group()
    arm.rotation.z = i * Math.PI / 2
    put(arm, new T.PlaneGeometry(.55, 2.4), cloth, .2, 1.35, 0)
    put(arm, new T.BoxGeometry(.07, 2.7, .07), spar, 0, 1.35, 0)
    arms.add(arm)
  }
  const baked = bake(arms)
  hub.add(baked)
  return hub
}

function skyDome(scene, uniforms) {
  const dome = new T.Mesh(new T.SphereGeometry(95, 32, 16), new T.ShaderMaterial({
    uniforms, side: T.BackSide, depthWrite: false,
    vertexShader: "varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }",
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = h > 0. ? mix(horizon, top, pow(smoothstep(0., .6, h), .8)) : mix(horizon, bottom, smoothstep(0., .25, -h));
        gl_FragColor = vec4(c, 1.);
        #include <colorspace_fragment>
      }`,
  }))
  // Centred on the camera every frame, so it never reaches the far plane.
  dome.onBeforeRender = (renderer, scene, camera) => dome.position.copy(camera.position)
  dome.renderOrder = -10
  dome.frustumCulled = false
  scene.add(dome)
}

function hills(scene) {
  const r = random(21)
  return [[30, 5], [42, 10], [58, 18]].map(([radius, height], layer) => {
    const n = 90, position = [], index = []
    const phase = [r() * 6, r() * 6, r() * 6]
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI + 2 * Math.PI * i / n
      const h = height * (.55 + .25 * Math.sin(a * 4 + phase[0]) + .15 * Math.sin(a * 9 + phase[1]) + .08 * Math.sin(a * 17 + phase[2]))
      const x = CENTER.x + Math.cos(a) * radius, z = CENTER.y + Math.sin(a) * radius
      position.push(x, -6.5, z, x, -.5 + h, z)
      if (i < n) index.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3)
    }
    const geometry = new T.BufferGeometry()
    geometry.setAttribute("position", new T.Float32BufferAttribute(position, 3))
    geometry.setIndex(index)
    const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial({ side: T.DoubleSide }))
    mesh.renderOrder = -9 + layer
    scene.add(mesh)
    return { mesh, fade: layer / 2 }
  })
}

function clouds(scene) {
  const r = random(9), group = new T.Group()
  const geometry = new T.SphereGeometry(1, 12, 8)
  const mat = new T.MeshBasicMaterial({ color: 0xffffff })
  for (let i = 0; i < 16; i++) {
    const a = r() * Math.PI * 2, radius = 50 + r() * 20
    const cloud = new T.Group()
    cloud.position.set(CENTER.x + Math.cos(a) * radius, 18 + r() * 14, CENTER.y + Math.sin(a) * radius)
    cloud.lookAt(CENTER.x, cloud.position.y, CENTER.y)
    for (let j = 0; j < 4 + Math.floor(r() * 3); j++) {
      const s = 3.4 * (.6 + r() * .6)
      put(cloud, geometry, mat, (j - 2.5) * 2.7, r(), 0).scale.set(s, s * .55, s * .5)
    }
    group.add(cloud)
  }
  // They drift slowly round the valley: the baked clouds turn about the cottage.
  const pivot = new T.Group()
  pivot.position.set(CENTER.x, 0, CENTER.y)
  const baked = bake(group)
  baked.position.set(-CENTER.x, 0, -CENTER.y)
  pivot.add(baked)
  scene.add(pivot)
  return { mat, pivot }
}

function stars(scene) {
  const r = random(5), position = []
  for (let i = 0; i < 700; i++) {
    const a = r() * Math.PI * 2, h = .1 + r() * .88, flat = Math.sqrt(1 - h * h)
    position.push(CENTER.x + Math.cos(a) * flat * 88, h * 88, CENTER.y + Math.sin(a) * flat * 88)
  }
  const geometry = new T.BufferGeometry()
  geometry.setAttribute("position", new T.Float32BufferAttribute(position, 3))
  const points = new T.Points(geometry, new T.PointsMaterial({ color: 0xfff6dc, size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }))
  const moon = new T.Mesh(new T.CircleGeometry(2.4, 32), new T.MeshBasicMaterial({ color: 0xfff3d0, transparent: true, opacity: 0, depthWrite: false }))
  moon.position.set(CENTER.x - 30, 34, CENTER.y - 70)
  moon.lookAt(CENTER.x, 0, CENTER.y)
  scene.add(points, moon)
  return [points, moon]
}

export function buildGrounds(scene) {
  const horizon = { value: new T.Color() }
  const sky = { top: { value: new T.Color() }, horizon, bottom: { value: new T.Color() } }
  skyDome(scene, sky)
  const far = hills(scene)
  const { mat: cloud, pivot: drift } = clouds(scene)
  const wind = { value: 0 }
  const [starField, moon] = stars(scene)

  scene.add(meadow(horizon, wind))
  scene.add(rise(outline(10.6, 8.8, 3)))
  const garden = new T.Group()
  yard(garden)
  garden.position.y = TOP
  scene.add(bake(garden, { shadows: true }))

  const windows = new T.MeshBasicMaterial({ color: 0x46525c })
  const land = new T.Group()
  const chimneys = countryside(land, windows).map(top => top.setY(top.y + FIELD))
  land.position.y = FIELD
  scene.add(bake(land))
  const life = buildLife(scene, { ...herds(), chimneys, ground: FIELD, center: CENTER })
  const hub = sails()
  hub.position.set(MILL[0], FIELD + 4.1, MILL[1])
  hub.lookAt(CENTER.x, FIELD + 4.1, CENTER.y)
  hub.translateZ(.95)
  scene.add(hub)

  const white = new T.Color(0xffffff), hillBase = new T.Color(0x7fa07a), deep = new T.Color(0x0a1220), blue = new T.Color(0x8fb7d9)
  const unlit = new T.Color(0x46525c), lit = new T.Color(0xffc56e).multiplyScalar(1.4)
  let turn = 0
  // backdrop: the time of day's background colour; night: 0 by day to 1 at night; dt: seconds of turning (0 holds still).
  function update(backdrop, night, dt) {
    sky.horizon.value.copy(backdrop).lerp(white, .25 * (1 - night))
    sky.top.value.copy(backdrop).lerp(night > .5 ? deep : blue, .55)
    sky.bottom.value.copy(backdrop).multiplyScalar(.9)
    for (const { mesh, fade } of far) mesh.material.color.copy(hillBase).multiplyScalar(1 - .75 * night).lerp(horizon.value, .25 + .55 * fade)
    cloud.color.copy(backdrop).lerp(white, .75 - .62 * night)
    starField.material.opacity = moon.material.opacity = night
    starField.visible = moon.visible = night > .01
    windows.color.copy(unlit).lerp(lit, night)
    turn += dt * .25
    hub.rotation.z = turn
    drift.rotation.y += dt * .004
    wind.value += dt
    life.update(dt, horizon.value, night)
  }
  return { update }
}
