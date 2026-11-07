// Uses the host's real renderer and controls with isolated, synthetic data.
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
export const hostRoot = process.env.NEKO_HOST_ROOT || resolve(pluginRoot, "../N.E.K.O")
const requireDependency = createRequire(process.env.NEKO_UI_DEPS
  ? join(resolve(process.env.NEKO_UI_DEPS), "package.json") : import.meta.url)
export const dependency = name => requireDependency(name)
const { transform } = dependency("sucrase")
const hostedRoot = join(hostRoot, "frontend/plugin-manager/src/components/plugin/hosted")
const { bundleHostedTsxSource } = await import(pathToFileURL(join(hostedRoot, "hostedTsxModule.mjs")))

function fixture() {
  const day = new Date().toISOString().slice(0, 10)
  const now = Date.now() / 1000
  const catalog = JSON.parse(readFileSync(join(pluginRoot, "assets/portraits/catalog.json"), "utf8"))
  const items = catalog.items.map(item => ({ ...item, available: true, version: item.id }))
  const base = {
    affection: 67, stage: "ambiguous", stage_index: 3, next_stage: "lover", points_to_next: 13,
    gained_today: 4, lost_today: 1, met_day: 132, first_met: "2026-06-29",
    nicknames: { familiar: "朋友", fond: "小可爱" }, nickname: "小可爱",
    milestones: { familiar: "2026-07-03", fond: "2026-08-19", ambiguous: "2026-10-12" },
    trend: { start: new Date(Date.now() - 364 * 86400000).toISOString().slice(0, 10),
      values: Array.from({ length: 365 }, (_, n) => n < 233 ? null : Math.min(67, Math.round(8 + (n - 233) * .46 + Math.sin(n) * 3))) },
    history: [
      { ts: now - 180, delta: 2, value: 67, source: "auto", reason: "你记得她说过的小事，还认真回应了她的心情。" },
      { ts: now - 4200, delta: -1, value: 65, source: "auto", reason: "说话有些冷淡，她有一点失落。" },
      { ts: now - 86400, delta: 1, value: 66, source: "auto", reason: "一起聊了今天遇到的趣事。" },
    ],
    today_events: [],
    upcoming: [{ kind: "custom", type: "date", count: 0, title: "一起看初雪", date: "2026-11-12", days_until: 5 }],
  }
  return {
    items,
    state: {
      today: day, per_character: true, current_character: "YUI", host_online: true,
      scopes: [
        { ...structuredClone(base), key: "YUI", label: "YUI", is_current: true },
        { ...structuredClone(base), key: "茉子", label: "茉子", affection: 23, stage: "familiar", stage_index: 1,
          next_stage: "fond", points_to_next: 17, is_current: false, nicknames: { familiar: "搭档" } },
      ],
      stages: ["stranger", "familiar", "fond", "ambiguous", "lover"].map((key, n) => ({ key, min: n * 20 })),
      limits: { per_call: 3, daily_gain: 15, daily_loss: 30, nickname_chars: 12, title_chars: 20, anniversaries: 20 },
      anniversaries: [{ id: "snow", title: "一起看初雪", month: 11, day: 12 }],
      settings: { auto_score: true, require_confession: true, proactive_confession: false, decay: false },
      appearance: { accent_color: "#c74768", color_scheme: "system" },
      auto_status: { bus_ok: true, seen: 12, scored: 10, failed: 0, last_ts: now - 180, last_delta: 2, mode: "rules", model_status: "unbound" },
      portraits: { count: items.length, ids: items.map(item => item.id), pool_count: items.length,
        collections: [...new Set(items.map(item => item.collection))], revision: "preview", catalog_error: false,
        settings: { mode: "fixed", selected_id: items[0].id, pool_ids: null } },
    },
  }
}

