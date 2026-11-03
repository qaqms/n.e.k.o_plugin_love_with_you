import {
  Alert,
  Button,
  Input,
  Modal,
  Slider,
  Switch,
  useConfirm,
  useEffect,
  useRef,
  useState,
  useToast,
} from "@neko/plugin-ui"
import type { PluginSurfaceProps } from "@neko/plugin-ui"

type HistoryItem = { ts: number; delta: number; value: number; reason: string; source: string }

type CalEvent = {
  kind: "met" | "lover" | "custom"
  type: "day" | "year" | "date"
  count: number
  title: string
  date: string
  days_until: number
}

type Anniversary = { id: string; title: string; month: number; day: number }

type ArtMeta = { available: boolean; version?: string; error?: string; file?: string }

type Scope = {
  key: string
  label: string | null
  is_current: boolean
  affection: number
  stage: string
  stage_index: number
  next_stage: string | null
  points_to_next: number
  gained_today: number
  lost_today: number
  history: HistoryItem[]
  first_met?: string
  milestones?: Record<string, string>
  nicknames?: Record<string, string>
  nickname?: string
  met_day?: number
  today_events?: CalEvent[]
  upcoming?: CalEvent[]
  awaiting_confession?: boolean
  confessed_on?: string | null
  confession?: string
  idle_days?: number
  trend?: { start: string; values: Array<number | null> }
}

type Dashboard = {
  per_character?: boolean
  current_character?: string | null
  known_characters?: string[]
  host_online?: boolean
  today?: string
  scopes?: Scope[]
  anniversaries?: Anniversary[]
  stages?: Array<{ key: string; min: number }>
  limits?: {
    per_call: number
    daily_gain: number
    daily_loss: number
    nickname_chars?: number
    title_chars?: number
    anniversaries?: number
  }
  settings?: { require_confession: boolean; decay: boolean; auto_score?: boolean }
  decay_rules?: { grace_days: number; per_day: number }
  auto_status?: {
    bus_ok: boolean | null
    bus_error?: string
    seen: number
    scored: number
    failed: number
    last_ts: number | null
    last_delta: number
    last_error?: string
    mode?: "model" | "rules" | null
    model_status?: string
  }
  decoration?: { default?: ArtMeta; stages?: Record<string, ArtMeta>; too_large?: string[]; max?: number }
}

type Section = "heart" | "dates" | "settings"

const SECTIONS: Section[] = ["heart", "dates", "settings"]
const TREND_RANGES = [30, 90, 365]

// Backend error codes the panel can explain; anything else is shown verbatim.
const ERROR_CODES = [
  "date_in_future",
  "date_too_old",
  "invalid_date",
  "title_required",
  "too_many",
  "not_found",
  "invalid_nicknames",
  "per_character_off",
  "shared_not_in_use",
  "unknown_scope",
  "current_character_unknown",
  "invalid_settings",
]

