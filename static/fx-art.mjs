// Feedback textures and palettes. Everything here is cosmetic: no rule, save or RNG access.
const TAU = Math.PI * 2

// hot = bright core, mid = body, deep = edge and smoke. Keys are skill and zone identifiers.
const SETS = {
  fire: { hot: 0xfff2c2, mid: 0xffb057, deep: 0xe5532d },
  ice: { hot: 0xf2fdff, mid: 0x9be3f7, deep: 0x4f9fd6 },
  wind: { hot: 0xf0fff6, mid: 0x93e8cb, deep: 0x3fae98 },
  slash: { hot: 0xfffbe6, mid: 0xf6dc8e, deep: 0xd29a45 },
  guard: { hot: 0xf4fbff, mid: 0xb3d6ee, deep: 0x5f8fc0 },
  spark: { hot: 0xfffde0, mid: 0xffe76a, deep: 0xb58cff },
  stone: { hot: 0xf1ead2, mid: 0xc3b48e, deep: 0x7d6f55 },
  thrust: { hot: 0xffffff, mid: 0xf3e6c4, deep: 0xc9a25e },
  orbit: { hot: 0xf4fffb, mid: 0xa6e6da, deep: 0x4ea99d },
  rune: { hot: 0xffe9ff, mid: 0xe59bf0, deep: 0x9a4fc4 },
  quake: { hot: 0xf3e8c8, mid: 0xcaa978, deep: 0x7a5d3c },
  whirl: { hot: 0xffffff, mid: 0xe9ecd0, deep: 0x9fb5a0 },
  meteor: { hot: 0xfff0b8, mid: 0xff9a4a, deep: 0xd63d2a },
  heal: { hot: 0xf0fff0, mid: 0x9fe8b2, deep: 0x47a86b },
  beacon: { hot: 0xf5fbff, mid: 0xaedcf5, deep: 0x5b93c9 },
  hurt: { hot: 0xffe1d8, mid: 0xff8a7a, deep: 0xc0392b },
}
Object.assign(SETS, { flame: SETS.fire, frost: SETS.ice, pull: SETS.wind, dash: SETS.slash, armor: SETS.guard })

// Combat modules pass their own flat colours; map those back to a full palette.
const LEGACY = new Map([
  [0xefae76, "fire"], [0xf3b078, "fire"], [0x8bd8ca, "wind"], [0x9cdbcb, "wind"], [0xf2dda0, "slash"], [0xf3e2ac, "slash"],
  [0xabcbe5, "guard"], [0xb4d8e4, "guard"], [0xa6e9fb, "ice"], [0xb2e6f0, "ice"], [0xc1f4ff, "ice"],
  [0xe7db9d, "spark"], [0xb6c7a0, "stone"], [0xf1e3c7, "thrust"], [0xb4ded8, "orbit"], [0xd5acc3, "rune"],
  [0xe5e4c8, "whirl"], [0xf2ba8e, "meteor"], [0xade1bd, "heal"], [0xb2d9ec, "beacon"], [0xe6a7a0, "hurt"],
])
export const mix = (a, b, t) => {
  const ch = shift => Math.round((a >> shift & 255) + ((b >> shift & 255) - (a >> shift & 255)) * t)
  return ch(16) << 16 | ch(8) << 8 | ch(0)
}
export function palette(key) {
  if (typeof key === "string") return SETS[key] || SETS.slash
  const name = LEGACY.get(key)
  return name ? SETS[name] : { hot: mix(key, 0xffffff, .7), mid: key, deep: mix(key, 0x20242c, .45) }
}
export const paletteName = color => LEGACY.get(color) || ""
export const FOE_COLORS = { slime: 0x9fd6a0, wisp: 0xa9dcf0, brute: 0xc79aa8, charger: 0xd9a48a,
  caster: 0xa9c29a, sentinel: 0xa8c49b, oracle: 0xb9a8cb, boss: 0x8fb0b0 }
export const DIGITS = "0123456789+-"
export const DIGIT_CELL = { width: 26, height: 36 }

function canvas(scene, key, width, height, draw) {
  if (scene.textures.exists(key)) return
  const texture = scene.textures.createCanvas(key, width, height)
  draw(texture.context)
  texture.refresh()
}
const hex = color => `#${color.toString(16).padStart(6, "0")}`

