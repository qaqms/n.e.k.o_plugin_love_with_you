// Dev-only gray box for the whole-house proposal (docs/plans/cottage-full-house-proposal-2026-11-24.md): the cottage
// with its front closed and a new row of rooms (cottage-fullhouse-layout.mjs), seen with walls up, cut away in front
// of the camera (like a life-sim game) or all down, from all round the house; and a stand-in for Yui whose outline
// shows through whatever is in front of her. Served by tools/preview/ui_preview.mjs at /fullhouse; never shipped.
import * as T from "./engine/three.module.min.js"
import { RoomEnvironment } from "./engine/three-post.mjs"
import { wallPieces } from "./cottage-layout.mjs"
import { FURNITURE, HOUSE, NEW_FURNITURE, NEW_ROOMS, RAILING, ROOMS, STAIRS, STAND_IN, STOREYS, WALLS } from "./cottage-fullhouse-layout.mjs"

const FOV = 30
// How low a cut wall goes, above its floor (m).
const CUT = .4
const MODES = { up: "墙全立", cut: "自动切墙", down: "墙全降" }
const params = new URLSearchParams(location.search)

const stage = document.getElementById("stage")
const labelLayer = document.getElementById("labels")
const info = document.getElementById("info")
const nav = document.querySelector("nav")

const renderer = new T.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.toneMapping = T.NeutralToneMapping
renderer.shadowMap.enabled = true
renderer.shadowMap.type = T.PCFSoftShadowMap
stage.append(renderer.domElement)

const scene = new T.Scene()
scene.background = new T.Color(0xe6e9e4)
const pmrem = new T.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture
scene.environmentIntensity = .7
const sun = new T.DirectionalLight(0xfff3e2, 2.2)
sun.position.set(-6, 14, 11)
sun.target.position.set(3, 0, 1.5)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 45 })
sun.shadow.bias = -.0005
scene.add(sun, sun.target)

const camera = new T.PerspectiveCamera(FOV, 1, .1, 200)
const box = (size, material) => {
  const mesh = new T.Mesh(new T.BoxGeometry(...size), material)
  mesh.castShadow = mesh.receiveShadow = true
  return mesh
}
const place = (mesh, at) => { mesh.position.set(...at); return mesh }
const storeyGroups = STOREYS.map(() => new T.Group())
scene.add(...storeyGroups)
const roomOf = id => ROOMS.find(item => item.id === id)
const isNew = id => NEW_ROOMS.some(item => item.id === id)

const grass = place(box([34, .1, 24], new T.MeshStandardMaterial({ color: 0xc9d3bd, roughness: 1 })), [3.4, -.11, 3.5])
grass.castShadow = false
scene.add(grass)

// Floors (the new rooms a little warmer, so they read as new); the upper floor leaves the stair opening clear.
const floorMaterial = new T.MeshStandardMaterial({ color: 0xcdbfa8, roughness: .9 })
const newFloorMaterial = new T.MeshStandardMaterial({ color: 0xd9c49c, roughness: .9 })
const deckMaterial = new T.MeshStandardMaterial({ color: 0xb59d7c, roughness: .9 })
for (const item of ROOMS) {
  const storey = STOREYS[item.storey]
  const thickness = item.outdoor ? item.deck : .12
  const top = storey.y + (item.outdoor ? item.deck : 0)
  const hole = item.storey === 1 && STAIRS.hole.x[0] >= item.x[0] && STAIRS.hole.x[1] <= item.x[1] ? STAIRS.hole : null
  const rects = hole ? [
    [[item.x[0], hole.x[0]], item.z],
    [[hole.x[1], item.x[1]], item.z],
    [hole.x, [hole.z[1], item.z[1]]],
    [hole.x, [item.z[0], hole.z[0]]],
  ] : [[item.x, item.z]]
  const material = item.outdoor || item.open ? deckMaterial : isNew(item.id) ? newFloorMaterial : floorMaterial
  for (const [x, z] of rects) {
    if (x[1] - x[0] < 1e-3 || z[1] - z[0] < 1e-3) continue
    storeyGroups[item.storey].add(place(box([x[1] - x[0], thickness, z[1] - z[0]], material),
      [(x[0] + x[1]) / 2, top - thickness / 2, (z[0] + z[1]) / 2]))
  }
}

