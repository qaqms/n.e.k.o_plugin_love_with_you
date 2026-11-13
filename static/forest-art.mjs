import { DEPTH, groundDepth } from "./terrain-rules.mjs"

// Decorative artwork has its own fixed seed; it never consumes the run's RNG.
function canvasTexture(scene, key, width, height, draw) {
  if (scene.textures.exists(key)) return
  const texture = scene.textures.createCanvas(key, width, height)
  draw(texture.context)
  texture.refresh()
}

function ellipse(ctx, x, y, rx, ry, color, angle = 0) {
  ctx.fillStyle = color
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2); ctx.fill()
}

function stone(ctx, x, y, w, h, rng) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rng.realInRange(-.15, .15))
  ellipse(ctx, 4, h / 2 + 5, w * .64, h * .54, "#233c3e45")
  ctx.fillStyle = "#656e72"
  ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2 + 4); ctx.lineTo(-w / 2 + 5, -h / 2)
  ctx.lineTo(w / 2 - 3, -h / 2); ctx.lineTo(w / 2, h / 2 - 2)
  ctx.lineTo(w / 2 - 6, h / 2 + 5); ctx.lineTo(-w / 2 + 2, h / 2 + 5); ctx.closePath(); ctx.fill()
  const fill = ctx.createLinearGradient(0, -h / 2, 0, h / 2)
  fill.addColorStop(0, "#bcc3ba"); fill.addColorStop(1, "#919f9a")
  ctx.fillStyle = fill
  ctx.beginPath(); ctx.moveTo(-w / 2 + 1, -h / 2 + 4); ctx.lineTo(-w / 2 + 5, -h / 2)
  ctx.lineTo(w / 2 - 3, -h / 2); ctx.lineTo(w / 2, h / 2 - 5)
  ctx.lineTo(w / 2 - 6, h / 2); ctx.lineTo(-w / 2 + 2, h / 2); ctx.closePath(); ctx.fill()
  ctx.strokeStyle = "#e3e3ce88"; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(-w / 2 + 6, -h / 2 + 2); ctx.lineTo(w / 2 - 5, -h / 2 + 2); ctx.stroke()
  ctx.strokeStyle = "#617b7488"; ctx.beginPath(); ctx.moveTo(-w / 3, -h / 2)
  ctx.lineTo(-w / 5, 0); ctx.lineTo(-w / 4, h / 4); ctx.stroke()
  ellipse(ctx, -w / 3, h / 3, w / 5, 2.5, "#658f7899")
  ctx.restore()
}

function fern(ctx, x, y, size, angle) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle)
  ctx.strokeStyle = "#67886c"; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, 3); ctx.quadraticCurveTo(-2, -size / 2, 4, -size); ctx.stroke()
  for (let i = 1; i < 6; i++) {
    const yy = -size * i / 6, width = size * (1 - i / 7) * .36
    ellipse(ctx, -width / 2, yy, width, 2, i % 2 ? "#739b79" : "#92b187", .45)
    ellipse(ctx, width / 2 + 2, yy - 2, width, 2, i % 2 ? "#739b79" : "#92b187", -.45)
  }
  ctx.restore()
}

