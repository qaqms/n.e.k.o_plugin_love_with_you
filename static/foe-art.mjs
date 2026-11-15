// Raster enemies built from AI-drawn parts and baked into cut-out animation frames (see tools/foe-source).
// Frames are drawn at display size, so sprites use scale 1. Kinds without a sheet keep their vector look.
export const FOE_SHEETS = {
  slime: { key: "foe-slime", url: "art/foe-slime.png", cell: 56, move: [0, 8, 100], hurt: [8, 3, 80], death: [11, 5] },
  wisp: { key: "foe-wisp", url: "art/foe-wisp.png", cell: 56, move: [0, 8, 110], hurt: [8, 3, 80], death: [11, 5] },
  brute: { key: "foe-brute", url: "art/foe-brute.png", cell: 80, move: [0, 8, 95], hurt: [8, 3, 90], death: [11, 5] },
  charger: { key: "foe-charger", url: "art/foe-charger.png", cell: 80, move: [0, 8, 75], hurt: [8, 3, 90], death: [11, 5] },
  caster: { key: "foe-caster", url: "art/foe-caster.png", cell: 56, move: [0, 8, 120], hurt: [8, 3, 80], death: [11, 5] },
  sentinel: { key: "foe-sentinel", url: "art/foe-sentinel.png", cell: 104, move: [0, 8, 130], hurt: [8, 3, 90], death: [11, 5] },
  oracle: { key: "foe-oracle", url: "art/foe-oracle.png", cell: 104, move: [0, 8, 130], hurt: [8, 3, 90], death: [11, 5] },
  boss: { key: "foe-boss", url: "art/foe-boss.png", cell: 128, move: [0, 8, 140], hurt: [8, 3, 90], death: [11, 5] },
}
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
