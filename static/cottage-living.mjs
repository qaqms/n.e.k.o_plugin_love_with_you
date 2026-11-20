import { icon } from "./cottage-icons.mjs?v=0.9.22"

const COPY = {
  "zh-CN": ["茶几便签本", "礼物陈列架", "坐到沙发上", "本地时间", "白天", "黄昏", "夜晚",
    "选择已送出的礼物", "还没有已送出的礼物", "移下陈列架", "展示位", "便签内容已变化，请刷新后核对。"],
  "zh-TW": ["茶几便箋本", "禮物陳列架", "坐到沙發上", "本地時間", "白天", "黃昏", "夜晚",
    "選擇已送出的禮物", "還沒有已送出的禮物", "移下陳列架", "展示位", "便箋內容已變更，請重新整理後核對。"],
  en: ["Coffee table notebook", "Gift shelf", "Sit on the sofa", "Local time", "Day", "Dusk", "Night",
    "Choose a sent gift", "No gifts sent yet", "Remove from shelf", "Display spot", "This note has changed. Refresh to review it."],
  es: ["Cuaderno de la mesa", "Estante de regalos", "Sentarse en el sofá", "Hora local", "Día", "Atardecer", "Noche",
    "Elegir un regalo enviado", "Aún no hay regalos enviados", "Quitar del estante", "Espacio", "La nota ha cambiado. Actualiza para revisarla."],
  ja: ["テーブルのノート", "ギフト棚", "ソファに座る", "現地時間", "昼", "夕暮れ", "夜",
    "贈ったギフトを選ぶ", "贈ったギフトはありません", "棚から外す", "展示場所", "メモが変更されました。更新して確認してください。"],
  ko: ["탁자 위 노트", "선물 진열대", "소파에 앉기", "현지 시간", "낮", "해질녘", "밤",
    "보낸 선물 선택", "아직 보낸 선물이 없어요", "진열대에서 빼기", "진열 위치", "메모가 변경되었습니다. 새로 고침하여 확인하세요."],
  pt: ["Caderno da mesa", "Estante de presentes", "Sentar no sofá", "Hora local", "Dia", "Entardecer", "Noite",
    "Escolher um presente enviado", "Nenhum presente enviado", "Retirar da estante", "Espaço", "A nota mudou. Atualize para conferir."],
  ru: ["Блокнот на столике", "Полка подарков", "Сесть на диван", "Местное время", "День", "Закат", "Ночь",
    "Выбрать отправленный подарок", "Подарков пока нет", "Убрать с полки", "Место", "Заметка изменилась. Обновите данные, чтобы проверить."],
}
const periods = ["auto", "day", "dusk", "night"]
const shelfKey = "love_with_you:cottage:shelf:v1"

export function livingLabels(locale) {
  const [notebook, shelf, seat, ...labels] = COPY[locale] || COPY.en
  return { notebook, shelf, seat, periods: labels.slice(0, 4),
    choose: labels[4], empty: labels[5], remove: labels[6], slot: labels[7], changed: labels[8] }
}

export function setButton(button, label, symbol) {
  button.title = label
  button.setAttribute("aria-label", label)
  button.replaceChildren(icon(symbol))
}

