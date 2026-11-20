import { icon } from "./cottage-icons.mjs?v=0.9.22"
import { setButton } from "./cottage-living.mjs?v=0.9.22"

const COPY = {
  "zh-CN": ["沙发空位", "一起坐会儿", "聊聊今天", "已发出邀请，请在宿主聊天查看回应。", "邀请状态未确认。", "当前桌宠不可用。", "请稍等几秒再邀请。",
    "小屋日历", "没有近期纪念日", "上一页", "下一页", "写一张纪念便签", "投影幕", "暂无观看进度"],
  "zh-TW": ["沙發空位", "一起坐一會兒", "聊聊今天", "已發出邀請，請在宿主聊天查看回應。", "邀請狀態未確認。", "目前桌寵無法使用。", "請稍等幾秒再邀請。",
    "小屋日曆", "近期沒有紀念日", "上一頁", "下一頁", "寫一張紀念便箋", "投影幕", "尚無觀看進度"],
  en: ["Empty sofa seat", "Sit together", "Talk about today", "Invitation sent. Check the host chat for a reply.", "Invitation status unknown.", "The desktop companion is unavailable.", "Wait a few seconds before inviting again.",
    "Cottage calendar", "No upcoming anniversaries", "Previous page", "Next page", "Write an anniversary note", "Projection screen", "No watch progress yet"],
  es: ["Asiento libre", "Sentarse juntos", "Hablar de hoy", "Invitación enviada. Mira el chat del anfitrión.", "Invitación sin confirmar.", "El acompañante no está disponible.", "Espera unos segundos antes de volver a invitar.",
    "Calendario de la casita", "No hay aniversarios próximos", "Página anterior", "Página siguiente", "Escribir una nota de aniversario", "Pantalla de proyección", "Sin progreso de reproducción"],
  ja: ["ソファの空席", "一緒に座る", "今日のことを話す", "招待を送信しました。返事はホストのチャットで確認してください。", "招待の状態を確認できません。", "デスクトップの相棒は利用できません。", "数秒待ってから招待してください。",
    "小さな家のカレンダー", "近い記念日はありません", "前のページ", "次のページ", "記念日のメモを書く", "投影スクリーン", "視聴履歴はありません"],
  ko: ["소파 빈자리", "함께 앉기", "오늘 이야기하기", "초대를 보냈어요. 호스트 채팅에서 답을 확인하세요.", "초대 상태를 확인할 수 없어요.", "데스크톱 친구를 사용할 수 없어요.", "몇 초 뒤 다시 초대하세요.",
    "우리 집 달력", "다가오는 기념일 없음", "이전 페이지", "다음 페이지", "기념일 메모 쓰기", "프로젝터 화면", "시청 진행 기록 없음"],
  pt: ["Lugar livre no sofá", "Sentar juntos", "Conversar sobre hoje", "Convite enviado. Veja a resposta no chat do anfitrião.", "Convite não confirmado.", "O companheiro não está disponível.", "Aguarde alguns segundos antes de convidar novamente.",
    "Calendário da casinha", "Sem aniversários próximos", "Página anterior", "Próxima página", "Escrever uma nota de aniversário", "Tela de projeção", "Nenhum progresso de reprodução"],
  ru: ["Свободное место на диване", "Посидеть вместе", "Поговорить о сегодняшнем дне", "Приглашение отправлено. Ответ появится в чате.", "Приглашение не подтверждено.", "Персонаж недоступен.", "Подождите несколько секунд перед новым приглашением.",
    "Календарь домика", "Нет ближайших годовщин", "Предыдущая страница", "Следующая страница", "Написать памятную заметку", "Проекционный экран", "Нет истории просмотра"],
}

export function companyLabels(locale) {
  const [emptySeat, quiet, chat, submitted, unknown, unavailable, cooldown, calendar, noDates, previous, next, write,
    projector, noWatch] = COPY[locale] || COPY.en
  return { emptySeat, quiet, chat, submitted, unknown, unavailable, cooldown, calendar, noDates, previous, next, write, projector, noWatch }
}

function labeledButton(button, label, symbol) {
  button.replaceChildren(icon(symbol), label)
}

