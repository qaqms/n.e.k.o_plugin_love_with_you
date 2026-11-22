import { useEffect, useRef } from "@neko/plugin-ui"
import type { PluginSurfaceProps } from "@neko/plugin-ui"
import type { ExperienceDestination, ExperienceState } from "./experiences"
import { unwrap } from "./requests"
import type { RunAction } from "./requests"
import type { ShopState } from "./shop"
import { trackedWatch, watchProgress } from "./watch-tracking"

export function Cottage(props: {
  locale: string; t: PluginSurfaceProps["t"]; data?: ExperienceState
  current: string; characters: string[]; open: (destination?: ExperienceDestination) => void
  shop?: ShopState; busy: boolean; stale: boolean; run: RunAction; refresh: () => Promise<void>
  today: string; calendar: Array<{ title: string; date: string; countdown: string; today: boolean }>
  activeCharacter: string; online: boolean; api: PluginSurfaceProps["api"]
  bond?: { stage: number; idle: number; gained: number; lost: number }
}) {
  const { t, data } = props
  const frame = useRef<HTMLIFrameElement | null>(null)
  const characters = [...new Set([props.current, ...props.characters, ...Object.keys(data?.characters || {})].filter(Boolean))]
  const storageStatus = !data ? t("xp.notReady") : !data.enabled ? t("xp.off") : ""
  const roles = data?.enabled ? characters.map(name => ({
    name,
    record: Object.prototype.hasOwnProperty.call(data.characters, name) ? data.characters[name] : undefined,
  })).map(({ name, record }) => ({
    name, revision: record?.revision || 0, note: record?.note || null,
    memories: (record?.memories || []).slice().sort((a, b) => b.created_at - a.created_at),
  })) : []
  const status = storageStatus || (!characters.length ? t("xp.noCharacter") : "")
  const scope = t("scope.select")
  const recordData = JSON.stringify({
    status, scope, empty: t("cottage.noMusic"),
    roles: roles.map(({ name, memories }) => ({
      name,
      albums: memories.filter(item => item.kind === "music").slice(0, 5)
        .map(({ id, title, progress, text, created_at }) => ({ id, title, progress, text, created_at })),
    })),
  })
  const pictureRoles = roles.map(({ name, memories }) => ({
    name,
    memories: memories.filter(item => item.kind !== "music").slice(0, 5)
      .map(({ id, title, progress, text, created_at, kind }) => ({ id, title, progress, text, created_at, kind })),
  }))
  const pictureData = JSON.stringify({
    status, scope, title: t("cottage.picture"), empty: t("cottage.noMemories"), original: t("cottage.openRecord"),
    roles: pictureRoles,
  })
  const watch = trackedWatch(data, props.current)
  const companyData = JSON.stringify({
    today: props.today, calendar: props.calendar, canWrite: roles.some(role => role.name === props.current),
    character: props.current, company: props.online ? props.activeCharacter : "", bond: props.bond || null,
    watch: watch && {
      title: watch.title || t("xp.watchUntitled"), progress: watchProgress(watch, t), url: watch.url,
      action: t(watch.completed ? "xp.watchReplay" : "xp.watchContinue"),
    },
  })
  const roomData = JSON.stringify({
    status, scope, stale: props.stale, busy: props.busy,
    labels: {
      title: t("xp.noteTitle"), text: t("xp.content"), draft: t("xp.saveDraft"), keep: t("xp.confirmSave"),
      saved: t("xp.saved"), limit: t("error.experience_limit"), retry: t("xp.retry"), refresh: t("common.refresh"),
    },
    roles: roles.map(({ name, revision, note, memories }) => ({
      name, revision, note: note && { id: note.id, title: note.title, text: note.text }, full: memories.length >= 30,
    })),
    gifts: (props.shop?.history || []).map(({ id, item_id, character, ts }) =>
      ({ id, item: item_id, name: t(`shop.item.${item_id}`), character, ts })),
  })
  const pending = useRef<Record<string, unknown> | null>(null)
  const running = useRef(false)
  const inviting = useRef(false)
  const latest = useRef({ recordData, pictureData, pictureRoles, roomData, companyData, roles, props })
  latest.current = { recordData, pictureData, pictureRoles, roomData, companyData, roles, props }

  function send(type: string, payload: string) {
    frame.current?.contentWindow?.postMessage({ type, payload }, location.origin)
  }

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return
      const { recordData, pictureData, pictureRoles, roomData, companyData, roles, props } = latest.current
      if (event.data?.type === "love-with-you-cottage-ready") {
        send("love-with-you-cottage-record-data", recordData)
        send("love-with-you-cottage-picture-data", pictureData)
        send("love-with-you-cottage-room-data", roomData)
        send("love-with-you-cottage-company-data", companyData)
      }
      if (event.data?.type === "love-with-you-cottage-open-memory") {
        const role = pictureRoles.find(item => item.name === event.data.character)
        const memory = role?.memories.find(item => item.id === event.data.id)
        if (!role || !memory) return
        props.open({
          character: role.name, tab: memory.kind ? "activities" : "notes",
          kind: memory.kind ? "activity" : "memory", id: memory.id,
        })
      }
      if (event.data?.type === "love-with-you-cottage-refresh") void props.refresh()
      if (event.data?.type === "love-with-you-cottage-invite") {
        const { token, character } = event.data
        if (typeof token !== "string" || !/^[a-z0-9-]{36}$/.test(token)) return
        const respond = (status: string) => send("love-with-you-cottage-invite-result", JSON.stringify({ token, status }))
        if (inviting.current || !props.online || !character || character !== props.activeCharacter) {
          respond("unavailable")
          return
        }
        inviting.current = true
        void (async () => {
          try {
            const result = unwrap(await props.api.call("invite_cottage_chat", {
              request_id: token, character,
            }, { userInitiated: true }), "status")
            respond(result.request_id === token && ["submitted", "unknown", "unavailable"].includes(result.status)
              ? result.status : "unknown")
          } catch (error: any) {
            const codes: string[] = String(error?.code || error?.message || "").match(/[a-zA-Z_]+/g) || []
            respond(codes.includes("touch_cooldown") ? "cooldown" :
              codes.includes("touch_character_changed") || codes.includes("touch_unavailable") ? "unavailable" : "unknown")
          } finally { inviting.current = false }
        })()
      }
      if (event.data?.type === "love-with-you-cottage-save-note") {
        const { token, character, title, text, keep, revision } = event.data
        const role = roles.find(item => item.name === character)
        if (running.current || typeof token !== "string" || token.length > 80) return
        let request = pending.current
        if (request ? request.request_id !== token :
          !role || props.stale || props.busy || revision !== role.revision || typeof keep !== "boolean" ||
          typeof title !== "string" || !title.trim() || Array.from(title).length > 40 ||
          typeof text !== "string" || Array.from(text).length > 600 || ((keep || role.note) && !text.trim())) {
          send("love-with-you-cottage-note-result", JSON.stringify({ token, rejected: true }))
          return
        }
        if (!request && role) {
          request = {
            request_id: token, character, revision,
            operation: role.note ? (keep ? "save_note" : "draft_note") : (keep ? "save_new_note" : "start_note"),
            values: { id: role.note?.id, title: title.trim(), text: text.trim() },
          }
        }
        if (!request) return
        const submitted = request
        running.current = true
        pending.current = submitted
        let savedId: string | undefined
        void props.run("experience_action", submitted, value => {
          const result = unwrap(value, "operation")
          const values = submitted.values as { id?: string }
          if (result.operation !== submitted.operation || result.revision !== Number(submitted.revision) + 1 ||
            typeof result.id !== "string" || !result.id || (values.id && result.id !== values.id)) {
            throw new Error("invalid_response")
          }
          savedId = result.id
          return props.t("xp.saved")
        }, () => { pending.current = null }).then(ok => {
          send("love-with-you-cottage-note-result", JSON.stringify({
            token, ok, retry: Boolean(pending.current), kept: Boolean(ok && keep), id: savedId, character,
          }))
        }).finally(() => { running.current = false })
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])
  useEffect(() => send("love-with-you-cottage-record-data", recordData), [recordData])
  useEffect(() => send("love-with-you-cottage-picture-data", pictureData), [pictureData])
  useEffect(() => send("love-with-you-cottage-room-data", roomData), [roomData])
  useEffect(() => send("love-with-you-cottage-company-data", companyData), [companyData])

  return <div className="lwy-game">
    <iframe ref={frame} title={t("nav.cottage")}
      src={`/plugin/love_with_you/ui/cottage.html?version=0.9.33&linked=1&locale=${encodeURIComponent(props.locale)}`} />
  </div>
}