// Projectile sprites grow to 48px so each element can carry its own silhouette and halo.
export function drawProjectile(ctx, name) {
  const halo = (color, radius = 22, alpha = "66") => {
    const fill = ctx.createRadialGradient(24, 24, 2, 24, 24, radius)
    fill.addColorStop(0, color + alpha); fill.addColorStop(1, color + "00")
    ctx.fillStyle = fill; ctx.fillRect(0, 0, 48, 48)
  }
  if (name === "stone") {
    halo("#3a2f22", 20, "55")
    ctx.fillStyle = "#6f6450"; ctx.beginPath()
    ctx.moveTo(9, 17); ctx.lineTo(24, 9); ctx.lineTo(39, 16); ctx.lineTo(41, 29); ctx.lineTo(29, 39); ctx.lineTo(13, 36); ctx.lineTo(7, 26)
    ctx.closePath(); ctx.fill()
    ctx.fillStyle = "#b9aa85"; ctx.beginPath()
    ctx.moveTo(9, 17); ctx.lineTo(24, 9); ctx.lineTo(39, 16); ctx.lineTo(30, 23); ctx.lineTo(17, 25); ctx.closePath(); ctx.fill()
    ctx.fillStyle = "#e9dfc0"; ctx.beginPath(); ctx.moveTo(24, 9); ctx.lineTo(39, 16); ctx.lineTo(30, 23); ctx.closePath(); ctx.fill()
    ctx.strokeStyle = "#3d3427"; ctx.lineWidth = 1.5; ctx.beginPath()
    ctx.moveTo(9, 17); ctx.lineTo(24, 9); ctx.lineTo(39, 16); ctx.lineTo(41, 29); ctx.lineTo(29, 39); ctx.lineTo(13, 36); ctx.lineTo(7, 26); ctx.closePath(); ctx.stroke()
    ctx.strokeStyle = "#4b4032"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(17, 25); ctx.lineTo(21, 34); ctx.moveTo(30, 23); ctx.lineTo(33, 33); ctx.stroke()
  } else if (name === "ice") {
    halo("#8fe3ff", 22, "55")
    ctx.fillStyle = "#4f9fd6"; ctx.beginPath()
    ctx.moveTo(46, 24); ctx.lineTo(20, 14); ctx.lineTo(3, 24); ctx.lineTo(20, 34); ctx.closePath(); ctx.fill()
    ctx.fillStyle = "#9be3f7"; ctx.beginPath(); ctx.moveTo(46, 24); ctx.lineTo(20, 14); ctx.lineTo(14, 24); ctx.closePath(); ctx.fill()
    ctx.fillStyle = "#f2fdff"; ctx.beginPath(); ctx.moveTo(46, 24); ctx.lineTo(22, 19); ctx.lineTo(24, 24); ctx.closePath(); ctx.fill()
    ctx.strokeStyle = "#e6fbff"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(44, 24); ctx.lineTo(5, 24); ctx.stroke()
    ctx.fillStyle = "#cdf3ff"; ctx.beginPath(); ctx.moveTo(12, 14); ctx.lineTo(19, 20); ctx.lineTo(9, 20); ctx.closePath(); ctx.fill()
    ctx.beginPath(); ctx.moveTo(12, 34); ctx.lineTo(19, 28); ctx.lineTo(9, 28); ctx.closePath(); ctx.fill()
  } else if (name === "wind") {
    halo("#93e8cb", 22, "44")
    for (const [width, color, shift] of [[9, "#3fae98aa", 0], [5, "#93e8cb", 1], [2, "#f0fff6", 2]]) {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.beginPath()
      ctx.moveTo(14 + shift, 6); ctx.quadraticCurveTo(46, 24, 14 + shift, 42); ctx.stroke()
    }
    ctx.strokeStyle = "#f0fff6aa"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(6, 14); ctx.quadraticCurveTo(26, 24, 6, 34); ctx.stroke()
  } else {
    const [outer, body] = name === "fusion" ? ["#3fd2b4", "#8ff0d2"] : name === "awakened" ? ["#ff7a2f", "#ffd27a"] : ["#e5532d", "#ffb057"]
    halo(outer, 23, "77")
    // Teardrop pointing right: the tail trails behind the direction of travel.
    const drop = (scale, color) => {
      ctx.fillStyle = color; ctx.beginPath()
      ctx.moveTo(24 - 22 * scale, 24)
      ctx.quadraticCurveTo(24 - 2 * scale, 24 - 15 * scale, 24 + 10 * scale, 24 - 11 * scale)
      ctx.bezierCurveTo(24 + 24 * scale, 24 - 9 * scale, 24 + 24 * scale, 24 + 9 * scale, 24 + 10 * scale, 24 + 11 * scale)
      ctx.quadraticCurveTo(24 - 2 * scale, 24 + 15 * scale, 24 - 22 * scale, 24)
      ctx.fill()
    }
    drop(1, outer); drop(.74, body); drop(.46, "#fff2c2")
    ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.ellipse(31, 24, 5, 4, 0, 0, TAU); ctx.fill()
    if (name !== "fire") {
      ctx.strokeStyle = name === "fusion" ? "#d6fff2" : "#fff0b0"; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.ellipse(27, 24, 17, 13, 0, .5, TAU - .5); ctx.stroke()
    }
  }
}

