// Locate the read-only N.E.K.O host checkout next to the plugin.
// Order: NEKO_HOST_ROOT, then a sibling "N.E.K.O" or "N.E.K.O-main" (GitHub zip download).
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const siblings = ["N.E.K.O", "N.E.K.O-main"]

export function hostRoot() {
  if (process.env.NEKO_HOST_ROOT) return resolve(process.env.NEKO_HOST_ROOT)
  const found = siblings.map(name => resolve(pluginRoot, "..", name)).find(path => existsSync(join(path, "plugin")))
  return found || resolve(pluginRoot, "..", siblings[0])
}

// Python for the preview server: NEKO_PYTHON, then the host's .venv, then "python" on PATH.
export function previewPython() {
  if (process.env.NEKO_PYTHON) return process.env.NEKO_PYTHON
  const venv = join(hostRoot(), ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python")
  return existsSync(venv) ? venv : "python"
}
