// Yui in the cottage. The model comes from tools/assets/export_yui_web.py as a GLB with MMD-style bone names
// and a few face shapes. Her motion is built in layers, the way living characters in games usually are:
//   1. body: captured idle clips from the host (VRMA), crossfaded at random, or a light procedural idle;
//   2. gaze: the eyes lead and the head and neck follow late; small eye jumps; glances away and back;
//   3. face: blinks that come with glances, a small smile on eye contact, brows that move with attention;
//   4. reactions: a gesture when clicked, shyness when stared at, a look at whatever the visitor opens;
//   5. secondary: ears, tail and ponytails;
//   6. touch: in the closeup she can be touched (head, cheek, chin, hand, ears, tail) and reacts by relationship tier;
//   7. her day: besides standing she walks, sits, types, reads a tablet and sleeps (cottage-yui-life.mjs moves her
//      through the house and chooses the pose; the poses are clips from the host's motion library).
// It only moves when the caller allows motion (not on low quality or with reduced motion).
import * as T from "./engine/three.module.min.js"
import { GLTFLoader } from "./engine/three-gltf.mjs?v=0.9.29"
import { createSprings } from "./cottage-springs.mjs?v=0.9.50"
import { reach, turnBone } from "./cottage-reach.mjs?v=0.9.51"
import { YUI_RAMP, addHull, faceCharacterLight, lightCharacter } from "./cottage-style.mjs?v=0.9.48.3"

// Standing spot in the living room, at the front of the rug, turned toward the room view. The model faces +z.
const PLACE = { x: .25, z: 1.5, turn: .55, height: 1.55 }
// Body proportions (0.9.48). The source model is about 6.5 heads tall with long legs and a long neck, so the head
// read as small next to the body. The head is scaled up as a whole (hair, ears and eyes come along), the head is
// moved closer to the neck, and thighs and shins are shortened a little by moving the knees and ankles up their
// bones. Bone placement only: the poses (rotations) and the source file are unchanged.
export const PROPORTIONS = { head: 1.1, neck: .9, legs: 1 }
const CHEST = new T.Vector3(0, 1.2, 0)
const IDLE_CLIPS = ["idle01", "idle02", "idle03", "idle04", "idle05"]
// The host's greeting clip is a deep squat that pushes the legs through the skirt (no cloth simulation here),
// so only the standing gestures are used.
const GESTURES = ["vsign", "liked"]
// Answers to a click (0.9.49, react): startled while busy on her feet, and laughing in her seat.
const REACTIONS = ["startle", "sit-laugh"]
// The part of the seated laugh she plays (seconds of the clip): upright, before she doubles over.
const SEAT_LAUGH = { clip: "sit-laugh", from: 1, to: 3.3, fade: .6 }
// The clips held for each pose other than standing (looped), and the ones that play once over a standing pose.
// Sleep is mostly the quiet loop, now and then the one where she turns over.
const POSES = { walk: ["walk"], sit: ["sit"], type: ["type"], tablet: ["tablet"], sleep: ["sleep", "sleep-turn"] }
const ONCE = ["yawn", "stretch"]
// Played in parts by cottage-yui-life.mjs (perform): sitting up in bed and standing, or the same backwards.
const ACTS = ["getup"]
// The sleeping clips lie across her own frame (head to her right); turned a quarter round they lie along it, the way
// the getting-up clip starts, so one can follow the other in bed without her body swinging round.
const CLIP_TURN = { sleep: -Math.PI / 2, "sleep-turn": -Math.PI / 2 }
// Poses with her feet on the floor, which keep the ankles at their resting height (see `ground`).
const GROUNDED = new Set(["stand", "walk", "tablet"])
// Small turns on top of a clip, by clip, in the model frame (x: pitch, negative lifts): typing, the captured
// performer hunched over the keyboard with her face out of sight; Yui sits up a little and looks at the screen.
const CLIP_FIX = { type: { "上半身": [-.1, 0, 0], "上半身2": [-.06, 0, 0], "首": [-.16, 0, 0], "頭": [-.14, 0, 0] } }
const CLIPS = [...IDLE_CLIPS, ...GESTURES, ...REACTIONS, ...new Set(Object.values(POSES).flat()), ...ONCE, ...ACTS]
// Things in the living room she glances at (world positions).
const INTEREST = [[-1.3, 1.9, -2.6], [-.2, .7, .38], [1.25, 1, -2.1], [-1.1, .8, -1.4], [1.4, .9, 1.1], [-2.5, .4, 1.9]]
  .map(([x, y, z]) => new T.Vector3(x, y, z))
// The front door, seen through the kitchen doorway: where she watches for you after a few days apart.
const DOOR = new T.Vector3(7, 1.45, 1.9)

// VRM humanoid bone -> Yui's MMD bone. VRM's upperChest folds into 上半身2.
const RIG = { hips: "グルーブ", spine: "上半身", chest: "上半身2", neck: "首", head: "頭" }
const FINGERS = {
  ThumbMetacarpal: "親指0", ThumbProximal: "親指1", ThumbDistal: "親指2",
  IndexProximal: "人指1", IndexIntermediate: "人指2", IndexDistal: "人指3",
  MiddleProximal: "中指1", MiddleIntermediate: "中指2", MiddleDistal: "中指3",
  RingProximal: "薬指1", RingIntermediate: "薬指2", RingDistal: "薬指3",
  LittleProximal: "小指1", LittleIntermediate: "小指2", LittleDistal: "小指3",
}
for (const [side, mark] of [["left", "左"], ["right", "右"]]) {
  Object.assign(RIG, {
    [`${side}Shoulder`]: `${mark}肩`, [`${side}UpperArm`]: `${mark}腕`, [`${side}LowerArm`]: `${mark}ひじ`,
    [`${side}Hand`]: `${mark}手首`, [`${side}UpperLeg`]: `${mark}足`, [`${side}LowerLeg`]: `${mark}ひざ`,
    [`${side}Foot`]: `${mark}足首`, [`${side}Toes`]: `${mark}つま先`,
  })
  for (const [finger, name] of Object.entries(FINGERS)) RIG[`${side}${finger}`] = mark + name
}
const TAIL = ["尻尾1", "尻尾2", "尻尾3", "尻尾4", "尻尾5", "尻尾6"]
const EXTRA = ["左目", "右目", "左猫耳", "右猫耳", ...TAIL]

// Reaction tiers from most guarded to closest; the backend writes the same tier into the companion's prompt.
export const TOUCH_TIERS = ["dodge", "awkward", "accept", "enjoy", "lean"]
export const TOUCH_ZONES = ["head", "cheek", "hand", "ears", "tail", "chin"]
// Ears and tail are more sensitive: one tier more guarded (mirrors prompts.cottage_touch_reaction).
export const touchTier = (zone, stage) =>
  TOUCH_TIERS[clamp(Math.round(stage) - (zone === "ears" || zone === "tail" ? 1 : 0), 0, TOUCH_TIERS.length - 1)]
// Face for each tier: smile, eyes closed, happy eyes, worried and lowered brows, wide eyes.
const TOUCH_FACE = {
  dodge: { smile: 0, closed: 0, happy: 0, worried: .2, lower: .55, wide: .45 },
  awkward: { smile: .25, closed: 0, happy: .1, worried: .45, lower: 0, wide: .2 },
  accept: { smile: .45, closed: .35, happy: .3, worried: 0, lower: 0, wide: 0 },
  enjoy: { smile: .8, closed: .85, happy: .8, worried: 0, lower: 0, wide: 0 },
  lean: { smile: .9, closed: .7, happy: .9, worried: 0, lower: 0, wide: 0 },
}

const damp = (value, target, rate, dt) => value + (target - value) * (1 - Math.exp(-rate * dt))
const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
const pick = list => list[Math.floor(Math.random() * list.length)]