function paintGround(ctx, width, height, rng, props) {
  const base = ctx.createLinearGradient(0, 0, width, height)
  base.addColorStop(0, "#536f68"); base.addColorStop(.4, "#65816d")
  base.addColorStop(.7, "#698670"); base.addColorStop(1, "#405f5b")
  ctx.fillStyle = base; ctx.fillRect(0, 0, width, height)
  for (let i = 0; i < 12000; i++) {
    const x = rng.between(0, width), y = rng.between(0, height)
    ellipse(ctx, x, y, rng.between(2, 13), rng.between(1, 4),
      rng.pick(["#b9c79a12", "#263f4220", "#d7dac716", "#38666224", "#92ae7c21"]), -.5)
  }
  // A worn, branching footpath connects the central ruin to the edge of the arena.
  ctx.lineCap = "round"; ctx.lineJoin = "round"
  for (const [size, color] of [[126, "#91a28a25"], [92, "#aeb09a48"], [58, "#b7b6a054"]]) {
    ctx.strokeStyle = color; ctx.lineWidth = size
    ctx.beginPath(); ctx.moveTo(width * .1, height)
    ctx.bezierCurveTo(width * .29, height * .7, width * .34, height * .64, width * .51, height * .52)
    ctx.bezierCurveTo(width * .68, height * .44, width * .65, height * .22, width * .82, 0)
    ctx.stroke()
  }
  const cx = width / 2, cy = height / 2
  ellipse(ctx, cx, cy + 12, 230, 165, "#344d4e29")
  ellipse(ctx, cx, cy, 210, 150, "#9aa89950")
  ellipse(ctx, cx, cy, 174, 121, "#c2c6b780")
  // Paving follows one perspective; small breaks keep it from reading as a UI circle.
  ctx.save()
  ctx.beginPath(); ctx.ellipse(cx, cy, 176, 122, 0, 0, Math.PI * 2); ctx.clip()
  for (let row = -4; row <= 4; row++) for (let column = -5; column <= 5; column++) {
    const x = cx + column * 38 + (row % 2) * 19, y = cy + row * 30
    ctx.fillStyle = rng.pick(["#aab5aa", "#b7beb0", "#a3b2aa", "#c0c5b5"])
    ctx.fillRect(x + 1, y + 1, 36, 28)
    ctx.strokeStyle = "#dbe0ca40"; ctx.lineWidth = 1; ctx.strokeRect(x + 3, y + 3, 32, 24)
    if (rng.frac() < .16) {
      ctx.strokeStyle = "#65877d88"; ctx.beginPath()
      ctx.moveTo(x, y + 8); ctx.lineTo(x + 16, y + 17); ctx.lineTo(x + 13, y + 30); ctx.stroke()
    }
  }
  ctx.restore()
  ctx.strokeStyle = "#657f7666"; ctx.lineWidth = 2
  ctx.beginPath(); ctx.ellipse(cx, cy, 138, 94, 0, 0, Math.PI * 2); ctx.stroke()
  ctx.beginPath(); ctx.ellipse(cx, cy, 132, 90, 0, 0, Math.PI * 2); ctx.stroke()
  for (let i = 0; i < 450; i++) {
    const x = rng.between(20, width - 20), y = rng.between(20, height - 20)
    if (Math.hypot((x - cx) / 1.4, y - cy) < 155) continue
    if (i < 100) fern(ctx, x, y, rng.between(9, 18), rng.realInRange(-.9, .9))
    else {
      ctx.strokeStyle = rng.pick(["#91ad864e", "#b9c6984d", "#2e626346"]); ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x - 6, y - 5)
      ctx.moveTo(x, y); ctx.lineTo(x + 1, y - 8); ctx.moveTo(x + 3, y); ctx.lineTo(x + 5, y - 4); ctx.stroke()
      if (i % 9 === 0) ellipse(ctx, x, y - 6, 1.7, 1.4, rng.pick(["#d9d7b0", "#b5a5c3", "#8bbec0"]))
    }
  }
  // Contact and cast shadows remain on the floor, independently of prop sorting.
  for (const p of props) {
    const r = p.footprint
    ellipse(ctx, p.x + 8, p.y + 2, r.width * .7, r.height * .6, "#203b3e40", -.1)
    if (p.kind === "tree") ellipse(ctx, p.x + 15, p.y - 7, 62 * p.scale, 24 * p.scale, "#254c4930", -.3)
    if (p.kind === "column") ellipse(ctx, p.x + 27, p.y + 9, 38, 12, "#203b3e27", .3)
  }
  // Broad patches of sunlight are baked once, rather than composited every frame.
  ctx.fillStyle = "#ece9b713"; ctx.beginPath()
  ctx.moveTo(400, 0); ctx.lineTo(530, 0); ctx.lineTo(1180, height); ctx.lineTo(880, height); ctx.fill()
  ctx.fillStyle = "#e4e8cb10"; ctx.beginPath()
  ctx.moveTo(1050, 0); ctx.lineTo(1100, 0); ctx.lineTo(1500, height); ctx.lineTo(1330, height); ctx.fill()
}

