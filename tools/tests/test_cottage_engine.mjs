import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")

test("the cottage's denoise patch still matches the vendored GTAO shader", () => {
  const cottage = read("static/cottage.mjs")
  const line = cottage.match(/^const PD_ROTATION = "(.*)"$/m)?.[1]
  assert.ok(line, "cottage.mjs declares PD_ROTATION")
  const engine = read("static/engine/three-post.mjs")
  assert.equal(engine.split(line).length - 1, 1, "three-post.mjs has the line exactly once")
  assert.match(cottage, /fragmentShader\.replace\(PD_ROTATION,/)
})