async function readClip(loader, url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: ${response.status}`)
  let data = await response.arrayBuffer()
  const head = new Uint8Array(data, 0, 2)
  if (head[0] === 0x1f && head[1] === 0x8b) {
    data = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()
  }
  const gltf = await loader.parseAsync(data, "")
  const json = gltf.parser.json
  const humanBones = json.extensions?.VRMC_vrm_animation?.humanoid?.humanBones
  const animation = gltf.animations[0]
  if (!humanBones || !animation) throw new Error(`${url}: not a VRM animation`)
  // A track value is the bone's rotation against its parent, on the rig the clip was made with. Some rigs rest in a
  // T-pose with every rotation zero (the idles), others carry rest rotations on their bones (the host's motion
  // library: legs turned half round, for one). Each value becomes the bone's turn in the character's frame, as VRM
  // animation players normalise it: parent's world rest * value * own world rest^-1.
  gltf.scene.updateMatrixWorld(true)
  const rotations = {}
  let hips = null
  const world = new T.Quaternion()
  const parentWorld = new T.Quaternion()
  const value = new T.Quaternion()
  const point = new T.Vector3()
  const objects = {}
  for (const [bone, { node }] of Object.entries(humanBones)) {
    const object = objects[bone] = await gltf.parser.getDependency("node", node)
    const track = animation.tracks.find(item => item.name === `${object.name}.quaternion`)
    if (track) {
      object.getWorldQuaternion(world).invert()
      if (object.parent) object.parent.getWorldQuaternion(parentWorld)
      else parentWorld.identity()
      for (let i = 0; i < track.values.length; i += 4) {
        value.fromArray(track.values, i).premultiply(parentWorld).multiply(world).toArray(track.values, i)
      }
      rotations[bone] = track.createInterpolant()
    }
    if (bone === "hips") {
      const position = animation.tracks.find(item => item.name === `${object.name}.position`)
      if (position && object.parent) {
        for (let i = 0; i < position.values.length; i += 3) {
          point.fromArray(position.values, i).applyMatrix4(object.parent.matrixWorld).toArray(position.values, i)
        }
      }
      hips = position?.createInterpolant() || null
    }
  }
  // Hip height (in the clip's world, like its root motion) scales the root motion onto Yui.
  const rest = objects.hips.getWorldPosition(new T.Vector3())
  return { duration: animation.duration, rotations, hips, rest, legHeight: objects.leftUpperLeg.getWorldPosition(point).y }
}

function shapeBody(model, { head = 1, neck = 1, legs = 1 }) {
  const bone = name => model.getObjectByName(name)
  const headBone = bone("頭")
  if (headBone) {
    headBone.scale.multiplyScalar(head)
    headBone.position.multiplyScalar(neck)
  }
  // Shorter legs lift the feet; the whole model goes down by as much, so she still stands on the floor.
  const ankle = bone("左足首")
  const point = new T.Vector3()
  model.updateMatrixWorld(true)
  const before = ankle ? ankle.getWorldPosition(point).y : 0
  for (const name of ["左ひざ", "右ひざ", "左足首", "右足首"]) bone(name)?.position.multiplyScalar(legs)
  if (!ankle) return
  model.updateMatrixWorld(true)
  model.position.y -= ankle.getWorldPosition(point).y - before
}

export async function loadYui(scene, base, { style = "classic", proportions = PROPORTIONS } = {}) {
  const lofi = style === "lofi"
  const loader = new GLTFLoader()
  const gltf = await loader.loadAsync(`${base}/yui.glb?v=0.9.48.3`)
  const model = gltf.scene
  const size = new T.Box3().setFromObject(model).getSize(new T.Vector3())
  const root = new T.Group()
  root.position.set(PLACE.x, .04, PLACE.z)
  root.rotation.y = PLACE.turn
  model.scale.setScalar(PLACE.height / size.y)
  root.add(model)
  scene.add(root)

  // Anime-style shading: realistic light and shadow on this face reads as uncanny, so the face is almost
  // flat and hair and clothes get two soft steps. Part of the colour is self-lit; the caller dims it with the
  // room light so Yui does not glow at night.
  const ramp = steps => {
    const texture = new T.DataTexture(new Uint8Array(steps), steps.length, 1, T.RedFormat)
    texture.minFilter = texture.magFilter = T.NearestFilter
    texture.needsUpdate = true
    return texture
  }
  // The lofi look (cottage-style.mjs) uses harder steps, less self-light and a rim along her outline.
  const soft = ramp(lofi ? YUI_RAMP.body : [190, 235, 255])
  const flat = ramp(lofi ? YUI_RAMP.face : [235, 255])
  const toonMaterials = new Map()
  const glowing = []
  const toon = old => {
    if (toonMaterials.has(old)) return toonMaterials.get(old)
    const face = /Face|Head|Lashes|Brows|Socket|Iris|Eye|Teeth|Tongue|Mouth/.test(old.name)
    const material = new T.MeshToonMaterial({
      name: old.name, map: old.map, gradientMap: face ? flat : soft, transparent: old.transparent, side: old.side,
      emissive: 0xffffff, emissiveMap: old.emissiveMap || old.map, vertexColors: old.vertexColors,
    })
    material.userData.see = old.transparent
    // Lofi: her own light rig (cottage-style.mjs) instead of the room lights and the self-lit glow. The eye
    // highlights (their own emissive image) stay unlit either way.
    if (lofi && !old.emissiveMap) {
      const kind = /Lash|Brow|Socket|Iris|Eye|Teeth|Tongue|Mouth/.test(old.name) ? "eye" : face ? "face"
        : /Hair/.test(old.name) ? "hair" : /Cardigan|Skirt|Stockings/.test(old.name) ? "cloth" : "body"
      lightCharacter(material, kind)
    } else if (!old.emissiveMap) glowing.push([material, face ? .7 : .62])
    old.dispose()
    toonMaterials.set(old, material)
    return material
  }

  const shapes = new Map()
  model.traverse(object => {
    if (!object.isMesh) return
    object.castShadow = true
    // Hair shadows on the face look like dark bruises; the face and eyes skip received shadows.
    object.receiveShadow = !/Head|Face|Lashes|Brows|Iris|Eye/.test(object.name)
    object.frustumCulled = false
    const material = object.material = toon(object.material)
    if (material.transparent) {
      material.depthWrite = false
      object.renderOrder = 1
    }
    for (const [name, index] of Object.entries(object.morphTargetDictionary || {})) {
      if (!shapes.has(name)) shapes.set(name, [])
      shapes.get(name).push([object, index])
    }
  })
  // Ink outline in the lofi look; not on the parts inside the face, nor on see-through ones.
  const hulls = []
  if (lofi) {
    const meshes = []
    model.traverse(object => { if (object.isSkinnedMesh && !object.material.transparent) meshes.push(object) })
    for (const mesh of meshes) {
      if (/Lashes|Brows|Iris|Eye|Teeth|Tongue|Mouth|Socket|RootLining|Buttons|Pendant/.test(mesh.name)) continue
      hulls.push(addHull(mesh))
    }
  }
  const shape = (name, value) => { for (const [mesh, index] of shapes.get(name) || []) mesh.morphTargetInfluences[index] = value }
  shapeBody(model, proportions)
  // From the root, so the room placement is in every world matrix before rest positions are read into the
  // model frame (0.9.31-0.9.35 read them half-updated, which moved her hips by her room position again).
  root.updateMatrixWorld(true)

  // Every bone is turned by a rotation in the model's own frame (y up, facing +z): local = rest * W^-1 * delta * W,
  // where W is the bone's rest rotation in that frame. All rest frames are read before anything moves.
  const toModel = new T.Matrix4().copy(model.matrixWorld).invert()
  const modelTurn = model.getWorldQuaternion(new T.Quaternion()).invert()
  const bones = new Map()
  for (const name of [...new Set([...Object.values(RIG), ...EXTRA])]) {
    const object = model.getObjectByName(name)
    if (!object) { console.warn("cottage: Yui bone missing", name); continue }
    bones.set(name, {
      object, rest: object.quaternion.clone(), position: object.position.clone(),
      frame: modelTurn.clone().multiply(object.getWorldQuaternion(new T.Quaternion())),
      at: object.getWorldPosition(new T.Vector3()).applyMatrix4(toModel),
      delta: new T.Quaternion(),
    })
  }
  const bonePosition = name => bones.get(name)?.at || new T.Vector3()

  // The arms rest in an A-pose; the clips assume a T-pose. Each arm bone gets a correction C that lifts it to the
  // T-pose, and a clip turn q becomes C_parent^-1 * q * C on that bone.
  const corrections = new Map()
  for (const [mark, direction] of [["左", new T.Vector3(1, 0, 0)], ["右", new T.Vector3(-1, 0, 0)]]) {
    const upper = bonePosition(`${mark}腕`)
    const elbow = bonePosition(`${mark}ひじ`)
    const wrist = bonePosition(`${mark}手首`)
    const upperFix = new T.Quaternion().setFromUnitVectors(elbow.clone().sub(upper).normalize(), direction)
    const forearm = wrist.clone().sub(elbow).normalize().applyQuaternion(upperFix)
    const lowerFix = new T.Quaternion().setFromUnitVectors(forearm, direction).multiply(upperFix)
    corrections.set(`${mark}腕`, [new T.Quaternion(), upperFix])
    corrections.set(`${mark}ひじ`, [upperFix, lowerFix])
    corrections.set(`${mark}手首`, [lowerFix, lowerFix])
    for (const name of Object.values(FINGERS)) corrections.set(mark + name, [lowerFix, lowerFix])
  }

  // Root motion goes to グルーブ, mapped from the model frame into its parent's space.
  const groove = bones.get("グルーブ")
  const grooveSpace = new T.Matrix4().copy(groove.object.parent.matrixWorld).invert().multiply(model.matrixWorld)
  const grooveLinear = new T.Matrix3().setFromMatrix4(grooveSpace)
  const grooveRest = groove.at.clone()
  const legHeight = bonePosition("左足").y
  const headRest = bonePosition("頭")
  const headJoint = model.getObjectByName("頭")
  const headAt = new T.Vector3()
  // Feet stay on the floor: the captured clips were made for other leg lengths, so the hips are nudged up or down
  // until the lower ankle is back at its resting height (this also turns the "liked" hop into a small bounce).
  const ankles = ["左足首", "右足首"].map(name => bones.get(name)?.object).filter(Boolean)
  // Measured from her root, so the same correction holds on any floor of the house.
  const ankleRest = Math.min(...ankles.map(ankle => ankle.getWorldPosition(new T.Vector3()).y)) - root.position.y
  const anklePoint = new T.Vector3()
  let ground = 0
  // Lying or sitting on a bed, the clips (made on a hard floor) sink her limbs into the mattress: `raise` lifts her
  // until her lowest part rests on it (at once when she would sink, slowly back down).
  // Body parts as capsules between two bones (radius in metres), for that and for the duvet over her.
  // `cap`: how far it may lift a duvet over her (her legs tent it; sitting up, her back and arms do not lift it to
  // her shoulders; her head stays out).
  const CAPSULES = [["左足", "左ひざ", .1, .36], ["左ひざ", "左足首", .07, .36], ["右足", "右ひざ", .1, .36],
    ["右ひざ", "右足首", .07, .36], ["左足首", "左つま先", .065, .36], ["右足首", "右つま先", .065, .36],
    ["左足", "右足", .17, .3], ["下半身", "上半身2", .16, .26], ["上半身2", "首", .15, .22],
    ["左腕", "左ひじ", .07, .2], ["左ひじ", "左手首", .06, .2], ["右腕", "右ひじ", .07, .2], ["右ひじ", "右手首", .06, .2],
    ["頭", "頭", .1, 0],
    // The skirt's hem (moved by its springs): under the duvet only, not something she rests on.
    ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => [`スカート_${i}_1`, `スカート_${i}_3`, .05, .3, false]),
    // So is her tail.
    ...TAIL.slice(1).map((name, i) => [TAIL[i], name, .035, .25, false])]
  const capsules = CAPSULES.map(([from, to, radius, cap, rests = true]) => ({ from: bones.get(from)?.object || named(from),
    to: bones.get(to)?.object || named(to), radius, cap, rests, a: new T.Vector3(), b: new T.Vector3() }))
    .filter(item => item.from && item.to)
  let raise = 0
  // Seated (0.9.49): the sitting clips were made for another chair, so her hips go up or down onto the seat's top.
  // `seatShift` is that lift in model units; the parts that rest on a seat are her hip joints and upper thighs,
  // whose underside is SEAT_DEPTH (room metres) below the bone line.
  let seatShift = 0
  const SEAT_DEPTH = .085
  // Her hands stay out of her head (the clips were made for a smaller one, 0.9.48) and, seated, above the seat:
  // a sphere round her head (centre carried by the head bone, radius in room metres) and the points of each hand
  // that are checked (wrist, index and middle fingertips).
  const HEAD_RADIUS = .1
  const headBone = named("頭")
  const headCentre = new T.Vector3()
  if (headBone) {
    model.localToWorld(headCentre.copy(bonePosition("頭")).addScaledVector(new T.Vector3(0, .075, .012), 1 / model.scale.y))
    headBone.worldToLocal(headCentre)
  }
  // Where the closeup looks (chest), from her root: CHEST while she stands, else her chest bone raised by as much
  // as CHEST is above it standing.
  const chestBone = named("上半身2")
  const chestRaise = new T.Vector3()
  if (chestBone) {
    root.updateMatrixWorld(true)
    const at = model.localToWorld(bonePosition("上半身2").clone()).sub(root.getWorldPosition(new T.Vector3()))
    chestRaise.set(0, CHEST.y - at.y, 0)
  }
  const chestLift = CHEST.clone()
  const chestAt = new T.Vector3()
  function followChest(dt) {
    if (!chestBone || GROUNDED.has(pose) && !act) chestAt.copy(CHEST)
    else chestBone.getWorldPosition(chestAt).sub(root.position).add(chestRaise)
    chestLift.lerp(chestAt, dt > 0 ? 1 - Math.exp(-3 * dt) : 1)
  }
  const hands = ["左", "右"].map(mark => ({
    upper: named(`${mark}腕`), lower: named(`${mark}ひじ`), hand: named(`${mark}手首`),
    tips: [named(`${mark}手首`), named(`${mark}人指3`), named(`${mark}中指3`)].filter(Boolean),
    push: new T.Vector3(), wanted: new T.Vector3(),
  })).filter(arm => arm.upper && arm.lower && arm.hand)
  const handPoint = new T.Vector3()
  const headPoint = new T.Vector3()
  const thighs = ["左", "右"].map(mark => [named(`${mark}足`), named(`${mark}ひざ`)]).filter(([hip, knee]) => hip && knee)
  const thighPoint = new T.Vector3()
  const kneePoint = new T.Vector3()

  // Hit area for clicks and hover: a simple column around her.
  const hitArea = new T.Mesh(new T.CylinderGeometry(.24, .24, PLACE.height * .96, 10), new T.MeshBasicMaterial())
  hitArea.position.y = PLACE.height * .48
  hitArea.visible = false
  root.add(hitArea)
  root.updateMatrixWorld(true)

  // Touch zones for the closeup: invisible spheres carried by her bones, so they follow every pose.
  // Offsets are metres in the model frame (y up, facing +z, her left at +x), from each bone at rest.
  const unit = model.scale.y
  const along = (from, to, metres) => bonePosition(to).clone().sub(bonePosition(from)).setLength(metres)
  const ZONES = [
    ["head", "頭", new T.Vector3(0, .17, -.01), .105, 0],
    ["cheek", "頭", new T.Vector3(.052, .038, .065), .032, 1], ["cheek", "頭", new T.Vector3(-.052, .038, .065), .032, -1],
    ["chin", "頭", new T.Vector3(0, -.01, .056), .032, 0],
    ["ears", "左猫耳", new T.Vector3(0, .03, 0), .04, 1], ["ears", "右猫耳", new T.Vector3(0, .03, 0), .04, -1],
    ["hand", "左手首", along("左ひじ", "左手首", .06), .055, 1], ["hand", "右手首", along("右ひじ", "右手首", .06), .055, -1],
    ["tail", "尻尾3", new T.Vector3(), .07, 0], ["tail", "尻尾5", new T.Vector3(), .06, 0],
  ]
  const zoneShape = new T.SphereGeometry(1, 10, 8)
  const zoneMaterial = new T.MeshBasicMaterial({ color: 0xff6699, wireframe: true })
  const zones = []
  const restPoint = new T.Vector3()
  for (const [zone, name, shift, radius, side] of ZONES) {
    const bone = bones.get(name)?.object
    if (!bone) continue
    const sphere = new T.Mesh(zoneShape, zoneMaterial)
    sphere.visible = false
    sphere.userData = { zone, side }
    model.localToWorld(restPoint.copy(bonePosition(name)).addScaledVector(shift, 1 / unit))
    sphere.position.copy(bone.worldToLocal(restPoint))
    sphere.scale.setScalar(radius / bone.getWorldScale(new T.Vector3()).x)
    bone.add(sphere)
    zones.push(sphere)
  }

  // Skirt (eight chains of three around the waist) and ponytails (four joints each) swing on springs.
  // Capsules around the thighs and shins keep the skirt outside the legs; the body and shoulders hold the hair.
  // Distances are in room metres (Yui is 1.55 m tall).
  function named(name) { return model.getObjectByName(name) }
  // The skirt's chains go round the waist in order, so they are solved as a ring.
  // Each panel also swings with the thigh beside it: fully for panels over the leg, partly toward the front
  // (a leg stepping forward pushes the front of the skirt), not at all at the back.
  const pelvis = named("下半身")
  const across = bone => {
    const point = bone.getWorldPosition(new T.Vector3()).applyMatrix4(toModel).sub(pelvis.getWorldPosition(new T.Vector3()).applyMatrix4(toModel))
    return point.setY(0).normalize()
  }
  const skirtFollow = []
  const SEATED_FOLLOW = .8
  // How far (radians) a skirt panel may swing in toward her past where the animation points it (0.9.50).
  const SKIRT_BACKSTOP = .3
  // The thigh capsules the skirt is held out by (0.9.50: .066). Larger than the thigh, so that between two chains,
  // where the skirt's surface runs straight from one to the other, a thigh stepping forward stays behind it.
  const THIGH_RADIUS = .09
  const skirt = Array.from({ length: 8 }, (_, i) => {
    const bones = [1, 2, 3].map(n => named(`スカート_${i}_${n}`))
    const side = bones[0] && pelvis ? across(bones[0]) : null
    const follow = side ? ["左", "右"].map(mark => named(`${mark}足`)).filter(Boolean).map(limb => {
      return { limb, base: pelvis, weight: Math.min(.85, .8 * Math.max(0, side.dot(across(limb))) + .35 * Math.max(0, side.z)) }
    }) : []
    // The front panels sit between both legs; their two shares together stay within one leg's (0.9.49: added up,
    // seated thighs turned them nearly twice as far, so the front of the skirt stood up off her lap). Seated, the
    // panels in front turn with her thighs most of the way (shares adding up to SEATED_FOLLOW for the front one:
    // their pivot is at the waist, above the hip joints, so turning all the way would hold them up off her thighs)
    // and lie on her lap (the front and the two beside it lie over her thighs); at her sides a little, so they hang
    // from her waist down beside her; at the back not at all.
    const total = follow.reduce((sum, item) => sum + item.weight, 0)
    if (total > .85) for (const item of follow) item.weight *= .85 / total
    for (const item of follow) Object.assign(item, { standing: item.weight, seated: total > .2 ? item.weight / total * SEATED_FOLLOW * clamp((side.z + .15) / .75, 0, 1) : 0 })
    skirtFollow.push(...follow)
    return { bones, stiffness: [6, 2.6, 1.6], drag: .42, gravity: .15, radius: .015, tip: .9, follow }
  })
  const ponytails = ["左", "右"].map(mark => ({
    bones: [1, 2, 3, 4].map(n => named(`${mark}髪${n}`)), stiffness: [8, 3, 1.4, 1], drag: .35, gravity: .5,
    radius: .03, tip: 1.6,
  }))
  const complete = chains => chains.filter(chain => chain.bones.every(Boolean))
  const legs = ["左", "右"].flatMap(mark => [
    { from: named(`${mark}足`), to: named(`${mark}ひざ`), radius: THIGH_RADIUS, start: .2 },
    { from: named(`${mark}ひざ`), to: named(`${mark}足首`), radius: .055 },
  ])
  // Seated, her seat (between the hip joints, a little behind them) holds the back of the skirt off her; standing, the skirt is wider
  // than her hips there and this stays off so it does not flare.
  const hipsCollider = { from: named("左足"), to: named("右足"), radius: .085, enabled: false, offset: new T.Vector3() }
  const colliders = [...legs, hipsCollider, { from: named("上半身"), to: named("首"), radius: .085 },
    { from: named("左腕"), radius: .05 }, { from: named("右腕"), radius: .05 }].filter(item => item.from)
  // The skirt's eight chains, all there (the ring, and the baked seated skirt, need every one).
  const skirtWhole = complete(skirt).length === 8
  const springs = createSprings([
    { ring: skirtWhole, chains: complete(skirt), backstop: pelvis ? { centre: pelvis, angle: SKIRT_BACKSTOP } : null },
    { ring: false, chains: complete(ponytails) },
  ], colliders)
  springs.reset()

  // Motion clips load in the background; until they do (or if they cannot), a procedural idle stands in.
  const clips = {}
  // The skirt draped over her seated legs, baked in Blender (0.9.50, tools/assets/skirt_bake.py): by clip, by clip
  // time, the skirt joints' tails in her pelvis's frame. Without it the springs alone hold the seated skirt.
  let drape = null
  const draped = fetch(`${base}/skirt-seated.json?v=0.9.50`).then(response => response.ok ? response.json() : null)
    .then(data => { drape = data?.clips || null })
    .catch(error => console.warn("cottage: Yui's seated skirt unavailable", error))
  const motion = Promise.all([draped, ...CLIPS.map(name =>
    readClip(loader, `${base}/motion/${name}.vrma.gz?v=0.9.41`).then(clip => {
      if (CLIP_TURN[name]) clip.turn = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), CLIP_TURN[name])
      clips[name] = clip
    })
      .catch(error => console.warn("cottage: Yui motion unavailable", name, error)))]).then(() => {
    motionReady = true
    return Object.keys(clips).length
  })
  let motionReady = false

  // ---- state
  let clock = 0
  let tailPhase = 0
  let still = false
  let current = null
  let previous = null
  let fade = 1
  let gesture = null
  let lastGesture = null
  // Her pose (stand, or one of POSES), one-shot clips waiting to play over standing, and the one playing.
  let pose = "stand"
  let queue = []
  let once = null
  // A sequence of clip parts (perform): { parts, index }.
  let act = null
  // Busy with something (cottage-yui-life.mjs): where her attention is, and whether she is asleep.
  let task = null
  let asleep = false
  let stillKey = ""
  let shownFade = 1
  // The springs start again at rest after a jump into a pose (set in body, done once the pose is applied).
  let resetSprings = false
  // gaze
  const gaze = { mode: "you", until: 3 + Math.random() * 3, target: new T.Vector3(), headYaw: 0, headPitch: 0,
    eyeYaw: 0, eyePitch: 0, jumpYaw: 0, jumpPitch: 0, nextJump: .8, contact: 0, twist: .12 }
  // face
  const face = { blink: 0, nextBlink: 2, doubleBlink: false, smile: 0, happy: 0, raise: 0, worried: 0, wide: 0,
    raisePulse: 0, widePulse: 0 }
  const ears = { flick: 0, nextFlick: 4, back: 0, perk: 0 }
  let hoverTime = 0
  let shyFor = 0
  let reactFor = 0
  // Mood from the relationship (see setMood). warmth 0..1 follows the relationship stage.
  const mood = { warmth: .5, low: false, occasion: false }
  let moodSeen = false
  let settled = false
  let waiting = 0
  let celebrate = 0
  // Woken up: 0..1, how cross she still is (from cottage-yui-life.mjs), and the face shown for it.
  let grumpy = 0
  let grumpyShown = 0
  // Touch: which zone, the reaction tier, which side of her (+1 her left), whether the hand is still on her,
  // and how far the reaction has come in (0..1).
  // Its timing follows the wall clock, so a slow frame rate neither stretches the wait nor shortens a held touch.
  // follow: where a stroking hand is across her head (-1..1), which her head leans after.
  const touch = { zone: null, tier: "accept", side: 0, held: false, start: 0, time: 0, released: 0, weight: 0,
    follow: 0, followGoal: 0, direction: 0 }
  const touchClock = () => (performance.now() - touch.start) / 1000
  // How long each reaction keeps playing after the hand leaves.
  const AFTER = { dodge: 1.1, awkward: 1.2, accept: 1.4, enjoy: 1.6, lean: 1.8 }
  let touchShown = false
  motion.then(() => { settled = true; showRoot() })

  const playIdle = (fadeSeconds = 1.4) => {
    const available = IDLE_CLIPS.filter(name => clips[name] && name !== current?.name)
    if (!available.length) return false
    startClip(pick(available), fadeSeconds)
    return true
  }
  // What plays next: a waiting one-shot, else the pose's clip (returns false to keep looping the one playing).
  function playBase(fadeSeconds = 1.2) {
    while (queue.length && GROUNDED.has(pose)) {
      const name = queue.shift()
      if (clips[name]) {
        once = name
        startClip(name, .6)
        return true
      }
    }
    queue = []
    const names = (POSES[pose] || []).filter(name => clips[name])
    if (!names.length) return playIdle(fadeSeconds)
    const name = names.length > 1 && current?.name === names[0] && Math.random() < .3 ? names[1] : names[0]
    if (name === current?.name) return false
    startClip(name, fadeSeconds)
    return true
  }
  // Plays clip parts one after another, each fading in over `fade` seconds:
  // [{ clip, from = 0, to = its end, speed = 1, fade = .4, hold }]. False (and nothing changes) if a clip is missing.
  // A part with `hold` stays on its last moment (acting.held) until the next perform.
  // While it plays, a new pose waits; at the end the pose's own clip follows.
  function perform(parts) {
    if (!parts.length || !parts.every(part => clips[part.clip])) return false
    gesture = once = null
    queue = []
    act = { parts, index: -1 }
    nextPart()
    return true
  }
  function nextPart() {
    act.index++
    const part = act.parts[act.index]
    if (!part) {
      act = null
      if (current) Object.assign(current, { part: null, rate: 1 })
      if (!playBase(.5) && current) current.time %= current.clip.duration
      return
    }
    const duration = clips[part.clip].duration
    const from = clamp(part.from ?? 0, 0, duration)
    const to = clamp(part.to ?? duration, 0, duration)
    startClip(part.clip, part.fade ?? .4)
    Object.assign(current, { time: from, end: to, rate: (to >= from ? 1 : -1) * (part.speed || 1), part, grounded: false, held: false })
  }

  function startClip(name, fadeSeconds) {
    // From the procedural pose, or in the middle of another fade: fade from the pose she is in right now
    // (the last frame's body layer) instead of snapping. A fade of 0 starts the clip as it is.
    const fromPose = fadeSeconds > 0 && (!current || (previous && fade < 1)) && bodyPose.size > 0
    previous = fromPose ? null : current
    // Whether the clip has her feet on the floor (the floor correction holds for it).
    current = { name, clip: clips[name], time: 0, fadeSeconds: Math.max(fadeSeconds, .01), grounded: GROUNDED.has(pose) }
    fade = previous && fadeSeconds > 0 ? 0 : 1
    if (!(fadeSeconds > 0)) { previous = null; startBlend = 0 }
    if (fromPose) {
      for (const [name, pose] of bodyPose) (startPose.get(name) || startPose.set(name, new T.Quaternion()).get(name)).copy(pose)
      startOffset.copy(bodyOffset)
      startBlend = 1
    }
  }
  const startPose = new Map()
  const startOffset = new T.Vector3()
  let startBlend = 0
  // The body layer of the last frame (before gaze and face), to fade from when a clip starts.
  const bodyPose = new Map()
  const bodyOffset = new T.Vector3()
  const keepBody = () => {
    for (const [name, entry] of bones) (bodyPose.get(name) || bodyPose.set(name, new T.Quaternion()).get(name)).copy(entry.delta)
    bodyOffset.copy(groove.object.position)
  }

  const scratch = new T.Quaternion()
  const other = new T.Quaternion()
  const euler = new T.Euler()
  const offset = new T.Vector3()
  const otherOffset = new T.Vector3()
  const values = new Map(Object.keys(RIG).map(bone => [bone, new T.Quaternion()]))
  const previousValues = new Map(Object.keys(RIG).map(bone => [bone, new T.Quaternion()]))
  values.set("upperChest", new T.Quaternion())
  previousValues.set("upperChest", new T.Quaternion())

  function sample(state, into, hipsInto) {
    const { clip, time } = state
    for (const [bone, quaternion] of into) {
      const interpolant = clip.rotations[bone]
      if (interpolant) quaternion.fromArray(interpolant.evaluate(time)).normalize()
      else quaternion.identity()
    }
    hipsInto.set(0, 0, 0)
    if (clip.hips) {
      hipsInto.fromArray(clip.hips.evaluate(time)).sub(clip.rest).multiplyScalar(legHeight / clip.legHeight)
      hipsInto.x = clamp(hipsInto.x, -.08, .08)
      hipsInto.z = clamp(hipsInto.z, -.08, .08)
    }
    if (clip.turn) {
      into.get("hips")?.premultiply(clip.turn)
      hipsInto.applyQuaternion(clip.turn)
    }
  }

  const setDelta = (name, x, y, z) => bones.get(name)?.delta.setFromEuler(euler.set(x, y, z, "YXZ"))
  const addDelta = (name, x, y, z) => {
    const entry = bones.get(name)
    if (entry) entry.delta.premultiply(scratch.setFromEuler(euler.set(x, y, z, "YXZ")))
  }

  // Body layer: captured clips when ready, else a light procedural idle (arms lowered from the A-pose).
  function body(dt) {
    for (const entry of bones.values()) entry.delta.identity()
    // The first clip once they have loaded: a pose she is already in (asleep, seated) starts as it is, without
    // fading from the procedural standing pose (which never showed: she stays hidden until then, see showRoot).
    if (motionReady && !current) {
      const instant = pose !== "stand"
      if (!playBase(instant ? 0 : 1.2)) motionReady = false
      else if (instant) { previous = null; fade = 1; startBlend = 0; resetSprings = true }
    }
    if (!current) {
      const breath = Math.sin(clock * 1.7)
      setDelta("上半身", breath * .012, Math.sin(clock * .23) * .03, 0)
      setDelta("上半身2", breath * .018, 0, 0)
      setDelta("左腕", 0, 0, -.2 - breath * .015)
      setDelta("右腕", 0, 0, .2 + breath * .015)
      groove.object.position.copy(groove.position)
      keepBody()
      return
    }
    if (current.part) {
      // A part of a performance: from one moment of its clip to another, backwards when it ends before it starts.
      if (!current.held) current.time += dt * current.rate
      if (!current.held && (current.rate > 0 ? current.time >= current.end : current.time <= current.end)) {
        current.time = current.end
        if (current.part.hold) current.held = true
        else nextPart()
      }
    } else {
      current.time += dt
      if (current.time >= current.clip.duration) {
        if (gesture && current.name === gesture) gesture = null
        if (once && current.name === once) once = null
        if (!playBase()) current.time %= current.clip.duration
      }
    }
    fade = Math.min(1, fade + dt / current.fadeSeconds)
    if (previous) previous.time = clamp(previous.time + dt * (previous.rate || 1), 0, previous.clip.duration)
    sample(current, values, offset)
    if (previous && fade < 1) {
      sample(previous, previousValues, otherOffset)
      const weight = T.MathUtils.smoothstep(fade, 0, 1)
      // Blend into the previous sample (re-read every frame): slerping a quaternion into itself would copy the
      // first argument over it and show the old clip until the fade ends, then snap.
      for (const [bone, quaternion] of values) quaternion.copy(previousValues.get(bone).slerp(quaternion, weight))
      offset.lerpVectors(otherOffset, offset, weight)
    } else previous = null
    for (const [bone, name] of Object.entries(RIG)) {
      const entry = bones.get(name)
      if (!entry) continue
      scratch.copy(values.get(bone))
      if (bone === "chest") scratch.multiply(values.get("upperChest"))
      const fix = corrections.get(name)
      if (fix) scratch.premultiply(other.copy(fix[0]).invert()).multiply(fix[1])
      entry.delta.copy(scratch)
    }
    // Per-clip touches, eased in and out with the clip itself.
    const fixWeight = previous && fade < 1 ? T.MathUtils.smoothstep(fade, 0, 1) : 1
    for (const [state, weight] of [[current, fixWeight], [previous && fade < 1 ? previous : null, 1 - fixWeight]]) {
      const fix = state && CLIP_FIX[state.name]
      if (fix) for (const [name, [x, y, z]] of Object.entries(fix)) addDelta(name, x * weight, y * weight, z * weight)
    }
    offset.y += ground + raise + seatShift
    groove.object.position.copy(offset.add(grooveRest).applyMatrix4(grooveSpace))
    if (startBlend > 0) {
      startBlend = Math.max(0, startBlend - dt / current.fadeSeconds)
      const weight = T.MathUtils.smoothstep(1 - startBlend, 0, 1)
      for (const [name, entry] of bones) {
        const from = startPose.get(name)
        if (from) entry.delta.copy(scratch.copy(from).slerp(entry.delta, weight))
      }
      groove.object.position.lerpVectors(startOffset, groove.object.position, weight)
    }
    keepBody()
  }

  const localPoint = new T.Vector3()
  const toLocal = point => model.worldToLocal(localPoint.copy(point))
  function chooseGaze(dt, viewer, focus, hovered) {
    gaze.until -= dt
    const previousMode = gaze.mode
    if (asleep) gaze.mode = "sleep"
    else if (task && reactFor <= 0) gaze.mode = "task"
    else if (waiting > 0) gaze.mode = "door"
    else if (focus) gaze.mode = "item"
    else if (shyFor > 0) gaze.mode = "shy"
    else if (hovered || reactFor > 0) gaze.mode = "you"
    else if (["item", "shy", "door", "task", "sleep"].includes(gaze.mode)) { gaze.mode = "you"; gaze.until = 2 + Math.random() * 3 }
    else if (gaze.until < 0) {
      // The closer the relationship, the longer she holds your gaze and the shorter she looks away.
      gaze.mode = gaze.mode === "you" ? "away" : "you"
      gaze.until = gaze.mode === "you" ? 2.5 + 3 * mood.warmth + Math.random() * 4
        : 1 + 1.6 * (1 - mood.warmth) + Math.random() * 2
      if (gaze.mode === "away") {
        // Things in the living room when she is there; elsewhere (upstairs she would look down through the floor at
        // them) somewhere at her eye level ahead of her (0.9.49).
        const near = INTEREST.filter(point => point.distanceTo(root.position) < 4 && point.y - root.position.y > -.5)
        if (near.length) gaze.target.copy(pick(near))
        else {
          const side = root.rotation.y + (Math.random() - .5) * 2.2
          const eyes = chestLift.y + .25
          gaze.target.set(root.position.x + Math.sin(side) * 2, root.position.y + eyes, root.position.z + Math.cos(side) * 2)
        }
        if (Math.random() < .4) face.raisePulse = 1
      }
    }
    if (gaze.mode === "you" || gaze.mode === "shy") gaze.target.copy(viewer)
    else if (gaze.mode === "item") gaze.target.copy(focus)
    else if (gaze.mode === "door") gaze.target.copy(DOOR)
    else if (gaze.mode === "task") gaze.target.copy(task)
    return gaze.mode !== previousMode
  }

  function look(dt, changed) {
    let yaw = 0
    let pitch = 0
    // From her head: standing, where it rests; seated or in bed, where it was last frame (0.9.49: from the standing
    // height she looked down at a visitor level with her seated face).
    const from = GROUNDED.has(pose) && !act || !headJoint ? headRest : model.worldToLocal(headJoint.getWorldPosition(headAt))
    const local = toLocal(gaze.target).sub(from)
    // Asleep, the head rests where the pose has it.
    if (gaze.mode !== "sleep") {
      yaw = Math.atan2(local.x, local.z)
      pitch = Math.atan2(local.y, Math.hypot(local.x, local.z))
    }
    // Something behind her: turn only part of the way.
    if (Math.abs(yaw) > 1.7) yaw = Math.sign(yaw) * .5
    if (gaze.mode === "shy") {
      // Caught being stared at: eyes and chin drop a little, just off to one side of the visitor.
      yaw -= .38
      pitch -= .38
    }
    // The head and neck follow slowly; the eyes lead and settle back as the head arrives.
    const headYaw = clamp(yaw * .85, -.85, .85)
    const headPitch = clamp(pitch * .8, -.45, .35)
    gaze.headYaw = damp(gaze.headYaw, headYaw, 3.2, dt)
    gaze.headPitch = damp(gaze.headPitch, headPitch, 3.2, dt)
    gaze.nextJump -= dt
    if (gaze.nextJump < 0) {
      gaze.nextJump = .45 + Math.random() * 1.3
      gaze.jumpYaw = (Math.random() - .5) * .09
      gaze.jumpPitch = (Math.random() - .5) * .05
    }
    gaze.eyeYaw = damp(gaze.eyeYaw, clamp(yaw - gaze.headYaw, -.32, .32) + gaze.jumpYaw, 22, dt)
    gaze.eyePitch = damp(gaze.eyePitch, clamp(pitch - gaze.headPitch, -.18, .18) + gaze.jumpPitch, 22, dt)
    // A blink often comes with a bigger turn of the head.
    if (changed && Math.random() < .75) startBlink()
    gaze.contact = gaze.mode === "you" && Math.abs(yaw - gaze.headYaw - gaze.eyeYaw) < .12
      ? gaze.contact + dt : 0
    // Watching the door she turns from the waist as well.
    gaze.twist = damp(gaze.twist, gaze.mode === "door" ? .32 : .12, 3, dt)
    addDelta("上半身", 0, gaze.headYaw * gaze.twist, 0)
    addDelta("首", -gaze.headPitch * .35, gaze.headYaw * .35, 0)
    addDelta("頭", -gaze.headPitch * .65, gaze.headYaw * .53, -gaze.headYaw * .06)
    for (const eye of ["左目", "右目"]) addDelta(eye, -gaze.eyePitch, gaze.eyeYaw, 0)
  }

  function startBlink() {
    if (face.blink > 0) return
    face.blink = 1
    face.doubleBlink = Math.random() < .2
  }

  function expressions(dt) {
    face.nextBlink -= dt
    if (face.nextBlink < 0) { startBlink(); face.nextBlink = 2 + Math.random() * 4.5 }
    let closed = 0
    if (face.blink > 0) {
      face.blink = Math.max(0, face.blink - dt / .17)
      closed = Math.sin(face.blink * Math.PI)
      if (face.blink === 0 && face.doubleBlink) { face.doubleBlink = false; face.blink = 1 }
    }
    // Closer relationships smile back sooner and more; a day that went badly damps it.
    const contact = clamp((gaze.contact - (1.1 - .6 * mood.warmth)) / .8, 0, 1)
    const warm = (.16 + .3 * mood.warmth + (mood.occasion ? .1 : 0)) * (mood.low ? .6 : 1)
    const liked = current?.name === "liked" ? 1 : 0
    if (asleep) closed = 1
    grumpyShown = damp(grumpyShown, grumpy, 4, dt)
    // Cross at being woken: no smile yet, brows down, a pout.
    let smile = Math.max(contact * warm, mood.occasion ? .14 : 0, shyFor > 0 ? .55 : 0, reactFor > 0 ? .75 : 0, liked * .8,
      asleep ? .12 : 0) * (1 - grumpyShown)
    let happy = Math.max(contact * warm * .5, shyFor > 0 ? .35 : 0, reactFor > 0 ? .5 : 0, liked * .6)
    // A touch reaction takes over the face as it comes in.
    const touched = touch.zone ? TOUCH_FACE[touch.tier] : null
    const weight = touched ? touch.weight : 0
    if (touched) {
      smile = T.MathUtils.lerp(smile, touched.smile, weight)
      happy = T.MathUtils.lerp(happy, touched.happy, weight)
      closed = Math.max(closed, touched.closed * weight)
    }
    face.raisePulse = Math.max(0, face.raisePulse - dt)
    face.widePulse = Math.max(0, face.widePulse - dt * 1.6)
    face.smile = damp(face.smile, smile, 5, dt)
    face.happy = damp(face.happy, happy, 5, dt)
    face.raise = damp(face.raise, Math.sin(Math.min(1, face.raisePulse) * Math.PI) * .4, 8, dt)
    face.worried = damp(face.worried, Math.max(shyFor > 0 ? .4 : waiting > 0 ? .14 : mood.low ? .14 : 0,
      touched ? touched.worried * weight : 0), 5, dt)
    face.wide = damp(face.wide, Math.max(face.widePulse * .4, touched ? touched.wide * weight : 0), 10, dt)
    shape("Brow_Lower", Math.max(touched ? touched.lower * weight : 0, grumpyShown * .6))
    // A poked cheek puffs a little unless she welcomes it.
    shape("Mouth_U", Math.max(touch.zone === "cheek" && ["dodge", "awkward"].includes(touch.tier) ? .45 * weight : 0,
      grumpyShown * .35))
    // A pinched cheek pulls her mouth wide.
    shape("Mouth_I", touch.zone === "cheek" ? Math.abs(touch.follow) * .55 * weight : 0)
    shape("Mouth_Smile", face.smile)
    shape("Eye_HappyLift", face.happy * (1 - closed))
    shape("Brow_Raise", face.raise)
    shape("Brow_Worried", face.worried)
    shape("Eye_Wide", face.wide * (1 - closed))
    shape("Blink_L", closed)
    shape("Blink_R", closed)
  }

  function secondary(dt) {
    ears.nextFlick -= dt
    if (ears.nextFlick < 0) { ears.flick = 1; ears.nextFlick = 3 + Math.random() * 7 }
    ears.flick = Math.max(0, ears.flick - dt * 4)
    ears.back = damp(ears.back, Math.max(shyFor > 0 ? 1 : waiting > 0 || mood.low ? .3 : 0, touchEars(), grumpyShown * .85), 6, dt)
    ears.perk = damp(ears.perk, reactFor > 0 || gaze.contact > 1 ? 1 : 0, 6, dt)
    const flick = Math.sin(ears.flick * Math.PI) * .3
    const lean = ears.perk * .12 - ears.back * .45
    // An ear being rubbed bends under the hand as it passes, and springs back.
    const rubbed = touch.zone === "ears" ? Math.abs(touch.follow) * touch.weight * .5 : 0
    addDelta("左猫耳", lean - (touch.side > 0 ? rubbed : 0), 0, -flick - ears.back * .25)
    addDelta("右猫耳", lean - (touch.side < 0 ? rubbed : 0), 0, flick * .4 + ears.back * .25)
    // The tail sways slowly when calm and quicker when she is pleased.
    const lively = Math.max(face.smile, face.happy)
    // The phase is accumulated, so a change of speed never makes the tail jump to another point of its swing.
    // Cross, it lashes.
    tailPhase += dt * (asleep && grumpyShown < .3 ? .35 : 1 + lively * 1.4 + grumpyShown * 3)
    TAIL.forEach((name, i) => addDelta(name, 0, Math.sin(tailPhase - i * .55) * (.14 + lively * .14 + grumpyShown * .12),
      Math.sin(tailPhase * .7 - i * .4) * .05))
  }

  // Ears go flat when she shies away, and press down into a hand on her head when she likes it.
  function touchEars() {
    if (!touch.zone) return 0
    const near = touch.zone === "head" || touch.zone === "ears"
    const back = near ? { dodge: 1, awkward: .6, accept: .5, enjoy: .85, lean: .7 }
      : { dodge: .8, awkward: .3, accept: 0, enjoy: 0, lean: 0 }
    return back[touch.tier] * touch.weight
  }

  // Returns false while the last reaction is still playing: a new touch waits until she has finished.
  function touchStart(zone, tier, side = 0) {
    if (touch.zone || !TOUCH_ZONES.includes(zone) || !TOUCH_TIERS.includes(tier)) return false
    Object.assign(touch, { zone, tier, side: Math.sign(side), held: true, start: performance.now(), time: 0, released: 0,
      weight: 0, follow: 0, followGoal: 0, direction: 0 })
    shyFor = waiting = celebrate = hoverTime = 0
    if (tier === "dodge" || tier === "awkward") face.widePulse = 1
    else startBlink()
    if (zone === "ears") ears.flick = 1
    return true
  }

  // The hand leaves her; returns how long it stayed, in seconds.
  function touchEnd() {
    if (!touch.zone || !touch.held) return 0
    touch.held = false
    touch.time = touch.released = touchClock()
    return touch.time
  }

  // A hand stroking her head: she leans a little with it, and her ears twitch each time it turns back.
  function touchFollow(value) {
    if (!touch.zone) return
    const direction = Math.sign(value - touch.followGoal)
    if (direction && touch.direction && direction !== touch.direction && Math.abs(value) > .25) ears.flick = 1
    if (direction) touch.direction = direction
    touch.followGoal = clamp(value, -1, 1)
  }

  function touchTime(dt, moving) {
    if (!touch.zone) return
    touch.time = touchClock()
    touch.follow = moving ? damp(touch.follow, touch.held ? touch.followGoal : 0, 6, dt) : 0
    const after = touch.held ? 0 : touch.time - touch.released
    const holding = touch.held || after < AFTER[touch.tier] * .45
    touch.weight = moving ? damp(touch.weight, Number(holding), holding ? touch.tier === "dodge" ? 14 : 8 : 3.2, dt)
      : Number(holding)
    if (!touch.held && after >= AFTER[touch.tier] && touch.time > 1.4 && (!moving || touch.weight < .02)) {
      touch.zone = null
      touch.weight = 0
    }
  }

  function touchPose() {
    if (!touch.zone) return
    const { zone, tier, time, weight: w } = touch
    const side = touch.side || 1
    if (tier === "dodge") {
      // Leans back and turns away from the hand.
      addDelta("上半身", -.1 * w, -.2 * side * w, 0)
      addDelta("頭", -.06 * w, -.3 * side * w, 0)
    } else if (tier === "awkward") {
      addDelta("上半身", -.04 * w, -.07 * side * w, 0)
      addDelta("頭", .03 * w, -.14 * side * w, 0)
    } else {
      // Into the hand: the head dips and tilts toward it; closer tiers nuzzle a little and lean in.
      const close = { accept: .6, enjoy: 1, lean: 1.2 }[tier]
      if (tier === "lean") addDelta("上半身", .07 * w, 0, 0)
      if (zone === "chin") {
        // A scratch under the chin: she lifts it into the fingers, like a cat.
        addDelta("首", -.06 * close * w, 0, 0)
        addDelta("頭", -.13 * close * w, Math.sin(time * 1.6) * .04 * (close - .4) * w, 0)
      } else {
        addDelta("首", .05 * close * w, 0, 0)
        addDelta("頭", .1 * close * w, Math.sin(time * 2) * .05 * (close - .6) * w, -.1 * close * side * w)
      }
    }
    // A hand that moves while it holds on takes her head a little with it: stroking her head, pulling her cheek in
    // a pinch, rubbing an ear, scratching under her chin.
    const pull = { head: 1, cheek: .8, ears: .45, chin: .3 }[zone]
    if (pull && (tier !== "dodge" || zone === "cheek")) {
      const lean = touch.follow * w * pull * (tier === "awkward" || tier === "dodge" ? .4 : 1)
      // A pinch turns her face toward the pull; a stroke only tilts her head with the hand.
      const turn = zone === "cheek" ? -2.6 : 1
      addDelta("首", 0, -lean * .06 * turn, lean * .05)
      addDelta("頭", 0, -lean * .1 * turn, lean * .12)
    }
    if (zone === "hand") {
      // Gives the hand, hesitates, or pulls it back.
      const mark = side > 0 ? "左" : "右"
      const reach = { dodge: .3, awkward: -.2, accept: -.5, enjoy: -.6, lean: -.7 }[tier]
      addDelta(`${mark}腕`, reach * w, 0, 0)
      addDelta(`${mark}ひじ`, Math.min(0, reach) * .9 * w, 0, 0)
    }
    if (zone === "tail") {
      // A quick whip when she does not want it, a slow curl when she does.
      const whip = { dodge: 1, awkward: .6, accept: .2, enjoy: .1, lean: .1 }[tier]
      TAIL.forEach((name, i) => addDelta(name, -.06 * (1 - whip) * w,
        Math.sin(time * (6 + 10 * whip) - i * .7) * .3 * whip * w, 0))
    }
  }

  function apply() {
    for (const entry of bones.values()) {
      entry.object.quaternion.copy(entry.frame).invert().multiply(entry.delta).multiply(entry.frame).premultiply(entry.rest)
    }
  }

  // context: { moving, glow, viewer (camera position), focus (world point or null), hovered,
  //   task (where her attention is while busy, or null), asleep, grumpy (0..1),
  //   support (the height of the bed or seat under her, or null) }
  function update(dt, { moving, glow = 1, viewer, focus = null, hovered = false, task: busyWith = null, asleep: sleeping = false,
    grumpy: cross = 0, support = null, seat = null, footing = false, bend = 0 }) {
    for (const [material, base] of glowing) material.emissiveIntensity = base * glow
    // Lofi: her key light turns with her (it is hers, not the camera's).
    if (lofi) faceCharacterLight(root.rotation.y)
    task = busyWith
    asleep = sleeping
    grumpy = cross
    if (!moving) {
      const key = `${pose}:${asleep}:${motionReady}`
      if (!still || key !== stillKey) {
        stillKey = key
        current = previous = gesture = once = act = null
        queue = []
        startBlend = 0
        ground = 0
        raise = 0
        seatShift = 0
        for (const entry of bones.values()) entry.delta.identity()
        const held = (POSES[pose] || []).find(name => clips[name])
        if (held) {
          // Sitting, typing, asleep: one moment of the pose's clip, held.
          current = { name: held, clip: clips[held], time: clips[held].duration * .35, fadeSeconds: 1 }
          fade = 1
          body(0)
        } else {
          // A still, natural pose: arms lowered, chin lifted a little toward the room camera.
          setDelta("左腕", 0, 0, -.2)
          setDelta("右腕", 0, 0, .2)
          setDelta("首", .06, 0, 0)
          setDelta("頭", -.12, 0, .05)
          groove.object.position.copy(groove.position)
        }
        apply()
        root.updateMatrixWorld(true)
        if (support !== null) rest(support, 0, true)
        sitOn(seat, 0, true)
        clearHands(seat, 0)
        plantFeet(false, 0)
        drapeSkirt(seat, 0)
        springs.reset()
        // Held still on a seat, let the skirt and hair settle onto it (the planes act only while the springs run).
        if (seat) for (let i = 0; i < 40; i++) springs.update(1 / 60)
        for (const name of shapes.keys()) shape(name, 0)
        if (asleep) { shape("Blink_L", 1); shape("Blink_R", 1) }
        followChest(0)
        still = true
        touchShown = true
      }
      // Without motion a touch still shows on her face.
      touchTime(dt, false)
      if (!touch.zone && !touchShown) return false
      touchShown = Boolean(touch.zone)
      if (!touch.zone && asleep) return true
      const touched = TOUCH_FACE[touch.tier]
      const weight = touch.zone ? touch.weight : 0
      shape("Mouth_Smile", touched.smile * weight)
      shape("Eye_HappyLift", touched.happy * weight * (1 - touched.closed))
      shape("Blink_L", touched.closed * weight)
      shape("Blink_R", touched.closed * weight)
      shape("Brow_Worried", touched.worried * weight)
      shape("Brow_Lower", touched.lower * weight)
      shape("Eye_Wide", touched.wide * weight)
      return true
    }
    touchShown = false
    still = false
    clock += dt
    // Busy or asleep, she does not notice being looked at, nor wait at the door.
    if (task || asleep) {
      hovered = false
      waiting = celebrate = 0
    }
    hoverTime = hovered ? hoverTime + dt : 0
    shyFor = Math.max(0, shyFor - dt)
    reactFor = Math.max(0, reactFor - dt)
    if (hoverTime > 2.4 && shyFor === 0 && reactFor === 0) { shyFor = 2.6; hoverTime = -4 }
    // Opening moments wait until the motion clips have loaded (or failed), so the gesture can play.
    if (settled && waiting > 0) {
      waiting -= dt
      if (waiting <= 0 || hovered) {
        // She notices the visitor: eyes widen, she turns and answers with a happy gesture.
        waiting = 0
        reactFor = 2.2
        face.widePulse = face.raisePulse = 1
        startBlink()
        playGesture("liked")
      }
    }
    if (settled && celebrate > 0 && (celebrate -= dt) <= 0) playGesture("vsign")
    body(dt)
    lean(bend)
    const changed = chooseGaze(dt, viewer, focus, hovered)
    look(dt, changed)
    touchTime(dt, true)
    expressions(dt)
    secondary(dt)
    touchPose()
    apply()
    root.updateMatrixWorld(true)
    // Coming out of a seated or lying clip, the correction waits until the standing one has mostly taken over.
    if (current?.grounded && ankles.length && (!previous || previous.grounded || fade > .5)) {
      // Correct within the same frame (a smoothed correction lags fast moves and lets the feet sink).
      const lowest = Math.min(...ankles.map(ankle => ankle.getWorldPosition(anklePoint).y)) - root.position.y
      const error = (lowest - ankleRest) / model.scale.y
      if (Math.abs(error) > 1e-4) {
        ground -= error
        groove.object.position.add(anklePoint.set(0, -error, 0).applyMatrix3(grooveLinear))
        root.updateMatrixWorld(true)
      }
    } else {
      // Seated or lying, the pose's own hips carry her; the last correction eases away.
      ground = current ? damp(ground, 0, 4, dt) : 0
    }
    if (support !== null) rest(support, dt, false)
    else raise = damp(raise, 0, 4, dt)
    sitOn(seat, dt, false)
    clearHands(seat, dt)
    plantFeet(footing, dt)
    drapeSkirt(seat, dt)
    if (resetSprings) { resetSprings = false; springs.reset() }
    else springs.update(dt)
    followChest(dt)
    return true
  }

  // Keeps her lowest part on a surface at height `surface` (a soft mattress gives a little), within the same frame.
  function rest(surface, dt, now) {
    let lowest = Infinity
    for (const item of capsules) {
      if (!item.rests) continue
      lowest = Math.min(lowest, item.from.getWorldPosition(item.a).y - item.radius * .6,
        item.to.getWorldPosition(item.b).y - item.radius * .6)
    }
    const below = (surface - .02 - lowest) / model.scale.y
    // Up at once; down slowly, so a moment's lift does not leave her bobbing.
    const change = below > 0 || now ? below : Math.max(below, damp(0, below, 1.5, dt))
    if (Math.abs(change) < 1e-5 || raise + change < 0 && raise <= 0) return
    const step = Math.max(change, -raise)
    raise += step
    groove.object.position.add(anklePoint.set(0, step, 0).applyMatrix3(grooveLinear))
    root.updateMatrixWorld(true)
  }

  // Puts her hips on a seat ({ height, weight } or null), within the same frame: up or down by however far the
  // clip has her above or below it; as the weight eases off (getting up) the lift goes with it.
  // Settled on a seat, the skirt lies on it (up to its front edge) and the ponytails stay in front of the backrest
  // (below its top); planes for the springs, in world space.
  const seatPlanes = [
    { point: new T.Vector3(), normal: new T.Vector3(0, 1, 0), within: { origin: new T.Vector3(), direction: new T.Vector3(), max: 0 } },
    { point: new T.Vector3(), normal: new T.Vector3(), group: 1, within: { origin: new T.Vector3(), direction: new T.Vector3(0, 1, 0), max: 0 } },
  ]
  function seatSprings(seat) {
    hipsCollider.enabled = Boolean(seat && seat.weight > .3)
    for (const leg of legs) leg.upward = hipsCollider.enabled
    const seated = seat ? seat.weight : 0
    for (const item of skirtFollow) item.weight = item.standing + (item.seated - item.standing) * seated
    if (seat) hipsCollider.offset.set(-Math.sin(seat.turn) * .05, 0, -Math.cos(seat.turn) * .05)
    if (!seat || seat.weight < .6 || !seat.front && !seat.back) return springs.setPlanes(null)
    const [floor, back] = seatPlanes
    const forward = floor.within.direction.set(Math.sin(seat.turn), 0, Math.cos(seat.turn))
    floor.point.set(seat.x, seat.height, seat.z)
    floor.within.origin.set(seat.x, seat.height, seat.z)
    floor.within.max = -.02
    back.normal.copy(forward)
    back.point.set(seat.x, seat.y, seat.z).addScaledVector(forward, -seat.back)
    back.within.origin.set(seat.x, seat.y, seat.z)
    back.within.max = seat.top
    springs.setPlanes(seatPlanes)
  }

  // Feet on the floor (0.9.51). While she turns on the spot, sits down or gets up (`footing`, from
  // cottage-yui-life.mjs), each foot stays where it was put down: the leg reaches it (cottage-reach.mjs) and the foot
  // keeps the way it pointed. When the body has turned or moved too far from a foot (where the clip alone would put
  // it), that foot steps over: lifted, carried and put down again, one foot at a time. When the footing ends the
  // feet first step to where the clip has them, then let go.
  const STEP_DRIFT = .13
  const STEP_TURN = .5
  const STEP_SECONDS = .3
  const STEP_LIFT = .055
  const feet = ["左", "右"].map(mark => ({
    upper: named(`${mark}足`), lower: named(`${mark}ひざ`), ankle: named(`${mark}足首`),
    lock: new T.Vector3(), yaw: 0, locked: false, step: null, from: new T.Vector3(), fromYaw: 0,
  })).filter(foot => foot.upper && foot.lower && foot.ankle)
  let planted = 0
  const natural = new T.Vector3()
  const footTarget = new T.Vector3()
  const footShift = new T.Vector3()
  const footTurn = new T.Quaternion()
  const upAxis = new T.Vector3(0, 1, 0)
  const apart = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
  const turnBy = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from))
  function plantFeet(want, dt) {
    const yaw = root.rotation.y
    if (dt <= 0 || !feet.length) {
      planted = 0
      for (const foot of feet) { foot.locked = false; foot.step = null }
      return
    }
    // Where each foot would be from the clip alone, and how far it is from where it stands.
    const drift = feet.map(foot => {
      foot.ankle.getWorldPosition(natural)
      if (!foot.locked) { foot.lock.copy(natural); foot.yaw = yaw; foot.locked = true }
      return Math.max(apart(natural, foot.lock) / STEP_DRIFT, Math.abs(turnBy(foot.yaw, yaw)) / STEP_TURN)
    })
    const stepping = feet.some(foot => foot.step)
    // Letting go: the feet step home first (any that are more than a little off), then the legs ease back.
    const settled = drift.every(amount => amount < .3)
    const holding = want || !settled || stepping
    planted = damp(planted, holding ? 1 : 0, holding ? 10 : 6, dt)
    if (planted < .002 && !holding) {
      planted = 0
      for (const foot of feet) foot.locked = false
      return
    }
    if (!stepping) {
      const index = drift[0] >= drift[1] ? 0 : 1
      if (drift[index] >= (want ? 1 : .3)) {
        const foot = feet[index]
        foot.step = { time: 0 }
        foot.from.copy(foot.lock)
        foot.fromYaw = foot.yaw
      }
    }
    for (const foot of feet) {
      foot.ankle.getWorldPosition(natural)
      if (foot.step) {
        foot.step.time += dt / STEP_SECONDS
        const t = Math.min(1, foot.step.time)
        const ease = t * t * (3 - 2 * t)
        footTarget.lerpVectors(foot.from, natural, ease)
        footTarget.y += Math.sin(Math.PI * t) * STEP_LIFT
        foot.yaw = foot.fromYaw + turnBy(foot.fromYaw, yaw) * ease
        if (t >= 1) { foot.lock.copy(natural); foot.yaw = yaw; foot.step = null }
      } else footTarget.copy(foot.lock)
      reach(foot.upper, foot.lower, foot.ankle, footShift.subVectors(footTarget, natural).multiplyScalar(planted))
      // The foot keeps pointing where it was put down.
      const twist = turnBy(yaw, foot.yaw) * planted
      if (Math.abs(twist) > 1e-4) turnBone(foot.ankle, footTurn.setFromAxisAngle(upAxis, twist))
    }
  }

  // Leaning forward from the hips to sit down or get up (0..1, from cottage-yui-life.mjs), the head staying level.
  function lean(amount) {
    if (amount <= 0) return
    addDelta("上半身", amount * .32, 0, 0)
    addDelta("首", -amount * .14, 0, 0)
  }

  // The baked skirt (see `drape`): settled on a seat in a clip that has one, it takes over from the springs, eased
  // in as she sits down and out as she gets up or goes into a clip without one; between two clips it follows the
  // clips' own crossfade.
  const drapeLocal = new Float32Array(72)
  const drapeOther = new Float32Array(72)
  const drapePoints = [0, 1, 2].map(() => Array.from({ length: 8 }, () => new T.Vector3()))
  let drapeShown = 0
  function drapeAt(state, into) {
    const baked = state && drape?.[state.name]
    if (!baked || !baked.times.length) return false
    const { times, frames } = baked
    let time = state.time
    if (baked.loop) time = ((time % baked.duration) + baked.duration) % baked.duration
    let high = times.findIndex(at => at > time)
    let low, t
    if (high === -1 || high === 0) {
      // Past either end: a loop goes round from the last frame to the first, otherwise it holds the nearest end.
      if (!baked.loop) { low = high = high === 0 ? 0 : times.length - 1; t = 0 }
      else {
        low = times.length - 1
        high = 0
        const span = times[0] + baked.duration - times[low]
        t = span > 0 ? ((time - times[low] + baked.duration) % baked.duration) / span : 0
      }
    } else {
      low = high - 1
      t = (time - times[low]) / Math.max(1e-6, times[high] - times[low])
    }
    const a = frames[low], b = frames[high]
    for (let i = 0; i < 72; i++) into[i] = a[i] + (b[i] - a[i]) * t
    return true
  }
  function drapeSkirt(seat, dt) {
    if (!drape || !pelvis || !skirtWhole) return
    const now = drapeAt(current, drapeLocal)
    const before = previous && fade < 1 ? drapeAt(previous, drapeOther) : false
    const mix = previous && fade < 1 ? T.MathUtils.smoothstep(fade, 0, 1) : 1
    // How much of the pose has a baked skirt; with both clips baked, the two drapes cross over.
    let baked = (now ? mix : 0) + (before ? 1 - mix : 0)
    if (now && before) for (let i = 0; i < 72; i++) drapeLocal[i] = drapeOther[i] + (drapeLocal[i] - drapeOther[i]) * mix
    else if (before) drapeLocal.set(drapeOther)
    const wanted = seat ? clamp((seat.weight - .6) / .4, 0, 1) * baked : 0
    drapeShown = dt > 0 ? damp(drapeShown, wanted, 4, dt) : wanted
    if (drapeShown < .01) return springs.setTargets(0, null, 0)
    for (let level = 0; level < 3; level++) for (let chain = 0; chain < 8; chain++) {
      const i = (level * 8 + chain) * 3
      drapePoints[level][chain].set(drapeLocal[i], drapeLocal[i + 1], drapeLocal[i + 2]).applyMatrix4(pelvis.matrixWorld)
    }
    springs.setTargets(0, drapePoints, drapeShown)
  }

  function sitOn(seat, dt, now) {
    seatSprings(seat)
    let goal = 0
    if (seat && thighs.length) {
      let lowest = Infinity
      for (const [hip, knee] of thighs) {
        hip.getWorldPosition(thighPoint)
        knee.getWorldPosition(kneePoint)
        // The hip joint and the first half of the thigh carry her weight.
        lowest = Math.min(lowest, thighPoint.y, thighPoint.lerp(kneePoint, .5).y)
      }
      const error = (lowest - SEAT_DEPTH - seat.height) / model.scale.y
      goal = (seatShift - error) * seat.weight
    }
    const next = now ? goal : damp(seatShift, goal, 12, dt)
    const step = next - seatShift
    if (Math.abs(step) < 1e-6) return
    seatShift = next
    groove.object.position.add(anklePoint.set(0, step, 0).applyMatrix3(grooveLinear))
    root.updateMatrixWorld(true)
  }

  // Moves each hand out of her head and, seated, up off the seat, by the least that clears it (eased, so a
  // gesture that brushes her face does not jump).
  function clearHands(seat, dt) {
    if (!hands.length) return
    if (headBone) headBone.localToWorld(headPoint.copy(headCentre))
    const radius = HEAD_RADIUS
    for (const arm of hands) {
      arm.wanted.set(0, 0, 0)
      for (const tip of arm.tips) {
        tip.getWorldPosition(handPoint)
        if (headBone) {
          const offset = handPoint.sub(headPoint)
          const distance = offset.length()
          if (distance < radius && distance > 1e-6) {
            const out = offset.multiplyScalar((radius - distance) / distance)
            if (out.lengthSq() > arm.wanted.lengthSq()) arm.wanted.copy(out)
          }
          tip.getWorldPosition(handPoint)
        }
        if (seat && seat.weight > .5) {
          const under = seat.height + .025 - handPoint.y
          if (under > arm.wanted.y) arm.wanted.y = under
        }
      }
      arm.push.lerp(arm.wanted, dt > 0 ? 1 - Math.exp(-18 * dt) : 1)
      reach(arm.upper, arm.lower, arm.hand, arm.push)
    }
  }

  // Where her body is (world capsules, refreshed on each call), for the duvet over her in bed.
  function body3d() {
    for (const item of capsules) {
      item.from.getWorldPosition(item.a)
      item.to.getWorldPosition(item.b)
    }
    return capsules
  }

  // A click: she turns to the visitor, brightens and answers. `how` is how she took it (cottage-yui-life.mjs
  // interrupt): seated she laughs in her seat; startled at something in hand she starts first; sitting up in bed
  // the getting-up clip has her; otherwise a standing gesture.
  function react(how = "") {
    reactFor = 2.4
    shyFor = 0
    hoverTime = 0
    face.widePulse = 1
    face.raisePulse = 1
    startBlink()
    if (how === "seat") {
      if (pose === "sit" && !act && clips[SEAT_LAUGH.clip]) perform([SEAT_LAUGH])
      return
    }
    if (how === "bed" || how === "rise") return
    if (how === "startle" && clips.startle) {
      gesture = once = null
      queue = []
      return playGesture("startle")
    }
    const ready = GESTURES.filter(name => clips[name])
    if (ready.length) playGesture(pick(ready.filter(name => name !== lastGesture).concat(ready.length === 1 ? ready : [])))
  }

  function playGesture(name) {
    if (!clips[name] || gesture || pose !== "stand" || once || act) return
    gesture = name
    if (GESTURES.includes(name)) lastGesture = name
    startClip(name, name === "startle" ? .25 : .45)
  }

  // Mood from the relationship, read from the panel's data; it only changes how she looks and moves.
  // { warmth 0..1, low (lost more than gained today), occasion (an anniversary today), missed (2+ days away) }
  // The opening moment (watching the door, or the anniversary gesture) plays once per visit.
  function setMood({ warmth = .5, low = false, occasion = false, missed = false }) {
    Object.assign(mood, { warmth: clamp(warmth, 0, 1), low, occasion })
    if (moodSeen) return
    moodSeen = true
    if (missed) waiting = 3.4
    else if (occasion) celebrate = 1.6
  }

  // Changes her pose, fading over `seconds` from the one she is in.
  function setPose(name, seconds = .6) {
    if (name !== "stand" && !POSES[name]) throw new Error(`Yui has no pose ${name}`)
    if (name === pose) return
    pose = name
    // The hit column lies down with her in bed (her body runs along her own z there) and is shorter seated.
    const lying = name === "sleep"
    hitArea.rotation.x = lying ? Math.PI / 2 : 0
    hitArea.position.y = lying ? .15 : PLACE.height * (["sit", "type"].includes(name) ? .4 : .48)
    hitArea.scale.y = ["sit", "type"].includes(name) ? .8 : 1
    gesture = once = null
    queue = []
    showRoot()
    if (!act && (motionReady || Object.keys(clips).length)) playBase(seconds)
  }

  // One-shot clips (yawn, stretch) over standing, one after another.
  function playOnce(names) {
    queue = names.filter(name => ONCE.includes(name))
    if (GROUNDED.has(pose) && !once && !act && pose !== "walk") playBase()
  }

  // Seen unless faded out, and, in a pose other than standing, not before the clips have loaded (or failed):
  // until then she would stand where she sits or lies, and then sink into the pose.
  function showRoot() {
    root.visible = shownFade > .01 && (settled || pose === "stand")
  }

  // Out of sight and back (getting into bed, the stairs): 0 hidden .. 1 shown.
  const fadeMaterials = [...toonMaterials.values()]
  function setFade(amount) {
    const value = clamp(amount, 0, 1)
    if (value === shownFade) return
    shownFade = value
    showRoot()
    for (const material of fadeMaterials) {
      const see = value < 1 || material.userData.see
      if (material.transparent !== see) {
        material.transparent = see
        material.needsUpdate = true
      }
      material.opacity = value
      material.depthWrite = !material.userData.see && value === 1
    }
    model.traverse(object => { if (object.isMesh && !object.userData.hull) object.castShadow = value > .5 })
    for (const hull of hulls) hull.visible = value === 1
  }

  return {
    root, hitArea, zones, motion, update, react, setMood, touchStart, touchEnd, touchFollow, setPose, playOnce, setFade,
    perform, capsules: body3d,
    touching: () => Boolean(touch.zone), cheer: () => playGesture("liked"),
    get pose() { return pose },
    get playing() { return once || queue.length > 0 },
    // The performance under way: which part, and the moment of its clip (null when none).
    // The clip she is in and its moment, and the one fading out under it (for the baked seated skirt, and tools).
    get clip() {
      return current ? { name: current.name, time: current.time, duration: current.clip.duration, fade,
        previous: previous && fade < 1 ? { name: previous.name, time: previous.time } : null } : null
    },
    get acting() { return act && current?.part ? { index: act.index, time: current.time, part: current.part, held: Boolean(current.held) } : null },
    get shown() { return shownFade },
    // After a jump to another place: the skirt and hair start at rest there.
    settle() { springs.reset() },
    // Where the closeup looks: her chest. Standing, a fixed height above her root; seated or sitting up in bed,
    // where her chest bone is (eased, so the camera does not sway with her breathing or a laugh).
    chest: target => target.copy(root.position).add(chestLift),
  }
}
