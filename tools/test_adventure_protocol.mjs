import assert from "node:assert/strict"
import test from "node:test"
import { AdventureApi, decode, errorText } from "../static/bridge.mjs"

const runId = "adventure_run_0001"
const shop = [
  { id: "vitality", name: "生命储备", scope: "玩家", percent: 4, cap: 5, prices: [40, 80, 120, 180, 260] },
  { id: "power", name: "武艺研习", scope: "双方攻击", percent: 2, cap: 5, prices: [40, 80, 120, 180, 260] },
  { id: "stride", name: "远行步伐", scope: "玩家移动", percent: 2, cap: 3, prices: [40, 80, 120] },
  { id: "reach", name: "魔力牵引", scope: "共同拾取", percent: 6, cap: 5, prices: [40, 80, 120, 180, 260] },
]
const levels = { vitality: 0, power: 0, stride: 0, reach: 0 }
function apiWith(respond) {
  const api = new AdventureApi()
  api.view = {
    revision: 3, epoch: "epoch_000000001", run: null, rules: 1, characters: ["YUI"], owns_control: false,
    economy: { balance: 120, earned: 120, levels: { ...levels } }, shop: structuredClone(shop),
  }
  api.call = respond
  return api
}
const ack = args => ({
  operation: args.operation, request_id: args.request_id, run_id: runId,
  revision: args.revision + 1, elapsed: args.values?.snapshot?.elapsed || 0,
})

test("adventure decoder is bounded and rejects missing or inherited payloads", () => {
  assert.deepEqual(decode({ result: { data: { adventure: { revision: 1 } } } }), { revision: 1 })
  assert.throws(() => decode(Object.create({ adventure: {} })))
  const cycle = {}; cycle.result = cycle
  assert.throws(() => decode(cycle))
  assert.throws(() => decode({ result: [] }))
})

test("unverified save keeps its exact request and cloned values for replay", async () => {
  const calls = []
  const api = apiWith(async args => { calls.push(structuredClone(args)); throw new Error("lost") })
  const values = { run_id: runId, snapshot: { elapsed: 100 } }
  await assert.rejects(api.mutate("checkpoint", values), /lost/)
  values.snapshot.elapsed = 999
  const requestId = api.pending.request_id
  api.call = async args => { calls.push(structuredClone(args)); return ack(args) }
  await api.retry()
  assert.equal(calls[0].request_id, requestId)
  assert.deepEqual(calls[0], calls[1])
  assert.equal(api.view.revision, 4)
  assert.equal(api.pending, null)
})

test("wrong operation, identity, revision or elapsed never acknowledges a save", async () => {
  for (const change of [
    { operation: "finish" }, { request_id: "wrong_request_01" }, { run_id: "wrong_run_00001" },
    { revision: 8 }, { elapsed: 102 },
  ]) {
    const api = apiWith(async args => ({ ...ack(args), ...change }))
    await assert.rejects(api.mutate("checkpoint", { run_id: runId, snapshot: { elapsed: 100 } }))
    assert.ok(api.pending)
    assert.equal(api.view.revision, 3)
  }
})

test("another mutation cannot replace an unresolved request", async () => {
  const api = apiWith(async () => null)
  await assert.rejects(api.mutate("checkpoint", { run_id: runId, snapshot: { elapsed: 100 } }))
  const pending = api.pending
  await assert.rejects(api.mutate("finish", { run_id: runId, snapshot: { elapsed: 200 } }))
  assert.equal(api.pending, pending)
})

test("localized errors require whole code tokens", () => {
  assert.match(errorText({ code: "adventure_stale" }), /另一个窗口/)
  assert.equal(errorText(new Error("adventure_stale_extra")), "adventure_stale_extra")
  assert.equal(errorText(new Error("prefix_adventure_stale")), "prefix_adventure_stale")
  assert.match(errorText({ code: "PLUGIN_UI_ACTION_FAILED", message: "adventure_stale" }), /另一个窗口/)
})

const purchaseAck = args => ({
  ...ack(args), run_id: null,
  transaction: { upgrade: "power", before: 0, after: 1, amount: 40 },
  economy: { balance: 80, earned: 120, levels: { ...levels, power: 1 } },
})

test("a purchase confirms exact cost, balance, lifetime income and changed rank", async () => {
  const api = apiWith(async args => purchaseAck(args))
  await api.mutate("buy", { upgrade: "power", level: 0 })
  assert.equal(api.pending, null)
  assert.equal(api.view.economy.balance, 80)
  assert.equal(api.view.economy.levels.power, 1)
})

test("an incorrect or incomplete financial acknowledgment keeps its original request", async () => {
  for (const change of [
    result => { delete result.economy },
    result => { result.economy.balance = 81 },
    result => { result.economy.earned = 160; result.economy.balance = 120 },
    result => { result.transaction.amount = 0 },
    result => { result.transaction.before = 1 },
    result => { result.economy.levels.power = true },
    result => { result.economy.levels.vitality = 1; result.economy.balance = 40 },
    result => { result.run_id = runId },
  ]) {
    const api = apiWith(async args => { const result = purchaseAck(args); change(result); return result })
    await assert.rejects(api.mutate("buy", { upgrade: "power", level: 0 }))
    assert.equal(api.pending.operation, "buy")
    assert.equal(api.view.revision, 3)
    assert.equal(api.view.economy.balance, 120)
  }
})

test("purchase replay validates against the original wallet even if a read already shows the purchase", async () => {
  const calls = []
  const api = apiWith(async args => { calls.push(structuredClone(args)); throw new Error("lost") })
  await assert.rejects(api.mutate("buy", { upgrade: "power", level: 0 }))
  const fresh = { ...structuredClone(api.view), revision: 4, economy: purchaseAck({ revision: 3 }).economy }
  api.call = async args => args.operation === "read" ? fresh : (calls.push(structuredClone(args)), purchaseAck(args))
  await api.read()
  await api.retry()
  assert.deepEqual(calls[0], calls[1])
  assert.equal(api.view.economy.balance, 80)
})

test("terminal rewards must match the submitted minutes and outcome before acknowledging income", async () => {
  for (const invalid of [false, true]) {
    const api = apiWith(async args => ({
      ...ack(args),
      settlement: { formula: 1, minutes: 5, survival: 30, clear: invalid ? 80 : 0, total: invalid ? 110 : 30 },
      economy: { balance: invalid ? 230 : 150, earned: invalid ? 230 : 150, levels: { ...levels } },
    }))
    const task = api.mutate("finish", { run_id: runId, snapshot: { elapsed: 300000, outcome: "retreated" } })
    if (invalid) {
      await assert.rejects(task)
      assert.ok(api.pending)
    } else {
      await task
      assert.equal(api.view.economy.balance, 150)
    }
  }
})

test("reads reject malformed wallets, catalogs and loadouts instead of replacing assets with defaults", async () => {
  for (const change of [
    view => { delete view.economy },
    view => { view.economy.balance++ },
    view => { view.shop[1].id = "vitality" },
    view => { view.economy.levels.stride = 4 },
    view => { view.run = { status: "active", loadout: { levels, bonuses: { ...levels, power: 1 } }, settlement: null } },
  ]) {
    const api = apiWith(null), original = api.view
    const changed = structuredClone(original); change(changed)
    api.call = async () => changed
    await assert.rejects(api.read())
    assert.equal(api.view, original)
  }
})
