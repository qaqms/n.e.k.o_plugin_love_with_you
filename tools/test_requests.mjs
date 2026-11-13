import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { dependency, pluginRoot } from "./ui_preview.mjs"

const ts = dependency("typescript")
const compiled = ts.transpileModule(readFileSync(join(pluginRoot, "ui/requests.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const exports = {}
new Function("exports", compiled)(exports)
const { errorCode, unwrap, submitAction } = exports

test("response envelopes share a bounded decoder and reject missing or inherited payloads", () => {
  const payload = { operation: "save_note" }
  for (const value of [payload, { result: payload }, { data: { value: { result: payload } } }]) {
    assert.equal(unwrap(value, "operation"), payload)
  }
  const cyclic = {}; cyclic.result = cyclic
  for (const value of [null, false, 1, "saved", [], {}, cyclic, Object.create(payload),
    { result: { result: { result: { result: { result: payload } } } } }]) {
    assert.throws(() => unwrap(value, "operation"), /invalid_response/)
  }
})

test("structured errors and legacy whole tokens use the same code classifier", () => {
  assert.equal(errorCode({ code: "shop_stale", message: "Rejected" }), "shop_stale")
  assert.equal(errorCode(new Error("SdkError('experience_stale'): revision changed")), "experience_stale")
  for (const text of ["shop_stale_extra", "prefix_shop_stale", "shop_stale2", "unrecognized error"]) {
    assert.equal(errorCode(new Error(text)), undefined)
  }
})

test("a successful action acknowledges before refresh and a failed refresh never resubmits", async () => {
  const events = []
  const api = {
    async call(action, args, options) {
      events.push("call")
      assert.equal(action, "save"); assert.deepEqual(args, { value: 2 })
      assert.equal(options.userInitiated, true)
      return { result: { value: 2 } }
    },
    async refresh() { events.push("refresh"); throw new Error("offline") },
  }
  const result = await submitAction(api, "save", { value: 2 }, value => {
    assert.equal(unwrap(value, "value").value, 2)
    events.push("decode"); return "saved"
  }, () => events.push("acknowledge"), () => events.push("refreshing"))
  assert.deepEqual(result, { saved: true, message: "saved", stale: true })
  assert.deepEqual(events, ["call", "decode", "acknowledge", "refreshing", "refresh"])
})

test("a valid action and refresh finish with a fresh saved outcome", async () => {
  const result = await submitAction({ async call() { return {} }, async refresh() {} }, "save", {}, "saved")
  assert.deepEqual(result, { saved: true, message: "saved", stale: false })
})

test("unverifiable responses keep the request and never claim a saved or refreshed result", async () => {
  let acknowledged = 0, refreshed = 0
  const result = await submitAction({
    async call() { return null }, async refresh() { refreshed++ },
  }, "experience_action", {}, value => unwrap(value, "operation").operation, () => acknowledged++)
  assert.equal(result.saved, false)
  assert.equal(result.stale, true)
  assert.equal(errorCode(result.error), "invalid_response")
  assert.equal(acknowledged, 0); assert.equal(refreshed, 0)
})

for (const [error, cleared, stale] of [
  [Object.assign(new Error("Rejected"), { code: "shop_stale" }), true, true],
  [new Error("shop_insufficient_coins"), true, false],
  [new Error("experience_save_failed"), true, false],
  [new Error("nickname_conflict"), false, true],
  [new Error("transport: shop_stale_extra"), false, false],
  [new Error("Response lost"), false, false],
]) {
  test(`request acknowledgement and display state after rejection: ${error.message}`, async () => {
    let acknowledged = 0, refreshed = 0
    const result = await submitAction({
      async call() { throw error }, async refresh() { refreshed++ },
    }, "save", {}, "saved", () => acknowledged++)
    assert.equal(result.saved, false); assert.equal(result.error, error)
    assert.equal(result.stale, stale)
    assert.equal(acknowledged, Number(cleared)); assert.equal(refreshed, 0)
  })
}
