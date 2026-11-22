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

// The cottage's lighting and post effects: one module, dependencies before dependents.
const postAddons = [
  "math/SimplexNoise.js", "shaders/CopyShader.js", "shaders/OutputShader.js", "shaders/LuminosityHighPassShader.js",
  "shaders/GTAOShader.js", "shaders/PoissonDenoiseShader.js", "postprocessing/Pass.js", "postprocessing/ShaderPass.js",
  "postprocessing/MaskPass.js", "postprocessing/EffectComposer.js", "postprocessing/RenderPass.js",
  "postprocessing/OutputPass.js", "postprocessing/UnrealBloomPass.js", "postprocessing/GTAOPass.js",
  "environments/RoomEnvironment.js",
]
const version = JSON.parse(readFileSync(resolve(source, "package.json"), "utf8")).version

// Joins three's example modules into one file that imports only from the vendored three build.
function bundle(file, addons) {
  const threeNames = new Set()
  const exported = []
  const bodies = addons.map(name => {
    const text = readFileSync(resolve(source, "examples/jsm", name), "utf8")
      .replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';\s*$/gm, (_, names, from) => {
        if (from === "three") for (const item of names.split(",").map(part => part.trim()).filter(Boolean)) threeNames.add(item)
        else if (!from.startsWith(".")) throw new Error(`unexpected import ${from} in ${name}`)
        return ""
      })
      .replace(/^export\s*\{([^}]*)\};\s*$/gm, (_, names) => {
        exported.push(...names.split(",").map(part => part.trim()).filter(Boolean))
        return ""
      })
    if (/^\s*(import|export)\b/m.test(text)) throw new Error(`unhandled module syntax in ${name}`)
    return `// ---- three/examples/jsm/${name}\n${text.trim()}\n`
  })
  writeFileSync(resolve(output, file), [
    `// Bundled from three@${version} examples (MIT, see THREE-LICENSE.txt) by tools/build/vendor_three.mjs.`,
    `import { ${[...threeNames].sort().join(", ")} } from "./three.module.min.js"`, "", ...bodies,
    `export { ${exported.join(", ")} }`, "",
  ].join("\n"))
}

bundle("three-post.mjs", postAddons)
// Loads the 3D Yui model (GLB) into the cottage.
bundle("three-gltf.mjs", ["utils/BufferGeometryUtils.js", "loaders/GLTFLoader.js"])