export function createNotebook({ names, send, onKept }) {
  const byId = id => document.getElementById(`notebook-${id}`)
  const section = byId("pages")
  const role = byId("role")
  const subject = byId("subject")
  const text = byId("text")
  const form = byId("form")
  const status = byId("status")
  const draft = byId("draft")
  const save = byId("save")
  const retry = byId("retry")
  const refresh = byId("refresh")
  let data = { roles: [], labels: {} }
  let editor = null
  let pending = null
  let sending = false
  let message = ""
  const currentRole = () => data.roles.find(item => item.name === role.value)
  const loadEditor = item => {
    editor = item ? { name: item.name, revision: item.revision, id: item.note?.id,
      title: item.note?.title || "", text: item.note?.text || "" } : null
    subject.value = editor?.title || ""
    text.value = editor?.text || ""
  }
  const dirty = () => editor && (subject.value !== editor.title || text.value !== editor.text)
  const conflict = () => editor && (editor.revision !== currentRole()?.revision || editor.id !== currentRole()?.note?.id)
  byId("title").textContent = names.notebook

  function render() {
    const item = currentRole()
    const blocked = sending || pending || data.busy || data.stale || conflict()
    const valid = Boolean(subject.value.trim() && Array.from(subject.value).length <= 40 &&
      Array.from(text.value).length <= 600)
    form.hidden = !item || Boolean(data.status)
    role.hidden = data.roles.length === 0
    role.disabled = Boolean(sending || pending || dirty())
    subject.readOnly = text.readOnly = Boolean(pending || sending)
    draft.disabled = Boolean(blocked || !valid || (item?.note && !text.value.trim()))
    save.disabled = Boolean(blocked || !valid || !text.value.trim() || item?.full)
    retry.hidden = !pending || sending
    retry.disabled = Boolean(data.busy)
    refresh.hidden = Boolean(pending) || !(data.stale || conflict())
    refresh.disabled = Boolean(data.busy)
    status.textContent = data.status || message || (conflict() ? names.changed : "") || (item?.full ? data.labels.limit : "") || ""
    status.hidden = !status.textContent
  }
  function submit(keep) {
    if ((keep ? save : draft).disabled || !editor) return
    pending = { token: crypto.randomUUID(), character: editor.name, revision: editor.revision,
      title: subject.value, text: text.value, keep }
    transmit()
  }
  function transmit() {
    if (!pending || sending) return
    message = ""
    sending = true
    render()
    send("love-with-you-cottage-save-note", pending)
  }
  role.onchange = () => { message = ""; loadEditor(currentRole()); render() }
  form.oninput = () => { message = ""; render() }
  form.onsubmit = event => { event.preventDefault(); submit(true) }
  draft.onclick = () => submit(false)
  retry.onclick = transmit
  refresh.onclick = () => {
    if (conflict() && currentRole()) {
      const changes = { title: subject.value, text: text.value }
      loadEditor(currentRole())
      subject.value = changes.title
      text.value = changes.text
      message = ""
      render()
    }
    send("love-with-you-cottage-refresh")
  }

  return {
    startFor(character, title) {
      const item = data.roles.find(item => item.name === character)
      if (!item || pending || dirty()) return
      role.value = character
      loadEditor(item)
      if (!item.note) subject.value = Array.from(title).slice(0, 40).join("")
      message = ""
      render()
    },
    update(payload) {
      const selected = role.value
      data = payload
      if (JSON.stringify([...role.options].map(option => option.value)) !== JSON.stringify(data.roles.map(item => item.name))) {
        role.replaceChildren(...data.roles.map(item => new Option(item.name, item.name)))
      }
      role.value = data.roles.some(item => item.name === selected) ? selected : data.roles[0]?.name || ""
      role.setAttribute("aria-label", data.scope)
      for (const [field, label] of [[subject, data.labels.title], [text, data.labels.text]]) {
        field.placeholder = label
        field.setAttribute("aria-label", label)
      }
      for (const [button, label, symbol] of [[draft, data.labels.draft, "Pencil"], [save, data.labels.keep, "Save"]]) {
        button.replaceChildren(icon(symbol), label)
      }
      retry.textContent = data.labels.retry
      refresh.textContent = data.labels.refresh
      if (!pending && (!dirty() || editor?.name !== role.value)) loadEditor(currentRole())
      render()
    },
    result(result) {
      if (result.token !== pending?.token) return
      sending = false
      if (!result.retry) pending = null
      if (result.ok) {
        loadEditor(currentRole())
        message = data.labels.saved
        if (result.kept) onKept(result.character, result.id)
      } else if (result.rejected) message = names.changed
      render()
    },
    position(x, y, width, height) {
      section.style.left = `${x}px`
      section.style.top = `${y}px`
      section.style.width = `${width}px`
      section.style.height = `${height}px`
    },
    reveal(amount, interactive) {
      section.hidden = amount === 0
      section.inert = !interactive
      section.style.setProperty("--unfold", amount)
    },
  }
}

