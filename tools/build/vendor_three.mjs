import { copyFileSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const source = resolve(dirname(require.resolve("three")), "..")
const output = fileURLToPath(new URL("../../static/engine/", import.meta.url))
for (const name of ["three.module.min.js", "three.core.min.js"]) {
  copyFileSync(resolve(source, "build", name), resolve(output, name))
}
const roundedBox = readFileSync(resolve(source, "examples/jsm/geometries/RoundedBoxGeometry.js"), "utf8")
writeFileSync(resolve(output, "three-rounded-box.mjs"), roundedBox.replace("from 'three'", "from './three.module.min.js'"))
copyFileSync(resolve(source, "LICENSE"), resolve(output, "THREE-LICENSE.txt"))
