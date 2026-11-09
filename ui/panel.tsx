import {
  Alert,
  Button,
  Input,
  Modal,
  NumberInput,
  Select,
  Slider,
  Switch,
  useCallback,
  useConfirm,
  useEffect,
  useRef,
  useState,
  useToast,
} from "@neko/plugin-ui"
import type { PluginSurfaceProps } from "@neko/plugin-ui"
import { Icon } from "./icons"
import { INTERACTION_STYLE, useInteractionFeedback } from "./interaction"
import { DEFAULT_APPEARANCE, THEME_PRESETS, normalizeAppearance, themeCss } from "./theme"
import type { Appearance } from "./theme"
import { Shop, SHOP_ERRORS, SHOP_STYLE } from "./shop"
import type { ShopState } from "./shop"
import { PortraitImport, PORTRAIT_IMPORT_STYLE } from "./portrait-import"
import { SCROLLBAR_STYLE, useQuietScrollbars } from "./scrollbars"

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
type FirstMetImport = {
  scope: string; date: string; previous_date: string
  character: string; source: "host_recent_history"; scanned_roles: number
}

type ArtMeta = { available: boolean; version?: string; error?: string; file?: string }
type Portrait = { id: string; name: string; collection: string; available: boolean; version: string; custom?: boolean }
type PortraitPrefs = { mode: "fixed" | "random" | "off" | "legacy"; selected_id: string; pool_ids: string[] | null }
type PortraitLibrary = {
  settings: PortraitPrefs; count: number; ids: string[]; pool_count: number; collections: string[]; revision: string; catalog_error: boolean
}
type PortraitPage = { items: Portrait[]; page: number; pages: number; total: number }

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
  gained_chat?: number
  gift_room?: number
  chat_room?: number
  gain_revision?: number
  quota_blocked?: boolean
  clock_error?: boolean
  lost_today: number
  history: HistoryItem[]
  first_met?: string
  plugin_first_met?: string
  plugin_first_met_legacy?: boolean
  host_first_met?: string | null
  custom_first_met?: string | null
  first_met_source?: "plugin" | "host" | "custom"
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
  shop?: ShopState
  appearance?: Appearance
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
    daily_chat?: number
    daily_loss: number
    nickname_chars?: number
    title_chars?: number
    anniversaries?: number
  }
  settings?: { require_confession: boolean; decay: boolean; auto_score?: boolean; proactive_confession?: boolean }
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
  portraits?: PortraitLibrary | null
}

type Section = "heart" | "history" | "dates" | "nicknames" | "shop" | "settings"
type Feedback = { tone: "pending" | "success" | "warning" | "danger"; message: string; action: string }

const SECTIONS: Section[] = ["heart", "shop", "history", "dates", "nicknames", "settings"]
const SECTION_ICONS = { heart: "Heart", history: "History", dates: "CalendarDays", nicknames: "MessageCircle", shop: "ShoppingBag", settings: "Settings" } as const
const TREND_RANGES = [30, 90, 365]

// Backend error codes the panel can explain; anything else is shown verbatim.
const ERROR_CODES = [
  ...SHOP_ERRORS,
  "date_in_future",
  "date_too_old",
  "invalid_date",
  "title_required",
  "too_many",
  "not_found",
  "invalid_nicknames",
  "nickname_conflict",
  "first_met_conflict",
  "invalid_first_met_source",
  "host_history_unavailable",
  "host_history_incomplete",
  "host_history_empty",
  "per_character_off",
  "shared_not_in_use",
  "unknown_scope",
  "current_character_unknown",
  "invalid_settings",
  "portrait_invalid_settings",
  "portrait_not_found",
  "portrait_too_large",
  "portrait_not_ready",
  "portrait_save_failed",
  "portrait_invalid_image",
  "portrait_source_too_large",
  "portrait_library_full",
  "portrait_custom_only",
  "appearance_invalid_settings",
  "appearance_not_ready",
  "appearance_save_failed",
]

