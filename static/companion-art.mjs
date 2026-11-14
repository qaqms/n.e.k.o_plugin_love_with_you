// Default companion sprite after the host's YUI: blue-black twin tails, black cat ears with white fur,
// a black tail with a sky-blue ribbon, a white capelet with a star clasp and a small white cat on her head.
// Frames keep the 64x72 size and foot anchor of actor-art.mjs, so atlas layout and physics stay unchanged.
// SVG strings stay ASCII because the scene loads them through btoa().
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="72" viewBox="0 0 64 72">${body}</svg>`
const n = value => +value.toFixed(2)

const C = {
  line: "#1d2033", hair: "#272c45", hairDark: "#191c2e", shine: "#62729f",
  fur: "#f7f3ef", skin: "#fbe7d8", skinShade: "#efcbb7", blush: "#f49aa3", lash: "#1b1f36",
  white: "#f5f3ef", whiteShade: "#cdd7e4", navy: "#30395b", navyLight: "#4f5d8b",
  sky: "#5bb8da", skyLight: "#b3e6f5", boot: "#8b6a4e", bootDark: "#59422f", wood: "#7b5b3f",
}

// Four-point star, the host's brand mark: clasp, staff gem and shield emblem.
function star(x, y, r, fill, stroke = "none") {
  const k = r * .3
  return `<path d="M${n(x)} ${n(y - r)}L${n(x + k)} ${n(y - k)}L${n(x + r)} ${n(y)}L${n(x + k)} ${n(y + k)}L${n(x)} ${n(y + r)}L${n(x - k)} ${n(y + k)}L${n(x - r)} ${n(y)}L${n(x - k)} ${n(y - k)}Z" fill="${fill}" stroke="${stroke}" stroke-width=".6"/>`
}
// Outlined tube: a dark rim stroke under the fill stroke.
const tube = (d, width, fill) => `<path d="${d}" fill="none" stroke="${C.line}" stroke-width="${n(width + 1.7)}" stroke-linecap="round"/>`
  + `<path d="${d}" fill="none" stroke="${fill}" stroke-width="${n(width)}" stroke-linecap="round"/>`

function tail(p, x, y, out) {
  const sway = p.tailSway, lift = p.cast ? -5 : 0, width = p.hurt ? 4.6 : 3.4
  const d = `M${n(x)} ${n(y)}Q${n(x + out * 12)} ${n(y + 3)} ${n(x + out * 14 + sway)} ${n(y - 8 + lift)}T${n(x + out * 10 + sway * 1.7)} ${n(y - 19 + lift)}`
  return tube(d, width, C.hair)
    + `<path d="M${n(x + out * 3)} ${n(y - 2.2)}L${n(x + out * 6)} ${n(y - 4)}L${n(x + out * 5.2)} ${n(y + .6)}ZM${n(x + out * 3)} ${n(y - 2.2)}L${n(x + out * .8)} ${n(y - 4.6)}L${n(x + out * .4)} ${n(y + .2)}Z" fill="${C.sky}" stroke="${C.line}" stroke-width=".6"/>`
}

function twinTail(s, sway) {
  const x = (v, d = 0) => n(32 + s * v + d)
  return `<path d="M${x(9)} 18Q${x(22)} 27 ${x(19.5, sway)} 44Q${x(18.5, sway)} 52 ${x(15.5, sway)} 58.5Q${x(13.5, sway)} 50 ${x(12.5)} 41Q${x(11)} 31 ${x(7)} 24Z" fill="${C.hair}" stroke="${C.line}" stroke-width="1"/>`
    + `<path d="M${x(13.5)} 25Q${x(17.5)} 33 ${x(16.8, sway)} 46" stroke="${C.shine}" stroke-width="1" fill="none" opacity=".75"/>`
}

const bow = (x, y, s) => `<path d="M${n(x)} ${y}L${n(x + s * 4.2)} ${y - 3.2}L${n(x + s * 4)} ${y + 2.6}ZM${n(x)} ${y}L${n(x - s * 2.8)} ${y - 3.4}L${n(x - s * 3.2)} ${y + 2}Z" fill="${C.white}" stroke="${C.line}" stroke-width=".7"/>`

function ear(x, y, s, p, inner = true) {
  // s points outward; hurt flattens the ears sideways.
  const tilt = p.hurt ? s * 28 : p.flick && s > 0 ? 12 : 0
  return `<g transform="rotate(${tilt} ${n(x)} ${y})"><path d="M${n(x - s * 4)} ${y + 1}L${n(x + s * 1.5)} ${y - 12}L${n(x + s * 6)} ${y + 3}Z" fill="${C.hair}" stroke="${C.line}" stroke-width="1" stroke-linejoin="round"/>`
    + (inner ? `<path d="M${n(x - s * 1.6)} ${y + .6}L${n(x + s * 1.4)} ${y - 7.6}L${n(x + s * 3.8)} ${y + 1.6}Z" fill="${C.fur}"/>` : "") + "</g>"
}

function headCat(x, back = false) {
  return `<path d="M${x - 5} 12.6Q${x - 5.2} 7.4 ${x} 7.2Q${x + 5.2} 7.4 ${x + 5} 12.6Z" fill="${C.white}" stroke="${C.line}" stroke-width=".8"/>`
    + `<path d="M${x - 4.3} 9.4L${x - 3.6} 5.6L${x - 1.4} 7.6ZM${x + 4.3} 9.4L${x + 3.6} 5.6L${x + 1.4} 7.6Z" fill="${C.white}" stroke="${C.line}" stroke-width=".7" stroke-linejoin="round"/>`
    + (back ? `<path d="M${x + 4} 11.6Q${x + 7.5} 11 ${x + 7} 8" stroke="${C.white}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`
      : `<path d="M${x - 2.4} 10.2Q${x - 1.7} 9.5 ${x - 1} 10.2M${x + 1} 10.2Q${x + 1.7} 9.5 ${x + 2.4} 10.2" stroke="${C.lash}" stroke-width=".55" fill="none"/>`
        + `<path d="M${x + 4.6} 9.6L${x + 7} 8L${x + 6.8} 11.2Z" fill="${C.sky}" stroke="${C.line}" stroke-width=".5"/>`)
}