// Walls: each piece can be cut down from the top to CUT above its floor; the cut edge shows as a dark band.
const wallMaterial = new T.MeshStandardMaterial({ color: 0xeeeae2, roughness: .95 })
const capMaterial = new T.MeshStandardMaterial({ color: 0x6d6258, roughness: .8 })
const walls = WALLS.map(wall => {
  const floor = STOREYS[wall.storey].y
  const pieces = wallPieces(wall).map(piece => {
    const mesh = place(box(piece.size, wallMaterial), piece.at)
    const bottom = piece.at[1] - piece.size[1] / 2
    const top = piece.at[1] + piece.size[1] / 2
    const [w, , d] = piece.size
    const cap = box([w + .004, .035, d + .01], capMaterial)
    cap.position.set(piece.at[0], 0, piece.at[2])
    cap.visible = false
    storeyGroups[wall.storey].add(mesh, cap)
    return { mesh, cap, bottom, top, height: piece.size[1], low: Math.max(bottom, floor + CUT) }
  })
  return { wall, pieces, cut: 0 }
})

// Stairs climb from the front of the kitchen to the opening at the back.
const stepMaterial = new T.MeshStandardMaterial({ color: 0xa88e6c, roughness: .8 })
const steps = 14
const run = (STAIRS.z[1] - STAIRS.z[0]) / steps
for (let index = 0; index < steps; index += 1) {
  const height = STAIRS.rise * (index + 1) / steps
  const z = STAIRS.z[1] - run * (index + .5)
  storeyGroups[0].add(place(box([STAIRS.x[1] - STAIRS.x[0], height, run], stepMaterial), [(STAIRS.x[0] + STAIRS.x[1]) / 2, height / 2, z]))
}

// Porch posts and canopy, the balcony railing.
const postMaterial = new T.MeshStandardMaterial({ color: 0x9c8466, roughness: .85 })
const porch = roomOf("porch")
for (const [x, z] of [[porch.x[1] - .1, porch.z[1] - .1], [porch.x[1] - .1, porch.z[0] + .1]]) {
  storeyGroups[0].add(place(box([.12, 2.6, .12], postMaterial), [x, porch.deck + 1.3, z]))
}
const canopy = place(box([porch.x[1] - porch.x[0] + .3, .1, porch.z[1] - porch.z[0] + .3], postMaterial),
  [(porch.x[0] + porch.x[1]) / 2 + .15, porch.deck + 2.65, (porch.z[0] + porch.z[1]) / 2])
storeyGroups[0].add(canopy)
const railLength = RAILING.x[1] - RAILING.x[0]
storeyGroups[1].add(place(box([railLength, .06, .08], postMaterial), [(RAILING.x[0] + RAILING.x[1]) / 2, RAILING.y + RAILING.height, RAILING.z]))
for (let index = 0; index <= 10; index += 1) {
  storeyGroups[1].add(place(box([.04, RAILING.height, .04], postMaterial),
    [RAILING.x[0] + .05 + (railLength - .1) * index / 10, RAILING.y + RAILING.height / 2, RAILING.z]))
}

