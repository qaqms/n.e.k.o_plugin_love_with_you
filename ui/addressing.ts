export const ADDRESS_STAGES = ["stranger", "familiar", "fond", "ambiguous", "lover"]
export const ADDRESS_MODES = ["auto", "custom", "persona", "inherit"] as const
export type AddressMode = typeof ADDRESS_MODES[number]
export type StageAddress = { mode: AddressMode; text: string }
export type Addressing = {
  version: number; stages: Record<string, StageAddress>
  endearments: boolean; preferred_name: string; avoided: string[]
}
export type AddressPatch = Partial<Omit<Addressing, "version">>
export const cleanName = (value: string) => Array.from(value.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim()).slice(0, 12).join("")
export const sameAddress = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function defaultAddressing(): Addressing {
  return {
    version: 1, stages: Object.fromEntries(ADDRESS_STAGES.map(key => [key, { mode: "auto", text: "" }])),
    endearments: true, preferred_name: "", avoided: [],
  }
}

export function addressConfig(scope?: { addressing?: Addressing; nicknames?: Record<string, string> }): Addressing {
  if (scope?.addressing) return scope.addressing
  return {
    version: 1, stages: Object.fromEntries(ADDRESS_STAGES.map(key => [
      key, { mode: scope?.nicknames?.[key] ? "custom" : "inherit", text: scope?.nicknames?.[key] || "" },
    ])), endearments: false, preferred_name: "", avoided: [],
  } as Addressing
}

export function normalizedAddress(value: Addressing): Addressing {
  return { ...value, preferred_name: cleanName(value.preferred_name),
    stages: Object.fromEntries(ADDRESS_STAGES.map(key => [key, {
      mode: value.stages[key].mode,
      text: value.stages[key].mode === "custom" ? cleanName(value.stages[key].text) : "",
    }])), avoided: [...new Set(value.avoided.map(cleanName).filter(Boolean))] }
}

export function addressDiff(value: Addressing, base: Addressing): { changes: AddressPatch; expected: AddressPatch } {
  const changes: AddressPatch = {}, expected: AddressPatch = {}
  for (const key of ADDRESS_STAGES) {
    if (!sameAddress(value.stages[key], base.stages[key])) {
      ;(changes.stages ||= {})[key] = value.stages[key]
      ;(expected.stages ||= {})[key] = base.stages[key]
    }
  }
  for (const key of ["endearments", "preferred_name", "avoided"] as const) {
    if (!sameAddress(value[key], base[key])) {
      Object.assign(changes, { [key]: value[key] })
      Object.assign(expected, { [key]: base[key] })
    }
  }
  return { changes, expected }
}

export function mergeAddressDraft(values: Addressing, base: Addressing, saved: Addressing) {
  const next = { ...values, stages: { ...values.stages } }, origin = { ...base, stages: { ...base.stages } }
  for (const key of ADDRESS_STAGES) {
    if (sameAddress(values.stages[key], base.stages[key])) {
      next.stages[key] = origin.stages[key] = saved.stages[key]
    }
  }
  for (const key of ["endearments", "preferred_name", "avoided"] as const) {
    if (sameAddress(values[key], base[key])) {
      Object.assign(next, { [key]: saved[key] })
      Object.assign(origin, { [key]: saved[key] })
    }
  }
  return { values: next, base: origin }
}

export function addressPreview(config: Addressing, stage: string, confirmed: boolean) {
  const prefs = normalizedAddress(config)
  const denied = new Set(prefs.avoided.map(value => value.toLowerCase()))
  let text = "", candidate = "", source = "persona", sourceStage = stage
  for (const key of ADDRESS_STAGES.slice(0, ADDRESS_STAGES.indexOf(stage) + 1)) {
    const item = prefs.stages[key]
    if (item.mode === "custom") {
      text = denied.has(item.text.toLowerCase()) ? "" : item.text
      candidate = ""; source = text ? "custom" : "persona"; sourceStage = key
    } else if (item.mode === "persona") {
      text = ""; candidate = ""; source = "persona"; sourceStage = key
    } else if (item.mode === "auto") {
      if (prefs.preferred_name && !denied.has(prefs.preferred_name.toLowerCase())) {
        text = prefs.preferred_name; candidate = ""; source = "preferred"; sourceStage = key
      } else if (!text) {
        candidate = key === "lover" && confirmed && prefs.endearments && !denied.has("亲爱的") ? "亲爱的" : ""
        source = candidate ? "default_lover" : "default"; sourceStage = key
      }
    }
  }
  return { text, candidate, source, sourceStage }
}