function eye(x, y, p, narrow = 1) {
  if (p.hurt) return `<path d="M${n(x - 2.2)} ${y - 1.6}L${n(x + 1.6)} ${y}L${n(x - 2.2)} ${y + 1.6}" stroke="${C.lash}" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round" transform="${x > 32 ? `translate(${n(2 * x)} 0) scale(-1 1)` : ""}"/>`
  const rx = n(2.3 * narrow), top = p.cast ? .7 : 0
  return `<ellipse cx="${x}" cy="${y + .3}" rx="${rx}" ry="${n(3 - top / 2)}" fill="url(#iris)"/>`
    + `<path d="M${n(x - rx - .8)} ${n(y - 2.1 + top)}Q${x} ${n(y - 3.9 + top)} ${n(x + rx + .8)} ${n(y - 2.1 + top)}" stroke="${C.lash}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`
    + `<circle cx="${n(x - rx * .35)}" cy="${n(y - .9 + top / 2)}" r=".95" fill="#fff"/><circle cx="${n(x + rx * .4)}" cy="${y + 1.6}" r=".45" fill="#e8f7ff"/>`
}

const mouth = (x, p) => p.hurt
  ? `<path d="M${x - 1.2} 33.4Q${x - .4} 32.6 ${x + .4} 33.4Q${x + 1} 34 ${x + 1.4} 33.3" stroke="#9a5f62" stroke-width=".7" fill="none"/>`
  : `<path d="M${x - 1.5} 32.7Q${x - .75} 33.6 ${x} 32.8Q${x + .75} 33.6 ${x + 1.5} 32.7" stroke="#9a5f62" stroke-width=".7" fill="none" stroke-linecap="round"/>`