// Theme + host-control overrides are document-wide on purpose: useConfirm()
// mounts its dialog on <body>, outside the .lwy tree.
const STYLE = `
:root { font-family: "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif; }
.neko-button { border: 1px solid var(--border); border-radius: 6px; padding: 7px 12px; background: transparent;
  color: var(--text); font-size: 13px; font-weight: 600; line-height: 1.4; }
.neko-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 36px; white-space: normal; }
.neko-button[data-tone="primary"] { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.neko-button[data-tone="danger"] { background: transparent; color: var(--danger); }
.neko-button:disabled { opacity: 0.45; cursor: not-allowed; }
.neko-button:focus-visible { outline: 2px solid var(--accent-line); outline-offset: 2px; }
.neko-input { border-radius: 6px; padding: 8px 12px; font-size: 14px; min-width: 0; max-width: 100%; box-sizing: border-box; }
.neko-input:focus { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-soft); }
.neko-switch { gap: 10px; color: var(--text); font-size: 14px; cursor: pointer; }
.neko-switch .neko-checkbox { appearance: none; -webkit-appearance: none; flex: none; position: relative; margin: 0;
  width: 34px; height: 20px; border-radius: 999px; background: rgba(148, 163, 184, 0.45); cursor: pointer;
  transition: background-color 160ms ease; }
.neko-switch .neko-checkbox::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25); transition: transform 160ms ease; }
.neko-switch .neko-checkbox:checked { background: var(--accent); }
.neko-switch .neko-checkbox:checked::after { transform: translateX(14px); background: var(--on-accent); }
.neko-switch .neko-checkbox:focus-visible { outline: 2px solid var(--accent-line); outline-offset: 2px; }
.neko-switch .neko-checkbox:disabled { opacity: 0.5; cursor: not-allowed; }
html, body { margin: 0; height: 100%; overflow: hidden; }
.neko-select { min-width: 0; max-width: 100%; }
.neko-modal { border-radius: 8px; max-height: calc(100dvh - 32px); display: flex; flex-direction: column; }
.neko-modal-body { min-height: 0; }
.neko-modal-header, .neko-modal-footer { flex: none; }
.neko-modal-footer { flex-direction: column; align-items: stretch; border-top: 1px solid var(--border); padding-top: 14px; }
.neko-modal-footer .lwy-btns { justify-content: flex-end; }
.neko-modal .lwy-field input { width: 100%; }
.neko-alert { border-radius: 6px; font-size: 13px; overflow-wrap: anywhere; }
.lwy-icon { display: inline-block; flex: none; width: 18px; height: 18px; background: currentColor;
  mask-size: contain; mask-position: center; mask-repeat: no-repeat; }
.lwy, .lwy * { box-sizing: border-box; letter-spacing: 0; }
.lwy { --ink: var(--text); --hint: var(--muted); --line: var(--border); --card: var(--surface); --sidebar-width: 160px;
  display: grid; grid-template-columns: var(--sidebar-width) minmax(0, 1fr); height: 100vh; height: 100dvh;
  min-height: 0; color: var(--ink); background: var(--bg); overflow: hidden; font-size: 14px; line-height: 1.65; }
.lwy.sidebar-collapsed { grid-template-columns: 56px minmax(0, 1fr); }
.lwy-sidebar { display: flex; flex-direction: column; gap: 24px; min-width: 0; min-height: 0;
  padding: 24px 12px 16px; border-right: 1px solid var(--line); background: var(--card); overflow-x: hidden; overflow-y: auto; }
.lwy-sidebar-head { display: flex; align-items: center; gap: 6px; min-width: 0; flex: none; }
.lwy-brand { flex: 1; min-width: 0; margin: 0; font-size: 16px; line-height: 1.5; font-weight: 700; overflow-wrap: anywhere; }
.lwy-sidebar-toggle { display: grid; place-items: center; flex: none; width: 32px; height: 32px;
  padding: 0; border: 1px solid var(--line); border-radius: 5px; color: var(--hint); background: transparent; cursor: pointer; }
.lwy-sidebar-body { display: flex; flex: 1 0 auto; flex-direction: column; gap: 24px; min-width: 0; }
.sidebar-collapsed .lwy-sidebar { padding: 24px 6px 16px; }
.sidebar-collapsed .lwy-sidebar-head { justify-content: center; }
.sidebar-collapsed .lwy-nav-label, .sidebar-collapsed .lwy-sidebar-foot { display: none; }
.sidebar-collapsed .lwy-nav button { justify-content: center; padding: 10px 4px; }
.lwy-brand-mark { display: none; color: var(--accent); height: 32px; align-items: center; justify-content: center; }
.lwy-nav { display: grid; gap: 6px; flex: none; min-width: 0; }
.lwy-nav button { position: relative; display: flex; align-items: center; gap: 9px; min-height: 44px; width: 100%; border: 0; border-radius: 6px;
  padding: 10px; background: transparent; text-align: left; color: var(--hint); font: inherit; font-size: 13px;
  line-height: 1.5; cursor: pointer; overflow-wrap: anywhere; transition: color 160ms ease, background 160ms ease; }
.lwy-nav button.on { background: var(--accent-soft); color: var(--accent-strong); font-weight: 600; }
.lwy-nav button.on::before { content: ""; position: absolute; left: 0; top: 12px; bottom: 12px;
  width: 3px; background: var(--accent-strong); border-radius: 2px; }
.lwy button:focus-visible, .lwy select:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 3px; }
.lwy-sidebar-foot { display: grid; gap: 6px; margin-top: auto; padding: 16px 6px 0;
  border-top: 1px solid var(--line); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.lwy-sidebar-foot strong { font-weight: 600; }
.lwy-workspace { min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto; padding: 28px 32px 96px;
  scrollbar-gutter: stable; }
.lwy-workspace:focus-visible { outline: 2px solid var(--accent-line); outline-offset: -3px; }
.lwy-head { display: flex; justify-content: space-between; align-items: center; gap: 16px;
  flex-wrap: wrap; padding-bottom: 24px; margin-bottom: 24px; border-bottom: 1px solid var(--line); }
.lwy-head-text { display: grid; gap: 5px; min-width: 0; }
.lwy-title { margin: 0; font-size: 24px; line-height: 1.4; font-weight: 700; color: var(--ink); overflow-wrap: anywhere; }
.lwy-sub { color: var(--hint); font-size: 12px; line-height: 1.6; }
.lwy-scope { display: grid; gap: 6px; max-width: 100%; min-width: 0; }
.lwy-scope select { max-width: 100%; width: 180px; min-height: 38px; padding: 6px 10px; border: 1px solid var(--line);
  border-radius: 6px; background: var(--card); color: var(--ink); font: inherit; font-size: 13px; }
.lwy-notices { display: grid; gap: 12px; margin-bottom: 20px; }
.lwy-page-layout { --art-width: clamp(72px, calc(26vw - 28px), 220px);
  display: grid; grid-template-columns: minmax(0, 1fr); column-gap: 28px; align-items: start;
  max-width: 960px; margin: 0 auto; }
.lwy-page-layout.has-art { grid-template-columns: minmax(0, 1fr) var(--art-width); }
.lwy-page-layout.is-overview { align-content: start; }
.lwy-page-content { min-width: 0; }
.lwy-page { min-width: 0; }
.lwy-art { display: flex; justify-content: flex-end; align-items: flex-start;
  min-width: 0; width: var(--art-width); height: clamp(124px, 40vw, 360px); pointer-events: none; }
.lwy-art img { display: block; width: 100%; height: 100%; object-fit: contain; object-position: right top;
  filter: drop-shadow(0 6px 12px rgba(0, 0, 0, 0.06)); animation: lwy-fade 300ms ease-out; }
.lwy-sections { display: grid; min-width: 0; gap: 24px; }
.lwy-card { min-width: 0; padding: 0 0 24px; border-bottom: 1px solid var(--line); }
.lwy-card:last-child { border-bottom: 0; }
.lwy-card-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.lwy-card-head .lwy-h { margin: 0; }
.lwy-hero { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; padding: 12px 0 8px; }
.lwy-ring { --p: 0; width: 148px; height: 148px; flex: none; position: relative; }
.lwy-ring-fill { position: absolute; inset: 0; border-radius: 50%;
  background: conic-gradient(var(--accent) calc(var(--p) * 1%), var(--accent-soft) 0);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 8px), #000 calc(100% - 7px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 8px), #000 calc(100% - 7px)); }
.lwy-ring-in { position: absolute; inset: 0; display: grid; place-items: center; align-content: center; gap: 2px; }
.lwy-num { font-size: 38px; font-weight: 700; line-height: 1; color: var(--ink); font-variant-numeric: tabular-nums; }
.lwy-heart { color: var(--accent); font-size: 14px; animation: lwy-beat 1.6s ease-in-out infinite; }
.lwy-stage { display: grid; gap: 8px; min-width: 0; flex: 1 1 150px; overflow-wrap: anywhere; }
.lwy-stage-name { font-size: 26px; font-weight: 700; color: var(--accent-strong); }
.lwy-hint { color: var(--hint); font-size: 13px; line-height: 1.6; }
.lwy-nick { color: var(--ink); font-size: 13px; }
.lwy-nick b { color: var(--accent-strong); font-weight: 600; }
.lwy-banner { display: flex; gap: 8px; align-items: center; margin-top: 20px; padding: 10px 14px; border-radius: 6px;
  background: var(--accent-soft); color: var(--accent-strong); font-size: 13px; font-weight: 600; }
.lwy-track { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); position: relative; margin-top: 20px; }
.lwy-track::before { content: ""; position: absolute; left: 10%; right: 10%; top: 6px; height: 2px; background: var(--line); }
.lwy-step { display: grid; justify-items: center; gap: 6px; position: relative; min-width: 0; font-size: 12px; color: var(--hint); }
.lwy-step span { max-width: 100%; overflow-wrap: anywhere; text-align: center; }
.lwy-step i { width: 14px; height: 14px; border-radius: 50%; background: var(--bg); border: 2px solid var(--line); }
.lwy-step.done i { background: var(--accent); border-color: var(--accent); }
.lwy-step.now i { box-shadow: 0 0 0 4px var(--accent-soft); }
.lwy-step.now { color: var(--accent-strong); font-weight: 600; }
.lwy-today { display: flex; gap: 18px; flex-wrap: wrap; font-size: 12px; color: var(--hint); margin-top: 24px; }
.lwy-today b { color: var(--ink); font-weight: 600; }
.lwy-h { margin: 0 0 16px; font-size: 15px; font-weight: 600; color: var(--ink); overflow-wrap: anywhere; }
.lwy-list { display: grid; gap: 2px; }
.lwy-row { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; gap: 10px; align-items: baseline; padding: 12px 0;
  border-bottom: 1px dashed var(--line); font-size: 13px; }
.lwy-row:last-child, .lwy-ev:last-child { border-bottom: none; }
.lwy-d { font-weight: 700; font-variant-numeric: tabular-nums; }
.lwy-d.up { color: var(--gain); } .lwy-d.down { color: var(--loss); } .lwy-d.zero { color: var(--hint); }
.lwy-why { color: var(--ink); overflow-wrap: anywhere; line-height: 1.6; }
.lwy-when { color: var(--hint); font-size: 12px; white-space: nowrap; }
.lwy-empty { color: var(--hint); font-size: 14px; line-height: 1.8; padding: 16px 0; margin: 0; }
.lwy-days { display: flex; gap: 32px; flex-wrap: wrap; align-items: flex-end; }
.lwy-days-item { display: grid; gap: 4px; }
.lwy-days-num { font-size: 34px; font-weight: 700; line-height: 1; color: var(--accent-strong); font-variant-numeric: tabular-nums; }
.lwy-days-num small { font-size: 13px; font-weight: 500; color: var(--hint); margin-left: 4px; }
.lwy-marks { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.lwy-mark { display: inline-flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 4px; flex-wrap: wrap;
  background: var(--accent-soft); font-size: 12px; color: var(--hint); }
.lwy-mark b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
.lwy-ev { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 12px; align-items: center; padding: 8px 2px;
  border-bottom: 1px dashed var(--line); font-size: 13px; }
.lwy-ev-name { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lwy-ev-date { color: var(--hint); font-size: 12px; font-variant-numeric: tabular-nums; }
.lwy-cd { color: var(--accent-strong); font-weight: 600; font-size: 12px; font-variant-numeric: tabular-nums; }
.lwy-x { display: grid; place-items: center; width: 36px; height: 36px; border: 0; background: transparent; color: var(--hint);
  cursor: pointer; padding: 6px; border-radius: 6px; }
.lwy-set { display: grid; gap: 20px; }
.lwy-set-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.lwy-import-dates { display: grid; gap: 16px; margin: 20px 0; }
.lwy-import-dates dt { color: var(--hint); font-size: 12px; margin-bottom: 5px; }
.lwy-import-dates dd { margin: 0; overflow-wrap: anywhere; }
.lwy-met-options { border: 0; padding: 0; margin: 0 0 20px; min-width: 0; }
.lwy-met-options legend { font-size: 12px; color: var(--hint); margin-bottom: 10px; }
.lwy-met-option { display: flex; align-items: center; gap: 10px; padding: 8px 0; cursor: pointer; }
.lwy-met-option input { flex: 0 0 auto; width: 16px; height: 16px; margin: 0; accent-color: var(--accent-strong); }
.lwy-met-option span { display: grid; gap: 3px; min-width: 0; overflow-wrap: anywhere; }
.lwy-met-option small { color: var(--hint); font-size: 12px; }
.lwy-met-option:has(input:disabled) { opacity: 0.55; cursor: default; }
.lwy-met-options + .lwy-note { margin-bottom: 16px; }
.lwy-nick-grid { display: grid; gap: 18px; }
.lwy-nick-row { display: grid; grid-template-columns: 72px minmax(0, 1fr) 38px; gap: 12px; align-items: center; }
.lwy-nick-row .neko-input { width: 100%; }
.lwy-nick-grid label { display: contents; }
.lwy-nick-grid label span { font-size: 13px; color: var(--hint); overflow-wrap: anywhere; }
.lwy-field { display: grid; gap: 6px; margin-bottom: 12px; font-size: 13px; color: var(--hint); }
.lwy-note { color: var(--hint); font-size: 13px; line-height: 1.8; margin: 0; max-width: 68ch; }
.lwy-btns { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.lwy-adjust-number .neko-input { font-size: 28px; font-weight: 700; text-align: center; color: var(--accent-strong); }
.lwy-unsaved { color: var(--accent-strong); font-size: 12px; }
.lwy-notice-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.lwy-notice-row .neko-alert { flex: 1 1 180px; }
.lwy-feedback { display: flex; gap: 10px; align-items: center; min-width: 0; padding: 12px 14px;
  border: 1px solid var(--border); border-left: 3px solid var(--accent-strong); border-radius: 6px;
  background: var(--surface-strong); color: var(--text); font-size: 13px; line-height: 1.7; }
.lwy-feedback-message { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.lwy-feedback[data-tone="success"] { border-left-color: var(--gain); }
.lwy-feedback[data-tone="danger"] { border-left-color: var(--danger); }
.lwy-feedback[data-tone="warning"] { border-left-color: var(--warning); }
.lwy-feedback[data-tone="success"] > .lwy-icon { color: var(--gain); }
.lwy-feedback-close { border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 12px;
  flex: none; min-height: 36px; padding: 4px 6px; cursor: pointer; }
.lwy-feedback-close:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
.lwy-feedback-dock { position: fixed; bottom: 16px; right: 24px; left: calc(var(--sidebar-width) + 24px);
  width: max-content; max-width: min(560px, calc(100% - var(--sidebar-width) - 48px)); margin-left: auto; z-index: 60;
  box-shadow: 0 4px 20px rgba(0, 0, 0, .08); }
.lwy-feedback-slot { display: contents; }
.sidebar-collapsed .lwy-feedback-dock { left: 80px; max-width: min(560px, calc(100% - 104px)); }
.lwy-spinning { display: inline-flex; animation: lwy-spin 1s linear infinite; flex: none; }
.lwy-savebar { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;
  padding: 16px 0 0; margin-top: 8px; border-top: 1px solid var(--line); }
.lwy-save-state { color: var(--hint); font-size: 12px; display: inline-flex; align-items: center; gap: 6px; }
.lwy-save-state.dirty { color: var(--accent-strong); }
.lwy-settings-nav { display: flex; gap: 4px; flex-wrap: wrap; padding: 8px 0 12px; border-bottom: 1px solid var(--line);
  position: sticky; top: -1px; z-index: 4; background: var(--bg); }
.lwy-settings-nav button { border: 0; border-radius: 5px; padding: 8px 12px; min-height: 40px;
  background: var(--accent-soft); color: var(--accent-strong); font: inherit; font-size: 13px; cursor: pointer; }
.lwy-settings-section { scroll-margin-top: 120px; }
.lwy-rule { padding-bottom: 18px; border-bottom: 1px solid var(--line); }
.lwy-rule:last-child { padding-bottom: 0; border-bottom: 0; }
.lwy-rule .neko-switch { display: flex; flex-direction: row-reverse; justify-content: space-between; width: 100%; gap: 20px; font-weight: 600; }
.lwy-details { color: var(--hint); font-size: 13px; }
.lwy-details summary { cursor: pointer; width: fit-content; padding: 4px 0; color: var(--accent-strong); }
.lwy-details summary:focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
.lwy-details .lwy-note { margin-top: 6px; }
.lwy-recent { grid-column: 1 / -1; margin-top: 24px; padding-top: 22px; border-top: 1px solid var(--line); min-width: 0; }
.lwy-recent .lwy-card-head { margin-bottom: 6px; }
.lwy-text-button { display: inline-flex; align-items: center; gap: 4px; border: 0; background: transparent;
  color: var(--accent-strong); padding: 6px 0; min-height: 36px; font: inherit; font-size: 13px; cursor: pointer; }
.lwy-counter { color: var(--hint); font-size: 11px; font-variant-numeric: tabular-nums; flex: none; }
.lwy-adjust-preview { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; color: var(--accent-strong);
  font-size: 14px; margin: 16px 0; }
.lwy-portrait-preview { display: flex; align-items: center; gap: 12px; min-width: 0; }
.lwy-portrait-preview img { width: 52px; height: 72px; object-fit: contain; flex: none; }
.lwy-portrait-preview span { overflow-wrap: anywhere; }
.lwy-today .gain b { color: var(--gain); }
.lwy-today .loss b { color: var(--loss); }
.lwy-wait { color: var(--accent-strong); font-size: 13px; font-weight: 600; }
.lwy-range { display: inline-flex; gap: 4px; flex-wrap: wrap; }
.lwy-range button { border: 1px solid var(--line); background: transparent; color: var(--hint); border-radius: 4px;
  padding: 5px 9px; min-height: 30px; font-size: 12px; cursor: pointer; }
.lwy-range button.on { background: var(--accent-soft); border-color: transparent; color: var(--accent-strong); font-weight: 600; }
.lwy-plot { --axis: 44px; display: grid; grid-template-columns: var(--axis) minmax(0, 1fr); gap: 8px; }
.lwy-axis { position: relative; font-size: 10px; color: var(--hint); }
.lwy-axis span { position: absolute; right: 0; transform: translateY(50%); line-height: 1; white-space: nowrap; }
.lwy-chart { position: relative; height: 140px; display: flex; align-items: flex-end; gap: 2px;
  border-bottom: 1px solid var(--line); }
.lwy-chart.dense { gap: 0; }
.lwy-bar { flex: 1 1 0; min-width: 0; border-radius: 3px 3px 0 0; opacity: 0.85; transition: opacity 120ms ease;
  background: var(--accent); }
.lwy-chart.dense .lwy-bar { border-radius: 0; }
.lwy-bar:hover { opacity: 1; }
.lwy-bar.empty { background: transparent; }
.lwy-line { position: absolute; left: 0; right: 0; height: 0; border-top: 1px dashed var(--line); pointer-events: none; z-index: 1; }
.lwy-chart-foot { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-top: 8px;
  padding-left: calc(var(--axis, 44px) + 8px); font-size: 11px; color: var(--hint); }
.lwy-quote { margin: 14px 0 0; padding: 10px 12px; border-left: 2px solid var(--accent); border-radius: 0 4px 4px 0;
  background: var(--accent-soft); color: var(--ink); font-size: 13px; line-height: 1.6; }
.lwy-rule { display: grid; gap: 6px; }
.lwy-rule .lwy-note { padding-left: 0; padding-right: 48px; }
.lwy-rule .lwy-status { color: var(--accent-strong); }
.lwy-rule .lwy-status.warning { color: var(--text); border-left: 2px solid var(--warning); }
.is-overview .lwy-card { padding-bottom: 0; }
.lwy-overview-footer { grid-column: 1 / -1; display: grid; grid-template-columns: inherit; column-gap: inherit;
  min-width: 0; margin-top: 24px; padding: 28px 0 26px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.lwy-summary { grid-column: 1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; min-width: 0;
  align-items: start; }
.lwy-summary-item { display: grid; gap: 8px; min-width: 0; }
.lwy-summary-value { color: var(--ink); font-size: 20px; line-height: 1.5; font-weight: 600; overflow-wrap: anywhere; }
.lwy-portrait-settings { display: grid; gap: 14px; }
.lwy-segmented { display: flex; gap: 4px; flex-wrap: wrap; }
.lwy-segmented button { border: 1px solid var(--line); border-radius: 5px; background: transparent;
  color: var(--hint); padding: 7px 12px; font: inherit; font-size: 13px; cursor: pointer; }
.lwy-segmented button[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent-line); color: var(--accent-strong); }
.lwy-segmented button:disabled { opacity: 0.5; cursor: not-allowed; }
.lwy-appearance { display: grid; gap: 18px; }
.lwy-appearance .lwy-card-head { margin-bottom: 0; }
.lwy-palette { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; max-width: 540px; }
.lwy-color-choice { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 44px; padding: 8px 10px;
  border: 1px solid var(--line); border-radius: 6px; background: var(--card); color: var(--ink); font: inherit; font-size: 13px; cursor: pointer; }
.lwy-color-choice > span:not(.lwy-swatch):not(.lwy-icon) { flex: 1; min-width: 0; overflow-wrap: anywhere; text-align: left; }
.lwy-color-choice[aria-pressed="true"] { border-color: var(--accent-strong); background: var(--accent-soft); }
.lwy-color-choice:disabled { opacity: .5; cursor: not-allowed; }
.lwy-color-choice .lwy-icon { width: 16px; height: 16px; color: var(--accent-strong); }
.lwy-swatch { width: 22px; height: 22px; flex: none; border-radius: 50%; border: 1px solid rgba(0, 0, 0, .15); }
.lwy-theme-fields { display: flex; gap: 16px 24px; align-items: start; flex-wrap: wrap; }
.lwy-theme-fields .lwy-field { margin: 0; min-width: 0; }
.lwy-custom-color { display: flex; align-items: center; gap: 8px; }
.lwy-custom-color input[type="color"] { width: 40px; height: 36px; padding: 3px; border: 1px solid var(--line);
  border-radius: 5px; background: var(--card); cursor: pointer; flex: none; }
.lwy-custom-color .neko-input { width: 116px; font-family: ui-monospace, monospace; }
.lwy-field-error { color: var(--danger); font-size: 12px; }
.lwy-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap; border: 0; }
@media (max-width: 480px) { .lwy-palette { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.lwy-gallery { display: grid; gap: 16px; min-width: 0; letter-spacing: 0; color: var(--text); }
.lwy-gallery-modal .neko-modal { background: var(--bg); border-radius: 8px; max-height: calc(100dvh - 40px);
  display: flex; flex-direction: column; }
.lwy-gallery-modal .neko-modal-body { min-height: 0; }
.lwy-gallery-modal .neko-modal-header, .lwy-gallery-modal .neko-modal-footer { flex: none; }
.lwy-gallery * { box-sizing: border-box; }
.lwy-gallery-filters { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.lwy-gallery-filters label { display: grid; gap: 5px; min-width: 0; color: var(--muted); font-size: 12px; }
.lwy-gallery-filters input, .lwy-gallery-filters select { width: 100%; min-width: 0; }
.lwy-gallery-tools, .lwy-gallery-pager { display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 10px; min-height: 32px; }
.lwy-gallery-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.lwy-portrait-tile { display: grid; align-content: start; gap: 6px; min-width: 0; }
.lwy-portrait-tile > .lwy-icon-button { justify-self: end; }
.lwy-portrait-name small { display: block; color: var(--muted); font-weight: 400; }
.lwy-portrait-choice { --thumb-height: 164px; display: grid; grid-template-rows: var(--thumb-height) auto; position: relative; min-width: 0;
  margin: 0; border: 1px solid var(--border); border-radius: 6px; padding: 8px;
  background: var(--surface); color: var(--text); text-align: left; font: inherit; cursor: pointer; }
.lwy-portrait-choice.chosen { border-color: var(--accent-strong); background: var(--accent-soft); }
.lwy-portrait-choice:focus-visible, .lwy-portrait-choice:focus-within { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
.lwy-portrait-choice input { position: absolute; top: 8px; right: 8px; z-index: 1; accent-color: var(--accent-strong); }
.lwy-portrait-thumb { position: relative; width: 100%; height: var(--thumb-height); display: grid; place-items: center;
  overflow: hidden; color: var(--muted); font-size: 12px; }
.lwy-portrait-thumb img { position: absolute; inset: 0; display: block; width: 100%; height: var(--thumb-height);
  min-height: 0; max-height: var(--thumb-height); object-fit: contain; object-position: center; }
.lwy-portrait-name { padding-top: 8px; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.lwy-gallery-state { display: grid; place-items: center; min-height: 164px; color: var(--muted); font-size: 13px; }
.lwy-icon-button { width: 32px; height: 32px; display: grid; place-items: center; padding: 0;
  border: 1px solid var(--border); border-radius: 5px; background: var(--surface); color: var(--text);
  font-size: 18px; cursor: pointer; }
.lwy-icon-button:disabled { opacity: 0.4; cursor: not-allowed; }
@media (max-width: 700px) { .lwy-gallery-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 480px) {
  .lwy-gallery-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .lwy-portrait-choice { --thumb-height: 140px; }
  .lwy-gallery-filters { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 960px) {
  .lwy { --sidebar-width: 148px; }
  .lwy-sidebar { padding: 24px 12px 16px; }
  .lwy-workspace { padding: 24px 24px 96px; }
  .lwy-page-layout { column-gap: 20px; }
}
@media (max-width: 899px) {
  .lwy-workspace { padding: 20px 20px 120px; }
  .lwy-head { margin-bottom: 20px; padding-bottom: 20px; gap: 12px; }
  .lwy-title { font-size: 21px; }
  .lwy-sidebar-foot { padding: 12px 6px 0; }
}
@media (max-width: 480px) {
  .lwy-page-layout.has-art { column-gap: 14px; }
  .lwy-page-layout.has-art .lwy-page-content { display: contents; }
  .has-art .lwy-head { grid-column: 1; grid-row: 1; align-self: start; margin-bottom: 20px;
    flex-direction: column; align-items: flex-start; }
  .lwy-art { grid-column: 2; grid-row: 1; justify-self: end; margin-bottom: 20px; }
  .lwy-page-layout.has-art .lwy-notices { grid-column: 1 / -1; grid-row: 2; }
  .lwy-page-layout.has-art .lwy-page { grid-column: 1 / -1; grid-row: 3; }
  .lwy-overview-footer { display: block; padding: 22px 0; }
  .has-art .lwy-overview-footer { grid-row: 4; }
  .has-art .lwy-recent { grid-row: 5; }
}
@media (max-width: 700px) {
  .lwy, .lwy.sidebar-collapsed { grid-template-columns: 56px minmax(0, 1fr); }
  .lwy .lwy-sidebar { gap: 20px; padding: 20px 6px 16px; }
  .lwy-sidebar-head { justify-content: center; }
  .lwy-brand, .lwy-sidebar-toggle, .lwy-nav-label, .lwy-sidebar-foot { display: none; }
  .lwy-brand-mark { display: flex; }
  .lwy-nav button { justify-content: center; padding: 10px 4px; }
  .lwy-workspace { padding: 20px 16px 160px; }
  .lwy .lwy-feedback-dock { left: 68px; right: 12px; max-width: calc(100% - 80px); bottom: 12px; }
}
@media (max-width: 480px) {
  .lwy-workspace { padding: 18px 14px 160px; }
  .lwy-summary { gap: 16px; }
  .lwy-summary-value { font-size: 16px; }
  .lwy-hero { gap: 16px; }
  .lwy-ring { width: 120px; height: 120px; }
  .lwy-num { font-size: 32px; }
  .lwy-stage-name { font-size: 22px; }
  .lwy-rule .lwy-note { padding-left: 0; padding-right: 0; }
  .lwy-row { grid-template-columns: 30px minmax(0, 1fr); gap: 4px 8px; }
  .lwy-when { grid-column: 2; }
  .lwy-ev { grid-template-columns: minmax(0, 1fr) auto; gap: 6px; }
  .lwy-ev-name { grid-column: 1 / -1; white-space: normal; overflow-wrap: anywhere; }
  .lwy-nick-row { grid-template-columns: minmax(0, 1fr) 30px; gap: 8px; }
  .lwy-nick-row label > span { grid-column: 1 / -1; }
  .lwy-scope { width: 100%; }
  .lwy-scope select { width: 100%; }
  .lwy-page-layout.has-art { column-gap: 10px; }
}
@media (max-width: 359px) {
  .lwy-summary { grid-template-columns: minmax(0, 1fr); }
}
@media (max-height: 480px) {
  .lwy .lwy-sidebar { gap: 12px; padding-top: 12px; padding-bottom: 12px; }
  .lwy-sidebar-body { gap: 12px; }
  .lwy-nav { gap: 4px; }
  .lwy-nav button { min-height: 40px; padding-top: 7px; padding-bottom: 7px; }
}
@media (max-height: 360px) {
  .lwy .lwy-sidebar { gap: 8px; padding-top: 8px; padding-bottom: 8px; }
  .lwy-nav { gap: 2px; }
  .lwy-nav button { min-height: 36px; padding-top: 5px; padding-bottom: 5px; }
}
@keyframes lwy-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes lwy-beat { 0%, 100% { transform: scale(1); } 15% { transform: scale(1.25); } 30% { transform: scale(1); } }
@keyframes lwy-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .lwy-heart, .lwy-art img, .lwy-spinning { animation: none; } }
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
  const y = Number(match[1]), m = Number(match[2]), d = Number(match[3])
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() + 1 === m && date.getUTCDate() === d ? { y, m, d } : null
}

function shiftIso(iso: string, days: number): string {
  const parsed = parseIsoDay(iso)
  if (!parsed) return iso
  const shifted = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d + days))
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(shifted.getUTCDate()).padStart(2, "0")
  return `${shifted.getUTCFullYear()}-${mm}-${dd}`
}

function rememberImage(cache: Record<string, string>, key: string, url: string, limit: number) {
  delete cache[key]
  cache[key] = url
  while (Object.keys(cache).length > limit) delete cache[Object.keys(cache)[0]]
}

function PortraitThumb(props: {
  item: Portrait; api: PluginSurfaceProps["api"]; cache: Record<string, string>; loading: string; failed: string
}) {
  const [url, setUrl] = useState("")
  const [failed, setFailed] = useState(false)
  const container = useRef<HTMLElement | null>(null)
  useEffect(() => {
    let alive = true
    let observer: IntersectionObserver | null = null
    setUrl("")
    setFailed(false)
    const key = props.item.version
    async function load() {
      observer?.disconnect()
      try {
        let image = props.cache[key]
        if (!image) {
          const res = unwrap(await props.api.call("get_portrait", { item_id: props.item.id, thumbnail: true }), "available")
          if (!res.available || typeof res.data_url !== "string") throw new Error("missing image")
          image = res.data_url
          rememberImage(props.cache, key, image, 32)
        }
        if (alive) setUrl(image)
      } catch { if (alive) setFailed(true) }
    }
    if (typeof IntersectionObserver === "function" && container.current) {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) void load()
      }, { rootMargin: "100px" })
      observer.observe(container.current)
    } else { void load() }
    return () => { alive = false; observer?.disconnect() }
  }, [props.item.id, props.item.version])
  return (
    <span className="lwy-portrait-thumb" ref={container}>
      {url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} /> : failed ? props.failed : props.loading}
    </span>
  )
}

export default function LoveWithYouPanel(props: PluginSurfaceProps<Dashboard>) {
  useQuietScrollbars()
  const { t, api } = props
  const state = props.state || {}
  const scopes = Array.isArray(state.scopes) ? state.scopes : []
  const stages = Array.isArray(state.stages) && state.stages.length ? state.stages : []
  const limits = state.limits || { per_call: 5, daily_gain: 8, daily_chat: 4, daily_loss: 4 }
  const anniversaries = Array.isArray(state.anniversaries) ? state.anniversaries : []
  const maxAnniversaries = limits.anniversaries || 20
  const storedAppearance = normalizeAppearance(state.appearance)
  const storedAppearanceKey = JSON.stringify(storedAppearance)
  const toast = useToast()
  const confirm = useConfirm()

  const [section, setSection] = props.useLocalState<Section>("lwy:section", "heart")
  const [sidebarCollapsed, setSidebarCollapsed] = props.useLocalState<boolean>("lwy:sidebar-collapsed", true)
  const [selectedKey, setSelectedKey] = props.useLocalState<string>("lwy:scope", "")
  const [art, setArt] = useState<string>("")
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const feedbackTrigger = useRef<HTMLElement | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const beginPending = useInteractionFeedback()
  useEffect(() => {
    if (feedback?.tone !== "success") return
    let remaining = Math.min(12000, Math.max(6000, Array.from(feedback.message).length * 70))
    let started = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let exitTimer: ReturnType<typeof setTimeout> | undefined
    let exiting: HTMLElement | null = null
    const schedule = () => {
      const panel = document.querySelector<HTMLElement>(".lwy-feedback")
      const reading = panel?.contains(document.activeElement) ||
        (document.documentElement.dataset.lwyPointer === "pointer" && panel?.matches(":hover"))
      if (exitTimer !== undefined) {
        if (!document.hidden && !reading) return
        clearTimeout(exitTimer); exitTimer = undefined
        exiting?.removeAttribute("data-lwy-dismissing")
        remaining = 2000
      }
      if (timer !== undefined) { remaining -= Date.now() - started; clearTimeout(timer); timer = undefined }
      if (document.hidden || reading) return
      started = Date.now()
      timer = setTimeout(() => {
        timer = undefined
        remaining = 0
        const dismiss = () => setFeedback(current => current === feedback ? null : current)
        exiting = document.querySelector<HTMLElement>(".lwy-feedback")
        if (exiting && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
          exiting.setAttribute("data-lwy-dismissing", "")
          exitTimer = setTimeout(dismiss, 140)
        } else dismiss()
      }, Math.max(0, remaining))
    }
    document.addEventListener("pointerover", schedule)
    document.addEventListener("pointerout", schedule)
    document.addEventListener("focusin", schedule)
    document.addEventListener("focusout", schedule)
    document.addEventListener("visibilitychange", schedule)
    schedule()
    return () => {
      clearTimeout(timer)
      clearTimeout(exitTimer)
      exiting?.removeAttribute("data-lwy-dismissing")
      document.removeEventListener("pointerover", schedule)
      document.removeEventListener("pointerout", schedule)
      document.removeEventListener("focusin", schedule)
      document.removeEventListener("focusout", schedule)
      document.removeEventListener("visibilitychange", schedule)
    }
  }, [feedback])
  const [refreshError, setRefreshError] = useState(false)
  const [themeEdit, setThemeEdit] = useState<{ values: Appearance; base: Appearance } | null>(null)
  const liveAppearance = themeEdit?.values || storedAppearance
  const themeDirty = JSON.stringify(liveAppearance) !== JSON.stringify(themeEdit?.base || storedAppearance)
  const [colorInput, setColorInput] = useState(storedAppearance.accent_color)
  const colorInvalid = colorInput.length !== 7 || !/^#[0-9a-f]{6}$/i.test(colorInput)
  useEffect(() => {
    setThemeEdit(previous => previous && JSON.stringify(previous.values) !== JSON.stringify(previous.base) ? previous : null)
  }, [storedAppearanceKey])
  useEffect(() => { setColorInput(liveAppearance.accent_color) }, [liveAppearance.accent_color])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<number | "">(0)
  const [dialogScope, setDialogScope] = useState("")
  const [nickDrafts, setNickDrafts] = useState<Record<string, { values: Record<string, string>; base: Record<string, string> }>>({})
  const [metOpen, setMetOpen] = useState(false)
  const [metDraft, setMetDraft] = useState("")
  const [metCustomDraft, setMetCustomDraft] = useState("")
  const [metSource, setMetSource] = useState<"plugin" | "host" | "custom">("custom")
  const [metPrevious, setMetPrevious] = useState("")
  const [metOptions, setMetOptions] = useState({ plugin: "", legacy: false, host: "" })
  const [metImportOpen, setMetImportOpen] = useState(false)
  const [metImport, setMetImport] = useState<FirstMetImport | null>(null)
  const [annOpen, setAnnOpen] = useState(false)
  const [annTitle, setAnnTitle] = useState("")
  const [annDate, setAnnDate] = useState("")
  const [shopDialog, setShopDialog] = useState(false)
  const [trendRange, setTrendRange] = props.useLocalState<number>("lwy:trend", 30)
  const artCache = useRef<Record<string, string>>({})
  const thumbCache = useRef<Record<string, string>>({})
  const portraitRequest = useRef(0)
  const [portrait, setPortrait] = useState<Portrait | null>(null)
  const [artError, setArtError] = useState("")
  const [artLoading, setArtLoading] = useState(false)
  const [artChoosing, setArtChoosing] = useState(false)
  const [artRetry, setArtRetry] = useState(0)
  const [gallery, setGallery] = useState<"fixed" | "pool" | "">("")
  const [galleryPage, setGalleryPage] = useState(0)
  const [galleryCollection, setGalleryCollection] = useState("")
  const [gallerySearch, setGallerySearch] = useState("")
  const [galleryData, setGalleryData] = useState<PortraitPage | null>(null)
  const [galleryError, setGalleryError] = useState("")
  const [galleryLoading, setGalleryLoading] = useState(false)
  const [galleryRetry, setGalleryRetry] = useState(0)
  const [chosenId, setChosenId] = useState("")
  const [poolDraft, setPoolDraft] = useState<string[] | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [customEdit, setCustomEdit] = useState<Portrait | null>(null)
  const [customName, setCustomName] = useState("")
  const [customGame, setCustomGame] = useState("")
  const [deleteCustom, setDeleteCustom] = useState(false)
  // Stable callbacks keep the host modal from refocusing on every keystroke.
  const closeGallery = useCallback(() => { if (!busyRef.current) { setGallery(""); setCustomEdit(null); setFeedback(null) } }, [])
  const closePortraitImport = useCallback(() => setImportOpen(false), [])
  const closeEditing = useCallback(() => { if (!busyRef.current) { setEditing(false); setFeedback(null) } }, [])
  const closeMet = useCallback(() => { if (!busyRef.current) { setMetOpen(false); setFeedback(null) } }, [])
  const closeMetImport = useCallback(() => { if (!busyRef.current) { setMetImportOpen(false); setFeedback(null) } }, [])
  const closeAnn = useCallback(() => { if (!busyRef.current) { setAnnOpen(false); setFeedback(null) } }, [])
  const workspaceRef = useRef<HTMLElement | null>(null)
  const dialogOpen = Boolean(gallery || importOpen || editing || metOpen || metImportOpen || annOpen || shopDialog)
  const onShopDialog = useCallback((open: boolean) => setShopDialog(open), [])
  useEffect(() => {
    if (!dialogOpen) return
    const trigger = document.activeElement as HTMLElement | null
    return () => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }) }
  }, [dialogOpen])

  const fallback = scopes.find((s) => s.is_current) || scopes[0]
  const scope = scopes.find((s) => s.key === selectedKey) || fallback
  const activeSection: Section = SECTIONS.includes(section) ? section : "heart"
  useEffect(() => {
    if (scope && selectedKey !== scope.key) setSelectedKey(scope.key)
  }, [scope?.key, selectedKey])

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
    const code = [...ERROR_CODES].sort((a, b) => b.length - a.length).find((item) => raw.includes(item))
    return code ? t(`error.${code}`, { defaultValue: raw }) : t("feedback.failed", { defaultValue: "操作未完成，请稍后重试。" })
  }

  function renderFeedback(inDialog = false) {
    if (!feedback) return null
    return (
      <div className={inDialog ? "lwy-feedback" : "lwy-feedback lwy-feedback-dock"} data-tone={feedback.tone}>
        {feedback.tone === "pending"
          ? <span className="lwy-spinning"><Icon name="RotateCw" /></span>
          : feedback.tone === "success" ? <Icon name="Check" /> : null}
        <span className="lwy-feedback-message" role={feedback.tone === "danger" ? "alert" : "status"}
          aria-live={feedback.tone === "danger" ? "assertive" : "polite"} aria-atomic="true">{feedback.message}</span>
        {!inDialog && refreshError && feedback.tone !== "pending" ? <button type="button" className="lwy-feedback-close"
          onClick={refreshPanel}>{t("common.refresh", { defaultValue: "刷新" })}</button> : null}
        {feedback.tone !== "pending" ? <button type="button" className="lwy-feedback-close"
          onClick={() => {
            setFeedback(null)
            if (feedbackTrigger.current?.isConnected) feedbackTrigger.current.focus({ preventScroll: true })
          }}>{t("common.dismiss", { defaultValue: "关闭提示" })}</button> : null}
      </div>
    )
  }

  function saveLabel(action: string, label = t("common.save", { defaultValue: "保存" })) {
    const pending = busy && feedback?.action === action
    return <><span className={pending ? "lwy-button-icon lwy-spinning" : "lwy-button-icon"}><Icon name={pending ? "RotateCw" : "Save"} /></span>
      <span className="lwy-action-label">
        <span aria-hidden={pending ? "true" : undefined}>{label}</span>
        <span aria-hidden={pending ? undefined : "true"}>{t("common.saving", { defaultValue: "保存中…" })}</span>
      </span></>
  }

  // Gallery choices are global; only explicit legacy mode follows relationship stages.
  const library = state.portraits
  const portraitPrefs: PortraitPrefs = library?.settings || { mode: "legacy", selected_id: "", pool_ids: null }
  const portraitMode = portraitPrefs.mode
  const prefsKey = JSON.stringify(portraitPrefs) + (library?.revision || "")
  const decoration = state.decoration || {}
  const stageArt = scope && decoration.stages ? decoration.stages[scope.stage] : undefined
  const legacyVersion =
    stageArt && stageArt.available
      ? stageArt.version || ""
      : decoration.default && decoration.default.available
        ? decoration.default.version || ""
        : ""
  const artStage = scope ? scope.stage : ""
  useEffect(() => {
    const request = ++portraitRequest.current
    if (!library || portraitMode === "legacy" || portraitMode === "off") {
      setPortrait(null)
      setArtError("")
      setArtChoosing(false)
      return
    }
    let alive = true
    setArtChoosing(true)
    setArtError("")
    api.call("choose_portrait", {}).then((res: any) => {
      const item = unwrap(res, "available")
      if (alive && request === portraitRequest.current) setPortrait(item.available ? item as Portrait : null)
    }).catch((error: any) => { if (alive && request === portraitRequest.current) { setPortrait(null); setArtError(errorText(error)) } })
      .finally(() => { if (alive && request === portraitRequest.current) setArtChoosing(false) })
    return () => { alive = false }
  }, [prefsKey, artRetry])
  const artVersion = portraitMode === "legacy" ? legacyVersion : portrait?.version || ""
  function handleArtError() {
    delete artCache.current[artVersion]
    setArt("")
    setArtError(t("art.imageError", { defaultValue: "图片加载失败，请重试。" }))
  }
  useEffect(() => {
    if (portraitMode === "off" || !artVersion) {
      setArt("")
      setArtLoading(false)
      return
    }
    const cached = artCache.current[artVersion]
    if (cached) {
      setArt(cached)
      setArtError("")
      setArtLoading(false)
      return
    }
    let alive = true
    setArt("")
    setArtError("")
    setArtLoading(true)
    const request = portraitMode === "legacy"
      ? api.call("get_decoration", { stage: artStage })
      : api.call("get_portrait", { item_id: portrait?.id })
    request.then((res: any) => {
      const payload = unwrap(res, "available")
      const url = payload.available && typeof payload.data_url === "string" ? payload.data_url : ""
      if (url) rememberImage(artCache.current, String(payload.version || artVersion), url, 6)
      if (alive) {
        setArt(url)
        if (!url) setArtError(t("art.imageError", { defaultValue: "图片加载失败，请重试。" }))
      }
    }).catch((error: any) => { if (alive) { setArt(""); setArtError(errorText(error)) } })
      .finally(() => { if (alive) setArtLoading(false) })
    return () => { alive = false }
  }, [artVersion, portraitMode, portraitMode === "legacy" ? artStage : "", artRetry])

  useEffect(() => {
    if (!gallery) return
    let alive = true
    setGalleryLoading(true)
    setGalleryError("")
    // Debounce search while keeping only the current page's thumbnails mounted.
    const timer = setTimeout(() => {
      api.call("list_portraits", { page: galleryPage, collection: galleryCollection, query: gallerySearch })
        .then((res: any) => { if (alive) setGalleryData(unwrap(res, "items") as PortraitPage) })
        .catch((error: any) => { if (alive) { setGalleryData(null); setGalleryError(errorText(error)) } })
        .finally(() => { if (alive) setGalleryLoading(false) })
    }, 180)
    return () => { alive = false; clearTimeout(timer) }
  }, [gallery, galleryPage, galleryCollection, gallerySearch, galleryRetry, library?.revision])

  function openGallery(purpose: "fixed" | "pool") {
    setFeedback(null)
    setChosenId(portraitPrefs.selected_id)
    setPoolDraft(portraitPrefs.pool_ids === null ? null : [...portraitPrefs.pool_ids])
    setGalleryPage(0)
    setGalleryCollection(portrait?.collection || "")
    setGallerySearch("")
    setGalleryData(null)
    setCustomEdit(null)
    setGallery(purpose)
  }

  async function savePortraitPrefs(next: PortraitPrefs) {
    return run("set_portraits", next, t("feedback.artSaved", { defaultValue: "立绘设置已保存" }))
  }

  function editPortrait(item: Portrait) {
    setCustomEdit(item); setCustomName(item.name); setCustomGame(item.collection); setDeleteCustom(false); setFeedback(null)
  }

  async function saveCustomPortrait(remove = false) {
    if (!customEdit) return
    const itemId = customEdit.id
    let savedGame = customGame.trim()
    const done = await run(remove ? "delete_portrait" : "edit_portrait", remove ? { item_id: itemId }
      : { item_id: itemId, name: customName.trim(), collection: customGame.trim() },
    (result: any) => {
      if (!remove) savedGame = unwrap(result, "item").item?.collection || savedGame
      return t(remove ? "art.deleted" : "art.edited")
    })
    if (done) {
      setCustomEdit(null)
      setGalleryRetry(value => value + 1)
      setGalleryPage(0)
      if (remove) {
        if (chosenId === itemId) setChosenId("")
        setPoolDraft(value => value === null ? null : value.filter(id => id !== itemId))
        if (galleryCollection === customEdit.collection && galleryData?.total === 1) setGalleryCollection("")
      } else setGalleryCollection(savedGame)
    }
  }

  async function shufflePortrait() {
    const request = ++portraitRequest.current
    setArtChoosing(true)
    setArtError("")
    try {
      const item = unwrap(await api.call("choose_portrait", { previous_id: portrait?.id || "" }), "available")
      if (request === portraitRequest.current) setPortrait(item.available ? item as Portrait : null)
    } catch (error: any) { if (request === portraitRequest.current) setArtError(errorText(error)) }
    finally { if (request === portraitRequest.current) setArtChoosing(false) }
  }

  // Preserve each character's edits across navigation and background refreshes.
  const savedNicknames = (scope && scope.nicknames) || {}
  const savedNickKey = scope ? `${scope.key}|${JSON.stringify(savedNicknames)}` : ""
  const nickEntry = scope ? nickDrafts[scope.key] : undefined
  const nickDraft = nickEntry?.values || savedNicknames
  const nickBase = nickEntry?.base || savedNicknames
  const nickDirty = stages.some(item => (nickDraft[item.key] || "").trim() !== (nickBase[item.key] || ""))
  useEffect(() => {
    if (!scope) return
    setNickDrafts(previous => {
      const entry = previous[scope.key]
      if (entry && stages.some(item => (entry.values[item.key] || "").trim() !== (entry.base[item.key] || ""))) {
        const values = { ...entry.values }, base = { ...entry.base }
        for (const item of stages) {
          if ((values[item.key] || "").trim() === (base[item.key] || "")) {
            values[item.key] = savedNicknames[item.key] || ""
            base[item.key] = savedNicknames[item.key] || ""
          }
        }
        return { ...previous, [scope.key]: { values, base } }
      }
      return { ...previous, [scope.key]: { values: { ...savedNicknames }, base: { ...savedNicknames } } }
    })
  }, [savedNickKey])

  function editNickname(key: string, value: string) {
    if (!scope) return
    setFeedback(null)
    setNickDrafts(previous => ({
      ...previous, [scope.key]: {
        base: previous[scope.key]?.base || { ...savedNicknames },
        values: { ...(previous[scope.key]?.values || savedNicknames), [key]: Array.from(value).slice(0, limits.nickname_chars || 12).join("") },
      },
    }))
  }

  async function run(actionId: string, args: Record<string, unknown>, success: string | ((result: any) => string),
    acknowledged?: () => void) {
    if (busyRef.current) return false
    busyRef.current = true
    feedbackTrigger.current = document.activeElement as HTMLElement | null
    const requestedCheck = actionId === "set_settings" ? Object.values(args).find(value => typeof value === "boolean")
      : actionId === "set_per_character" ? args.enabled : undefined
    const savedCheck = actionId === "set_settings" ? state.settings?.[Object.keys(args)[0]]
      : actionId === "set_per_character" ? state.per_character : undefined
    const endPending = beginPending(typeof requestedCheck === "boolean" ? requestedCheck : undefined, savedCheck)
    let committed = false
    setBusy(true)
    const shopProgress: Record<string, string> = {
      claim_shop_coins: "shop.claiming", buy_shop_item: "shop.buying",
      send_shop_gift: "shop.sending", retry_gift_reaction: "shop.requesting",
    }
    setFeedback({ tone: "pending", action: actionId, message: shopProgress[actionId] ? t(shopProgress[actionId]) : actionId === "sync_characters"
      ? t("feedback.refreshing", { defaultValue: "正在刷新…" }) : t("common.saving", { defaultValue: "保存中…" }) })
    try {
      let message = typeof success === "string" ? success : ""
      try {
        const result = await api.call(actionId, args, { userInitiated: true })
        committed = true
        message = typeof success === "string" ? success : success(result)
        acknowledged?.()
      } catch (error: any) {
        // A recognized backend rejection did not execute this request.
        if (SHOP_ERRORS.some(code => String(error?.message || error).includes(code))) acknowledged?.()
        if (["shop_stale", "shop_no_affection_room", "shop_gain_changed", "nickname_conflict", "first_met_conflict"].some(code => String(error?.message || error).includes(code))) {
          setRefreshError(true)
        }
        setFeedback({ tone: "danger", action: actionId, message: errorText(error) })
        return false
      }
      setFeedback({ tone: "pending", action: actionId, message: t("feedback.savedRefreshing", { defaultValue: "操作已完成，正在更新面板…" }) })
      // A failed refresh must not turn an acknowledged save into a failed save.
      let refreshed = true
      try {
        await api.refresh()
        setRefreshError(false)
      } catch { refreshed = false; setRefreshError(true) }
      setFeedback({ tone: refreshed ? "success" : "warning", action: actionId,
        message: refreshed ? message : `${message} · ${t("feedback.stale", { defaultValue: "显示数据尚未更新，请刷新。" })}` })
      return true
    } finally {
      endPending(committed)
      busyRef.current = false
      setBusy(false)
    }
  }

  async function refreshPanel() {
    if (busyRef.current) return
    busyRef.current = true
    feedbackTrigger.current = document.activeElement as HTMLElement | null
    const endPending = beginPending()
    setBusy(true)
    setFeedback({ tone: "pending", action: "refresh", message: t("feedback.refreshing", { defaultValue: "正在刷新…" }) })
    try {
      await api.refresh()
      setRefreshError(false)
      setFeedback({ tone: "success", action: "refresh", message: t("toast.synced", { defaultValue: "已刷新" }) })
    } catch {
      setRefreshError(true)
      setFeedback({ tone: "danger", action: "refresh", message: t("alert.refreshFailed", { defaultValue: "暂时无法刷新面板，当前显示的可能是旧数据。请重试。" }) })
    }
    finally { endPending(); busyRef.current = false; setBusy(false) }
  }

  function editAppearance(next: Appearance) {
    setFeedback(null)
    setColorInput(next.accent_color)
    setThemeEdit(previous => ({ values: next, base: previous?.base || storedAppearance }))
  }

  async function saveAppearance() {
    if (colorInvalid) return
    const next = { ...liveAppearance }
    if (await run("set_appearance", next, t("feedback.appearanceSaved", { defaultValue: "外观已保存，下次打开仍会保留" }))) {
      setThemeEdit({ values: next, base: next })
    }
  }

  async function togglePerCharacter(next: boolean) {
    const source = document.activeElement
    const ok = await confirm({
      title: next ? t("perChar.onTitle", { defaultValue: "开启独立好感？" }) : t("perChar.offTitle", { defaultValue: "改回共用好感？" }),
      message: next
        ? t("perChar.onMessage", { defaultValue: "当前角色保留现在的好感；其他角色恢复各自以前的记录，没有记录的从 0 开始。不会清除任何数据。" })
        : t("perChar.offMessage", { defaultValue: "共用好感将使用当前角色的值；其他角色的独立记录会保留，下次开启时恢复。" }),
      confirmLabel: t("common.confirm", { defaultValue: "确定" }),
      cancelLabel: t("common.cancel", { defaultValue: "取消" }),
    })
    if (ok) await run("set_per_character", { enabled: next }, t("toast.saved", { defaultValue: "已保存" }))
    else if (source instanceof HTMLInputElement && source.type === "checkbox") source.checked = Boolean(state.per_character)
  }

  async function toggleSetting(key: "require_confession" | "decay" | "auto_score" | "proactive_confession", next: boolean) {
    const rules = state.decay_rules || { grace_days: 3, per_day: 1 }
    const source = document.activeElement
    const restore = () => {
      if (source instanceof HTMLInputElement && source.type === "checkbox") source.checked = Boolean(state.settings?.[key])
    }
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
      if (!ok) { restore(); return }
    }
    if (key === "require_confession" && !next) {
      const ok = await confirm({
        title: t("rules.gateOffTitle", { defaultValue: "不再需要告白？" }),
        message: t("rules.gateOffMessage", { defaultValue: "好感已到 80 的角色会立刻成为恋人，这一步不能撤回。" }),
        confirmLabel: t("common.confirm", { defaultValue: "确定" }),
        cancelLabel: t("common.cancel", { defaultValue: "取消" }),
      })
      if (!ok) { restore(); return }
    }
    await run("set_settings", { [key]: next }, t("feedback.rulesSaved", { defaultValue: "关系规则已更新" }))
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
    if (!dialogScope || draft === "" || !scopes.some(item => item.key === dialogScope)) return
    if (await run("set_affection", { scope: dialogScope, value: draft }, t("feedback.affectionSaved", { value: draft, defaultValue: "好感已调整为 {value}" }))) {
      setEditing(false)
    }
  }

  async function saveNicknames() {
    if (!scope) return
    const payload: Record<string, string> = {}
    const expected: Record<string, string> = {}
    for (const item of stages) {
      const value = (nickDraft[item.key] || "").trim()
      if (value !== (nickBase[item.key] || "")) {
        payload[item.key] = value
        expected[item.key] = nickBase[item.key] || ""
      }
    }
    const key = scope.key
    await run("set_nicknames", { scope: key, nicknames: payload, expected_nicknames: expected }, result => {
      const saved = unwrap(result, "scope").result
      setNickDrafts(previous => ({ ...previous, [key]: { values: { ...saved }, base: { ...saved } } }))
      return t("feedback.nicknamesSaved", { defaultValue: "称呼已保存" })
    })
  }

  function openFirstMet(current: Scope) {
    setFeedback(null)
    setDialogScope(current.key)
    setMetDraft(current.first_met || state.today || "")
    setMetCustomDraft(current.custom_first_met || current.first_met || state.today || "")
    setMetPrevious(current.first_met || state.today || "")
    setMetSource(current.first_met_source || "custom")
    setMetOptions({
      plugin: current.plugin_first_met || current.first_met || "",
      legacy: current.plugin_first_met_legacy === true,
      host: current.host_first_met || "",
    })
    setMetOpen(true)
  }

  function chooseMetSource(source: "plugin" | "host" | "custom") {
    setMetSource(source)
    setFeedback(null)
    setMetDraft(source === "custom" ? metCustomDraft : metOptions[source])
  }

  async function saveFirstMet() {
    if (!dialogScope || !scopes.some(item => item.key === dialogScope)) return
    if (await run("set_first_met", {
      scope: dialogScope, date: metDraft, expected_date: metPrevious, source: metSource,
    }, t("feedback.firstMetSaved", { defaultValue: "相识日已更新" }))) {
      setMetOpen(false)
    }
  }

  async function previewFirstMet(key: string) {
    if (busyRef.current || !scopes.some(item => item.key === key)) return
    busyRef.current = true
    feedbackTrigger.current = document.activeElement as HTMLElement | null
    const endPending = beginPending()
    setDialogScope(key)
    setMetImport(null)
    setMetImportOpen(true)
    setBusy(true)
    setFeedback({ tone: "pending", action: "preview_first_met", message: t("dates.historySearching") })
    try {
      const result = unwrap(await api.call("preview_first_met", { scope: key },
        { userInitiated: true, timeoutMs: 12000 }), "source")
      if (result.scope !== key || result.source !== "host_recent_history" || !parseIsoDay(result.date) ||
        result.date < "1970-01-01" || Boolean(state.today && result.date > state.today)) {
        throw new Error("host_history_unavailable")
      }
      setMetImport(result as FirstMetImport)
      setFeedback(null)
    } catch (error: any) {
      setFeedback({ tone: "danger", action: "preview_first_met", message: errorText(error) })
    } finally {
      endPending(false)
      busyRef.current = false
      setBusy(false)
    }
  }

  async function importFirstMet() {
    if (!metImport || !scopes.some(item => item.key === metImport.scope)) return
    if (await run("set_first_met", {
      scope: metImport.scope, date: metImport.date, expected_date: metImport.previous_date, source: "host",
    }, t("feedback.firstMetSaved", { defaultValue: "相识日已更新" }))) {
      setMetImportOpen(false)
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

  const hasArt = activeSection === "heart" && portraitMode !== "off" && Boolean(art)
  const settings = state.settings || { require_confession: true, decay: false, auto_score: true, proactive_confession: false }
  const decayRules = state.decay_rules || { grace_days: 3, per_day: 1 }
  const autoStatus = state.auto_status
  function autoStatusText(): string {
    if (!autoStatus) return ""
    if (autoStatus.bus_ok === false) {
      return t("rules.autoNoBus", { defaultValue: "暂时读不到聊天内容，请确认 N.E.K.O 里的用户插件已开启。" })
    }
    if (autoStatus.last_error && autoStatus.failed > 0) {
      return t("rules.autoFailed", { failed: autoStatus.failed, defaultValue: "已有 {failed} 轮判断失败。" })
    }
    if (autoStatus.scored > 0 && autoStatus.last_ts) {
      const scored = t("rules.autoScored", {
        n: autoStatus.scored,
        when: relativeTime(autoStatus.last_ts),
        defaultValue: "已判断 {n} 轮对话，最近一次在{when}。",
      })
      return scored + autoModeText()
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
    key === "shop" ? t("nav.shop", { defaultValue: "礼物商店" }) : key === "heart"
      ? t("nav.heart", { defaultValue: "关系概览" })
      : key === "history"
        ? t("nav.history", { defaultValue: "心动记录" })
      : key === "dates"
        ? t("nav.dates", { defaultValue: "纪念日" })
        : key === "nicknames"
          ? t("nav.nicknames", { defaultValue: "专属称呼" })
          : t("nav.settings", { defaultValue: "设置" })

  function changeSection(next: Section) {
    if (!busyRef.current) setFeedback(null)
    setSection(next)
    workspaceRef.current?.scrollTo({ top: 0 })
  }

  function jumpToSettings(id: string) {
    const heading = document.getElementById(id)
    const workspace = workspaceRef.current
    if (heading && workspace) {
      const navigation = workspace.querySelector(".lwy-settings-nav")
      workspace.scrollTo({ top: workspace.scrollTop + heading.getBoundingClientRect().top
        - workspace.getBoundingClientRect().top - (navigation?.getBoundingClientRect().height || 0)
        - parseFloat(getComputedStyle(workspace).paddingTop) - 16 })
    }
    heading?.focus({ preventScroll: true })
  }

  function loverDays(): number {
    const start = parseIsoDay(loverSince)
    const today = parseIsoDay(state.today || "")
    if (!start || !today) return 0
    const diff = Date.UTC(today.y, today.m - 1, today.d) - Date.UTC(start.y, start.m - 1, start.d)
    return Math.floor(diff / 86400000) + 1
  }

  function historyText(item: HistoryItem): string {
    if (item.source === "gift" && item.reason.startsWith("gift:")) {
      return t("shop.historyReason", { name: t(`shop.item.${item.reason.slice(5)}`) })
    }
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
          <div className="lwy-range" role="group" aria-label={t("trend.title", { defaultValue: "好感走势" })}>
            {TREND_RANGES.map((n) => (
              <button key={n} type="button" aria-pressed={n === days ? "true" : "false"} className={n === days ? "on" : ""} onClick={() => setTrendRange(n)}>
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
        <div className={days > 90 ? "lwy-chart dense" : "lwy-chart"} role="img"
          aria-label={t("trend.summary", {
            n: days, from: known[0] ?? "-", to: known[known.length - 1] ?? "-",
            defaultValue: "最近 {n} 天，好感从 {from} 到 {to}",
          })}>
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
      <div className="lwy-sections">
        <section className="lwy-card">
          <div className="lwy-hero">
            <div className="lwy-ring" style={{ "--p": String(Math.max(0, Math.min(100, current.affection))) }} role="meter"
              aria-label={t("common.affection", { defaultValue: "好感度" })}
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={current.affection}>
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
                aria-current={index === current.stage_index ? "step" : undefined}
                className={["lwy-step", index <= current.stage_index ? "done" : "", index === current.stage_index ? "now" : ""].join(" ")}
              >
                <i />
                <span>{stageName(item.key)}</span>
              </div>
            ))}
          </div>

          <div className="lwy-today">
            <span className="gain">{t("today.gain", { defaultValue: "今日心动" })} <b>{current.gained_today ? `+${current.gained_today}` : "0"}</b> / {limits.daily_gain}</span>
            <span className="loss">{t("today.loss", { defaultValue: "今日失落" })} <b>{current.lost_today ? `-${current.lost_today}` : "0"}</b> / {limits.daily_loss}</span>
            <span>{t("today.metDay", { n: current.met_day || 1, defaultValue: "相识第 {n} 天" })}</span>
          </div>
        </section>

      </div>
    )
  }

  function renderOverviewDates(current: Scope) {
    return (
      <>
      <section className="lwy-overview-footer" aria-label={sectionLabel("dates")}>
        <div className="lwy-summary">
          <div className="lwy-summary-item">
            <span className="lwy-sub">{t("overview.firstMet", { defaultValue: "相识的日子" })}</span>
            <span className="lwy-summary-value">{current.first_met ? isoLabel(current.first_met) : "-"}</span>
          </div>
          <div className="lwy-summary-item">
            <span className="lwy-sub">{t("overview.nextDate", { defaultValue: "下一次纪念" })}</span>
            <span className="lwy-summary-value">{upcoming.length ? eventLabel(upcoming[0]) : "-"}</span>
            {upcoming.length ? <span className="lwy-sub">{countdown(upcoming[0].days_until)}</span> : null}
          </div>
        </div>
      </section>
      <section className="lwy-recent">
        <div className="lwy-card-head">
          <h2 className="lwy-h">{t("overview.recent", { defaultValue: "最近的心动" })}</h2>
          <button type="button" className="lwy-text-button" onClick={() => changeSection("history")}>
            {t("overview.allHistory", { defaultValue: "查看全部" })}<Icon name="ChevronRight" />
          </button>
        </div>
        {current.history.length ? (
          <div className="lwy-row">
            <span className={current.history[0].delta > 0 ? "lwy-d up" : current.history[0].delta < 0 ? "lwy-d down" : "lwy-d zero"}>
              {current.history[0].source === "confession" ? "♥" : current.history[0].delta > 0 ? `+${current.history[0].delta}` : current.history[0].delta}
            </span>
            <span className="lwy-why">{historyText(current.history[0])}</span>
            <time className="lwy-when" dateTime={new Date(current.history[0].ts * 1000).toISOString()}>
              {relativeTime(current.history[0].ts)}
            </time>
          </div>
        ) : <p className="lwy-empty">{t("history.empty", { defaultValue: "还没有记录。多和 TA 聊聊吧。" })}</p>}
      </section>
      </>
    )
  }

  function renderHistory(current: Scope) {
    return (
      <div className="lwy-sections">
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
                  <time className="lwy-when" dateTime={new Date(item.ts * 1000).toISOString()}
                    title={new Date(item.ts * 1000).toLocaleString(props.locale)}>{relativeTime(item.ts)}</time>
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
      <div className="lwy-sections">
        <section className="lwy-card">
          <div className="lwy-card-head">
            <h2 className="lwy-h">{t("dates.ours", { defaultValue: "我们的日子" })}</h2>
            <div className="lwy-btns">
            <Button tone="default" disabled={busy} onClick={() => previewFirstMet(current.key)}>
              <Icon name="History" />{t("dates.importMet")}
            </Button>
            <Button tone="default" disabled={busy} onClick={() => openFirstMet(current)}>
              <Icon name="Pencil" />
              {t("dates.editMet", { defaultValue: "修改相识日" })}
            </Button>
            </div>
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
              onClick={() => { setFeedback(null); setAnnTitle(""); setAnnDate(state.today || ""); setAnnOpen(true) }}
            >
              <Icon name="Plus" />
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
                    aria-label={t("dates.removeNamed", { name: item.title, defaultValue: "删除「{name}」" })}
                    onClick={() => { void removeAnniversary(item) }}
                  >
                    <Icon name="Trash2" />
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

  function renderNicknames() {
    return (
      <div className="lwy-sections">
        <section className="lwy-card">
          <div className="lwy-card-head">
            <h2 className="lwy-h">{t("nick.title", { defaultValue: "称呼" })}</h2>
          </div>
          <p className="lwy-note" style={{ marginBottom: "20px" }}>
            {t("nick.note", { defaultValue: "角色在这个阶段会这样叫你。留空的阶段沿用上一阶段的称呼。" })}
          </p>
          <div className="lwy-nick-grid">
            {stages.map((item, index) => (
              <div key={item.key} className="lwy-nick-row">
                <label>
                <span>{stageName(item.key)}</span>
                <Input
                  value={nickDraft[item.key] || ""}
                  disabled={busy}
                  placeholder={inheritedNickname(index) || t("nick.placeholder", { defaultValue: "沿用人设里的称呼" })}
                  onChange={(value: string) => editNickname(item.key, value)}
                />
                </label>
                <span className="lwy-counter" aria-hidden="true">{Array.from(nickDraft[item.key] || "").length}/{limits.nickname_chars || 12}</span>
              </div>
            ))}
          </div>
          <div className="lwy-savebar">
            <span className={nickDirty ? "lwy-save-state dirty" : "lwy-save-state"} role="status">
              {nickDirty ? t("common.unsaved", { defaultValue: "尚未保存" }) : t("common.noChanges", { defaultValue: "没有未保存的修改" })}
            </span>
            <div className="lwy-btns">
              {nickDirty ? <Button tone="default" disabled={busy} onClick={() => {
                setFeedback(null)
                if (scope) setNickDrafts(previous => ({ ...previous, [scope.key]: { values: { ...savedNicknames }, base: { ...savedNicknames } } }))
              }}>{t("common.discard", { defaultValue: "撤销修改" })}</Button> : null}
              <Button tone="primary" disabled={busy || !nickDirty} onClick={saveNicknames}>{saveLabel("set_nicknames")}</Button>
            </div>
          </div>
        </section>
      </div>
    )
  }

  function renderSettings(current: Scope | undefined) {
    return (
      <div className="lwy-sections">
        <nav className="lwy-settings-nav" aria-label={t("settings.sections", { defaultValue: "设置分区" })}>
          {[
            ["lwy-appearance-heading", t("theme.title", { defaultValue: "外观" })],
            ...(library ? [["lwy-art-heading", t("art.title", { defaultValue: "立绘" })]] : []),
            ["lwy-rules-heading", t("rules.title", { defaultValue: "关系规则" })],
            ["lwy-characters-heading", t("settings.title", { defaultValue: "角色与好感" })],
          ].map(([id, label]) => <button type="button" key={id} onClick={() => jumpToSettings(id)}>{label}</button>)}
        </nav>
        <section className="lwy-card lwy-appearance">
          <div className="lwy-card-head">
            <h2 id="lwy-appearance-heading" tabIndex={-1} className="lwy-h lwy-settings-section">{t("theme.title", { defaultValue: "外观" })}</h2>
          </div>
          <div className="lwy-palette" role="group" aria-label={t("theme.palette", { defaultValue: "主题配色" })}>
            {THEME_PRESETS.map(item => (
              <button type="button" key={item.key} className="lwy-color-choice" disabled={busy}
                aria-pressed={liveAppearance.accent_color === item.color ? "true" : "false"}
                title={`${t(`theme.${item.key}`, { defaultValue: item.label })} ${item.color.toUpperCase()}`}
                onClick={() => editAppearance({ ...liveAppearance, accent_color: item.color })}>
                <span className="lwy-swatch" style={{ background: item.color }} aria-hidden="true" />
                <span>{t(`theme.${item.key}`, { defaultValue: item.label })}</span>
                <span style={{ width: "16px", height: "16px", flex: "none" }} aria-hidden="true">
                  {liveAppearance.accent_color === item.color ? <Icon name="Check" /> : null}
                </span>
              </button>
            ))}
          </div>
          <div className="lwy-theme-fields">
            <div className="lwy-field">
              <span>{t("theme.custom", { defaultValue: "自选颜色" })}</span>
              <div className="lwy-custom-color">
                <input type="color" value={liveAppearance.accent_color} disabled={busy}
                  aria-label={t("theme.custom", { defaultValue: "自选颜色" })}
                  onInput={(event: Event) => editAppearance({ ...liveAppearance, accent_color: (event.target as HTMLInputElement).value })} />
                <label>
                  <span className="lwy-sr-only">{t("theme.hex", { defaultValue: "色号" })}</span>
                  <Input value={colorInput} disabled={busy} invalid={colorInvalid}
                    onChange={(value: string) => {
                      setFeedback(null); setColorInput(value)
                      if (value.length === 7 && /^#[0-9a-f]{6}$/i.test(value)) editAppearance({ ...liveAppearance, accent_color: value.toLowerCase() })
                    }} />
                </label>
              </div>
              {colorInvalid ? <span className="lwy-field-error" role="alert">
                {t("theme.invalidColor", { defaultValue: "请输入 #RRGGBB 格式的色号" })}
              </span> : null}
            </div>
            <div className="lwy-field">
              <span>{t("theme.scheme", { defaultValue: "显示模式" })}</span>
              <div className="lwy-segmented" role="group" aria-label={t("theme.scheme", { defaultValue: "显示模式" })}>
                {(["system", "light", "dark"] as const).map(scheme => (
                  <button type="button" key={scheme} disabled={busy}
                    aria-pressed={liveAppearance.color_scheme === scheme ? "true" : "false"}
                    onClick={() => editAppearance({ ...liveAppearance, color_scheme: scheme })}>
                    {t(`theme.${scheme}`, { defaultValue: scheme === "system" ? "跟随系统" : scheme === "light" ? "浅色" : "深色" })}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="lwy-btns">
            <Button tone="default" disabled={busy || (!themeDirty && storedAppearanceKey === JSON.stringify(DEFAULT_APPEARANCE) && !colorInvalid)}
              onClick={() => editAppearance({ ...DEFAULT_APPEARANCE })}>
              <Icon name="RotateCw" />{t("theme.restore", { defaultValue: "恢复默认" })}
            </Button>
          </div>
          <div className="lwy-savebar">
            <span className={themeDirty || colorInvalid ? "lwy-save-state dirty" : "lwy-save-state"} role="status">
              {themeDirty || colorInvalid ? t("theme.previewing", { defaultValue: "正在预览，尚未保存" }) : t("common.noChanges", { defaultValue: "没有未保存的修改" })}
            </span>
            <div className="lwy-btns">
              {themeDirty || colorInvalid ? <Button tone="default" disabled={busy} onClick={() => {
                setFeedback(null); setThemeEdit(null); setColorInput(storedAppearance.accent_color)
              }}>{t("common.discard", { defaultValue: "撤销修改" })}</Button> : null}
              <Button tone="primary" disabled={busy || !themeDirty || colorInvalid} onClick={saveAppearance}>{saveLabel("set_appearance")}</Button>
            </div>
          </div>
        </section>
        {library ? (
          <section className="lwy-card lwy-portrait-settings">
            <h2 id="lwy-art-heading" tabIndex={-1} className="lwy-h lwy-settings-section">{t("art.title", { defaultValue: "立绘" })}</h2>
            <div className="lwy-segmented" role="group" aria-label={t("art.mode", { defaultValue: "立绘模式" })}>
              {(["fixed", "random", "off"] as const).map(mode => (
                <button type="button" key={mode} aria-pressed={portraitMode === mode ? "true" : "false"}
                  disabled={busy || (mode !== "off" && !library.count)}
                  onClick={() => {
                    if (mode === "fixed" && !portraitPrefs.selected_id) openGallery("fixed")
                    else void savePortraitPrefs({ ...portraitPrefs, mode })
                  }}>
                  {t(`art.mode.${mode}`, { defaultValue: mode === "fixed" ? "固定" : mode === "random" ? "随机" : "关闭" })}
                </button>
              ))}
              {legacyVersion || portraitMode === "legacy" ? (
                <button type="button" aria-pressed={portraitMode === "legacy" ? "true" : "false"} disabled={busy}
                  onClick={() => { void savePortraitPrefs({ ...portraitPrefs, mode: "legacy" }) }}>
                  {t("art.mode.legacy", { defaultValue: "旧版阶段图" })}
                </button>
              ) : null}
            </div>
            <div className="lwy-btns">
              <Button tone="default" disabled={busy} onClick={() => { setFeedback(null); setImportOpen(true) }}>
                <Icon name="Plus" />{t("art.import", { defaultValue: "导入立绘" })}
              </Button>
              {portraitMode === "off" || portraitMode === "legacy" ? <Button disabled={busy || !library.count}
                onClick={() => openGallery("fixed")}>{t("art.browse", { defaultValue: "选择立绘" })}</Button> : null}
            </div>
            {portraitMode === "fixed" || portraitMode === "random" ? (
              <div className="lwy-set-row">
                <div className="lwy-portrait-preview">
                  {art ? <img src={art} alt="" onError={handleArtError} /> : null}
                  <span className="lwy-hint">{artLoading || artChoosing ? t("art.loading", { defaultValue: "加载中…" }) : portrait?.name || t("art.none", { defaultValue: "未选择立绘" })}</span>
                </div>
                <div className="lwy-btns">
                  <Button tone="default" disabled={busy || !library.count} onClick={() => openGallery("fixed")}>
                    {t("art.browse", { defaultValue: "选择立绘" })}
                  </Button>
                  {portraitMode === "random" ? (
                    <button type="button" className="lwy-icon-button" disabled={busy || artLoading || artChoosing || library.pool_count < 2}
                      title={t("art.shuffle", { defaultValue: "换一张" })} aria-label={t("art.shuffle", { defaultValue: "换一张" })}
                      onClick={shufflePortrait}><Icon name="RotateCw" /></button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {portraitMode === "random" ? (
              <div className="lwy-set-row">
                <span className="lwy-note">{t("art.poolCount", { n: library.pool_count, defaultValue: "随机范围：{n} 张" })}</span>
                <Button tone="default" disabled={busy || !library.count} onClick={() => openGallery("pool")}>
                  {t("art.editPool", { defaultValue: "选择随机范围" })}
                </Button>
              </div>
            ) : null}
            {!library.count ? <p className="lwy-note">{t("art.empty", { defaultValue: "图库里还没有可用的立绘。" })}</p> : null}
            {portraitMode === "random" && !library.pool_count ? (
              <Alert tone="info" message={t("art.emptyPool", { defaultValue: "随机范围为空，请选择图片。" })} />
            ) : null}
            {library.catalog_error ? <Alert tone="warning" message={t("art.catalogError", { defaultValue: "部分立绘条目无法读取，请检查图库清单。" })} /> : null}
            {artError ? (
              <div className="lwy-set-row">
                <Alert tone="warning" message={artError} />
                <Button tone="default" disabled={artLoading || artChoosing} onClick={() => { setArtRetry(artRetry + 1) }}>{t("art.retry", { defaultValue: "重试" })}</Button>
              </div>
            ) : null}
          </section>
        ) : null}
        <section className="lwy-card lwy-set">
          <h2 id="lwy-rules-heading" tabIndex={-1} className="lwy-h lwy-settings-section">{t("rules.title", { defaultValue: "关系规则" })}</h2>
          <div className="lwy-rule">
            <Switch
              checked={settings.auto_score !== false}
              disabled={busy}
              label={t("rules.autoScore", { defaultValue: "自动判断好感" })}
              onChange={(value: boolean) => toggleSetting("auto_score", value)}
            />
            <p className="lwy-note">
              {settings.auto_score !== false
                ? t("rules.autoBrief", { defaultValue: "聊天结束后自动记录好感变化，只保存一句理由。" })
                : t("rules.autoScoreOffNote", { defaultValue: "关闭后由角色自己调用工具调整好感，很多模型几乎不会调用。" })}
            </p>
            {settings.auto_score !== false ? <details className="lwy-details">
              <summary>{t("rules.details", { defaultValue: "详细规则" })}</summary>
              <p className="lwy-note">
              {t("rules.autoScoreNote", {
                    defaultValue:
                      "每轮对话结束后判断这一轮让好感变了多少。默认用本地关键词判断；想判断得更准，可以在 N.E.K.O 的「Plugin API」页给本插件的「好感判断」绑定一个模型。只保存一句理由，不保存聊天内容。",
                  })}
              </p>
            </details> : null}
            {settings.auto_score !== false && autoStatusText() ? <p
              className={autoStatus?.bus_ok === false || autoStatus?.last_error ? "lwy-note lwy-status warning" : "lwy-note lwy-status"}
              role="status">{autoStatusText()}</p> : null}
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
              checked={Boolean(settings.proactive_confession)}
              disabled={busy || !settings.require_confession || settings.auto_score === false}
              label={t("rules.proactiveConfession", { defaultValue: "允许猫娘主动告白" })}
              onChange={(value: boolean) => toggleSetting("proactive_confession", value)}
            />
            <p className="lwy-note">
              {!settings.require_confession || settings.auto_score === false
                ? t("rules.proactiveRequires", { defaultValue: "先开启「自动判断好感」和「成为恋人需要告白」。" })
                : t("rules.proactiveBrief", { defaultValue: "好感足够后，猫娘可以主动表达心意，等你明确答应。" })}
            </p>
            <details className="lwy-details">
              <summary>{t("rules.details", { defaultValue: "详细规则" })}</summary>
              <p className="lwy-note">
              {t("rules.proactiveConfessionNote", {
                defaultValue: "需开启自动判断好感和告白门槛。好感达到 80 后，猫娘可在正常聊天后主动告白，等你明确答应；拒绝或犹豫后冷却 24 小时，30 分钟未确认则冷却 6 小时，每份关系最多尝试 3 次。默认关闭。",
              })}
              </p>
            </details>
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
          <h2 id="lwy-characters-heading" tabIndex={-1} className="lwy-h lwy-settings-section">{t("settings.title", { defaultValue: "角色与好感" })}</h2>
          <div className="lwy-set-row">
            <Switch
              checked={Boolean(state.per_character)}
              disabled={busy}
              label={t("settings.perCharacter", { defaultValue: "每个角色独立好感" })}
              onChange={(value: boolean) => togglePerCharacter(value)}
            />
            <Button tone="default" disabled={busy} onClick={async () => { await run("sync_characters", {}, t("toast.synced", { defaultValue: "已刷新" })) }}>
              <Icon name="RotateCw" />
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
                <Button tone="default" disabled={busy} onClick={() => { setFeedback(null); setDialogScope(current.key); setDraft(current.affection); setEditing(true) }}>
                  <Icon name="Pencil" />
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
    <div className={sidebarCollapsed ? "lwy sidebar-collapsed" : "lwy"}>
      <style>{STYLE + SHOP_STYLE + PORTRAIT_IMPORT_STYLE + INTERACTION_STYLE + SCROLLBAR_STYLE + themeCss(liveAppearance)}</style>

      <aside className="lwy-sidebar">
        <div className="lwy-sidebar-head">
          <span className="lwy-brand-mark" aria-hidden="true"><Icon name="Heart" /></span>
          <h2 className="lwy-brand" hidden={sidebarCollapsed}>{t("panel.title", { defaultValue: "与你相恋" })}</h2>
          <button
            type="button"
            className="lwy-sidebar-toggle"
            aria-controls="lwy-sidebar-navigation"
            aria-expanded={sidebarCollapsed ? "false" : "true"}
            aria-label={sidebarCollapsed
              ? t("nav.expand", { defaultValue: "展开侧栏" })
              : t("nav.collapse", { defaultValue: "收起侧栏" })}
            title={sidebarCollapsed
              ? t("nav.expand", { defaultValue: "展开侧栏" })
              : t("nav.collapse", { defaultValue: "收起侧栏" })}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            <Icon name={sidebarCollapsed ? "PanelLeftOpen" : "PanelLeftClose"} />
          </button>
        </div>
        <div id="lwy-sidebar-navigation" className="lwy-sidebar-body">
          <nav className="lwy-nav" aria-label={t("nav.label", { defaultValue: "插件页面" })}>
            {SECTIONS.map((key) => (
              <button
                key={key}
                type="button"
                aria-current={key === activeSection ? "page" : undefined}
                aria-controls="lwy-page"
                aria-label={sectionLabel(key)}
                title={sectionLabel(key)}
                className={key === activeSection ? "on" : ""}
                onClick={() => changeSection(key)}
              >
                <Icon name={SECTION_ICONS[key]} />
                <span className="lwy-nav-label">{sectionLabel(key)}</span>
              </button>
            ))}
          </nav>
          <div className="lwy-sidebar-foot">
            <strong>{scope?.label || t("scope.shared", { defaultValue: "共用" })}</strong>
            <span className="lwy-sub">
              {state.per_character
                ? t("mode.perCharacter", { defaultValue: "每个角色独立" })
                : t("mode.shared", { defaultValue: "所有角色共用" })}
            </span>
          </div>
        </div>
      </aside>

      <main className="lwy-workspace" tabIndex={0} aria-label={sectionLabel(activeSection)} ref={workspaceRef}>
        <div className={["lwy-page-layout", hasArt ? "has-art" : "", activeSection === "heart" && scope ? "is-overview" : ""].join(" ")}>
          <div className="lwy-page-content">
            <header key="page-heading" className="lwy-head">
              <div className="lwy-head-text">
                <h1 id="lwy-page-title" className="lwy-title">{sectionLabel(activeSection)}</h1>
                <span className="lwy-sub">
                  {activeSection === "shop" ? t("shop.subtitle") : scope?.label
                    ? t("settings.editingName", { name: scope.label, defaultValue: "正在管理：{name}" })
                    : t("settings.editingShared", { defaultValue: "正在管理：共用好感" })}
                </span>
              </div>
              {scopes.length > 1 && activeSection !== "shop" ? (
                <label className="lwy-scope">
                  <span className="lwy-sub">{t("scope.select", { defaultValue: "选择角色" })}</span>
                  <Select
                    value={scope?.key || ""}
                    disabled={busy}
                    options={scopes.map((item) => ({
                      value: item.key,
                      label: `${item.label || t("scope.shared", { defaultValue: "共用" })}${item.is_current ? ` · ${t("scope.current", { defaultValue: "当前角色" })}` : ""}`,
                    }))}
                    onChange={(value: string) => { setFeedback(null); setSelectedKey(value) }}
                  />
                </label>
              ) : null}
            </header>

            {state.host_online === false || tooLarge.length || refreshError || (activeSection === "heart" && artError) ? (
              <div key="page-notices" className="lwy-notices">
                {activeSection === "heart" && artError ? <div className="lwy-notice-row" role="status">
                  <Alert tone="warning" message={t("art.imageError", { defaultValue: "图片加载失败，请重试。" })} />
                  <Button tone="default" disabled={artLoading || artChoosing} onClick={() => { setArtRetry(artRetry + 1) }}>
                    <Icon name="RotateCw" />{t("art.retry", { defaultValue: "重试" })}
                  </Button>
                </div> : null}
                {refreshError ? (
                  <div className="lwy-notice-row" role="status">
                    <Alert tone="warning" message={t("alert.refreshFailed", { defaultValue: "暂时无法刷新面板，当前显示的可能是旧数据。请重试。" })} />
                    <Button tone="default" disabled={busy} onClick={refreshPanel}>
                      <Icon name="RotateCw" />{t("common.refresh", { defaultValue: "刷新" })}
                    </Button>
                  </div>
                ) : null}
                {state.host_online === false ? (
                  <Alert tone="warning" message={t("alert.offline", { defaultValue: "暂时连不上 N.E.K.O 主程序，角色列表可能不是最新的。" })} />
                ) : null}
                {tooLarge.length ? (
                  <Alert tone="info" message={t("alert.artTooLarge", { files: tooLarge.join("、"), defaultValue: "这些装饰图超过 1 MB，已跳过显示：{files}" })} />
                ) : null}
              </div>
            ) : null}

            <article key="page-body" id="lwy-page" className="lwy-page" aria-labelledby="lwy-page-title">
              {activeSection === "settings" ? (
                renderSettings(scope)
              ) : activeSection === "shop" ? (
                <Shop data={state.shop} characters={state.known_characters || []} current={state.current_character}
                  perCharacter={Boolean(state.per_character)} scopes={scopes} dailyGain={limits.daily_gain}
                  dailyChat={limits.daily_chat ?? 4}
                  api={api} t={t} useLocalState={props.useLocalState} busy={busy} stale={refreshError}
                  run={run} refresh={refreshPanel} dialog={onShopDialog} feedback={() => renderFeedback(true)}
                  beginEdit={() => { setFeedback(null) }} />
              ) : !scope ? (
                <section className="lwy-card">
                  <p className="lwy-empty">{t("empty.noCharacters", { defaultValue: "还没有读到角色，稍等片刻或点击设置里的刷新。" })}</p>
                  <Button tone="default" disabled={busy} onClick={async () => { await run("sync_characters", {}, t("toast.synced", { defaultValue: "已刷新" })) }}>
                    <Icon name="RotateCw" />{t("settings.sync", { defaultValue: "刷新角色" })}
                  </Button>
                </section>
              ) : activeSection === "dates" ? (
                renderDates(scope)
              ) : activeSection === "history" ? (
                renderHistory(scope)
              ) : activeSection === "nicknames" ? (
                renderNicknames()
              ) : (
                renderHeart(scope)
              )}
            </article>
          </div>
          {hasArt ? (
            <aside className="lwy-art" aria-hidden="true">
              <img key={artVersion} src={art} alt="" onError={handleArtError} />
            </aside>
          ) : null}
          {activeSection === "heart" && scope ? renderOverviewDates(scope) : null}
        </div>
      </main>
      {/* Keep this slot mounted so the host preserves page nodes and focus. */}
      <div className="lwy-feedback-slot">{!dialogOpen ? renderFeedback() : null}</div>

      {importOpen ? <PortraitImport api={api} t={t} collections={library?.collections || []}
        initialCollection={galleryCollection} onClose={closePortraitImport} errorText={errorText}
        onChanged={() => setGalleryRetry(value => value + 1)} /> : null}
      <Modal open={Boolean(gallery) && !importOpen} size="lg" className="lwy-gallery-modal"
        closeOnEscape={!busy} closeOnBackdrop={!busy}
        title={customEdit ? t("art.edit") : gallery === "pool" ? t("art.editPool", { defaultValue: "选择随机范围" }) : t("art.browse", { defaultValue: "选择立绘" })}
        onClose={closeGallery}
        footer={
          <>
          {renderFeedback(true)}
          {customEdit ? <div className="lwy-btns">
            <Button tone="default" disabled={busy} onClick={() => { setCustomEdit(null); setFeedback(null) }}>{t("art.back")}</Button>
            <Button tone="danger" disabled={busy} onClick={() => {
              if (deleteCustom) void saveCustomPortrait(true)
              else setDeleteCustom(true)
            }}><Icon name="Trash2" />{t(deleteCustom ? "art.confirmDelete" : "art.delete")}</Button>
            <Button tone="primary" disabled={busy || !customName.trim() || !customGame.trim()}
              onClick={() => saveCustomPortrait()}>{saveLabel("edit_portrait")}</Button>
          </div> : <div className="lwy-btns">
            <Button tone="default" disabled={busy} onClick={closeGallery}>{t("common.cancel", { defaultValue: "取消" })}</Button>
            <Button tone="primary" disabled={busy || (gallery === "fixed" && !chosenId)}
              onClick={async () => {
                const next = gallery === "fixed"
                  ? { ...portraitPrefs, mode: "fixed" as const, selected_id: chosenId }
                  : { ...portraitPrefs, pool_ids: poolDraft }
                if (await savePortraitPrefs(next)) setGallery("")
              }}>
              {saveLabel("set_portraits", gallery === "fixed" ? t("art.useImage", { defaultValue: "使用此立绘" }) : t("common.save", { defaultValue: "保存" }))}
            </Button>
          </div>}
          </>
        }>
        {customEdit ? <div className="lwy-custom-editor">
          <PortraitThumb item={customEdit} api={api} cache={thumbCache.current}
            loading={t("art.loading")} failed={t("art.imageError")} />
          <label className="lwy-field"><span>{t("art.imageName")}</span>
            <Input value={customName} disabled={busy} onChange={(value: string) => setCustomName(Array.from(value).slice(0, 120).join(""))} /></label>
          <label className="lwy-field"><span>{t("art.collection")}</span>
            <Input value={customGame} disabled={busy} onChange={(value: string) => setCustomGame(Array.from(value).slice(0, 80).join(""))} /></label>
          {deleteCustom ? <Alert tone="warning" message={t("art.deleteWarning", { name: customEdit.name })} /> : null}
        </div> : <div className="lwy-gallery">
          <div className="lwy-gallery-tools">
            <span className="lwy-note">{t("art.libraryCount", { n: library?.count || 0, games: library?.collections.length || 0 })}</span>
            <Button tone="default" disabled={busy} onClick={() => { setFeedback(null); setImportOpen(true) }}>
              <Icon name="Plus" />{t("art.import")}</Button>
          </div>
          <div className="lwy-gallery-filters">
            <label>
              <span>{t("art.collection", { defaultValue: "游戏" })}</span>
              <select className="neko-select" value={galleryCollection} disabled={busy} aria-label={t("art.collection")}
                onChange={(event: Event) => { setGalleryCollection((event.target as HTMLSelectElement).value); setGalleryPage(0) }}>
                {[
                { value: "", label: t("art.allCollections", { defaultValue: "全部游戏" }) },
                ...(library?.collections || []).map(name => ({ value: name, label: name })),
                ].map(option => <option key={option.value} value={option.value} selected={option.value === galleryCollection}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <span>{t("art.search", { defaultValue: "搜索" })}</span>
              <Input value={gallerySearch} disabled={busy} placeholder={t("art.searchPlaceholder", { defaultValue: "名称或游戏" })}
                onChange={(value: string) => { setGallerySearch(value.slice(0, 120)); setGalleryPage(0) }} />
            </label>
          </div>
          {gallery === "pool" ? (
            <div className="lwy-gallery-tools">
              <span className="lwy-note">{t("art.selectedCount", { n: poolDraft === null ? library?.count || 0 : poolDraft.length,
                defaultValue: "已选 {n} 张" })}</span>
              <div className="lwy-btns">
                <Button tone="default" disabled={busy} onClick={() => { setPoolDraft(null) }}>{t("art.selectAll", { defaultValue: "全部加入" })}</Button>
                <Button tone="default" disabled={busy} onClick={() => { setPoolDraft([]) }}>{t("art.clearPool", { defaultValue: "清空选择" })}</Button>
              </div>
            </div>
          ) : null}
          {galleryLoading ? <div className="lwy-gallery-state">{t("art.loading", { defaultValue: "加载中…" })}</div>
            : galleryError ? <div className="lwy-gallery-state">
              <Alert tone="warning" message={galleryError} />
              <Button tone="default" onClick={() => { setGalleryRetry(galleryRetry + 1) }}>{t("art.retry", { defaultValue: "重试" })}</Button>
            </div>
            : !galleryData?.items.length ? <div className="lwy-gallery-state">{t("art.noResults", { defaultValue: "没有符合条件的立绘。" })}</div>
            : <div className="lwy-gallery-grid">
              {galleryData.items.map(item => {
                const selected = gallery === "pool" ? poolDraft === null || poolDraft.includes(item.id) : chosenId === item.id
                const content = <PortraitThumb item={item} api={api} cache={thumbCache.current}
                  loading={t("art.loading", { defaultValue: "加载中…" })}
                  failed={t("art.imageError", { defaultValue: "图片加载失败，请重试。" })} />
                const choice = gallery === "pool" ? (
                  <label key={item.id} className={selected ? "lwy-portrait-choice chosen" : "lwy-portrait-choice"}>
                    <input type="checkbox" checked={selected} disabled={busy} onChange={() => {
                      const ids = poolDraft === null ? library?.ids || [] : poolDraft
                      setPoolDraft(selected ? ids.filter(id => id !== item.id) : [...ids, item.id])
                    }} />
                    {content}<span className="lwy-portrait-name">{item.name}<small>{item.collection}</small></span>
                  </label>
                ) : (
                  <button type="button" key={item.id} disabled={busy} aria-pressed={selected ? "true" : "false"}
                    className={selected ? "lwy-portrait-choice chosen" : "lwy-portrait-choice"} onClick={() => setChosenId(item.id)}>
                    {content}<span className="lwy-portrait-name">{item.name}<small>{item.collection}</small></span>
                  </button>
                )
                return <div className="lwy-portrait-tile" key={item.id}>{choice}
                  {item.custom ? <button type="button" className="lwy-icon-button" disabled={busy}
                    title={t("art.editNamed", { name: item.name })} aria-label={t("art.editNamed", { name: item.name })}
                    onClick={() => editPortrait(item)}><Icon name="Pencil" /></button> : null}
                </div>
              })}
            </div>}
          {galleryData && !galleryLoading && !galleryError ? (
            <div className="lwy-gallery-pager">
              <span className="lwy-note">{t("art.pageCount", { page: galleryData.page + 1, pages: galleryData.pages, total: galleryData.total,
                defaultValue: "第 {page} / {pages} 页 · 共 {total} 张" })}</span>
              <div className="lwy-btns">
                <button type="button" className="lwy-icon-button" disabled={busy || galleryData.page === 0}
                  title={t("art.previous", { defaultValue: "上一页" })} aria-label={t("art.previous", { defaultValue: "上一页" })}
                  onClick={() => setGalleryPage(galleryData.page - 1)}><Icon name="ChevronLeft" /></button>
                <button type="button" className="lwy-icon-button" disabled={busy || galleryData.page + 1 >= galleryData.pages}
                  title={t("art.next", { defaultValue: "下一页" })} aria-label={t("art.next", { defaultValue: "下一页" })}
                  onClick={() => setGalleryPage(galleryData.page + 1)}><Icon name="ChevronRight" /></button>
              </div>
            </div>
          ) : null}
        </div>}
      </Modal>

      <Modal
        open={editing}
        size="sm"
        title={t("adjust.title", { defaultValue: "调整好感" })}
        onClose={closeEditing}
        closeOnEscape={!busy} closeOnBackdrop={!busy}
        footer={
          <>
          {renderFeedback(true)}
          <div className="lwy-btns">
            <Button tone="default" disabled={busy} onClick={closeEditing}>{t("common.cancel", { defaultValue: "取消" })}</Button>
            <Button tone="primary" disabled={busy || draft === "" || !scopes.some(item => item.key === dialogScope)} onClick={saveDraft}>
              {saveLabel("set_affection")}
            </Button>
          </div>
          </>
        }
      >
        <label className="lwy-field lwy-adjust-number">
          <span>{t("common.affection", { defaultValue: "好感度" })} · {scopes.find(item => item.key === dialogScope)?.label || t("scope.shared", { defaultValue: "共用" })}</span>
          <NumberInput value={draft} min={0} max={100} step={1} disabled={busy}
            onChange={(value: number | string) => setDraft(value === "" ? "" : Math.max(0, Math.min(100, Math.round(Number(value) || 0))))} />
        </label>
        <label className="lwy-field">
          <span>{t("settings.adjust", { defaultValue: "调整" })}</span>
          <Slider value={draft === "" ? 0 : draft} min={0} max={100} step={1} disabled={busy}
            showValue={false} onChange={(value: number) => setDraft(value)} />
        </label>
        {draft !== "" ? <div className="lwy-adjust-preview">
          <span>{scopes.find(item => item.key === dialogScope)?.affection ?? 0}</span>
          <Icon name="ChevronRight" />
          <strong>{draft}</strong>
          <span className="lwy-note">
            {t("adjust.change", { delta: Number(draft) - (scopes.find(item => item.key === dialogScope)?.affection || 0),
              defaultValue: "变化 {delta} 点" })}
          </span>
        </div> : null}
        <p className="lwy-note">{t("adjust.note", { defaultValue: "手动调整不受每日上限限制，阶段会直接按新数值计算。" })}</p>
      </Modal>

      <Modal
        open={metOpen}
        size="sm"
        title={t("dates.editMet", { defaultValue: "修改相识日" })}
        onClose={closeMet}
        closeOnEscape={!busy} closeOnBackdrop={!busy}
        footer={
          <>
          {renderFeedback(true)}
          <div className="lwy-btns">
            <Button tone="default" disabled={busy} onClick={closeMet}>{t("common.cancel", { defaultValue: "取消" })}</Button>
            <Button tone="primary" disabled={busy || !parseIsoDay(metDraft) || metDraft < "1970-01-01" || Boolean(state.today && metDraft > state.today) || !scopes.some(item => item.key === dialogScope)} onClick={saveFirstMet}>
              {saveLabel("set_first_met")}
            </Button>
          </div>
          </>
        }
      >
        <p className="lwy-sub">{scopes.find(item => item.key === dialogScope)?.label ||
          t("scope.shared", { defaultValue: "共用" })}</p>
        <fieldset className="lwy-met-options" disabled={busy}>
          <legend>{t("dates.dateChoice")}</legend>
          <label className="lwy-met-option">
            <input type="radio" name="lwy-met-source" value="plugin" checked={metSource === "plugin"}
              disabled={!metOptions.plugin || busy} onChange={() => chooseMetSource("plugin")} />
            <span>{t(metOptions.legacy ? "dates.legacyDate" : "dates.pluginDate")}
              <small>{isoLabel(metOptions.plugin)}</small></span>
          </label>
          <label className="lwy-met-option">
            <input type="radio" name="lwy-met-source" value="host" checked={metSource === "host"}
              disabled={!metOptions.host || busy} onChange={() => chooseMetSource("host")} />
            <span>{t("dates.savedHostDate")}
              <small>{metOptions.host ? isoLabel(metOptions.host) : t("dates.noSavedHostDate")}</small></span>
          </label>
          <label className="lwy-met-option">
            <input type="radio" name="lwy-met-source" value="custom" checked={metSource === "custom"}
              onChange={() => chooseMetSource("custom")} />
            <span>{t("dates.customDate")}</span>
          </label>
        </fieldset>
        {metOptions.legacy ? <p className="lwy-note">{t("dates.legacyDateNote")}</p> : null}
        <label className="lwy-field">
          <span>{t("dates.metLabel", { defaultValue: "你们相识的日子" })}</span>
          <input className="neko-input" type="date" value={metDraft} min="1970-01-01" max={state.today} disabled={busy || metSource !== "custom"}
            onInput={(event: Event) => {
              const value = (event.target as HTMLInputElement).value
              setMetDraft(value)
              setMetCustomDraft(value)
            }} />
        </label>
        <p className="lwy-note">{t("dates.metNote", { defaultValue: "相识日决定「相识第 N 天」和周年纪念，不影响好感。" })}</p>
        {metDraft && (!parseIsoDay(metDraft) || metDraft < "1970-01-01" || Boolean(state.today && metDraft > state.today)) ? (
          <p className="lwy-field-error" role="alert">{metDraft < "1970-01-01"
            ? t("error.date_too_old", { defaultValue: "日期太早了" })
            : state.today && metDraft > state.today ? t("error.date_in_future", { defaultValue: "日期不能晚于今天" })
              : t("error.invalid_date", { defaultValue: "日期无效" })}</p>
        ) : null}
      </Modal>

      <Modal
        open={metImportOpen}
        size="sm"
        title={t("dates.importMet")}
        onClose={closeMetImport}
        closeOnEscape={!busy} closeOnBackdrop={!busy}
        footer={<>
          {renderFeedback(true)}
          <div className="lwy-btns">
            <Button tone="default" disabled={busy} onClick={closeMetImport}>{t("common.cancel", { defaultValue: "取消" })}</Button>
            <Button tone="default" disabled={busy || !scopes.some(item => item.key === dialogScope)}
              onClick={() => previewFirstMet(dialogScope)}><Icon name="RotateCw" />{t("dates.historyRetry")}</Button>
            <Button tone="primary" disabled={busy || !metImport ||
              !scopes.some(item => item.key === metImport.scope)} onClick={importFirstMet}>
              {saveLabel("set_first_met", t("dates.confirmImport"))}
            </Button>
          </div>
        </>}
      >
        <p className="lwy-sub">{scopes.find(item => item.key === dialogScope)?.label ||
          t("scope.shared", { defaultValue: "共用" })}</p>
        {metImport ? <dl className="lwy-import-dates">
          <div><dt>{t("dates.currentMet")}</dt><dd>{isoLabel(metImport.previous_date)}</dd></div>
          <div><dt>{t("dates.historyMet")}</dt><dd><strong>{isoLabel(metImport.date)}</strong></dd></div>
          <div><dt>{t("dates.historySource")}</dt><dd>{t("dates.historySourceValue", { name: metImport.character })}</dd></div>
        </dl> : null}
        <p className="lwy-note">{t("dates.historyNote")}</p>
      </Modal>

      <Modal
        open={annOpen}
        size="sm"
        title={t("dates.addTitle", { defaultValue: "添加纪念日" })}
        onClose={closeAnn}
        closeOnEscape={!busy} closeOnBackdrop={!busy}
        footer={
          <>
          {renderFeedback(true)}
          <div className="lwy-btns">
            <Button tone="default" disabled={busy} onClick={closeAnn}>{t("common.cancel", { defaultValue: "取消" })}</Button>
            <Button tone="primary" disabled={busy || !annTitle.trim() || !parseIsoDay(annDate)} onClick={addAnniversary}>
              {saveLabel("add_anniversary", t("dates.add", { defaultValue: "添加" }))}
            </Button>
          </div>
          </>
        }
      >
        <label className="lwy-field">
          <span>{t("dates.titleLabel", { defaultValue: "名称" })}</span>
          <Input
            value={annTitle}
            disabled={busy}
            placeholder={t("dates.titlePlaceholder", { defaultValue: "例如：我的生日" })}
            onChange={(value: string) => setAnnTitle(Array.from(value).slice(0, limits.title_chars || 20).join(""))}
          />
        </label>
        <label className="lwy-field">
          <span>{t("dates.dateLabel", { defaultValue: "日期" })}</span>
          <Input type="date" value={annDate} disabled={busy} onChange={(value: string) => setAnnDate(value)} />
        </label>
        <p className="lwy-note">{t("dates.yearIgnored", { defaultValue: "每年重复，只看月和日。" })}</p>
      </Modal>
    </div>
  )
}
