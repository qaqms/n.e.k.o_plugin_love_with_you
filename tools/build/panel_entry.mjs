import { readFileSync } from "node:fs"

const manifest = readFileSync(new URL("../../plugin.toml", import.meta.url), "utf8")
const version = manifest.match(/^version = "(\d+\.\d+\.\d+)"$/m)?.[1]
const panel = manifest.split(/^\[\[plugin\.ui\.panel\]\]\s*$/m)[1]?.split(/^\[/m)[0]
const entry = panel?.match(/^entry = "([^"]+)"$/m)?.[1]
if (!version || entry !== `static/panel-${version}.html`) {
  throw new Error("The plugin panel entry must include the release version to prevent stale HTML after upgrades.")
}

export const panelEntry = entry
export const panelUrl = `/plugin/love_with_you/ui/${entry.slice("static/".length)}`
