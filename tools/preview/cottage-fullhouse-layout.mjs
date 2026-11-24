// Draft (2026-11-24, docs/plans/cottage-full-house-proposal-2026-11-24.md): the cottage as a whole house. The open
// front (z = 2.65) becomes an inside wall with doors, and a new row of rooms goes in front of it, to a new front wall
// at z = 7.15 (4.5 m deep), reaching on past the kitchen in front of the porch (x to 10). Dev-only gray box data for tools/preview/cottage-fullhouse-blockout.mjs; the shipped cottage still
// reads static/cottage-layout.mjs. Same units and conventions: openings are [from, to, bottom, top, kind].
import { FURNITURE as OLD_FURNITURE, ROOMS as OLD_ROOMS, STAIRS, STOREYS, WALLS as OLD_WALLS } from "./cottage-layout.mjs"

export { STAIRS, STOREYS }
export const FRONT = [2.65, 7.15]
const [MID, FACE] = FRONT
const UP = STOREYS[1].y
// The new row runs the whole width, in front of the porch too.
export const WIDTH = [-3.25, 10]
const [LEFT, RIGHT] = WIDTH

export const NEW_ROOMS = [
  { id: "storage", storey: 0, name: "储物间", x: [LEFT, -.5], z: FRONT },
  { id: "bath", storey: 0, name: "浴室", x: [-.5, 2.5], z: FRONT },
  { id: "entry", storey: 0, name: "玄关", x: [2.5, 5.5], z: FRONT },
  { id: "laundry", storey: 0, name: "洗衣间", x: [5.5, RIGHT], z: FRONT },
  { id: "closet", storey: 1, name: "衣帽间", x: [LEFT, -.25], z: FRONT },
  // A covered balcony: open at the front, with a railing.
  { id: "balcony", storey: 1, name: "小阳台", x: [-.25, 3.25], z: FRONT, open: true },
  { id: "studio", storey: 1, name: "画室", x: [3.25, RIGHT], z: FRONT },
]
export const ROOMS = [...OLD_ROOMS, ...NEW_ROOMS]

export const NEW_WALLS = [
  // The old open front, now inside: doors into the new row. Past the kitchen (x 7 to 10) it is the porch's side of the
  // laundry, with a door out to the porch.
  { storey: 0, axis: "z", at: MID, from: LEFT, to: RIGHT, openings: [
    [-2.1, -1.3, 0, 2.2, "door"], [2.6, 3.2, 0, 2.2, "door"], [3.7, 4.5, 0, 2.2, "door"], [5.8, 6.6, 0, 2.2, "door"],
    [8.1, 8.9, 0, 2.2, "door"]] },
  { storey: 1, axis: "z", at: MID, from: LEFT, to: RIGHT, openings: [
    [-2.2, -1.4, UP, UP + 2.2, "door"], [.1, 1.4, UP, UP + 2.3, "glass door"], [4, 4.8, UP, UP + 2.2, "door"],
    [7.8, 9.2, UP + 1, UP + 2.3, "window"]] },
  // Between the new rooms.
  { storey: 0, axis: "x", at: -.5, from: MID, to: FACE, openings: [] },
  { storey: 0, axis: "x", at: 2.5, from: MID, to: FACE, openings: [[4.6, 5.4, 0, 2.2, "door"]] },
  { storey: 0, axis: "x", at: 5.5, from: MID, to: FACE, openings: [] },
  { storey: 1, axis: "x", at: -.25, from: MID, to: FACE, openings: [] },
  { storey: 1, axis: "x", at: 3.25, from: MID, to: FACE, openings: [] },
  // The ends of the house, carried on to the new front.
  { storey: 0, axis: "x", at: LEFT, from: MID, to: FACE, openings: [[4.3, 5.4, 1.2, 2.3, "window"]] },
  { storey: 1, axis: "x", at: LEFT, from: MID, to: FACE, openings: [[4.2, 5.6, UP + 1.1, UP + 2.4, "window"]] },
  { storey: 0, axis: "x", at: RIGHT, from: MID, to: FACE, openings: [[4.3, 5.5, 1.1, 2.3, "window"]] },
  { storey: 1, axis: "x", at: RIGHT, from: MID, to: FACE, openings: [[4, 5.8, UP + 1.1, UP + 2.4, "window"]] },
  // The new front: the front door into the hall, windows; upstairs the balcony is left open (a railing instead).
  { storey: 0, axis: "z", at: FACE, from: LEFT, to: RIGHT, openings: [
    [-2.4, -1.3, 1.5, 2.4, "window"], [.4, 1.6, 1.4, 2.4, "window"], [3.55, 4.45, 0, 2.3, "front door"],
    [6.6, 8.6, 1.1, 2.4, "window"]] },
  { storey: 1, axis: "z", at: FACE, from: LEFT, to: -.25, openings: [[-2.3, -1.1, UP + 1.1, UP + 2.4, "window"]] },
  { storey: 1, axis: "z", at: FACE, from: 3.25, to: RIGHT, openings: [[4.2, 6.2, UP + .9, UP + 2.5, "window"], [7.4, 9.2, UP + .9, UP + 2.5, "window"]] },
]
export const WALLS = [...OLD_WALLS, ...NEW_WALLS]