export function createCompany({ names, send, openSeat, rest }) {
  const empty = document.querySelector("#seat-empty")
  const cups = document.querySelector("#company-cups")
  const quiet = document.querySelector("#company-quiet")
  const chat = document.querySelector("#company-chat")
  const status = document.querySelector("#company-status")
  const title = document.querySelector("#company-title")
  let character = ""
  let pending = null
  let message = ""
  let resting = false
  setButton(empty, names.emptySeat, "Coffee")
  labeledButton(quiet, names.quiet, "Coffee")
  labeledButton(chat, names.chat, "MessageCircle")
  empty.onclick = openSeat
  quiet.onclick = () => {
    resting = !resting
    quiet.setAttribute("aria-pressed", String(resting))
    rest(resting)
  }
  chat.onclick = () => {
    if (!character || pending) return
    pending = crypto.randomUUID()
    message = ""
    render()
    send("love-with-you-cottage-invite", { token: pending, character })
  }
  function render() {
    title.textContent = character || names.quiet
    chat.disabled = Boolean(pending || !character)
    chat.setAttribute("aria-busy", String(Boolean(pending)))
    status.textContent = message || (character ? "" : names.unavailable)
    status.hidden = !status.textContent
  }
  render()
  return {
    update(company) {
      if (character !== company) message = ""
      character = company
      render()
    },
    result({ token, status }) {
      if (token !== pending) return
      pending = null
      message = names[status] || names.unknown
      render()
    },
    emptyPosition(x, y, visible) {
      empty.style.left = `${x}px`
      empty.style.top = `${y}px`
      empty.hidden = !visible
    },
    show(amount, interactive) {
      cups.hidden = amount === 0
      cups.inert = !interactive
      cups.style.setProperty("--arrival", amount)
      if (!amount) {
        resting = false
        quiet.setAttribute("aria-pressed", "false")
        rest(false)
      }
    },
  }
}

export function createCalendar({ names, locale, write }) {
  const byId = id => document.getElementById(`calendar-${id}`)
  const sheet = byId("sheet")
  const date = byId("date")
  const previous = byId("prev")
  const next = byId("next")
  const writeButton = byId("write")
  let data = { today: "", calendar: [] }
  let index = 0
  const reduced = matchMedia("(prefers-reduced-motion: reduce)")
  byId("title").textContent = names.calendar
  setButton(previous, names.previous, "ChevronLeft")
  setButton(next, names.next, "ChevronRight")
  setButton(writeButton, names.write, "Pencil")
  const format = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" })

  function render() {
    const event = data.calendar[index]
    const value = event?.date || data.today
    const parsed = new Date(value)
    date.dateTime = value
    date.textContent = Number.isFinite(parsed.getTime()) ? format.format(parsed) : ""
    byId("name").textContent = event?.title || names.noDates
    byId("countdown").textContent = event?.countdown || ""
    sheet.toggleAttribute("data-today", Boolean(event?.today))
    previous.disabled = index === 0
    next.disabled = index >= data.calendar.length - 1
    writeButton.hidden = !event?.today || !data.canWrite
  }
  function turnPage(direction) {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= data.calendar.length) return
    index = nextIndex
    render()
    if (!reduced.matches) {
      for (const node of [date, byId("event")]) {
        node.getAnimations().forEach(animation => animation.cancel())
        node.animate([{ opacity: .2, transform: `translateX(${direction * 7}px)` }, { opacity: 1, transform: "none" }],
          { duration: 210, easing: "ease-out" })
      }
    }
  }
  previous.onclick = () => turnPage(-1)
  next.onclick = () => turnPage(1)
  writeButton.onclick = () => { if (data.calendar[index]?.today) write(data.character, data.calendar[index].title) }
  render()
  return {
    update(payload) {
      index = Math.min(index, Math.max(0, payload.calendar.length - 1))
      data = payload
      render()
    },
    writeToday() {
      const event = data.calendar.find(item => item.today)
      if (event && data.canWrite) write(data.character, event.title)
    },
    show(amount, interactive) {
      sheet.hidden = amount === 0
      sheet.inert = !interactive
      sheet.style.setProperty("--arrival", amount)
    },
  }
}

export function createProjector(names) {
  const byId = id => document.getElementById(`projector-${id}`)
  const screen = byId("screen")
  const action = byId("action")
  byId("title").textContent = names.projector
  return {
    update(watch) {
      let link
      if (watch?.url) {
        try {
          const url = new URL(watch.url)
          if (url.protocol === "http:" && url.hostname === "127.0.0.1" && url.pathname === "/watch_together") link = url.href
        } catch { /* An invalid watch has no resume link. */ }
      }
      byId("item").textContent = watch?.title || names.noWatch
      byId("progress").textContent = watch?.progress || ""
      action.hidden = !link
      if (link) {
        action.href = link
        action.replaceChildren(icon("ChevronRight"), watch.action)
      } else {
        action.removeAttribute("href")
        action.replaceChildren()
      }
    },
    position(width, height) {
      screen.style.width = `${width}px`
      screen.style.height = `${height}px`
    },
    show(amount, interactive) {
      screen.hidden = amount === 0
      screen.inert = !interactive
      screen.style.setProperty("--arrival", amount)
    },
  }
}
