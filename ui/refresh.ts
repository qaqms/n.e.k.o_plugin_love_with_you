import { useEffect, useRef } from "@neko/plugin-ui"

// Refresh display data only. Feature mutations and retries remain explicit.
export function useBackgroundRefresh(refresh: () => Promise<unknown>, paused: boolean, enabled = true) {
  const latest = useRef({ refresh, paused })
  latest.current = { refresh, paused }
  useEffect(() => {
    if (!enabled) return
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (!latest.current.paused && !document.hidden) {
        try { await latest.current.refresh() } catch { /* Explicit refresh remains available. */ }
      }
      if (alive) timer = setTimeout(poll, 5000)
    }
    timer = setTimeout(poll, 5000)
    return () => { alive = false; clearTimeout(timer) }
  }, [enabled])
}
