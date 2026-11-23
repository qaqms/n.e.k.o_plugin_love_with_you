// What moves in the cottage's surroundings (0.9.47): sheep and cows that graze, look up and wander a few steps,
// smoke from the village chimneys, and now and then a small flock of birds crossing the sky behind the house.
// Purely decorative, like the rest of the grounds. Every kind is one instanced mesh, so the whole herd costs four
// draw calls, the smoke one and the birds one. It only moves while the cottage's ambient motion runs (dt > 0).
import * as T from "./engine/three.module.min.js"
import { mergeGeometries } from "./engine/three-gltf.mjs"

const random = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647
const between = (r, a, b) => a + r() * (b - a)

// One vertex-coloured geometry from parts: [geometry, colour, position, rotation, scale].
function model(parts) {
  const geometries = parts.map(([geometry, color, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]]) => {
    const part = geometry.index ? geometry.toNonIndexed() : geometry.clone()
    for (const name of Object.keys(part.attributes)) if (name !== "position" && name !== "normal") part.deleteAttribute(name)
    part.applyMatrix4(new T.Matrix4().compose(new T.Vector3(...position),
      new T.Quaternion().setFromEuler(new T.Euler(...rotation)), new T.Vector3(...scale)))
    const c = new T.Color(color), colors = new Float32Array(part.attributes.position.count * 3)
    for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i)
    part.setAttribute("color", new T.BufferAttribute(colors, 3))
    geometry.dispose()
    return part
  })
  const merged = mergeGeometries(geometries)
  for (const part of geometries) part.dispose()
  return merged
}

// Both animals face +x. The head is a separate model hinged at the neck, so it can drop to graze.
const SHEEP = {
  speed: .42,
  room: .75,
  neck: [.36, .56, 0],
  graze: .95,
  body: () => model([
    [new T.IcosahedronGeometry(.32, 1), 0xf4f1ea, [0, .5, 0], [0, 0, 0], [1.35, .95, 1]],
    [new T.IcosahedronGeometry(.2, 1), 0xf7f4ee, [-.12, .66, 0]],
    ...[[.22, .14], [.22, -.14], [-.22, .14], [-.22, -.14]].map(([x, z]) => [new T.CylinderGeometry(.04, .035, .32, 5), 0x3a3330, [x, .16, z]]),
  ]),
  head: () => model([
    [new T.SphereGeometry(.14, 10, 8), 0x3a3330, [.12, .02, 0], [0, 0, 0], [1.25, 1, .9]],
    [new T.IcosahedronGeometry(.09, 0), 0xf4f1ea, [.05, .12, 0]],
    ...[1, -1].map(side => [new T.SphereGeometry(.06, 6, 4), 0x3a3330, [.04, .05, side * .14], [side * .5, 0, 0], [.6, .4, 1.2]]),
  ]),
}
const COW = {
  speed: .34,
  room: 1.5,
  neck: [.55, .86, 0],
  graze: 1.05,
  body: () => model([
    [new T.CapsuleGeometry(.27, .62, 4, 10), 0xf2eee6, [0, .76, 0], [0, 0, Math.PI / 2], [1, 1, .88]],
    ...[[.12, .88, .2, .17], [-.28, .74, -.21, .16], [-.36, .9, .14, .12], [.24, .7, -.2, .12]]
      .map(([x, y, z, s]) => [new T.SphereGeometry(s, 8, 6), 0x5b3d2e, [x, y, z], [0, 0, 0], [1.5, 1, .32]]),
    [new T.SphereGeometry(.11, 8, 6), 0xe9a7a0, [-.2, .5, 0], [0, 0, 0], [1, .7, 1]],
    ...[[.33, .15], [.33, -.15], [-.34, .15], [-.34, -.15]].flatMap(([x, z]) => [
      [new T.CylinderGeometry(.065, .055, .46, 6), 0xf2eee6, [x, .3, z]],
      [new T.CylinderGeometry(.06, .06, .08, 6), 0x3b302a, [x, .04, z]],
    ]),
    [new T.CylinderGeometry(.018, .018, .5, 4), 0xf2eee6, [-.62, .62, 0], [0, 0, -.25]],
    [new T.SphereGeometry(.05, 6, 4), 0x5b3d2e, [-.68, .38, 0]],
  ]),
  head: () => model([
    [new T.BoxGeometry(.32, .26, .24), 0xf2eee6, [.2, -.02, 0]],
    [new T.BoxGeometry(.18, .1, .25), 0x5b3d2e, [.17, .11, 0]],
    [new T.BoxGeometry(.13, .15, .2), 0xe9a7a0, [.39, -.08, 0]],
    ...[1, -1].flatMap(side => [
      [new T.ConeGeometry(.03, .14, 5), 0xece2c6, [.15, .17, side * .1], [side * -.6, 0, 0]],
      [new T.SphereGeometry(.06, 6, 4), 0x5b3d2e, [.1, .06, side * .16], [side * .6, 0, 0], [.5, .4, 1.3]],
    ]),
  ]),
}

