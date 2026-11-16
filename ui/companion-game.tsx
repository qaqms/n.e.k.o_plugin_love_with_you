import { useEffect, useRef, useState } from "@neko/plugin-ui"
import type { HostedApi } from "@neko/plugin-ui"

export const GAME_STYLE = `
.lwy-workspace.is-game { padding: 0; overflow: hidden; scrollbar-gutter: auto; }
.lwy-page-layout[hidden], .lwy-game[hidden] { display: none !important; }
.lwy-game { width: 100%; height: 100%; min-width: 0; min-height: 0; }
.lwy-game iframe { display: block; width: 100%; height: 100%; border: 0; }
`

export function CompanionGame(props: { active: boolean; api: HostedApi; title: string; locale: string }) {
  const [visited, setVisited] = useState(props.active)
  const frame = useRef<HTMLIFrameElement | null>(null)
  const syncVisibility = () => frame.current?.contentWindow?.postMessage({
    type: "love-with-you-game-visibility", visible: props.active,
  }, location.origin)
  useEffect(() => { if (props.active) setVisited(true) }, [props.active])
  useEffect(() => {
    const listener = async (event: MessageEvent) => {
      const target = frame.current?.contentWindow
      if (!target || event.source !== target || event.origin !== location.origin) return
      const data = event.data
      if (data?.type !== "neko-hosted-surface-request" || data.method !== "call"
        || data.payload?.actionId !== "adventure_action" || typeof data.requestId !== "string") return
      let response: Record<string, unknown>
      try {
        const result = await props.api.call("adventure_action", data.payload.args, { timeoutMs: 14000 })
        response = { ok: true, result }
      } catch (error: any) {
        response = { ok: false, error: String(error?.message || error), code: error?.code }
      }
      if (target === frame.current?.contentWindow) target.postMessage({
        type: "neko-hosted-surface-response", requestId: data.requestId, ...response,
      }, location.origin)
    }
    window.addEventListener("message", listener)
    return () => window.removeEventListener("message", listener)
  }, [props.api])
  useEffect(syncVisibility, [props.active])
  return <div className="lwy-game" hidden={!props.active}>
    {visited ? <iframe ref={frame} title={props.title} onLoad={syncVisibility}
      src={`/plugin/love_with_you/ui/index.html?locale=${encodeURIComponent(props.locale)}`} /> : null}
  </div>
}