function paintTree(ctx, rng, canopy) {
  if (!canopy) {
    ctx.fillStyle = "#586967"
    ctx.beginPath(); ctx.moveTo(86, 100); ctx.bezierCurveTo(83, 141, 94, 160, 73, 184)
    ctx.lineTo(90, 180); ctx.lineTo(98, 171); ctx.lineTo(106, 185); ctx.lineTo(112, 183)
    ctx.bezierCurveTo(102, 153, 110, 123, 111, 98); ctx.closePath(); ctx.fill()
    ctx.strokeStyle = "#9b9c7c"; ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(93, 117); ctx.quadraticCurveTo(90, 155, 89, 172); ctx.stroke()
    ctx.strokeStyle = "#384f56"; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(101, 125); ctx.quadraticCurveTo(98, 153, 103, 169); ctx.stroke()
    return
  }
  for (let i = 0; i < 62; i++) {
    const a = i * 2.399, r = Math.sqrt(i / 62)
    const x = 96 + Math.cos(a) * r * 62, y = 74 + Math.sin(a) * r * 53
    ellipse(ctx, x + 3, y + 8, rng.between(19, 28), rng.between(14, 23), "#294e4e")
  }
  for (let i = 61; i >= 0; i--) {
    const a = i * 2.399, r = Math.sqrt(i / 62)
    const x = 93 + Math.cos(a) * r * 62, y = 68 + Math.sin(a) * r * 51
    ellipse(ctx, x, y, rng.between(18, 26), rng.between(12, 21),
      rng.pick(["#507e68", "#56866d", "#659077", "#739c7a", "#4b7b6b"]), -.2)
    ellipse(ctx, x - 6, y - 6, rng.between(5, 12), 3, "#b6c58e30", -.3)
  }
  for (let i = 0; i < 150; i++) {
    const a = rng.realInRange(0, Math.PI * 2), r = Math.sqrt(rng.frac())
    ellipse(ctx, 91 + Math.cos(a) * r * 64, 66 + Math.sin(a) * r * 51, 3.5, 1.2,
      rng.pick(["#bdd09c55", "#254d4b55", "#8bad7f66"]), -.6)
  }
}

function paintProp(ctx, kind, rng, variant) {
  if (kind === "rock") {
    ctx.fillStyle = "#687b7b"
    ctx.beginPath(); ctx.moveTo(20, 78); ctx.lineTo(22, 59); ctx.lineTo(34, 45)
    ctx.lineTo(60, 43); ctx.lineTo(75, 58); ctx.lineTo(76, 76); ctx.lineTo(63, 84)
    ctx.lineTo(33, 84); ctx.closePath(); ctx.fill()
    ctx.fillStyle = "#a8b9ad"
    ctx.beginPath(); ctx.moveTo(23, 60); ctx.lineTo(35, 46); ctx.lineTo(60, 44)
    ctx.lineTo(72, 59); ctx.lineTo(58, 68); ctx.lineTo(36, 67); ctx.closePath(); ctx.fill()
    ctx.strokeStyle = "#d8debf"; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(27, 58); ctx.lineTo(36, 48); ctx.lineTo(56, 46); ctx.stroke()
    ctx.strokeStyle = "#536c6c"; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(58, 68); ctx.lineTo(55, 80); ctx.moveTo(43, 48)
    ctx.lineTo(45, 58); ctx.lineTo(40, 65); ctx.stroke()
    ellipse(ctx, 28, 78, 9, 3, "#72927b")
    ellipse(ctx, 65, 56, 6 + variant, 2, "#9db58b")
  } else if (kind === "rubble") {
    stone(ctx, 48, 72, 32, 17 + variant, rng)
  } else if (kind === "column") {
    stone(ctx, 48, 66, 43, 24, rng)
    stone(ctx, 48, 48, 30, 28, rng)
    stone(ctx, 48, 27, 29, 25, rng)
    stone(ctx, 46, 12, 38, 13, rng)
  } else {
    for (const [x, y] of [[20, 67], [46, 69], [71, 68], [29, 48], [56, 47]]) stone(ctx, x, y, 29, 22, rng)
    if (variant !== 1) stone(ctx, 42, 29, 29, 19, rng)
  }
}

