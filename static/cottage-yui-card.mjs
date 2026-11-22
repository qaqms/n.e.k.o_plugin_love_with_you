// The card beside Yui in her closeup: touch her, give a gift from the bag, or ask her to talk.
// Touch mode lets the visitor press a part of her in the scene (or use the buttons) and reports each touch.
import { icon } from "./cottage-icons.mjs?v=0.9.36"

const COPY = {
  "zh-CN": ["摸摸她", "送礼物", "说说话", "好了", "按住她的头、脸、下巴、手、耳朵或尾巴；按住拖动可以来回摸头、捏脸、揉耳朵。也可以用下面的按钮。",
    ["摸摸头", "戳戳脸", "挠下巴", "牵手", "猫耳朵", "尾巴"], "桌宠不在线，这次只有小屋里的她知道。", "已告诉桌宠。", "消息状态未确认。",
    "请稍等几秒再邀请。", "已发出邀请，请在宿主聊天查看回应。", "背包已在小屋下方打开。"],
  "zh-TW": ["摸摸她", "送禮物", "說說話", "好了", "按住她的頭、臉、下巴、手、耳朵或尾巴；按住拖動可以來回摸頭、捏臉、揉耳朵。也可以用下面的按鈕。",
    ["摸摸頭", "戳戳臉", "撓下巴", "牽手", "貓耳朵", "尾巴"], "桌寵不在線，這次只有小屋裡的她知道。", "已告訴桌寵。", "訊息狀態未確認。",
    "請稍等幾秒再邀請。", "已發出邀請，請在宿主聊天查看回應。", "背包已在小屋下方打開。"],
  en: ["Touch", "Give a gift", "Talk", "Done", "Press and hold her head, cheek, chin, hand, ears or tail; drag while holding to stroke her head, pinch her cheek or rub an ear. Or use the buttons below.",
    ["Pat head", "Poke cheek", "Scratch chin", "Hold hand", "Cat ears", "Tail"], "The desktop companion is offline; only she knows this time.",
    "Your companion noticed.", "Message status unknown.", "Wait a few seconds before inviting again.",
    "Invitation sent. Check the host chat for a reply.", "The bag is open below the cottage."],
  es: ["Acariciar", "Dar un regalo", "Hablar", "Listo", "Mantén pulsada su cabeza, mejilla, barbilla, mano, orejas o cola; arrastra para acariciar, pellizcar la mejilla o frotar una oreja. O usa los botones.",
    ["Cabeza", "Mejilla", "Barbilla", "Mano", "Orejas", "Cola"], "El acompañante no está conectado; esta vez solo ella lo sabe.",
    "Tu acompañante lo notó.", "Estado del mensaje desconocido.", "Espera unos segundos antes de volver a invitar.",
    "Invitación enviada. Mira el chat del anfitrión.", "La mochila está abierta debajo de la casita."],
  ja: ["なでる", "プレゼント", "話す", "完了", "頭・ほっぺ・あご・手・耳・しっぽを長押ししてください。押したままドラッグすると、頭をなでたり、ほっぺをつまんだり、耳をもんだりできます。下のボタンも使えます。",
    ["頭をなでる", "ほっぺをつつく", "あごをかく", "手をつなぐ", "猫耳", "しっぽ"], "相棒はオフラインです。今回は家の中の彼女だけが知っています。",
    "相棒に伝わりました。", "メッセージの状態を確認できません。", "数秒待ってから招待してください。",
    "招待を送信しました。返事はホストのチャットで確認してください。", "バッグは小さな家の下に開いています。"],
  ko: ["쓰다듬기", "선물하기", "이야기하기", "완료", "머리, 볼, 턱, 손, 귀, 꼬리를 길게 누르세요. 누른 채 끌면 머리를 쓰다듬거나 볼을 꼬집거나 귀를 문질러요. 아래 버튼도 쓸 수 있어요.",
    ["머리 쓰다듬기", "볼 콕", "턱 긁기", "손 잡기", "고양이 귀", "꼬리"], "데스크톱 친구가 오프라인이라 이번엔 집 안의 그녀만 알아요.",
    "친구에게 전해졌어요.", "메시지 상태를 확인할 수 없어요.", "몇 초 뒤 다시 초대하세요.",
    "초대를 보냈어요. 호스트 채팅에서 답을 확인하세요.", "가방이 집 아래에 열렸어요."],
  pt: ["Fazer carinho", "Dar um presente", "Conversar", "Pronto", "Segure a cabeça, bochecha, queixo, mão, orelhas ou cauda dela; arraste segurando para acariciar, apertar a bochecha ou esfregar uma orelha. Ou use os botões.",
    ["Cabeça", "Bochecha", "Queixo", "Mão", "Orelhas", "Cauda"], "O companheiro está offline; desta vez só ela sabe.",
    "Seu companheiro percebeu.", "Status da mensagem desconhecido.", "Aguarde alguns segundos antes de convidar novamente.",
    "Convite enviado. Veja a resposta no chat do anfitrião.", "A mochila está aberta abaixo da casinha."],
  ru: ["Погладить", "Подарить", "Поговорить", "Готово", "Зажмите голову, щёку, подбородок, руку, ушки или хвост; ведите, не отпуская, чтобы погладить, ущипнуть щёчку или потереть ушко. Или нажмите кнопку ниже.",
    ["Голова", "Щёчка", "Подбородок", "Рука", "Ушки", "Хвост"], "Персонаж не в сети: в этот раз знает только она.",
    "Персонаж заметил.", "Статус сообщения неизвестен.", "Подождите несколько секунд перед новым приглашением.",
    "Приглашение отправлено. Ответ появится в чате.", "Сумка открыта под домиком."],
}
const ZONES = ["head", "cheek", "chin", "hand", "ears", "tail"]

