import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { dependency, hostRoot, pluginRoot } from "./ui_preview.mjs"

const ts = dependency("typescript")
const files = readdirSync(join(pluginRoot, "ui")).filter(name => /\.tsx?$/.test(name)).map(name => join(pluginRoot, "ui", name))
const program = ts.createProgram([...files, join(hostRoot, "plugin/sdk/hosted-ui/globals.d.ts")], {
  jsx: ts.JsxEmit.React, jsxFactory: "h", jsxFragmentFactory: "Fragment",
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020,
  moduleResolution: ts.ModuleResolutionKind.Bundler, baseUrl: pluginRoot,
  paths: { "@neko/plugin-ui": [join(hostRoot, "plugin/sdk/hosted-ui")] },
  noEmit: true, strict: false, skipLibCheck: true, types: [],
})
const diagnostics = ts.getPreEmitDiagnostics(program)
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: path => path, getCurrentDirectory: () => pluginRoot, getNewLine: () => "\n",
  }))
  process.exitCode = 1
} else console.log(`Hosted UI types passed (${files.length} files).`)

const localeFiles = readdirSync(join(pluginRoot, "i18n")).filter(name => name.endsWith(".json"))
const en = JSON.parse(readFileSync(join(pluginRoot, "i18n/en.json"), "utf8"))
const requiredKeys = ["common.affection", "common.saving", "common.unsaved", "common.discard",
  "nav.daily", "nav.records", "overview.together", "overview.participant", "overview.allExperiences",
  "overview.continue", "overview.viewFollowup", "overview.viewMemory",
  ...Object.keys(en).filter(key => key.startsWith("xp.") || key.startsWith("error.experience_")),
  ...Object.keys(en).filter(key => key.startsWith("nick.mode.") || key.startsWith("nick.source.") || key.includes("Addressing")),
  ...["note", "reset", "customFor", "customPlaceholder", "effective", "optional", "personaValue", "preferred",
    "endearments", "avoided", "avoidInput", "addAvoid", "removeAvoid", "confirmedLover", "currentCloseness",
    "resetAll", "defaultsRestored"].map(key => `nick.${key}`),
  "error.invalid_addressing", "error.nickname_required", "error.nickname_blocked",
  ...Object.keys(en).filter(key => key.startsWith("art.")),
  "error.portrait_invalid_image", "error.portrait_source_too_large", "error.portrait_library_full", "error.portrait_custom_only",
  "error.nickname_conflict", "error.invalid_first_met_source", "dates.dateChoice", "dates.pluginDate",
  ...Object.keys(en).filter(key => key.startsWith("restart.") || key.startsWith("reset.") ||
    ["settings.reset", "toast.reset", "source.restart", "source.reset", "error.relationship_changed"].includes(key)),
  "dates.savedHostDate", "dates.customDate", "dates.noSavedHostDate", "dates.legacyDate", "dates.legacyDateNote",
  ...Object.keys(en).filter(key => key.startsWith("dates.history") || ["dates.importMet", "dates.importDescription",
    "dates.confirmImport", "dates.currentMet", "error.first_met_conflict"].includes(key) || key.startsWith("error.host_history_")),
  ...Object.keys(en).filter(key => key.startsWith("shop.") || key.startsWith("error.shop_") || key === "nav.shop" || key === "source.gift"),
  "common.refresh", "dates.removeNamed", "trend.summary", "alert.refreshFailed",
  "common.dismiss", "common.noChanges", "theme.previewing", "adjust.change", "settings.sections",
  "overview.recent", "overview.allHistory", "rules.autoBrief", "rules.details", "rules.proactiveRequires", "rules.proactiveBrief",
  ...Object.keys(en).filter(key => key.startsWith("feedback.")),
  ...Object.keys(en).filter(key => key.startsWith("theme.") || key.startsWith("error.appearance_") ||
    key === "actions.setAppearance.label" || key === "entries.setAppearance.description")]
let partialLocales = 0
for (const file of localeFiles) {
  const messages = JSON.parse(readFileSync(join(pluginRoot, "i18n", file), "utf8"))
  for (const key of requiredKeys) {
    if (typeof messages[key] !== "string") throw new Error(`${file}: missing new UI key ${key}`)
  }
  if (Object.keys(en).some(key => !(key in messages))) partialLocales += 1
  for (const key of Object.keys(en)) {
    // Existing partial translations intentionally use the host's locale fallback.
    if (!(key in messages)) continue
    if (typeof messages[key] !== "string") throw new Error(`${file}: invalid ${key}`)
    const tokens = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()
    if (JSON.stringify(tokens(en[key])) !== JSON.stringify(tokens(messages[key]))) throw new Error(`${file}: mismatched parameters in ${key}`)
  }
}
console.log(`New UI keys and existing interpolation parameters passed (${localeFiles.length} languages; ${partialLocales} existing partial translations).`)
