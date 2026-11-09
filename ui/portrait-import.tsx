import { Alert, Button, Input, Modal, useCallback, useRef, useState } from "@neko/plugin-ui"
import type { HostedApi } from "@neko/plugin-ui"
import { Icon } from "./icons"

type ImportRow = {
  key: number; name: string; data_url: string; thumbnail_url: string
  status: "ready" | "saved" | "duplicate" | "failed"; error: string
}

function fileUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("portrait_invalid_image"))
    reader.readAsDataURL(file)
  })
}

async function preparePortrait(file: File): Promise<{ data_url: string; thumbnail_url: string }> {
  if (!/\.(png|jpe?g|webp)$/i.test(file.name)) throw new Error("portrait_invalid_image")
  if (!file.size || file.size > 32 * 1024 * 1024) throw new Error("portrait_source_too_large")
  const image = document.createElement("img")
  const url = await fileUrl(file)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { image.src = ""; reject(new Error("portrait_invalid_image")) }, 15000)
    image.onload = () => { clearTimeout(timer); resolve() }
    image.onerror = () => { clearTimeout(timer); reject(new Error("portrait_invalid_image")) }
    image.src = url
  })
  if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 40000000) {
    throw new Error("portrait_source_too_large")
  }
  const canvas = document.createElement("canvas")
  const scale = Math.min(1, 2048 / image.naturalWidth, 3072 / image.naturalHeight)
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext("2d")
  if (!context) throw new Error("portrait_invalid_image")
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  let left = canvas.width, top = canvas.height, right = -1, bottom = -1
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3]) {
        left = Math.min(left, x); right = Math.max(right, x)
        top = Math.min(top, y); bottom = Math.max(bottom, y)
      }
    }
  }
  if (right < left) throw new Error("portrait_invalid_image")
  const width = right - left + 1, height = bottom - top + 1
  const encode = (maxWidth: number, maxHeight: number, bytes: number) => {
    const target = document.createElement("canvas")
    let ratio = Math.min(1, maxWidth / width, maxHeight / height)
    for (let attempt = 0; attempt < 5; attempt++) {
      target.width = Math.max(1, Math.floor(width * ratio))
      target.height = Math.max(1, Math.floor(height * ratio))
      const output = target.getContext("2d")
      if (!output) throw new Error("portrait_invalid_image")
      output.drawImage(canvas, left, top, width, height, 0, 0, target.width, target.height)
      const encoded = target.toDataURL("image/webp", Math.max(.55, .88 - attempt * .08))
      if (!encoded.startsWith("data:image/webp;base64,")) throw new Error("portrait_invalid_image")
      if (encoded.length <= 23 + Math.floor(bytes / 3) * 4) return encoded
      ratio *= .8
    }
    throw new Error("portrait_too_large")
  }
  return { data_url: encode(960, 1440, 1024 * 1024), thumbnail_url: encode(200, 280, 64 * 1024) }
}

export const PORTRAIT_IMPORT_STYLE = `
.lwy-import-list { display: grid; gap: 12px; }
.lwy-import-row { display: grid; grid-template-columns: 64px minmax(0, 1fr) 32px; gap: 10px;
  align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 12px; min-width: 0; }
.lwy-import-row img { display: block; width: 64px; height: 88px; object-fit: contain; }
.lwy-import-row .lwy-field { margin: 0; min-width: 0; }
.lwy-import-row .neko-input { width: 100%; }
.lwy-import-row p { margin: 4px 0 0; overflow-wrap: anywhere; font-size: 12px; }
.lwy-import-file { max-width: 100%; color: var(--text); }
.lwy-import-fields { display: grid; gap: 12px; }
.lwy-custom-editor { --thumb-height: 180px; display: grid; gap: 12px; border-top: 1px solid var(--border); padding-top: 12px; }
`

