import { Alert, Button, Input, Modal, Switch, Textarea, useCallback, useConfirm, useEffect, useRef, useState } from "@neko/plugin-ui"
import type { PluginSurfaceProps } from "@neko/plugin-ui"
import { Icon } from "./icons"
import { unwrap } from "./requests"
import type { RunAction } from "./requests"
import { useBackgroundRefresh } from "./refresh"

type Note = { id: string; title: string; text: string; created_at: number; recall?: boolean; invitation?: string }
type Followup = { id: string; summary: string; due: string; status: string; outcome: string; pending_outcome: string; prompt_submitted: boolean }
type RecordState = { revision: number; note: Note | null; memories: Note[]; followups: Followup[] }
export type ExperienceState = { enabled: boolean; revision: number; characters: Record<string, RecordState> }
export type ExperienceDestination = {
  character: string; tab: "notes" | "followups"; kind?: "draft" | "memory" | "followup"; id?: string
}
type Request = { character: string; operation: string; revision: number; request_id: string; values: Record<string, unknown> }
type Form = { character: string; revision: number; operation: string; id?: string; title: string; text: string; due: string }
export const EXPERIENCE_STYLE = `
.lwy-xp { min-width:0; }
.lwy-xp-toolbar,.lwy-xp-head { display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap; }
.lwy-xp-toolbar { padding-bottom:18px;border-bottom:1px solid var(--border); }
.lwy-xp-toolbar label { display:flex;align-items:center;gap:10px;min-width:0;flex-wrap:wrap; }
.lwy-xp-toolbar label > span { flex:none; }
.lwy-xp-toolbar select { min-width:100px;max-width:240px;flex:1; }
.lwy-xp-tabs { display:flex;gap:16px;border-bottom:1px solid var(--border);margin:18px 0; }
.lwy-xp-tabs button { appearance:none;border:0;background:none;color:var(--muted);padding:10px 2px;cursor:pointer;font:inherit;border-bottom:2px solid transparent; }
.lwy-xp-tabs button[aria-selected="true"] { color:var(--accent-strong);border-bottom-color:var(--accent); }
.lwy-xp-tabs button:focus-visible { outline:2px solid var(--accent);outline-offset:2px; }
.lwy-xp-item { padding:18px 0;border-bottom:1px solid var(--border);min-width:0; }
.lwy-xp-item:focus { outline:2px solid var(--accent-line);outline-offset:4px; }
.lwy-xp-item h3 { font-size:15px;line-height:1.5;margin:0;overflow-wrap:anywhere; }
.lwy-xp-item p { white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8;margin:12px 0; }
.lwy-xp-item .lwy-btns { margin-top:12px; }
.lwy-xp-meta { color:var(--muted);font-size:12px;overflow-wrap:anywhere; }
.lwy-xp-form { display:grid;gap:16px;min-width:0; }
.lwy-xp-form label { display:grid;gap:7px;min-width:0; }
.lwy-xp-form textarea { min-height:144px;resize:vertical;max-height:45vh; }
.lwy-xp-form pre { white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;max-height:160px;overflow:auto;margin:8px 0; }
.lwy-xp-counter { color:var(--muted);font-size:12px;text-align:right; }
.lwy-xp-retry { display:flex;flex-wrap:wrap;gap:8px;margin:12px 0; }
@media(max-width:479px) { .lwy-xp-toolbar label { width:100%; } .lwy-xp-head { align-items:flex-start; } }
`

