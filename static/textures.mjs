import { ACTOR_DEFAULTS, enemySprite } from "./actor-art.mjs"

// Original SVG sprites; no third-party character art is used.
const wrap = body => `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="72" viewBox="0 0 64 72">${body}</svg>`
const shadow = '<ellipse cx="32" cy="63" rx="18" ry="6" fill="#101b1c" opacity=".4"/>'
export const TEXTURES = {
  ...ACTOR_DEFAULTS,
  slime: enemySprite("slime"),
  wisp: enemySprite("wisp"),
  brute: wrap(`${shadow}<path d="M9 60L14 27L26 19L36 23L49 19L56 59L43 65L19 65Z" fill="#a78391" stroke="#624b61" stroke-width="3"/><path d="M16 26L10 11L27 24M43 24L54 10L50 30" fill="#d9c9af"/><path d="M22 39L29 42M43 39L35 42" stroke="#f2d6ae" stroke-width="4"/><path d="M23 54L40 54" stroke="#483c4d" stroke-width="3"/>`),
  boss: wrap(`${shadow}<path d="M13 60L16 24L29 15L42 20L51 59L40 66L22 66Z" fill="#536e70" stroke="#b6b49a" stroke-width="3"/><path d="M16 31L5 17L8 6L20 24M44 28L58 10L57 3L39 23" fill="none" stroke="#c7c4a5" stroke-width="5"/><path d="M23 38L29 40M40 38L34 40" stroke="#e9c884" stroke-width="4"/><path d="M30 47L35 47L32 60Z" fill="#8bc6a3"/>`),
  charger: wrap(`${shadow}<path d="M9 58L15 30L27 23L42 28L56 53L45 62L19 64Z" fill="#bc8e82" stroke="#684e58" stroke-width="3"/><path d="M23 28L12 12L25 22M43 28L56 12L49 34" fill="#ead0ad" stroke="#87685d" stroke-width="2"/><path d="M25 43L30 42M42 43L37 42" stroke="#492f43" stroke-width="4"/><path d="M14 55L4 60M52 53L61 57" stroke="#d2b089" stroke-width="3"/>`),
  caster: wrap(`${shadow}<path d="M18 39L43 39L52 62L11 62Z" fill="#657b64" stroke="#485c50" stroke-width="2"/><path d="M16 24L32 3L48 24Z" fill="#788878" stroke="#c2d2ae" stroke-width="2"/><path d="M24 31L29 33M40 31L35 33" stroke="#d5dfae" stroke-width="3"/><path d="M53 24L50 66" stroke="#a59470" stroke-width="4"/><circle cx="52" cy="19" r="7" fill="#a8dcd3" stroke="#e4f5d2" stroke-width="2"/>`),
  sentinel: wrap(`${shadow}<path d="M8 61L13 27L27 18L40 23L56 57L44 67L18 65Z" fill="#73886a" stroke="#c0c49f" stroke-width="3"/><path d="M16 27L5 11L24 23M43 25L59 9L52 34" fill="#bcc7a2" stroke="#66765f" stroke-width="2"/><path d="M22 40L29 42M42 40L35 42" stroke="#edda9b" stroke-width="4"/><path d="M23 53L42 53" stroke="#45564d" stroke-width="3"/>`),
  oracle: wrap(`${shadow}<path d="M14 61L17 28L30 18L43 22L53 61L40 66L22 66Z" fill="#87799a" stroke="#d2c0de" stroke-width="3"/><path d="M15 29L8 7L24 23M44 24L57 5L53 34" fill="none" stroke="#c4b5d5" stroke-width="4"/><path d="M22 40L29 42M42 40L35 42" stroke="#b9eee2" stroke-width="4"/><path d="M31 20L34 35L29 35Z" fill="#a9e0dc"/>`),
}
