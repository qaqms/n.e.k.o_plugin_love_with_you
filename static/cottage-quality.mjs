// How the cottage's "auto" quality is chosen (0.9.46). Pure functions; cottage.mjs supplies the adapter name and
// the measured frame costs, and keeps the result per adapter in local storage.
//
// 1. A starting tier from the graphics adapter: software renderers and phone GPUs start low, integrated graphics
//    medium, dedicated cards high. Unrecognised adapters fall back to the processor count.
// 2. A short measurement once the room is up: the real cost of drawing a frame (GPU included) over a few frames.
//    Too slow steps down a tier and measures again; fast integrated or unknown adapters on medium try high once.

export const PROBE_FRAMES = 16
export const PROBE_SKIP = 4
// Drawing cost per frame, in milliseconds, against display frame rates rather than any one machine:
// - SLOW: a tier that cannot hold 30 frames a second (the floor for motion to read as continuous, and the rate
//   the cottage's ambient motion runs at) steps down.
// - FAST: high costs about 1.5-1.6 times medium, so medium under 10 ms means high should still hold 60 frames a
//   second (16.7 ms); only then is high tried.
// The wide band between them keeps a borderline machine on one tier instead of switching on every visit.
export const SLOW_MS = 1000 / 30
export const FAST_MS = 10
export const SAVED_DAYS = 7

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i
const MOBILE = /mali|adreno|powervr|apple gpu|videocore|tegra|immortalis|xclipse/i
// Intel's dedicated Arc cards carry a model number (Arc A770, B580); "Intel Arc Graphics" alone is built in.
const DISCRETE = /geforce|\brtx|\bgtx|quadro|nvidia|radeon\s*(\(tm\)\s*)?(rx|pro|r9|r7|hd\s*7\d\d\d)|arc(\(tm\))?\s*[ab]\d{3}/i
const INTEGRATED = /intel|iris|uhd graphics|hd graphics|radeon\s*(\(tm\)\s*)?(graphics|vega|\d{3}m)|apple m\d|apple/i

export function adapterKind(name = "") {
  if (!name) return "unknown"
  if (SOFTWARE.test(name)) return "software"
  if (MOBILE.test(name)) return "mobile"
  if (DISCRETE.test(name)) return "discrete"
  if (INTEGRATED.test(name)) return "integrated"
  return "unknown"
}

export function startingQuality(name, { cores = 4, narrow = false } = {}) {
  const kind = adapterKind(name)
  if (kind === "software" || kind === "mobile") return "low"
  if (kind === "integrated") return "medium"
  if (kind === "discrete") return narrow ? "medium" : "high"
  return cores <= 4 || narrow ? "medium" : "high"
}

// The median of the measured frames after the first few (shader compiles and uploads land there).
export function probeCost(samples) {
  const kept = samples.slice(PROBE_SKIP).sort((a, b) => a - b)
  return kept.length ? kept[Math.floor(kept.length / 2)] : 0
}

// The next tier after a measurement, or null to keep the current one. `tried` lists tiers already measured,
// so a tier that was too slow is never tried again and the choice cannot swing back and forth.
export function settle(level, cost, { kind = "unknown", tried = [] } = {}) {
  if (cost > SLOW_MS && level !== "low") return level === "high" ? "medium" : "low"
  if (cost < FAST_MS && level === "medium" && kind !== "software" && kind !== "mobile" && !tried.includes("high")) return "high"
  return null
}

// A saved choice is used again for the same adapter for SAVED_DAYS, then measured afresh.
export function savedQuality(saved, name, now) {
  if (!saved || saved.adapter !== name || !["low", "medium", "high"].includes(saved.quality)) return null
  return Number.isFinite(saved.at) && now - saved.at < SAVED_DAYS * 864e5 && now >= saved.at ? saved.quality : null
}
