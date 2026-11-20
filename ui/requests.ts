import type { HostedApi } from "@neko/plugin-ui"

export type RunAction = (action: string, args: Record<string, unknown>,
  success: string | ((value: any) => string), acknowledged?: () => void) => Promise<boolean>

export const SHOP_ERRORS = ["shop_stale", "shop_already_claimed", "shop_insufficient_coins", "shop_inventory_full",
  "shop_no_stock", "shop_daily_limit", "shop_no_affection_room", "shop_unknown_character",
  "shop_invalid_request", "shop_item_not_found", "shop_gift_not_found", "shop_reaction_wait", "shop_not_ready",
  "shop_reward_unavailable", "shop_gain_changed", "shop_gesture_limit"]
export const EXPERIENCE_ERRORS = [
  "experience_invalid_date", "experience_invalid", "experience_stale", "experience_disabled",
  "experience_limit", "experience_note_active", "experience_not_found", "experience_cooldown",
  "experience_duplicate", "experience_save_failed", "experience_recovery_required",
]
const ERROR_CODES = new Set([
  ...SHOP_ERRORS, ...EXPERIENCE_ERRORS, "invalid_response",
  "date_in_future", "date_too_old", "invalid_date", "title_required", "too_many", "not_found",
  "invalid_nicknames", "invalid_addressing", "nickname_required", "nickname_blocked", "nickname_conflict",
  "first_met_conflict", "relationship_changed", "invalid_first_met_source",
  "host_history_unavailable", "host_history_incomplete", "host_history_empty",
  "per_character_off", "shared_not_in_use", "unknown_scope", "current_character_unknown", "invalid_settings",
  "portrait_invalid_settings", "portrait_not_found", "portrait_too_large", "portrait_not_ready",
  "portrait_save_failed", "portrait_invalid_image", "portrait_source_too_large", "portrait_library_full",
  "portrait_custom_only", "appearance_invalid_settings", "appearance_not_ready", "appearance_save_failed",
])
const REJECTIONS = new Set([...SHOP_ERRORS, ...EXPERIENCE_ERRORS])
const CONFLICTS = new Set(["shop_stale", "shop_no_affection_room", "shop_gain_changed", "shop_already_claimed",
  "shop_reward_unavailable", "nickname_conflict", "first_met_conflict", "relationship_changed", "experience_stale"])

export function errorCode(error: any): string | undefined {
  if (typeof error?.code === "string" && ERROR_CODES.has(error.code)) return error.code
  const tokens = String(error?.message || error || "").match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || []
  // Match complete codes; e.g. shop_stale_extra cannot acknowledge shop_stale.
  return tokens.find(code => ERROR_CODES.has(code))
}

export function unwrap(value: any, key: string): any {
  let current = value
  for (let depth = 0; depth < 5 && current && typeof current === "object" && !Array.isArray(current); depth++) {
    if (Object.prototype.hasOwnProperty.call(current, key)) return current
    current = current.result ?? current.data ?? current.value
  }
  throw new Error("invalid_response")
}

type ActionOutcome = { saved: true; message: string; stale: boolean } |
  { saved: false; error: unknown; stale: boolean }

export async function submitAction(
  api: HostedApi, action: string, args: Record<string, unknown>,
  describe: string | ((value: any) => string), acknowledged?: () => void, refreshing?: () => void,
): Promise<ActionOutcome> {
  let response: unknown
  try {
    response = await api.call(action, args, { userInitiated: true })
  } catch (error) {
    const code = errorCode(error)
    if (REJECTIONS.has(code)) acknowledged?.()
    return { saved: false, error, stale: CONFLICTS.has(code) }
  }
  let message: string
  try {
    message = typeof describe === "string" ? describe : describe(response)
  } catch {
    // The action may already be durable. Keep its original request for replay.
    return { saved: false, error: new Error("invalid_response"), stale: true }
  }
  acknowledged?.()
  refreshing?.()
  try {
    await api.refresh()
    return { saved: true, message, stale: false }
  } catch {
    return { saved: true, message, stale: true }
  }
}
