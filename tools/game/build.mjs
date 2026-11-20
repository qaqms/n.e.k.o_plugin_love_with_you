import { copyFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const phaserRoot = dirname(require.resolve("phaser/package.json"))
const output = resolve(root, "../../static/engine")
mkdirSync(output, { recursive: true })
copyFileSync(join(phaserRoot, "dist/phaser.min.js"), join(output, "phaser-3.90.0.min.js"))
copyFileSync(join(phaserRoot, "LICENSE.md"), join(output, "PHASER-LICENSE.md"))
const emitterRoot = dirname(require.resolve("eventemitter3/package.json"))
copyFileSync(join(emitterRoot, "LICENSE"), join(output, "EVENTEMITTER3-LICENSE.txt"))
const astarRoot = dirname(require.resolve("javascript-astar/package.json"))
copyFileSync(join(astarRoot, "astar.js"), join(output, "astar-0.4.1.js"))
copyFileSync(join(astarRoot, "LICENSE"), join(output, "ASTAR-LICENSE.txt"))
console.log("Bundled Phaser 3.90.0, javascript-astar 0.4.1 and dependency licenses.")
