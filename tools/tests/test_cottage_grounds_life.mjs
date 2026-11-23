import assert from "node:assert/strict"
import { test } from "node:test"
import * as T from "../../static/engine/three.module.min.js"
import { buildLife } from "../../static/cottage-grounds-life.mjs"

const pen = { x: -13.5, z: -6.5, w: 5.6, d: 3.6 }
const sheep = [
  ...Array.from({ length: 8 }, (_, i) => ({ x: pen.x - 2 + i * .5, z: pen.z, turn: i, grazing: i % 2 === 0, within: pen })),
  { x: -11, z: 9, turn: 0, grazing: true, within: { x: -11.2, z: 10, r: 1.6 } },
]
const cows = [[13, -8.5], [14.2, -5.8], [11.3, -10.3]].map(([x, z]) => ({ x, z, turn: 0, grazing: true, within: { x, z, r: 1.2 } }))

function setup() {
  const scene = new T.Scene()
  const life = buildLife(scene, { sheep, cows, chimneys: [new T.Vector3(0, 3, -20)], ground: -.36, center: new T.Vector2(3.4, .6) })
  const meshes = scene.children.filter(child => child.isInstancedMesh)
  const where = (mesh, i) => new T.Vector3().setFromMatrixPosition(new T.Matrix4().fromArray(mesh.instanceMatrix.array, i * 16))
  return { scene, life, meshes, where }
}

test("the herd wanders over ten minutes without leaving the pen or its patch", () => {
  const { life, meshes, where } = setup()
  const [sheepBody, , cowBody] = meshes
  const start = sheep.map((_, i) => where(sheepBody, i))
  let moved = 0
  for (let step = 0; step < 600 * 30; step++) {
    life.update(1 / 30, new T.Color(0xcfe0ea), 0)
    if (step % 300) continue
    for (let i = 0; i < 8; i++) {
      const p = where(sheepBody, i)
      assert.ok(Math.abs(p.x - pen.x) <= pen.w / 2 + .05 && Math.abs(p.z - pen.z) <= pen.d / 2 + .05, `pen sheep ${i} stays inside`)
    }
    assert.ok(where(sheepBody, 8).distanceTo(new T.Vector3(-11.2, -.36, 10)) < 1.7, "the stray stays near its spot")
    cows.forEach((cow, i) => assert.ok(Math.hypot(where(cowBody, i).x - cow.x, where(cowBody, i).z - cow.z) < 1.25, `cow ${i} stays near`))
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      assert.ok(where(cowBody, i).distanceTo(where(cowBody, j)) > .9, "cows do not walk into each other")
    }
  }
  for (let i = 0; i < sheep.length; i++) if (where(sheepBody, i).distanceTo(start[i]) > .2) moved++
  assert.ok(moved >= 5, `most sheep have moved (${moved})`)
})

test("held still, nothing moves and no birds hang in the sky", () => {
  const { life, meshes, where } = setup()
  const before = meshes.map(mesh => mesh.instanceMatrix.array.slice())
  for (let i = 0; i < 100; i++) life.update(0, new T.Color(0xcfe0ea), 0)
  meshes.slice(0, 4).forEach((mesh, k) => assert.deepEqual(mesh.instanceMatrix.array, before[k]))
  assert.equal(meshes[5].visible, false)
  void where
})

test("after dark the herd stays put and the birds keep away", () => {
  const { life, meshes } = setup()
  for (let i = 0; i < 300; i++) life.update(1 / 30, new T.Color(0x0a1220), 1)
  const settled = meshes[0].instanceMatrix.array.slice()
  for (let i = 0; i < 1800; i++) life.update(1 / 30, new T.Color(0x0a1220), 1)
  const drift = settled.reduce((most, value, i) => i % 16 === 12 || i % 16 === 14 ? Math.max(most, Math.abs(value - meshes[0].instanceMatrix.array[i])) : most, 0)
  assert.ok(drift < .3, `walks already under way finish, then nobody sets off (${drift.toFixed(2)})`)
  assert.equal(meshes[5].visible, false)
})
