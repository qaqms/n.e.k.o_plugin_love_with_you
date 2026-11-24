// The two-storey cottage (redesign option A2), as data: rooms, walls, furniture placeholders and slots.
// Step 2 draws it as a gray-box model (tools/preview/cottage-blockout.mjs); step 3 builds the real rooms
// from the same data. Units match the 0.9.25 living room: the existing furniture keeps its coordinates.
// Every box is { at: [x, y, z] centre, size: [w, h, d] }. The front of the house faces +z (open until 0.9.59; walled since 0.9.60, cut away in view).

export const STOREYS = [
  { id: 0, y: 0, height: 3.4, name: "一楼" },
  { id: 1, y: 3.4, height: 3.0, name: "二楼" },
]

export const ROOMS = [
  { id: "living", storey: 0, name: "客厅", x: [-3.25, 3.25], z: [-2.65, 2.65] },
  { id: "kitchen", storey: 0, name: "厨房", x: [3.25, 7], z: [-2.65, 2.65] },
  { id: "porch", storey: 0, name: "门廊小院", x: [7, 10], z: [-1.2, 2.65], outdoor: true, deck: .2 },
  { id: "bedroom", storey: 1, name: "卧室", x: [-3.25, 1.5], z: [-2.65, 2.65] },
  { id: "study", storey: 1, name: "阁楼书房", x: [1.5, 7], z: [-2.65, 2.65] },
]

// Walls run along one axis at a fixed coordinate. Openings are [from, to, bottom, top] along the run and
// in world height; the drawing splits the wall around them. The front of the house faces +z.
export const WALLS = [
  { storey: 0, axis: "z", at: -2.65, from: -3.25, to: 7, openings: [[-2.64, .56, 1.15, 3.05, "window"]] },
  { storey: 0, axis: "x", at: -3.25, from: -2.65, to: 2.65, openings: [] },
  { storey: 0, axis: "x", at: 3.25, from: -2.65, to: 2.65, openings: [[1.2, 2.4, 0, 2.3, "door"]] },
  { storey: 0, axis: "x", at: 7, from: -2.65, to: 2.65, openings: [[1.4, 2.4, 0, 2.3, "door"]] },
  { storey: 1, axis: "z", at: -2.65, from: -3.25, to: 7, openings: [[-2.3, -.9, 4.6, 5.8, "window"]] },
  { storey: 1, axis: "x", at: -3.25, from: -2.65, to: 2.65, openings: [] },
  { storey: 1, axis: "x", at: 1.5, from: -2.65, to: 2.65, openings: [[.6, 1.6, 3.4, 5.6, "door"]] },
  { storey: 1, axis: "x", at: 7, from: -2.65, to: 2.65, openings: [[-1.2, .2, 4.6, 5.6, "window"]] },
  // The front (0.9.60): until then the house was open on this side like a dollhouse. Now it is closed, and the walls
  // in front of the camera are cut down instead (cottage-walls.mjs).
  { storey: 0, axis: "z", at: 2.65, from: -3.25, to: 7, openings: [[-2.3, -.7, 1, 2.45, "window"], [.4, 2.1, 1, 2.45, "window"],
    [4.1, 5.5, 1.05, 2.4, "window"]] },
  { storey: 1, axis: "z", at: 2.65, from: -3.25, to: 7, openings: [[-2.2, -.8, 4.5, 5.75, "window"], [3.4, 5.2, 4.5, 5.75, "window"]] },
]

// The stairs climb along the kitchen's right wall from the front to the study floor at the back.
export const STAIRS = { room: "kitchen", x: [6.1, 6.95], z: [-2.55, 1], rise: 3.4, hole: { x: [6.1, 6.95], z: [-2.55, -.3] } }