function weapon(p, x, y) {
  if (p.kind === "mage") {
    const glow = p.cast ? `<circle cx="${n(x + 2)}" cy="${n(y - 22)}" r="${n(6.5 + p.glow * 2)}" fill="${C.skyLight}" opacity="${n(.28 + p.glow * .22)}"/>` : ""
    return `<path d="M${n(x + 2)} ${n(y - 18)}L${n(x - .6)} ${n(y + 13)}" stroke="${C.line}" stroke-width="3.6" stroke-linecap="round"/>`
      + `<path d="M${n(x + 2)} ${n(y - 18)}L${n(x - .6)} ${n(y + 13)}" stroke="${C.wood}" stroke-width="2.1" stroke-linecap="round"/>`
      + `<path d="M${n(x - 1)} ${n(y - 19)}Q${n(x + 2)} ${n(y - 15)} ${n(x + 5)} ${n(y - 19)}" stroke="#c9a96b" stroke-width="1.3" fill="none"/>`
      + glow + star(x + 2, y - 22.5, 5.4, C.sky, C.line) + star(x + 2, y - 22.5, 2.2, C.skyLight)
  }
  return `<path d="M${n(x + 1.4)} ${n(y - 21)}L${n(x + 2.8)} ${n(y - 18.5)}L${n(x + 1.6)} ${n(y - 2.5)}L${n(x - .2)} ${n(y - 2.5)}L${n(x - .2)} ${n(y - 18.5)}Z" fill="url(#metal)" stroke="${C.line}" stroke-width=".8"/>`
    + `<path d="M${n(x + 1.3)} ${n(y - 18)}L${n(x + .9)} ${n(y - 4)}" stroke="#fbfcf2" stroke-width=".6"/>`
    + `<path d="M${n(x - 3.2)} ${n(y - 2.2)}L${n(x + 4.8)} ${n(y - 2.2)}" stroke="#c9a96b" stroke-width="1.8" stroke-linecap="round"/>`
    + `<path d="M${n(x + .7)} ${n(y - 1)}L${n(x + .7)} ${n(y + 3)}" stroke="${C.navy}" stroke-width="2"/>`
}

const shield = (x, y) => `<circle cx="${x}" cy="${y}" r="5.4" fill="${C.navy}" stroke="${C.line}" stroke-width="1"/><circle cx="${x}" cy="${y}" r="4.3" fill="none" stroke="${C.white}" stroke-width=".9"/>${star(x, y, 2.8, C.sky)}`

function legs(p, side) {
  const leg = (x, dy, dx = 0) => `<path d="M${n(x + dx)} 54L${n(x + dx + 5)} 54L${n(x + dx + 4.6)} ${n(61.5 + dy)}L${n(x + dx + .5)} ${n(61.5 + dy)}Z" fill="${C.white}" stroke="${C.line}" stroke-width=".9"/>`
    + `<path d="M${n(x + dx + .2)} ${n(61 + dy)}L${n(x + dx + 4.9)} ${n(61 + dy)}L${n(x + dx + 5.6)} ${n(65.2 + dy)}Q${n(x + dx + 2.5)} ${n(66.8 + dy)} ${n(x + dx - .6)} ${n(65.2 + dy)}Z" fill="${C.boot}" stroke="${C.bootDark}" stroke-width=".9"/>`
  return side ? leg(26.5, 0, p.step) + leg(32.5, 0, -p.step) : leg(26, p.step) + leg(33, -p.step)
}

function skirt(p, shift = 0) {
  const swing = p.step / 3
  return `<path d="M${23 + shift} 47L${41 + shift} 47L${n(45.5 + shift + swing)} 56.5Q${32 + shift} 60.5 ${n(18.5 + shift + swing)} 56.5Z" fill="${C.navy}" stroke="${C.line}" stroke-width="1"/>`
    + `<path d="M${n(20 + shift + swing)} 55.6Q${32 + shift} 59 ${n(44 + shift + swing)} 55.6" stroke="${C.navyLight}" stroke-width="1" fill="none"/>`
    + `<path d="M${28 + shift} 48.5L${n(26 + shift + swing)} 57.5M${36 + shift} 48.5L${n(38 + shift + swing)} 57.5" stroke="#252c48" stroke-width=".7"/>`
}

