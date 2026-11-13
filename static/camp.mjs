import { icon } from "./icons.mjs"

const LABELS = { vitality: "生命", power: "攻击", stride: "移动", reach: "拾取" }
const ICONS = { vitality: "Heart", power: "Swords", stride: "Footprints", reach: "Magnet" }
const coins = value => value.toLocaleString("zh-CN")

export function element(tag, text, className = "") {
  const node = document.createElement(tag)
  node.textContent = text
  if (className) node.className = className
  return node
}

export function button(text, action, className = "", symbol = "") {
  const node = element("button", "", className)
  node.type = "button"
  if (symbol) node.append(icon(symbol))
  if (text) node.append(element("span", text))
  node.addEventListener("click", action)
  return node
}

export function wallet(economy) {
  const row = element("div", "", "wallet")
  row.append(icon("Coins"), element("span", "冒险金币"), element("strong", coins(economy.balance)))
  return row
}

export function loadoutSummary(view) {
  const bonuses = view.run?.status === "active" ? view.run.loadout.bonuses
    : Object.fromEntries(view.shop.map(item => [item.id, item.percent * view.economy.levels[item.id]]))
  const summary = element("div", "", "loadout-summary")
  summary.append(element("span", view.run?.status === "active" ? "本局出征加成" : "下局出征加成", "muted"))
  for (const [key, label] of Object.entries(LABELS)) {
    summary.append(element("span", `${label} +${bonuses[key]}%`))
  }
  return summary
}

export function settlementDetails(settlement) {
  const details = element("div", "", "settlement")
  if (settlement === null) {
    details.append(element("p", "此旅程在旧版结束，未发放冒险金币。", "muted"))
    return details
  }
  details.append(element("strong", `冒险金币 +${settlement.total}`, "reward-total"),
    element("span", `生存 ${settlement.minutes} 分钟：${settlement.survival} · 通关：${settlement.clear}`, "muted"))
  return details
}

export function renderShop(body, view, onTrade, onBack) {
  const active = view.run?.status === "active"
  const balance = wallet(view.economy)
  balance.append(element("span", `累计获得 ${coins(view.economy.earned)}`, "muted"))
  body.append(balance, element("p", active
    ? "旅程进行中 · 结束后可调整强化"
    : "强化用于之后的新旅程 · 退还按购买价全额返还", "muted"))
  const list = element("div", "", "shop-list")
  for (const item of view.shop) {
    const level = view.economy.levels[item.id], maxed = level === item.cap
    const row = element("article", "", "shop-row")
    row.dataset.product = item.id
    const art = element("div", "", "shop-symbol"); art.append(icon(ICONS[item.id]))
    const info = element("div", "", "shop-info")
    info.append(element("h3", item.name), element("p", `${item.scope} · 每阶 +${item.percent}%`, "muted"))
    const growth = element("div", "", "shop-growth")
    growth.append(element("strong", `+${level * item.percent}%`),
      element("span", `${level} / ${item.cap} 阶`, "muted"))
    const ticks = element("div", "", "rank-track")
    ticks.setAttribute("aria-hidden", "true")
    for (let rank = 0; rank < item.cap; rank++) ticks.append(element("span", "", rank < level ? "filled" : ""))
    growth.append(ticks)
    const actions = element("div", "", "shop-actions")
    const buy = button(maxed ? "已满阶" : `强化 · ${item.prices[level]}`, () => onTrade("buy", item.id, level),
      "buy-upgrade", maxed ? "Check" : "Plus")
    buy.disabled = active || maxed || view.economy.balance < item.prices[level]
    buy.setAttribute("aria-label", maxed ? `${item.name}已满阶` : `强化${item.name}，花费${item.prices[level]}冒险金币`)
    buy.title = active ? "旅程结束后可调整" : maxed ? "已达到强化上限"
      : view.economy.balance < item.prices[level] ? "冒险金币不足" : `下阶 +${(level + 1) * item.percent}%`
    const refund = button("", () => onTrade("refund", item.id, level), "icon-button refund-upgrade", "Undo2")
    refund.disabled = active || level === 0
    refund.title = level ? `退还${item.name}一阶，返还${item.prices[level - 1]}冒险金币` : `${item.name}尚未强化`
    refund.setAttribute("aria-label", refund.title)
    actions.append(buy, refund)
    row.append(art, info, growth, actions)
    list.append(row)
  }
  body.append(list, loadoutSummary(view))
  const actions = element("div", "", "actions")
  actions.append(button("返回营地", onBack, "", "ArrowLeft"))
  body.append(actions)
}