// Gable roof over the whole house (ridge along x), shown with the walls up.
const roofMaterial = new T.MeshStandardMaterial({ color: 0x8f6f5c, roughness: .8 })
const roof = new T.Group()
const roofTop = STOREYS[1].y + STOREYS[1].height
const halfDepth = (HOUSE.z[1] - HOUSE.z[0]) / 2 + .35
const ridgeZ = (HOUSE.z[0] + HOUSE.z[1]) / 2
const pitch = Math.atan2(1.8, halfDepth)
for (const side of [-1, 1]) {
  const slab = box([7 - HOUSE.x[0] + .6, .14, halfDepth / Math.cos(pitch)], roofMaterial)
  slab.position.set((HOUSE.x[0] + 7) / 2, roofTop + .9, ridgeZ + side * halfDepth / 2)
  slab.rotation.x = side * pitch
  roof.add(slab)
}
// Gable ends.
const gable = new T.Shape([new T.Vector2(-halfDepth + .35, 0), new T.Vector2(halfDepth - .35, 0), new T.Vector2(0, 1.75)])
for (const x of [HOUSE.x[0], 7]) {
  const end = new T.Mesh(new T.ShapeGeometry(gable), new T.MeshStandardMaterial({ color: 0xeeeae2, roughness: .95, side: T.DoubleSide }))
  end.rotation.y = Math.PI / 2
  end.position.set(x, roofTop, ridgeZ)
  end.castShadow = true
  roof.add(end)
}
scene.add(roof)

// Furniture placeholders: the existing ones gray, the new ones sand-coloured and named.
const furnitureMaterial = new T.MeshStandardMaterial({ color: 0x9a9a94, roughness: .85 })
const newFurnitureMaterial = new T.MeshStandardMaterial({ color: 0xc2a77c, roughness: .85 })
const tags = []
const tag = (text, kind, point, storey, room, outdoor = false) => {
  const element = document.createElement("div")
  element.className = `tag ${kind}`
  element.textContent = text
  labelLayer.append(element)
  tags.push({ element, point, storey, room, outdoor })
}
for (const item of FURNITURE) {
  const added = NEW_FURNITURE.includes(item)
  storeyGroups[roomOf(item.room).storey].add(place(box(item.size, added ? newFurnitureMaterial : furnitureMaterial), item.at))
  if (added) tag(item.name, "idea", new T.Vector3(item.at[0], item.at[1] + item.size[1] / 2, item.at[2]), roomOf(item.room).storey, item.room)
}
for (const item of ROOMS) {
  const storey = STOREYS[item.storey]
  tag(item.name, isNew(item.id) ? "room new" : "room", new T.Vector3((item.x[0] + item.x[1]) / 2, storey.y + 2.2,
    (item.z[0] + item.z[1]) / 2), item.storey, null, Boolean(item.outdoor))
}

// A stand-in for Yui, and her outline through whatever is in front of her: the same shape drawn again only where
// something nearer hides it (depth test reversed), as a flat tint.
const figure = new T.Group()
const bodyGeometry = new T.CapsuleGeometry(.19, STAND_IN.height - .38, 6, 16)
const body = new T.Mesh(bodyGeometry, new T.MeshStandardMaterial({ color: 0xe9b7b0, roughness: .7 }))
body.castShadow = true
const ghost = new T.Mesh(bodyGeometry, new T.MeshBasicMaterial({ color: 0x3aa6a0, transparent: true, opacity: .55,
  depthFunc: T.GreaterDepth, depthWrite: false }))
ghost.renderOrder = 10
figure.add(body, ghost)
figure.position.set(STAND_IN.at[0], STAND_IN.at[1] + STAND_IN.height / 2, STAND_IN.at[2])
storeyGroups[0].add(figure)

// Views: the whole house, each storey, each room. The camera goes all round (drag), at any of them.
const views = [
  { id: "overview", name: "总览", box: HOUSE, storey: 1 },
  { id: "ground", name: "一楼", box: { x: [-3.25, 10], y: [0, 3.4], z: HOUSE.z }, storey: 0 },
  { id: "upper", name: "二楼", box: { x: [-3.25, 7], y: [3.4, 6.4], z: HOUSE.z }, storey: 1 },
  ...ROOMS.map(item => {
    const storey = STOREYS[item.storey]
    return { id: item.id, name: item.name, room: item, storey: item.storey, box: { x: item.x, y: [storey.y, storey.y + storey.height], z: item.z } }
  }),
]
const buttons = new Map()
const addButton = (id, label, onClick) => {
  const button = document.createElement("button")
  button.type = "button"
  button.id = id
  button.textContent = label
  button.setAttribute("aria-pressed", "false")
  button.addEventListener("click", onClick)
  nav.append(button)
  buttons.set(id, button)
  return button
}
for (const view of views) addButton(`view-${view.id}`, view.name, () => go(view.id))
nav.append(Object.assign(document.createElement("span"), { className: "gap" }))
for (const [mode, label] of Object.entries(MODES)) addButton(`mode-${mode}`, label, () => setMode(mode))
addButton("outline", "轮廓", () => setOutline(!outline))