export function createGiftShelf({ names, locale, showGift }) {
  const section = document.querySelector("#gift-display")
  const details = document.querySelector("#gift-details")
  const title = document.querySelector("#shelf-title")
  const picker = document.querySelector("#gift-picker")
  const remove = document.querySelector("#gift-remove")
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" })
  const number = new Intl.NumberFormat(locale)
  let selected = 0
  let gifts = []
  let saved
  try { saved = JSON.parse(localStorage.getItem(shelfKey)) } catch { /* optional local preference */ }
  const choices = Array.from({ length: 3 }, (_, index) => typeof saved?.[index] === "string" ? saved[index] : "")
  const shown = ["", "", ""]
  const positions = []
  const buttons = choices.map((_, index) => {
    const button = document.createElement("button")
    button.type = "button"
    button.onclick = () => { selected = index; render() }
    document.querySelector("#gift-slots").append(button)
    return button
  })
  setButton(remove, names.remove, "X")
  picker.setAttribute("aria-label", names.choose)

  function positionThread() {
    const point = positions[selected]
    if (!point) return
    section.style.setProperty("--gift-anchor", `${point.x}px`)
    section.style.setProperty("--gift-thread-top", `${point.y + 19}px`)
  }

  function render() {
    const selectedGift = gifts.find(gift => gift.id === choices[selected])
    title.textContent = selectedGift?.name || names.shelf
    details.textContent = selectedGift
      ? `${selectedGift.character} · ${date.format(new Date(selectedGift.ts * 1000))}`
      : gifts.length ? "" : names.empty
    details.hidden = !details.textContent
    const options = gifts.filter(gift => gift.id === choices[selected] || !choices.includes(gift.id))
    picker.replaceChildren(new Option(names.choose, ""), ...options.map(gift =>
      new Option(`${gift.name} · ${gift.character} · ${date.format(new Date(gift.ts * 1000))}`, gift.id)))
    picker.value = selectedGift?.id || ""
    picker.disabled = !options.length
    remove.hidden = !selectedGift
    buttons.forEach((button, index) => {
      const gift = gifts.find(item => item.id === choices[index])
      const label = `${names.slot} ${number.format(index + 1)}${gift ? ` · ${gift.name}` : ""}`
      if (button.title !== label) setButton(button, label, gift ? "Gift" : "Plus")
      button.setAttribute("aria-pressed", String(index === selected))
      if (shown[index] !== (gift?.item || "")) {
        shown[index] = gift?.item || ""
        showGift(index, shown[index])
      }
    })
    positionThread()
  }
  function assign(id) {
    choices[selected] = id
    try { localStorage.setItem(shelfKey, JSON.stringify(choices)) } catch { /* still usable in this session */ }
    render()
  }
  picker.onchange = () => assign(picker.value)
  remove.onclick = () => { assign(""); picker.focus() }
  render()

  return {
    update(items) {
      const next = items.filter(item => item.ts > 0 && Number.isFinite(new Date(item.ts * 1000).getTime()))
      if (JSON.stringify(gifts) === JSON.stringify(next)) return
      gifts = next
      render()
    },
    position(points, tagY) {
      points.forEach((point, index) => {
        positions[index] = point
        buttons[index].style.left = `${point.x}px`
        buttons[index].style.top = `${point.y}px`
      })
      positionThread()
      section.style.setProperty("--gift-tag-top", `${tagY}px`)
    },
    reveal(amount, interactive) {
      section.hidden = amount === 0
      section.inert = !interactive
      section.style.setProperty("--unfold", amount)
    },
  }
}

export function createSeat({ names, labels, recordLabel, linked, toggle, choosePeriod, openRecord }) {
  const controls = document.querySelector("#seat-controls")
  const lamp = document.querySelector("#seat-lamp")
  const curtains = document.querySelector("#seat-curtains")
  const record = document.querySelector("#seat-record")
  controls.setAttribute("aria-label", names.seat)
  document.querySelector("#period-controls").setAttribute("aria-label", names.periods[0])
  setButton(lamp, labels[0], "Lamp")
  setButton(curtains, labels[1], "Blinds")
  setButton(record, recordLabel, "Disc3")
  lamp.onclick = () => toggle("lamp")
  curtains.onclick = () => toggle("curtains")
  record.onclick = openRecord
  record.hidden = !linked
  const options = periods.map((period, index) => {
    const button = document.querySelector(`#period-${period}`)
    setButton(button, names.periods[index], ["Clock", "Sun", "Sunset", "Moon"][index])
    button.onclick = () => choosePeriod(period)
    return button
  })
  return {
    sync(preferences) {
      lamp.setAttribute("aria-pressed", String(preferences.lamp))
      curtains.setAttribute("aria-pressed", String(preferences.curtains))
      options.forEach((button, index) => button.setAttribute("aria-pressed", String(periods[index] === preferences.period)))
    },
    show() { controls.hidden = false },
    hide() { controls.hidden = true },
  }
}

export function localPeriod(hour = new Date().getHours()) {
  if (hour < 6 || hour >= 20) return "night"
  return hour >= 17 ? "dusk" : "day"
}