// Theme + host-control overrides are document-wide on purpose: useConfirm()
// mounts its dialog on <body>, outside the .lwy tree.
const STYLE = `
:root { --rose: #e8768f; --rose-strong: #d65f7a; --rose-soft: rgba(232, 118, 143, 0.14);
  --rose-line: rgba(232, 118, 143, 0.42); --primary: var(--rose); }
.neko-button { border: 1px solid var(--border); border-radius: 999px; padding: 6px 14px; background: transparent;
  color: var(--text); font-size: 13px; font-weight: 600; line-height: 1.4; }
.neko-button:not(:disabled):hover { transform: none; box-shadow: none; border-color: var(--rose-line); color: var(--rose); }
.neko-button[data-tone="primary"] { background: var(--rose); border-color: var(--rose); color: #fff; }
.neko-button[data-tone="primary"]:not(:disabled):hover { background: var(--rose-strong); border-color: var(--rose-strong); color: #fff; }
.neko-button[data-tone="danger"] { background: transparent; }
.neko-button[data-tone="danger"]:not(:disabled):hover { background: rgba(245, 108, 108, 0.1); color: var(--danger);
  border-color: rgba(245, 108, 108, 0.5); }
.neko-button:disabled { opacity: 0.45; cursor: not-allowed; }
.neko-button:focus-visible { outline: 2px solid var(--rose-line); outline-offset: 2px; }
.neko-input { border-radius: 10px; padding: 7px 12px; font-size: 14px; }
.neko-input:focus { border-color: var(--rose-line); box-shadow: 0 0 0 3px var(--rose-soft); }
.neko-switch { gap: 10px; color: var(--text); font-size: 14px; cursor: pointer; }
.neko-switch .neko-checkbox { appearance: none; -webkit-appearance: none; flex: none; position: relative; margin: 0;
  width: 34px; height: 20px; border-radius: 999px; background: rgba(148, 163, 184, 0.45); cursor: pointer;
  transition: background-color 160ms ease; }
.neko-switch .neko-checkbox::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25); transition: transform 160ms ease; }
.neko-switch .neko-checkbox:checked { background: var(--rose); }
.neko-switch .neko-checkbox:checked::after { transform: translateX(14px); }
.neko-switch .neko-checkbox:focus-visible { outline: 2px solid var(--rose-line); outline-offset: 2px; }
.neko-switch .neko-checkbox:disabled { opacity: 0.5; cursor: not-allowed; }
.lwy { --ink: var(--text); --hint: var(--muted);
  --line: var(--border); --card: var(--surface); padding: 20px; display: grid; gap: 18px;
  grid-template-columns: minmax(0, 1fr); max-width: 980px; margin: 0 auto; }
.lwy.has-art { grid-template-columns: minmax(180px, 300px) minmax(0, 1fr); align-items: start; }
.lwy-art { position: sticky; top: 16px; display: flex; justify-content: center; align-items: flex-end;
  min-height: 240px; max-height: 560px; }
.lwy-art img { max-width: 100%; max-height: 560px; object-fit: contain; display: block;
  filter: drop-shadow(0 10px 24px rgba(232, 118, 143, 0.18)); animation: lwy-float 6s ease-in-out infinite,
  lwy-fade 420ms ease-out; }
/* after the base .lwy-art rules so the narrow layout wins at equal specificity */
@media (max-width: 720px) { .lwy.has-art { grid-template-columns: minmax(0, 1fr); }
  .lwy-art { position: static; min-height: 0; max-height: 220px; }
  .lwy-art img { max-height: 220px; } }
.lwy-main { display: grid; gap: 16px; min-width: 0; }
.lwy-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.lwy-head-text { display: grid; gap: 2px; }
.lwy-title { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.04em; color: var(--ink); }
.lwy-sub { color: var(--hint); font-size: 12px; }
.lwy-nav { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--rose-soft); }
.lwy-nav button { border: 0; background: transparent; color: var(--hint); padding: 5px 14px; border-radius: 999px;
  font-size: 13px; cursor: pointer; transition: all 160ms ease; }
.lwy-nav button:hover { color: var(--ink); }
.lwy-nav button.on { background: var(--card); color: var(--rose); font-weight: 600; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08); }
.lwy-card { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 18px 20px; }
.lwy-card-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; }
.lwy-card-head .lwy-h { margin: 0; }
.lwy-tabs { display: flex; flex-wrap: wrap; gap: 6px; }
.lwy-tab { border: 1px solid var(--line); background: transparent; color: var(--hint); border-radius: 999px;
  padding: 4px 12px; font-size: 13px; cursor: pointer; transition: all 160ms ease; }
.lwy-tab:hover { color: var(--ink); }
.lwy-tab.on { background: var(--rose-soft); border-color: transparent; color: var(--rose); font-weight: 600; }
.lwy-tab .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--rose);
  margin-left: 6px; vertical-align: middle; }
.lwy-hero { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
.lwy-ring { --p: 0; width: 148px; height: 148px; flex: none; position: relative; }
.lwy-ring-fill { position: absolute; inset: 0; border-radius: 50%;
  background: conic-gradient(var(--rose) calc(var(--p) * 1%), var(--rose-soft) 0);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 10px), #000 calc(100% - 9px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 10px), #000 calc(100% - 9px)); }
.lwy-ring-in { position: absolute; inset: 0; display: grid; place-items: center; align-content: center; gap: 2px; }
.lwy-num { font-size: 38px; font-weight: 700; line-height: 1; color: var(--ink); font-variant-numeric: tabular-nums; }
.lwy-heart { color: var(--rose); font-size: 14px; animation: lwy-beat 1.6s ease-in-out infinite; }
.lwy-stage { display: grid; gap: 6px; }
.lwy-stage-name { font-size: 26px; font-weight: 700; color: var(--rose); letter-spacing: 0.08em; }
.lwy-hint { color: var(--hint); font-size: 13px; line-height: 1.6; }
.lwy-nick { color: var(--ink); font-size: 13px; }
.lwy-nick b { color: var(--rose); font-weight: 600; }
.lwy-banner { display: flex; gap: 8px; align-items: center; margin-top: 16px; padding: 10px 14px; border-radius: 12px;
  background: var(--rose-soft); color: var(--rose); font-size: 13px; font-weight: 600; }
.lwy-track { display: grid; grid-template-columns: repeat(5, 1fr); position: relative; margin-top: 20px; }
.lwy-track::before { content: ""; position: absolute; left: 10%; right: 10%; top: 6px; height: 2px; background: var(--line); }
.lwy-step { display: grid; justify-items: center; gap: 6px; position: relative; font-size: 12px; color: var(--hint); }
.lwy-step i { width: 14px; height: 14px; border-radius: 50%; background: var(--bg); border: 2px solid var(--line); }
.lwy-step.done i { background: var(--rose); border-color: var(--rose); }
.lwy-step.now i { box-shadow: 0 0 0 4px var(--rose-soft); }
.lwy-step.now { color: var(--rose); font-weight: 600; }
.lwy-today { display: flex; gap: 18px; flex-wrap: wrap; font-size: 12px; color: var(--hint); margin-top: 16px; }
.lwy-today b { color: var(--ink); font-weight: 600; }
.lwy-h { margin: 0 0 10px; font-size: 14px; font-weight: 600; color: var(--ink); }
.lwy-list { display: grid; gap: 2px; max-height: 300px; overflow: auto; }
.lwy-row { display: grid; grid-template-columns: 44px 1fr auto; gap: 10px; align-items: baseline; padding: 7px 2px;
  border-bottom: 1px dashed var(--line); font-size: 13px; }
.lwy-row:last-child, .lwy-ev:last-child { border-bottom: none; }
.lwy-d { font-weight: 700; font-variant-numeric: tabular-nums; }
.lwy-d.up { color: var(--rose); } .lwy-d.down { color: #7c93b3; } .lwy-d.zero { color: var(--hint); }
.lwy-why { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lwy-when { color: var(--hint); font-size: 12px; }
.lwy-empty { color: var(--hint); font-size: 13px; padding: 10px 0; margin: 0; }
.lwy-days { display: flex; gap: 32px; flex-wrap: wrap; align-items: flex-end; }
.lwy-days-item { display: grid; gap: 4px; }
.lwy-days-num { font-size: 34px; font-weight: 700; line-height: 1; color: var(--rose); font-variant-numeric: tabular-nums; }
.lwy-days-num small { font-size: 13px; font-weight: 500; color: var(--hint); margin-left: 4px; }
.lwy-marks { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.lwy-mark { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px;
  background: var(--rose-soft); font-size: 12px; color: var(--hint); }
.lwy-mark b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
.lwy-ev { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 12px; align-items: center; padding: 8px 2px;
  border-bottom: 1px dashed var(--line); font-size: 13px; }
.lwy-ev-name { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lwy-ev-date { color: var(--hint); font-size: 12px; font-variant-numeric: tabular-nums; }
.lwy-cd { color: var(--rose); font-weight: 600; font-size: 12px; font-variant-numeric: tabular-nums; }
.lwy-x { border: 0; background: transparent; color: var(--hint); cursor: pointer; font-size: 16px; line-height: 1;
  padding: 2px 6px; border-radius: 6px; }
.lwy-x:hover { color: var(--rose); background: var(--rose-soft); }
.lwy-set { display: grid; gap: 12px; }
.lwy-set-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.lwy-nick-grid { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 10px 12px; align-items: center; }
.lwy-nick-grid span { font-size: 13px; color: var(--hint); }
.lwy-field { display: grid; gap: 6px; margin-bottom: 12px; font-size: 13px; color: var(--hint); }
.lwy-note { color: var(--hint); font-size: 12px; line-height: 1.6; margin: 0; }
.lwy-btns { display: flex; gap: 8px; }
.lwy-modal-num { font-size: 32px; font-weight: 700; color: var(--rose); text-align: center; }
.lwy-wait { color: var(--rose); font-size: 13px; font-weight: 600; }
.lwy-range { display: inline-flex; gap: 4px; }
.lwy-range button { border: 1px solid var(--line); background: transparent; color: var(--hint); border-radius: 999px;
  padding: 2px 10px; font-size: 12px; cursor: pointer; }
.lwy-range button.on { background: var(--rose-soft); border-color: transparent; color: var(--rose); font-weight: 600; }
.lwy-plot { --axis: 44px; display: grid; grid-template-columns: var(--axis) minmax(0, 1fr); gap: 8px; }
.lwy-axis { position: relative; font-size: 10px; color: var(--hint); }
.lwy-axis span { position: absolute; right: 0; transform: translateY(50%); line-height: 1; white-space: nowrap; }
.lwy-chart { position: relative; height: 140px; display: flex; align-items: flex-end; gap: 2px;
  border-bottom: 1px solid var(--line); }
.lwy-chart.dense { gap: 0; }
.lwy-bar { flex: 1 1 0; min-width: 0; border-radius: 3px 3px 0 0; opacity: 0.85; transition: opacity 120ms ease;
  background: linear-gradient(to top, rgba(232, 118, 143, 0.35), var(--rose)); }
.lwy-chart.dense .lwy-bar { border-radius: 0; }
.lwy-bar:hover { opacity: 1; }
.lwy-bar.empty { background: transparent; }
.lwy-line { position: absolute; left: 0; right: 0; height: 0; border-top: 1px dashed var(--line); pointer-events: none; z-index: 1; }
.lwy-chart-foot { display: flex; justify-content: space-between; gap: 8px; margin-top: 6px;
  padding-left: calc(var(--axis, 44px) + 8px); font-size: 11px; color: var(--hint); }
.lwy-quote { margin: 14px 0 0; padding: 10px 12px; border-left: 2px solid var(--rose); border-radius: 0 10px 10px 0;
  background: var(--rose-soft); color: var(--ink); font-size: 13px; line-height: 1.6; }
.lwy-rule { display: grid; gap: 6px; }
.lwy-rule .lwy-note { padding-left: 44px; }
.lwy-rule .lwy-status { color: var(--rose); }
@media (max-width: 480px) {
  .lwy { padding: 14px; gap: 14px; }
  .lwy-card { padding: 16px; }
  .lwy-hero { gap: 16px; }
  .lwy-ring { width: 120px; height: 120px; }
  .lwy-num { font-size: 32px; }
  .lwy-stage-name { font-size: 22px; }
  .lwy-rule .lwy-note { padding-left: 0; }
}
@keyframes lwy-beat { 0%, 100% { transform: scale(1); } 15% { transform: scale(1.25); } 30% { transform: scale(1); } }
@keyframes lwy-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@keyframes lwy-fade { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .lwy-heart, .lwy-art img { animation: none; } }
`

