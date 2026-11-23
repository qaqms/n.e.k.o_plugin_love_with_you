import assert from "node:assert/strict"
import { test } from "node:test"
import { FAST_MS, PROBE_FRAMES, PROBE_SKIP, SAVED_DAYS, SLOW_MS, adapterKind, probeCost, savedQuality, settle, startingQuality }
  from "../../static/cottage-quality.mjs"

test("adapter names sort into software, phone, integrated and dedicated graphics", () => {
  for (const [name, kind] of [
    ["ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)", "software"],
    ["llvmpipe (LLVM 15.0.7, 256 bits)", "software"],
    ["ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)", "software"],
    ["Mali-G78", "mobile"], ["Adreno (TM) 740", "mobile"], ["Apple GPU", "mobile"],
    ["ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)", "integrated"],
    ["ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)", "integrated"],
    ["ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)", "integrated"],
    ["ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)", "integrated"],
    ["ANGLE (AMD, AMD Radeon 780M Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)", "integrated"],
    ["ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)", "integrated"],
    ["ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)", "discrete"],
    ["ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)", "discrete"],
    ["ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)", "discrete"],
    ["", "unknown"], ["WebKit WebGL", "unknown"],
  ]) assert.equal(adapterKind(name), kind, name)
})

test("the starting tier follows the adapter, with the processor count for unknown ones", () => {
  assert.equal(startingQuality("SwiftShader"), "low")
  assert.equal(startingQuality("Adreno (TM) 740"), "low")
  assert.equal(startingQuality("AMD Radeon(TM) Graphics"), "medium")
  assert.equal(startingQuality("NVIDIA GeForce RTX 3060"), "high")
  assert.equal(startingQuality("NVIDIA GeForce RTX 3060", { narrow: true }), "medium")
  assert.equal(startingQuality("", { cores: 4 }), "medium")
  assert.equal(startingQuality("", { cores: 12 }), "high")
})

test("the measured cost is the median after the warm-up frames", () => {
  const warmup = Array(PROBE_SKIP).fill(500)
  const samples = [...warmup, ...Array.from({ length: PROBE_FRAMES - PROBE_SKIP }, (_, i) => 10 + i)]
  assert.equal(probeCost(samples), 10 + Math.floor((PROBE_FRAMES - PROBE_SKIP) / 2))
  assert.equal(probeCost([...warmup, 7, 90, 8]), 8, "one stall does not move the median")
  assert.equal(probeCost([1, 2]), 0)
})

test("a measurement steps down when slow, tries high once when fast, and never swings back", () => {
  assert.equal(settle("high", SLOW_MS + 1), "medium")
  assert.equal(settle("medium", SLOW_MS + 1), "low")
  assert.equal(settle("low", SLOW_MS * 3), null)
  assert.equal(settle("high", SLOW_MS - 1), null)
  assert.equal(settle("medium", FAST_MS - 1, { kind: "integrated", tried: ["medium"] }), "high")
  assert.equal(settle("medium", FAST_MS - 1, { kind: "integrated", tried: ["high", "medium"] }), null)
  assert.equal(settle("medium", FAST_MS - 1, { kind: "mobile" }), null)
  assert.equal(settle("medium", (FAST_MS + SLOW_MS) / 2, { kind: "integrated" }), null)
})

test("a remembered choice holds for the same adapter for a week", () => {
  const now = Date.UTC(2026, 10, 23)
  const saved = { adapter: "AMD Radeon(TM) Graphics", quality: "medium", at: now - 864e5 }
  assert.equal(savedQuality(saved, saved.adapter, now), "medium")
  assert.equal(savedQuality(saved, "NVIDIA GeForce RTX 3060", now), null, "another adapter measures again")
  assert.equal(savedQuality({ ...saved, at: now - SAVED_DAYS * 864e5 }, saved.adapter, now), null, "expired")
  assert.equal(savedQuality({ ...saved, at: now + 864e5 }, saved.adapter, now), null, "a clock set back")
  assert.equal(savedQuality({ ...saved, quality: "auto" }, saved.adapter, now), null)
  assert.equal(savedQuality(null, saved.adapter, now), null)
})
