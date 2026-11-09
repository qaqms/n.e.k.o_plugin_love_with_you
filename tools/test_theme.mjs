import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { dependency, pluginRoot } from "./ui_preview.mjs"

const ts = dependency("typescript")
const compiled = ts.transpileModule(readFileSync(join(pluginRoot, "ui/theme.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const exports = {}
new Function("exports", compiled)(exports)
const { THEME_PRESETS, DEFAULT_APPEARANCE, contrast, normalizeAppearance, themeTokens, themeCss } = exports

test("presets have unique colors and default to sky blue", () => {
  assert.equal(THEME_PRESETS.length, 6)
  assert.equal(new Set(THEME_PRESETS.map(item => item.color)).size, 6)
  assert.equal(THEME_PRESETS.find(item => item.key === "sky").color, DEFAULT_APPEARANCE.accent_color)
  assert.equal(THEME_PRESETS.find(item => item.key === "sky").color, "#7db9e8")
})

test("preset and custom colors keep text and buttons readable in either mode", () => {
  const colors = [...THEME_PRESETS.map(item => item.color), "#ffffff", "#000000"]
  for (const r of [0, 51, 102, 153, 204, 255]) {
    for (const g of [0, 51, 102, 153, 204, 255]) {
      for (const b of [0, 51, 102, 153, 204, 255]) {
        colors.push("#" + [r, g, b].map(channel => channel.toString(16).padStart(2, "0")).join(""))
      }
    }
  }
  for (const accent_color of colors) for (const dark of [false, true]) {
    const tokens = themeTokens({ accent_color, color_scheme: "system" }, dark)
    for (const bg of ["--bg", "--surface", "--surface-strong"]) {
      assert.ok(contrast(tokens["--accent-strong"], tokens[bg]) >= 4.5, `${accent_color}, ${dark}, ${bg}`)
      for (const text of ["--text", "--muted", "--danger", "--warning"]) {
        assert.ok(contrast(tokens[text], tokens[bg]) >= 4.5, `${text}, ${dark}, ${bg}`)
      }
    }
    for (const button of ["--accent", "--accent-hover"]) {
      assert.ok(contrast(tokens[button], tokens["--on-accent"]) >= 4.5, `${accent_color} button ${button}`)
    }
    assert.ok(contrast(tokens["--accent"], tokens["--bg"]) >= 3)
  }
})

test("invalid persisted colors cannot inject arbitrary theme CSS", () => {
  const dirty = { accent_color: "#123456;--bg:red", color_scheme: "evil" }
  assert.deepEqual(normalizeAppearance(dirty), DEFAULT_APPEARANCE)
  assert.deepEqual(normalizeAppearance({ accent_color: "#abcdef\n" }), DEFAULT_APPEARANCE)
  assert.equal(themeCss(dirty), themeCss(DEFAULT_APPEARANCE))
  assert.equal(normalizeAppearance({ accent_color: "#ABCDEF", color_scheme: "dark" }).accent_color, "#abcdef")
})

test("explicit modes override system preference while system mode emits a media rule", () => {
  assert.ok(themeCss(DEFAULT_APPEARANCE).includes("@media(prefers-color-scheme:dark)"))
  assert.ok(!themeCss({ ...DEFAULT_APPEARANCE, color_scheme: "light" }).includes("@media"))
  assert.ok(themeCss({ ...DEFAULT_APPEARANCE, color_scheme: "dark" }).includes("color-scheme:dark"))
})
