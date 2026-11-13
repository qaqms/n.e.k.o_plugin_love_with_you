import { ROUTES } from "./skills.mjs"

const messages = {
  adventure_stale: "进度已在另一个窗口更新，请重新读取。",
  adventure_controlled_elsewhere: "这场冒险正在另一个窗口中进行。",
  adventure_control_lost: "控制已转移到另一个窗口，请重新读取。",
  adventure_session_expired: "插件已重启，请重新读取进度。",
  adventure_run_closed: "这场冒险已经结束，请重新读取。",
  adventure_save_failed: "进度暂未保存，请保留窗口并重试。",
  adventure_recovery_required: "冒险存档需要恢复，原文件已保留。关系与礼物数据不受影响。",
  adventure_character_unknown: "同行角色已发生变化，请重新读取。",
  adventure_invalid_snapshot: "无法核对这次进度，请保留窗口。",
  adventure_rules_unsupported: "这场冒险的规则版本不匹配，请重新读取。",
  adventure_insufficient_coins: "冒险金币不足，请先完成更多旅程。",
  adventure_upgrade_maxed: "这项强化已达到上限，请重新读取商店。",
  adventure_nothing_to_refund: "这项强化还没有购买，请重新读取商店。",
  adventure_shop_during_run: "旅程结束后才能购买或退还强化。",
  adventure_economy_limit: "冒险金币已达到存档上限，请保留进度。",
  adventure_invalid_economy: "无法核对冒险金币与强化配置，请重新读取。",
  not_ready: "插件当前未运行，请启动后重新读取。",
}

const STAT_KEYS = ["vitality", "power", "stride", "reach"]
const integer = (value, max = 1e12) => Number.isSafeInteger(value) && value >= 0 && value <= max
const object = value => value && typeof value === "object" && !Array.isArray(value)
const sameKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))

export function validCatalog(shop) {
  return Array.isArray(shop) && shop.length === STAT_KEYS.length
    && new Set(shop.map(item => item?.id)).size === STAT_KEYS.length
    && shop.every(item => object(item) && STAT_KEYS.includes(item.id)
      && typeof item.name === "string" && item.name.length > 0 && item.name.length <= 100
      && typeof item.scope === "string" && item.scope.length > 0 && item.scope.length <= 100
      && integer(item.cap, 5) && item.cap > 0 && integer(item.percent, 30) && item.percent > 0
      && Array.isArray(item.prices) && item.prices.length === item.cap
      && item.prices.every(price => integer(price, 1e6) && price > 0))
}

export function validEconomy(value, shop) {
  if (!validCatalog(shop) || !sameKeys(value, ["balance", "earned", "levels"])
    || !integer(value.balance) || !integer(value.earned) || !sameKeys(value.levels, STAT_KEYS)) return false
  let invested = 0
  for (const item of shop) {
    if (!integer(value.levels[item.id], item.cap)) return false
    invested += item.prices.slice(0, value.levels[item.id]).reduce((a, b) => a + b, 0)
  }
  return value.balance + invested === value.earned
}

function validLoadout(value, shop) {
  return sameKeys(value, ["levels", "bonuses"]) && sameKeys(value.levels, STAT_KEYS)
    && sameKeys(value.bonuses, STAT_KEYS) && shop.every(item =>
      integer(value.levels[item.id], item.cap) && value.bonuses[item.id] === value.levels[item.id] * item.percent)
}

export function validSettlement(value, snapshot) {
  if (!sameKeys(value, ["formula", "minutes", "survival", "clear", "total"]) || !object(snapshot)
    || !integer(snapshot.elapsed, 1200000)) return false
  const minutes = Math.floor(snapshot.elapsed / 60000), clear = snapshot.outcome === "cleared" ? 80 : 0
  return value.formula === 1 && value.minutes === minutes && value.survival === minutes * 6
    && value.clear === clear && value.total === minutes * 6 + clear
}

export function decode(value) {
  for (let depth = 0; depth < 5; depth++) {
    if (!value || typeof value !== "object" || Array.isArray(value)) break
    if (Object.hasOwn(value, "adventure")) return value.adventure
    const key = ["result", "data", "value"].find(key => Object.hasOwn(value, key))
    if (!key) break
    value = value[key]
  }
  throw new Error("无法核对操作结果，请保留窗口并确认上次操作。")
}

export function errorText(error) {
  for (const text of [String(error?.code || ""), String(error?.message || error)]) {
    for (const [code, message] of Object.entries(messages)) {
      if (new RegExp(`(^|[^A-Za-z0-9_])${code}($|[^A-Za-z0-9_])`).test(text)) return message
    }
  }
  const text = String(error?.message || error?.code || error)
  return text.length < 160 ? text : "连接失败，请保留窗口并重试。"
}

export class AdventureApi {
  constructor() {
    // Each document gets a new identity: duplicating a tab must not duplicate control.
    this.client = crypto.randomUUID()
    this.view = null
    this.pending = null
    this.pendingView = null
  }

