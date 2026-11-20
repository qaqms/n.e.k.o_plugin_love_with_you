// Raster enemies built from AI-drawn parts and baked into cut-out animation frames (see tools/foe-source).
// Frames are drawn at display size, so sprites use scale 1. Kinds without a sheet keep their vector look.
// 0.9.7 cartoon sheets: 16 cells per row — six idle/move squash frames, wind-up, attack, hurt and four death frames.
const CELLS = { slime: 82, wisp: 82, brute: 116, charger: 116, caster: 82, sentinel: 150, oracle: 150, boss: 186 }
export const FOE_SHEETS = Object.fromEntries(Object.entries(CELLS).map(([kind, cell]) => [kind, {
  key: `foe-${kind}`, url: `art/foe-${kind}.png`, cell, move: [0, 6, kind === "boss" ? 150 : 110],
  windup: [6, 2, 120], attack: [8, 2, 90], hurt: [10, 2, 80], death: [12, 4] }]))
// World-space collision circle of the vector enemies at each scale: radius 19 at offset (13, 29) in a 64x72 frame.
const BODY = { radius: 19, left: 13 - 32, top: 29 - 36 }

export function loadFoes(scene) {
  for (const sheet of Object.values(FOE_SHEETS)) {
    scene.load.spritesheet(sheet.key, sheet.url, { frameWidth: sheet.cell, frameHeight: sheet.cell })
  }
}
export const foeSheet = (scene, kind) => {
  const sheet = FOE_SHEETS[kind]
  return sheet && scene.textures.exists(sheet.key) ? sheet : null
}
// Swap a freshly made enemy onto its raster sheet while keeping the exact world-space body it had.
export function fitFoe(enemy, kind) {
  const sheet = foeSheet(enemy.scene, kind)
  if (!sheet) return enemy
  const scale = enemy.scaleX
  // The vector look tinted one shared drawing per kind; drawn sheets carry their own colours.
  enemy.setTexture(sheet.key, 0).setScale(1).clearTint()
  enemy.body.setCircle(BODY.radius * scale, sheet.cell / 2 + BODY.left * scale, sheet.cell / 2 + BODY.top * scale)
  return enemy
}