export function installFxTextures(scene) {
  canvas(scene, "fx-glow", 64, 64, ctx => {
    const fill = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    fill.addColorStop(0, "#ffffffff"); fill.addColorStop(.25, "#ffffffb0"); fill.addColorStop(.6, "#ffffff38"); fill.addColorStop(1, "#ffffff00")
    ctx.fillStyle = fill; ctx.fillRect(0, 0, 64, 64)
  })
  canvas(scene, "fx-streak", 48, 12, ctx => {
    const fill = ctx.createLinearGradient(0, 0, 48, 0)
    fill.addColorStop(0, "#ffffff00"); fill.addColorStop(.7, "#ffffffd0"); fill.addColorStop(1, "#ffffff")
    ctx.fillStyle = fill; ctx.beginPath()
    ctx.moveTo(0, 6); ctx.quadraticCurveTo(34, 0, 48, 6); ctx.quadraticCurveTo(34, 12, 0, 6); ctx.fill()
  })
  canvas(scene, "fx-shard", 20, 28, ctx => {
    ctx.fillStyle = "#ffffff"; ctx.beginPath()
    ctx.moveTo(10, 0); ctx.lineTo(19, 11); ctx.lineTo(12, 28); ctx.lineTo(1, 13); ctx.closePath(); ctx.fill()
    ctx.fillStyle = "#00000030"; ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(1, 13); ctx.lineTo(12, 28); ctx.lineTo(9, 13); ctx.closePath(); ctx.fill()
  })
  canvas(scene, "fx-chunk", 20, 20, ctx => {
    ctx.fillStyle = "#ffffff"; ctx.beginPath()
    ctx.moveTo(3, 6); ctx.lineTo(11, 1); ctx.lineTo(18, 7); ctx.lineTo(17, 15); ctx.lineTo(8, 19); ctx.lineTo(2, 13); ctx.closePath(); ctx.fill()
    ctx.fillStyle = "#00000040"; ctx.beginPath(); ctx.moveTo(2, 13); ctx.lineTo(8, 19); ctx.lineTo(17, 15); ctx.lineTo(10, 11); ctx.closePath(); ctx.fill()
  })
  canvas(scene, "fx-star", 32, 32, ctx => {
    ctx.fillStyle = "#ffffff"; ctx.beginPath()
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU, r = i % 2 ? 3.2 : 16
      ctx[i ? "lineTo" : "moveTo"](16 + Math.cos(a) * r, 16 + Math.sin(a) * r)
    }
    ctx.closePath(); ctx.fill()
  })
  canvas(scene, "fx-puff", 48, 48, ctx => {
    for (const [x, y, r] of [[24, 26, 15], [15, 22, 10], [33, 21, 11], [22, 15, 10], [31, 32, 9]]) {
      const fill = ctx.createRadialGradient(x, y, 0, x, y, r)
      fill.addColorStop(0, "#ffffffa0"); fill.addColorStop(1, "#ffffff00")
      ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill()
    }
  })
  canvas(scene, "fx-tongue", 24, 40, ctx => {
    const fill = ctx.createLinearGradient(0, 40, 0, 0)
    fill.addColorStop(0, "#ffffff"); fill.addColorStop(.55, "#ffffffc0"); fill.addColorStop(1, "#ffffff00")
    ctx.fillStyle = fill; ctx.beginPath()
    ctx.moveTo(12, 0); ctx.bezierCurveTo(20, 12, 24, 22, 21, 31); ctx.quadraticCurveTo(18, 40, 12, 40)
    ctx.quadraticCurveTo(5, 40, 3, 31); ctx.bezierCurveTo(0, 22, 9, 14, 12, 0); ctx.fill()
  })
  canvas(scene, "fx-ring", 128, 128, ctx => {
    const fill = ctx.createRadialGradient(64, 64, 44, 64, 64, 64)
    fill.addColorStop(0, "#ffffff00"); fill.addColorStop(.62, "#ffffffe0"); fill.addColorStop(.8, "#ffffff70"); fill.addColorStop(1, "#ffffff00")
    ctx.fillStyle = fill; ctx.fillRect(0, 0, 128, 128)
  })
  canvas(scene, "fx-vignette", 256, 256, ctx => {
    // Stretched over the viewport: clear in the middle, already visible at the edge midpoints.
    const fill = ctx.createRadialGradient(128, 128, 62, 128, 128, 182)
    fill.addColorStop(0, "#ffffff00"); fill.addColorStop(.3, "#ffffff2c"); fill.addColorStop(.55, "#ffffff90"); fill.addColorStop(1, "#fffffff0")
    ctx.fillStyle = fill; ctx.fillRect(0, 0, 256, 256)
  })
  const { width, height } = DIGIT_CELL
  canvas(scene, "fx-digits", width * DIGITS.length, height, ctx => {
    ctx.font = "900 30px 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif"
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round"
    for (const [index, glyph] of [...DIGITS].entries()) {
      const x = index * width + width / 2, y = height / 2 + 1
      ctx.strokeStyle = "#1b1420"; ctx.lineWidth = 6; ctx.strokeText(glyph, x, y)
      ctx.fillStyle = "#ffffff"; ctx.fillText(glyph, x, y)
    }
  })
  if (!scene.cache.bitmapFont.exists("fx-digits")) {
    scene.cache.bitmapFont.add("fx-digits", Phaser.GameObjects.RetroFont.Parse(scene, {
      image: "fx-digits", width, height, chars: DIGITS, charsPerRow: DIGITS.length,
      offset: { x: 0, y: 0 }, spacing: { x: 0, y: 0 }, lineSpacing: 0,
    }))
  }
}