export function Experiences(props: {
  data?: ExperienceState; characters: string[]; current?: string | null; today: string
  api: PluginSurfaceProps["api"]; t: PluginSurfaceProps["t"]; useLocalState: PluginSurfaceProps["useLocalState"]
  busy: boolean; stale: boolean; run: RunAction; refresh: () => Promise<void>
  dialog: (open: boolean) => void; feedback: () => any
  destination?: ExperienceDestination | null; arrived?: () => void
}) {
  const { t, data, run } = props
  const confirm = useConfirm()
  const [selected, setSelected] = props.useLocalState<string>("lwy:experience-character", "")
  const [storedTab, setTab] = props.useLocalState<string>("lwy:experience-tab", "notes")
  const tab = props.destination?.tab || storedTab
  const [pending, setPending] = props.useLocalState<Request | null>("lwy:experience-request", null)
  const [form, setForm] = useState<Form | null>(null)
  const requestRef = useRef<Request | null>(pending)
  requestRef.current = pending
  const locked = useRef(props.busy)
  locked.current = props.busy
  const close = useCallback(() => { if (!locked.current) setForm(null) }, [])
  useEffect(() => { props.dialog(Boolean(form)); return () => props.dialog(false) }, [Boolean(form)])
  useEffect(() => {
    const target = props.destination
    if (!target || !data) return
    setSelected(target.character)
    setTab(target.tab)
    const record = data.characters[target.character]
    if (data.enabled && !requestRef.current && target.kind === "draft") {
      const note = record?.note
      if (target.id && note?.id === target.id) setForm({
        character: target.character, revision: record.revision, operation: "save_note",
        id: note.id, title: note.title, text: note.text, due: props.today,
      })
      else if (!target.id && !note) setForm({
        character: target.character, revision: record?.revision || 0, operation: "start_note",
        title: t("xp.defaultTitle"), text: "", due: props.today,
      })
    }
    if (data.enabled && !requestRef.current && target.kind === "followup" && !target.id) setForm({
      character: target.character, revision: record?.revision || 0, operation: "propose_followup",
      title: "", text: "", due: props.today,
    })
    const frame = requestAnimationFrame(() => {
      if (target.id && target.kind !== "draft") {
        const item = [...document.querySelectorAll<HTMLElement>("[data-experience-id]")]
          .find(node => node.dataset.experienceId === target.id)
        item?.scrollIntoView({ block: "center" })
        item?.focus({ preventScroll: true })
      }
      props.arrived?.()
    })
    return () => cancelAnimationFrame(frame)
  }, [props.destination, Boolean(data)])
  useBackgroundRefresh(() => props.api.refresh(), props.busy || Boolean(form), Boolean(data?.enabled))
  if (!data) return <Alert tone="info" message={t("xp.notReady")} />
  const characters = [...new Set([props.current || "", ...props.characters, ...Object.keys(data.characters)].filter(Boolean))]
  const wanted = props.destination?.character || selected
  const character = characters.includes(wanted) ? wanted : props.current || characters[0] || ""
  const record = data.characters[character] || { revision: 0, note: null, memories: [], followups: [] }
  const blocked = props.busy || props.stale || Boolean(pending)
  const clearRequest = () => { requestRef.current = null; setPending(null) }
  const titleFor = (operation: string) => t(["propose_followup", "confirm_followup", "edit_followup"].includes(operation)
    ? "xp.followups" : operation === "save_outcome" ? "xp.outcome" : "xp.notes")

  async function perform(operation: string, values: Record<string, unknown>, target = character, revision = record.revision, retry = false) {
    if (locked.current || (!retry && (requestRef.current || props.stale))) return false
    let request = requestRef.current
    if (!retry) {
      request = { character: target, operation, revision, request_id: crypto.randomUUID(), values }
      requestRef.current = request
      setPending(request)
    }
    if (!request) return false
    const submitted = request
    return run("experience_action", { ...submitted }, value => {
      const result = unwrap(value, "operation")
      if (result.operation !== submitted.operation || result.revision !== submitted.revision + 1 ||
        (submitted.operation !== "configure" && (typeof result.id !== "string" || !result.id)) ||
        (submitted.values.id !== undefined && result.id !== submitted.values.id)) {
        throw new Error("invalid_response")
      }
      if (submitted.operation === "invite") return t(`xp.invitation.${result?.invitation || "unknown"}`)
      return t("xp.saved")
    }, clearRequest)
  }

  async function toggle(enabled: boolean) {
    const source = document.activeElement
    if (enabled && !await confirm({
      title: t("xp.enableTitle"), message: t("xp.privacy"), confirmLabel: t("xp.enable"),
      cancelLabel: t("common.cancel"),
    })) {
      if (source instanceof HTMLInputElement) source.checked = data!.enabled
      return
    }
    const ok = await perform("configure", { enabled }, "", data!.revision)
    if (!ok && source instanceof HTMLInputElement) source.checked = data!.enabled
  }

  function open(operation: string, item?: Note | Followup) {
    setForm({
      character, revision: record.revision, operation, id: item?.id,
      title: item && "title" in item ? item.title : t("xp.defaultTitle"),
      text: item ? "text" in item ? item.text : operation === "save_outcome"
        ? item.pending_outcome || item.outcome : item.summary : "",
      due: item && "due" in item ? item.due : props.today,
    })
  }

  async function saveForm(draft = false) {
    if (!form) return
    const operation = draft && form.operation === "save_note" ? "draft_note" : form.operation
    const values = { id: form.id, ...(["propose_followup", "confirm_followup", "edit_followup"].includes(operation)
      ? { summary: form.text, due: form.due }
      : operation === "save_outcome" ? { outcome: form.text } : { title: form.title, text: form.text }) }
    if (await perform(operation, values, form.character, form.revision)) setForm(null)
  }

  async function remove(operation: string, id: string) {
    if (await confirm({
      title: t(operation === "cancel_note" ? "xp.cancelTitle" : "xp.deleteTitle"),
      message: t(operation === "cancel_note" ? "xp.cancelMessage" : "xp.deleteMessage"),
      tone: "danger", confirmLabel: t(operation === "cancel_note" ? "xp.end" : "xp.delete"),
      cancelLabel: t("common.cancel"),
    })) await perform(operation, { id })
  }

  function retryControls() {
    return pending ? <div className="lwy-xp-retry">
      <Button disabled={props.busy} onClick={async () => {
        if (await perform("", {}, "", 0, true)) setForm(null)
      }}><Icon name="RotateCw" />{t("xp.retry")}</Button>
      <Button disabled={props.busy} onClick={async () => {
        if (await confirm({ title: t("xp.abandon"), message: t("xp.abandonMessage"),
          confirmLabel: t("common.confirm"), cancelLabel: t("common.cancel") })) {
          clearRequest(); await props.refresh()
        }
      }}>{t("xp.abandon")}</Button>
    </div> : null
  }

  const followupForm = form && ["propose_followup", "confirm_followup", "edit_followup"].includes(form.operation)
  const outcomeForm = form?.operation === "save_outcome"
  const maxText = followupForm || outcomeForm ? 160 : 600
  const formValid = form && form.text.trim() && Array.from(form.text).length <= maxText &&
    (followupForm ? /^\d{4}-\d{2}-\d{2}$/.test(form.due) && form.due >= props.today
      : outcomeForm || form.title.trim() && Array.from(form.title).length <= 40)
  const note = record.note
  const formRecord = form ? data.characters[form.character] : undefined
  const formChanged = Boolean(form && (formRecord?.revision || 0) !== form.revision)
  const formFollowup = formRecord?.followups.find(item => item.id === form?.id)
  const latestContent = form && formRecord ? form.operation === "save_note"
    ? [formRecord.note?.title, formRecord.note?.text].filter(Boolean).join("\n") : form.operation === "edit_memory"
      ? formRecord.memories.find(item => item.id === form.id)?.text || ""
      : formFollowup ? [formFollowup.due, formFollowup.summary, formFollowup.pending_outcome || formFollowup.outcome]
        .filter(Boolean).join("\n") : "" : ""

  return <div className="lwy-xp">
    <div className="lwy-xp-toolbar">
      <Switch checked={data.enabled} label={t("xp.enabled")} disabled={blocked || Boolean(form)} onChange={toggle} />
      <button type="button" className="lwy-icon-button" title={t("common.refresh")} aria-label={t("common.refresh")}
        disabled={props.busy} onClick={props.refresh}><Icon name="RotateCw" /></button>
    </div>
    {retryControls()}
    {!data.enabled ? <Alert tone="info" message={t("xp.off")} /> : null}
    <>
      <div className="lwy-xp-toolbar">
        <label><span>{t("xp.character")}</span><select className="neko-select" value={character}
          aria-label={t("xp.character")} disabled={blocked || Boolean(form)}
          onChange={(event: any) => setSelected(event.target.value)}>
          {characters.map(name => <option value={name} selected={name === character} key={name}>{name}</option>)}
        </select></label>
      </div>
      {!character ? <p className="lwy-empty">{t("xp.noCharacter")}</p> : <>
        <div className="lwy-xp-tabs" role="tablist" aria-label={t("xp.title")}>
          {["notes", "followups"].map(key => <button key={key} type="button" role="tab"
            aria-selected={tab === key ? "true" : "false"} onClick={() => setTab(key)}>{t(`xp.${key}`)}</button>)}
        </div>
        {tab === "notes" ? <div role="tabpanel" aria-label={t("xp.notes")}>
          <div className="lwy-xp-head"><h2 className="lwy-h">{t("xp.together")}</h2>
            <Button tone="primary" disabled={blocked || !data.enabled || Boolean(note) || record.memories.length >= 30}
              onClick={() => open("start_note")}><Icon name="Plus" />{t("xp.start")}</Button></div>
          {note ? <article className="lwy-xp-item" data-experience-id={note.id} tabIndex={-1}>
            <h3>{note.title}</h3>
            <p className="lwy-xp-meta">{t("xp.draft")}</p>
            <p>{note.text || t("xp.blank")}</p>
            <span className="lwy-xp-meta">{t(`xp.invitation.${note.invitation || "not_requested"}`)}</span>
            <div className="lwy-btns">
              <Button disabled={blocked || !data.enabled} onClick={async () => { await perform("invite", { id: note.id }) }}><Icon name="MessageCircle" />{t("xp.invite")}</Button>
              <Button tone="primary" disabled={blocked || !data.enabled} onClick={() => open("save_note", note)}><Icon name="Save" />{t("xp.review")}</Button>
              <Button disabled={blocked} onClick={() => remove("cancel_note", note.id)}>{t("xp.end")}</Button>
            </div>
          </article> : <p className="lwy-empty">{t("xp.noDraft")}</p>}
          <h2 className="lwy-h" style={{ marginTop: "24px" }}>{t("xp.memories")}</h2>
          {!record.memories.length ? <p className="lwy-empty">{t("xp.noMemories")}</p> : record.memories.map(item =>
            <article className="lwy-xp-item" key={item.id} data-experience-id={item.id} tabIndex={-1}>
              <div className="lwy-xp-head"><h3>{item.title}</h3><div className="lwy-btns">
                <button className="lwy-icon-button" type="button" title={t("xp.edit")} aria-label={t("xp.edit")}
                  disabled={blocked || !data.enabled} onClick={() => open("edit_memory", item)}><Icon name="Pencil" /></button>
                <button className="lwy-icon-button" type="button" title={t("xp.delete")} aria-label={t("xp.delete")}
                  disabled={blocked} onClick={() => remove("delete_memory", item.id)}><Icon name="Trash2" /></button>
              </div></div>
              <p>{item.text}</p>
              <Switch checked={item.recall === true} label={t("xp.recall")} disabled={blocked || !data.enabled}
                onChange={recall => perform("toggle_memory", { id: item.id, recall })} />
            </article>)}
        </div> : <div role="tabpanel" aria-label={t("xp.followups")}>
          <div className="lwy-xp-head"><h2 className="lwy-h">{t("xp.followups")}</h2>
            <Button tone="primary" disabled={blocked || !data.enabled || record.followups.length >= 20}
              onClick={() => open("propose_followup")}><Icon name="Plus" />{t("xp.add")}</Button></div>
          {!record.followups.length ? <p className="lwy-empty">{t("xp.noFollowups")}</p> : record.followups.map(item =>
            <article className="lwy-xp-item" key={item.id} data-experience-id={item.id} tabIndex={-1}>
              <div className="lwy-xp-head"><h3>{item.summary}</h3>
                <button type="button" className="lwy-icon-button" title={t("xp.delete")} aria-label={t("xp.delete")}
                  disabled={blocked} onClick={() => remove("delete_followup", item.id)}><Icon name="Trash2" /></button></div>
              <p className="lwy-xp-meta">{item.due} · {t(`xp.status.${item.status}`)}
                {item.prompt_submitted && item.status === "active" ? ` · ${t("xp.promptSubmitted")}` : ""}</p>
              {item.outcome ? <p>{item.outcome}</p> : null}
              {item.pending_outcome ? <p>{t("xp.pendingOutcome")}：{item.pending_outcome}</p> : null}
              {item.status !== "closed" ? <div className="lwy-btns">
                <Button disabled={blocked || !data.enabled} onClick={() => open(item.status === "pending" ? "confirm_followup" : "edit_followup", item)}>
                  <Icon name={item.status === "pending" ? "Check" : "Pencil"} />{t(item.status === "pending" ? "xp.confirmFollowup" : "xp.postpone")}</Button>
                {item.status === "active" ? <Button disabled={blocked || !data.enabled} onClick={() => open("save_outcome", item)}>
                  <Icon name="Save" />{t("xp.outcome")}</Button> : null}
                <Button disabled={blocked || !data.enabled} onClick={async () => { await perform("close_followup", { id: item.id }) }}>{t("xp.close")}</Button>
              </div> : null}
            </article>)}
        </div>}
      </>}
    </>
    {form ? <Modal open title={`${titleFor(form.operation)} · ${form.character}`} onClose={close}
      footer={<div className="lwy-btns"><Button disabled={props.busy} onClick={close}>{t("common.cancel")}</Button>
        {form.operation === "save_note" ? <Button disabled={blocked || formChanged || !formValid} onClick={() => saveForm(true)}>
          <Icon name="Pencil" />{t("xp.saveDraft")}</Button> : null}
        <Button tone="primary" disabled={blocked || formChanged || !formValid} onClick={() => saveForm()}>
          <Icon name="Save" />{t(["start_note", "propose_followup"].includes(form.operation)
            ? "xp.createDraft" : "xp.confirmSave")}</Button></div>}>
      <div className="lwy-xp-form">
        {props.stale ? <Button disabled={props.busy} onClick={props.refresh}>
          <Icon name="RotateCw" />{t("common.refresh")}</Button> : null}
        {formChanged && !pending ? <div>
          <Alert tone="warning" message={t("xp.conflictMessage")} />
          {latestContent ? <details><summary>{t("xp.latest")}</summary><pre>{latestContent}</pre></details> : null}
          <Button disabled={props.busy || props.stale} onClick={async () => {
            if (await confirm({ title: t("xp.reviewLatest"), message: t("xp.conflictMessage"),
              confirmLabel: t("common.confirm"), cancelLabel: t("common.cancel") })) {
              setForm(current => current && ({ ...current, revision: formRecord?.revision || 0 }))
            }
          }}>{t("xp.reviewLatest")}</Button>
        </div> : null}
        {!followupForm && !outcomeForm ? <label><span>{t("xp.noteTitle")}</span>
          <Input value={form.title} disabled={props.busy} onChange={title => setForm(current => current && ({ ...current, title }))} /></label> : null}
        <label><span>{t(followupForm ? "xp.summary" : outcomeForm ? "xp.outcome" : "xp.content")}</span>
          <Textarea value={form.text} disabled={props.busy}
            onChange={text => setForm(current => current && ({ ...current, text }))} /></label>
        <span className="lwy-xp-counter">{Array.from(form.text).length} / {maxText}</span>
        {followupForm ? <label><span>{t("xp.due")}</span>
          <input className="neko-input" type="date" value={form.due} min={props.today} disabled={props.busy}
            onInput={(event: any) => setForm(current => current && ({ ...current, due: event.target.value }))} /></label> : null}
        {props.feedback()}
        {retryControls()}
      </div>
    </Modal> : null}
  </div>
}
