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
  const monday = new Date(`${day}T12:00:00Z`)
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7)
  const week = monday.toISOString().slice(0, 10)
  const now = Date.now() / 1000
  const catalog = JSON.parse(readFileSync(join(pluginRoot, "assets/portraits/catalog.json"), "utf8"))
  const items = catalog.items.map(item => ({ ...item, available: true, version: item.id }))
  const base = {
    affection: 67, stage: "ambiguous", stage_index: 3, next_stage: "lover", points_to_next: 13,
    gained_today: 4, gained_chat: 4, gained_gift: 0, gift_room: 4, gain_revision: 0,
    lost_today: 1, met_day: 132, first_met: "2026-06-29",
    plugin_first_met: "2026-06-29", plugin_first_met_legacy: false, host_first_met: null,
    custom_first_met: "2026-06-29", first_met_source: "custom",
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
      experiences: { enabled:false, revision:0, characters:{} },
      scopes: [
        { ...structuredClone(base), key: "YUI", label: "YUI", is_current: true },
        { ...structuredClone(base), key: "茉子", label: "茉子", affection: 23, stage: "familiar", stage_index: 1,
          next_stage: "fond", points_to_next: 17, is_current: false, nicknames: { familiar: "搭档" } },
      ],
      stages: ["stranger", "familiar", "fond", "ambiguous", "lover"].map((key, n) => ({ key, min: n * 20 })),
      limits: { per_call: 3, daily_gain: 8, daily_chat: 4, daily_loss: 4, nickname_chars: 12, title_chars: 20, anniversaries: 20 },
      anniversaries: [{ id: "snow", title: "一起看初雪", month: 11, day: 12 }],
      settings: { auto_score: true, require_confession: true, proactive_confession: false, decay: false },
      appearance: { accent_color: "#7db9e8", color_scheme: "system" },
      known_characters: ["YUI", "茉子"],
      shop: {
        coins: 100, revision: 0, daily_coins: 30, can_claim: true, gift_remaining: 4, gift_daily_cap: 4, inventory_limit: 99,
        income_total: 0, can_gesture: true, bus_ok: true, income_error: "",
        income: {count:3, earned:0, paid:0, steps:[1,3,8].map(turns => ({
          turns,coins:10,reward:`daily_${turns}`,period:day,claimed:false,ready:turns<=3,
        })), weekly:{reward:"weekly",period:week,coins:40,claimed:false,ready:false},pending:[],
          weekly_days:2, weekly_goal:4, weekly_coins:40, weekly_paid:false, legacy_claimed:false, clock_error:false},
        ledger: [],
        catalog: [
          { id: "tea", price: 20, gain: 1, icon: "Coffee", quantity: 0 },
          { id: "cake", price: 40, gain: 2, icon: "CakeSlice", quantity: 0 },
          { id: "chocolate", price: 40, gain: 2, icon: "Candy", quantity: 0 },
          { id: "flowers", price: 60, gain: 3, icon: "Flower2", quantity: 0 },
          { id: "book", price: 60, gain: 3, icon: "BookOpen", quantity: 0 },
          { id: "plush", price: 80, gain: 4, icon: "Gift", quantity: 0 },
        ], history: [],
      },
      auto_status: { bus_ok: true, seen: 12, scored: 10, failed: 0, last_ts: now - 180, last_delta: 2, mode: "rules", model_status: "unbound" },
      portraits: { count: items.length, ids: items.map(item => item.id), pool_count: items.length,
        collections: [...new Set(items.map(item => item.collection))], revision: "preview", catalog_error: false,
        settings: { mode: "fixed", selected_id: items[0].id, pool_ids: null } },
    },
  }
}

