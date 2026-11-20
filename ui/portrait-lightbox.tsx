import { useEffect, useRef, useState } from "@neko/plugin-ui"
import type { PluginSurfaceProps } from "@neko/plugin-ui"
import { handCursor, Icon } from "./icons"
import type { PortraitPoint, PortraitTouchPreset } from "./portrait-touch-presets"
import { unwrap } from "./requests"

const zones = ["head", "belly", "legs"] as const
type Zone = typeof zones[number]
type Mode = "menu" | "touch" | "bag"
const markWidth = .52
const markHeight: Record<Zone, number> = { head: .25, belly: .26, legs: .36 }

function markStyle(index: number, [x, y]: PortraitPoint, preset: PortraitTouchPreset) {
  const zone = zones[index]
  let widthLimit = 1
  let heightLimit = 1
  // Separate neighboring targets on the axis with the most room for both.
  for (const [otherIndex, other] of preset.entries()) {
    if (otherIndex === index || !other) continue
    const dx = Math.abs(x - other[0])
    const dy = Math.abs(y - other[1])
    const combinedHeight = (markHeight[zone] + markHeight[zones[otherIndex]]) / 2
    if (dx / markWidth > dy / combinedHeight) widthLimit = Math.min(widthLimit, dx)
    else heightLimit = Math.min(heightLimit, dy)
  }
  return {
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    "--lwy-mark-width-limit": `${widthLimit * 100}%`,
    "--lwy-mark-height-limit": `${heightLimit * 100}%`,
    "--lwy-mark-height": `${markHeight[zone] * 100}%`,
  }
}

export const PORTRAIT_LIGHTBOX_STYLE = `
.lwy-art button { width: 100%; height: 100%; padding: 0; border: 0; background: transparent;
  cursor: zoom-in; pointer-events: auto; }
.lwy-art button[data-expanded="true"] img { visibility: hidden; }
.lwy-portrait-lightbox { position: fixed; inset: 0; box-sizing: border-box; margin: 0;
  width: 100%; height: 100%; max-width: none; max-height: none; padding: 0; border: 0;
  color: #fff; background: transparent; overflow: auto; overscroll-behavior: contain; }
.lwy-portrait-lightbox::backdrop { background: rgba(0, 0, 0, .76); animation: lwy-portrait-dim 260ms ease-out; }
@keyframes lwy-portrait-dim { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .lwy-portrait-lightbox::backdrop { animation: none; } }
.lwy-portrait-layout { box-sizing: border-box; min-height: min(100%, 360px); height: 100%;
  display: grid; grid-template-rows: auto minmax(104px, 1fr) auto;
  gap: 10px; padding: 12px; pointer-events: none; }
.lwy-portrait-bar { display: grid; grid-template-columns: 38px minmax(0,1fr) 38px;
  align-items: start; gap: 10px; min-height: 38px; }
.lwy-portrait-tools { display: flex; justify-content: center; flex-wrap: wrap; align-items: center; gap: 8px; }
.lwy-portrait-label { align-self: center; text-align: center; overflow-wrap: anywhere; }
.lwy-portrait-command { display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  min-height: 38px; padding: 7px 11px; border-radius: 6px; border: 1px solid #777;
  background: #24262b; color: #fff; font: inherit; line-height: 1.3; cursor: pointer; pointer-events: auto; }
.lwy-portrait-command:disabled, .lwy-portrait-mark:disabled { cursor: default; opacity: .6; }
.lwy-portrait-command:focus-visible { outline: 2px solid #b8d8fb; outline-offset: 3px; }
.lwy-portrait-command.is-icon { width: 38px; padding: 0; }
.lwy-portrait-stage { container-type: size; display: grid; place-items: center; min-height: 0; min-width: 0; }
.lwy-portrait-figure { position: relative; margin: 0; transform-origin: left top; overflow: clip;
  width: min(100cqw, calc(100cqh * var(--lwy-art-ratio)), 600px); aspect-ratio: var(--lwy-art-ratio); }
.lwy-portrait-figure img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; user-select: none; pointer-events: auto; }
.lwy-portrait-mark { position: absolute; translate: -50% -50%;
  width: min(var(--lwy-mark-width-limit), clamp(44px, ${markWidth * 100}%, 196px));
  height: min(var(--lwy-mark-height-limit), clamp(44px, var(--lwy-mark-height), 220px));
  clip-path: ellipse(50% 50%); border: 0; outline: 0; background: transparent;
  pointer-events: auto; padding: 0; }
.lwy-portrait-mark:enabled { cursor: url("${handCursor}") 15 16, grab; }
.lwy-portrait-mark:focus-visible::after { content: ""; position: absolute; inset: 4px;
  border: 2px solid #b8d8fb; border-radius: 50%; pointer-events: none; }
.lwy-portrait-status { text-align: center; margin: 0; line-height: 1.5; min-height: 1.5em; overflow-wrap: anywhere; }
.lwy-portrait-controls { display: grid; justify-items: center; gap: 8px; min-width: 0; }
.lwy-portrait-bag { pointer-events: auto; box-sizing: border-box; min-width: 0; width: min(100%, 440px);
  max-height: min(47vh,300px); overflow: auto; overscroll-behavior: contain;
  background: var(--card); color: var(--ink); border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
.lwy-portrait-bag .lwy-feedback { position: static; }
.lwy-portrait-bag-items { display: grid; gap: 4px; }
.lwy-portrait-bag-item { display: flex; align-items: center; flex-wrap: wrap; justify-content: space-between; gap: 8px;
  min-width: 0; padding: 8px 0; border-bottom: 1px solid var(--line); }
.lwy-portrait-bag-item > span { display: flex; align-items: center; gap: 6px; overflow-wrap: anywhere; }
`