function torso(p, back, shift = 0) {
  const x = v => n(v + shift)
  const body = `<path d="M${x(25)} 36L${x(39)} 36L${x(41)} 48L${x(23)} 48Z" fill="${C.white}" stroke="${C.line}" stroke-width=".9"/>`
  const vest = back ? "" : `<path d="M${x(26.5)} 40.5L${x(37.5)} 40.5L${x(38.5)} 48.5L${x(25.5)} 48.5Z" fill="${C.navy}" stroke="${C.line}" stroke-width=".8"/>`
    + `<path d="M${x(30.6)} 42L${x(33.4)} 43.6L${x(30.6)} 45.2L${x(33.4)} 46.8" stroke="${C.skyLight}" stroke-width=".6" fill="none"/>`
  const cape = back
    ? `<path d="M${x(20.5)} 40Q${x(21.5)} 34 ${x(32)} 33Q${x(42.5)} 34 ${x(43.5)} 40L${x(43.5)} 45Q${x(32)} 48 ${x(20.5)} 45Z" fill="${C.white}" stroke="${C.line}" stroke-width="1"/>`
      + `<path d="M${x(32)} 35L${x(32)} 46.5M${x(26)} 39.5Q${x(25)} 43 ${x(25.5)} 46M${x(38)} 39.5Q${x(39)} 43 ${x(38.5)} 46" stroke="${C.whiteShade}" stroke-width=".8" fill="none"/>`
    : `<path d="M${x(20.5)} 39.5Q${x(21.5)} 34 ${x(32)} 33Q${x(42.5)} 34 ${x(43.5)} 39.5Q${x(43.5)} 44.5 ${x(39.5)} 44.5L${x(32)} 41.5L${x(24.5)} 44.5Q${x(20.5)} 44.5 ${x(20.5)} 39.5Z" fill="${C.white}" stroke="${C.line}" stroke-width="1"/>`
      + `<path d="M${x(21.4)} 41.2Q${x(22)} 44 ${x(24.6)} 43.8L${x(32)} 40.9L${x(39.4)} 43.8Q${x(42)} 44 ${x(42.6)} 41.2" stroke="${C.sky}" stroke-width="1.3" fill="none"/>`
      + `<path d="M${x(28.5)} 35Q${x(32)} 37.2 ${x(35.5)} 35" stroke="${C.whiteShade}" stroke-width=".8" fill="none"/>`
      + star(32 + shift, 37, 2.6, C.sky, C.line)
  return body + vest + cape
}

function arm(x, y, s, angle, body = "") {
  return `<g transform="rotate(${n(angle)} ${x} ${y})"><path d="M${x} ${y - 1}Q${n(x + s * 4)} ${y} ${n(x + s * 3.5)} ${y + 6}L${n(x + s * 2.5)} ${y + 9}L${n(x - s * 1.5)} ${y + 8.5}L${n(x - s * 2.5)} ${y + 2}Z" fill="${C.white}" stroke="${C.line}" stroke-width=".9"/>`
    + `<circle cx="${n(x + s * 1.2)}" cy="${y + 9.4}" r="1.9" fill="${C.skin}" stroke="${C.line}" stroke-width=".7"/>${body}</g>`
}

