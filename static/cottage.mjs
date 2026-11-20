import * as T from "./engine/three.module.min.js"
import { icon } from "./cottage-icons.mjs?v=0.9.22"
import { buildRoom } from "./cottage-scene.mjs?v=0.9.24"
import { backLabel, createRecordStation } from "./cottage-record.mjs?v=0.9.18"
import { createPicturePages } from "./cottage-picture.mjs?v=0.9.21"
import { createGiftShelf, createNotebook, createSeat, livingLabels, localPeriod } from "./cottage-living.mjs?v=0.9.22"
import { companyLabels, createCalendar, createCompany, createProjector } from "./cottage-company.mjs?v=0.9.22"

const LABELS = {
  "zh-CN": ["我们的小屋", "小屋控制", "台灯", "窗帘", "向左转", "重置视角", "向右转", "当前浏览器无法打开 3D 小屋。"],
  "zh-TW": ["我們的小屋", "小屋控制", "檯燈", "窗簾", "向左轉", "重設視角", "向右轉", "目前的瀏覽器無法開啟 3D 小屋。"],
  en: ["Our Cottage", "Room controls", "Table lamp", "Curtains", "Rotate left", "Reset view", "Rotate right", "The 3D room is unavailable in this browser."],
  es: ["Nuestra casita", "Controles de la sala", "Lámpara de mesa", "Cortinas", "Girar a la izquierda", "Restablecer vista", "Girar a la derecha", "La sala 3D no está disponible en este navegador."],
  ja: ["ふたりの小さな家", "部屋の操作", "テーブルランプ", "カーテン", "左に回す", "視点をリセット", "右に回す", "このブラウザーでは 3D の部屋を表示できません。"],
  ko: ["우리의 작은 집", "방 조작", "탁상 조명", "커튼", "왼쪽으로 돌리기", "시점 초기화", "오른쪽으로 돌리기", "이 브라우저에서는 3D 공간을 열 수 없습니다."],
  pt: ["Nossa casinha", "Controles da sala", "Luminária", "Cortinas", "Girar para a esquerda", "Redefinir vista", "Girar para a direita", "A sala 3D não está disponível neste navegador."],
  ru: ["Наш домик", "Управление комнатой", "Настольная лампа", "Шторы", "Повернуть влево", "Сбросить вид", "Повернуть вправо", "3D-комната недоступна в этом браузере."],
}
const STORAGE_KEY = "love_with_you:cottage:v1"
const START_ANGLE = .69
const START_HEIGHT = .52
const clamp = T.MathUtils.clamp
const buttons = [
  ["lamp", "Lamp"], ["curtains", "Blinds"], ["left", "ChevronLeft"], ["reset", "Scan"], ["right", "ChevronRight"],
]
const KEEPSAKE_LABELS = {
  "zh-CN": ["唱机", "相框"], "zh-TW": ["唱機", "相框"], en: ["Record player", "Picture frame"],
  es: ["Tocadiscos", "Marco"], ja: ["レコードプレーヤー", "フォトフレーム"], ko: ["턴테이블", "액자"],
  pt: ["Toca-discos", "Porta-retrato"], ru: ["Проигрыватель", "Фоторамка"],
}
const keepsakeButtons = [["record", "Disc3"], ["picture", "Image"], ["notebook", "BookOpen"], ["shelf", "Gift"],
  ["calendar", "CalendarDays"], ["projector", "Projector"]]
const periods = ["day", "dusk", "night"]
const daylight = [
  { sky: 1, key: 1, fill: 1, light: 0xffebc9, window: 1 },
  { sky: .81, key: .71, fill: .89, light: 0xffc0a3, window: .91 },
  { sky: .61, key: .36, fill: .95, light: 0xa3c2ff, window: .75 },
]

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    return { lamp: saved?.lamp === true, curtains: saved?.curtains !== false,
      period: periods.includes(saved?.period) ? saved.period : "auto" }
  } catch {
    return { lamp: false, curtains: true, period: "auto" }
  }
}