let current = views[0]
let mode = MODES[params.get("mode")] ? params.get("mode") : "cut"
let outline = params.get("outline") !== "0"
let azimuth = Number(params.get("az") ?? .55)
let elevation = Number(params.get("el") ?? .5)
let zoom = 1
const lookTarget = new T.Vector3()
let from = null
let started = 0
const DURATION = 900

function frame(view) {
  const { box: b } = view
  const centre = new T.Vector3((b.x[0] + b.x[1]) / 2, (b.y[0] + b.y[1]) / 2, (b.z[0] + b.z[1]) / 2)
  const radius = Math.hypot(b.x[1] - b.x[0], b.y[1] - b.y[0], b.z[1] - b.z[0]) / 2
  const vertical = T.MathUtils.degToRad(FOV) / 2
  const horizontal = Math.atan(Math.tan(vertical) * camera.aspect)
  const distance = radius / Math.sin(Math.min(vertical, horizontal)) * .9 * zoom
  const direction = new T.Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation))
  return { target: centre, position: centre.clone().addScaledVector(direction, distance) }
}

function go(id, instant = false) {
  current = views.find(view => view.id === id) || views[0]
  from = instant ? null : { target: lookTarget.clone(), position: camera.position.clone() }
  started = performance.now()
  refresh()
}
function setMode(next) { mode = next; refresh() }
function setOutline(on) { outline = on; refresh() }
function orbit(az, el) {
  azimuth = az
  elevation = T.MathUtils.clamp(el, .12, 1.35)
}

function refresh() {
  for (const [id, button] of buttons) {
    const on = id === `view-${current.id}` || id === `mode-${mode}` || id === "outline" && outline
    button.setAttribute("aria-pressed", String(on))
  }
  document.body.dataset.view = current.id
  const rooms = current.room ? [current.room] : ROOMS.filter(item => current.id === "overview" || item.storey === current.storey)
  info.innerHTML = "<h2></h2><p></p><ul></ul>"
  info.querySelector("h2").textContent = current.room ? current.room.name : current.name
  const note = current.room ? `${STOREYS[current.room.storey].name} · ${(current.room.x[1] - current.room.x[0]).toFixed(2)} × ${(current.room.z[1] - current.room.z[0]).toFixed(2)} m`
    : `${rooms.length} 个房间，其中新加 ${rooms.filter(item => isNew(item.id)).length} 个`
  info.querySelector("p").textContent = `${note} · ${MODES[mode]} · 拖动可绕房子转，滚轮缩放`
  const list = info.querySelector("ul")
  for (const item of rooms) {
    const entry = document.createElement("li")
    entry.className = isNew(item.id) ? "idea" : "live"
    const name = document.createElement("b")
    name.textContent = item.name
    const detail = document.createElement("small")
    const things = FURNITURE.filter(thing => thing.room === item.id).map(thing => thing.name)
    detail.textContent = `${isNew(item.id) ? "新加" : "原有"} · ${STOREYS[item.storey].name} · ${(item.x[1] - item.x[0]).toFixed(1)} × ${(item.z[1] - item.z[0]).toFixed(1)} m${things.length ? ` · ${things.join("、")}` : ""}`
    entry.append(name, detail)
    entry.addEventListener("click", () => go(item.id))
    list.append(entry)
  }
}

const ease = value => value < .5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2