function document(sourcePath, search = "") {
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
const query = new URLSearchParams(${escape(JSON.stringify(search))});
window.__NEKO_PAYLOAD.locale = query.get("locale") || "zh-CN";
document.documentElement.lang = window.__NEKO_PAYLOAD.locale;
let state = structuredClone(fixture.state);
let savedAppearance = null;
try { savedAppearance = sessionStorage.getItem("lwy:preview-appearance"); } catch {}
if (savedAppearance) state.appearance = JSON.parse(savedAppearance);
if (query.get("empty")) state.scopes = [];
if (query.get("art") === "off") state.portraits.settings.mode = "off";
if (query.get("moments") === "1") state.experiences = {
  enabled:true,revision:1,characters:{[state.current_character]:{
    revision:1,
    note:{id:"preview-draft",title:"留给今天的一句话",text:"今天忙完以后，想和你坐一会儿。",
      created_at:Date.now()/1000,invitation:"submitted"},
    memories:[{id:"preview-memory",title:"下雨的傍晚",text:"我们一起给那个下雨的傍晚起了个名字：慢一点也没关系。",
      created_at:Date.now()/1000-3600,recall:true}],
    followups:[{id:"preview-followup",summary:"忙完这周，聊聊那件期待的事",due:state.today,status:"pending",
      outcome:"",pending_outcome:"",prompt_submitted:false}],
  }},
};
const uiTest = window.__uiTest = {
  calls: [], failAction: "", failMessage: "Preview save failed", failRefresh: false, delay: 0, refreshDelay: 0,
  failAfterAction: "", reaction: "submitted", failCode: "",
  responseOverrideAction: "", responseOverride: null,
  historyDate: "2026-03-04",
  update(next) { Object.assign(state, next); repaint(); },
  snapshot() { return structuredClone(state); },
};
const shopReceipts = new Map();
const experienceReceipts = new Map();
const addressStages = ["stranger", "familiar", "fond", "ambiguous", "lover"];
function addressPrefs(current) {
  return current.addressing || {version:1, stages:Object.fromEntries(addressStages.map(key => [
    key,{mode:current.nicknames?.[key] ? "custom" : "inherit",text:current.nicknames?.[key] || ""},
  ])),endearments:false,preferred_name:"",avoided:[]};
}
function refreshPortraits() {
  state.portraits.ids = fixture.items.map(item => item.id);
  state.portraits.count = fixture.items.length;
  state.portraits.collections = [...new Set(fixture.items.map(item => item.collection))].sort();
  state.portraits.revision += "x";
}
const previewApi = {
  async refresh() {
    if (uiTest.refreshDelay) await new Promise(resolve => setTimeout(resolve, uiTest.refreshDelay));
    if (uiTest.failRefresh) throw new Error("Preview refresh unavailable");
    repaint();
  },
  async call(action, args = {}) {
    const result = await this.execute(action, args);
    return uiTest.responseOverrideAction === action ? structuredClone(uiTest.responseOverride) : result;
  },
  async execute(action, args = {}) {
    uiTest.calls.push({action, args: structuredClone(args)});
    if (uiTest.delay) await new Promise(resolve => setTimeout(resolve, uiTest.delay));
    if (uiTest.failAction === action) throw Object.assign(new Error(uiTest.failMessage), {code:uiTest.failCode});
    if (action === "experience_action") {
      if (experienceReceipts.has(args.request_id)) return structuredClone(experienceReceipts.get(args.request_id));
      const experience = state.experiences;
      const values = args.values;
      let result = {operation:args.operation,id:values.id || args.request_id};
      if (args.operation === "configure") {
        if (args.revision !== experience.revision) throw new Error("experience_stale");
        experience.enabled = values.enabled;
        experience.revision += 1;
        result.revision = experience.revision;
      } else {
        const record = experience.characters[args.character] || {revision:0,epoch:0,note:null,memories:[],followups:[]};
        if (record.revision !== args.revision) throw new Error("experience_stale");
        experience.characters[args.character] = record;
        const item = record.followups.find(item => item.id === values.id);
        const memory = record.memories.find(item => item.id === values.id);
        if (args.operation === "start_note") record.note = {
          id:result.id,title:values.title,text:values.text,status:"draft",invitation:"not_requested",created_at:Date.now()/1000,
        };
        if (args.operation === "invite") { record.note.invitation = "submitted"; result.invitation = "submitted"; }
        if (args.operation === "draft_note") Object.assign(record.note, {
          title: values.title ?? record.note.title, text: values.text,
        });
        if (args.operation === "save_note") {
          record.memories.unshift({...record.note,title:values.title,text:values.text,status:"saved",recall:true});
          record.note = null;
        }
        if (args.operation === "cancel_note") record.note = null;
        if (args.operation === "edit_memory") Object.assign(memory,{title:values.title,text:values.text});
        if (args.operation === "toggle_memory") memory.recall = values.recall;
        if (args.operation === "delete_memory") record.memories = record.memories.filter(item => item.id !== values.id);
        if (args.operation === "propose_followup") record.followups.unshift({
          id:result.id,summary:values.summary,due:values.due,status:"pending",outcome:"",pending_outcome:"",prompt_submitted:false,
        });
        if (["confirm_followup","edit_followup"].includes(args.operation)) Object.assign(item,{
          summary:values.summary,due:values.due,status:"active",prompt_submitted:false,
        });
        if (args.operation === "save_outcome") Object.assign(item,{outcome:values.outcome,pending_outcome:"",status:"closed"});
        if (args.operation === "close_followup") Object.assign(item,{status:"closed",pending_outcome:""});
        if (args.operation === "delete_followup") record.followups = record.followups.filter(item => item.id !== values.id);
        record.revision += 1;
        result.revision = record.revision;
      }
      experienceReceipts.set(args.request_id,structuredClone(result));
      if (uiTest.failAfterAction === action) throw new Error("Preview response lost");
      return result;
    }
    const current = state.scopes.find(item => item.key === args.scope);
    if (action === "preview_first_met" && current) return {
      scope:args.scope, date:uiTest.historyDate, previous_date:current.first_met,
      character:current.label || state.current_character, source:"host_recent_history", scanned_roles:state.per_character ? 1 : 2,
    };
    if (action === "choose_portrait") return fixture.items.find(item => item.id === state.portraits.settings.selected_id) || {available:false};
    if (action === "get_portrait") {
      const item = fixture.items.find(item => item.id === args.item_id);
      if (!item) return {available:false};
      if (item.custom) return {available:true,version:item.version,data_url:args.thumbnail ? item.thumbnail_url : item.data_url};
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
    if (action === "import_portrait") {
      const existing = fixture.items.find(item => item.data_url === args.data_url);
      if (existing) return {item:existing,duplicate:true};
      const item = {...args,id:"user-preview-"+fixture.items.length,version:"import-"+fixture.items.length,custom:true,available:true};
      fixture.items.push(item);
      refreshPortraits();
      if (uiTest.failAfterAction === action) throw new Error("Preview response lost");
      return {item,duplicate:false};
    }
    if (action === "edit_portrait") {
      const item = fixture.items.find(item => item.id === args.item_id && item.custom);
      if (!item) throw new Error("portrait_custom_only");
      Object.assign(item,{name:args.name,collection:args.collection});
      refreshPortraits();
      return {item};
    }
    if (action === "delete_portrait") {
      fixture.items = fixture.items.filter(item => item.id !== args.item_id || !item.custom);
      if (state.portraits.settings.selected_id === args.item_id) state.portraits.settings.selected_id = fixture.items[0]?.id || "";
      if (state.portraits.settings.pool_ids) state.portraits.settings.pool_ids = state.portraits.settings.pool_ids.filter(id => id !== args.item_id);
      refreshPortraits();
      return state.portraits;
    }
    if (action === "set_addressing" && current) {
      const prefs = structuredClone(addressPrefs(current));
      const clean = value => Array.from(value.replace(/[\\x00-\\x1f\\x7f]/g, " ").replace(/\\s+/g, " ").trim()).slice(0,12).join("");
      const changes = structuredClone(args.changes), expected = args.expected;
      if (changes.stages) for (const item of Object.values(changes.stages)) item.text = item.mode === "custom" ? clean(item.text) : "";
      if ("preferred_name" in changes) changes.preferred_name = clean(changes.preferred_name);
      const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
      for (const [key,value] of Object.entries(changes)) {
        const pairs = key === "stages" ? Object.entries(value).map(([stage,item]) => [prefs.stages[stage],expected.stages[stage],item])
          : [[prefs[key],expected[key],value]];
        if (pairs.some(([actual,old,next]) => !equal(actual,old) && !equal(actual,next))) throw new Error("nickname_conflict");
        if (key === "stages") Object.assign(prefs.stages,value);
        else prefs[key] = value;
      }
      const denied = new Set(prefs.avoided.map(name => name.toLowerCase()));
      if ([prefs.preferred_name,...Object.values(prefs.stages).filter(item => item.mode === "custom").map(item => item.text)]
        .some(name => name && denied.has(name.toLowerCase()))) throw new Error("nickname_blocked");
      current.addressing = prefs;
      current.nicknames = Object.fromEntries(Object.entries(prefs.stages).filter(([,item]) => item.mode === "custom").map(([key,item]) => [key,item.text]));
      if (uiTest.failAfterAction === action) throw new Error("Preview response lost");
      return {scope:args.scope,result:structuredClone(prefs)};
    }
    if (action === "set_nicknames" && current) {
      const names = {...current.nicknames};
      const clean = value => Array.from(value.replace(/[\\x00-\\x1f\\x7f]/g, " ").replace(/\\s+/g, " ").trim()).slice(0, 12).join("");
      if (args.expected_nicknames) {
        for (const key of Object.keys(args.nicknames)) {
          if (![clean(args.expected_nicknames[key]), clean(args.nicknames[key])].includes(names[key] || "")) throw new Error("nickname_conflict");
        }
      }
      const updated = args.expected_nicknames ? names : {};
      for (const [key, value] of Object.entries(args.nicknames)) {
        const normalized = clean(value);
        if (normalized) updated[key] = normalized;
        else delete updated[key];
      }
      current.nicknames = updated;
      if (uiTest.failAfterAction === action) throw new Error("Preview response lost");
      return {scope:args.scope, result:{...updated}};
    }
    if (action === "set_affection" && current) current.affection = args.value;
    if (["reset_affection","restart_relationship"].includes(action) && current) {
      const previous = current.affection;
      if (action === "restart_relationship") {
        if (args.expected_revision !== current.gain_revision || args.expected_confessed !== (current.confessed === true))
          throw new Error("relationship_changed");
        current.confessed = false; current.confessed_on = null; current.confession = "";
        delete current.milestones.lover;
        current.proactive_confession = {status:"idle",attempts:0};
      }
      current.affection = 0; current.stage = "stranger"; current.stage_index = 0;
      current.next_stage = "familiar"; current.points_to_next = 20; current.awaiting_confession = false;
      current.gain_revision += 1;
      current.history.unshift({ts:Date.now()/1000,delta:-previous,value:0,reason:"",
        source:action === "restart_relationship" ? "restart" : "reset"});
      if (uiTest.failAfterAction === action) throw new Error("Preview response lost");
    }
    if (action === "set_first_met" && current) {
      if (args.expected_date && ![args.expected_date, args.date].includes(current.first_met)) throw new Error("first_met_conflict");
      if (args.source === "plugin" && args.date !== current.plugin_first_met) throw new Error("first_met_conflict");
      current.first_met = args.date;
      current.first_met_source = args.source || "custom";
      if (args.source === "host") current.host_first_met = args.date;
      if (!args.source || args.source === "custom") current.custom_first_met = args.date;
      if (uiTest.failAfterAction === action) throw new Error("Preview response lost");
    }
    if (action === "set_settings") Object.assign(state.settings, args);
    if (action === "set_appearance") {
      state.appearance = {...args};
      try { sessionStorage.setItem("lwy:preview-appearance", JSON.stringify(args)); } catch {}
    }
    if (action === "set_per_character") state.per_character = args.enabled;
    if (action === "set_portraits") Object.assign(state.portraits.settings, args);
    if (action === "remove_anniversary") state.anniversaries = state.anniversaries.filter(item => item.id !== args.id);
    if (action === "add_anniversary") state.anniversaries.push({...args,id:String(Date.now())});
    if (["claim_shop_coins", "buy_shop_item", "send_shop_gift"].includes(action)) {
      const signature = JSON.stringify([action,args]);
      if (shopReceipts.has(args.request_id)) {
        const receipt = shopReceipts.get(args.request_id);
        if (receipt.signature !== signature) throw new Error("shop_invalid_request");
        return structuredClone(receipt.result);
      }
      if (args.revision !== state.shop.revision) throw new Error("shop_stale");
      const product = state.shop.catalog.find(item => item.id === args.item_id);
      let result;
      if (action === "claim_shop_coins") {
        const income = state.shop.income;
        const reward = [...income.steps,income.weekly,...income.pending]
          .find(item => item.reward === args.reward && item.period === args.period);
        if (!reward) throw new Error("shop_invalid_request");
        if (reward.claimed) throw new Error("shop_already_claimed");
        if (!reward.ready || income.clock_error) throw new Error("shop_reward_unavailable");
        reward.claimed = true; reward.ready = false;
        state.shop.coins += reward.coins;
        state.shop.income_total += reward.coins;
        if (income.steps.includes(reward)) { income.earned += reward.coins; income.paid += 1; }
        if (reward === income.weekly) income.weekly_paid = true;
        income.pending = income.pending.filter(item => item !== reward);
        state.shop.can_claim = [...income.steps,income.weekly,...income.pending].some(item => item.ready);
        state.shop.ledger.unshift({id:args.request_id,source:reward.reward,amount:reward.coins,
          balance:state.shop.coins,ts:Date.now()/1000,item_id:"",day:reward.period});
        result = {credited:reward.coins,coins:state.shop.coins,reward:reward.reward,period:reward.period};
      } else if (action === "buy_shop_item") {
        if (!product) throw new Error("shop_item_not_found");
        if (product.price > state.shop.coins) throw new Error("shop_insufficient_coins");
        product.quantity += 1;
        state.shop.coins -= product.price;
        state.shop.ledger.unshift({id:args.request_id, source:"purchase", amount:-product.price,
          balance:state.shop.coins, ts:Date.now()/1000, item_id:product.id, day:state.today});
        result = {item_id:product.id, quantity:product.quantity, coins:state.shop.coins};
      } else {
        if (!product?.quantity) throw new Error("shop_no_stock");
        const scope = state.per_character ? state.scopes.find(item => item.label === args.character) : state.scopes[0];
        const applied = args.gesture ? 0 : Math.min(product.gain, state.shop.gift_remaining, 100-scope.affection,
          scope.gift_room ?? state.limits.daily_gain-scope.gained_today);
        if (args.relationship_revision !== scope.gain_revision || args.expected_gain !== applied) throw new Error("shop_gain_changed");
        if (args.gesture ? !state.shop.can_gesture : applied <= 0) throw new Error(args.gesture ? "shop_gesture_limit" : "shop_no_affection_room");
        product.quantity -= 1;
        scope.affection += applied;
        scope.gained_today += applied;
        scope.gift_room = Math.max(0, scope.gift_room-applied);
        scope.gain_revision += 1;
        state.shop.gift_remaining -= applied;
        if (args.gesture) state.shop.can_gesture = false;
        const gift = {id:args.request_id, item_id:product.id, character:args.character, applied, ts:Date.now()/1000,
          reaction:uiTest.reaction, attempts:1, requested_at:Date.now()/1000, can_retry:uiTest.reaction === "unavailable"};
        state.shop.history.unshift(gift);
        scope.history.unshift({ts:gift.ts, delta:applied, value:scope.affection, source:"gift", reason:"gift:"+product.id});
        result = {...gift, gift_id:gift.id};
      }
      state.shop.revision += 1;
      shopReceipts.set(args.request_id, {signature,result:structuredClone(result)});
      if (uiTest.failAfterAction === action) throw new Error("Preview response lost");
      return result;
    }
    if (action === "retry_gift_reaction") {
      const gift = state.shop.history.find(item => item.id === args.gift_id);
      if (!gift) throw new Error("shop_gift_not_found");
      gift.reaction = uiTest.reaction; gift.can_retry = false;
      return {reaction:gift.reaction};
    }
    return {ok:true};
  },
};
function repaint() {
  window.NekoUiKit.render(window.NekoUiKit.h(__Panel, {
    ...window.__NEKO_PAYLOAD, state:structuredClone(state), api:previewApi,
    t:window.NekoUiKit.t, useLocalState:(key, initial) => window.NekoUiKit.useLocalState(key,
      key === "lwy:section" && ["settings", "shop", "nicknames", "experiences"].includes(query.get("page")) ? query.get("page") : initial),
  }), document.getElementById("root"));
}
repaint();
}
</script></body></html>`
}

export async function startPreview(port = 0, sourcePath = join(pluginRoot, "ui/panel.tsx")) {
  const server = createServer((req, res) => {
    try {
      const requestUrl = new URL(req.url, "http://localhost")
      const path = requestUrl.pathname
      if (path.startsWith("/image/")) {
        const [, , id, variant] = path.split("/")
        const item = fixture().items.find(entry => entry.id === id)
        if (!item || !["thumb", "display"].includes(variant)) { res.writeHead(404).end(); return }
        const image = readFileSync(join(pluginRoot, "assets/portraits", variant === "thumb" ? item.thumbnail : item.file))
        res.writeHead(200, { "Content-Type": "text/plain" }).end(`data:image/webp;base64,${image.toString("base64")}`)
      } else {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(document(sourcePath, requestUrl.search))
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