function front(p) {
  const hs = p.hairSway
  const hand = p.kind === "mage" ? weapon(p, 43.4, 47.4) : weapon(p, 43.6, 47.4)
  return tail(p, 37, 52, 1) + twinTail(-1, hs) + twinTail(1, hs)
    + legs(p) + skirt(p) + torso(p)
    + arm(24, 38, -1, -p.step * 3, p.kind === "mage" ? "" : shield(20.4, 47))
    + arm(40, 38, 1, p.arm, hand)
    + ear(22.5, 15, -1, p) + ear(41.5, 15, 1, p)
    + `<path d="M18.5 27Q16.5 11 32 10Q47.5 11 45.5 27Q45.5 35 43 38.5L21 38.5Q18.5 35 18.5 27Z" fill="${C.hair}" stroke="${C.line}" stroke-width="1"/>`
    + `<path d="M20.6 21Q20.2 33 27 35.9Q32 37.6 37 35.9Q43.8 33 43.4 21Z" fill="${C.skin}" stroke="${C.line}" stroke-width=".8"/>`
    + eye(27, 28.4, p) + eye(37, 28.4, p)
    + `<ellipse cx="24.4" cy="32" rx="2" ry="1" fill="${C.blush}" opacity=".55"/><ellipse cx="39.6" cy="32" rx="2" ry="1" fill="${C.blush}" opacity=".55"/>`
    + mouth(32, p)
    + `<path d="M19.6 24Q18.6 12.4 32 11.4Q45.4 12.4 44.4 24L41.4 23.2L40.2 25.2L37.4 23.6L35.2 25.2L32 23.6L28.8 25.2L26.6 23.6L23.8 25.2L22.6 23.2Z" fill="${C.hair}" stroke="${C.line}" stroke-width=".9" stroke-linejoin="round"/>`
    + `<path d="M20 22.5Q18.6 30 20.6 37.6L22.8 36Q21.8 29.5 23.2 23.4ZM44 22.5Q45.4 30 43.4 37.6L41.2 36Q42.2 29.5 40.8 23.4Z" fill="${C.hair}" stroke="${C.line}" stroke-width=".8"/>`
    + `<path d="M23.4 16.4Q27 14 31 14M34.6 14.2Q38.4 14.4 41 16.8" stroke="${C.shine}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`
    + `<path d="M21 17.6Q32 11 43 17.6" stroke="${C.white}" stroke-width="1.5" fill="none"/>`
    + `<rect x="38.4" y="18.4" width="3.6" height="2.8" rx=".7" fill="${C.sky}" stroke="${C.white}" stroke-width=".5"/>`
    + bow(18.6, 20, -1) + bow(45.4, 20, 1) + headCat(32)
}

function behind(p) {
  const hs = p.hairSway
  return legs(p) + skirt(p)
    + arm(24, 38, -1, -p.step * 3, p.kind === "mage" ? "" : shield(19.6, 47))
    + arm(40, 38, 1, p.arm, weapon(p, 43.4, 47.4))
    + torso(p, true) + tail(p, 32, 50, 1)
    + ear(22.5, 15, -1, p, false) + ear(41.5, 15, 1, p, false)
    + `<path d="M18.5 26Q16.5 10 32 9.4Q47.5 10 45.5 26Q45.5 36 41 38.6L23 38.6Q18.5 36 18.5 26Z" fill="${C.hair}" stroke="${C.line}" stroke-width="1"/>`
    + `<path d="M24 14.6Q32 10.6 40 14.6M22.4 24Q24 30 23.4 35M41.6 24Q40 30 40.6 35" stroke="${C.shine}" stroke-width="1.1" fill="none" stroke-linecap="round" opacity=".85"/>`
    + twinTail(-1, hs) + twinTail(1, hs)
    + bow(18.6, 20, -1) + bow(45.4, 20, 1) + headCat(32, true)
}

