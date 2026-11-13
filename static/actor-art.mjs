// Native sprite artwork, kept at the original frame size so physics stays unchanged.
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="72" viewBox="0 0 64 72">${body}</svg>`
export const FRAME_COUNTS = { idle: 4, walk: 6, cast: 4, hurt: 2 }
export const DIRECTIONS = ["down", "left", "right", "up"]

function actor(kind, direction, pose, frame, owner = "player") {
  const mage = kind === "mage", back = direction === "up", side = ["left", "right"].includes(direction)
  const companion = owner === "companion"
  const phase = frame / FRAME_COUNTS[pose] * Math.PI * 2
  const step = pose === "walk" ? Math.sin(phase) * 3 : 0
  const bob = pose === "walk" ? -Math.abs(Math.sin(phase)) * 1.2 : Math.sin(phase) * .4
  const arm = pose === "cast" ? -30 + Math.sin(phase / 2) * -25 : step * 3
  const hair = companion ? mage ? "#d5c4d6" : "#c7ba9b" : mage ? "#e9dfc9" : "#505465"
  const light = companion ? "#f1e6df" : mage ? "#fff3da" : "#818591"
  const coat = companion ? "#4c7189" : mage ? "#773e55" : "#437b7a"
  const edge = companion ? "#bbd6d3" : mage ? "#d8a995" : "#a6c3bd"
  const body = `
    <defs><linearGradient id="cloth" x2=".8" y2="1"><stop stop-color="${edge}"/><stop offset=".35" stop-color="${coat}"/><stop offset="1" stop-color="${mage ? "#452d43" : "#304c58"}"/></linearGradient>
    <linearGradient id="metal" x2=".8" y2="1"><stop stop-color="#eef0df"/><stop offset=".5" stop-color="#9db9bc"/><stop offset="1" stop-color="#546875"/></linearGradient></defs>
    <ellipse cx="32" cy="65" rx="17" ry="5" fill="#17232b" opacity=".27"/>
    <g ${direction === "left" ? 'transform="translate(64 0) scale(-1 1)"' : ""}>
    <path d="M22 48L29 49L28 ${65 + step}Q25 ${69 + step} 20 ${66 + step}Z" fill="#29303c" stroke="#1e2430"/>
    <path d="M35 49L42 48L44 ${66 - step}Q38 ${69 - step} 35 ${65 - step}Z" fill="#303444" stroke="#1e2430"/>
    <path d="M21 ${63 + step}L28 ${63 + step}M36 ${63 - step}L43 ${63 - step}" stroke="#ac9682" stroke-width="1.2"/>
    <g transform="translate(0 ${bob}) rotate(${pose === "hurt" ? frame ? -3 : 3 : 0} 32 50)">
    ${mage ? `<path d="M36 13Q54 12 48 37L54 44Q38 44 39 26Z" fill="${hair}" stroke="#6d6072" stroke-width="1.1"/>` : ""}
    <path d="M21 32Q31 28 43 33L${47 + step / 2} 59Q32 66 ${16 - step / 2} 59Z" fill="url(#cloth)" stroke="#293743" stroke-width="1.3"/>
    <path d="M21 35L16 56L23 54L29 36M42 35L48 57L40 56L35 36" fill="${mage ? "#ae7b83" : "#477b80"}" opacity=".7"/>
    ${back ? `<path d="M22 31L42 31L45 57L32 62L18 57Z" fill="${coat}"/><path d="M32 36L32 57M23 55L32 58L41 55" stroke="${edge}" fill="none" opacity=".6"/>`
      : `<path d="M28 34L36 34L39 58L25 58Z" fill="${mage ? "#e6d7bd" : "#b5c7c5"}"/>
      <path d="M29 34L32 48L35 34M26 55L38 55" stroke="${mage ? "#ac8669" : "#688f96"}" fill="none"/>
      ${mage ? '<path d="M24 37Q32 43 40 37M23 40Q32 46 41 40" stroke="#d6b39c" fill="none"/>'
        : '<path d="M23 33L19 40L27 43L31 34M40 33L45 40L37 43L33 34" fill="url(#metal)" stroke="#5a7179"/>'}
      <path d="M22 48L43 48L42 52L22 52Z" fill="#44383d"/><rect x="29" y="48" width="6" height="4" rx=".8" fill="#d4ba7d"/><rect x="31" y="49" width="2" height="2" fill="#665c4f"/>`}
    <g transform="rotate(${-step * 3} 22 37)">
      <path d="M22 34Q15 34 15 42L16 49L22 49L25 39Z" fill="${coat}" stroke="#35404b"/>
      <path d="M17 45L22 45L22 51Q18 54 16 50Z" fill="#e5c0a2"/>
      ${!mage && !back ? '<path d="M14 41L23 39L26 48L22 56L15 53Z" fill="#537d8b" stroke="#bdd3c9" stroke-width="1.2"/><path d="M18 43L21 51L23 44" stroke="#d1c58d" fill="none"/>' : ""}
    </g>
    <g transform="rotate(${arm} 41 37)">
      <path d="M40 34Q47 34 47 42L46 48L40 47L37 39Z" fill="${coat}" stroke="#35404b"/>
      <path d="M41 45L46 45L46 51Q42 54 40 50Z" fill="#e5c0a2"/>
      ${mage ? '<path d="M49 25L46 62" stroke="#4c3d46" stroke-width="3.3"/><path d="M48 28L46 59" stroke="#c3a78b" stroke-width="1.3"/><path d="M48 15L55 24L48 34L42 25Z" fill="#5fc8c5" stroke="#e2d6b4" stroke-width="1.2"/><path d="M48 18L51 24L47 29Z" fill="#c7f2df"/>'
        : '<path d="M48 20L51 25L49 49L45 49L46 25Z" fill="url(#metal)" stroke="#526572"/><path d="M48 27L47 46" stroke="#f4f5e3"/><path d="M42 48L53 49" stroke="#ceb777" stroke-width="2.4"/><path d="M47 50L47 56" stroke="#493f42" stroke-width="3"/>'}
    </g>
    <path d="M25 29L38 29L38 36L31 39L23 35Z" fill="${mage ? "#bca58c" : "#9e4557"}" stroke="${mage ? "#7b635a" : "#643c4d"}"/>
    ${!mage ? `<path d="M24 34L${13 - step} 41L20 41L15 47L28 36Z" fill="#ac5867"/>` : ""}
    <path d="M21 17Q32 9 43 18L41 30Q32 39 23 30Z" fill="#efd0af" stroke="#705e60" stroke-width=".8"/>
    <path d="M23 27Q32 34 41 27L39 32Q31 38 24 31Z" fill="#dcb89d" opacity=".5"/>
    ${!back ? `<path d="M26 25L29 25M36 25L39 25" stroke="${mage ? "#4b777c" : "#434e63"}" stroke-width="1.9" stroke-linecap="round"/>
    <path d="M27 24L28 24M37 24L38 24" stroke="#fff2de"/><path d="M31 30Q33 31 35 29" stroke="#a77974" fill="none" stroke-width=".7"/>
    ${side ? '<path d="M24 20L32 19L34 24L27 24Z" fill="#efd0af"/>' : ""}` : ""}
    <path d="${back ? "M20 28Q16 9 32 7Q49 8 45 31L39 35L32 32L24 35Z" : "M20 26Q15 10 30 7Q47 5 46 25L41 29L40 17L34 23L35 15L27 23L24 20L24 30Z"}" fill="${hair}" stroke="${mage ? "#8a7b7d" : "#343e50"}" stroke-width="1"/>
    <path d="M22 17Q24 10 33 10M37 11L41 16" stroke="${light}" fill="none" stroke-width="1.7" stroke-linecap="round"/>
    ${mage ? '<path d="M23 12Q32 7 42 13L40 16Q32 11 24 16Z" fill="#82647c"/><path d="M39 13L43 18L40 22L36 17Z" fill="#8bd7d4" stroke="#e6d4ac" stroke-width=".7"/>'
      : '<path d="M22 18L20 26M42 16L44 24" stroke="#9b9c9f" stroke-width="1"/>'}
    </g></g>`
  return svg(body)
}

export const ACTOR_TEXTURES = {}
for (const owner of ["player", "companion"]) for (const kind of ["guardian", "mage"]) for (const direction of DIRECTIONS) {
  for (const [pose, count] of Object.entries(FRAME_COUNTS)) for (let frame = 0; frame < count; frame++) {
    ACTOR_TEXTURES[`${owner === "companion" ? "companion-" : ""}${kind}-${direction}-${pose}-${frame}`] = actor(kind, direction, pose, frame, owner)
  }
}
export const ACTOR_DEFAULTS = Object.fromEntries(["player", "companion"].flatMap(owner =>
  ["guardian", "mage"].map(kind => [`${owner === "companion" ? "companion-" : ""}${kind}`, actor(kind, "down", "idle", 0, owner)])))
export function actorImage(kind, owner = "player") {
  const key = `${owner === "companion" ? "companion-" : ""}${kind}`
  return `data:image/svg+xml,${encodeURIComponent(ACTOR_DEFAULTS[key] || ACTOR_DEFAULTS.guardian)}`
}

export function directionFor(x, y, previous = "down") {
  if (Math.hypot(x, y) < 1) return previous
  return Math.abs(x) > Math.abs(y) ? x < 0 ? "left" : "right" : y < 0 ? "up" : "down"
}

export function enemySprite(kind, frame = 0) {
  const wave = Math.sin(frame / 6 * Math.PI * 2), top = 28 + wave * 3
  if (kind === "slime") return svg(`
    <defs><radialGradient id="j"><stop stop-color="#d4e7a6"/><stop offset=".55" stop-color="#80b694"/><stop offset="1" stop-color="#3f7e79"/></radialGradient></defs>
    <ellipse cx="32" cy="64" rx="22" ry="6" fill="#192d32" opacity=".3"/>
    <path d="M8 56Q6 ${top + 7} 19 ${top}Q30 ${top - 16} 43 ${top}Q59 ${top + 9} 56 57Q35 73 8 56Z" fill="url(#j)" stroke="#376969" stroke-width="1.4"/>
    <path d="M15 51Q16 ${top + 1} 27 ${top - 3}" stroke="#e0f1bb" stroke-width="3" fill="none" opacity=".7"/>
    <path d="M13 60Q32 68 51 60" stroke="#a7d6ad" fill="none"/>
    <ellipse cx="26" cy="${top + 13}" rx="2.5" ry="3" fill="#25494b"/><ellipse cx="41" cy="${top + 13}" rx="2.5" ry="3" fill="#25494b"/>
    <path d="M30 ${top + 21}Q33 ${top + 23} 36 ${top + 21}" stroke="#4c7064" fill="none"/>`)
  return svg(`
    <defs><linearGradient id="w" x2=".2" y2="1"><stop stop-color="#eef4d8"/><stop offset=".45" stop-color="#9dd7e2"/><stop offset="1" stop-color="#667bad" stop-opacity=".3"/></linearGradient></defs>
    <ellipse cx="32" cy="64" rx="14" ry="4" fill="#192b41" opacity=".2"/>
    <g transform="translate(0 ${wave * 2})"><path d="M32 10Q51 22 46 42L53 55L42 50L37 65L29 53L18 61L20 46Q9 24 32 10Z" fill="url(#w)" stroke="#6b9ebc" stroke-width="1.1"/>
    <path d="M25 16Q18 27 22 37" stroke="#eef6dc" stroke-width="2" fill="none"/>
    <path d="M24 33L29 35M40 33L35 35" stroke="#3d557e" stroke-width="2"/>
    <path d="M30 20L35 28L30 39L26 28Z" fill="#f1f3cf" opacity=".8"/>
    <path d="M22 45Q31 51 43 43M27 50L30 56" fill="none" stroke="#d4e6e6" opacity=".7"/></g>`)
}
export const ENEMY_TEXTURES = Object.fromEntries(["slime", "wisp"].flatMap(kind =>
  Array.from({ length: 6 }, (_, frame) => [`${kind}-motion-${frame}`, enemySprite(kind, frame)])))

export function installActorAtlas(scene) {
  if (scene.textures.exists("actors-v2")) return
  const frames = [...Object.keys(ACTOR_TEXTURES), ...Object.keys(ENEMY_TEXTURES)], columns = 16
  const atlas = scene.textures.createCanvas("actors-v2", columns * 64, Math.ceil(frames.length / columns) * 72)
  for (const [index, name] of frames.entries()) {
    const x = index % columns * 64, y = Math.floor(index / columns) * 72
    atlas.context.drawImage(scene.textures.get(name).getSourceImage(), x, y)
    atlas.add(name, 0, x, y, 64, 72)
    scene.textures.remove(name)
  }
  atlas.refresh()
}
