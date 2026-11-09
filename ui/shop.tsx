import { Alert, Button, Modal, useCallback, useEffect, useRef, useState } from "@neko/plugin-ui"
import type { PluginSurfaceProps } from "@neko/plugin-ui"
import { Icon } from "./icons"

type Product = { id: string; price: number; gain: number; icon: string; quantity: number }
type Gift = {
  id: string; item_id: string; character: string; applied: number; ts: number
  reaction: string; can_retry: boolean; attempts: number; requested_at: number
}
export type ShopState = {
  coins: number; revision: number; daily_coins: number; can_claim: boolean
  gift_remaining: number; gift_daily_cap: number; inventory_limit: number
  catalog: Product[]; history: Gift[]
  income_total: number; can_gesture: boolean; bus_ok: boolean | null; income_error?: string
  income: {
    count: number; earned: number; paid: number; steps: Array<{ turns: number; coins: number }>
    weekly_days: number; weekly_goal: number; weekly_coins: number; weekly_paid: boolean
    legacy_claimed: boolean; clock_error: boolean
  }
  ledger: Array<{ id: string; source: string; amount: number; balance: number; ts: number; item_id: string; day: string }>
}
type Request = { action: string; args: Record<string, unknown> }
type Run = (action: string, args: Record<string, unknown>, success: string | ((value: any) => string),
  acknowledged?: () => void) => Promise<boolean>

export const SHOP_ERRORS = ["shop_stale", "shop_already_claimed", "shop_insufficient_coins", "shop_inventory_full",
  "shop_no_stock", "shop_daily_limit", "shop_no_affection_room", "shop_unknown_character",
  "shop_invalid_request", "shop_item_not_found", "shop_gift_not_found", "shop_reaction_wait", "shop_not_ready",
  "shop_income_automatic", "shop_gain_changed", "shop_gesture_limit"]

export const SHOP_STYLE = `
.lwy-shop-wallet { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap;
  padding-bottom:20px; border-bottom:1px solid var(--line); }
.lwy-shop-balance { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.lwy-shop-balance strong { font-size:26px; line-height:1.3; font-variant-numeric:tabular-nums; }
.lwy-shop-balance .lwy-icon { color:var(--warning); width:24px; height:24px; }
.lwy-shop-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:16px; justify-content:space-between; }
.lwy-shop-modes { display:flex; flex-wrap:wrap; gap:4px; border-bottom:1px solid var(--line); min-width:0; }
.lwy-shop-modes button { border:0; border-bottom:2px solid transparent; background:transparent; font:inherit;
  padding:10px 12px; color:var(--hint); cursor:pointer; }
.lwy-shop-modes button[aria-pressed="true"] { color:var(--accent-strong); border-color:var(--accent-strong); font-weight:600; }
.lwy-shop-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr)); gap:14px; }
.lwy-shop-product { display:flex; flex-direction:column; gap:12px; min-width:0; padding:18px;
  border:1px solid var(--line); border-radius:8px; background:var(--card); }
.lwy-shop-product h3 { margin:0; font-size:16px; line-height:1.5; overflow-wrap:anywhere; }
.lwy-shop-product p { margin:0; color:var(--hint); font-size:13px; overflow-wrap:anywhere; }
.lwy-shop-art { display:grid; place-items:center; height:88px; border-radius:6px; background:var(--accent-soft); color:var(--accent-strong); }
.lwy-shop-art .lwy-icon { width:44px; height:44px; }
.lwy-shop-product[data-product="tea"] .lwy-shop-art { color:var(--gain); background:var(--surface-strong); }
.lwy-shop-product[data-product="flowers"] .lwy-shop-art { color:var(--danger); background:var(--surface-strong); }
.lwy-shop-product[data-product="book"] .lwy-shop-art { color:var(--warning); background:var(--surface-strong); }
.lwy-shop-product .neko-button { width:100%; margin-top:auto; }
.lwy-shop-meta { display:flex; flex-wrap:wrap; gap:6px 16px; justify-content:space-between; font-size:13px; }
.lwy-shop-recipient { display:grid; gap:6px; min-width:0; max-width:100%; }
.lwy-shop-log { padding:16px 0; border-bottom:1px solid var(--line); display:grid; gap:8px; min-width:0; }
.lwy-shop-log-head { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; }
.lwy-shop-log-head strong, .lwy-shop-log p { overflow-wrap:anywhere; margin:0; }
.lwy-shop-log-status { display:flex; align-items:center; flex-wrap:wrap; gap:8px; color:var(--hint); font-size:13px; }
.lwy-shop-confirm { display:grid; gap:14px; }
.lwy-shop-confirm .lwy-shop-art { height:100px; }
.lwy-shop-income { display:grid; gap:14px; padding-bottom:18px; border-bottom:1px solid var(--line); }
.lwy-shop-income-head, .lwy-shop-week { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
.lwy-shop-income-steps { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
.lwy-shop-step { display:grid; gap:6px; min-width:0; font-size:13px; overflow-wrap:anywhere; }
.lwy-shop-step progress { width:100%; height:6px; accent-color:var(--accent); }
.lwy-shop-step strong { font-size:14px; }
.lwy-shop-income-notice:empty { display:none; }
.lwy-shop-partial { margin:0; color:var(--warning); }
.lwy-shop-smaller { display:flex; flex-wrap:wrap; gap:8px; }
.lwy-shop-ledger-amount { font-variant-numeric:tabular-nums; }
@media(max-width:479px) { .lwy-shop-product { padding:14px; } .lwy-shop-toolbar { align-items:stretch; }
  .lwy-shop-recipient { width:100%; } .lwy-shop-wallet > .neko-button { width:100%; } }
`