export function PortraitImport(props: {
  api: HostedApi; t: (key: string, args?: any) => string; collections: string[]; initialCollection: string
  onClose: () => void; onChanged: () => void; errorText: (error: any) => string
}) {
  const { t } = props
  const [rows, setRows] = useState<ImportRow[]>([])
  const [collection, setCollection] = useState(props.initialCollection)
  const [newCollection, setNewCollection] = useState("")
  const [working, setWorking] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [refreshFailed, setRefreshFailed] = useState(false)
  const workingRef = useRef(false)
  const nextKey = useRef(0)
  const close = useCallback(() => { if (!workingRef.current) props.onClose() }, [])
  const game = (collection === "__new__" ? newCollection : collection).trim()
  const pending = rows.filter(row => row.status === "ready" || row.status === "failed")
  const patchRow = (key: number, patch: Partial<ImportRow>) =>
    setRows(current => current.map(row => row.key === key ? { ...row, ...patch } : row))

  async function selectFiles(event: Event) {
    const input = event.target as HTMLInputElement
    const files = Array.from(input.files || [])
    input.value = ""
    if (!files.length || workingRef.current) return
    if (files.length + rows.length > 24) {
      setError(t("art.batchLimit")); return
    }
    workingRef.current = true; setWorking(true); setPreparing(true); setError(""); setMessage("")
    const failures: string[] = []
    try {
      for (const file of files) {
        try {
          const prepared = await preparePortrait(file)
          const row: ImportRow = { ...prepared, key: ++nextKey.current,
            name: Array.from(file.name.replace(/\.[^.]+$/, "")).slice(0, 120).join(""),
            status: "ready", error: "" }
          setRows(current => [...current, row])
        } catch (failure) { failures.push(`${file.name}: ${props.errorText(failure)}`) }
      }
      if (failures.length) setError(failures.join("\n"))
    } finally { workingRef.current = false; setWorking(false); setPreparing(false) }
  }

  async function refresh() {
    try { await props.api.refresh(); setRefreshFailed(false); props.onChanged() }
    catch { setRefreshFailed(true) }
  }

  async function save() {
    if (workingRef.current || !game || !pending.length || pending.some(row => !row.name.trim())) return
    workingRef.current = true; setWorking(true); setError(""); setMessage("")
    let saved = 0, duplicates = 0
    try {
      for (const row of pending) {
        try {
          const response = await props.api.call("import_portrait", {
            name: row.name.trim(), collection: game, data_url: row.data_url, thumbnail_url: row.thumbnail_url,
          }, { userInitiated: true })
          let payload = response
          for (let depth = 0; depth < 4 && payload && !payload.item; depth++) {
            payload = payload.result ?? payload.data ?? payload.value
          }
          if (!payload?.item?.id) throw new Error("portrait_save_failed")
          if (payload.duplicate) duplicates++
          else saved++
          patchRow(row.key, { status: payload.duplicate ? "duplicate" : "saved", error: "" })
        } catch (failure) {
          patchRow(row.key, { status: "failed", error: props.errorText(failure) })
        }
      }
      setMessage(t("art.importResult", { saved, duplicates }))
      await refresh()
    } finally { workingRef.current = false; setWorking(false) }
  }

  return <Modal open size="lg" className="lwy-gallery-modal" title={t("art.import")} onClose={close}
    closeOnEscape={!working} closeOnBackdrop={!working}
    footer={<div className="lwy-btns">
      <Button tone="default" disabled={working} onClick={close}>{t(pending.length ? "common.cancel" : "art.done")}</Button>
      <Button tone="primary" disabled={working || !game || !pending.length || pending.some(row => !row.name.trim())}
        onClick={save}><Icon name={working ? "RotateCw" : "Save"} />
        {t(working ? preparing ? "art.preparing" : "common.saving" : "art.confirmImport")}</Button>
    </div>}>
    <div className="lwy-import-fields">
      <label className="lwy-field"><span>{t("art.files")}</span>
        <input className="lwy-import-file" type="file" accept=".png,.jpg,.jpeg,.webp" multiple disabled={working} onChange={selectFiles} />
      </label>
      <label className="lwy-field"><span>{t("art.collection")}</span>
        <select className="neko-select" value={collection} disabled={working} aria-label={t("art.collection")}
          onChange={(event: Event) => setCollection((event.target as HTMLSelectElement).value)}>
          {[
            { value: "", label: t("art.chooseGame") },
            ...props.collections.map(name => ({ value: name, label: name })),
            { value: "__new__", label: t("art.newGame") },
          ].map(option => <option key={option.value} value={option.value} selected={option.value === collection}>{option.label}</option>)}
        </select>
      </label>
      {collection === "__new__" ? <label className="lwy-field"><span>{t("art.gameName")}</span>
        <Input value={newCollection} disabled={working} onChange={(value: string) => setNewCollection(Array.from(value).slice(0, 80).join(""))} />
      </label> : null}
      {error ? <div role="alert"><Alert tone="danger" message={error} /></div> : null}
      {message ? <p role="status" className="lwy-note">{message}</p> : null}
      {refreshFailed ? <div><Alert tone="warning" message={t("feedback.stale")} />
        <Button disabled={working} onClick={refresh}>{t("common.refresh")}</Button></div> : null}
      <div className="lwy-import-list">
        {rows.map(row => <div className="lwy-import-row" key={row.key}>
          <img src={row.thumbnail_url} alt="" />
          <label className="lwy-field"><span>{t("art.imageName")}</span>
            <Input value={row.name} disabled={working || ["saved", "duplicate"].includes(row.status)}
              onChange={(name: string) => patchRow(row.key, { name: Array.from(name).slice(0, 120).join("") })} />
            {row.error ? <p role="alert" className="lwy-field-error">{row.error}</p> : null}
            {["saved", "duplicate"].includes(row.status) ? <p>{t(`art.status.${row.status}`)}</p> : null}
          </label>
          <button type="button" className="lwy-icon-button" disabled={working}
            title={t("art.removePreview")} aria-label={t("art.removePreview")}
            onClick={() => setRows(current => current.filter(item => item.key !== row.key))}><Icon name="Trash2" /></button>
        </div>)}
      </div>
    </div>
  </Modal>
}
