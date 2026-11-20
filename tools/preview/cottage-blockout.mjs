// Dev-only gray-box viewer for the two-storey cottage layout (static/cottage-layout.mjs).
// Served by tools/preview/ui_preview.mjs at /blockout; never shipped in the plugin package.
import * as T from "./engine/three.module.min.js"
import { RoomEnvironment } from "./engine/three-post.mjs"
import { FURNITURE, ROOMS, SLOTS, STAIRS, STOREYS, WALLS, room, wallPieces } from "./cottage-layout.mjs"

const FEATURE_NAMES = { seat: "坐下", company: "陪伴", notebook: "笔记本", occasion: "纪念日", record: "唱片", picture: "相框",
  calendar: "日历", projector: "投影", shelf: "礼物架" }
const KIND_NAMES = { floor: "落地", wall: "挂墙", surface: "台面" }
const FOV = 30
const HOUSE = { x: [-3.25, 10], y: [0, 6.9], z: [-2.65, 2.65] }

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
scene.environmentIntensity = .55
const sun = new T.DirectionalLight(0xfff3e2, 2.2)
sun.position.set(-6, 14, 9)
sun.target.position.set(3, 0, 0)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 })
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

// Ground and yard
const grass = place(box([30, .1, 18], new T.MeshStandardMaterial({ color: 0xc9d3bd, roughness: 1 })), [3.4, -.11, 3])
grass.castShadow = false
scene.add(grass)

// Floors: the study floor leaves the stair opening clear.
const floorMaterial = new T.MeshStandardMaterial({ color: 0xcdbfa8, roughness: .9 })
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
  for (const [x, z] of rects) {
    if (x[1] - x[0] < 1e-3 || z[1] - z[0] < 1e-3) continue
    storeyGroups[item.storey].add(place(box([x[1] - x[0], thickness, z[1] - z[0]], item.outdoor ? deckMaterial : floorMaterial),
      [(x[0] + x[1]) / 2, top - thickness / 2, (z[0] + z[1]) / 2]))
  }
}

// Walls keep their own material so each piece can fade on its own.
const walls = []
for (const wall of WALLS) {
  for (const piece of wallPieces(wall)) {
    const material = new T.MeshStandardMaterial({ color: 0xeeeae2, roughness: .95, transparent: true })
    const mesh = place(box(piece.size, material), piece.at)
    mesh.userData.wall = wall
    walls.push(mesh)
    storeyGroups[wall.storey].add(mesh)
  }
}

// Stairs climb from the front of the kitchen to the opening at the back.
const stepMaterial = new T.MeshStandardMaterial({ color: 0xa88e6c, roughness: .8 })
const steps = 14
const run = (STAIRS.z[1] - STAIRS.z[0]) / steps
for (let index = 0; index < steps; index += 1) {
  const height = STAIRS.rise * (index + 1) / steps
  const z = STAIRS.z[1] - run * (index + .5)
  storeyGroups[0].add(place(box([STAIRS.x[1] - STAIRS.x[0], height, run], stepMaterial), [(STAIRS.x[0] + STAIRS.x[1]) / 2, height / 2, z]))
}

// Porch posts and a small canopy.
const porch = room("porch")
const postMaterial = new T.MeshStandardMaterial({ color: 0x9c8466, roughness: .85 })
for (const [x, z] of [[porch.x[1] - .1, porch.z[1] - .1], [porch.x[1] - .1, porch.z[0] + .1]]) {
  storeyGroups[0].add(place(box([.12, 2.6, .12], postMaterial), [x, porch.deck + 1.3, z]))
}
const canopy = place(box([porch.x[1] - porch.x[0] + .3, .1, porch.z[1] - porch.z[0] + .3], postMaterial),
  [(porch.x[0] + porch.x[1]) / 2 + .15, porch.deck + 2.65, (porch.z[0] + porch.z[1]) / 2])

// Gable roof over the house, ridge along x.
const roofMaterial = new T.MeshStandardMaterial({ color: 0x8f6f5c, roughness: .8, transparent: true, opacity: .35, depthWrite: false })
const roof = new T.Group()
const roofTop = STOREYS[1].y + STOREYS[1].height
const halfDepth = (HOUSE.z[1] - HOUSE.z[0]) / 2 + .35
const pitch = Math.atan2(1.6, halfDepth)
for (const side of [-1, 1]) {
  const slab = box([7 - HOUSE.x[0] + .6, .12, halfDepth / Math.cos(pitch)], roofMaterial)
  slab.castShadow = false
  slab.position.set((HOUSE.x[0] + 7) / 2, roofTop + .8, side * halfDepth / 2)
  slab.rotation.x = side * pitch
  roof.add(slab)
}
roof.add(canopy)
scene.add(roof)