function updateWalls(instant) {
  for (const entry of walls) {
    const { wall, pieces } = entry
    const axis = wall.axis === "x" ? "x" : "z"
    // Cut: a wall the camera looks at the house through (it stands between the camera and what is framed).
    const blocking = (camera.position[axis] - wall.at) * (lookTarget[axis] - wall.at) < 0
    const goal = mode === "down" ? 1 : mode === "cut" && blocking ? 1 : 0
    entry.cut = instant ? goal : entry.cut + (goal - entry.cut) * .2
    if (Math.abs(entry.cut - goal) < .002) entry.cut = goal
    for (const piece of pieces) {
      const top = piece.top - (piece.top - piece.low) * entry.cut
      const height = top - piece.bottom
      piece.mesh.visible = height > .005
      if (piece.mesh.visible) {
        piece.mesh.scale.y = height / piece.height
        piece.mesh.position.y = (piece.bottom + top) / 2
      }
      piece.cap.visible = piece.mesh.visible && entry.cut > .02 && top < piece.top - .01
      piece.cap.position.y = top
    }
  }
}

function visibility() {
  storeyGroups[1].visible = current.storey === 1
  roof.visible = mode === "up" && current.id === "overview"
  ghost.visible = outline
  figure.visible = storeyGroups[0].visible
}

const projected = new T.Vector3()
function placeTags() {
  for (const entry of tags) {
    projected.copy(entry.point).project(camera)
    // The overview names the upper rooms (and the porch): the ground floor's are under them.
    const overview = current.id === "overview" && !entry.room && (entry.storey === 1 || entry.outdoor)
    const shown = storeyGroups[entry.storey].visible && (overview || current.id !== "overview" && current.storey === entry.storey)
      && (!current.room || entry.room === current.room.id || (!entry.room && entry.point.distanceTo(lookTarget) < 4))
    const inside = shown && projected.z < 1 && Math.abs(projected.x) < 1.05 && Math.abs(projected.y) < 1.05
    entry.element.style.opacity = inside ? "1" : "0"
    if (inside) entry.element.style.transform = `translate(${(projected.x + 1) / 2 * innerWidth}px, ${(1 - projected.y) / 2 * innerHeight}px) translate(-50%, -100%)`
  }
}

// Drag to go round, wheel to come closer.
let drag = null
renderer.domElement.addEventListener("pointerdown", event => {
  drag = { x: event.clientX, y: event.clientY, azimuth, elevation }
  renderer.domElement.setPointerCapture(event.pointerId)
})
renderer.domElement.addEventListener("pointermove", event => {
  if (!drag) return
  orbit(drag.azimuth - (event.clientX - drag.x) * .008, drag.elevation + (event.clientY - drag.y) * .005)
})
renderer.domElement.addEventListener("pointerup", () => { drag = null })
renderer.domElement.addEventListener("wheel", event => {
  event.preventDefault()
  zoom = T.MathUtils.clamp(zoom * Math.exp(event.deltaY * .001), .35, 1.6)
}, { passive: false })

function resize() {
  renderer.setSize(innerWidth, innerHeight)
  camera.aspect = innerWidth / Math.max(1, innerHeight)
  camera.updateProjectionMatrix()
}

let firstFrame = true
function tick(now) {
  const to = frame(current)
  const amount = from ? ease(Math.min(1, (now - started) / DURATION)) : 1
  if (from) {
    lookTarget.lerpVectors(from.target, to.target, amount)
    camera.position.lerpVectors(from.position, to.position, amount)
    if (amount >= 1) from = null
  } else {
    lookTarget.copy(to.target)
    camera.position.copy(to.position)
  }
  camera.lookAt(lookTarget)
  visibility()
  updateWalls(firstFrame)
  firstFrame = false
  renderer.render(scene, camera)
  placeTags()
  requestAnimationFrame(tick)
}

addEventListener("resize", resize)
resize()
go(params.get("view") || "overview", true)
requestAnimationFrame(tick)
window.__fullhouse = {
  ready: true, go, setMode, setOutline,
  orbit(az, el) { orbit(az, el); updateWalls(true) },
  get view() { return current.id }, get moving() { return Boolean(from) },
}
