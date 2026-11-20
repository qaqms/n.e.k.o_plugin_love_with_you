const LABELS = {
  "zh-CN": ["唱片收藏", "回到小屋", "听到这里", "这张唱片只有标题和日期。"],
  "zh-TW": ["唱片收藏", "回到小屋", "聽到這裡", "這張唱片只有標題和日期。"],
  en: ["Record collection", "Back to the room", "Where we left off", "Only the title and date were saved."],
  es: ["Colección de discos", "Volver a la sala", "Dónde nos quedamos", "Solo se guardaron el título y la fecha."],
  ja: ["レコードコレクション", "部屋に戻る", "ここまで聴いた", "タイトルと日付が保存されています。"],
  ko: ["음반 모음", "방으로 돌아가기", "여기까지 들었어요", "제목과 날짜만 저장되었습니다."],
  pt: ["Coleção de discos", "Voltar à sala", "Onde paramos", "Somente o título e a data foram salvos."],
  ru: ["Коллекция пластинок", "Вернуться в комнату", "На чём остановились", "Сохранены только название и дата."],
}
const COLORS = ["#a54e45", "#387768", "#a26b2e", "#4f6682", "#795365"]

export const backLabel = locale => LABELS[locale][1]

export function createRecordStation({ locale, selectVinyl }) {
  const byId = id => document.getElementById(`record-${id}`)
  const station = byId("station")
  const thread = byId("thread")
  const selector = byId("role")
  const singleRole = byId("single-role")
  const empty = byId("empty")
  const sleeves = byId("sleeves")
  const detail = byId("detail")
  const date = byId("date")
  const progress = byId("progress")
  const note = byId("note")
  const [title, , progressLabel, summary] = LABELS[locale]
  const formatDate = new Intl.DateTimeFormat(locale, { dateStyle: "medium" })
  let data = { roles: [], status: "", empty: "", scope: "" }
  let roleName = ""
  let album = null

  byId("title").textContent = title
  progress.firstElementChild.textContent = progressLabel

  function select(item, index = 0) {
    if (item === album) return
    album = item
    detail.hidden = !item
    detail.style.setProperty("--record-ink", COLORS[index])
    selectVinyl(item ? COLORS[index] : null)
    for (const button of sleeves.children) button.setAttribute("aria-pressed", String(button.dataset.id === item?.id))
    if (!item) {
      for (const node of [byId("detail-title"), date, progress.lastElementChild, note]) node.textContent = ""
      date.removeAttribute("datetime")
      return
    }
    byId("detail-title").textContent = item.title
    const saved = new Date(item.created_at * 1000)
    date.hidden = !(item.created_at > 0 && Number.isFinite(saved.getTime()))
    date.dateTime = date.hidden ? "" : saved.toISOString()
    date.textContent = date.hidden ? "" : formatDate.format(saved)
    progress.hidden = !item.progress
    progress.lastElementChild.textContent = item.progress
    note.textContent = item.text || (item.progress ? "" : summary)
    note.hidden = !note.textContent
    detail.getAnimations().forEach(animation => animation.cancel())
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      detail.animate([{ opacity: 0, transform: "translateY(-7px)" }, { opacity: 1, transform: "none" }],
        { duration: 240, easing: "ease-out" })
    }
    if (station.scrollHeight > station.clientHeight) {
      detail.scrollIntoView({ block: "nearest", behavior: "instant" })
    }
  }

  function render(selectedId) {
    select(null)
    const role = data.roles.find(item => item.name === roleName)
    const albums = role?.albums || []
    selector.setAttribute("aria-label", data.scope)
    selector.replaceChildren(...data.roles.map(item => new Option(item.name, item.name)))
    selector.value = roleName
    selector.hidden = data.roles.length < 2
    singleRole.textContent = roleName
    singleRole.hidden = !roleName || !selector.hidden
    empty.textContent = data.status || data.empty
    empty.hidden = albums.length > 0
    sleeves.hidden = !albums.length
    sleeves.replaceChildren(...albums.map((item, index) => {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "record-sleeve"
      button.dataset.id = item.id
      button.title = item.title
      button.setAttribute("aria-pressed", "false")
      button.style.setProperty("--record-ink", COLORS[index])
      button.style.setProperty("--delay", `${index * 45}ms`)
      const art = document.createElement("span")
      art.className = "sleeve-art"
      art.setAttribute("aria-hidden", "true")
      const title = document.createElement("span")
      title.className = "sleeve-title"
      title.textContent = item.title
      button.append(art, title)
      button.onclick = () => select(album?.id === item.id ? null : item, index)
      return button
    }))
    const activeIndex = albums.findIndex(item => item.id === selectedId)
    if (activeIndex >= 0) select(albums[activeIndex], activeIndex)
  }

  selector.onchange = () => {
    roleName = selector.value
    render()
  }

  return {
    update(next) {
      data = next
      const selectedId = album?.id
      const keepRole = data.roles.some(item => item.name === roleName)
      if (!keepRole) roleName = data.roles[0]?.name || ""
      render(keepRole ? selectedId : undefined)
    },
    position(x, y, compact, width, height, sceneEdge) {
      const left = compact ? 12 : Math.max(sceneEdge + 26, width * .635)
      const top = compact ? sceneEdge + 12 : Math.max(58, Math.min(y - 74, height - 224))
      const endX = compact ? width / 2 : left
      const endY = compact ? top : top + 17
      const dx = endX - x
      const dy = endY - y
      station.style.setProperty("--station-left", `${left}px`)
      station.style.setProperty("--station-top", `${top}px`)
      station.dataset.compact = String(compact)
      thread.style.left = `${x}px`
      thread.style.top = `${y}px`
      thread.style.width = `${Math.hypot(dx, dy)}px`
      thread.style.rotate = `${Math.atan2(dy, dx)}rad`
    },
    show() {
      station.scrollTop = 0
      station.hidden = thread.hidden = false
    },
    hide() {
      station.hidden = thread.hidden = true
      select(null)
    },
  }
}