// Furniture placeholders and slot outlines.
const furnitureMaterial = new T.MeshStandardMaterial({ color: 0x9a9a94, roughness: .85 })
for (const item of FURNITURE) {
  storeyGroups[room(item.room).storey].add(place(box(item.size, furnitureMaterial), item.at))
}
const slotViews = new Map()
for (const slot of SLOTS) {
  const live = Boolean(slot.features?.length)
  const color = live ? 0x1f8f86 : 0xd08a1e
  const fill = new T.Mesh(new T.BoxGeometry(...slot.size), new T.MeshBasicMaterial({ color, transparent: true, opacity: live ? .2 : .1, depthWrite: false }))
  const edges = new T.LineSegments(new T.EdgesGeometry(fill.geometry), live
    ? new T.LineBasicMaterial({ color })
    : new T.LineDashedMaterial({ color, dashSize: .08, gapSize: .06 }))
  edges.computeLineDistances()
  const group = place(new T.Group(), slot.at)
  group.add(fill, edges)
  fill.userData.slot = slot
  storeyGroups[room(slot.room).storey].add(group)
  const tag = document.createElement("div")
  tag.className = `tag ${live ? "live" : "idea"}`
  tag.textContent = slot.name
  labelLayer.append(tag)
  slotViews.set(slot.id, { slot, fill, tag, top: new T.Vector3(slot.at[0], slot.at[1] + slot.size[1] / 2, slot.at[2]) })
}
const roomTags = ROOMS.map(item => {
  const tag = document.createElement("div")
  tag.className = "tag room"
  tag.textContent = item.name
  labelLayer.append(tag)
  const storey = STOREYS[item.storey]
  return { item, tag, at: new T.Vector3((item.x[0] + item.x[1]) / 2, storey.y + storey.height - .2, (item.z[0] + item.z[1]) / 2 - .6) }
})

// Views: target box plus a viewing direction from the open front.
const views = [
  { id: "overview", name: "总览", box: HOUSE, dir: [.38, .55, 1] },
  ...ROOMS.map(item => {
    const storey = STOREYS[item.storey]
    return { id: item.id, name: item.name, room: item,
      box: { x: item.x, y: [storey.y, storey.y + storey.height], z: item.z }, dir: item.outdoor ? [.55, .45, 1] : [.12, .42, 1] }
  }),
]
const buttons = new Map()
for (const view of views) {
  const button = document.createElement("button")
  button.type = "button"
  button.id = `view-${view.id}`
  button.textContent = view.name
  button.setAttribute("aria-pressed", "false")
  button.addEventListener("click", () => go(view.id))
  nav.append(button)
  buttons.set(view.id, button)
}

function frame(view) {
  const { box: b } = view
  const centre = new T.Vector3((b.x[0] + b.x[1]) / 2, (b.y[0] + b.y[1]) / 2, (b.z[0] + b.z[1]) / 2)
  const radius = Math.hypot(b.x[1] - b.x[0], b.y[1] - b.y[0], b.z[1] - b.z[0]) / 2
  const vertical = T.MathUtils.degToRad(FOV) / 2
  const horizontal = Math.atan(Math.tan(vertical) * camera.aspect)
  const distance = radius / Math.sin(Math.min(vertical, horizontal)) * .82
  return { target: centre, position: centre.clone().addScaledVector(new T.Vector3(...view.dir).normalize(), distance) }
}

let current = views[0]
let from = null
let to = frame(current)
let started = 0
let picked = null
const DURATION = 900

function go(id, instant = false) {
  current = views.find(view => view.id === id) || views[0]
  for (const [key, button] of buttons) button.setAttribute("aria-pressed", String(key === current.id))
  from = instant ? null : { target: lookTarget.clone(), position: camera.position.clone() }
  to = frame(current)
  started = performance.now()
  picked = null
  showInfo()
  document.body.dataset.view = current.id
}

