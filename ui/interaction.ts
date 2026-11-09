import { useEffect, useRef } from "@neko/plugin-ui"

const CONTROL = "button, summary, input[type='checkbox'], input[type='radio'], label.lwy-portrait-choice"

function controlAt(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const switchLabel = target.closest(".neko-switch")
  const control = switchLabel?.querySelector("input") || target.closest(CONTROL)
  if (!(control instanceof HTMLElement) || control.matches(":disabled, [aria-disabled='true']") ||
    control.closest("[inert]") || control.querySelector("input:disabled")) return null
  return control
}

// Capture native events so host buttons and body-mounted dialogs share feedback.
// These listeners never dispatch clicks, capture pointers, or change native actions.
export function useInteractionFeedback() {
  const activated = useRef<{ node: HTMLElement; time: number } | null>(null)
  useEffect(() => {
    let pressed: { node: HTMLElement; pointer?: number; key?: string } | null = null
    const animations = new Map<HTMLElement, Animation>()
    const root = document.documentElement
    const reduced = matchMedia("(prefers-reduced-motion: reduce)")
    const clear = () => {
      pressed?.node.removeAttribute("data-lwy-pressed")
      pressed = null
    }
    const press = (node: HTMLElement) => {
      animations.get(node)?.cancel()
      animations.delete(node)
      node.setAttribute("data-lwy-pressed", "")
    }
    const modality = (event: PointerEvent) => {
      root.dataset.lwyPointer = event.pointerType === "touch" ? "touch" : "pointer"
    }
    const down = (event: PointerEvent) => {
      modality(event)
      if (event.button !== 0 || !event.isPrimary) return
      clear()
      const node = controlAt(event.target)
      if (!node) return
      pressed = { node, pointer: event.pointerId }
      press(node)
    }
    const move = (event: PointerEvent) => {
      modality(event)
      if (!pressed || pressed.pointer !== event.pointerId) return
      const hit = document.elementFromPoint(event.clientX, event.clientY)
      if (controlAt(hit) === pressed.node) press(pressed.node)
      else pressed.node.removeAttribute("data-lwy-pressed")
    }
    const up = (event: PointerEvent) => {
      if (pressed?.pointer === event.pointerId) clear()
    }
    const leave = (event: PointerEvent) => { if (!event.relatedTarget) clear() }
    const keydown = (event: KeyboardEvent) => {
      root.dataset.lwyPointer = "keyboard"
      if (event.key === "Escape" || event.key === "Tab") { clear(); return }
      if (event.repeat || ![" ", "Enter"].includes(event.key)) return
      const node = controlAt(event.target)
      if (!node || (event.key === "Enter" && node.matches("input"))) return
      clear()
      pressed = { node, key: event.key }
      press(node)
    }
    const keyup = (event: KeyboardEvent) => { if (pressed?.key === event.key) clear() }
    const click = (event: MouseEvent) => {
      const node = controlAt(event.target)
      if (!node || event.defaultPrevented) return
      activated.current = { node, time: performance.now() }
      // A label forwards another click to its input; animate the card once.
      if (node.matches("input") && node.closest("label.lwy-portrait-choice")) return
      animations.get(node)?.cancel()
      animations.delete(node)
      if (reduced.matches || typeof node.animate !== "function") return
      const wash = getComputedStyle(root).getPropertyValue("--control-press").trim()
      const animation = node.animate([
        { boxShadow: `inset 0 0 0 999px ${wash}` },
        { boxShadow: "inset 0 0 0 999px transparent" },
      ], { duration: 180, easing: "cubic-bezier(.2,.7,.3,1)" })
      animations.set(node, animation)
      const done = () => { if (animations.get(node) === animation) animations.delete(node) }
      animation.onfinish = done
      animation.oncancel = done
    }
    const motionChange = () => {
      if (reduced.matches) { for (const animation of animations.values()) animation.cancel(); animations.clear() }
    }
    document.addEventListener("pointerover", modality, true)
    document.addEventListener("pointerout", leave, true)
    document.addEventListener("pointerdown", down, true)
    document.addEventListener("pointermove", move, true)
    document.addEventListener("pointerup", up, true)
    document.addEventListener("pointercancel", clear, true)
    document.addEventListener("keydown", keydown, true)
    document.addEventListener("keyup", keyup, true)
    document.addEventListener("click", click, true)
    document.addEventListener("scroll", clear, true)
    document.addEventListener("visibilitychange", clear)
    window.addEventListener("blur", clear)
    reduced.addEventListener("change", motionChange)
    return () => {
      clear()
      for (const animation of animations.values()) animation.cancel()
      document.removeEventListener("pointerover", modality, true)
      document.removeEventListener("pointerout", leave, true)
      document.removeEventListener("pointerdown", down, true)
      document.removeEventListener("pointermove", move, true)
      document.removeEventListener("pointerup", up, true)
      document.removeEventListener("pointercancel", clear, true)
      document.removeEventListener("keydown", keydown, true)
      document.removeEventListener("keyup", keyup, true)
      document.removeEventListener("click", click, true)
      document.removeEventListener("scroll", clear, true)
      document.removeEventListener("visibilitychange", clear)
      window.removeEventListener("blur", clear)
      reduced.removeEventListener("change", motionChange)
      delete root.dataset.lwyPointer
    }
  }, [])

  return (checked?: boolean, savedCheck?: boolean) => {
    const recent = activated.current
    const node = recent && performance.now() - recent.time < 1000 && recent.node.isConnected
      ? recent.node : controlAt(document.activeElement)
    if (!node) return () => {}
    const previous = node.getAttribute("aria-busy")
    const previousChecked = node.getAttribute("aria-checked")
    node.setAttribute("data-lwy-pending", "")
    node.setAttribute("aria-busy", "true")
    if (node.matches("input[type='checkbox']") && checked !== undefined) {
      node.setAttribute("data-lwy-pending-checked", String(checked))
      node.setAttribute("aria-checked", String(checked))
    }
    return (committed = false) => {
      // The host only patches changed props; rejected native toggles need rollback.
      if (!committed && checked !== undefined && node instanceof HTMLInputElement) node.checked = savedCheck ?? !checked
      node.removeAttribute("data-lwy-pending")
      node.removeAttribute("data-lwy-pending-checked")
      if (previous === null) node.removeAttribute("aria-busy")
      else node.setAttribute("aria-busy", previous)
      if (previousChecked === null) node.removeAttribute("aria-checked")
      else node.setAttribute("aria-checked", previousChecked)
    }
  }
}