export function createYuiCard({ locale, linked, send, press, release, changed = () => {} }) {
  const [touchLabel, giftLabel, talkLabel, doneLabel, hint, zoneLabels, offline, noticed, unknown, cooldown, invited, bagOpen]
    = COPY[locale] || COPY.en
  const byId = id => document.getElementById(`yui-${id}`)
  const card = byId("card")
  const options = byId("options")
  const zones = byId("zones")
  const status = byId("status")
  const labeled = (button, label, symbol) => button.replaceChildren(icon(symbol), label)
  labeled(byId("touch"), touchLabel, "Hand")
  labeled(byId("gift"), giftLabel, "Gift")
  labeled(byId("talk"), talkLabel, "MessageCircle")
  labeled(byId("done"), doneLabel, "Check")
  byId("hint").textContent = hint
  byId("card-title").textContent = "Yui"
  byId("gift").hidden = byId("talk").hidden = !linked
  const zoneButtons = ZONES.map((zone, index) => {
    const button = document.createElement("button")
    button.type = "button"
    button.dataset.zone = zone
    button.textContent = zoneLabels[index]
    // A button touch lasts as long as it is held, like a touch in the scene; keys give a short one.
    button.addEventListener("pointerdown", event => {
      if (event.button !== 0 || button.disabled) return
      button.setPointerCapture(event.pointerId)
      press(zone, event.timeStamp)
    })
    const end = event => release(event.timeStamp)
    button.addEventListener("pointerup", end)
    button.addEventListener("pointercancel", end)
    button.addEventListener("lostpointercapture", end)
    button.addEventListener("keydown", event => {
      if ((event.key === "Enter" || event.key === " ") && !event.repeat && !button.disabled) {
        event.preventDefault()
        // A key gives a touch of a set length, whatever the frame rate.
        const length = zone === "head" || zone === "chin" ? 1400 : 450
        if (press(zone, event.timeStamp)) setTimeout(() => release(event.timeStamp + length), length)
      }
    })
    byId("done").before(button)
    return button
  })
  let character = ""
  let mode = "options"
  let pending = null
  let message = ""
  let busy = false

  byId("touch").onclick = () => setMode("touch")
  byId("done").onclick = () => setMode("options")
  byId("gift").onclick = () => {
    send("love-with-you-cottage-gift", {})
    message = bagOpen
    render()
  }
  byId("talk").onclick = () => {
    if (!character || pending) return
    pending = crypto.randomUUID()
    message = ""
    render()
    send("love-with-you-cottage-invite", { token: pending, character })
  }

  function setMode(next) {
    mode = next
    message = ""
    card.dataset.mode = mode
    render()
    // The scene shows the hand only in touch mode, so it redraws when the mode changes.
    changed(mode)
    ;(mode === "touch" ? zoneButtons[0] : byId("touch")).focus({ preventScroll: true })
  }
  function render() {
    options.hidden = mode !== "options"
    zones.hidden = mode !== "touch"
    for (const button of zoneButtons) button.disabled = busy
    byId("talk").disabled = Boolean(pending || !character)
    byId("talk").setAttribute("aria-busy", String(Boolean(pending)))
    status.textContent = message
    status.hidden = !message
  }
  render()
  return {
    get mode() { return mode },
    update(company) {
      if (character !== company) message = ""
      character = company
      render()
    },
    character: () => character,
    // While her reaction plays, the zone buttons wait.
    busy(value) {
      if (busy === value) return
      busy = value
      render()
    },
    touched(result) {
      message = result === "submitted" ? noticed : result === "offline" || result === "unavailable" ? offline : unknown
      render()
    },
    invited({ token, status: result }) {
      if (token !== pending) return false
      pending = null
      message = result === "submitted" ? invited : result === "cooldown" ? cooldown : result === "unavailable" ? offline : unknown
      render()
      return true
    },
    show(amount, interactive) {
      card.hidden = amount === 0
      card.inert = !interactive
      card.style.setProperty("--arrival", amount)
      if (!amount && mode !== "options") {
        mode = "options"
        card.dataset.mode = mode
        message = ""
        render()
      }
    },
  }
}