function showInfo() {
  const slots = current.room ? SLOTS.filter(slot => slot.room === current.room.id) : SLOTS
  const reserved = slots.filter(slot => !slot.features?.length).length
  const title = current.room ? current.room.name : "整栋小屋"
  const note = current.room
    ? `${STOREYS[current.room.storey].name} · ${(current.room.x[1] - current.room.x[0]).toFixed(2)} × ${(current.room.z[1] - current.room.z[0]).toFixed(2)} m`
    : `${ROOMS.length} 个房间 · ${SLOTS.length} 个位置`
  info.innerHTML = `<h2></h2><p></p><ul></ul>`
  info.querySelector("h2").textContent = title
  info.querySelector("p").textContent = `${note} · 已有功能 ${slots.length - reserved} · 预留 ${reserved}`
  const list = info.querySelector("ul")
  for (const slot of slots) {
    const item = document.createElement("li")
    item.className = `${slot.features?.length ? "live" : "idea"}${picked === slot.id ? " picked" : ""}`
    item.dataset.slot = slot.id
    const name = document.createElement("b")
    name.textContent = slot.name
    const detail = document.createElement("small")
    const where = current.room ? "" : `${room(slot.room).name} · `
    detail.textContent = `${where}${KIND_NAMES[slot.kind]} · ${slot.features?.length
      ? `现有：${slot.features.map(feature => FEATURE_NAMES[feature] || feature).join("、")}` : `设想：${slot.idea}`}`
    item.append(name, detail)
    item.addEventListener("click", () => pick(slot.id))
    list.append(item)
  }
}

function pick(id) {
  picked = picked === id ? null : id
  for (const item of info.querySelectorAll("li")) item.classList.toggle("picked", item.dataset.slot === picked)
  for (const [key, view] of slotViews) view.fill.material.opacity = key === picked ? .5 : view.slot.features?.length ? .2 : .1
}

const pointer = new T.Vector2()
const ray = new T.Raycaster()
renderer.domElement.addEventListener("click", event => {
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
  ray.setFromCamera(pointer, camera)
  const fills = [...slotViews.values()].filter(view => view.fill.visible && view.fill.parent.parent.visible).map(view => view.fill)
  const hit = ray.intersectObjects(fills, false)[0]
  if (!hit) return
  const slot = hit.object.userData.slot
  if (current.room && current.room.id !== slot.room) go(slot.room)
  pick(slot.id)
})

const lookTarget = new T.Vector3()
const projected = new T.Vector3()
const ease = value => value < .5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2

function visibility() {
  const upper = !current.room || current.room.storey === 1
  storeyGroups[1].visible = upper
  roof.visible = !current.room
  for (const mesh of walls) {
    const { wall } = mesh.userData
    const axis = wall.axis === "x" ? "x" : "z"
    // Fade a wall when it stands between the camera and what we are looking at.
    const blocking = (camera.position[axis] - wall.at) * (lookTarget[axis] - wall.at) < 0
    const goal = blocking ? .16 : 1
    mesh.material.opacity += (goal - mesh.material.opacity) * .18
    mesh.material.depthWrite = mesh.material.opacity > .9
    mesh.castShadow = mesh.material.opacity > .5
  }
}

function placeTags() {
  const width = innerWidth
  const height = innerHeight
  const show = (tag, point, visible) => {
    projected.copy(point).project(camera)
    const inside = visible && projected.z < 1 && Math.abs(projected.x) < 1.05 && Math.abs(projected.y) < 1.05
    tag.style.opacity = inside ? "1" : "0"
    if (inside) tag.style.transform = `translate(${(projected.x + 1) / 2 * width}px, ${(1 - projected.y) / 2 * height}px) translate(-50%, -100%)`
  }
  for (const view of slotViews.values()) {
    const storey = room(view.slot.room).storey
    view.tag.classList.toggle("picked", view.slot.id === picked)
    show(view.tag, view.top, Boolean(current.room) && view.slot.room === current.room.id && storeyGroups[storey].visible)
  }
  for (const entry of roomTags) show(entry.tag, entry.at, !current.room && storeyGroups[entry.item.storey].visible)
}

function resize() {
  renderer.setSize(innerWidth, innerHeight)
  camera.aspect = innerWidth / Math.max(1, innerHeight)
  camera.updateProjectionMatrix()
  to = frame(current)
}

function tick(now) {
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
  renderer.render(scene, camera)
  placeTags()
  requestAnimationFrame(tick)
}

addEventListener("resize", resize)
resize()
go(new URLSearchParams(location.search).get("view") || "overview", true)
requestAnimationFrame(tick)
window.__blockout = { ready: true, go, get view() { return current.id }, get moving() { return Boolean(from) } }