// The balcony's railing along the open front.
export const RAILING = { x: [-.25, 3.25], z: FACE, y: UP, height: .95 }

const floor = (storey, height) => storey ? UP + height / 2 : height / 2
export const NEW_FURNITURE = [
  { room: "storage", name: "杂物架", at: [-3, floor(0, 1.8), 4.6], size: [.45, 1.8, 2.4] },
  { room: "storage", name: "箱子", at: [-1.4, floor(0, .5), 6.6], size: [.9, .5, .6] },
  { room: "storage", name: "旧自行车", at: [-1.2, floor(0, 1), 4.2], size: [.4, 1, 1.6] },
  { room: "bath", name: "浴缸", at: [1.6, floor(0, .6), 6.7], size: [1.6, .6, .75] },
  { room: "bath", name: "洗手台", at: [-.2, floor(0, .9), 3.6], size: [.5, .9, .9] },
  { room: "bath", name: "马桶", at: [-.15, floor(0, .75), 6.4], size: [.55, .75, .45] },
  { room: "entry", name: "鞋柜", at: [5.2, floor(0, 1), 5.9], size: [.5, 1, 1.5] },
  { room: "entry", name: "衣帽架", at: [2.8, floor(0, 1.8), 6.7], size: [.4, 1.8, .4] },
  { room: "entry", name: "地垫", at: [4, floor(0, .03), 6.7], size: [1, .03, .6] },
  { room: "entry", name: "长凳", at: [5.2, floor(0, .45), 4.1], size: [.45, .45, 1.2] },
  { room: "laundry", name: "洗衣机", at: [9.5, floor(0, .9), 6.7], size: [.65, .9, .6] },
  { room: "laundry", name: "烘干机", at: [8.8, floor(0, .9), 6.7], size: [.65, .9, .6] },
  { room: "laundry", name: "晾衣架", at: [7.2, floor(0, 1.4), 4.6], size: [1.6, 1.4, .5] },
  { room: "laundry", name: "水槽", at: [9.7, floor(0, .9), 4.4], size: [.55, .9, 1] },
  { room: "closet", name: "衣柜", at: [-2.95, floor(1, 2), 4.9], size: [.6, 2, 3] },
  { room: "closet", name: "梳妆台", at: [-.75, floor(1, .8), 6.75], size: [.9, .8, .45] },
  { room: "closet", name: "穿衣镜", at: [-.45, floor(1, 1.7), 3.6], size: [.4, 1.7, .08] },
  { room: "balcony", name: "小桌椅", at: [1.8, floor(1, .7), 5.6], size: [1.2, .7, .8] },
  { room: "balcony", name: "盆栽", at: [0, floor(1, .9), 6.7], size: [.5, .9, .5] },
  { room: "balcony", name: "躺椅", at: [.4, floor(1, .5), 4], size: [.7, .5, 1.6] },
  { room: "studio", name: "画架", at: [4.5, floor(1, 1.6), 5.2], size: [.7, 1.6, .6] },
  { room: "studio", name: "画桌", at: [9.4, floor(1, .75), 5.4], size: [.9, .75, 1.6] },
  { room: "studio", name: "单人沙发", at: [3.8, floor(1, .8), 6.5], size: [.8, .8, .75] },
  { room: "studio", name: "画具柜", at: [7, floor(1, 1.4), 3], size: [1.6, 1.4, .5] },
]
export const FURNITURE = [...OLD_FURNITURE, ...NEW_FURNITURE]

// The whole house, for framing the overview.
export const HOUSE = { x: WIDTH, y: [0, 8.8], z: [-2.65, FACE] }

// Where a stand-in for Yui stands (to show her outline through what is in front of her).
export const STAND_IN = { at: [4, 0, 5.4], height: 1.55 }
