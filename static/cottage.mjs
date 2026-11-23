import * as T from "./engine/three.module.min.js"
import { CopyShader, EffectComposer, FullScreenQuad, GTAOPass, OutputPass, RenderPass, RoomEnvironment, ShaderPass,
  UnrealBloomPass }
  from "./engine/three-post.mjs?v=0.9.25"
import { icon } from "./cottage-icons.mjs?v=0.9.48.1"
import { cardFraming, cardScale, placeCard } from "./cottage-card.mjs?v=0.9.27"
import { buildRoom } from "./cottage-scene.mjs?v=0.9.41"
import { UPPER_LIFT } from "./cottage-house.mjs?v=0.9.41"
import { createAmbient } from "./cottage-ambient.mjs?v=0.9.28"
import { buildGrounds } from "./cottage-grounds.mjs?v=0.9.47"
import { PROBE_FRAMES, adapterKind, probeCost, savedQuality, settle, startingQuality } from "./cottage-quality.mjs?v=0.9.46"
import { InkShader, STYLES, setCharacterLight, setPixelRatio as styleRatio, stylize } from "./cottage-style.mjs?v=0.9.48.3"
import { loadYui, touchTier } from "./cottage-yui.mjs?v=0.9.48.3"
import { createLife } from "./cottage-yui-life.mjs?v=0.9.48.1"
import { activityAt, cottageMinutes } from "./cottage-routine.mjs?v=0.9.41"
import { createYuiCard } from "./cottage-yui-card.mjs?v=0.9.40"
import { HAND_POSE, createHand } from "./cottage-hand.mjs?v=0.9.38"
import { ROOMS, SLOTS, STOREYS } from "./cottage-layout.mjs?v=0.9.26"
import { backLabel, createRecordStation } from "./cottage-record.mjs?v=0.9.27"
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
// Rooms, the view menu, light and quality settings, and the item list.
const HOUSE_LABELS = {
  "zh-CN": ["房间", "总览", "客厅", "厨房", "门廊小院", "卧室", "阁楼书房", "光线与时段", "画质", "自动", "低", "中", "高", "物品", "时段"],
  "zh-TW": ["房間", "總覽", "客廳", "廚房", "門廊小院", "臥室", "閣樓書房", "光線與時段", "畫質", "自動", "低", "中", "高", "物品", "時段"],
  en: ["Rooms", "Whole house", "Living room", "Kitchen", "Porch & yard", "Bedroom", "Attic study", "Light & time", "Quality", "Auto", "Low", "Medium", "High", "Items", "Time of day"],
  es: ["Habitaciones", "Toda la casa", "Sala", "Cocina", "Porche y patio", "Dormitorio", "Estudio del ático", "Luz y hora", "Calidad", "Auto", "Baja", "Media", "Alta", "Objetos", "Momento del día"],
  ja: ["部屋", "家全体", "リビング", "キッチン", "ポーチと庭", "寝室", "屋根裏の書斎", "明かりと時間", "画質", "自動", "低", "中", "高", "アイテム", "時間帯"],
  ko: ["방", "집 전체", "거실", "주방", "현관과 마당", "침실", "다락 서재", "조명과 시간", "화질", "자동", "낮음", "보통", "높음", "물건", "시간대"],
  pt: ["Cômodos", "Casa inteira", "Sala", "Cozinha", "Varanda e quintal", "Quarto", "Estúdio no sótão", "Luz e horário", "Qualidade", "Auto", "Baixa", "Média", "Alta", "Itens", "Hora do dia"],
  ru: ["Комнаты", "Весь дом", "Гостиная", "Кухня", "Крыльцо и двор", "Спальня", "Кабинет на чердаке", "Свет и время", "Качество", "Авто", "Низкое", "Среднее", "Высокое", "Предметы", "Время суток"],
}
const VIEW_IDS = ["overview", ...ROOMS.map(room => room.id)]
// The line of the vendored GTAO denoise shader that turns its samples per pixel (see applyQuality); a test checks
// that static/engine/three-post.mjs still contains it.
const PD_ROTATION = "mat2 rotationMatrix = mat2(noiseVec.x, -noiseVec.y, noiseVec.x, noiseVec.y);"
const VIEW_SECONDS = .95
// Each view frames a box: the living room keeps its 0.9.25 framing, the others follow the layout.
function viewFrame(id) {
  if (id === "living") {
    return { center: new T.Vector3(0, 1.18, -.12), upper: false, corners: [
      ...[-3.35, 3.35].flatMap(x => [-2.73, 2.73].map(z => new T.Vector3(x, -.47, z))),
      ...[-3.35, 3.35].map(x => new T.Vector3(x, 3.53, -2.73)),
      new T.Vector3(-3.35, 3.53, 1.98),
    ] }
  }
  if (id === "overview") {
    const top = STOREYS[1].y + STOREYS[1].height + UPPER_LIFT
    return { center: new T.Vector3(3.3, 2.9, -.12), upper: true, corners: [
      ...[-3.35, 10.12].flatMap(x => [-2.73, 2.73].map(z => new T.Vector3(x, -.47, z))),
      ...[-3.35, 7.1].map(x => new T.Vector3(x, top + .1, -2.73)),
      ...[-3.35, 7.1].map(x => new T.Vector3(x, top + 2.1, -.35)),
      new T.Vector3(-3.35, top + .1, 2.7),
    ] }
  }
  const room = ROOMS.find(item => item.id === id)
  const storey = STOREYS[room.storey]
  const base = room.storey ? storey.y + UPPER_LIFT - .16 : -.47
  const top = room.outdoor ? 2.95 : storey.y + storey.height + (room.storey ? UPPER_LIFT : 0) + .13
  const [x0, x1] = [room.x[0] - .1, room.x[1] + .1]
  return { center: new T.Vector3((x0 + x1) / 2, base + 1.65, -.12), upper: room.storey === 1, corners: [
    ...[x0, x1].flatMap(x => [-2.73, 2.73].map(z => new T.Vector3(x, base, z))),
    ...[x0, x1].map(x => new T.Vector3(x, top, -2.73)),
    new T.Vector3(x0, top, 2.7),
  ] }
}
const STORAGE_KEY = "love_with_you:cottage:v1"
// The view and camera angle on leaving, kept for this run of the app only (session storage): coming back to the
// cottage shows it as it was left, and after a restart it opens on the whole house.
const CAMERA_KEY = "love_with_you:cottage:camera"
const GROUNDS_KEY = "love_with_you:cottage:grounds"
function sessionValue(key) {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}
function loadCamera() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(CAMERA_KEY))
    return VIEW_IDS.includes(saved?.view) && Number.isFinite(saved.azimuth) && Number.isFinite(saved.elevation) ? saved : null
  } catch {
    return null
  }
}
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
// Each period sets the room's mood: ambient levels, the sun through the window, the backdrop and a colour grade.
const daylight = [
  { sky: 1, key: 1, fill: 1, env: 1, sun: 1, glow: 0, light: 0xffebc9, window: 1,
    backdrop: 0xe1ebe3, sunColor: 0xfff0d2, sunFrom: [-2.3, 5.6, -7.2], sunTo: [-.1, 0, .4], tint: [1, 1, 1] },
  { sky: .68, key: .52, fill: .8, env: .6, sun: 1.2, glow: .4, light: 0xffc0a3, window: .91,
    backdrop: 0xecd6c6, sunColor: 0xff9a58, sunFrom: [-3.6, 3.3, -7], sunTo: [.8, .2, .2], tint: [1.04, .98, .93] },
  { sky: .24, key: .1, fill: .5, env: .17, sun: .42, glow: 1, light: 0xa3c2ff, window: .75,
    backdrop: 0x1d2833, sunColor: 0x9fb9ff, sunFrom: [-1.8, 6, -7.4], sunTo: [.1, 0, .9], tint: [.93, .97, 1.05] },
]
const qualities = ["auto", "low", "medium", "high"]
const FOV = { room: 24, closeup: 38, seat: 32, watch: 30 }
// Lofi sample, third round: "watch her", a medium shot from the side and front while she gets on with her day (the
// reference game frames its girl like this at her desk). Unlike clicking her, she is not interrupted. Per spot:
// the world angle the camera looks from (her front is her own turn; spots facing a wall are seen from the open
// side), pitch, the height of the frame (span, metres at her), how far below her chest the frame centre sits, and
// which side of the frame she stands in (-1 left third, 1 right third).
const WATCH = { label: { "zh-CN": "看看她", "zh-TW": "看看她", en: "Watch her", es: "Mirarla", ja: "彼女を眺める", ko: "그녀 바라보기" } }
const SHOTS = {
  sofa: { angle: .62, pitch: .2, span: 1.6, drop: .26, side: -1 },
  // Desk and counter face the back wall (bookshelf to the right of the desk, stairs right of the counter): the desk
  // is seen from her right side, the tablet over her right shoulder.
  desk: { angle: 1.75, pitch: .16, span: 1.3, drop: .3, side: -1 },
  counter: { angle: 1.1, pitch: .4, span: .95, drop: .04, side: 1 },
  table: { angle: 1.05, pitch: .16, span: 1.3, drop: .16, side: -1 },
  bench: { angle: .6, pitch: .12, span: 1.35, drop: .16, side: -1 },
  rug: { angle: 1.05, pitch: .1, span: 1.45, drop: .2, side: -1 },
  bedside: { angle: .9, pitch: .1, span: 1.45, drop: .2, side: -1 },
  bed: { angle: .75, pitch: .62, span: 1.2, drop: .1, side: 0 },
}
// Warm vignette and per-period tint, applied after tone mapping.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: .2 }, tint: { value: new T.Color(1, 1, 1) } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float vignette; uniform vec3 tint; varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 offset = vUv - .5;
      color.rgb *= tint * (1. - vignette * smoothstep(.2, .9, dot(offset, offset) * 2.));
      gl_FragColor = color;
    }`,
}

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    return { lamp: saved?.lamp === true, curtains: saved?.curtains !== false,
      period: periods.includes(saved?.period) ? saved.period : "auto",
      quality: qualities.includes(saved?.quality) ? saved.quality : "auto" }
  } catch {
    return { lamp: false, curtains: true, period: "auto", quality: "auto" }
  }
}

// The graphics adapter's name, as the browser reports it ("" when it keeps it to itself).
function adapterName(renderer) {
  try {
    const gl = renderer.getContext()
    const info = gl.getExtension("WEBGL_debug_renderer_info")
    return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ""
  } catch { return "" }
}

// What "auto" settled on for this adapter last time (see cottage-quality.mjs).
const AUTO_KEY = "love_with_you:cottage:quality-auto"
function readAuto() {
  try { return JSON.parse(localStorage.getItem(AUTO_KEY)) } catch { return null }
}
function keepAuto(adapter, quality) {
  try { localStorage.setItem(AUTO_KEY, JSON.stringify({ adapter, quality, at: Date.now() })) } catch { /* measured again next time */ }
}

export function startCottage() {
  const query = new URLSearchParams(location.search)
  const requested = query.get("locale") || "zh-CN"
  const linked = window.parent !== window && query.get("linked") === "1"
  // The lofi look is a sample for now (0.9.48): only with ?style=lofi. See cottage-style.mjs.
  const style = STYLES.includes(query.get("style")) ? query.get("style") : "classic"
  const locale = [requested, requested.split("-")[0], "en"].find(key => Object.hasOwn(LABELS, key))
  const [title, toolbarLabel, ...labels] = LABELS[locale]
  const stage = document.querySelector("#stage")
  const controls = document.querySelector("#controls")
  const fallback = document.querySelector("#fallback")
  document.documentElement.lang = locale
  document.title = document.querySelector("#title").textContent = title
  controls.setAttribute("aria-label", toolbarLabel)
  const [roomsLabel, ...houseLabels] = HOUSE_LABELS[locale]
  const viewNames = Object.fromEntries(VIEW_IDS.map((id, index) => [id, houseLabels[index]]))
  const [moodLabel, qualityLabel, ...qualityNames] = houseLabels.slice(VIEW_IDS.length, VIEW_IDS.length + 6)
  const [itemsLabel, periodLabel] = houseLabels.slice(VIEW_IDS.length + 6)
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
  if (style === "lofi") {
    const button = document.createElement("button")
    button.type = "button"
    button.id = "watch"
    const label = WATCH.label[locale] || WATCH.label.en
    button.setAttribute("aria-label", label)
    button.title = label
    button.append(icon("Video"))
    elements.seat.before(button)
    button.onclick = () => activate("watch")
  }
  for (const [id, label, symbol] of [["rooms", roomsLabel, "House"], ["mood", moodLabel, "SunMoon"], ["items", itemsLabel, "Package"]]) {
    const button = document.getElementById(id)
    button.setAttribute("aria-label", label)
    button.title = label
    button.append(icon(symbol))
    elements[id] = button
  }
  // Items in the list also show their names, since the list is how keyboard and screen reader users reach them.
  for (const [id] of keepsakeButtons) {
    const text = document.createElement("span")
    text.textContent = elements[id].title
    elements[id].append(text)
  }
  elements.items.hidden = !linked
  const roomName = document.querySelector("#room-name")
  const hoverLabel = document.querySelector("#hover-label")
  const roomMenu = document.querySelector("#room-menu")
  const moodMenu = document.querySelector("#mood-menu")
  const itemMenu = document.querySelector("#item-menu")
  const menus = [[roomMenu, elements.rooms], [moodMenu, elements.mood], [itemMenu, elements.items]]
  const textButton = (parent, label, id) => {
    const button = document.createElement("button")
    button.type = "button"
    if (id) button.id = id
    button.textContent = label
    button.setAttribute("aria-pressed", "false")
    parent.append(button)
    return button
  }
  roomMenu.setAttribute("aria-label", roomsLabel)
  for (const id of VIEW_IDS) {
    const button = textButton(roomMenu, viewNames[id])
    button.dataset.view = id
    // Which room she is in (the badge is not part of the button's name).
    if (id !== "overview") {
      const badge = document.createElement("span")
      badge.className = "yui-here"
      badge.setAttribute("aria-hidden", "true")
      badge.textContent = "Yui"
      badge.hidden = true
      button.append(badge)
    }
  }
  moodMenu.setAttribute("aria-label", moodLabel)
  itemMenu.setAttribute("aria-label", itemsLabel)
  document.querySelector("#mood-period-title").textContent = periodLabel
  document.querySelector("#mood-quality-title").textContent = qualityLabel
  const periodRow = document.querySelector("#mood-periods")
  const qualityRow = document.querySelector("#mood-qualities")
  periodRow.setAttribute("aria-label", periodLabel)
  qualityRow.setAttribute("aria-label", qualityLabel)
  const periodButtons = ["auto", ...periods].map((period, index) => [period, textButton(periodRow, names.periods[index], `mood-${period}`)])
  const qualityButtons = qualities.map((level, index) => [level, textButton(qualityRow, qualityNames[index], `quality-${level}`)])
  // Group the item list by the room each item lives in, following the layout's slots.
  const featureRoom = Object.fromEntries(SLOTS.flatMap(slot => (slot.features || []).map(feature => [feature, slot.room])))
  const itemList = document.querySelector("#keepsakes")
  for (const roomId of [...new Set(keepsakeButtons.map(([id]) => featureRoom[id]))]) {
    const heading = document.createElement("p")
    heading.className = "menu-title"
    heading.textContent = viewNames[roomId]
    itemList.before(heading)
  }
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
  renderer.setClearColor(0x000000, 0)
  // Neutral keeps the palette's hues and saturation; ACES greyed out the pastel walls and backdrop.
  renderer.toneMapping = T.NeutralToneMapping
  renderer.toneMappingExposure = .96
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = T.PCFSoftShadowMap

  const scene = new T.Scene()
  // A narrow perspective keeps the miniature look from afar and gains depth when the camera moves in.
  const camera = new T.PerspectiveCamera(FOV.room, 1, .05, 120)
  const backdrop = new T.Color()
  scene.background = backdrop
  const makeEnvironment = () => {
    const generator = new T.PMREMGenerator(renderer)
    const texture = generator.fromScene(new RoomEnvironment(), .04).texture
    generator.dispose()
    return texture
  }
  scene.environment = makeEnvironment()
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
  // The yard, meadow, village and sky around the house (0.9.45); decorative only. Tests and diagnostics can leave
  // them out (?grounds=off, or "off" under GROUNDS_KEY in session storage) to check the house's own framing.
  const grounds = query.get("grounds") === "off" || sessionValue(GROUNDS_KEY) === "off" ? null : buildGrounds(scene)
  // The living-room mug sits on the coffee table; the study mug comes with the upstairs furnishing.
  const ambient = createAmbient(scene, {
    steam: [{ at: new T.Vector3(-.2, .7, .38), upper: false }, ...room.house.steam.map(at => ({ at, upper: true }))],
  })
  let paceUntil = 0
  // Whether Yui is inside the camera's view (she keeps moving off screen, at the slower ambient pace).
  const yuiView = new T.Frustum()
  const yuiBounds = new T.Sphere()
  const yuiMatrix = new T.Matrix4()
  const yuiOnScreen = () => {
    if (yui.shown < .01) return false
    // Upstairs views look down through the upper floor, which hides her when she is downstairs.
    if (!life?.upstairs && views[currentView].upper && upperLift < .5) return false
    yuiView.setFromProjectionMatrix(yuiMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    yuiBounds.center.copy(yui.root.position).y += .8
    yuiBounds.radius = .9
    return yuiView.intersectsSphere(yuiBounds)
  }
  // Yui loads after the room is up; the cottage works the same without her if the model cannot load.
  let yui = null
  let yuiMood = null
  // The relationship stage (0 stranger .. 4 lover) sets how she takes a touch; without the panel, "fond".
  let bondStage = 2
  // Where the closeup looks: her chest and face, from in front of her (she turns to the visitor when clicked).
  const yuiChest = new T.Vector3(.25, 1.24, 1.5)
  let yuiAngle = .5
  // Her day in the house (where she is, walking between places); null until she has loaded.
  let life = null
  let yuiRoom = ""
  const yuiFocus = new T.Vector3()
  const watchPoint = new T.Vector3()
  // Yui's mood follows the relationship shown in the panel; it only changes how she looks and moves.
  const moodFrom = ({ bond, calendar }) => {
    const number = value => Number.isFinite(value) ? value : 0
    return {
      warmth: bond ? Math.min(4, Math.max(0, number(bond.stage))) / 4 : .5,
      low: Boolean(bond) && number(bond.lost) > number(bond.gained),
      occasion: Array.isArray(calendar) && calendar.some(item => item?.today),
      missed: Boolean(bond) && number(bond.idle) >= 2,
    }
  }
  loadYui(scene, "./models", { style }).then(loaded => {
    yui = loaded
    life = createLife(loaded, T.Vector3)
    hitObjects.push(loaded.hitArea)
    hitLookup.set(loaded.hitArea, "yui")
    roomView.dataset.yui = "ready"
    startProbe()
    // Once the clips are in she shows (in a pose other than standing she stays hidden until then).
    loaded.motion.then(count => { roomView.dataset.yuiMotion = String(count); invalidate() })
    if (yuiMood) loaded.setMood(yuiMood)
    invalidate()
  }).catch(error => {
    roomView.dataset.yui = "missing"
    startProbe()
    console.warn("cottage: Yui model unavailable", error)
  })

  const preferences = loadPreferences()
  const reduced = matchMedia("(prefers-reduced-motion: reduce)")
  const views = Object.fromEntries(VIEW_IDS.map(id => [id, viewFrame(id)]))
  const center = new T.Vector3()
  const savedCamera = loadCamera()
  let currentView = "living"
  // A room change blends from the framing on screen when it started, so a second change mid-flight does not jump.
  let viewMotion = null
  let viewAmount = 1
  let lastBase = null
  let pendingOpen = null
  let upperLift = 1
  let houseMoving = false
  // The first frame places walls and the upper storey directly instead of animating from defaults.
  let houseSettled = false
  let returnToMenu = false
  const raycaster = new T.Raycaster()
  const pointer = new T.Vector2()
  let azimuth = savedCamera?.azimuth ?? START_ANGLE
  let elevation = savedCamera?.elevation ?? START_HEIGHT
  let targetAzimuth = azimuth
  let targetElevation = elevation
  let lamp = Number(preferences.lamp)
  let curtains = Number(preferences.curtains)
  const periodIndex = () => periods.indexOf(preferences.period === "auto" ? localPeriod() : preferences.period)
  let time = periodIndex()
  const lightColors = daylight.map(item => new T.Color(item.light))
  const moods = daylight.map(item => ({
    backdrop: new T.Color(item.backdrop), sun: new T.Color(item.sunColor), tint: new T.Color(...item.tint),
    from: new T.Vector3(...item.sunFrom), to: new T.Vector3(...item.sunTo),
  }))
  const dimBulb = new T.Color(0xbb9572)
  const litBulb = new T.Color(1.7, 1.25, .8)
  const requestedQuality = query.get("quality")
  // "auto": a starting tier from the adapter (or the one measured last time), then a short measurement once the
  // room and Yui are in. `probe` holds the frame costs being collected; `probeTried` the tiers measured so far.
  const adapter = adapterName(renderer)
  const adapterType = adapterKind(adapter)
  const remembered = savedQuality(readAuto(), adapter, Date.now())
  let autoQuality = remembered || startingQuality(adapter,
    { cores: navigator.hardwareConcurrency || 4, narrow: matchMedia("(max-width: 575px)").matches })
  let autoSource = remembered ? "saved" : "adapter"
  let probe = null
  let probeTried = []
  let probeArmed = false
  const pixel = new Uint8Array(4)
  let quality = "low"
  let composer = null
  let ink = null
  let sceneDepth = null
  let styled = -Infinity
  let bloom = null
  let grade = null
  let slowFrames = 0
  // How far the camera itself has travelled toward the open closeup (0 in the room, 1 when arrived).
  let cameraAmount = 0
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
  const pictureEdge = new T.Vector3()
  const picturePages = document.querySelector("#picture-pages")
  const calendarSheet = document.querySelector("#calendar-sheet")
  const cardThread = document.querySelector("#card-thread")
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
  // A touch in progress: the zone, and the pointer holding it (none for the card's buttons and keys).
  let held = null
  // The visitor's hand in touch mode: it follows the pointer and rests on her while a touch is held.
  const hand = createHand(scene, "./models")
  const handAt = { point: new T.Vector3(), zone: "none", inside: false, start: new T.Vector3(),
    anchor: null, local: new T.Vector3(), inverse: new T.Matrix4() }
  // `at` is the input event's own time, so a slow frame does not make a touch look longer than it was.
  function pressTouch(zone, side = 0, pointer = null, at = performance.now()) {
    if (!yui || held || closeup !== "yui" || !opening || yui.touching()) return false
    if (!yui.touchStart(zone, touchTier(zone, bondStage), side)) return false
    held = { zone, pointer, side, since: at, travel: 0, pinched: false, passes: 0, way: 0, peak: 0 }
    yuiCard.busy(true)
    invalidate()
    return true
  }
  const yuiCard = createYuiCard({ locale, linked, send, press: (zone, at) => pressTouch(zone, 0, null, at),
    release: at => releaseTouch(at), changed: () => invalidate() })
  let giftsSeen = null
  const closeups = { record: station, picture: pages, notebook, shelf, seat, calendar, projector, company, yui: yuiCard }
  backButton.append(icon("ChevronLeft"))
  backButton.title = backLabel(locale)
  backButton.setAttribute("aria-label", backButton.title)
  backButton.onclick = closeKeepsake

  const aimTarget = new T.Vector3()
  const viewRight = new T.Vector3()
  const viewUp = new T.Vector3()
  const viewBack = new T.Vector3()
  const tanHalf = fov => Math.tan(T.MathUtils.degToRad(fov) / 2)
  // Zoom geometrically so the approach feels evenly paced from far to near.
  const zoom = (from, to, amount) => from * (to / from) ** amount

  function aimCamera(point, angle, pitch, distance) {
    aimTarget.copy(point)
    const horizontal = distance * Math.cos(pitch)
    camera.position.set(
      point.x + horizontal * Math.sin(angle),
      point.y + distance * Math.sin(pitch),
      point.z + horizontal * Math.cos(angle),
    )
    camera.lookAt(point)
    camera.updateMatrixWorld()
  }

  // Backs the camera away from the last aimed point (keeping its direction) until `span` world units fill the
  // height at that point, then slides it sideways by the view-space offset (midX, midY).
  function placeCamera(span, midX, midY, fov, aspect) {
    const distance = span / 2 / tanHalf(fov)
    camera.matrixWorld.extractBasis(viewRight, viewUp, viewBack)
    const shift = viewRight.multiplyScalar(midX).addScaledVector(viewUp, midY)
    camera.position.copy(aimTarget).addScaledVector(viewBack, distance).add(shift)
    camera.lookAt(shift.add(aimTarget))
    camera.fov = fov
    camera.aspect = aspect
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
  }

  function fitView({ center: viewCenter, corners }) {
    aimCamera(viewCenter, azimuth, elevation, 11)
    const points = corners.map(corner => corner.clone().applyMatrix4(camera.matrixWorldInverse))
    const xs = points.map(point => point.x)
    const ys = points.map(point => point.y)
    const aspect = viewportWidth / viewportHeight
    const marginY = viewportHeight > 430 ? 144 : 110
    const usableY = Math.max(.40, 1 - marginY / viewportHeight)
    const usableX = viewportWidth > 650 ? .86 : .93
    let midX = (Math.min(...xs) + Math.max(...xs)) / 2
    let midY = (Math.min(...ys) + Math.max(...ys)) / 2
    // Nearer corners appear larger in perspective, so each corner sets its own minimum distance.
    const roomTan = tanHalf(FOV.room)
    const roomDistance = Math.max(...points.map(point => (point.z + 11) +
      Math.max(Math.abs(point.y - midY) / usableY, Math.abs(point.x - midX) / aspect / usableX) / roomTan))
    let span = 2 * roomDistance * roomTan
    // Measure where the corners really land and re-centre: the far half of the room projects smaller.
    placeCamera(span, midX, midY, FOV.room, aspect)
    const ndc = corners.map(corner => projected.copy(corner).project(camera).clone())
    const [left, right] = [Math.min(...ndc.map(p => p.x)), Math.max(...ndc.map(p => p.x))]
    const [bottom, top] = [Math.min(...ndc.map(p => p.y)), Math.max(...ndc.map(p => p.y))]
    midX += (left + right) / 2 * span * aspect / 2
    midY += (bottom + top) / 2 * span / 2
    span *= Math.max((top - bottom) / 2 / usableY, (right - left) / 2 / usableX)
    return { span, midX, midY }
  }

  function fitCamera() {
    const aspect = viewportWidth / viewportHeight
    const view = views[currentView]
    let { span, midX, midY } = fitView(view)
    center.copy(view.center)
    if (viewMotion) {
      const { from } = viewMotion
      center.lerpVectors(from.center, view.center, viewAmount)
      span = zoom(from.span, span, viewAmount)
      midX = T.MathUtils.lerp(from.midX, midX, viewAmount)
      midY = T.MathUtils.lerp(from.midY, midY, viewAmount)
    }
    lastBase = { center: center.clone(), span, midX, midY }
    aimCamera(center, azimuth, elevation, 11)
    let fov = FOV.room
    let amount = 0
    const compact = viewportWidth < 575
    const seatSpan = Math.max(2.65, 3.18 / aspect)
    const seatX = compact ? 0 : -.10
    // A closeup opened from the sofa uses its seated pose as the zero of the same timeline.
    const source = returnToSeat ? seatPose : { point: center, angle: azimuth, pitch: elevation, distance: 11 }
    if (returnToSeat) {
      span = seatSpan
      midX = seatX
      midY = 0
      fov = FOV.seat
    }
    const baseFov = fov
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
      span = zoom(span, closeSpan, focus)
      amount = focus
      midX = mix(midX, compact ? 0 : closeSpan * aspect * .15)
      midY = mix(midY, closeSpan * (compact ? -.23 : 0))
      aimCloseup(recordCenter, .44, .82, 3.6, focus)
    }
    // The frame and the calendar stand to one side so their paper card can open beside them.
    const pictureScale = cardScale(1.13, 1.35, viewportWidth, viewportHeight, 380)
    const projectorScale = Math.min((viewportWidth - 34) / 2.73, (viewportHeight - 108) / 1.53, 330)
    if (focus > 0 && closeup === "picture") {
      const cameraFocus = T.MathUtils.smoothstep(focus, 0, .73)
      const mix = (from, to) => T.MathUtils.lerp(from, to, cameraFocus)
      const closeSpan = viewportHeight / Math.max(1, pictureScale)
      const aside = cardFraming(closeSpan, aspect, compact)
      span = zoom(span, closeSpan, cameraFocus)
      amount = cameraFocus
      midX = mix(midX, aside.midX)
      midY = mix(midY, aside.midY)
      aimCloseup(pictureCenter, 0, 0, 3.2, cameraFocus)
    }
    if (focus > 0 && ["notebook", "shelf", "seat"].includes(closeup)) {
      const mix = (from, to) => T.MathUtils.lerp(from, to, focus)
      amount = focus
      if (closeup === "notebook") {
        const scale = Math.min(viewportWidth * 1.37, viewportHeight * .98, 750)
        const closeSpan = viewportHeight / scale
        span = zoom(span, closeSpan, focus)
        midX = mix(midX, 0)
        midY = mix(midY, 0)
        aimCloseup(bookCenter, -.4, Math.PI / 2 - .001, 3, focus)
      } else if (closeup === "shelf") {
        const scale = Math.min(viewportWidth * .86, viewportHeight * .80, 480)
        const closeSpan = viewportHeight / scale
        span = zoom(span, closeSpan, focus)
        midX = mix(midX, 0)
        midY = mix(midY, -closeSpan * .10)
        aimCloseup(shelfCenter, Math.PI / 2, .13, 3.1, focus)
      } else {
        span = zoom(span, seatSpan, focus)
        midX = mix(midX, seatX)
        midY = mix(midY, 0)
        aimCloseup(seatPose.point, seatPose.angle, seatPose.pitch, seatPose.distance, focus)
      }
    }
    if (focus > 0 && ["company", "calendar", "projector"].includes(closeup)) {
      const motion = returnToSeat ? focus : T.MathUtils.smoothstep(focus, 0, .76)
      const mix = (from, to) => T.MathUtils.lerp(from, to, motion)
      const scale = closeup === "calendar"
        ? cardScale(.59, .74, viewportWidth, viewportHeight, 430)
        : closeup === "projector" ? projectorScale : Math.min(viewportWidth * .75, viewportHeight * .68, 445)
      const closeSpan = viewportHeight / scale
      const aside = closeup === "calendar" ? cardFraming(closeSpan, aspect, compact) : { midX: 0, midY: closeup === "company" ? -.20 : 0 }
      span = zoom(span, closeSpan, motion)
      amount = motion
      midX = mix(midX, aside.midX)
      midY = mix(midY, aside.midY)
      const point = closeup === "calendar" ? calendarCenter : closeup === "projector" ? projectorCenter : companyCenter
      const angle = closeup === "company" ? .34 : 0
      const pitch = closeup === "company" ? .65 : 0
      aimCloseup(point, angle, pitch, 3.2, motion)
    }
    if (focus > 0 && closeup === "yui") {
      // Her upper body fills the view, beside the card (above it on narrow screens).
      const motion = T.MathUtils.smoothstep(focus, 0, 1)
      const mix = (from, to) => T.MathUtils.lerp(from, to, motion)
      const closeSpan = compact ? 1.7 : 1.02
      span = zoom(span, closeSpan, motion)
      amount = motion
      midX = mix(midX, compact ? 0 : closeSpan * aspect * .17)
      midY = mix(midY, compact ? -closeSpan * .13 : 0)
      aimCloseup(yuiChest, yuiAngle - .05, .08, 3, motion)
    }
    if (focus > 0 && closeup === "watch" && yui) {
      const motion = T.MathUtils.smoothstep(focus, 0, 1)
      const shot = SHOTS[life?.spot] || { angle: yui.root.rotation.y + .6, pitch: .12, span: 1.45, drop: .2, side: -1 }
      const closeSpan = shot.span * (compact ? 1.25 : 1)
      span = zoom(span, closeSpan, motion)
      amount = motion
      midX = T.MathUtils.lerp(midX, compact ? 0 : -shot.side * closeSpan * aspect * .14, motion)
      midY = T.MathUtils.lerp(midY, 0, motion)
      watchPoint.copy(yuiChest).y -= shot.drop
      aimCloseup(watchPoint, shot.angle, shot.pitch, 3, motion)
    }
    if (returnToSeat && focus === 0) aimCamera(source.point, source.angle, source.pitch, source.distance)
    // The field of view widens as the camera nears an object, while `span` keeps the framing at the
    // target plane, so DOM overlays sized from it still line up with the model.
    if (closeup) fov = T.MathUtils.lerp(baseFov, closeup === "seat" ? FOV.seat : closeup === "watch" ? FOV.watch : FOV.closeup, amount)
    cameraAmount = closeup ? amount : 0
    placeCamera(span, midX, midY, fov, aspect)
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
      placeCard(picturePages, cardThread, { compact, width: viewportWidth, height: viewportHeight,
        side: toScreen(projected.copy(pictureCenter).add(pictureEdge.set(pictureWidth / 2 + .1, 0, 0)).clone()),
        bottom: toScreen(projected.copy(pictureCenter).add(pictureEdge.set(0, -pictureHeight / 2 - .1, 0)).clone()) })
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
      placeCard(calendarSheet, cardThread, { compact, width: viewportWidth, height: viewportHeight,
        side: toScreen(projected.copy(calendarCenter).add(pictureEdge.set(.32, 0, 0)).clone()),
        bottom: toScreen(projected.copy(calendarCenter).add(pictureEdge.set(0, -.4, 0)).clone()) })
    }
    if (closeup === "projector" && focus > .76) {
      projector.position(room.projector.width * projectorScale, room.projector.height * projectorScale)
    }
  }

  function showThread(amount) {
    cardThread.hidden = amount === 0
    cardThread.style.setProperty("--arrival", amount)
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
    // Paced motion waits for its next slot on the display's own frame clock, so frames stay evenly spaced.
    if (paceUntil && timestamp < paceUntil) {
      frame = requestAnimationFrame(render)
      return
    }
    paceUntil = 0
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
    let arrived = false
    if (viewMotion) {
      viewMotion.start ??= timestamp
      const progress = reduced.matches ? 1 : clamp((timestamp - viewMotion.start) / (VIEW_SECONDS * 1000), 0, 1)
      viewAmount = T.MathUtils.smoothstep(progress, 0, 1)
      if (progress === 1) {
        viewMotion = null
        arrived = true
      }
    }
    fitCamera()
    houseMoving = updateHouse(dt)
    // The closeup of Yui waits until she is up (woken in bed, she first grumbles, turns over and gets out).
    if (pendingOpen && (arrived || !viewMotion) && !(pendingOpen === "yui" && life && !life.settled)) {
      const id = pendingOpen
      pendingOpen = null
      openKeepsake(id)
    }
    if (closeup === "picture") {
      // Read the same timeline backward so a mid-flight exit does not jump.
      const phase = (start, end) => T.MathUtils.smoothstep(focus, start, end)
      pages.reveal(phase(.75, .96), phase(.84, 1), opening && focus === 1)
      showThread(phase(.75, .96))
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
      const arrival = T.MathUtils.smoothstep(focus, .83, 1)
      calendar.show(arrival, opening && focus === 1)
      showThread(arrival)
    }
    if (closeup === "yui") {
      yuiCard.show(T.MathUtils.smoothstep(focus, .8, 1), opening && focus === 1)
      yuiCard.busy(Boolean(yui?.touching()))
    }
    if (closeup === "projector") {
      room.projector.reveal(T.MathUtils.smoothstep(focus, .36, .92))
      projector.show(T.MathUtils.smoothstep(focus, .87, 1), opening && focus === 1)
    }
    for (const curtain of room.curtains) curtain.scale.x = T.MathUtils.lerp(1.62, .37, curtains)
    const from = Math.min(Math.floor(time), 1)
    const blend = time - from
    const light = key => T.MathUtils.lerp(daylight[from][key], daylight[from + 1][key], blend)
    const mood = (key, target) => target.copy(moods[from][key]).lerp(moods[from + 1][key], blend)
    for (const [index, view] of room.views.entries()) {
      view.material.color.setScalar((.64 + curtains * .36) * light("window"))
      if (index) view.material.opacity = clamp(time - index + 1, 0, 1)
    }
    const night = light("glow")
    // Leaning in to read something at night lifts the ambient light; the sofa view keeps the evening mood.
    // Not for Yui: she is partly self-lit already, and the boost overexposed her face up close.
    const reading = closeup && !["seat", "projector", "yui"].includes(closeup) ? cameraAmount * night : 0
    const projectionShade = (closeup === "projector" ? 1 - focus * .25 : 1) * (1 + 1.5 * reading)
    sky.intensity = (.4 + .2 * curtains) * light("sky") * projectionShade
    key.intensity = (.36 + .84 * curtains) * light("key") * projectionShade * (1 + 1.5 * reading)
    fill.intensity = (.3 + .22 * curtains) * light("fill")
    key.color.copy(lightColors[from]).lerp(lightColors[from + 1], blend)
    scene.environmentIntensity = (.3 + .16 * curtains) * light("env") * projectionShade
    // Without its shadow map the sun cannot be blocked by the curtains, so dim it directly.
    // Close to Yui the strong dusk sun glares on her toon shading; it softens while the camera is near her.
    const sunGlare = closeup === "yui" ? cameraAmount * clamp((light("sun") - 1) / .2, 0, 1) : 0
    room.sun.intensity = 5.2 * light("sun") * projectionShade * (room.sun.castShadow ? 1 : .2 + .8 * curtains) *
      (1 - .45 * sunGlare)
    mood("sun", room.sun.color)
    mood("from", room.sun.position)
    mood("to", room.sun.target.position)
    room.sun.target.updateMatrixWorld()
    // The lamp matters most at night: a brighter pool and a glowing bulb.
    room.lampLight.intensity = lamp * (4 + 3.5 * night)
    room.lampPool.intensity = lamp * (2 + 2.5 * night)
    room.shade.emissiveIntensity = lamp * (.42 + .3 * night)
    room.bulb.color.copy(dimBulb).lerp(litBulb, lamp)
    // The other rooms light up on their own after dark; upstairs lamps go out while that storey is lifted away.
    for (const item of room.house.lamps) {
      const on = night * (item.storey ? 1 - upperLift : 1)
      item.light.intensity = item.strength * on
      item.shade.emissiveIntensity = .85 * on
    }
    // Ambient motion stays off on low quality (also what the software-rendered tests use) and with reduced motion.
    const motionAllowed = quality !== "low" && !reduced.matches && !document.hidden
    // Yui's self-lit share follows the room: full by day, dimmer at night, brighter again with the lamp on.
    // She watches the visitor (the camera), and whatever keepsake is being opened.
    const opened = closeup && focus > .2 ? room.hits.find(item => item.id === closeup)?.object : null
    // The low dusk sun already lights her front strongly, so her self-lit share drops while it is out.
    const glow = Math.min(1, .3 + .7 * light("env") * (1 - .7 * Math.max(0, light("sun") - 1) / .2) + .3 * lamp * night)
    // Lofi: Yui has her own light rig; it takes its colour and strength from the room (cottage-style.mjs).
    if (style === "lofi") setCharacterLight({ night, lamp, level: glow })
    // The hand shows in touch mode while the pointer is over the room, or while a card button holds a touch.
    const handShown = Boolean(touchReady() && (handAt.inside || (held && !held.pointer)))
    if (handShown !== hand.object.visible) {
      hand.show(handShown)
      canvas.toggleAttribute("data-hand", handShown)
    }
    if (handShown && held && !held.pointer) scriptedHand(timestamp)
    else if (handShown && held && handAt.anchor) placeHand(handAt.point.copy(handAt.local).applyMatrix4(handAt.anchor.matrixWorld), held.zone)
    hand.glow(glow)
    hand.scratch(held?.zone === "chin")
    const handMoving = hand.update(dt, !motionAllowed)
    // Where her day has her (walking there when motion is allowed), then her body, face and eyes.
    const lived = life ? life.update(dt, {
      minutes: cottageMinutes(preferences.period), moving: motionAllowed, upperLift: 4.2 * upperLift ** 2,
    }) : null
    if (life) {
      yui.chest(yuiChest)
      if (life.attending) yuiAngle = life.facing
      showYuiRoom(life.room)
      // The medium shot ends when her day takes her to another room (the camera would be framing a wall).
      if (closeup === "watch" && opening && life.room !== currentView) closeKeepsake()
      const doing = life.attending ? "with-you" : life.activity
      if (roomView.dataset.yuiDoing !== doing) roomView.dataset.yuiDoing = doing
    }
    const yuiMoving = yui ? yui.update(dt, {
      moving: motionAllowed, glow, viewer: camera.position,
      focus: opened ? opened.getWorldPosition(yuiFocus) : null, hovered: canvas.dataset.target === "yui",
      task: life?.task() || null, asleep: Boolean(life?.asleep), grumpy: life?.grumpy || 0, support: life?.support ?? null,
    }) || Boolean(lived?.changed) : false
    // The duvet rises over her while she is under it (without motion it settles at once).
    const duvetMoving = room.house.duvet.update(motionAllowed ? dt : 1,
      yui && life && yui.root.visible ? yui.capsules() : null, life?.cover || 0)
    const ambientActive = ambient.update(dt, {
      enabled: motionAllowed,
      night, sun: Math.min(1, light("sun")) * curtains, lift: 4.2 * upperLift ** 2, upperShown: upperLift < .995,
    })
    if (roomView.dataset.ambient !== String(ambientActive)) roomView.dataset.ambient = String(ambientActive)
    mood("backdrop", backdrop)
    // The windmill turns only while ambient motion runs (medium and high quality, motion not reduced).
    grounds?.update(backdrop, night, ambientActive ? dt : 0)
    const shownPeriod = periods[Math.round(time)]
    if (roomView.dataset.period !== shownPeriod) roomView.dataset.period = shownPeriod
    if (grade) {
      mood("tint", grade.uniforms.tint.value)
      grade.uniforms.vignette.value = .16 + .14 * Math.max(night, focus)
    }
    if (bloom) bloom.strength = .2 + .2 * night
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
        // Back from her closeup, she goes on with her day after a moment.
        if (previous === "yui" && life) {
          life.resume()
          invalidate()
        }
        const next = afterReturn
        afterReturn = null
        if (next) openKeepsake(next)
        else {
          controls.hidden = false
          // Opened from the item list: reopen it on the same item. Opened in the scene: focus the list button.
          if (returnToMenu && itemMenu.contains(elements[previous])) {
            toggleMenu(itemMenu, true)
            elements[previous].focus({ preventScroll: true })
          } else (itemMenu.contains(elements[previous]) ? elements.items : elements[previous] || elements.rooms).focus({ preventScroll: true })
          returnToMenu = false
        }
      }
    }
    const measuring = probe && probeArmed && document.visibilityState === "visible"
    const drawStart = measuring ? performance.now() : 0
    // New objects (gifts on the shelf, Yui once loaded) pick up the lofi materials too; each only once.
    if (style === "lofi" && timestamp - styled > 1500) {
      stylize(scene)
      styled = timestamp
    }
    if (composer) composer.render(dt)
    else renderer.render(scene, camera)
    if (measuring) measureFrame(drawStart)
    const animating = azimuth !== targetAzimuth || elevation !== targetElevation || lamp !== Number(preferences.lamp) ||
      curtains !== Number(preferences.curtains) || time !== wantedTime || focusMotion || spinning || viewMotion || houseMoving ||
      handMoving || Boolean(handShown && held && !held.pointer)
    // When "auto" quality cannot keep up during motion, step down one tier. Yui alone never forces "low",
    // which would stop her moving.
    const yuiShown = yuiMoving && yuiOnScreen()
    slowFrames = (animating || yuiShown) && dt > .045 ? slowFrames + 1 : 0
    if (slowFrames > 24 && quality !== "low" && (animating || quality === "high") && wantedQuality() === "auto") {
      slowFrames = 0
      probe = null
      autoQuality = quality === "high" ? "medium" : "low"
      autoSource = "slowed"
      keepAuto(adapter, autoQuality)
      applyQuality()
    }
    if (animating || probe && probeArmed) invalidate()
    // Yui in view moves at up to 60 frames a second; ambient motion alone at 30. Both stay on the display's clock.
    else if (ambientActive || yuiMoving || duvetMoving) {
      paceUntil = timestamp + (yuiShown ? 1000 / 60 : 1000 / 30) - 4
      frame = requestAnimationFrame(render)
    } else lastFrame = 0
  }

  // Upstairs lifts away like a dollhouse lid for ground-floor rooms; side walls in front of the view fade out.
  function updateHouse(dt) {
    const { storeys, overhead, fadeWalls } = room.house
    const instant = reduced.matches || !houseSettled
    houseSettled = true
    const wanted = views[currentView].upper ? 0 : 1
    upperLift = instant || Math.abs(upperLift - wanted) < .002 ? wanted : T.MathUtils.damp(upperLift, wanted, 5.5, dt)
    for (const group of [storeys[1], overhead]) {
      group.position.y = 4.2 * upperLift ** 2
      group.visible = upperLift < .995
    }
    let moving = upperLift !== wanted
    for (const wall of fadeWalls) {
      const shown = wall.storey === 0 || upperLift < .995
      // Closeups keep the room's wall state: the camera leaning in should not bring a faded wall back.
      const blocking = closeup ? wall.goal === 0 : (camera.position.x - wall.at) * (center.x - wall.at) < 0
      const goal = wall.goal = blocking ? 0 : 1
      wall.opacity = instant || Math.abs(wall.opacity - goal) < .01 ? goal : T.MathUtils.damp(wall.opacity, goal, 9, dt)
      if (wall.opacity !== goal) moving = true
      for (const material of wall.materials) {
        const transparent = wall.opacity < 1
        if (material.transparent !== transparent) {
          material.transparent = transparent
          material.needsUpdate = true
        }
        material.opacity = wall.opacity
        material.depthWrite = !transparent
      }
      for (const mesh of wall.meshes) {
        mesh.visible = shown && wall.opacity > .02
        mesh.castShadow = wall.opacity > .5
      }
    }
    return moving
  }

  function goTo(id) {
    if (closeup || !Object.hasOwn(views, id)) return
    closeMenus()
    if (id !== currentView || viewMotion) {
      viewMotion = { from: lastBase || { center: views[currentView].center.clone(), span: 1, midX: 0, midY: 0 }, start: null }
      viewAmount = 0
    }
    currentView = id
    roomView.dataset.room = id
    roomName.textContent = viewNames[id]
    for (const button of roomMenu.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.view === id))
    delete canvas.dataset.target
    rememberCamera()
    invalidate()
  }

  function rememberCamera() {
    try {
      sessionStorage.setItem(CAMERA_KEY, JSON.stringify({ view: currentView, azimuth: targetAzimuth, elevation: targetElevation }))
    } catch { /* the camera then starts on the whole house next time */ }
  }

  // The room menu marks the room she is in.
  function showYuiRoom(id) {
    if (id === yuiRoom) return
    yuiRoom = id
    roomView.dataset.yuiRoom = id
    for (const button of roomMenu.querySelectorAll("button")) {
      const badge = button.querySelector(".yui-here")
      if (badge) badge.hidden = button.dataset.view !== id
    }
  }

  function applyQuality(level = resolveQuality()) {
    quality = level
    roomView.dataset.quality = level
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, { low: 1.25, medium: 1.6, high: 2 }[level]))
    key.shadow.mapSize.setScalar(level === "high" ? 2048 : 1536)
    room.sun.castShadow = level !== "low"
    room.sun.shadow.mapSize.setScalar(level === "high" ? 2048 : 1024)
    for (const light of [key, room.sun]) {
      light.shadow.map?.dispose()
      light.shadow.map = null
    }
    for (const pass of composer?.passes || []) pass.dispose?.()
    composer?.dispose()
    composer = bloom = grade = ink = null
    if (level !== "low") {
      // Only the scene is multisampled (see scenePass); the composer's own buffers stay single-sampled.
      const target = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType })
      composer = new EffectComposer(renderer, target)
      composer.addPass(scenePass())
      if (level === "high") {
        const occlusion = new GTAOPass(scene, camera, 1, 1)
        // Kept at full size: at half size the occlusion steps into visible teeth along wall corners and
        // furniture edges (tried in 0.9.42, withdrawn in 0.9.43).
        occlusion.output = GTAOPass.OUTPUT.Default
        occlusion.blendIntensity = .85
        occlusion.updateGtaoMaterial({ radius: .32, distanceExponent: 1.5, thickness: 1.4, scale: 1, samples: 12 })
        occlusion.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 })
        // The stock denoise turns its sample pattern by a different random angle in every pixel. Along wall
        // corners and furniture edges, where few neighbours count, that leaves a dotted dark line the raw
        // occlusion does not have; one fixed pattern for all pixels keeps those lines smooth (0.9.44).
        occlusion.pdMaterial.fragmentShader = occlusion.pdMaterial.fragmentShader.replace(PD_ROTATION, "mat2 rotationMatrix = mat2(1., 0., 0., 1.);")
        occlusion.pdMaterial.needsUpdate = true
        composer.addPass(occlusion)
      }
      bloom = new UnrealBloomPass(new T.Vector2(1, 1), .3, .5, .95)
      composer.addPass(bloom)
      composer.addPass(new OutputPass())
      grade = new ShaderPass(GradeShader)
      composer.addPass(grade)
      if (style === "lofi") {
        ink = new ShaderPass(InkShader)
        ink.uniforms.tDepth.value = sceneDepth
        Object.assign(ink.uniforms, { near: { value: camera.near }, far: { value: camera.far } })
        composer.addPass(ink)
      }
    }
    resize()
  }

  // Draws the scene with 4x MSAA into its own buffer and copies the resolved picture into the composer.
  // Multisampling the composer's buffers instead made every later pass (bloom, output, grade) write and resolve
  // at 4x as well: the same picture, at about a quarter of each frame on integrated graphics.
  function scenePass() {
    const samples = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, samples: 4,
      depthTexture: style === "lofi" ? new T.DepthTexture(1, 1) : null })
    sceneDepth = samples.depthTexture
    const copy = new FullScreenQuad(new T.ShaderMaterial({
      ...CopyShader, uniforms: T.UniformsUtils.clone(CopyShader.uniforms), depthTest: false, depthWrite: false,
    }))
    copy.material.uniforms.tDiffuse.value = samples.texture
    const pass = new RenderPass(scene, camera)
    const draw = pass.render.bind(pass)
    pass.render = (target, writeBuffer, readBuffer, deltaTime, maskActive) => {
      draw(target, writeBuffer, samples, deltaTime, maskActive)
      target.setRenderTarget(readBuffer)
      copy.render(target)
    }
    pass.setSize = (width, height) => samples.setSize(width, height)
    pass.dispose = () => {
      samples.depthTexture?.dispose()
      samples.dispose()
      copy.material.dispose()
      copy.dispose()
    }
    return pass
  }

  function wantedQuality() {
    return qualities.includes(requestedQuality) ? requestedQuality : preferences.quality
  }

  function resolveQuality() {
    const wanted = wantedQuality()
    roomView.dataset.qualitySource = wanted === "auto" ? autoSource : "chosen"
    return wanted === "auto" ? autoQuality : wanted
  }

  // Measures "auto" when nothing is remembered for this adapter. A tier that is already low has nowhere to go,
  // so it is not measured. Started once the room is up, and again whenever the choice goes back to auto.
  function startProbe() {
    if (wantedQuality() !== "auto" || autoSource === "saved" || autoSource === "measured" || autoQuality === "low") {
      probe = null
      return
    }
    probe = []
    probeArmed = false
    setTimeout(() => {
      probeArmed = true
      invalidate()
    }, 800)
  }

  // One measured frame: the time to draw it, waiting on the GPU by reading back a single pixel, so the
  // display's refresh rate does not enter into it.
  function measureFrame(start) {
    if (quality !== autoQuality) return
    const gl = renderer.getContext()
    renderer.setRenderTarget(null)
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    probe.push(performance.now() - start)
    if (probe.length < PROBE_FRAMES) return
    const cost = probeCost(probe)
    roomView.dataset.qualityCost = cost.toFixed(1)
    probeTried = [...probeTried, quality]
    const next = settle(quality, cost, { kind: adapterType, tried: probeTried })
    // Stepping up to high and finding it slow settles back on medium without measuring medium again.
    const settled = next && probeTried.includes(next) ? next : null
    if (next && !settled) {
      autoQuality = next
      probe = []
      applyQuality()
      return
    }
    probe = null
    autoQuality = settled || quality
    autoSource = "measured"
    keepAuto(adapter, autoQuality)
    applyQuality()
  }

  function resize() {
    if (!viewportWidth || !viewportHeight) return
    renderer.setSize(viewportWidth, viewportHeight, false)
    composer?.setPixelRatio(renderer.getPixelRatio())
    composer?.setSize(viewportWidth, viewportHeight)
    const ratio = renderer.getPixelRatio()
    ink?.uniforms.texel.value.set(1 / (viewportWidth * ratio), 1 / (viewportHeight * ratio))
    if (style === "lofi") styleRatio(ratio)
    invalidate()
  }

  function invalidate() {
    paceUntil = 0
    if (!frame && !lost) frame = requestAnimationFrame(render)
  }

  function changeView(angle, height) {
    targetAzimuth = clamp(angle, .13, 1.24)
    targetElevation = clamp(height, .33, .81)
    rememberCamera()
    invalidate()
  }

  function syncControls() {
    elements.lamp.setAttribute("aria-pressed", String(preferences.lamp))
    elements.curtains.setAttribute("aria-pressed", String(preferences.curtains))
    for (const [period, button] of periodButtons) button.setAttribute("aria-pressed", String(preferences.period === period))
    const shownQuality = qualities.includes(requestedQuality) ? requestedQuality : preferences.quality
    for (const [level, button] of qualityButtons) button.setAttribute("aria-pressed", String(shownQuality === level))
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

  // The hand leaves her: the companion hears about every touch, with how long it lasted.
  function releaseTouch(at = performance.now()) {
    handAt.anchor = null
    if (!held || !yui) return
    const { zone, since } = held
    // Stroking her head, pinching her cheek and rubbing an ear tell the companion so; a still hand does not.
    const moved = held.pinched || (TOUCH_MOVE[zone] !== undefined && held.travel > TOUCH_MOVE[zone])
    const strokes = moved && STROKED.includes(zone) ? strokesFrom(held.passes) : null
    held = null
    yui.touchEnd()
    const seconds = Math.max(0, (at - since) / 1000)
    yui.touchFollow(0)
    const length = seconds < .7 ? "tap" : seconds < 2.5 ? "while" : "long"
    delete canvas.dataset.touch
    invalidate()
    if (!linked) return
    const character = yuiCard.character()
    if (!character) yuiCard.touched("offline")
    else send("love-with-you-cottage-touch", { token: crypto.randomUUID(), character, zone, length, moved,
      ...(strokes ? { strokes } : {}) })
  }

  function approach(id) {
    closeup = id
    if (id === "picture" && recentNote && pages.select(recentNote.character, recentNote.id)) recentNote = null
    opening = true
    controls.hidden = true
    closeMenus()
    hoverLabel.hidden = true
    delete canvas.dataset.target
    roomView.dataset.view = "approaching"
    backButton.hidden = false
    backButton.focus({ preventScroll: true })
    focusMotion = { from: focus, start: returnToSeat ? null : performance.now() }
    invalidate()
  }

  function closeKeepsake() {
    if (!opening) return
    releaseTouch()
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
        // A gift that arrives while she is in the closeup (sent from the bag) makes her happy.
        const ids = new Set((payload.gifts || []).map(gift => gift?.id))
        if (giftsSeen && closeup === "yui" && [...ids].some(id => !giftsSeen.has(id))) {
          yui?.cheer()
          invalidate()
        }
        giftsSeen = ids
      }
      if (event.data.type === "love-with-you-cottage-touch-result") yuiCard.touched(payload.status)
      if (event.data.type === "love-with-you-cottage-note-result") notebook.result(payload)
      if (event.data.type === "love-with-you-cottage-company-data") {
        company.update(payload.company)
        calendar.update(payload)
        projector.update(payload.watch)
        room.notebook.card.visible = payload.calendar.some(item => item.today)
        yuiCard.update(payload.company)
        if (Number.isFinite(payload.bond?.stage)) bondStage = clamp(Math.round(payload.bond.stage), 0, 4)
        yuiMood = moodFrom(payload)
        roomView.dataset.yuiMood = Object.entries(yuiMood)
          .map(([key, value]) => key === "warmth" ? `warmth:${value}` : value ? key : "").filter(Boolean).join(" ")
        yui?.setMood(yuiMood)
        showOccasion = room.notebook.card.visible && payload.canWrite
        invalidate()
      }
      if (event.data.type === "love-with-you-cottage-invite-result" && !yuiCard.invited(payload)) company.result(payload)
    })
    window.parent.postMessage({ type: "love-with-you-cottage-ready" }, location.origin)
  }
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !event.defaultPrevented && closeMenus()) {
      event.preventDefault()
      return
    }
    if (opening && event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault()
      closeKeepsake()
    }
  })
  document.addEventListener("visibilitychange", invalidate)
  reduced.addEventListener("change", invalidate)
  // The light follows the clock, and so does she (without motion she is redrawn where the time has her).
  setInterval(() => {
    if (document.hidden) return
    if (time !== periodIndex() || (life && activityAt(cottageMinutes(preferences.period)).id !== life.activity)) invalidate()
  }, 30_000)

  function activate(id) {
    closeMenus()
    if (id === "yui") {
      // She stops what she is doing (getting up if seated or asleep) and turns to the visitor, and the camera
      // comes closer to her, in the room she is in.
      if (!yui) return
      life?.interrupt(camera.position)
      if (life) yuiAngle = life.facing
      yui.react()
      const here = life?.room || "living"
      if (here !== currentView || viewMotion || (life && !life.settled)) {
        pendingOpen = "yui"
        if (here !== currentView) goTo(here)
      } else openKeepsake("yui")
      invalidate()
    } else if (id === "watch") {
      // Frame her where she is, in the room she is in, without stopping her.
      if (!yui || closeup) return
      const here = life?.room || "living"
      if (here !== currentView || viewMotion) {
        pendingOpen = "watch"
        if (here !== currentView) goTo(here)
      } else openKeepsake("watch")
    } else if (id.startsWith("room:")) goTo(id.slice(5))
    else if (id === "lamp" || id === "curtains") toggle(id)
    else if (id === "occasion") calendar.writeToday()
    else if ((linked || id === "seat") && Object.hasOwn(closeups, id)) {
      // Everything that opens today lives in the living room; walk there first when looking elsewhere.
      if (currentView !== "living" || viewMotion) {
        pendingOpen = id
        goTo("living")
      } else openKeepsake(id)
    }
  }

  function toggleMenu(menu, opening = menu.hidden) {
    closeMenus()
    if (!opening) return
    const [, button] = menus.find(([item]) => item === menu)
    menu.hidden = false
    button.setAttribute("aria-expanded", "true")
    menu.querySelector('[aria-pressed="true"], button:not([hidden])')?.focus({ preventScroll: true })
  }

  function closeMenus() {
    let closed = false
    for (const [menu, button] of menus) {
      if (!menu.hidden) closed = true
      menu.hidden = true
      button.setAttribute("aria-expanded", "false")
    }
    return closed
  }

  const hitLookup = new Map(room.hits
    .filter(({ id }) => linked || ["lamp", "curtains", "seat"].includes(id))
    .map(({ id, object }) => [object, id]))
  const hitObjects = [...hitLookup.keys()]
  const roomLookup = new Map(room.house.rooms.map(({ id, object }) => [object, id]))
  function hitAt(event) {
    const bounds = canvas.getBoundingClientRect()
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1,
      1 - (event.clientY - bounds.top) / bounds.height * 2)
    raycaster.setFromCamera(pointer, camera)
    // She can be clicked wherever she is in sight: not while out of sight on the stairs or getting into bed, nor
    // behind a wall or under the upper floor.
    const yuiSeen = Boolean(yui && !viewMotion && yuiInSight())
    if (yuiSeen && currentView !== "living") return "yui"
    if (currentView === "living" && !viewMotion) {
      const intersection = raycaster.intersectObjects(hitObjects, false)
        .find(hit => (showOccasion || hitLookup.get(hit.object) !== "occasion") && (hit.object !== yui?.hitArea || yuiSeen))
      if (intersection) return hitLookup.get(intersection.object)
    }
    // Any other room can be entered by clicking it; upstairs only while it is in place.
    const upperShown = upperLift < .5
    const rooms = [...roomLookup].filter(([, id]) => id !== currentView &&
      (upperShown || ROOMS.find(item => item.id === id).storey === 0)).map(([object]) => object)
    const roomHit = raycaster.intersectObjects(rooms, false)[0]
    return roomHit ? `room:${roomLookup.get(roomHit.object)}` : undefined
  }

  // Whether the pointer's ray reaches her before any shown part of the house (walls, floors).
  const drawn = object => {
    for (let item = object; item; item = item.parent) if (!item.visible) return false
    return Array.isArray(object.material) || !object.material || object.material.opacity > .5
  }
  // Walls, floors, the roof and big furniture hide her; chairs and small things in front of her do not.
  let screens = null
  function yuiInSight() {
    if (yui.shown < .9) return false
    const hit = raycaster.intersectObject(yui.hitArea, false)[0]
    if (!hit) return false
    if (!screens) {
      const size = new T.Vector3()
      screens = []
      for (const storey of room.house.storeys) storey.traverse(object => {
        if (!object.isMesh) return
        new T.Box3().setFromObject(object).getSize(size)
        if ([size.x, size.y, size.z].filter(value => value >= 1.2).length >= 2) screens.push(object)
      })
    }
    const blocker = raycaster.intersectObjects(screens, false).find(item => drawn(item.object))
    return !blocker || blocker.distance > hit.distance
  }

  function showHover(id, event) {
    const label = !id ? "" : id === "yui" ? "Yui" : id.startsWith("room:") ? viewNames[id.slice(5)] : elements[id]?.title || ""
    hoverLabel.hidden = !label
    if (!label) return
    hoverLabel.textContent = label
    const bounds = roomView.getBoundingClientRect()
    hoverLabel.style.transform = `translate(${event.clientX - bounds.left + 14}px, ${event.clientY - bounds.top + 16}px)`
  }

  function clearDrag() {
    drag = null
    delete canvas.dataset.dragging
  }

  // In the closeup's touch mode, the pointer touches her instead of turning the room.
  const touchReady = () => closeup === "yui" && opening && focus === 1 && yuiCard.mode === "touch" && yui
  function zoneAt(event) {
    const bounds = canvas.getBoundingClientRect()
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2)
    raycaster.setFromCamera(pointer, camera)
    // The head zone is the largest; a smaller part (ears, cheek, hand) just as near wins over it.
    const hits = raycaster.intersectObjects(yui.zones, false)
    const hit = hits.find(item => item.object.userData.zone !== "head" && item.distance - hits[0].distance < .1) || hits[0]
    if (hit) Object.assign(hit.object.userData, { point: hit.point, object: hit.object })
    return hit?.object.userData
  }
  // How far the hand goes sideways while it holds on (metres) for her to follow it fully, and how far it must have
  // travelled to count as a stroke, a pinch or a rub (the hand and tail have no such move).
  const TOUCH_REACH = { head: .08, cheek: .035, ears: .04, chin: .03 }
  const TOUCH_MOVE = { head: .03, cheek: .012, ears: .015 }
  // Stroking her head and rubbing an ear also tell the companion roughly how many times: a few, or many.
  const STROKED = ["head", "ears"]
  const strokesFrom = passes => passes >= 8 ? "many" : passes >= 3 ? "some" : null
  const handRight = new T.Vector3()
  const pullPoint = new T.Vector3()
  const handForward = new T.Vector3()
  const handFingers = new T.Vector3()
  const handUp = new T.Vector3()
  const worldUp = new T.Vector3(0, 1, 0)
  // Where the hand goes and how it turns: it comes in from the right of the view, across rather than into the
  // screen (so its cuff never faces the camera or covers her): palm down on her head and ears with its back
  // turned a little toward the visitor, the index finger into her cheek, palm up under her hand and tail.
  function placeHand(point, zone) {
    camera.matrixWorld.extractBasis(handRight, handUp, handForward)
    handForward.negate()
    handUp.copy(worldUp)
    if (zone === "cheek") handFingers.copy(handRight).multiplyScalar(-.85).addScaledVector(handForward, .4)
    else if (zone === "chin") {
      // Palm up, fingertips toward her and under her chin.
      handFingers.copy(handForward).multiplyScalar(.6).addScaledVector(handRight, -.65).addScaledVector(worldUp, .25)
      handUp.negate().addScaledVector(handForward, -.25)
    } else if (zone === "hand" || zone === "tail") {
      handFingers.copy(handRight).negate().addScaledVector(handForward, .15)
      handUp.negate().addScaledVector(handForward, -.3)
    } else if (zone === "none") {
      handFingers.copy(handRight).multiplyScalar(-.85).addScaledVector(worldUp, .15).addScaledVector(handForward, .1)
      handUp.addScaledVector(handForward, -.5)
    } else {
      handFingers.copy(handRight).negate().addScaledVector(worldUp, -.15).addScaledVector(handForward, -.1)
      handUp.addScaledVector(handForward, -.35)
    }
    hand.setPose(zone === "cheek" && held?.pinched ? "pinch" : HAND_POSE[zone])
    hand.aim(point, handFingers, handUp)
  }
  // From a pointer: over a part of her the hand hovers just off it (rests on it while held); elsewhere it floats
  // at her depth. While stroking her head, its sideways travel turns her head a little with it.
  function aimHand(event) {
    const zone = zoneAt(event)
    const touching = held && held.pointer === event.pointerId
    // A pinched cheek stays pinched: the hand keeps hold of it (and goes where it goes), and pulling only draws her
    // head after the hand.
    if (touching && held.pinched && handAt.anchor) {
      camera.matrixWorld.extractBasis(handRight, handUp, handForward)
      raycaster.ray.at(raycaster.ray.origin.distanceTo(handAt.start), pullPoint)
      yui.touchFollow(clamp(pullPoint.sub(handAt.start).dot(handRight) / TOUCH_REACH.cheek, -1, 1))
      invalidate()
      return
    }
    if (zone && (!touching || zone.zone === held.zone)) {
      handAt.zone = touching ? held.zone : zone.zone
      handAt.point.copy(zone.point)
      // Hovering, it stays just off her; held, it rests on her head and ears, and in front of her hand and tail.
      if (!touching || held.zone === "hand" || held.zone === "tail") handAt.point.addScaledVector(raycaster.ray.direction, -.035)
      if (touching) holdAt(zone.object)
    } else {
      if (!touching) handAt.zone = "none"
      handAt.anchor = null
      const depth = raycaster.ray.origin.distanceTo(touching ? handAt.start : yuiChest)
      raycaster.ray.at(depth, handAt.point)
      // Moving past the edge of the part it holds: the hand stays on her and only slides sideways, a little past.
      const reach = touching && TOUCH_REACH[held.zone]
      if (reach) {
        camera.matrixWorld.extractBasis(handRight, handUp, handForward)
        const sideways = clamp(handAt.point.sub(handAt.start).dot(handRight), -reach * .9, reach * .9)
        handAt.point.copy(handAt.start).addScaledVector(handRight, sideways)
      }
    }
    // While it holds on, her head goes a little with the hand; on her cheek, a hand pulled sideways pinches.
    if (touching && TOUCH_REACH[held.zone]) {
      camera.matrixWorld.extractBasis(handRight, handUp, handForward)
      const sideways = handAt.point.clone().sub(handAt.start).dot(handRight)
      held.travel = Math.max(held.travel, Math.abs(sideways))
      countPasses(sideways)
      if (held.zone === "cheek" && !held.pinched && held.travel > TOUCH_MOVE.cheek) {
        // The pinch takes hold just in front of her cheek, so the fingers stay in view.
        held.pinched = true
        handAt.point.addScaledVector(raycaster.ray.direction, -.014)
        if (handAt.anchor) holdAt(handAt.anchor)
      }
      yui.touchFollow(clamp(sideways / TOUCH_REACH[held.zone], -1, 1))
    }
    placeHand(handAt.point, handAt.zone)
    invalidate()
  }
  // A held hand keeps its place on the part of her it holds, so it goes along when she leans in or reaches
  // (but not when she pulls away: then it stays where she was).
  function holdAt(object) {
    handAt.anchor = touchTier(held.zone, bondStage) === "dodge" ? null : object
    if (handAt.anchor) handAt.local.copy(handAt.point).applyMatrix4(handAt.inverse.copy(object.matrixWorld).invert())
  }
  // Each sweep of a stroking or rubbing hand that turns back after going far enough is one more pass.
  function countPasses(sideways) {
    const sweep = (TOUCH_MOVE[held.zone] || 0) * .6
    if (!STROKED.includes(held.zone)) return
    if (!held.way) {
      if (Math.abs(sideways) > sweep) Object.assign(held, { way: Math.sign(sideways), passes: 1, peak: sideways })
    } else if (held.way * (sideways - held.peak) > 0) held.peak = sideways
    else if (held.way * (held.peak - sideways) > sweep) {
      held.way = -held.way
      held.passes += 1
      held.peak = sideways
    }
  }
  // Card buttons and keys have no pointer: the hand goes to the part by itself, and strokes her head.
  function scriptedHand(now) {
    const sphere = yui.zones.find(item => item.userData.zone === held.zone && item.userData.side >= 0) ||
      yui.zones.find(item => item.userData.zone === held.zone)
    sphere.getWorldPosition(handAt.point)
    camera.matrixWorld.extractBasis(handRight, handUp, handForward)
    handAt.point.addScaledVector(handForward, .03)
    if (held.zone === "head" || held.zone === "ears") {
      // Strokes her head, or rubs an ear, back and forth.
      const sway = Math.sin((now - held.since) / 1000 * (held.zone === "head" ? 5.5 : 7))
      handAt.point.addScaledVector(handRight, sway * (held.zone === "head" ? .045 : .015))
      yui.touchFollow(sway * .7)
    }
    placeHand(handAt.point, held.zone)
  }
  canvas.addEventListener("pointerdown", event => {
    if (event.button === 0 && touchReady() && !held) {
      handAt.inside = true
      const zone = zoneAt(event)
      if (zone && pressTouch(zone.zone, zone.side, event.pointerId, event.timeStamp)) {
        canvas.setPointerCapture(event.pointerId)
        canvas.dataset.touch = "held"
        handAt.start.copy(zone.point)
      }
      aimHand(event)
      return
    }
    if (event.button !== 0 || drag || closeup) return
    closeMenus()
    hoverLabel.hidden = true
    drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY,
      azimuth: targetAzimuth, elevation: targetElevation, moved: false }
    canvas.setPointerCapture(event.pointerId)
  })
  canvas.addEventListener("pointermove", event => {
    if (touchReady() && (!held || held.pointer === event.pointerId)) {
      handAt.inside = true
      if (!held) {
        const zone = zoneAt(event)
        if (zone && !yui.touching()) canvas.dataset.touch = zone.zone
        else delete canvas.dataset.touch
      }
      aimHand(event)
    }
    if (closeup) return
    if (!drag) {
      const id = hitAt(event)
      if (id) canvas.dataset.target = id
      else delete canvas.dataset.target
      showHover(id, event)
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
  const endHeld = event => { if (held && held.pointer === event.pointerId) releaseTouch(event.timeStamp) }
  canvas.addEventListener("pointercancel", endHeld)
  canvas.addEventListener("pointerup", event => {
    endHeld(event)
    if (event.pointerId !== drag?.id) return
    const id = !drag.moved && hitAt(event)
    clearDrag()
    if (id) activate(id)
  })
  canvas.addEventListener("lostpointercapture", event => {
    endHeld(event)
    clearDrag()
  })
  canvas.addEventListener("pointerleave", () => {
    if (!held?.pointer) handAt.inside = false
    delete canvas.dataset.target
    hoverLabel.hidden = true
  })
  elements.lamp.onclick = () => toggle("lamp")
  elements.curtains.onclick = () => toggle("curtains")
  for (const [id] of keepsakeButtons) elements[id].onclick = () => {
    returnToMenu = !itemMenu.hidden
    activate(id)
  }
  elements.seat.onclick = () => activate("seat")
  elements.left.onclick = () => changeView(targetAzimuth - .24, targetElevation)
  elements.right.onclick = () => changeView(targetAzimuth + .24, targetElevation)
  elements.reset.onclick = () => changeView(START_ANGLE, START_HEIGHT)
  for (const [menu, button] of menus) button.onclick = () => toggleMenu(menu)
  for (const button of roomMenu.querySelectorAll("button")) button.onclick = () => goTo(button.dataset.view)
  for (const [period, button] of periodButtons) button.onclick = () => {
    preferences.period = period
    savePreferences()
  }
  for (const [level, button] of qualityButtons) button.onclick = () => {
    preferences.quality = level
    savePreferences()
    // Back to auto measures afresh, starting from what the adapter suggests.
    if (level === "auto") {
      autoQuality = startingQuality(adapter,
        { cores: navigator.hardwareConcurrency || 4, narrow: matchMedia("(max-width: 575px)").matches })
      autoSource = "adapter"
      probeTried = []
      startProbe()
    } else probe = null
    applyQuality()
  }
  const observer = new ResizeObserver(([entry]) => {
    viewportWidth = entry.contentRect.width
    viewportHeight = entry.contentRect.height
    resize()
  })
  observer.observe(stage)
  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault()
    closeKeepsake()
    pages.reveal(0, 0, false)
    showThread(0)
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
    scene.environment = makeEnvironment()
    applyQuality(quality)
    stage.hidden = controls.hidden = false
    fallback.hidden = true
    invalidate()
  })
  applyQuality()
  syncControls()
  goTo(savedCamera?.view || "overview")
  viewMotion = null
  controls.hidden = false
}
