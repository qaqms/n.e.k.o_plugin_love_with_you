export type Appearance = { accent_color: string; color_scheme: "system" | "light" | "dark" }

export const DEFAULT_APPEARANCE: Appearance = { accent_color: "#c74768", color_scheme: "system" }
export const THEME_PRESETS = [
  { key: "rose", color: "#c74768", label: "樱粉" },
  { key: "sky", color: "#7db9e8", label: "晴空蓝" },
  { key: "mint", color: "#70bda5", label: "薄荷绿" },
  { key: "lavender", color: "#aaa0d8", label: "雾紫" },
  { key: "peach", color: "#edac8c", label: "杏桃" },
  { key: "aqua", color: "#66b8c5", label: "湖水青" },
] as const

export function normalizeAppearance(value?: Partial<Appearance>): Appearance {
  const color = typeof value?.accent_color === "string" ? value.accent_color : ""
  return {
    accent_color: color.length === 7 && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : DEFAULT_APPEARANCE.accent_color,
    color_scheme: ["system", "light", "dark"].includes(value?.color_scheme || "") ? value!.color_scheme! : "system",
  }
}

function rgb(hex: string): number[] {
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16))
}

function luminance(hex: string): number {
  const channels = rgb(hex).map(value => {
    const s = value / 255
    return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4
  })
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
}

export function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b)
  return (Math.max(la, lb) + .05) / (Math.min(la, lb) + .05)
}

function mix(color: string, target: string, weight: number): string {
  const a = rgb(color), b = rgb(target)
  return "#" + a.map((value, index) => Math.round(value * (1 - weight) + b[index] * weight).toString(16).padStart(2, "0")).join("")
}

function readable(color: string, background: string, minimum: number): string {
  const target = luminance(background) > .5 ? "#000000" : "#ffffff"
  let result = color
  for (let n = 0; n < 40 && contrast(result, background) < minimum; n++) result = mix(result, target, .08)
  return result
}

export function themeTokens(input: Appearance, dark: boolean): Record<string, string> {
  const { accent_color: color } = normalizeAppearance(input)
  const bg = dark ? "#191b20" : "#fafafb", surface = dark ? "#202329" : "#ffffff"
  // Text and controls have separate tones so even very pale or dark choices work.
  const backgrounds = [bg, surface, dark ? "#25282f" : "#ffffff",
    mix(bg, color, dark ? .14 : .1), mix(surface, color, dark ? .14 : .1)]
  const hardest = backgrounds.sort((a, b) => dark ? luminance(b) - luminance(a) : luminance(a) - luminance(b))[0]
  const text = readable(color, hardest, 4.8)
  const accent = readable(color, bg, 3.2)
  const onAccent = contrast(accent, "#ffffff") >= contrast(accent, "#000000") ? "#ffffff" : "#000000"
  const hover = mix(accent, onAccent === "#ffffff" ? "#000000" : "#ffffff", .1)
  return {
    "--accent": accent, "--accent-strong": text, "--accent-hover": hover,
    "--accent-soft": `rgba(${rgb(color).join(",")},${dark ? ".14" : ".1"})`,
    "--accent-line": text, "--on-accent": onAccent,
    "--primary": accent, "--bg": bg, "--surface": surface, "--surface-strong": dark ? "#25282f" : "#ffffff",
    "--text": dark ? "#f0f0f3" : "#272930", "--muted": dark ? "#b2b5c0" : "#636773",
    "--border": dark ? "#3b3e47" : "#e1e2e7",
    "--gain": dark ? "#86d4b4" : "#23735b", "--loss": dark ? "#a6bdf2" : "#4767a0",
    "color-scheme": dark ? "dark" : "light",
  }
}

export function themeCss(input: Appearance): string {
  const prefs = normalizeAppearance(input)
  const rule = (dark: boolean) => `:root{${Object.entries(themeTokens(prefs, dark)).map(([name, value]) => `${name}:${value}`).join(";")}}`
  return prefs.color_scheme === "system"
    ? rule(false) + `@media(prefers-color-scheme:dark){${rule(true)}}`
    : rule(prefs.color_scheme === "dark")
}
