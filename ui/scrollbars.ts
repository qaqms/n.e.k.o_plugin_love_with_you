import { useEffect } from "@neko/plugin-ui"

const REGIONS = ".lwy-sidebar, .lwy-workspace, .neko-modal-body"

export function useQuietScrollbars() {
  useEffect(() => {
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>()
    let edge: HTMLElement | null = null
    let dragging: HTMLElement | null = null
    const show = (node: HTMLElement) => {
      clearTimeout(timers.get(node))
      timers.delete(node)
      node.setAttribute("data-lwy-scroll-visible", "")
    }
    const idle = (node: HTMLElement) => {
      clearTimeout(timers.get(node))
      timers.set(node, setTimeout(() => {
        timers.delete(node)
        if (edge !== node && dragging !== node) node.removeAttribute("data-lwy-scroll-visible")
      }, 1000))
    }
    const regionAt = (event: PointerEvent) => {
      if (event.pointerType === "touch") return null
      const modal = document.querySelector(".neko-modal-backdrop")
      const nodes = document.querySelectorAll<HTMLElement>(REGIONS)
      for (const node of nodes) {
        if (modal && !node.closest(".neko-modal-backdrop")) continue
        if (node.scrollHeight <= node.clientHeight + 1) continue
        const rect = node.getBoundingClientRect()
        if (rect.width && rect.height && event.clientX >= rect.right - 18 && event.clientX <= rect.right &&
          event.clientY >= rect.top && event.clientY <= rect.bottom) return node
      }
      return null
    }
    const move = (event: PointerEvent) => {
      const next = regionAt(event)
      if (edge && edge !== next) idle(edge)
      edge = next
      if (next) show(next)
    }
    const down = (event: PointerEvent) => {
      move(event)
      if (event.button !== 0 || !edge) return
      const rect = edge.getBoundingClientRect()
      // Only the native scrollbar gutter starts a drag; nearby content keeps
      // its usual click and selection behavior.
      if (event.clientX < rect.right - (edge.offsetWidth - edge.clientWidth)) return
      dragging = edge
      dragging.setAttribute("data-lwy-scroll-dragging", "")
      show(dragging)
    }
    const up = () => {
      if (!dragging) return
      const node = dragging
      dragging = null
      node.removeAttribute("data-lwy-scroll-dragging")
      idle(node)
    }
    const scroll = (event: Event) => {
      if (!(event.target instanceof HTMLElement) || !event.target.matches(REGIONS)) return
      show(event.target)
      idle(event.target)
    }
    const leave = (event: PointerEvent) => {
      if (event.relatedTarget) return
      if (edge) idle(edge)
      edge = null
    }
    const reset = () => {
      up()
      edge = null
      for (const [node, timer] of timers) {
        clearTimeout(timer)
        node.removeAttribute("data-lwy-scroll-visible")
      }
      timers.clear()
      document.querySelectorAll(REGIONS).forEach(node => node.removeAttribute("data-lwy-scroll-visible"))
    }
    document.addEventListener("pointermove", move, true)
    document.addEventListener("pointerdown", down, true)
    document.addEventListener("pointerup", up, true)
    document.addEventListener("pointercancel", up, true)
    document.addEventListener("pointerout", leave, true)
    document.addEventListener("scroll", scroll, true)
    window.addEventListener("blur", reset)
    return () => {
      reset()
      document.removeEventListener("pointermove", move, true)
      document.removeEventListener("pointerdown", down, true)
      document.removeEventListener("pointerup", up, true)
      document.removeEventListener("pointercancel", up, true)
      document.removeEventListener("pointerout", leave, true)
      document.removeEventListener("scroll", scroll, true)
      window.removeEventListener("blur", reset)
    }
  }, [])
}

export const SCROLLBAR_STYLE = `
@property --lwy-scroll-thumb {
  syntax: "<color>";
  inherits: true;
  initial-value: transparent;
}
:is(.lwy-sidebar, .lwy-workspace, .neko-modal-body) {
  --lwy-scroll-thumb: transparent;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
  transition: --lwy-scroll-thumb 160ms ease;
}
:is(.lwy-sidebar, .lwy-workspace, .neko-modal-body)[data-lwy-scroll-visible],
:root[data-lwy-pointer="keyboard"] :is(.lwy-sidebar, .lwy-workspace, .neko-modal-body):focus-within {
  --lwy-scroll-thumb: color-mix(in srgb, var(--muted) 42%, transparent);
}
:is(.lwy-sidebar, .lwy-workspace, .neko-modal-body)[data-lwy-scroll-dragging] {
  --lwy-scroll-thumb: color-mix(in srgb, var(--muted) 78%, transparent);
}
:is(.lwy-sidebar, .lwy-workspace, .neko-modal-body)::-webkit-scrollbar { width: 10px; height: 10px; }
:is(.lwy-sidebar, .lwy-workspace, .neko-modal-body)::-webkit-scrollbar-track { background: transparent; }
:is(.lwy-sidebar, .lwy-workspace, .neko-modal-body)::-webkit-scrollbar-thumb {
  background: var(--lwy-scroll-thumb); border: 3px solid transparent; border-radius: 8px; background-clip: padding-box;
}
:is(.lwy-sidebar, .lwy-workspace, .neko-modal-body)[data-lwy-scroll-visible]::-webkit-scrollbar-thumb:hover {
  background-color: color-mix(in srgb, var(--muted) 72%, transparent);
}
:is(.lwy-sidebar, .lwy-workspace, .neko-modal-body)[data-lwy-scroll-visible]::-webkit-scrollbar-thumb:active {
  background-color: color-mix(in srgb, var(--muted) 88%, transparent);
}
:is(.lwy-sidebar, .lwy-workspace, .neko-modal-body)::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
:is(.lwy-sidebar, .lwy-workspace, .neko-modal-body)::-webkit-scrollbar-corner { background: transparent; }
@supports not selector(::-webkit-scrollbar) {
  :is(.lwy-sidebar, .lwy-workspace, .neko-modal-body) {
    scrollbar-width: thin; scrollbar-color: var(--lwy-scroll-thumb) transparent;
  }
}
@media (hover: none), (pointer: coarse) {
  :is(.lwy-sidebar, .lwy-workspace, .neko-modal-body) {
    --lwy-scroll-thumb: color-mix(in srgb, var(--muted) 42%, transparent);
  }
}
@media (prefers-reduced-motion: reduce) {
  :is(.lwy-sidebar, .lwy-workspace, .neko-modal-body) { transition: none; }
}
@media (forced-colors: active) {
  :is(.lwy-sidebar, .lwy-workspace, .neko-modal-body) {
    --lwy-scroll-thumb: CanvasText !important; scrollbar-color: auto;
  }
  :is(.lwy-sidebar, .lwy-workspace, .neko-modal-body)::-webkit-scrollbar-thumb { background-color: CanvasText; }
}
`