  async call(args) {
    let response
    if (window.parent !== window) {
      response = await new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID()
        const timer = setTimeout(() => {
          cleanup()
          reject(new Error("连接超时，请确认上次操作。"))
        }, 15000)
        const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", listener) }
        const listener = event => {
          if (event.source !== window.parent || event.origin !== location.origin) return
          const data = event.data
          if (data?.type !== "neko-hosted-surface-response" || data.requestId !== requestId) return
          cleanup()
          if (data.ok) resolve(data.result)
          else reject(Object.assign(new Error(data.error || "连接失败"), { code: data.code }))
        }
        window.addEventListener("message", listener)
        window.parent.postMessage({
          type: "neko-hosted-surface-request", requestId, method: "call",
          payload: { actionId: "adventure_action", args }, timeoutMs: 14000, userInitiated: false,
        }, location.origin)
      })
    } else {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      try {
        const result = await fetch("/plugin/love_with_you/hosted-ui/action/adventure_action", {
          method: "POST", credentials: "same-origin", signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "panel", surface_id: "adventure", args }),
        })
        response = await result.json()
        if (!result.ok) {
          const detail = response.detail || response.error || response
          throw Object.assign(new Error(detail.message || `连接失败 (${result.status})`), { code: detail.code })
        }
      } finally { clearTimeout(timer) }
    }
    return decode(response)
  }

  async read() {
    const view = await this.call({ operation: "read", client: this.client })
    if (!view || !Number.isSafeInteger(view.revision) || typeof view.epoch !== "string"
      || !Array.isArray(view.characters) || typeof view.owns_control !== "boolean"
      || ![1, 2, 3, 4, 5, 6, 7].includes(view.rules) || !view.characters.every(name => typeof name === "string" && name.length <= 100)
      || !Object.hasOwn(view, "run") || !validEconomy(view.economy, view.shop)
      || (view.run !== null && (!object(view.run) || !validLoadout(view.run.loadout, view.shop)
        || !["active", "ended"].includes(view.run.status) || ![1, 2, 3, 4, 5, 6, 7].includes(view.run.rules ?? 1)
        || (view.run.rules === 6 && ["player", "companion"].some(owner =>
          typeof view.run[`${owner}_route`] !== "string" || !Object.hasOwn(ROUTES, view.run[`${owner}_route`])
          || ROUTES[view.run[`${owner}_route`]].class !== view.run[`${owner}_class`]))
        || (view.run.settlement !== null && (view.run.status !== "ended"
          || !validSettlement(view.run.settlement, view.run.snapshot)))))) {
      throw new Error("进度响应不完整，请重新读取。")
    }
    this.view = view
    return view
  }

  async mutate(operation, values) {
    if (!this.view) throw new Error("请先读取进度。")
    if (this.pending) throw new Error("请先确认上次操作。")
    this.pending = {
      operation, values: structuredClone(values), request_id: crypto.randomUUID(),
      revision: this.view.revision, epoch: this.view.epoch, client: this.client,
    }
    this.pendingView = structuredClone({
      economy: this.view.economy, shop: this.view.shop,
      run: this.view.run ? { id: this.view.run.id, snapshot: { elapsed: this.view.run.snapshot?.elapsed || 0 } } : null,
    })
    return this.retry()
  }

  async retry() {
    const args = this.pending
    if (!args) return
    const result = await this.call(args)
    const shopAction = args.operation === "buy" || args.operation === "refund"
    const before = this.pendingView
    const validRunId = shopAction ? result?.run_id === (before.run?.id ?? null)
      : typeof result?.run_id === "string" && /^[A-Za-z0-9_-]{12,80}$/.test(result.run_id)
    if (!result || result.operation !== args.operation || result.request_id !== args.request_id
      || result.revision !== args.revision + 1 || !validRunId
      || (args.values.run_id && result.run_id !== args.values.run_id)
      || !Number.isSafeInteger(result.elapsed)
      || (args.values.snapshot && result.elapsed !== args.values.snapshot.elapsed)) {
      throw new Error("无法核对保存结果，请确认上次操作。")
    }
    if (shopAction || args.operation === "finish") {
      if (!validEconomy(result.economy, before.shop)) throw new Error("无法核对金币，请确认上次操作。")
      let change = 0
      const expectedLevels = { ...before.economy.levels }
      if (shopAction) {
        const item = before.shop.find(item => item.id === args.values.upgrade)
        const level = args.values.level, next = level + (args.operation === "buy" ? 1 : -1)
        const amount = item?.prices[Math.min(level, next)], t = result.transaction
        if (!item || !integer(level, item.cap) || !integer(next, item.cap) || !integer(amount, 1e6)
          || !sameKeys(t, ["upgrade", "before", "after", "amount"])
          || before.economy.levels[item.id] !== level || t.upgrade !== item.id
          || t.before !== level || t.after !== next || t.amount !== amount
          || result.elapsed !== (before.run?.snapshot?.elapsed ?? 0)) {
          throw new Error("无法核对强化交易，请确认上次操作。")
        }
        expectedLevels[item.id] = next
        change = amount * (args.operation === "buy" ? -1 : 1)
      } else {
        if (!validSettlement(result.settlement, args.values.snapshot)) throw new Error("无法核对奖励，请确认上次操作。")
        change = result.settlement.total
      }
      if (result.economy.balance !== before.economy.balance + change
        || result.economy.earned !== before.economy.earned + (shopAction ? 0 : change)
        || STAT_KEYS.some(key => result.economy.levels[key] !== expectedLevels[key])) {
        throw new Error("金币或强化数量不符，请确认上次操作。")
      }
      this.view.economy = structuredClone(result.economy)
    }
    this.view.revision = result.revision
    this.pending = null
    this.pendingView = null
    return result
  }
}