// A small wandering area: a rectangle (the pen) or a circle around where the animal stands.
function area(spec) {
  if (spec.w) return {
    pick: r => [spec.x + between(r, -spec.w / 2, spec.w / 2), spec.z + between(r, -spec.d / 2, spec.d / 2)],
  }
  return {
    pick: r => {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * spec.r
      return [spec.x + Math.cos(a) * d, spec.z + Math.sin(a) * d]
    },
  }
}

function herd(scene, kind, animals, ground, seed) {
  const r = random(seed)
  const flat = kind === SHEEP
  const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: flat })
  const body = new T.InstancedMesh(kind.body(), mat, animals.length)
  const head = new T.InstancedMesh(kind.head(), mat, animals.length)
  for (const mesh of [body, head]) {
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    scene.add(mesh)
  }
  const states = animals.map(({ x, z, turn, grazing, within }) => ({
    x, z, turn, within: area(within), target: null,
    mode: grazing ? "graze" : "look", timer: between(r, 1, 8),
    pitch: grazing ? kind.graze : 0, yaw: 0, step: r() * 6, bob: 0,
  }))
  const m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), one = new T.Vector3(1, 1, 1)
  const neck = new T.Vector3(...kind.neck), pivot = new T.Vector3()

  // A spot to walk to that keeps clear of where the others stand or are heading (a few tries, then any).
  function roomy(self) {
    let spot
    for (let i = 0; i < 6; i++) {
      spot = self.within.pick(r)
      if (states.every(o => o === self || Math.hypot(o.x - spot[0], o.z - spot[1]) > kind.room &&
        (!o.target || o.mode !== "walk" || Math.hypot(o.target[0] - spot[0], o.target[1] - spot[1]) > kind.room))) break
    }
    return spot
  }

  function place() {
    states.forEach((s, i) => {
      q.setFromEuler(e.set(0, s.turn, 0))
      m.compose(p.set(s.x, ground + s.bob, s.z), q, one)
      body.setMatrixAt(i, m)
      // The head hinges at the neck: turn (yaw) then drop (pitch), in the body's frame.
      pivot.copy(neck).applyQuaternion(q).add(p)
      q.setFromEuler(e.set(0, s.turn + s.yaw, -s.pitch, "YZX"))
      m.compose(pivot, q, one)
      head.setMatrixAt(i, m)
    })
    body.instanceMatrix.needsUpdate = head.instanceMatrix.needsUpdate = true
  }

  // night: 0 by day to 1 at night; after dark they stay where they are.
  function update(dt, night) {
    if (!dt) return
    for (const s of states) {
      s.timer -= dt
      if (s.mode === "walk") {
        const dx = s.target[0] - s.x, dz = s.target[1] - s.z, distance = Math.hypot(dx, dz)
        // Facing +x after turning by `turn` means heading (cos, -sin).
        const want = Math.atan2(-dz, dx)
        let off = (want - s.turn + Math.PI * 3) % (Math.PI * 2) - Math.PI
        s.turn += Math.sign(off) * Math.min(Math.abs(off), dt * 1.6)
        off = Math.abs(off)
        if (off < .7) {
          const move = Math.min(distance, kind.speed * dt * (1 - off))
          s.x += Math.cos(s.turn) * move
          s.z -= Math.sin(s.turn) * move
          s.step += move * 9
        }
        s.bob = Math.abs(Math.sin(s.step)) * .03
        s.pitch = T.MathUtils.damp(s.pitch, .1, 4, dt)
        if (distance < .08 || s.timer < 0) {
          s.mode = "graze"
          s.timer = between(r, 5, 12)
          s.bob = 0
        }
      } else if (s.mode === "graze") {
        s.pitch = T.MathUtils.damp(s.pitch, kind.graze + Math.sin(s.timer * 2.3) * .06, 3, dt)
        s.yaw = T.MathUtils.damp(s.yaw, 0, 3, dt)
        if (s.timer < 0) {
          if (night < .5 && r() < .55) {
            s.mode = "walk"
            s.target = roomy(s)
            s.timer = 14
          } else {
            s.mode = "look"
            s.timer = between(r, 2, 5)
            s.glance = between(r, -.6, .6)
          }
        }
      } else {
        s.pitch = T.MathUtils.damp(s.pitch, -.05, 3, dt)
        s.yaw = T.MathUtils.damp(s.yaw, s.glance || 0, 2, dt)
        if (s.timer < 0) {
          s.mode = "graze"
          s.timer = between(r, 4, 10)
        }
      }
    }
    place()
  }
  place()
  return { update }
}

