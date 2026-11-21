// Small ambient motion for the cottage (redesign step 4): steam over the warm mugs, dust drifting in the
// window light by day, and fireflies over the yard at night. Purely decorative: it reads the lighting state
// and never touches anything else. The caller turns it off for low quality and reduced motion.
import * as T from "./engine/three.module.min.js"

function sampler(seed) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
}

// A soft round dot, shared by every particle layer.
function dotTexture() {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext("2d")
  const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  glow.addColorStop(0, "rgba(255,255,255,1)")
  glow.addColorStop(.35, "rgba(255,255,255,.55)")
  glow.addColorStop(1, "rgba(255,255,255,0)")
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, 64, 64)
  const map = new T.CanvasTexture(canvas)
  map.colorSpace = T.SRGBColorSpace
  return map
}

// Points with a colour and alpha each, so every particle can fade on its own. Glowing ones add light.
function layer(scene, count, size, map, glowing = false) {
  const geometry = new T.BufferGeometry()
  geometry.setAttribute("position", new T.BufferAttribute(new Float32Array(count * 3), 3))
  geometry.setAttribute("color", new T.BufferAttribute(new Float32Array(count * 4), 4))
  const material = new T.PointsMaterial({
    size, map, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true,
    blending: glowing ? T.AdditiveBlending : T.NormalBlending,
  })
  const points = new T.Points(geometry, material)
  points.frustumCulled = false
  points.visible = false
  points.renderOrder = 2
  scene.add(points)
  return points
}

// steam: [{ at: Vector3, upper: boolean }]; upstairs sources follow the storey as it lifts away.
export function createAmbient(scene, { steam: sources }) {
  const rand = sampler(97)
  const map = dotTexture()

  const STEAM_EACH = 14
  const steam = layer(scene, sources.length * STEAM_EACH, .3, map)
  const puffs = sources.flatMap(source => Array.from({ length: STEAM_EACH }, (_, i) =>
    ({ source, age: i / STEAM_EACH * 2.4, life: 2.2 + rand() * .5, drift: rand() * Math.PI * 2 })))

  // Dust inside the beam that falls from the living-room window toward the sofa.
  const DUST = 70
  const dust = layer(scene, DUST, .12, map)
  const motes = Array.from({ length: DUST }, () => ({
    x: -2.3 + rand() * 2.6, y: .5 + rand() * 2.3, z: -2.4 + rand() * 1.9, phase: rand() * 6.3, speed: .5 + rand() * .6,
  }))

  const FIREFLIES = 26
  const fireflies = layer(scene, FIREFLIES, .4, map, true)
  const flies = Array.from({ length: FIREFLIES }, () => ({
    x: 7.3 + rand() * 3.6, y: .35 + rand() * 1.2, z: -1.2 + rand() * 4.2, phase: rand() * 6.3, blink: .6 + rand() * .9,
  }))

  let clock = 0
  const layers = [steam, dust, fireflies]

  // night: 0 by day, 1 at night; sun: how strong the window light is (0 when the curtains are drawn).
  // lift: how far the upper storey is raised; upperShown: whether it is on screen at all.
  function update(dt, { enabled, night, sun, lift, upperShown }) {
    if (!enabled) {
      for (const points of layers) points.visible = false
      return false
    }
    clock += dt

    steam.visible = true
    const steamPosition = steam.geometry.attributes.position
    const steamColor = steam.geometry.attributes.color
    puffs.forEach((puff, i) => {
      puff.age += dt
      if (puff.age > puff.life) puff.age -= puff.life
      const t = puff.age / puff.life
      const sway = Math.sin(clock * 1.3 + puff.drift + t * 4) * .025 * t
      const { at, upper } = puff.source
      steamPosition.setXYZ(i, at.x + sway, at.y + (upper ? lift : 0) + t * .32, at.z + Math.cos(puff.drift) * .012 * t)
      const fade = upper && !upperShown ? 0 : Math.sin(Math.PI * t) * .32
      steamColor.setXYZW(i, 1, 1, .97, fade)
    })
    steamPosition.needsUpdate = steamColor.needsUpdate = true

    const dustStrength = Math.max(0, sun) * (1 - night)
    dust.visible = dustStrength > .02
    if (dust.visible) {
      const position = dust.geometry.attributes.position
      const color = dust.geometry.attributes.color
      motes.forEach((mote, i) => {
        const t = clock * mote.speed * .12 + mote.phase
        position.setXYZ(i, mote.x + Math.sin(t) * .18, mote.y + Math.sin(t * .7) * .12, mote.z + Math.cos(t * .9) * .15)
        const twinkle = .55 + .45 * Math.sin(clock * mote.speed + mote.phase)
        color.setXYZW(i, 1, .93, .78, .75 * dustStrength * twinkle)
      })
      position.needsUpdate = color.needsUpdate = true
    }

    fireflies.visible = night > .05
    if (fireflies.visible) {
      const position = fireflies.geometry.attributes.position
      const color = fireflies.geometry.attributes.color
      flies.forEach((fly, i) => {
        const t = clock * .35 + fly.phase
        position.setXYZ(i, fly.x + Math.sin(t) * .35, fly.y + Math.sin(t * 1.7) * .15, fly.z + Math.cos(t * .8) * .35)
        const glow = night * Math.max(0, Math.sin(clock * fly.blink + fly.phase)) ** 3
        color.setXYZW(i, glow, glow, glow * .5, 1)
      })
      position.needsUpdate = color.needsUpdate = true
    }
    return true
  }

  return { update }
}