export function startCottage() {
  const query = new URLSearchParams(location.search)
  const requested = query.get("locale") || "zh-CN"
  const linked = window.parent !== window && query.get("linked") === "1"
  const locale = [requested, requested.split("-")[0], "en"].find(key => Object.hasOwn(LABELS, key))
  const [title, toolbarLabel, ...labels] = LABELS[locale]
  const stage = document.querySelector("#stage")
  const controls = document.querySelector("#controls")
  const fallback = document.querySelector("#fallback")
  document.documentElement.lang = locale
  document.title = document.querySelector("#title").textContent = title
  controls.setAttribute("aria-label", toolbarLabel)
  const names = livingLabels(locale)
  const companyNames = companyLabels(locale)
  const actions = [...buttons, ...keepsakeButtons, ["seat", "Armchair"]]
  const actionLabels = [...labels.slice(0, buttons.length), ...KEEPSAKE_LABELS[locale], names.notebook, names.shelf,
    companyNames.calendar, companyNames.projector, names.seat]
  const elements = Object.fromEntries(actions.map(([id, symbol], i) => {
    const button = document.getElementById(id)
    button.setAttribute("aria-label", actionLabels[i])
    button.title = actionLabels[i]
    button.append(icon(symbol))
    return [id, button]
  }))
  document.querySelector("#keepsakes").hidden = !linked
  const showFallback = () => {
    controls.hidden = true
    stage.hidden = true
    fallback.textContent = labels[5]
    fallback.hidden = false
  }

  let renderer
  try {
    // Keep the idle frame available when the parent panel repaints.
    renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power", preserveDrawingBuffer: true })
  } catch {
    showFallback()
    return
  }
  const canvas = renderer.domElement
  canvas.setAttribute("aria-hidden", "true")
  stage.append(canvas)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6))
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = T.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.04
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = T.PCFSoftShadowMap

  const scene = new T.Scene()
  const camera = new T.OrthographicCamera(-5, 5, 5, -5, .1, 40)
  const sky = new T.HemisphereLight(0xfff6df, 0x92999d, 1.62)
  scene.add(sky)
  const key = new T.DirectionalLight(0xffebc9, 2.65)
  key.position.set(.4, 7, 4)
  key.castShadow = true
  Object.assign(key.shadow.camera, { left: -5.1, right: 5.1, top: 5.4, bottom: -5.4, near: .5, far: 16 })
  key.shadow.mapSize.set(1536, 1536)
  key.shadow.normalBias = .025
  key.shadow.bias = -.00017
  scene.add(key)
  const fill = new T.DirectionalLight(0xaac9df, .69)
  fill.position.set(4, 2.7, -3)
  scene.add(fill)
  const room = buildRoom(scene)

  const preferences = loadPreferences()
  const reduced = matchMedia("(prefers-reduced-motion: reduce)")
  const center = new T.Vector3(0, 1.18, -.12)
  const corners = [
    ...[-3.35, 3.35].flatMap(x => [-2.73, 2.73].map(z => new T.Vector3(x, -.47, z))),
    ...[-3.35, 3.35].map(x => new T.Vector3(x, 3.53, -2.73)),
    new T.Vector3(-3.35, 3.53, 1.98),
  ]
  const raycaster = new T.Raycaster()
  const pointer = new T.Vector2()
  let azimuth = START_ANGLE
  let elevation = START_HEIGHT
  let targetAzimuth = azimuth
  let targetElevation = elevation
  let lamp = Number(preferences.lamp)
  let curtains = Number(preferences.curtains)
  const periodIndex = () => periods.indexOf(preferences.period === "auto" ? localPeriod() : preferences.period)
  let time = periodIndex()
  const lightColors = daylight.map(item => new T.Color(item.light))
  let viewportWidth = 0
  let viewportHeight = 0
  let frame = 0
  let lastFrame = 0
  let drag = null
  let lost = false
  let focus = 0
  let focusMotion = null
  let closeup = null
  let opening = false
  let selectedVinyl = null
  let afterReturn = null
  let returnToSeat = false
  let showOccasion = false
  let recentNote = null
  const roomView = document.querySelector("#room")
  const backButton = document.querySelector("#cottage-back")
  const recordCenter = room.record.body.localToWorld(new T.Vector3(0, .15, 0))
  const vinylSide = room.record.vinyl.localToWorld(new T.Vector3(.155, .178, -.103))
  const vinylFront = room.record.vinyl.localToWorld(new T.Vector3(.075, .178, .18))
  const recordSide = room.record.body.localToWorld(new T.Vector3(.44, .14, -.28))
  const recordBase = room.record.body.localToWorld(new T.Vector3(.44, 0, .28))
  const pictureCenter = room.picture.print.getWorldPosition(new T.Vector3())
  const bookCenter = room.notebook.body.localToWorld(new T.Vector3(-.175, .052, 0))
  const shelfCenter = room.shelf.display.localToWorld(new T.Vector3(0, .16, 0))
  const giftAnchors = room.shelf.slots.map(slot => slot.localToWorld(new T.Vector3(0, -.045, .145)))
  const seatPose = { point: new T.Vector3(.34, 1.49, -2.22), angle: -.43, pitch: .025, distance: 2.85 }
  const emptySeat = room.seat.localToWorld(new T.Vector3(.52, .75, .16))
  const cupCenter = room.notebook.company.localToWorld(new T.Vector3(0, .10, .025))
  const companyCenter = cupCenter.clone().add(new T.Vector3(-.23, 0, -.08))
  const calendarCenter = room.calendar.body.localToWorld(new T.Vector3(0, -.013, .070))
  const projectorCenter = room.projector.top.localToWorld(new T.Vector3(0, -room.projector.height / 2, .025))
  const { width: pictureWidth, height: pictureHeight } = room.picture.print.geometry.parameters
  const target = new T.Vector3()
  const projected = new T.Vector3()
  const station = createRecordStation({
    locale,
    selectVinyl(color) {
      selectedVinyl = color
      room.record.label.color.set(color || 0xca7969)
      invalidate()
    },
  })
  const pages = createPicturePages({
    locale,
    openOriginal(character, id) {
      window.parent.postMessage({ type: "love-with-you-cottage-open-memory", character, id }, location.origin)
    },
  })
  const send = (type, payload) => window.parent.postMessage({ type, ...payload }, location.origin)
  const notebook = createNotebook({ names, send, onKept(character, id) { recentNote = { character, id } } })
  const shelf = createGiftShelf({ names, locale, showGift(index, item) {
    room.shelf.showGift(index, item)
    invalidate()
  } })
  const seat = createSeat({
    names, labels, recordLabel: actionLabels[buttons.length], linked, toggle,
    choosePeriod(period) { preferences.period = period; savePreferences() },
    openRecord() { lookFromSeat("record") },
  })
  const company = createCompany({
    names: companyNames, send,
    openSeat() { lookFromSeat("company") },
    rest(value) { roomView.classList.toggle("quiet-company", value) },
  })
  const calendar = createCalendar({ names: companyNames, locale, write(character, title) {
    notebook.startFor(character, title)
    if (closeup === "calendar") {
      afterReturn = "notebook"
      closeKeepsake()
    } else openKeepsake("notebook")
  } })
  const projector = createProjector(companyNames)
  const closeups = { record: station, picture: pages, notebook, shelf, seat, calendar, projector, company }
  backButton.append(icon("ChevronLeft"))
  backButton.title = backLabel(locale)
  backButton.setAttribute("aria-label", backButton.title)
  backButton.onclick = closeKeepsake

  function aimCamera(point, angle, pitch, distance) {
    const horizontal = distance * Math.cos(pitch)
    camera.position.set(
      point.x + horizontal * Math.sin(angle),
      point.y + distance * Math.sin(pitch),
      point.z + horizontal * Math.cos(angle),
    )
    camera.lookAt(point)
    camera.updateMatrixWorld()
  }

  function fitCamera() {
    aimCamera(center, azimuth, elevation, 11)
    const xs = [], ys = []
    for (const corner of corners) {
      const point = corner.clone().applyMatrix4(camera.matrixWorldInverse)
      xs.push(point.x)
      ys.push(point.y)
    }
    const aspect = viewportWidth / viewportHeight
    const marginY = viewportHeight > 430 ? 144 : 110
    const usableY = Math.max(.40, 1 - marginY / viewportHeight)
    const usableX = viewportWidth > 650 ? .86 : .93
    let span = Math.max((Math.max(...ys) - Math.min(...ys)) / usableY,
      (Math.max(...xs) - Math.min(...xs)) / aspect / usableX)
    let midX = (Math.min(...xs) + Math.max(...xs)) / 2
    let midY = (Math.min(...ys) + Math.max(...ys)) / 2
    const compact = viewportWidth < 575
    const seatSpan = Math.max(2.65, 3.18 / aspect)
    const seatX = compact ? 0 : -.10
    // A closeup opened from the sofa uses its seated pose as the zero of the same timeline.
    const source = returnToSeat ? seatPose : { point: center, angle: azimuth, pitch: elevation, distance: 11 }
    if (returnToSeat) {
      span = seatSpan
      midX = seatX
      midY = 0
    }
    const aimCloseup = (point, angle, pitch, distance, amount) => {
      const mix = (from, to) => T.MathUtils.lerp(from, to, amount)
      aimCamera(target.lerpVectors(source.point, point, amount), mix(source.angle, angle),
        mix(source.pitch, pitch), mix(source.distance, distance))
    }
    if (focus > 0 && closeup === "record") {
      const closeScale = compact
        ? Math.min(viewportWidth * .84, viewportHeight * .54)
        : Math.min(viewportWidth * .42, viewportHeight * .68, 420)
      const closeSpan = viewportHeight / closeScale
      const mix = (from, to) => T.MathUtils.lerp(from, to, focus)
      span = mix(span, closeSpan)
      midX = mix(midX, compact ? 0 : closeSpan * aspect * .15)
      midY = mix(midY, closeSpan * (compact ? -.23 : 0))
      aimCloseup(recordCenter, .44, .82, 3.6, focus)
    }
    const pictureScale = Math.min((viewportWidth - 36) / 1.13, (viewportHeight - 124) / 1.35, 380)
    const projectorScale = Math.min((viewportWidth - 34) / 2.73, (viewportHeight - 108) / 1.53, 330)
    if (focus > 0 && closeup === "picture") {
      const cameraFocus = T.MathUtils.smoothstep(focus, 0, .73)
      const mix = (from, to) => T.MathUtils.lerp(from, to, cameraFocus)
      span = mix(span, viewportHeight / Math.max(1, pictureScale))
      midX = mix(midX, 0)
      midY = mix(midY, 0)
      aimCloseup(pictureCenter, 0, 0, 3.2, cameraFocus)
    }
    if (focus > 0 && ["notebook", "shelf", "seat"].includes(closeup)) {
      const mix = (from, to) => T.MathUtils.lerp(from, to, focus)
      if (closeup === "notebook") {
        const scale = Math.min(viewportWidth * 1.37, viewportHeight * .98, 750)
        const closeSpan = viewportHeight / scale
        span = mix(span, closeSpan)
        midX = mix(midX, 0)
        midY = mix(midY, 0)
        aimCloseup(bookCenter, -.4, Math.PI / 2 - .001, 3, focus)
      } else if (closeup === "shelf") {
        const scale = Math.min(viewportWidth * .86, viewportHeight * .80, 480)
        const closeSpan = viewportHeight / scale
        span = mix(span, closeSpan)
        midX = mix(midX, 0)
        midY = mix(midY, -closeSpan * .10)
        aimCloseup(shelfCenter, Math.PI / 2, .13, 3.1, focus)
      } else {
        span = mix(span, seatSpan)
        midX = mix(midX, seatX)
        midY = mix(midY, 0)
        aimCloseup(seatPose.point, seatPose.angle, seatPose.pitch, seatPose.distance, focus)
      }
    }
    if (focus > 0 && ["company", "calendar", "projector"].includes(closeup)) {
      const motion = returnToSeat ? focus : T.MathUtils.smoothstep(focus, 0, .76)
      const mix = (from, to) => T.MathUtils.lerp(from, to, motion)
      const scale = closeup === "calendar"
        ? Math.min((viewportWidth - 26) / .59, (viewportHeight - 100) / .74, 520)
        : closeup === "projector" ? projectorScale : Math.min(viewportWidth * .75, viewportHeight * .68, 445)
      span = mix(span, viewportHeight / scale)
      midX = mix(midX, 0)
      midY = mix(midY, closeup === "company" ? -.20 : 0)
      const point = closeup === "calendar" ? calendarCenter : closeup === "projector" ? projectorCenter : companyCenter
      const angle = closeup === "company" ? .34 : 0
      const pitch = closeup === "company" ? .65 : 0
      aimCloseup(point, angle, pitch, 3.2, motion)
    }
    if (returnToSeat && focus === 0) aimCamera(source.point, source.angle, source.pitch, source.distance)
    camera.left = midX - span * aspect / 2
    camera.right = midX + span * aspect / 2
    camera.top = midY + span / 2
    camera.bottom = midY - span / 2
    camera.updateProjectionMatrix()
    const maskRecord = compact && closeup === "record" && focus > .65
    stage.toggleAttribute("data-record-mask", maskRecord)
    if (closeup === "record" && (opening || maskRecord)) {
      projected.copy(compact ? vinylFront : vinylSide).project(camera)
      const x = (projected.x + 1) * viewportWidth / 2
      const y = (1 - projected.y) * viewportHeight / 2
      projected.copy(compact ? recordBase : recordSide).project(camera)
      const sceneEdge = compact ? (1 - projected.y) * viewportHeight / 2 : (1 + projected.x) * viewportWidth / 2
      if (opening) station.position(x, y, compact, viewportWidth, viewportHeight, sceneEdge)
      if (maskRecord) {
        const edge = T.MathUtils.lerp(viewportHeight, sceneEdge, T.MathUtils.smoothstep(focus, .65, 1))
        stage.style.setProperty("--record-scene-edge", `${edge}px`)
      }
    }
    if (closeup === "picture" && focus > .73) {
      pages.position(pictureWidth * Math.max(1, pictureScale), pictureHeight * Math.max(1, pictureScale))
    }
    if (focus > .63 && closeup === "notebook") {
      const point = toScreen(bookCenter)
      const scale = viewportHeight / span
      notebook.position(point.x, point.y, .65 * scale, .348 * scale)
    }
    if (focus > .68 && closeup === "shelf") {
      const points = giftAnchors.map(toScreen)
      shelf.position(points, clamp(Math.max(...points.map(point => point.y)) + 38, 90, Math.max(90, viewportHeight - 116)))
    }
    if (closeup === "seat" && opening && focus === 1) positionEmptySeat()
    if (closeup === "company" && focus > .65) {
      const point = toScreen(cupCenter)
      const section = document.querySelector("#company-cups")
      section.style.setProperty("--cup-x", `${point.x}px`)
      section.style.setProperty("--cup-y", `${point.y}px`)
    }
    if (closeup === "calendar" && focus > .76) {
      const scale = viewportHeight / span
      const section = document.querySelector("#calendar-sheet")
      section.style.width = `${.502 * scale}px`
      section.style.height = `${.638 * scale}px`
    }
    if (closeup === "projector" && focus > .76) {
      projector.position(room.projector.width * projectorScale, room.projector.height * projectorScale)
    }
  }

  function toScreen(point) {
    projected.copy(point).project(camera)
    return { x: (projected.x + 1) * viewportWidth / 2, y: (1 - projected.y) * viewportHeight / 2 }
  }

  function positionEmptySeat() {
    if (!linked) return
    const point = toScreen(emptySeat)
    company.emptyPosition(clamp(point.x, 28, viewportWidth - 28),
      clamp(point.y, 74, viewportHeight - 116), true)
  }

  function render(timestamp) {
    frame = 0
    if (lost || !viewportWidth || !viewportHeight) return
    const dt = lastFrame ? Math.min(.048, (timestamp - lastFrame) / 1000) : .016
    lastFrame = timestamp
    const ease = (value, target) => reduced.matches || Math.abs(target - value) < .002
      ? target : T.MathUtils.damp(value, target, 13, dt)
    azimuth = ease(azimuth, targetAzimuth)
    elevation = ease(elevation, targetElevation)
    lamp = ease(lamp, Number(preferences.lamp))
    curtains = ease(curtains, Number(preferences.curtains))
    const wantedTime = periodIndex()
    time = ease(time, wantedTime)
    let motionFinished = false
    if (focusMotion) {
      focusMotion.start ??= timestamp
      const picture = closeup === "picture"
      const targetFocus = Number(opening)
      let duration = opening ? 660 : 520
      if (picture) duration = (opening ? 1050 : 850) * Math.abs(targetFocus - focusMotion.from)
      if (returnToSeat && !opening) duration *= Math.sqrt(focusMotion.from)
      if (reduced.matches) duration = 0
      const progress = duration ? clamp((timestamp - focusMotion.start) / duration, 0, 1) : 1
      focus = T.MathUtils.lerp(focusMotion.from, targetFocus, picture ? progress : T.MathUtils.smoothstep(progress, 0, 1))
      motionFinished = progress === 1
      if (motionFinished) focusMotion = null
    }
    fitCamera()
    if (closeup === "picture") {
      // Read the same timeline backward so a mid-flight exit does not jump.
      const phase = (start, end) => T.MathUtils.smoothstep(focus, start, end)
      room.picture.reveal(phase(.32, .86))
      pages.reveal(phase(.75, .96), phase(.84, 1), opening && focus === 1)
    }
    if (closeup === "notebook") {
      room.notebook.spine.rotation.z = Math.PI * T.MathUtils.smoothstep(focus, .21, .90)
      notebook.reveal(T.MathUtils.smoothstep(focus, .67, 1), opening && focus === 1)
    }
    if (closeup === "shelf") shelf.reveal(T.MathUtils.smoothstep(focus, .70, 1), opening && focus === 1)
    if (closeup === "company") {
      const cup = T.MathUtils.smoothstep(focus, .47, .84)
      room.notebook.secondCup.visible = cup > 0
      room.notebook.secondCup.position.y = .01 + .31 * (1 - cup)
      room.notebook.secondCup.scale.setScalar(.88 + .12 * cup)
      company.show(T.MathUtils.smoothstep(focus, .80, 1), opening && focus === 1)
    }
    if (closeup === "calendar") {
      const flip = T.MathUtils.smoothstep(focus, .56, .86)
      room.calendar.front.rotation.x = -Math.PI / 2 * flip
      room.calendar.front.visible = flip < 1
      calendar.show(T.MathUtils.smoothstep(focus, .83, 1), opening && focus === 1)
    }
    if (closeup === "projector") {
      room.projector.reveal(T.MathUtils.smoothstep(focus, .36, .92))
      projector.show(T.MathUtils.smoothstep(focus, .87, 1), opening && focus === 1)
    }
    room.lampLight.intensity = lamp * 12
    room.shade.emissiveIntensity = lamp * .77
    room.bulb.color.setHex(preferences.lamp ? 0xffdbab : 0xbb9572)
    for (const curtain of room.curtains) curtain.scale.x = T.MathUtils.lerp(1.62, .37, curtains)
    const from = Math.min(Math.floor(time), 1)
    const blend = time - from
    const light = key => T.MathUtils.lerp(daylight[from][key], daylight[from + 1][key], blend)
    for (const [index, view] of room.views.entries()) {
      view.material.color.setScalar((.64 + curtains * .36) * light("window"))
      if (index) view.material.opacity = clamp(time - index + 1, 0, 1)
    }
    const projectionShade = closeup === "projector" ? 1 - focus * .25 : 1
    sky.intensity = (1.11 + .51 * curtains) * light("sky") * projectionShade
    key.intensity = (.61 + 1.59 * curtains) * light("key") * projectionShade
    fill.intensity = (.55 + .41 * curtains) * light("fill")
    key.color.copy(lightColors[from]).lerp(lightColors[from + 1], blend)
    const spinning = opening && (closeup === "record" || closeup === "seat") && selectedVinyl && !reduced.matches && !document.hidden
    if (spinning) room.record.vinyl.rotation.y += dt * 3.4
    if (motionFinished) {
      if (!opening && returnToSeat) {
        const trigger = document.getElementById(closeup === "record" ? "seat-record" : "seat-empty")
        returnToSeat = false
        closeup = "seat"
        opening = true
        focus = 1
        roomView.dataset.view = "seat"
        seat.show()
        positionEmptySeat()
        backButton.hidden = false
        trigger.focus({ preventScroll: true })
      } else if (opening) {
        roomView.dataset.view = closeup
        if (closeup === "record") station.show()
        if (closeup === "seat") seat.show()
      } else {
        roomView.dataset.view = "room"
        const previous = closeup
        closeup = null
        const next = afterReturn
        afterReturn = null
        if (next) openKeepsake(next)
        else {
          controls.hidden = false
          elements[previous].focus({ preventScroll: true })
        }
      }
    }
    renderer.render(scene, camera)
    if (azimuth !== targetAzimuth || elevation !== targetElevation ||
      lamp !== Number(preferences.lamp) || curtains !== Number(preferences.curtains) || time !== wantedTime || focusMotion || spinning) {
      invalidate()
    } else {
      lastFrame = 0
    }
  }

  function invalidate() {
    if (!frame && !lost) frame = requestAnimationFrame(render)
  }

  function changeView(angle, height) {
    targetAzimuth = clamp(angle, .13, 1.24)
    targetElevation = clamp(height, .33, .81)
    invalidate()
  }

  function syncControls() {
    elements.lamp.setAttribute("aria-pressed", String(preferences.lamp))
    elements.curtains.setAttribute("aria-pressed", String(preferences.curtains))
    seat.sync(preferences)
  }

  function toggle(id) {
    preferences[id] = !preferences[id]
    savePreferences()
  }

  function savePreferences() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)) } catch { /* transient preference only */ }
    syncControls()
    invalidate()
  }

  function openKeepsake(id) {
    if (closeup) return
    approach(id)
  }

  function lookFromSeat(id) {
    if (closeup !== "seat" || !opening || focus !== 1) return
    seat.hide()
    company.emptyPosition(0, 0, false)
    returnToSeat = true
    focus = 0
    approach(id)
  }

  function approach(id) {
    closeup = id
    if (id === "picture" && recentNote && pages.select(recentNote.character, recentNote.id)) recentNote = null
    opening = true
    controls.hidden = true
    delete canvas.dataset.target
    roomView.dataset.view = "approaching"
    backButton.hidden = false
    backButton.focus({ preventScroll: true })
    focusMotion = { from: focus, start: returnToSeat ? null : performance.now() }
    invalidate()
  }

  function closeKeepsake() {
    if (!opening) return
    opening = false
    if (closeup === "record") station.hide()
    if (closeup === "seat") {
      seat.hide()
      company.emptyPosition(0, 0, false)
    }
    backButton.hidden = true
    roomView.dataset.view = "returning"
    focusMotion = { from: focus, start: returnToSeat || closeup === "picture" ? null : performance.now() }
    invalidate()
  }

  if (linked) {
    window.addEventListener("message", event => {
      if (event.origin !== location.origin || event.source !== window.parent || typeof event.data?.payload !== "string") return
      let payload
      try { payload = JSON.parse(event.data.payload) } catch { return }
      if (event.data.type === "love-with-you-cottage-record-data") station.update(payload)
      if (event.data.type === "love-with-you-cottage-picture-data") pages.update(payload)
      if (event.data.type === "love-with-you-cottage-room-data") {
        notebook.update(payload)
        shelf.update(payload.gifts)
      }
      if (event.data.type === "love-with-you-cottage-note-result") notebook.result(payload)
      if (event.data.type === "love-with-you-cottage-company-data") {
        company.update(payload.company)
        calendar.update(payload)
        projector.update(payload.watch)
        room.notebook.card.visible = payload.calendar.some(item => item.today)
        showOccasion = room.notebook.card.visible && payload.canWrite
        invalidate()
      }
      if (event.data.type === "love-with-you-cottage-invite-result") company.result(payload)
    })
    window.parent.postMessage({ type: "love-with-you-cottage-ready" }, location.origin)
  }
  document.addEventListener("keydown", event => {
    if (opening && event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault()
      closeKeepsake()
    }
  })
  document.addEventListener("visibilitychange", invalidate)
  reduced.addEventListener("change", invalidate)
  setInterval(() => { if (!document.hidden && time !== periodIndex()) invalidate() }, 30_000)

  function activate(id) {
    if (id === "lamp" || id === "curtains") toggle(id)
    else if (id === "occasion") calendar.writeToday()
    else if ((linked || id === "seat") && Object.hasOwn(closeups, id)) openKeepsake(id)
  }

  const hitLookup = new Map(room.hits
    .filter(({ id }) => linked || ["lamp", "curtains", "seat"].includes(id))
    .map(({ id, object }) => [object, id]))
  const hitObjects = [...hitLookup.keys()]
  function hitAt(event) {
    const bounds = canvas.getBoundingClientRect()
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1,
      1 - (event.clientY - bounds.top) / bounds.height * 2)
    raycaster.setFromCamera(pointer, camera)
    const intersection = raycaster.intersectObjects(hitObjects, false)
      .find(hit => showOccasion || hitLookup.get(hit.object) !== "occasion")
    return intersection ? hitLookup.get(intersection.object) : undefined
  }

  function clearDrag() {
    drag = null
    delete canvas.dataset.dragging
  }

  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0 || drag || closeup) return
    drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY,
      azimuth: targetAzimuth, elevation: targetElevation, moved: false }
    canvas.setPointerCapture(event.pointerId)
  })
  canvas.addEventListener("pointermove", event => {
    if (closeup) return
    if (!drag) {
      const id = hitAt(event)
      if (id) canvas.dataset.target = id
      else delete canvas.dataset.target
      return
    }
    if (event.pointerId !== drag.id) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (drag.moved || Math.hypot(dx, dy) > 5) {
      drag.moved = true
      canvas.dataset.dragging = ""
      changeView(drag.azimuth - dx * .006, drag.elevation + dy * .004)
    }
  })
  canvas.addEventListener("pointerup", event => {
    if (event.pointerId !== drag?.id) return
    const id = !drag.moved && hitAt(event)
    clearDrag()
    if (id) activate(id)
  })
  canvas.addEventListener("lostpointercapture", clearDrag)
  canvas.addEventListener("pointerleave", () => { delete canvas.dataset.target })
  elements.lamp.onclick = () => toggle("lamp")
  elements.curtains.onclick = () => toggle("curtains")
  for (const [id] of keepsakeButtons) elements[id].onclick = () => activate(id)
  elements.seat.onclick = () => activate("seat")
  elements.left.onclick = () => changeView(targetAzimuth - .24, targetElevation)
  elements.right.onclick = () => changeView(targetAzimuth + .24, targetElevation)
  elements.reset.onclick = () => changeView(START_ANGLE, START_HEIGHT)
  const observer = new ResizeObserver(([entry]) => {
    viewportWidth = entry.contentRect.width
    viewportHeight = entry.contentRect.height
    if (!viewportWidth || !viewportHeight) return
    renderer.setSize(viewportWidth, viewportHeight, false)
    invalidate()
  })
  observer.observe(stage)
  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault()
    closeKeepsake()
    room.picture.reveal(0)
    pages.reveal(0, 0, false)
    room.notebook.spine.rotation.z = 0
    notebook.reveal(0, false)
    shelf.reveal(0, false)
    company.show(0, false)
    company.emptyPosition(0, 0, false)
    room.notebook.secondCup.visible = false
    calendar.show(0, false)
    room.calendar.front.rotation.x = 0
    room.calendar.front.visible = true
    projector.show(0, false)
    room.projector.reveal(0)
    seat.hide()
    afterReturn = null
    returnToSeat = false
    closeup = null
    focus = 0
    focusMotion = null
    roomView.dataset.view = "room"
    lost = true
    showFallback()
  })
  canvas.addEventListener("webglcontextrestored", () => {
    lost = false
    stage.hidden = controls.hidden = false
    fallback.hidden = true
    invalidate()
  })
  syncControls()
  controls.hidden = false
}