function unwrap(value: any, key: string): any {
  let current = value
  for (let i = 0; i < 4 && current && typeof current === "object"; i += 1) {
    if (key in current) return current
    current = current.result ?? current.data ?? current.value
  }
  return {}
}

function parseIsoDay(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "")
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

function shiftIso(iso: string, days: number): string {
  const parsed = parseIsoDay(iso)
  if (!parsed) return iso
  const shifted = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d + days))
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(shifted.getUTCDate()).padStart(2, "0")
  return `${shifted.getUTCFullYear()}-${mm}-${dd}`
}

export default function LoveWithYouPanel(props: PluginSurfaceProps<Dashboard>) {
  const { t, api } = props
  const state = props.state || {}
  const scopes = Array.isArray(state.scopes) ? state.scopes : []
  const stages = Array.isArray(state.stages) && state.stages.length ? state.stages : []
  const limits = state.limits || { per_call: 5, daily_gain: 15, daily_loss: 30 }
  const anniversaries = Array.isArray(state.anniversaries) ? state.anniversaries : []
  const maxAnniversaries = limits.anniversaries || 20
  const toast = useToast()
  const confirm = useConfirm()

  const [section, setSection] = props.useLocalState<Section>("lwy:section", "heart")
  const [selectedKey, setSelectedKey] = props.useLocalState<string>("lwy:scope", "")
  const [art, setArt] = useState<string>("")
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(0)
  const [nickDraft, setNickDraft] = useState<Record<string, string>>({})
  const [metOpen, setMetOpen] = useState(false)
  const [metDraft, setMetDraft] = useState("")
  const [annOpen, setAnnOpen] = useState(false)
  const [annTitle, setAnnTitle] = useState("")
  const [annDate, setAnnDate] = useState("")
  const [trendRange, setTrendRange] = props.useLocalState<number>("lwy:trend", 30)
  const artCache = useRef<Record<string, string>>({})

  const fallback = scopes.find((s) => s.is_current) || scopes[0]
  const scope = scopes.find((s) => s.key === selectedKey) || fallback
  const activeSection: Section = SECTIONS.includes(section) ? section : "heart"

  const stageName = (key: string | null | undefined) => (key ? t(`stage.${key}`, { defaultValue: key }) : "")
  const monthDay = (m: number, d: number) => t("date.monthDay", { m, d, defaultValue: "{m}月{d}日" })
  const isoLabel = (iso: string) => {
    const parsed = parseIsoDay(iso)
    return parsed ? t("date.full", { ...parsed, defaultValue: "{y}年{m}月{d}日" }) : iso
  }
  const eventLabel = (event: CalEvent) =>
    event.kind === "custom"
      ? event.title
      : t(`event.${event.kind}.${event.type}`, { n: event.count, defaultValue: `${event.kind} ${event.count}` })
  const countdown = (days: number) =>
    days <= 0 ? t("dates.today", { defaultValue: "就是今天" }) : t("dates.inDays", { n: days, defaultValue: "还有 {n} 天" })

  function relativeTime(ts: number): string {
    const seconds = Math.max(0, Math.floor(Date.now() / 1000 - ts))
    if (seconds < 60) return t("time.justNow", { defaultValue: "刚刚" })
    if (seconds < 3600) return t("time.minutes", { n: Math.floor(seconds / 60), defaultValue: "{n} 分钟前" })
    if (seconds < 86400) return t("time.hours", { n: Math.floor(seconds / 3600), defaultValue: "{n} 小时前" })
    const date = new Date(ts * 1000)
    return monthDay(date.getMonth() + 1, date.getDate())
  }

  function errorText(error: any): string {
    const raw = String((error && error.message) || error || "")
    const code = ERROR_CODES.find((item) => raw.includes(item))
    return code ? t(`error.${code}`, { defaultValue: raw }) : raw
  }

  // ---- artwork: stage_<stage> replaces the default decoration at that stage
  const decoration = state.decoration || {}
  const stageArt = scope && decoration.stages ? decoration.stages[scope.stage] : undefined
  const artVersion =
    stageArt && stageArt.available
      ? stageArt.version || ""
      : decoration.default && decoration.default.available
        ? decoration.default.version || ""
        : ""
  const artStage = scope ? scope.stage : ""
  useEffect(() => {
    if (!artVersion) {
      setArt("")
      return
    }
    const cached = artCache.current[artVersion]
    if (cached) {
      setArt(cached)
      return
    }
    let alive = true
    api.call("get_decoration", { stage: artStage }).then((res: any) => {
      const payload = unwrap(res, "available")
      const url = payload.available && typeof payload.data_url === "string" ? payload.data_url : ""
      if (url) artCache.current[String(payload.version || artVersion)] = url
      if (alive) setArt(url)
    }).catch(() => { if (alive) setArt("") })
    return () => { alive = false }
  }, [artVersion, artStage])

  // ---- nickname drafts follow the selected scope until the user edits them
  const savedNicknames = (scope && scope.nicknames) || {}
  const savedNickKey = scope ? `${scope.key}|${JSON.stringify(savedNicknames)}` : ""
  useEffect(() => {
    setNickDraft({ ...savedNicknames })
  }, [savedNickKey])
  const nickDirty = stages.some((item) => (nickDraft[item.key] || "").trim() !== (savedNicknames[item.key] || ""))

  async function run(actionId: string, args: Record<string, unknown>, success: string) {
    setBusy(true)
    try {
      await api.call(actionId, args)
      toast.success(success)
      await api.refresh()
      return true
    } catch (error: any) {
      toast.error(errorText(error))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function togglePerCharacter(next: boolean) {
    const ok = await confirm({
      title: next ? t("perChar.onTitle", { defaultValue: "开启独立好感？" }) : t("perChar.offTitle", { defaultValue: "改回共用好感？" }),
      message: next
        ? t("perChar.onMessage", { defaultValue: "当前角色保留现在的好感；其他角色恢复各自以前的记录，没有记录的从 0 开始。不会清除任何数据。" })
        : t("perChar.offMessage", { defaultValue: "共用好感将使用当前角色的值；其他角色的独立记录会保留，下次开启时恢复。" }),
      confirmLabel: t("common.confirm", { defaultValue: "确定" }),
      cancelLabel: t("common.cancel", { defaultValue: "取消" }),
    })
    if (ok) await run("set_per_character", { enabled: next }, t("toast.saved", { defaultValue: "已保存" }))
  }

  async function toggleSetting(key: "require_confession" | "decay" | "auto_score", next: boolean) {
    const rules = state.decay_rules || { grace_days: 3, per_day: 1 }
    if (key === "decay" && next) {
      const ok = await confirm({
        title: t("rules.decayOnTitle", { defaultValue: "开启好感变淡？" }),
        message: t("rules.decayOnMessage", {
          grace: rules.grace_days,
          per: rules.per_day,
          defaultValue: "从今天开始计算：超过 {grace} 天没聊，每天 -{per}，但不会让关系掉出当前阶段。",
        }),
        confirmLabel: t("common.confirm", { defaultValue: "确定" }),
        cancelLabel: t("common.cancel", { defaultValue: "取消" }),
      })
      if (!ok) return
    }
    if (key === "require_confession" && !next) {
      const ok = await confirm({
        title: t("rules.gateOffTitle", { defaultValue: "不再需要告白？" }),
        message: t("rules.gateOffMessage", { defaultValue: "好感已到 80 的角色会立刻成为恋人，这一步不能撤回。" }),
        confirmLabel: t("common.confirm", { defaultValue: "确定" }),
        cancelLabel: t("common.cancel", { defaultValue: "取消" }),
      })
      if (!ok) return
    }
    await run("set_settings", { [key]: next }, t("toast.saved", { defaultValue: "已保存" }))
  }

  async function reset() {
    if (!scope) return
    const ok = await confirm({
      title: t("reset.title", { defaultValue: "重置好感？" }),
      message: t("reset.message", { defaultValue: "只会把这一份好感清零，其他角色不受影响，心动记录会保留。" }),
      tone: "danger",
      confirmLabel: t("reset.confirm", { defaultValue: "重置" }),
      cancelLabel: t("common.cancel", { defaultValue: "取消" }),
    })
    if (ok) await run("reset_affection", { scope: scope.key }, t("toast.reset", { defaultValue: "已重置" }))
  }

  async function saveDraft() {
    if (!scope) return
    if (await run("set_affection", { scope: scope.key, value: draft }, t("toast.saved", { defaultValue: "已保存" }))) {
      setEditing(false)
    }
  }

  async function saveNicknames() {
    if (!scope) return
    const payload: Record<string, string> = {}
    for (const item of stages) payload[item.key] = (nickDraft[item.key] || "").trim()
    await run("set_nicknames", { scope: scope.key, nicknames: payload }, t("toast.saved", { defaultValue: "已保存" }))
  }

  async function saveFirstMet() {
    if (!scope) return
    if (await run("set_first_met", { scope: scope.key, date: metDraft }, t("toast.saved", { defaultValue: "已保存" }))) {
      setMetOpen(false)
    }
  }

  async function addAnniversary() {
    const title = annTitle.trim()
    const parsed = parseIsoDay(annDate)
    if (!title) {
      toast.error(t("error.title_required", { defaultValue: "请填写名称" }))
      return
    }
    if (!parsed) {
      toast.error(t("error.invalid_date", { defaultValue: "日期无效" }))
      return
    }
    if (await run("add_anniversary", { title, month: parsed.m, day: parsed.d }, t("toast.added", { defaultValue: "已添加" }))) {
      setAnnOpen(false)
    }
  }

  async function removeAnniversary(item: Anniversary) {
    const ok = await confirm({
      title: t("dates.removeTitle", { defaultValue: "删除纪念日？" }),
      message: t("dates.removeMessage", { name: item.title, defaultValue: "「{name}」会从所有角色的记忆里移除。" }),
      tone: "danger",
      confirmLabel: t("dates.remove", { defaultValue: "删除" }),
      cancelLabel: t("common.cancel", { defaultValue: "取消" }),
    })
    if (ok) await run("remove_anniversary", { id: item.id }, t("toast.removed", { defaultValue: "已删除" }))
  }

  // Placeholder shows what an empty stage inherits from the stages below it.
  function inheritedNickname(index: number): string {
    for (let i = index - 1; i >= 0; i -= 1) {
      const value = (nickDraft[stages[i].key] || "").trim()
      if (value) return value
    }
    return ""
  }

  const hasArt = Boolean(art)
  const percent = scope ? Math.max(0, Math.min(100, scope.affection)) : 0
  const settings = state.settings || { require_confession: true, decay: false, auto_score: true }
  const decayRules = state.decay_rules || { grace_days: 3, per_day: 1 }
  const autoStatus = state.auto_status
  function autoStatusText(): string {
    if (!autoStatus) return ""
    if (autoStatus.bus_ok === false) {
      return t("rules.autoNoBus", { defaultValue: "暂时读不到聊天内容，请确认 N.E.K.O 里的用户插件已开启。" })
    }
    if (autoStatus.scored > 0 && autoStatus.last_ts) {
      const scored = t("rules.autoScored", {
        n: autoStatus.scored,
        when: relativeTime(autoStatus.last_ts),
        defaultValue: "已判断 {n} 轮对话，最近一次在{when}。",
      })
      return scored + autoModeText()
    }
    if (autoStatus.last_error && autoStatus.failed > 0) {
      return t("rules.autoFailed", {
        failed: autoStatus.failed,
        defaultValue: "已有 {failed} 轮判断失败。",
      })
    }
    return t("rules.autoIdle", { defaultValue: "开始聊天后，这里会显示判断了多少轮。" })
  }
  function autoModeText(): string {
    if (!autoStatus || !autoStatus.mode) return ""
    if (autoStatus.mode === "model") {
      return t("rules.autoModeModel", { defaultValue: "正在用你绑定的模型判断。" })
    }
    const status = autoStatus.model_status || ""
    if (status === "unbound" || status === "gateway_unavailable") {
      return t("rules.autoModeRules", { defaultValue: "正在用关键词判断。" })
    }
    return t("rules.autoModeFallback", { defaultValue: "绑定的模型这次没有给出结果，暂时改用关键词判断。" })
  }
  const todayEvents = (scope && scope.today_events) || []
  const upcoming = (scope && scope.upcoming) || []
  const milestones = (scope && scope.milestones) || {}
  const loverSince = milestones.lover || ""
  const tooLarge = Array.isArray(decoration.too_large) ? decoration.too_large : []
  const sectionLabel = (key: Section) =>
    key === "heart"
      ? t("nav.heart", { defaultValue: "心动" })
      : key === "dates"
        ? t("nav.dates", { defaultValue: "纪念日" })
        : t("nav.settings", { defaultValue: "设置" })

  function loverDays(): number {
    const start = parseIsoDay(loverSince)
    const today = parseIsoDay(state.today || "")
    if (!start || !today) return 0
    const diff = Date.UTC(today.y, today.m - 1, today.d) - Date.UTC(start.y, start.m - 1, start.d)
    return Math.floor(diff / 86400000) + 1
  }

  function historyText(item: HistoryItem): string {
    const label = t(`source.${item.source}`, { defaultValue: item.source })
    if (item.source === "confession") return item.reason ? `${label}：${item.reason}` : label
    return item.reason || label
  }

  function renderTrend(current: Scope) {
    const trend = current.trend
    if (!trend || !Array.isArray(trend.values) || trend.values.length === 0) return null
    const days = TREND_RANGES.includes(trendRange) ? trendRange : TREND_RANGES[0]
    const values = trend.values.slice(-days)
    const startIso = shiftIso(trend.start, trend.values.length - values.length)
    const known = values.filter((value): value is number => typeof value === "number")
    const recorded = trend.values.filter((value) => typeof value === "number").length
    if (recorded < 2) {
      return (
        <section className="lwy-card">
          <h2 className="lwy-h">{t("trend.title", { defaultValue: "好感走势" })}</h2>
          <p className="lwy-empty">{t("trend.notYet", { defaultValue: "多聊几天，这里就会画出你们的好感走势。" })}</p>
        </section>
      )
    }
    return (
      <section className="lwy-card">
        <div className="lwy-card-head">
          <h2 className="lwy-h">{t("trend.title", { defaultValue: "好感走势" })}</h2>
          <div className="lwy-range">
            {TREND_RANGES.map((n) => (
              <button key={n} type="button" className={n === days ? "on" : ""} onClick={() => setTrendRange(n)}>
                {t("trend.days", { n, defaultValue: "{n} 天" })}
              </button>
            ))}
          </div>
        </div>
        <div className="lwy-plot">
        <div className="lwy-axis" aria-hidden="true">
          {stages.slice(1).map((item) => (
            <span key={item.key} style={{ bottom: `${item.min}%` }}>{stageName(item.key)}</span>
          ))}
        </div>
        <div className={days > 90 ? "lwy-chart dense" : "lwy-chart"}>
          {stages.slice(1).map((item) => (
            <i key={item.key} className="lwy-line" style={{ bottom: `${item.min}%` }} />
          ))}
          {values.map((value, index) => (
            <span
              key={index}
              className={value === null ? "lwy-bar empty" : "lwy-bar"}
              style={{ height: `${value === null ? 0 : Math.max(2, value)}%` }}
              title={value === null ? "" : `${isoLabel(shiftIso(startIso, index))} · ${value}`}
            />
          ))}
        </div>
        </div>
        <div className="lwy-chart-foot">
          <span>{isoLabel(startIso)}</span>
          <span>
            {known.length
              ? t("trend.change", { from: known[0], to: known[known.length - 1], defaultValue: "{from} → {to}" })
              : t("trend.empty", { defaultValue: "这段时间还没有记录" })}
          </span>
          <span>{t("trend.today", { defaultValue: "今天" })}</span>
        </div>
      </section>
    )
  }

  function renderHeart(current: Scope) {
    return (
      <div className="lwy-main">
        <section className="lwy-card">
          <div className="lwy-hero">
            <div className="lwy-ring" style={{ "--p": String(percent) }}>
              <div className="lwy-ring-fill" />
              <div className="lwy-ring-in">
                <span className="lwy-num">{current.affection}</span>
                <span className="lwy-heart">♥</span>
              </div>
            </div>
            <div className="lwy-stage">
              <span className="lwy-hint">
                {current.label
                  ? t("hero.withName", { name: current.label, defaultValue: "{name} 和你现在是" })
                  : t("hero.shared", { defaultValue: "你们现在是" })}
              </span>
              <span className="lwy-stage-name">{stageName(current.stage)}</span>
              {current.nickname ? (
                <span className="lwy-nick">
                  {t("hero.nicknamePrefix", { defaultValue: "会叫你" })} <b>「{current.nickname}」</b>
                </span>
              ) : null}
              {current.awaiting_confession ? (
                <span className="lwy-wait">{t("hero.awaitConfession", { defaultValue: "好感已经够了，只差一句告白" })}</span>
              ) : (
                <span className="lwy-hint">
                  {current.next_stage
                    ? t("hero.next", { n: current.points_to_next, stage: stageName(current.next_stage), defaultValue: "再 {n} 点就是「{stage}」" })
                    : t("hero.max", { defaultValue: "已经是最亲密的关系了" })}
                </span>
              )}
            </div>
          </div>

          {todayEvents.length ? (
            <div className="lwy-banner">
              <span>♥</span>
              <span>
                {t("hero.todayIs", { defaultValue: "今天是" })} {todayEvents.map((event) => `「${eventLabel(event)}」`).join(" ")}
              </span>
            </div>
          ) : null}

          <div className="lwy-track">
            {stages.map((item, index) => (
              <div
                key={item.key}
                className={["lwy-step", index <= current.stage_index ? "done" : "", index === current.stage_index ? "now" : ""].join(" ")}
              >
                <i />
                <span>{stageName(item.key)}</span>
              </div>
            ))}
          </div>

          <div className="lwy-today">
            <span>{t("today.gain", { defaultValue: "今日心动" })} <b>{current.gained_today ? `+${current.gained_today}` : "0"}</b> / {limits.daily_gain}</span>
            <span>{t("today.loss", { defaultValue: "今日失落" })} <b>{current.lost_today ? `-${current.lost_today}` : "0"}</b> / {limits.daily_loss}</span>
            <span>{t("today.metDay", { n: current.met_day || 1, defaultValue: "相识第 {n} 天" })}</span>
          </div>
        </section>

        {renderTrend(current)}

        <section className="lwy-card">
          <h2 className="lwy-h">{t("history.title", { defaultValue: "心动记录" })}</h2>
          {current.history.length === 0 ? (
            <p className="lwy-empty">{t("history.empty", { defaultValue: "还没有记录。多和 TA 聊聊吧。" })}</p>
          ) : (
            <div className="lwy-list">
              {current.history.map((item) => (
                <div className="lwy-row" key={`${item.ts}:${item.value}`}>
                  <span className={item.source === "confession" || item.delta > 0 ? "lwy-d up" : item.delta < 0 ? "lwy-d down" : "lwy-d zero"}>
                    {item.source === "confession" ? "♥" : item.delta > 0 ? `+${item.delta}` : String(item.delta)}
                  </span>
                  <span className="lwy-why">{historyText(item)}</span>
                  <span className="lwy-when">{relativeTime(item.ts)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    )
  }

  function renderDates(current: Scope) {
    const reached = stages.slice(1).filter((item) => milestones[item.key])
    return (
      <div className="lwy-main">
        <section className="lwy-card">
          <div className="lwy-card-head">
            <h2 className="lwy-h">{t("dates.ours", { defaultValue: "我们的日子" })}</h2>
            <Button tone="default" disabled={busy} onClick={() => { setMetDraft(current.first_met || state.today || ""); setMetOpen(true) }}>
              {t("dates.editMet", { defaultValue: "修改相识日" })}
            </Button>
          </div>
          <div className="lwy-days">
            <div className="lwy-days-item">
              <span className="lwy-hint">{t("dates.metSince", { date: isoLabel(current.first_met || ""), defaultValue: "{date} 相识" })}</span>
              <span className="lwy-days-num">{current.met_day || 1}<small>{t("dates.dayUnit", { defaultValue: "天" })}</small></span>
            </div>
            {loverSince ? (
              <div className="lwy-days-item">
                <span className="lwy-hint">{t("dates.loverSince", { date: isoLabel(loverSince), defaultValue: "{date} 在一起" })}</span>
                <span className="lwy-days-num">{loverDays()}<small>{t("dates.dayUnit", { defaultValue: "天" })}</small></span>
              </div>
            ) : null}
          </div>
          {reached.length ? (
            <div className="lwy-marks">
              {reached.map((item) => (
                <span key={item.key} className="lwy-mark">
                  {t("dates.reached", { stage: stageName(item.key), defaultValue: "成为「{stage}」" })} <b>{isoLabel(milestones[item.key])}</b>
                </span>
              ))}
            </div>
          ) : null}
          {current.confessed_on ? (
            <p className="lwy-quote">
              {t("dates.confessedOn", { date: isoLabel(current.confessed_on), defaultValue: "{date} 告白成功" })}
              {current.confession ? `：「${current.confession}」` : ""}
            </p>
          ) : null}
        </section>

        <section className="lwy-card">
          <h2 className="lwy-h">{t("dates.upcoming", { defaultValue: "即将到来" })}</h2>
          {upcoming.length === 0 ? (
            <p className="lwy-empty">{t("dates.upcomingEmpty", { defaultValue: "接下来 60 天没有纪念日。" })}</p>
          ) : (
            <div>
              {upcoming.map((event) => (
                <div className="lwy-ev" key={`${event.kind}:${event.type}:${event.count}:${event.title}:${event.date}`}>
                  <span className="lwy-ev-name">{eventLabel(event)}</span>
                  <span className="lwy-ev-date">{isoLabel(event.date)}</span>
                  <span className="lwy-cd">{countdown(event.days_until)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="lwy-card">
          <div className="lwy-card-head">
            <h2 className="lwy-h">
              {t("dates.custom", { defaultValue: "自定义纪念日" })}
              <span className="lwy-sub"> {anniversaries.length}/{maxAnniversaries}</span>
            </h2>
            <Button
              tone="default"
              disabled={busy || anniversaries.length >= maxAnniversaries}
              onClick={() => { setAnnTitle(""); setAnnDate(state.today || ""); setAnnOpen(true) }}
            >
              {t("dates.add", { defaultValue: "添加" })}
            </Button>
          </div>
          {anniversaries.length === 0 ? (
            <p className="lwy-empty">{t("dates.customEmpty", { defaultValue: "可以添加生日等每年都想被记住的日子。" })}</p>
          ) : (
            <div>
              {anniversaries.map((item) => (
                <div className="lwy-ev" key={item.id}>
                  <span className="lwy-ev-name">{item.title}</span>
                  <span className="lwy-ev-date">{monthDay(item.month, item.day)}</span>
                  <button
                    type="button"
                    className="lwy-x"
                    disabled={busy}
                    title={t("dates.remove", { defaultValue: "删除" })}
                    onClick={() => { void removeAnniversary(item) }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="lwy-note" style={{ marginTop: "10px" }}>
            {t("dates.customNote", { defaultValue: "自定义纪念日所有角色都会记得。到了那天，角色会在聊天里自然地提起。" })}
          </p>
        </section>
      </div>
    )
  }

  function renderSettings(current: Scope | undefined) {
    return (
      <div className="lwy-main">
        {current ? (
          <section className="lwy-card">
            <div className="lwy-card-head">
              <h2 className="lwy-h">{t("nick.title", { defaultValue: "称呼" })}</h2>
              <Button tone="primary" disabled={busy || !nickDirty} onClick={saveNicknames}>
                {t("common.save", { defaultValue: "保存" })}
              </Button>
            </div>
            <div className="lwy-nick-grid">
              {stages.map((item, index) => (
                <div key={item.key} style={{ display: "contents" }}>
                  <span>{stageName(item.key)}</span>
                  <Input
                    value={nickDraft[item.key] || ""}
                    disabled={busy}
                    placeholder={inheritedNickname(index) || t("nick.placeholder", { defaultValue: "沿用人设里的称呼" })}
                    onChange={(value: string) => setNickDraft({ ...nickDraft, [item.key]: value.slice(0, limits.nickname_chars || 12) })}
                  />
                </div>
              ))}
            </div>
            <p className="lwy-note" style={{ marginTop: "10px" }}>
              {t("nick.note", { defaultValue: "角色在这个阶段会这样叫你。留空的阶段沿用上一阶段的称呼。" })}
            </p>
          </section>
        ) : null}

        <section className="lwy-card lwy-set">
          <h2 className="lwy-h">{t("rules.title", { defaultValue: "关系规则" })}</h2>
          <div className="lwy-rule">
            <Switch
              checked={settings.auto_score !== false}
              disabled={busy}
              label={t("rules.autoScore", { defaultValue: "自动判断好感" })}
              onChange={(value: boolean) => toggleSetting("auto_score", value)}
            />
            <p className="lwy-note">
              {settings.auto_score !== false
                ? t("rules.autoScoreNote", {
                    defaultValue:
                      "每轮对话结束后判断这一轮让好感变了多少。默认用本地关键词判断；想判断得更准，可以在 N.E.K.O 的「Plugin API」页给本插件的「好感判断」绑定一个模型。只保存一句理由，不保存聊天内容。",
                  })
                : t("rules.autoScoreOffNote", { defaultValue: "关闭后由角色自己调用工具调整好感，很多模型几乎不会调用。" })}
            </p>
            {settings.auto_score !== false && autoStatusText() ? <p className="lwy-note lwy-status">{autoStatusText()}</p> : null}
          </div>
          <div className="lwy-rule">
            <Switch
              checked={Boolean(settings.require_confession)}
              disabled={busy}
              label={t("rules.confession", { defaultValue: "成为恋人需要告白" })}
              onChange={(value: boolean) => toggleSetting("require_confession", value)}
            />
            <p className="lwy-note">
              {t("rules.confessionNote", { defaultValue: "好感到 80 后先停在「暧昧」，等你们在聊天里真的告白、彼此答应，才成为恋人。已经是恋人的不受影响。" })}
            </p>
          </div>
          <div className="lwy-rule">
            <Switch
              checked={Boolean(settings.decay)}
              disabled={busy}
              label={t("rules.decay", { defaultValue: "好感随时间变淡" })}
              onChange={(value: boolean) => toggleSetting("decay", value)}
            />
            <p className="lwy-note">
              {t("rules.decayNote", {
                grace: decayRules.grace_days,
                per: decayRules.per_day,
                defaultValue: "超过 {grace} 天没聊，好感每天 -{per}，最低只到当前阶段的下限，关系不会因此倒退。",
              })}
            </p>
          </div>
        </section>

        <section className="lwy-card lwy-set">
          <h2 className="lwy-h">{t("settings.title", { defaultValue: "角色与好感" })}</h2>
          <div className="lwy-set-row">
            <Switch
              checked={Boolean(state.per_character)}
              disabled={busy}
              label={t("settings.perCharacter", { defaultValue: "每个角色独立好感" })}
              onChange={(value: boolean) => togglePerCharacter(value)}
            />
            <Button tone="default" disabled={busy} onClick={async () => { await run("sync_characters", {}, t("toast.synced", { defaultValue: "已刷新" })) }}>
              {t("settings.sync", { defaultValue: "刷新角色" })}
            </Button>
          </div>
          <p className="lwy-note">
            {t("settings.perCharacterNote", { defaultValue: "关闭时所有角色共用一份好感、称呼和相识日。切换开关不会清除任何角色的数据。" })}
          </p>
          {current ? (
            <div className="lwy-set-row">
              <span className="lwy-hint">
                {current.label
                  ? t("settings.editingName", { name: current.label, defaultValue: "正在管理：{name}" })
                  : t("settings.editingShared", { defaultValue: "正在管理：共用好感" })}
              </span>
              <div className="lwy-btns">
                <Button tone="default" disabled={busy} onClick={() => { setDraft(current.affection); setEditing(true) }}>
                  {t("settings.adjust", { defaultValue: "调整" })}
                </Button>
                <Button tone="danger" disabled={busy} onClick={reset}>
                  {t("settings.reset", { defaultValue: "重置" })}
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    )
  }

  return (
    <div className={hasArt ? "lwy has-art" : "lwy"}>
      <style>{STYLE}</style>

      {hasArt ? (
        <aside className="lwy-art">
          <img key={art.length} src={art} alt="" />
        </aside>
      ) : null}

      <main className="lwy-main">
        <header className="lwy-head">
          <div className="lwy-head-text">
            <h1 className="lwy-title">{t("panel.title", { defaultValue: "与你相恋" })}</h1>
            <span className="lwy-sub">
              {state.per_character
                ? t("mode.perCharacter", { defaultValue: "每个角色独立" })
                : t("mode.shared", { defaultValue: "所有角色共用" })}
            </span>
          </div>
          <nav className="lwy-nav" role="tablist">
            {SECTIONS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={key === activeSection ? "true" : "false"}
                className={key === activeSection ? "on" : ""}
                onClick={() => setSection(key)}
              >
                {sectionLabel(key)}
              </button>
            ))}
          </nav>
        </header>

        {state.host_online === false ? (
          <Alert tone="warning" message={t("alert.offline", { defaultValue: "暂时连不上 N.E.K.O 主程序，角色列表可能不是最新的。" })} />
        ) : null}
        {tooLarge.length ? (
          <Alert tone="info" message={t("alert.artTooLarge", { files: tooLarge.join("、"), defaultValue: "这些装饰图超过 1 MB，已跳过显示：{files}" })} />
        ) : null}

        {scopes.length > 1 ? (
          <nav className="lwy-tabs">
            {scopes.map((item) => (
              <button
                key={item.key}
                type="button"
                className={item.key === (scope && scope.key) ? "lwy-tab on" : "lwy-tab"}
                onClick={() => setSelectedKey(item.key)}
              >
                {item.label || t("scope.shared", { defaultValue: "共用" })}
                {item.is_current ? <span className="dot" title={t("scope.current", { defaultValue: "当前角色" })} /> : null}
              </button>
            ))}
          </nav>
        ) : null}

        {activeSection === "settings" ? (
          renderSettings(scope)
        ) : !scope ? (
          <section className="lwy-card">
            <p className="lwy-empty">{t("empty.noCharacters", { defaultValue: "还没有读到角色，稍等片刻或点击设置里的刷新。" })}</p>
          </section>
        ) : activeSection === "dates" ? (
          renderDates(scope)
        ) : (
          renderHeart(scope)
        )}
      </main>

      <Modal
        open={editing}
        size="sm"
        title={t("adjust.title", { defaultValue: "调整好感" })}
        onClose={() => setEditing(false)}
        footer={
          <div className="lwy-btns">
            <Button tone="default" onClick={() => { setEditing(false) }}>{t("common.cancel", { defaultValue: "取消" })}</Button>
            <Button tone="primary" disabled={busy} onClick={saveDraft}>{t("common.save", { defaultValue: "保存" })}</Button>
          </div>
        }
      >
        <div className="lwy-modal-num">{draft}</div>
        <Slider value={draft} min={0} max={100} step={1} onChange={(value: number) => setDraft(value)} />
        <p className="lwy-note">{t("adjust.note", { defaultValue: "手动调整不受每日上限限制，阶段会直接按新数值计算。" })}</p>
      </Modal>

      <Modal
        open={metOpen}
        size="sm"
        title={t("dates.editMet", { defaultValue: "修改相识日" })}
        onClose={() => setMetOpen(false)}
        footer={
          <div className="lwy-btns">
            <Button tone="default" onClick={() => { setMetOpen(false) }}>{t("common.cancel", { defaultValue: "取消" })}</Button>
            <Button tone="primary" disabled={busy || !parseIsoDay(metDraft)} onClick={saveFirstMet}>
              {t("common.save", { defaultValue: "保存" })}
            </Button>
          </div>
        }
      >
        <div className="lwy-field">
          <span>{t("dates.metLabel", { defaultValue: "你们相识的日子" })}</span>
          <Input type="date" value={metDraft} disabled={busy} onChange={(value: string) => setMetDraft(value)} />
        </div>
        <p className="lwy-note">{t("dates.metNote", { defaultValue: "相识日决定「相识第 N 天」和周年纪念，不影响好感。" })}</p>
      </Modal>

      <Modal
        open={annOpen}
        size="sm"
        title={t("dates.addTitle", { defaultValue: "添加纪念日" })}
        onClose={() => setAnnOpen(false)}
        footer={
          <div className="lwy-btns">
            <Button tone="default" onClick={() => { setAnnOpen(false) }}>{t("common.cancel", { defaultValue: "取消" })}</Button>
            <Button tone="primary" disabled={busy || !annTitle.trim() || !parseIsoDay(annDate)} onClick={addAnniversary}>
              {t("dates.add", { defaultValue: "添加" })}
            </Button>
          </div>
        }
      >
        <div className="lwy-field">
          <span>{t("dates.titleLabel", { defaultValue: "名称" })}</span>
          <Input
            value={annTitle}
            disabled={busy}
            placeholder={t("dates.titlePlaceholder", { defaultValue: "例如：我的生日" })}
            onChange={(value: string) => setAnnTitle(value.slice(0, limits.title_chars || 20))}
          />
        </div>
        <div className="lwy-field">
          <span>{t("dates.dateLabel", { defaultValue: "日期" })}</span>
          <Input type="date" value={annDate} disabled={busy} onChange={(value: string) => setAnnDate(value)} />
        </div>
        <p className="lwy-note">{t("dates.yearIgnored", { defaultValue: "每年重复，只看月和日。" })}</p>
      </Modal>
    </div>
  )
}
