// Yui in the cottage. The model comes from tools/assets/export_yui_web.py as a GLB with MMD-style bone names
// and a few face shapes. Her motion is built in layers, the way living characters in games usually are:
//   1. body: captured idle clips from the host (VRMA), crossfaded at random, or a light procedural idle;
//   2. gaze: the eyes lead and the head and neck follow late; small eye jumps; glances away and back;
//   3. face: blinks that come with glances, a small smile on eye contact, brows that move with attention;
//   4. reactions: a gesture when clicked, shyness when stared at, a look at whatever the visitor opens;
//   5. secondary: ears, tail and ponytails.
// It only moves when the caller allows motion (not on low quality or with reduced motion).
import * as T from "./engine/three.module.min.js"
import { GLTFLoader } from "./engine/three-gltf.mjs?v=0.9.29"
import { createSprings } from "./cottage-springs.mjs?v=0.9.35"

// Standing spot in the living room, at the front of the rug, turned toward the room view. The model faces +z.
const PLACE = { x: .25, z: 1.5, turn: .55, height: 1.55 }
const IDLE_CLIPS = ["idle01", "idle02", "idle03", "idle04", "idle05"]
// The host's greeting clip is a deep squat that pushes the legs through the skirt (no cloth simulation here),
// so only the standing gestures are used.
const GESTURES = ["vsign", "liked"]
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
  const rotations = {}
  let hips = null
  for (const [bone, { node }] of Object.entries(humanBones)) {
    const object = await gltf.parser.getDependency("node", node)
    const track = animation.tracks.find(item => item.name === `${object.name}.quaternion`)
    if (track) rotations[bone] = track.createInterpolant()
    if (bone === "hips") hips = animation.tracks.find(item => item.name === `${object.name}.position`)?.createInterpolant()
  }
  // The clips are authored on a T-pose rest with identity rotations, so a track value is already the bone's
  // turn in the character's frame. Hip height scales the root motion onto Yui.
  const hipsNode = json.nodes[humanBones.hips.node]
  const legNode = json.nodes[humanBones.leftUpperLeg.node]
  const rest = new T.Vector3().fromArray(hipsNode.translation || [0, 0, 0])
  return { duration: animation.duration, rotations, hips, rest, legHeight: rest.y + (legNode.translation?.[1] || 0) }
}

