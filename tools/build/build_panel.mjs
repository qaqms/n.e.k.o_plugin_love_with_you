// Compile the existing TSX panel with the host renderer into a same-origin static surface.
import { createRequire } from "node:module"
import { copyFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const host = process.env.NEKO_HOST_ROOT || resolve(root, "../N.E.K.O")
const require = createRequire(import.meta.url)
const { transform } = require("sucrase")
const hosted = join(host, "frontend/plugin-manager/src/components/plugin/hosted")
const modules = await import(pathToFileURL(join(hosted, "hostedTsxModule.mjs")))
const display = readFileSync(join(host, "static/plugin-ui-sdk/display.js"), "utf8")
const runtime = `const createPluginDisplayClient = (function() {
const module = { exports: {}, nekoPluginDisplayFactoryOnly: true };
${display}
return module.exports;
})();\n${readFileSync(join(hosted, "ui-kit/runtime.js"), "utf8")}`
const renderer = transform(readFileSync(join(hosted, "tsxRuntime.ts"), "utf8"), {
  transforms: ["typescript", "imports"],
}).code
const exports = {}
new Function("require", "exports", "window", renderer)(name => {
  if (name === "sucrase") return { transform }
  if (name === "./hostedTsxModule.mjs") return modules
  if (name === "./uiKitBundle") return { buildUiKitBundle: () => ({
    styles: readFileSync(join(hosted, "ui-kit/styles.css"), "utf8"), runtime,
  }) }
  throw new Error(`Unexpected host renderer import: ${name}`)
}, exports, { location: { origin: "" } })

const messages = Object.fromEntries(readdirSync(join(root, "i18n")).filter(name => name.endsWith(".json"))
  .map(name => [name.slice(0, -5), JSON.parse(readFileSync(join(root, "i18n", name), "utf8"))]))
const dependencies = readdirSync(join(root, "ui")).filter(name => name !== "panel.tsx" && /\.tsx?$/.test(name))
  .map(name => ({ path: `ui/${name}`, source: readFileSync(join(root, "ui", name), "utf8") }))
const html = exports.buildHostedTsxDocument({
  source: readFileSync(join(root, "ui/panel.tsx"), "utf8"), dependencies, pluginId: "love_with_you",
  surface: { id: "main", kind: "panel", mode: "static", entry: "ui/panel.tsx" },
  locale: "zh-CN", context: { i18n: { default_locale: "zh-CN", messages }, state: {} },
})
const startup = `<script>
window.__NEKO_PAYLOAD.locale = new URLSearchParams(location.search).get("locale") || "zh-CN";
window.__NekoRenderHostedSurface();
var panelLoaded = false, panelLoading = false;
function loadPanel() {
  if (panelLoading) return;
  panelLoading = true;
  window.NekoUiKit.api.refresh().then(function() {
    panelLoaded = true;
  }).catch(function(error) {
    if (panelLoaded) return;
    var root = document.getElementById("root");
    root.replaceChildren();
    var alert = document.createElement("p");
    alert.setAttribute("role", "alert");
    alert.textContent = "暂时无法读取插件面板：" + String(error.message || error);
    var retry = document.createElement("button");
    retry.textContent = "重新读取";
    retry.onclick = loadPanel;
    root.append(alert, retry);
  }).finally(function() {
    panelLoading = false;
  });
}
loadPanel();
window.addEventListener("focus", function() {
  if (panelLoaded && !document.querySelector(".lwy-workspace.is-game")) loadPanel();
});
setInterval(function() {
  if (!document.hidden && !document.querySelector(".lwy-workspace.is-game")
    && !document.querySelector(".neko-modal, [aria-busy='true']")
    && !document.activeElement?.matches("input, textarea, select")) loadPanel();
}, 5000);
</script>`
writeFileSync(join(root, "static/panel.html"), html.replace("</body>", `${startup}\n</body>`))
copyFileSync(join(host, "LICENSE"), join(root, "static/engine/NEKO-LICENSE.txt"))
copyFileSync(join(host, "NOTICE"), join(root, "static/engine/NEKO-NOTICE.txt"))
console.log("Built static/panel.html using the host TSX renderer and UI kit.")