export function PortraitLightbox(props: {
  art: string; origin: DOMRect; ratio: number; preset?: PortraitTouchPreset; character: string; online: boolean
  api: PluginSurfaceProps["api"]; t: PluginSurfaceProps["t"]
  bag: any; onClose: () => void; onPlay: () => void
}) {
  const { t, preset } = props
  const dialog = useRef<HTMLDialogElement | null>(null)
  const figure = useRef<HTMLElement | null>(null)
  const [mode, setMode] = useState<Mode>("menu")
  const [status, setStatus] = useState("")
  const [waiting, setWaiting] = useState(false)
  const running = useRef(false)
  const pointer = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    const animation = requestAnimationFrame(() => {
      const node = figure.current
      if (!node || matchMedia("(prefers-reduced-motion: reduce)").matches) return
      const target = node.getBoundingClientRect()
      if (!(target.width && target.height && props.origin.width && props.origin.height)) return
      node.animate([
        { transform: `translate(${props.origin.left - target.left}px, ${props.origin.top - target.top}px) scale(${props.origin.width / target.width}, ${props.origin.height / target.height})` },
        { transform: "none" },
      ], { duration: 260, easing: "cubic-bezier(.2,.7,.25,1)" })
    })
    return () => {
      cancelAnimationFrame(animation)
      element?.close()
    }
  }, [])

  function changeMode(next: Mode) {
    setMode(next)
    setStatus("")
  }

  function dismiss() {
    dialog.current?.close()
    props.onClose()
  }

  function rememberPointer(event: PointerEvent) {
    pointer.current = event.isPrimary && event.button === 0 ? { x: event.clientX, y: event.clientY } : null
  }

  function isTap(event: MouseEvent) {
    const start = pointer.current
    pointer.current = null
    return start && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 8
  }

  async function touch(zone: Zone) {
    if (running.current || !props.character || !props.online) return
    running.current = true
    setWaiting(true)
    setStatus(t("portrait.sending"))
    const request_id = crypto.randomUUID()
    try {
      const result = unwrap(await props.api.call("touch_portrait", {
        request_id, character: props.character, zone,
      }, { userInitiated: true }), "status")
      const valid = result.request_id === request_id && ["submitted", "unavailable", "unknown"].includes(result.status)
      setStatus(t(valid ? `portrait.${result.status}` : "portrait.unknown"))
    } catch (error: any) {
      const pieces: string[] = String(error?.code || error?.message || "").match(/[a-zA-Z_]+/g) || []
      const known = ["touch_cooldown", "touch_character_changed", "touch_unavailable"].find(code => pieces.includes(code))
      setStatus(t(known ? `portrait.${known}` : "portrait.unknown"))
    } finally {
      running.current = false
      setWaiting(false)
    }
  }

  return <dialog className="lwy-portrait-lightbox" ref={dialog} aria-label={t("portrait.open")}
    onCancel={(event: Event) => { event.preventDefault(); dismiss() }}
    onClick={(event: MouseEvent) => { if (event.target === event.currentTarget) dismiss() }}>
    <div className="lwy-portrait-layout">
      <div className="lwy-portrait-bar">
        {mode === "menu" ? <span /> : <button type="button" className="lwy-portrait-command is-icon"
          title={t("portrait.back")} aria-label={t("portrait.back")} onClick={() => changeMode("menu")}><Icon name="ChevronLeft" /></button>}
        <span className="lwy-portrait-label">{props.character}</span>
        <button type="button" className="lwy-portrait-command is-icon" autofocus
          title={t("common.dismiss")} aria-label={t("common.dismiss")} onClick={dismiss}><Icon name="X" /></button>
      </div>
      <div className="lwy-portrait-stage">
        <figure ref={figure} className="lwy-portrait-figure" style={{ "--lwy-art-ratio": props.ratio }}>
          <img src={props.art} alt="" draggable={false} />
          {mode === "touch" && preset ? zones.map((zone, index) => {
            const mark = preset[index]
            return mark ? <button key={zone} type="button"
              className="lwy-portrait-mark" data-zone={zone} style={markStyle(index, mark, preset)}
              disabled={waiting || !props.character || !props.online}
              aria-label={t(`portrait.${zone}`)} onPointerDown={rememberPointer} onPointerCancel={() => { pointer.current = null }}
              onClick={(event: MouseEvent) => { if (event.detail === 0 || isTap(event)) void touch(zone) }} /> : null
          }) : null}
        </figure>
      </div>
      <div className="lwy-portrait-controls">
        {mode === "bag" ? <div className="lwy-portrait-bag" aria-label={t("shop.tab.bag")}>{props.bag}</div> : null}
        {mode === "menu" ? <div className="lwy-portrait-tools">
          <button type="button" className="lwy-portrait-command" onClick={() => changeMode("touch")}><Icon name="Hand" />{t("portrait.touch")}</button>
          <button type="button" className="lwy-portrait-command" onClick={() => changeMode("bag")}><Icon name="ShoppingBag" />{t("shop.tab.bag")}</button>
          <button type="button" className="lwy-portrait-command" onClick={props.onPlay}><Icon name="Gamepad2" />{t("portrait.play")}</button>
        </div> : null}
        {mode === "touch" ? <p className="lwy-portrait-status" role="status">
          {status || (!preset ? t("portrait.noTouchPreset") : !props.character || !props.online ? t("portrait.touch_unavailable") : "")}
        </p> : null}
      </div>
    </div>
  </dialog>
}