// Gray placeholders for large pieces that are not slots themselves.
export const FURNITURE = [
  { room: "living", name: "台灯", at: [.63, .8, -1.435], size: [.55, 1.6, .55] },
  { room: "living", name: "投影机", at: [2.21, .4, .85], size: [.5, .8, .4] },
  { room: "living", name: "绿植", at: [2.72, .65, .72], size: [.6, 1.3, .6] },
  { room: "kitchen", name: "冰箱", at: [3.75, .95, -2.2], size: [.8, 1.9, .7] },
  { room: "kitchen", name: "料理台", at: [5, .45, -2.25], size: [2, .9, .6] },
  { room: "kitchen", name: "餐桌", at: [4.9, .38, .7], size: [1.3, .75, .9] },
  { room: "bedroom", name: "床", at: [-1.6, 3.7, -1.45], size: [1.9, .6, 2.2] },
  { room: "study", name: "书桌", at: [3, 3.78, -2.2], size: [1.6, .76, .7] },
]

// kind: floor (stands on the floor), wall (hangs on `wall`), surface (sits on furniture).
// features lists the 0.9.25 interactions a slot already hosts; reserved slots carry an idea, not a promise.
export const SLOTS = [
  { id: "living-sofa", room: "living", kind: "floor", at: [-1.135, .65, -1.43], size: [2.8, 1.3, 1.2],
    name: "沙发", features: ["seat", "company"] },
  { id: "living-table", room: "living", kind: "floor", at: [-.51, .28, .45], size: [1.6, .56, 1.1],
    name: "茶几", features: ["notebook", "occasion"] },
  { id: "living-console", room: "living", kind: "floor", at: [2.08, .65, -1.99], size: [1.96, 1.3, .72],
    name: "唱机柜", features: ["record"] },
  { id: "living-picture", room: "living", kind: "wall", wall: "back", at: [1.99, 2.29, -2.5], size: [1.13, 1.35, .1],
    name: "相框", features: ["picture"] },
  { id: "living-calendar", room: "living", kind: "wall", wall: "back", at: [2.84, 2.7, -2.5], size: [.57, .74, .1],
    name: "日历", features: ["calendar"] },
  { id: "living-screen", room: "living", kind: "wall", wall: "back", at: [-.19, 2.5, -2.14], size: [2.75, 1.5, .15],
    name: "投影幕", features: ["projector"] },
  { id: "living-shelf", room: "living", kind: "wall", wall: "left", at: [-2.92, 1.65, -.36], size: [.45, 1, 1.5],
    name: "礼物架", features: ["shelf"] },
  { id: "living-wall-front", room: "living", kind: "wall", wall: "left", at: [-3.05, 1.9, 1.55], size: [.2, 1.2, 1.5],
    name: "左墙前段", idea: "照片墙、留言板" },
  { id: "living-corner", room: "living", kind: "floor", at: [-2.45, .5, 1.95], size: [1.1, 1, 1],
    name: "左前角", idea: "猫窝、立式钢琴、落地灯" },
  { id: "living-front-right", room: "living", kind: "floor", at: [1.6, .5, 2], size: [1, 1, .9],
    name: "右前角", idea: "季节装饰、圣诞树" },

  { id: "kitchen-fridge", room: "kitchen", kind: "surface", at: [3.75, 1.2, -1.82], size: [.7, 1.2, .06],
    name: "冰箱门", idea: "冰箱贴：约定、便利贴" },
  { id: "kitchen-counter", room: "kitchen", kind: "surface", at: [5, 1.05, -2.25], size: [1.8, .3, .5],
    name: "料理台面", idea: "一起做饭" },
  { id: "kitchen-cabinet", room: "kitchen", kind: "wall", wall: "back", at: [5.1, 2.2, -2.5], size: [1.6, .8, .1],
    name: "吊柜墙面", idea: "菜谱板、收藏的杯子" },
  { id: "kitchen-table", room: "kitchen", kind: "surface", at: [4.9, .91, .7], size: [1.2, .3, .8],
    name: "两人餐桌", idea: "一起吃饭、生日蛋糕" },

  { id: "porch-bench", room: "porch", kind: "floor", at: [8.5, .55, -.8], size: [1.6, .7, .55],
    name: "门廊长椅", idea: "一起看天气、季节" },
  { id: "porch-garden", room: "porch", kind: "floor", at: [8.7, .45, 1.7], size: [1.4, .5, .8],
    name: "小花圃", idea: "随相处天数生长的花" },
  { id: "porch-mailbox", room: "porch", kind: "floor", at: [9.6, .7, 2.3], size: [.35, 1, .35],
    name: "信箱", idea: "角色来信" },

  { id: "bedroom-bed", room: "bedroom", kind: "surface", at: [-1.6, 4.15, -1.45], size: [1.8, .3, 2.1],
    name: "床", idea: "晚安、作息" },
  { id: "bedroom-nightstand", room: "bedroom", kind: "floor", at: [-.25, 3.7, -2.2], size: [.5, .6, .45],
    name: "床头柜", idea: "闹钟、日记" },
  { id: "bedroom-wardrobe", room: "bedroom", kind: "floor", at: [-2.85, 4.4, 1.3], size: [.6, 2, 1.6],
    name: "衣柜", idea: "换装、立绘外观" },
  { id: "bedroom-wall", room: "bedroom", kind: "wall", wall: "left", at: [-3.05, 5, -.6], size: [.2, .9, 1.2],
    name: "左墙", idea: "合照" },
  { id: "bedroom-floor", room: "bedroom", kind: "floor", at: [0, 3.8, 1.8], size: [1, .8, 1],
    name: "右前角", idea: "梳妆台、摇椅" },

  { id: "study-desk", room: "study", kind: "surface", at: [3, 4.36, -2.2], size: [1.4, .4, .6],
    name: "书桌电脑", idea: "同行游戏入口" },
  { id: "study-bookshelf", room: "study", kind: "floor", at: [4.8, 4.3, -2.35], size: [1.4, 1.8, .4],
    name: "书架", idea: "回忆相册" },
  { id: "study-board", room: "study", kind: "wall", wall: "back", at: [3, 5.1, -2.5], size: [1.3, .8, .1],
    name: "软木板", idea: "目标、清单" },
  { id: "study-telescope", room: "study", kind: "floor", at: [3.2, 4, 1.8], size: [.8, 1.2, .8],
    name: "望远镜", idea: "星空、夜晚活动" },
  { id: "study-floor", room: "study", kind: "floor", at: [4.6, 3.8, 1.4], size: [1.2, .8, 1.2],
    name: "地面空位", idea: "懒人沙发、猫爬架" },
]