function document(sourcePath) {
  const source = readFileSync(sourcePath, "utf8")
  const dependencies = readdirSync(join(pluginRoot, "ui"))
    .filter(name => name !== "panel.tsx" && /\.(tsx?|jsx?)$/.test(name))
    .map(name => ({ path: `ui/${name}`, source: readFileSync(join(pluginRoot, "ui", name), "utf8") }))
  const compiled = transform(bundleHostedTsxSource(source, dependencies, "ui/panel.tsx"), {
    transforms: ["typescript", "jsx"], jsxPragma: "h", jsxFragmentPragma: "Fragment", production: true,
  }).code.replace(/\bexport\s+default\s+/, "const __Panel = ")
  const messages = Object.fromEntries(readdirSync(join(pluginRoot, "i18n"))
    .filter(name => name.endsWith(".json")).map(name => [name.slice(0, -5), JSON.parse(readFileSync(join(pluginRoot, "i18n", name), "utf8"))]))
  const data = fixture()
  const escape = value => value.replace(/<\/script/gi, "<\\/script")
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${readFileSync(join(hostedRoot, "ui-kit/styles.css"), "utf8")}</style></head>
<body><main id="root"></main><script>
window.__NEKO_PAYLOAD = {plugin:{id:"love_with_you"}, surface:{id:"main",kind:"panel"},locale:"zh-CN",
  i18n:{default_locale:"en",messages:${escape(JSON.stringify(messages))}}};
${escape(readFileSync(join(hostedRoot, "ui-kit/runtime.js"), "utf8"))}
{
${escape(compiled)}
const fixture = ${escape(JSON.stringify(data))};
const query = new URLSearchParams(location.search);
window.__NEKO_PAYLOAD.locale = query.get("locale") || "zh-CN";
document.documentElement.lang = window.__NEKO_PAYLOAD.locale;
let state = structuredClone(fixture.state);
const savedAppearance = sessionStorage.getItem("lwy:preview-appearance");
if (savedAppearance) state.appearance = JSON.parse(savedAppearance);
if (query.get("empty")) state.scopes = [];
if (query.get("art") === "off") state.portraits.settings.mode = "off";
const uiTest = window.__uiTest = {
  calls: [], failAction: "", failRefresh: false, delay: 0,
  update(next) { Object.assign(state, next); repaint(); },
  snapshot() { return structuredClone(state); },
};
const previewApi = {
  async refresh() {
    if (uiTest.failRefresh) throw new Error("Preview refresh unavailable");
    repaint();
  },
  async call(action, args = {}) {
    uiTest.calls.push({action, args: structuredClone(args)});
    if (uiTest.delay) await new Promise(resolve => setTimeout(resolve, uiTest.delay));
    if (uiTest.failAction === action) throw new Error("Preview save failed");
    const current = state.scopes.find(item => item.key === args.scope);
    if (action === "choose_portrait") return fixture.items.find(item => item.id === state.portraits.settings.selected_id) || {available:false};
    if (action === "get_portrait") {
      const item = fixture.items.find(item => item.id === args.item_id);
      if (!item) return {available:false};
      const response = await fetch("/image/" + item.id + (args.thumbnail ? "/thumb" : "/display"));
      if (!response.ok) throw new Error("Preview image failed");
      return {available:true,version:item.version,data_url: await response.text()};
    }
    if (action === "list_portraits") {
      const items = fixture.items.filter(item => (!args.collection || item.collection === args.collection) &&
        (!args.query || (item.name + item.collection).toLowerCase().includes(args.query.toLowerCase())));
      const pages = Math.max(1, Math.ceil(items.length / 12));
      const page = Math.max(0, Math.min(args.page || 0, pages - 1));
      return {items:items.slice(page*12,page*12+12),page,pages,total:items.length};
    }
    if (action === "set_nicknames" && current) current.nicknames = args.nicknames;
    if (action === "set_affection" && current) current.affection = args.value;
    if (action === "reset_affection" && current) current.affection = 0;
    if (action === "set_first_met" && current) current.first_met = args.date;
    if (action === "set_settings") Object.assign(state.settings, args);
    if (action === "set_appearance") {
      state.appearance = {...args};
      sessionStorage.setItem("lwy:preview-appearance", JSON.stringify(args));
    }
    if (action === "set_per_character") state.per_character = args.enabled;
    if (action === "set_portraits") Object.assign(state.portraits.settings, args);
    if (action === "remove_anniversary") state.anniversaries = state.anniversaries.filter(item => item.id !== args.id);
    if (action === "add_anniversary") state.anniversaries.push({...args,id:String(Date.now())});
    return {ok:true};
  },
};
function repaint() {
  window.NekoUiKit.render(window.NekoUiKit.h(__Panel, {
    ...window.__NEKO_PAYLOAD, state:structuredClone(state), api:previewApi,
    t:window.NekoUiKit.t, useLocalState:(key, initial) => window.NekoUiKit.useLocalState(key,
      key === "lwy:section" && query.get("page") === "settings" ? "settings" : initial),
  }), document.getElementById("root"));
}
repaint();
}
</script></body></html>`
}

export async function startPreview(port = 0, sourcePath = join(pluginRoot, "ui/panel.tsx")) {
  const server = createServer((req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname
      if (path.startsWith("/image/")) {
        const [, , id, variant] = path.split("/")
        const item = fixture().items.find(entry => entry.id === id)
        if (!item || !["thumb", "display"].includes(variant)) { res.writeHead(404).end(); return }
        const image = readFileSync(join(pluginRoot, "assets/portraits", variant === "thumb" ? item.thumbnail : item.file))
        res.writeHead(200, { "Content-Type": "text/plain" }).end(`data:image/webp;base64,${image.toString("base64")}`)
      } else {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(document(sourcePath))
      }
    } catch (error) { res.writeHead(500).end(String(error.stack || error)) }
  })
  await new Promise(resolve => server.listen(port, "127.0.0.1", resolve))
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url } = await startPreview(Number(process.env.PORT || 4318), process.argv[2] || join(pluginRoot, "ui/panel.tsx"))
  console.log(`Plugin UI preview (synthetic data): ${url}`)
}