export async function loadYui(scene, base) {
  const loader = new GLTFLoader()
  const gltf = await loader.loadAsync(`${base}/yui.glb?v=0.9.35`)
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
  const soft = ramp([190, 235, 255])
  const flat = ramp([235, 255])
  const toonMaterials = new Map()
  const glowing = []
  const toon = old => {
    if (toonMaterials.has(old)) return toonMaterials.get(old)
    const face = /Face|Head|Lashes|Brows|Socket|Iris|Eye|Teeth|Tongue|Mouth/.test(old.name)
    const material = new T.MeshToonMaterial({
      name: old.name, map: old.map, gradientMap: face ? flat : soft, transparent: old.transparent, side: old.side,
      emissive: 0xffffff, emissiveMap: old.emissiveMap || old.map,
    })
    if (!old.emissiveMap) glowing.push([material, face ? .7 : .62])
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
  const shape = (name, value) => { for (const [mesh, index] of shapes.get(name) || []) mesh.morphTargetInfluences[index] = value }
  model.updateMatrixWorld(true)

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
  // Feet stay on the floor: the captured clips were made for other leg lengths, so the hips are nudged up or down
  // until the lower ankle is back at its resting height (this also turns the "liked" hop into a small bounce).
  const ankles = ["左足首", "右足首"].map(name => bones.get(name)?.object).filter(Boolean)
  const ankleRest = Math.min(...ankles.map(ankle => ankle.getWorldPosition(new T.Vector3()).y))
  const anklePoint = new T.Vector3()
  let ground = 0

  // Hit area for clicks and hover: a simple column around her.
  const hitArea = new T.Mesh(new T.CylinderGeometry(.24, .24, PLACE.height * .96, 10), new T.MeshBasicMaterial())
  hitArea.position.y = PLACE.height * .48
  hitArea.visible = false
  root.add(hitArea)
  root.updateMatrixWorld(true)

  // Skirt (eight chains of three around the waist) and ponytails (four joints each) swing on springs.
  // Capsules around the thighs and shins keep the skirt outside the legs; the body and shoulders hold the hair.
  // Distances are in room metres (Yui is 1.55 m tall).
  const named = name => model.getObjectByName(name)
  // The skirt's chains go round the waist in order, so they are solved as a ring.
  // Each panel also swings with the thigh beside it: fully for panels over the leg, partly toward the front
  // (a leg stepping forward pushes the front of the skirt), not at all at the back.
  const pelvis = named("下半身")
  const across = bone => {
    const point = bone.getWorldPosition(new T.Vector3()).applyMatrix4(toModel).sub(pelvis.getWorldPosition(new T.Vector3()).applyMatrix4(toModel))
    return point.setY(0).normalize()
  }
  const skirt = Array.from({ length: 8 }, (_, i) => {
    const bones = [1, 2, 3].map(n => named(`スカート_${i}_${n}`))
    const follow = bones[0] && pelvis ? ["左", "右"].map(mark => named(`${mark}足`)).filter(Boolean).map(limb => {
      const side = across(bones[0])
      return { limb, base: pelvis, weight: Math.min(.85, .8 * Math.max(0, side.dot(across(limb))) + .35 * Math.max(0, side.z)) }
    }) : []
    return { bones, stiffness: [6, 2.6, 1.6], drag: .42, gravity: .15, radius: .015, tip: .9, follow }
  })
  const ponytails = ["左", "右"].map(mark => ({
    bones: [1, 2, 3, 4].map(n => named(`${mark}髪${n}`)), stiffness: [8, 3, 1.4, 1], drag: .35, gravity: .5,
    radius: .03, tip: 1.6,
  }))
  const complete = chains => chains.filter(chain => chain.bones.every(Boolean))
  const legs = ["左", "右"].flatMap(mark => [
    { from: named(`${mark}足`), to: named(`${mark}ひざ`), radius: .066, start: .2 },
    { from: named(`${mark}ひざ`), to: named(`${mark}足首`), radius: .055 },
  ])
  const colliders = [...legs, { from: named("上半身"), to: named("首"), radius: .085 },
    { from: named("左腕"), radius: .05 }, { from: named("右腕"), radius: .05 }].filter(item => item.from)
  const springs = createSprings([
    { ring: complete(skirt).length === 8, chains: complete(skirt) }, { ring: false, chains: complete(ponytails) },
  ], colliders)
  springs.reset()

  // Motion clips load in the background; until they do (or if they cannot), a procedural idle stands in.
  const clips = {}
  const motion = Promise.all([...IDLE_CLIPS, ...GESTURES].map(name =>
    readClip(loader, `${base}/motion/${name}.vrma.gz?v=0.9.35`).then(clip => { clips[name] = clip })
      .catch(error => console.warn("cottage: Yui motion unavailable", name, error)))).then(() => {
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
  motion.then(() => { settled = true })

  const playIdle = () => {
    const available = IDLE_CLIPS.filter(name => clips[name] && name !== current?.name)
    if (!available.length) return false
    startClip(pick(available), 1.4)
    return true
  }
  function startClip(name, fadeSeconds) {
    // From the procedural pose, or in the middle of another fade: fade from the pose she is in right now
    // (the last frame's body layer) instead of snapping.
    const fromPose = (!current || (previous && fade < 1)) && bodyPose.size > 0
    previous = fromPose ? null : current
    current = { name, clip: clips[name], time: 0, fadeSeconds }
    fade = previous ? 0 : 1
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
  }

  const setDelta = (name, x, y, z) => bones.get(name)?.delta.setFromEuler(euler.set(x, y, z, "YXZ"))
  const addDelta = (name, x, y, z) => {
    const entry = bones.get(name)
    if (entry) entry.delta.premultiply(scratch.setFromEuler(euler.set(x, y, z, "YXZ")))
  }

  // Body layer: captured clips when ready, else a light procedural idle (arms lowered from the A-pose).
  function body(dt) {
    for (const entry of bones.values()) entry.delta.identity()
    if (motionReady && !current && !playIdle()) motionReady = false
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
    current.time += dt
    if (current.time >= current.clip.duration) {
      if (gesture && current.name === gesture) gesture = null
      if (!playIdle()) current.time %= current.clip.duration
    }
    fade = Math.min(1, fade + dt / current.fadeSeconds)
    if (previous) previous.time = Math.min(previous.time + dt, previous.clip.duration)
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
    offset.y += ground
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
    if (waiting > 0) gaze.mode = "door"
    else if (focus) gaze.mode = "item"
    else if (shyFor > 0) gaze.mode = "shy"
    else if (hovered || reactFor > 0) gaze.mode = "you"
    else if (gaze.mode === "item" || gaze.mode === "shy" || gaze.mode === "door") { gaze.mode = "you"; gaze.until = 2 + Math.random() * 3 }
    else if (gaze.until < 0) {
      // The closer the relationship, the longer she holds your gaze and the shorter she looks away.
      gaze.mode = gaze.mode === "you" ? "away" : "you"
      gaze.until = gaze.mode === "you" ? 2.5 + 3 * mood.warmth + Math.random() * 4
        : 1 + 1.6 * (1 - mood.warmth) + Math.random() * 2
      if (gaze.mode === "away") {
        gaze.target.copy(pick(INTEREST))
        if (Math.random() < .4) face.raisePulse = 1
      }
    }
    if (gaze.mode === "you" || gaze.mode === "shy") gaze.target.copy(viewer)
    else if (gaze.mode === "item") gaze.target.copy(focus)
    else if (gaze.mode === "door") gaze.target.copy(DOOR)
    return gaze.mode !== previousMode
  }

  function look(dt, changed) {
    let yaw = 0
    let pitch = 0
    const local = toLocal(gaze.target).sub(headRest)
    yaw = Math.atan2(local.x, local.z)
    pitch = Math.atan2(local.y, Math.hypot(local.x, local.z))
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
    const smile = Math.max(contact * warm, mood.occasion ? .14 : 0, shyFor > 0 ? .55 : 0, reactFor > 0 ? .75 : 0, liked * .8)
    const happy = Math.max(contact * warm * .5, shyFor > 0 ? .35 : 0, reactFor > 0 ? .5 : 0, liked * .6)
    face.raisePulse = Math.max(0, face.raisePulse - dt)
    face.widePulse = Math.max(0, face.widePulse - dt * 1.6)
    face.smile = damp(face.smile, smile, 5, dt)
    face.happy = damp(face.happy, happy, 5, dt)
    face.raise = damp(face.raise, Math.sin(Math.min(1, face.raisePulse) * Math.PI) * .4, 8, dt)
    face.worried = damp(face.worried, shyFor > 0 ? .4 : waiting > 0 ? .14 : mood.low ? .14 : 0, 5, dt)
    face.wide = damp(face.wide, face.widePulse * .4, 10, dt)
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
    ears.back = damp(ears.back, shyFor > 0 ? 1 : waiting > 0 || mood.low ? .3 : 0, 6, dt)
    ears.perk = damp(ears.perk, reactFor > 0 || gaze.contact > 1 ? 1 : 0, 6, dt)
    const flick = Math.sin(ears.flick * Math.PI) * .3
    const lean = ears.perk * .12 - ears.back * .45
    addDelta("左猫耳", lean, 0, -flick - ears.back * .25)
    addDelta("右猫耳", lean, 0, flick * .4 + ears.back * .25)
    // The tail sways slowly when calm and quicker when she is pleased.
    const lively = Math.max(face.smile, face.happy)
    // The phase is accumulated, so a change of speed never makes the tail jump to another point of its swing.
    tailPhase += dt * (1 + lively * 1.4)
    TAIL.forEach((name, i) => addDelta(name, 0, Math.sin(tailPhase - i * .55) * (.14 + lively * .14),
      Math.sin(tailPhase * .7 - i * .4) * .05))
  }

  function apply() {
    for (const entry of bones.values()) {
      entry.object.quaternion.copy(entry.frame).invert().multiply(entry.delta).multiply(entry.frame).premultiply(entry.rest)
    }
  }

  // context: { moving, glow, viewer (camera position), focus (world point or null), hovered }
  function update(dt, { moving, glow = 1, viewer, focus = null, hovered = false }) {
    for (const [material, base] of glowing) material.emissiveIntensity = base * glow
    if (!moving) {
      if (!still) {
        // A still, natural pose: arms lowered, chin lifted a little toward the room camera.
        current = previous = gesture = null
        for (const entry of bones.values()) entry.delta.identity()
        setDelta("左腕", 0, 0, -.2)
        setDelta("右腕", 0, 0, .2)
        setDelta("首", .06, 0, 0)
        setDelta("頭", -.12, 0, .05)
        groove.object.position.copy(groove.position)
        apply()
        root.updateMatrixWorld(true)
        springs.reset()
        for (const name of shapes.keys()) shape(name, 0)
        still = true
      }
      return false
    }
    still = false
    clock += dt
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
    const changed = chooseGaze(dt, viewer, focus, hovered)
    look(dt, changed)
    expressions(dt)
    secondary(dt)
    apply()
    root.updateMatrixWorld(true)
    if (current && ankles.length) {
      // Correct within the same frame (a smoothed correction lags fast moves and lets the feet sink).
      const error = (Math.min(...ankles.map(ankle => ankle.getWorldPosition(anklePoint).y)) - ankleRest) / model.scale.y
      if (Math.abs(error) > 1e-4) {
        ground -= error
        groove.object.position.add(anklePoint.set(0, -error, 0).applyMatrix3(grooveLinear))
        root.updateMatrixWorld(true)
      }
    } else ground = 0
    springs.update(dt)
    return true
  }

  // A click: she turns to the visitor, brightens and answers with a gesture.
  function react() {
    reactFor = 2.4
    shyFor = 0
    hoverTime = 0
    face.widePulse = 1
    face.raisePulse = 1
    startBlink()
    const ready = GESTURES.filter(name => clips[name])
    if (ready.length) playGesture(pick(ready.filter(name => name !== lastGesture).concat(ready.length === 1 ? ready : [])))
  }

  function playGesture(name) {
    if (!clips[name] || gesture) return
    gesture = lastGesture = name
    startClip(name, .45)
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

  return { root, hitArea, motion, update, react, setMood }
}
