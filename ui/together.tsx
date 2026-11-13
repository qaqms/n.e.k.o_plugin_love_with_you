import { Button } from "@neko/plugin-ui"
import type { PluginSurfaceProps } from "@neko/plugin-ui"
import { Icon } from "./icons"
import type { ExperienceDestination, ExperienceState } from "./experiences"

export const TOGETHER_STYLE = `
.lwy-together { grid-column:1 / -1;min-width:0;padding-bottom:24px;border-bottom:1px solid var(--border);margin-bottom:24px; }
.lwy-together .lwy-card-head { margin-bottom:8px; }
.lwy-together-person { margin:0 0 8px;color:var(--muted);font-size:12px;overflow-wrap:anywhere; }
.lwy-together-row { display:grid;grid-template-columns:20px minmax(0,1fr) auto;gap:12px;align-items:center;padding:14px 0; }
.lwy-together-row + .lwy-together-row { border-top:1px solid var(--border); }
.lwy-together-row > .lwy-icon { color:var(--accent-strong);align-self:start;margin-top:3px; }
.lwy-together-copy { min-width:0; }
.lwy-together-copy strong { display:block;font-size:14px;overflow-wrap:anywhere; }
.lwy-together-copy p { margin:4px 0 0;color:var(--muted);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere; }
.lwy-together-preview { display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden; }
.lwy-together .lwy-btns { margin-top:12px; }
@media(max-width:700px) {
  .lwy-together-row { grid-template-columns:20px minmax(0,1fr);gap:8px; }
  .lwy-together-row > button { grid-column:2;justify-self:start; }
}
`

export function Together(props: {
  data?: ExperienceState; character: string; busy: boolean
  t: PluginSurfaceProps["t"]; open: (destination?: ExperienceDestination) => void
}) {
  const { data, character, t } = props
  const record = data?.enabled && character ? data.characters[character] : undefined
  const note = record?.note
  const followup = record?.followups.filter(item => item.status === "pending" || item.status === "active")
    .sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") ||
      Number(Boolean(b.pending_outcome)) - Number(Boolean(a.pending_outcome)) || a.due.localeCompare(b.due))[0]
  const memory = record?.memories.reduce((latest, item) =>
    !latest || item.created_at > latest.created_at ? item : latest, undefined as typeof record.memories[number] | undefined)
  const open = (kind: ExperienceDestination["kind"], id?: string) =>
    props.open({ character, tab: kind === "followup" ? "followups" : "notes", kind, id })

  return <section className="lwy-together" aria-label={t("overview.together")}>
    <div className="lwy-card-head">
      <h2 className="lwy-h">{t("overview.together")}</h2>
      <button type="button" className="lwy-text-button" disabled={props.busy}
        onClick={() => props.open(character ? { character, tab: "notes" } : undefined)}>
        {t("overview.allExperiences")}<Icon name="ChevronRight" />
      </button>
    </div>
    {character ? <p className="lwy-together-person">{t("overview.participant", { name: character })}</p> : null}
    {!data ? <p className="lwy-note">{t("xp.notReady")}</p>
      : !data.enabled ? <p className="lwy-note">{t("xp.off")}</p>
      : !character ? <p className="lwy-note">{t("xp.noCharacter")}</p> : <>
        {note ? <div className="lwy-together-row">
          <Icon name="Pencil" />
          <div className="lwy-together-copy">
            <strong>{note.title}</strong>
            <p>{t("xp.draft")}</p>
            <p>{t(`xp.invitation.${note.invitation || "not_requested"}`)}</p>
          </div>
          <Button tone="primary" disabled={props.busy} onClick={() => open("draft", note.id)}>
            <Icon name="Pencil" />{t("overview.continue")}
          </Button>
        </div> : null}
        {followup ? <div className="lwy-together-row">
          <Icon name="CalendarDays" />
          <div className="lwy-together-copy">
            <strong>{followup.summary}</strong>
            <p>{followup.due} · {t(`xp.status.${followup.status}`)}</p>
            {followup.pending_outcome ? <p>{t("xp.pendingOutcome")}</p> : null}
            {followup.prompt_submitted && followup.status === "active" ? <p>{t("xp.promptSubmitted")}</p> : null}
          </div>
          <Button tone="default" disabled={props.busy} onClick={() => open("followup", followup.id)}>
            <Icon name="ChevronRight" />{t("overview.viewFollowup")}
          </Button>
        </div> : null}
        {memory ? <div className="lwy-together-row">
          <Icon name="BookOpen" />
          <div className="lwy-together-copy">
            <strong>{memory.title}</strong>
            <p className="lwy-together-preview">{memory.text}</p>
          </div>
          <Button tone="default" disabled={props.busy} onClick={() => open("memory", memory.id)}>
            <Icon name="BookOpen" />{t("overview.viewMemory")}
          </Button>
        </div> : null}
        {!note && !followup && !memory ? <div className="lwy-btns">
          <Button tone="primary" disabled={props.busy} onClick={() => open("draft")}><Icon name="Plus" />{t("xp.start")}</Button>
          <Button tone="default" disabled={props.busy} onClick={() => open("followup")}><Icon name="CalendarDays" />{t("xp.add")}</Button>
        </div> : null}
      </>}
  </section>
}