// The interactions shipped in 0.9.25; each must keep exactly one home in the new house.
export const EXISTING_FEATURES = ["seat", "company", "notebook", "occasion", "record", "picture", "calendar", "projector", "shelf"]

export function room(id) {
  return ROOMS.find(item => item.id === id)
}

export function storeyOf(roomId) {
  return STOREYS[room(roomId).storey]
}

export function bounds({ at, size }) {
  return at.map((value, axis) => [value - size[axis] / 2, value + size[axis] / 2])
}

export function overlaps(a, b) {
  const first = bounds(a)
  const second = bounds(b)
  return first.every(([low, high], axis) => low < second[axis][1] - 1e-6 && second[axis][0] < high - 1e-6)
}

// Splits a wall into solid boxes around its openings.
export function wallPieces(wall, thickness = .18) {
  const storey = STOREYS[wall.storey]
  const bottom = storey.y
  const top = storey.y + storey.height
  const pieces = []
  const add = (from, to, low, high) => {
    if (to - from < 1e-3 || high - low < 1e-3) return
    const along = (from + to) / 2
    const size = to - from
    pieces.push(wall.axis === "z"
      ? { at: [along, (low + high) / 2, wall.at], size: [size, high - low, thickness] }
      : { at: [wall.at, (low + high) / 2, along], size: [thickness, high - low, size] })
  }
  let cursor = wall.from
  for (const [from, to, low, high] of [...wall.openings].sort((a, b) => a[0] - b[0])) {
    add(cursor, from, bottom, top)
    add(from, to, bottom, low)
    add(from, to, high, top)
    cursor = to
  }
  add(cursor, wall.to, bottom, top)
  return pieces
}