export const INTERACTION_STYLE = `
:is(button, summary, label.lwy-portrait-choice, .neko-checkbox, .neko-input, .neko-select, input[type="color"]) {
  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease,
    box-shadow 150ms ease, opacity 150ms ease;
}
.neko-button:hover { transform: none; box-shadow: none; }
button:disabled { cursor: not-allowed; }
.lwy-text-button { text-decoration: underline; text-decoration-color: transparent; text-underline-offset: 3px;
  transition: text-decoration-color 150ms ease, background-color 150ms ease, box-shadow 150ms ease; }
.lwy-feedback-close { border-radius: 4px; }
.lwy-action-label { display: inline-grid; min-width: 0; }
.lwy-action-label > span { grid-area: 1 / 1; }
.lwy-action-label > [aria-hidden="true"] { visibility: hidden; }
.lwy-button-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 18px; height: 18px; }
.lwy-shop-modes button { border-radius: 4px 4px 0 0; }
.lwy-details summary { border-radius: 3px; }
@media (hover: hover) and (pointer: fine) {
  :root[data-lwy-pointer="pointer"] :is(button, summary, label.lwy-portrait-choice):not(:disabled):not([aria-disabled="true"]):not(:has(input:disabled)):hover {
    box-shadow: inset 0 0 0 999px var(--control-hover);
  }
  :root[data-lwy-pointer="pointer"] .neko-button:not(:disabled):hover { border-color: var(--accent-line); color: var(--accent-strong); }
  :root[data-lwy-pointer="pointer"] .neko-button[data-tone="primary"]:not(:disabled):hover {
    background: var(--accent-hover); border-color: var(--accent-hover); color: var(--on-accent);
  }
  :root[data-lwy-pointer="pointer"] .neko-button[data-tone="danger"]:not(:disabled):hover { border-color: var(--danger); color: var(--danger); }
  :root[data-lwy-pointer="pointer"] :is(.lwy-color-choice, .lwy-portrait-choice, .lwy-icon-button, .lwy-sidebar-toggle):not(:disabled):hover {
    border-color: var(--accent-line);
  }
  :root[data-lwy-pointer="pointer"] .lwy-text-button:hover { text-decoration-color: currentColor; }
  :root[data-lwy-pointer="pointer"] :is(.neko-input, .neko-select, input[type="color"]):not(:disabled):hover { border-color: var(--accent-line); }
  :root[data-lwy-pointer="pointer"] .neko-switch:has(input:not(:disabled)):hover .neko-checkbox {
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
}
[data-lwy-pressed]:not(:disabled) {
  box-shadow: inset 0 1px 2px rgba(0,0,0,.12), inset 0 0 0 999px var(--control-press) !important;
  transition-duration: 35ms;
}
:is(button, input)[data-lwy-pending], :is(button, input)[data-lwy-pending]:disabled {
  cursor: progress; opacity: .85; box-shadow: inset 0 0 0 1px var(--accent-line);
}
button[data-lwy-pending] > .lwy-icon {
  mask-image: none !important; -webkit-mask-image: none !important; background: transparent;
  box-sizing: border-box; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%;
  animation: lwy-spin 850ms linear infinite;
}
.neko-switch .neko-checkbox[data-lwy-pending-checked="true"] { background: var(--accent); }
.neko-switch .neko-checkbox[data-lwy-pending-checked="true"]::after { transform: translateX(14px); }
.neko-switch .neko-checkbox[data-lwy-pending-checked="false"] { background: rgba(148,163,184,.45); }
.neko-switch .neko-checkbox[data-lwy-pending-checked="false"]::after { transform: translateX(0); }
.neko-select:focus-visible { outline: 2px solid var(--accent-line); outline-offset: 2px; }
.neko-input[aria-invalid="true"] { border-color: var(--danger); }
.neko-input[aria-invalid="true"]:focus { box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 12%, transparent); }
.lwy-feedback { animation: lwy-feedback-in 160ms ease-out; }
.lwy-feedback[data-lwy-dismissing] { opacity: 0; transition: opacity 140ms ease; }
@keyframes lwy-feedback-in { from { opacity: .35; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  :is(button, summary, label.lwy-portrait-choice, .neko-checkbox, .neko-checkbox::after,
    .neko-input, .neko-select, input[type="color"]) { transition: none !important; }
  .lwy-feedback { transition: none; }
  .lwy-feedback, button[data-lwy-pending] > .lwy-icon { animation: none; }
}
`