function resultOf(value: any): any {
  let current = value
  for (let n = 0; n < 5 && current && typeof current === "object"; n++) {
    if ("reaction" in current || "credited" in current || "quantity" in current || "applied" in current) return current
    current = current.result ?? current.data ?? current.value
  }
  throw new Error("shop_invalid_response")
}

export function Shop(props: {
  data?: ShopState; characters: string[]; current?: string | null; perCharacter: boolean
  scopes: Array<{ label: string | null; affection: number; gained_today: number; is_current: boolean
    gained_chat?: number; chat_room?: number; gift_room?: number; gain_revision?: number; quota_blocked?: boolean; clock_error?: boolean }>
  dailyGain: number; dailyChat: number; api: PluginSurfaceProps["api"]; t: PluginSurfaceProps["t"]
  useLocalState: PluginSurfaceProps["useLocalState"]; busy: boolean; stale: boolean; run: Run
  refresh: () => Promise<void>; dialog: (open: boolean) => void; feedback: () => any
  beginEdit: () => void
}) {
  const { t, data, run } = props
  const [tab, setTab] = props.useLocalState<string>("lwy:shop-tab", "store")
  const [recipient, setRecipient] = props.useLocalState<string>("lwy:gift-recipient", "")
  const [pending, setPending] = props.useLocalState<Request | null>("lwy:shop-request", null)
  const requestRef = useRef<Request | null>(pending)
  requestRef.current = pending
  const [selection, setSelection] = useState<{ product: Product; character: string; gesture: boolean } | null>(null)
  const [gesture, setGesture] = props.useLocalState<boolean>("lwy:gift-gesture", false)
  const [incomeNotice, setIncomeNotice] = useState("")
  const seenIncome = useRef(data?.income_total)
  const locked = useRef(props.busy)
  locked.current = props.busy
  const close = useCallback(() => {
    if (!locked.current) setSelection(null)
  }, [])
  useEffect(() => { props.dialog(Boolean(selection)); return () => props.dialog(false) }, [Boolean(selection)])
  const characters = [...new Set([props.current || "", ...props.characters].filter(Boolean))]
  const character = characters.includes(recipient) ? recipient : props.current || characters[0] || ""
  const productName = (id: string) => t(`shop.item.${id}`)
  const hasWaiting = data?.history.some(gift => ["pending", "submitted"].includes(gift.reaction) ||
    (["unavailable", "unknown"].includes(gift.reaction) && !gift.can_retry && gift.attempts < 3))
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (!locked.current && document.visibilityState !== "hidden") {
        try { await props.api.refresh() } catch { /* The next visible poll can recover. */ }
      }
      if (alive) timer = setTimeout(poll, 5000)
    }
    timer = setTimeout(poll, 5000)
    return () => { alive = false; clearTimeout(timer) }
  }, [hasWaiting])
  useEffect(() => {
    if (data && seenIncome.current !== undefined && data.income_total > seenIncome.current) {
      setIncomeNotice(t("shop.incomeReceived", { n: data.income_total - seenIncome.current }))
    }
    seenIncome.current = data?.income_total
  }, [data?.income_total])
  useEffect(() => {
    if (!incomeNotice) return
    const timer = setTimeout(() => setIncomeNotice(""), 6000)
    return () => clearTimeout(timer)
  }, [incomeNotice])
  if (!data) return <Alert tone="info" message={t("shop.notReady")} />

  function recipientScope(target: string) {
    return props.perCharacter ? props.scopes.find(scope => scope.label === target) : props.scopes[0]
  }
  function gainFor(product: Product, target: string) {
    const scope = recipientScope(target)
    return Math.max(0, Math.min(product.gain, data!.gift_remaining,
      100 - (scope?.affection || 0), scope?.gift_room ?? props.dailyGain - (scope?.gained_today || 0)))
  }
  function clearRequest() { requestRef.current = null; setPending(null) }
  function successFor(action: string, value: any) {
    const result = resultOf(value)
    if (action === "claim_shop_coins") return t("shop.claimed", { n: result.credited })
    if (action === "buy_shop_item") return t("shop.bought", { name: productName(result.item_id), n: result.quantity })
    if (action === "send_shop_gift") {
      return `${t("shop.sent", { name: productName(result.item_id), character: result.character, n: result.applied })} · ${t(`shop.reaction.${result.reaction}`)}`
    }
    return t(`shop.reaction.${result.reaction}`)
  }
  async function perform(action: string, values: Record<string, unknown>, retry = false) {
    if (locked.current || props.stale) return
    let request = requestRef.current
    if (!retry) {
      if (request) return
      request = { action, args: action === "retry_gift_reaction" ? values : {
        ...values, request_id: crypto.randomUUID(), revision: data!.revision,
      } }
      requestRef.current = request
      setPending(request)
    }
    if (!request) return
    const submitted = request
    const ok = await run(submitted.action, submitted.args, value => {
      return successFor(submitted.action, value)
    }, clearRequest)
    if (ok) setSelection(null)
  }
  const blocked = props.busy || Boolean(pending) || props.stale
  const products = tab === "bag" ? data.catalog.filter(product => product.quantity > 0) : data.catalog

  return <div className="lwy-sections">
    <div className="lwy-shop-wallet">
      <div className="lwy-shop-balance"><Icon name="Coins" /><strong>{data.coins}</strong><span>{t("shop.currency")}</span></div>
      <div className="lwy-btns">
        <button type="button" className="lwy-icon-button" disabled={props.busy} title={t("common.refresh")}
          aria-label={t("common.refresh")} onClick={props.refresh}><Icon name="RotateCw" /></button>
      </div>
    </div>
    <div className="lwy-shop-income-notice" role="status" aria-live="polite">{incomeNotice}</div>
    {data.income ? <section className="lwy-shop-income" aria-label={t("shop.incomeTitle")}>
      <div className="lwy-shop-income-head"><strong>{t("shop.incomeTitle")}</strong>
        <span className="lwy-sub">{t("shop.incomeToday", { n: data.income.earned, max: data.daily_coins })}</span></div>
      <div className="lwy-shop-income-steps">{data.income.steps.map((step, index) =>
        <div className="lwy-shop-step" key={step.turns}>
          <strong>{t(`shop.incomeStep.${step.turns}`)}</strong>
          <progress aria-label={t(`shop.incomeStep.${step.turns}`)} max={step.turns}
            value={data.income.paid > index ? step.turns : Math.min(data.income.count, step.turns)} />
          <span>{data.income.paid > index ? t("shop.incomeDone", { n: step.coins })
            : t("shop.incomeProgress", { n: Math.min(data.income.count, step.turns), max: step.turns, coins: step.coins })}</span>
        </div>)}</div>
      <div className="lwy-shop-week"><span>{t("shop.weekProgress", {
        n: Math.min(data.income.weekly_days, data.income.weekly_goal), max: data.income.weekly_goal,
      })}</span><span className="lwy-sub">{data.income.weekly_paid
        ? t("shop.incomeDone", { n: data.income.weekly_coins }) : t("shop.weekReward", { n: data.income.weekly_coins })}</span></div>
    </section> : null}
    {data.bus_ok === false ? <Alert tone="warning" message={t("shop.incomeDisconnected")} /> : null}
    {data.income_error ? <Alert tone="warning" message={t("shop.incomePending")} /> : null}
    {data.income?.clock_error || recipientScope(character)?.clock_error
      ? <Alert tone="warning" message={t("shop.clockError")} /> : null}
    {data.income?.legacy_claimed ? <Alert tone="info" message={t("shop.legacyIncome")} /> : null}
    {recipientScope(character)?.quota_blocked ? <Alert tone="info" message={t("shop.legacyQuota")} /> : null}
    {pending && !props.busy ? <div className="lwy-notice-row">
      <Alert tone="warning" message={t("shop.unconfirmed")} />
      <Button disabled={props.stale} onClick={() => perform(pending.action, pending.args, true)}>
        <Icon name="RotateCw" />{t("shop.checkRequest")}
      </Button>
      <Button onClick={async () => { await props.refresh() }}>{t("common.refresh")}</Button>
    </div> : null}
    <div className="lwy-shop-toolbar">
      <div className="lwy-shop-modes" role="group" aria-label={t("nav.shop")}>
        {["store", "bag", "log", "ledger"].map(mode => <button key={mode} type="button" disabled={props.busy}
          aria-pressed={tab === mode ? "true" : "false"} onClick={() => setTab(mode)}>{t(`shop.tab.${mode}`)}</button>)}
      </div>
      <label className="lwy-shop-recipient"><span id="lwy-shop-recipient-label" className="lwy-sub">{t("shop.recipient")}</span>
        <select className="neko-select" aria-labelledby="lwy-shop-recipient-label" value={character}
          disabled={blocked || Boolean(selection)} onChange={(event: any) => { setRecipient(event.target.value) }}>
          {characters.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
    </div>
    <p className="lwy-note">{t("shop.allowance", { n: data.gift_remaining, max: data.gift_daily_cap })}
      {!props.perCharacter ? ` · ${t("shop.shared")}` : ""}</p>
    {character ? <p className="lwy-note">{t("shop.chatAllowance", {
      n: recipientScope(character)?.chat_room ?? Math.max(0, props.dailyChat - (recipientScope(character)?.gained_chat || 0)),
      max: props.dailyChat,
    })}</p> : null}
    {tab === "bag" ? <label className="lwy-shop-recipient"><span id="lwy-shop-mode-label">{t("shop.giftMode")}</span>
      <select className="neko-select" aria-labelledby="lwy-shop-mode-label" value={gesture ? "gesture" : "normal"} disabled={blocked || Boolean(selection)}
        onChange={(event: any) => { setGesture(event.target.value === "gesture") }}>
        <option value="normal">{t("shop.giftNormal")}</option><option value="gesture">{t("shop.giftGesture")}</option>
      </select>
    </label> : null}
    {tab === "bag" && gesture ? <p className="lwy-note">{t(data.can_gesture ? "shop.gestureNote" : "shop.gestureUsed")}</p> : null}
    {!character ? <Alert tone="info" message={t("shop.noCharacter")} /> : null}
    {tab === "ledger" ? <section aria-label={t("shop.tab.ledger")}>
      {data.ledger?.length ? data.ledger.map(entry => <div className="lwy-shop-log" key={entry.id}>
        <div className="lwy-shop-log-head"><strong>{entry.source === "purchase"
          ? t("shop.ledger.purchase", { name: productName(entry.item_id) }) : t(`shop.ledger.${entry.source}`)}</strong>
          <span className={`lwy-shop-ledger-amount ${entry.amount > 0 ? "gain" : ""}`}>
            {entry.amount > 0 ? "+" : ""}{entry.amount}</span></div>
        <div className="lwy-shop-log-head"><time className="lwy-sub" dateTime={new Date(entry.ts * 1000).toISOString()}>
          {new Date(entry.ts * 1000).toLocaleString()}</time><span className="lwy-sub">{t("shop.ledgerBalance", { n: entry.balance })}</span></div>
      </div>) : <p className="lwy-empty">{t("shop.ledgerEmpty")}</p>}
    </section> : tab === "log" ? <section aria-label={t("shop.tab.log")}>
      {data.history.length ? data.history.map(gift => <div className="lwy-shop-log" key={gift.id}>
        <div className="lwy-shop-log-head">
          <strong>{productName(gift.item_id)} → {gift.character}</strong>
          <span className="lwy-d up">+{gift.applied}</span>
        </div>
        <time className="lwy-sub" dateTime={new Date(gift.ts * 1000).toISOString()}>{new Date(gift.ts * 1000).toLocaleString()}</time>
        <div className="lwy-shop-log-status">
          <span role="status">{t(`shop.reaction.${gift.reaction}`)}</span>
          {gift.can_retry ? <Button disabled={blocked} onClick={() => perform("retry_gift_reaction", { gift_id: gift.id })}>
            <Icon name="RotateCw" />{t("shop.retryReaction")}</Button> : null}
        </div>
        {["unavailable", "unknown"].includes(gift.reaction) && gift.attempts >= 3
          ? <p className="lwy-note">{t("shop.retryLimit")}</p> : null}
      </div>) : <p className="lwy-empty">{t("shop.logEmpty")}</p>}
    </section> : <div className="lwy-shop-grid">
      {products.length ? products.map(product => <div key={product.id} className="lwy-shop-product" data-product={product.id}>
        <div className="lwy-shop-art"><Icon name={product.icon as any} /></div>
        <h3>{productName(product.id)}</h3>
        <p>{t(`shop.description.${product.id}`)}</p>
        <div className="lwy-shop-meta"><span>{t("shop.price", { n: product.price })}</span>
          <span>{t("shop.gain", { n: product.gain })}</span></div>
        <span className="lwy-sub">{t("shop.owned", { n: product.quantity })}</span>
        {tab === "bag" ? <Button tone="primary" disabled={blocked || !character ||
          (gesture ? !data.can_gesture : gainFor(product, character) <= 0)}
          onClick={() => { props.beginEdit(); setSelection({ product, character, gesture }) }}><Icon name="Gift" />{t("shop.send")}</Button>
          : <Button disabled={blocked || product.price > data.coins || product.quantity >= data.inventory_limit}
            onClick={() => perform("buy_shop_item", { item_id: product.id })}><Icon name="ShoppingBag" />
            {product.quantity >= data.inventory_limit ? t("shop.full") : product.price > data.coins ? t("shop.notEnough") : t("shop.buy")}
          </Button>}
      </div>) : <p className="lwy-empty">{t("shop.bagEmpty")}</p>}
    </div>}
    {tab === "bag" && !gesture && character && data.catalog.some(product => product.quantity > 0) &&
      data.catalog.every(product => gainFor(product, character) <= 0) ? <Alert tone="info" message={t("shop.noRoom")} /> : null}
    <Modal open={Boolean(selection)} title={t("shop.confirmTitle")} onClose={close}
      closeOnEscape={!props.busy} closeOnBackdrop={!props.busy}
      footer={<>{props.feedback()}<div className="lwy-btns">
        <Button disabled={props.busy} onClick={close}>{t("common.cancel")}</Button>
        {props.stale ? <Button disabled={props.busy} onClick={props.refresh}><Icon name="RotateCw" />{t("common.refresh")}</Button> : null}
        <Button tone="primary" disabled={props.busy || props.stale || !selection ||
          (!pending && (selection.gesture ? !data.can_gesture : gainFor(selection.product, selection.character) <= 0))}
          onClick={() => {
            if (pending) return perform(pending.action, pending.args, true)
            if (selection) return perform("send_shop_gift", {
              item_id: selection.product.id, character: selection.character, gesture: selection.gesture,
              expected_gain: selection.gesture ? 0 : gainFor(selection.product, selection.character),
              relationship_revision: recipientScope(selection.character)?.gain_revision ?? 0,
            })
          }}>
          <Icon name={props.busy || pending ? "RotateCw" : "Gift"} />
          <span className="lwy-action-label">
            <span aria-hidden={props.busy || pending ? "true" : undefined}>{t("shop.confirmSend")}</span>
            <span aria-hidden={props.busy ? undefined : "true"}>{t("shop.sending")}</span>
            <span aria-hidden={!props.busy && pending ? undefined : "true"}>{t("shop.checkRequest")}</span>
          </span></Button>
      </div></>}>
      {selection ? <div className="lwy-shop-confirm">
        <div className="lwy-shop-art"><Icon name={selection.product.icon as any} /></div>
        <strong>{t("shop.confirmGift", { name: productName(selection.product.id), character: selection.character })}</strong>
        <p>{t("shop.confirmGain", { n: selection.gesture ? 0 : gainFor(selection.product, selection.character) })}</p>
        {selection.gesture ? <p className="lwy-note">{t("shop.gestureNote")}</p> : null}
        {!selection.gesture && gainFor(selection.product, selection.character) < selection.product.gain
          ? <><p className="lwy-shop-partial">{t("shop.partialGain", { max: selection.product.gain })}</p>
            <div className="lwy-shop-smaller">{data.catalog.filter(product => product.quantity > 0 &&
              product.gain < selection.product.gain && gainFor(product, selection.character) === product.gain)
              .map(product => <Button key={product.id} disabled={blocked}
                onClick={() => { setSelection({ ...selection, product }) }}><Icon name="Gift" />{productName(product.id)}</Button>)}</div></> : null}
      </div> : null}
    </Modal>
  </div>
}