function profile(p) {
  // Three-quarter view facing right; the left direction mirrors it.
  const hs = p.hairSway
  const hand = weapon(p, 44.6, 47.4)
  return tail(p, 27, 51, -1) + twinTail(1, hs * .6)
    + legs(p, true) + skirt(p, .5) + torso(p, false, 1)
    + arm(25, 38, -1, -p.step * 3 - 6, p.kind === "mage" ? "" : shield(21, 46.6))
    + ear(24, 15, -1, p, false) + ear(41.5, 14.6, 1, p)
    + `<path d="M18 27Q16.5 11 31.5 10Q47.5 11 46 27Q46 35 43.5 38.5L21 38.5Q18 35 18 27Z" fill="${C.hair}" stroke="${C.line}" stroke-width="1"/>`
    + `<path d="M24.2 21Q23.8 33 30 35.9Q35 37.5 39.4 35.4Q45.4 32.4 45.2 21Z" fill="${C.skin}" stroke="${C.line}" stroke-width=".8"/>`
    + eye(31.4, 28.4, p) + eye(40.6, 28.4, p, .72)
    + `<ellipse cx="28.6" cy="32" rx="1.9" ry="1" fill="${C.blush}" opacity=".55"/><ellipse cx="43" cy="31.6" rx="1.2" ry=".9" fill="${C.blush}" opacity=".5"/>`
    + mouth(36.6, p)
    + `<path d="M21.6 24Q20.6 12.4 33 11.4Q46.4 12.4 45.6 24L43 23.2L41.8 25.2L39.2 23.6L37 25.2L34 23.6L31 25.2L28.6 23.4L26.4 25.6L24.2 22.8Z" fill="${C.hair}" stroke="${C.line}" stroke-width=".9" stroke-linejoin="round"/>`
    + `<path d="M21.8 22.5Q19.8 30 21.8 37.6L24.4 36Q23.4 29.5 25 23.4Z" fill="${C.hair}" stroke="${C.line}" stroke-width=".8"/>`
    + `<path d="M25 16.2Q29 13.8 33 13.9M36.4 14.2Q40 14.6 42.4 17" stroke="${C.shine}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`
    + `<path d="M23 17.2Q33.5 11 44 17.8" stroke="${C.white}" stroke-width="1.5" fill="none"/>`
    + twinTail(-1, hs * 1.2) + bow(19, 20, -1) + headCat(33.5)
    + arm(40.5, 38, 1, p.arm - 8, hand)
}

export function companionSprite(kind, direction, pose, frame, count) {
  const phase = frame / count * Math.PI * 2, walk = pose === "walk", hurt = pose === "hurt", cast = pose === "cast"
  const step = walk ? Math.sin(phase) * 2.6 : 0
  const p = {
    kind, hurt, cast, step,
    bob: walk ? -Math.abs(Math.sin(phase)) * 1.3 : pose === "idle" ? Math.sin(phase) * .5 : 0,
    hairSway: walk ? -Math.sin(phase) * 1.5 : Math.sin(phase) * .5,
    tailSway: walk ? Math.sin(phase + 1) * 3 : Math.sin(phase) * 2.2,
    arm: cast ? -35 + Math.sin(phase / 2) * -25 : step * 3,
    glow: cast ? Math.sin(phase / 2) : 0,
    flick: pose === "idle" && frame === 2,
  }
  const side = direction === "left" || direction === "right"
  const art = direction === "up" ? behind(p) : side ? profile(p) : front(p)
  return svg(`<defs><linearGradient id="iris" x2="0" y2="1"><stop stop-color="#233d8c"/><stop offset=".55" stop-color="#3f78c9"/><stop offset="1" stop-color="#7cc8f4"/></linearGradient>
    <linearGradient id="metal" x2=".8" y2="1"><stop stop-color="#f2f4e6"/><stop offset=".5" stop-color="#a9c3cc"/><stop offset="1" stop-color="#5a6d7c"/></linearGradient></defs>
    <ellipse cx="32" cy="65" rx="15" ry="4.5" fill="#17232b" opacity=".27"/>
    <g ${direction === "left" ? 'transform="translate(64 0) scale(-1 1)"' : ""}>
    <g transform="translate(0 ${n(p.bob)}) rotate(${hurt ? frame ? -3 : 3 : 0} 32 52)">${art}</g></g>`)
}