export function paintForest(scene, width, height, props) {
  const seed = key => new Phaser.Math.RandomDataGenerator([`border-forest-v3-${key}`])
  canvasTexture(scene, "forest-ground-v3", width, height, ctx => paintGround(ctx, width, height, seed("floor"), props))
  scene.add.image(0, 0, "forest-ground-v3").setOrigin(0).setDepth(DEPTH.ground)
  const visuals = []
  for (const prop of props) {
    const { kind, variant, x, y, scale } = prop
    if (kind === "tree") {
      for (const canopy of [false, true]) {
        const key = `forest-tree-v3-${variant}-${canopy}`
        canvasTexture(scene, key, 192, 208, ctx => paintTree(ctx, seed(key), canopy))
        const image = scene.add.image(x, y, key).setOrigin(.5, 180 / 208)
          .setScale(scale).setDepth(groundDepth(y) + (canopy ? .01 : 0))
        visuals.push({ prop, image, canopy })
      }
    } else {
      const key = `forest-prop-v3-${kind}-${variant}`
      canvasTexture(scene, key, 96, 96, ctx => paintProp(ctx, kind, seed(key), variant))
      const image = scene.add.image(x, y, key).setOrigin(.5, 84 / 96).setScale(scale).setDepth(groundDepth(y))
      visuals.push({ prop, image, canopy: false })
    }
  }
  return visuals
}

export function paintProjectiles(scene) {
  for (const name of ["fire", "wind", "ice", "stone", "awakened", "fusion"]) {
    canvasTexture(scene, `bolt-${name}`, 32, 32, ctx => {
      if (name === "stone") {
        ellipse(ctx, 16, 18, 13, 10, "#293f4544")
        ctx.fillStyle = "#7e958d"; ctx.beginPath()
        ctx.moveTo(5, 9); ctx.lineTo(19, 4); ctx.lineTo(28, 12); ctx.lineTo(26, 24)
        ctx.lineTo(12, 28); ctx.lineTo(3, 20); ctx.closePath(); ctx.fill()
        ctx.fillStyle = "#c8d0b9"; ctx.beginPath()
        ctx.moveTo(5, 9); ctx.lineTo(19, 4); ctx.lineTo(23, 13); ctx.lineTo(12, 17); ctx.closePath(); ctx.fill()
        ctx.strokeStyle = "#e4e4cd"; ctx.lineWidth = 1.5; ctx.beginPath()
        ctx.moveTo(8, 10); ctx.lineTo(18, 7); ctx.lineTo(21, 12); ctx.stroke()
      } else if (name === "ice") {
        ctx.fillStyle = "#75b9cf"; ctx.beginPath()
        ctx.moveTo(31, 16); ctx.lineTo(10, 8); ctx.lineTo(1, 16); ctx.lineTo(10, 23); ctx.closePath(); ctx.fill()
        ctx.fillStyle = "#ddf9ef"; ctx.beginPath(); ctx.moveTo(31, 16); ctx.lineTo(10, 10); ctx.lineTo(12, 16); ctx.closePath(); ctx.fill()
        ctx.strokeStyle = "#a7dfeb"; ctx.beginPath(); ctx.moveTo(28, 16); ctx.lineTo(2, 16); ctx.stroke()
      } else if (name === "wind") {
        ctx.strokeStyle = "#81cbbf"; ctx.lineWidth = 5; ctx.beginPath()
        ctx.moveTo(8, 3); ctx.quadraticCurveTo(31, 16, 8, 29); ctx.stroke()
        ctx.strokeStyle = "#e4f1d2"; ctx.lineWidth = 2; ctx.beginPath()
        ctx.moveTo(10, 5); ctx.quadraticCurveTo(32, 16, 10, 27); ctx.stroke()
      } else {
        const fill = ctx.createRadialGradient(20, 16, 1, 18, 16, 13)
        fill.addColorStop(0, "#fff6d2"); fill.addColorStop(.35, "#ffe5a2")
        fill.addColorStop(.7, name === "fusion" ? "#76d5c1" : "#ef9a69")
        fill.addColorStop(1, "#d8586200")
        ctx.fillStyle = fill; ctx.beginPath()
        ctx.moveTo(1, 9); ctx.quadraticCurveTo(14, 14, 20, 4)
        ctx.bezierCurveTo(36, 7, 35, 26, 19, 29); ctx.quadraticCurveTo(10, 21, 1, 24)
        ctx.lineTo(7, 17); ctx.closePath(); ctx.fill()
        ctx.fillStyle = "#fff4c9"; ctx.beginPath()
        ctx.moveTo(11, 16); ctx.quadraticCurveTo(23, 5, 27, 15); ctx.quadraticCurveTo(26, 23, 11, 16); ctx.fill()
        if (name !== "fire") {
          ctx.strokeStyle = name === "fusion" ? "#b7f1de" : "#f3de91"
          ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(18, 16, 13, 10, -.3, .2, 5.5); ctx.stroke()
        }
      }
    })
  }
}
