import { icon } from "./cottage-icons.mjs?v=0.9.15"

const LABELS = {
  "zh-CN": ["上一段回忆", "下一段回忆", "便签", "一起看", "看到这里"],
  "zh-TW": ["上一段回憶", "下一段回憶", "便箋", "一起看", "看到這裡"],
  en: ["Previous memory", "Next memory", "Note", "Watched together", "Where we left off"],
  es: ["Recuerdo anterior", "Recuerdo siguiente", "Nota", "Visto juntos", "Dónde nos quedamos"],
  ja: ["前の思い出", "次の思い出", "メモ", "一緒に見たもの", "ここまで見た"],
  ko: ["이전 추억", "다음 추억", "메모", "함께 본 것", "여기까지 봤어요"],
  pt: ["Lembrança anterior", "Próxima lembrança", "Nota", "Visto juntos", "Onde paramos"],
  ru: ["Предыдущее воспоминание", "Следующее воспоминание", "Заметка", "Смотрели вместе", "На чём остановились"],
}

export function createPicturePages({ locale, openOriginal }) {
  const byId = id => document.getElementById(`picture-${id}`)
  const pages = byId("pages")
  const caption = byId("caption")
  const selector = byId("role")
  const previous = byId("previous")
  const next = byId("next")
  const original = byId("original")
  const [previousLabel, nextLabel, noteLabel, screenLabel, progressLabel] = LABELS[locale]
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium" })
  const numberFormat = new Intl.NumberFormat(locale)
  const reduced = matchMedia("(prefers-reduced-motion: reduce)")
  let data = { roles: [], status: "", empty: "" }
  let role = ""
  let index = 0
  let entries = []

  for (const [button, label, symbol] of [[previous, previousLabel, "ChevronLeft"], [next, nextLabel, "ChevronRight"]]) {
    button.title = label
    button.setAttribute("aria-label", label)
    button.append(icon(symbol))
  }
  const progress = byId("progress")
  progress.firstElementChild.textContent = progressLabel

  function render(direction = 0) {
    entries = data.roles.find(item => item.name === role)?.memories || []
    index = Math.max(0, Math.min(index, entries.length - 1))
    const item = entries[index]
    const empty = byId("empty")
    const entry = byId("entry")
    empty.textContent = item ? "" : data.status || data.empty
    empty.hidden = Boolean(item)
    entry.hidden = original.hidden = !item
    byId("pager").hidden = entries.length < 2
    previous.setAttribute("aria-disabled", String(index === 0))
    next.setAttribute("aria-disabled", String(index >= entries.length - 1))
    if (item) {
      byId("count").textContent = `${numberFormat.format(index + 1)} / ${numberFormat.format(entries.length)}`
      byId("kind").textContent = item.kind === "screen" ? screenLabel : noteLabel
      const date = byId("date")
      const saved = new Date(item.created_at * 1000)
      date.hidden = !(item.created_at > 0 && Number.isFinite(saved.getTime()))
      date.dateTime = date.hidden ? "" : saved.toISOString()
      date.textContent = date.hidden ? "" : dateFormat.format(saved)
      byId("entry-title").textContent = item.title
      const note = byId("note")
      note.textContent = item.text || ""
      note.hidden = !item.text
      progress.lastElementChild.textContent = item.progress || ""
      progress.hidden = !item.progress
    }
    if (!pages.hidden) {
      caption.scrollTop = 0
      if (direction && !reduced.matches) {
        entry.getAnimations().forEach(animation => animation.cancel())
        entry.animate([{ opacity: .25, transform: `translateX(${direction * 8}px)` },
          { opacity: 1, transform: "none" }], { duration: 220, easing: "ease-out" })
      }
    }
  }

  function step(direction) {
    const target = index + direction
    if (target < 0 || target >= entries.length) return
    index = target
    render(direction)
  }
  previous.onclick = () => step(-1)
  next.onclick = () => step(1)
  original.onclick = () => {
    if (entries[index]) openOriginal(role, entries[index].id)
  }
  selector.onchange = () => {
    role = selector.value
    index = 0
    render()
  }
  pages.addEventListener("keydown", event => {
    if (event.target === selector || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault()
      step(event.key === "ArrowLeft" ? -1 : 1)
    }
  })

  return {
    select(character, id) {
      const memories = data.roles.find(item => item.name === character)?.memories
      const match = memories?.findIndex(item => item.id === id) ?? -1
      if (match < 0) return false
      role = selector.value = character
      index = match
      render()
      return true
    },
    update(payload) {
      const selectedId = entries[index]?.id
      data = payload
      const previousRole = data.roles.find(item => item.name === role)
      if (!previousRole) role = data.roles[0]?.name || ""
      index = previousRole?.memories.findIndex(item => item.id === selectedId) ?? 0
      byId("title").textContent = data.title
      selector.setAttribute("aria-label", data.scope)
      selector.replaceChildren(...data.roles.map(item => new Option(item.name, item.name)))
      selector.value = role
      selector.hidden = data.roles.length < 2
      original.replaceChildren(data.original, icon("ChevronRight"))
      render()
    },
    position(width, height) {
      pages.style.setProperty("--picture-width", `${width}px`)
      pages.style.setProperty("--picture-height", `${height}px`)
    },
    reveal(text, controls, interactive) {
      const hidden = text === 0 && controls === 0
      if (!hidden && pages.hidden) caption.scrollTop = 0
      pages.inert = !interactive
      pages.hidden = hidden
      pages.style.setProperty("--picture-text", text)
      pages.style.setProperty("--picture-controls", controls)
    },
  }
}