// Puffs rise from each chimney, swelling and melting into the sky.
function smoke(scene, chimneys) {
  const PER = 10, LIFE = 7
  const geometry = new T.IcosahedronGeometry(1, 1)
  const mat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .42, depthWrite: false })
  const mesh = new T.InstancedMesh(geometry, mat, chimneys.length * PER)
  mesh.frustumCulled = false
  mesh.renderOrder = 2
  scene.add(mesh)
  const r = random(41)
  const puffs = chimneys.flatMap(origin => Array.from({ length: PER }, (_, i) => ({ origin, age: i / PER * LIFE, spin: r() * 6 })))
  const m = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3()
  const base = new T.Color(), color = new T.Color(), wind = new T.Vector2(.32, -.12)
  function update(dt, sky, night) {
    base.set(0xe8e6e2).lerp(sky, .2 + .5 * night)
    puffs.forEach((puff, i) => {
      puff.age = (puff.age + dt) % LIFE
      const t = puff.age / LIFE
      p.set(puff.origin.x + wind.x * puff.age + Math.sin(puff.spin + puff.age) * .06,
        puff.origin.y + puff.age * .42, puff.origin.z + wind.y * puff.age)
      const size = (.14 + t * .55) * (t > .8 ? (1 - t) / .2 : 1) * Math.min(1, t * 8)
      m.compose(p, q, s.setScalar(Math.max(size, 1e-4)))
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, color.copy(base).lerp(sky, t * .85))
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor.needsUpdate = true
  }
  update(0, new T.Color(0xcfe0ea), 0)
  return { update }
}

// A loose V of birds crossing the sky behind the house, flapping as they go, then a pause before the next.
function birds(scene, center, ground) {
  const COUNT = 7, FLIGHT = 30, PAUSE = 40
  const geometry = new T.BufferGeometry()
  geometry.setAttribute("position", new T.Float32BufferAttribute([
    0, 0, .14, 0, 0, -.12, .6, .16, -.06,
    0, 0, .14, -.6, .16, -.06, 0, 0, -.12,
  ], 3))
  const mesh = new T.InstancedMesh(geometry, new T.MeshBasicMaterial({ color: 0x454b55, side: T.DoubleSide }), COUNT)
  mesh.frustumCulled = false
  scene.add(mesh)
  const r = random(23)
  const offsets = Array.from({ length: COUNT }, (_, i) => {
    const rank = Math.ceil(i / 2), side = i % 2 ? 1 : -1
    return { back: rank * 1.5 + r() * .4, side: side * rank * 1.3, up: (r() - .5) * .6, phase: r() * 6, rate: 9 + r() * 2 }
  })
  let clock = FLIGHT * .2, pass = 0, height = 6
  const m = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), s = new T.Vector3()
  function update(dt, night) {
    clock += dt
    if (clock > FLIGHT + PAUSE) {
      clock = 0
      pass++
      height = between(r, 5, 7.5)
    }
    // Held still (low quality, reduced motion) there are no birds rather than birds frozen mid-air.
    const flying = dt > 0 && clock < FLIGHT && night < .45
    mesh.visible = flying
    if (!flying) return
    const t = clock / FLIGHT, dir = pass % 2 ? -1 : 1
    // From one side of the valley to the other over the meadow behind the house, low enough to cross the hills in view.
    const x = center.x + dir * (-45 + t * 90), z = center.y - 13 - Math.sin(t * Math.PI) * 4
    const y = ground + height + Math.sin(t * Math.PI * 3) * .8
    offsets.forEach((o, i) => {
      p.set(x - dir * o.back, y + o.up, z + o.side * .7)
      const flap = Math.cos(clock * o.rate + o.phase)
      q.setFromEuler(e.set(0, dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0))
      m.compose(p, q, s.set(1.25, 1.25 * flap, 1.25))
      mesh.setMatrixAt(i, m)
    })
    mesh.instanceMatrix.needsUpdate = true
  }
  update(0, 0)
  return { update }
}

// sheep / cows: [{ x, z, turn, grazing, within }]; chimneys: world positions of the chimney tops.
export function buildLife(scene, { sheep, cows, chimneys, ground, center }) {
  const flock = herd(scene, SHEEP, sheep, ground, 11)
  const cattle = herd(scene, COW, cows, ground, 12)
  const puffs = smoke(scene, chimneys)
  const flight = birds(scene, center, ground)
  return {
    update(dt, sky, night) {
      flock.update(dt, night)
      cattle.update(dt, night)
      puffs.update(dt, sky, night)
      flight.update(dt, night)
    },
  }
}
