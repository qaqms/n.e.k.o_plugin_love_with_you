import type { PluginSurfaceProps } from "@neko/plugin-ui"
import type { ExperienceState } from "./experiences"
import { Icon } from "./icons"

export type TrackedWatch = {
  id: string; title: string; watched_at: number; position: number; completed: boolean; url: string
}

export function trackedWatch(data: ExperienceState | undefined, character: string) {
  if (data?.enabled && data.watch_tracking && data.watches && Object.prototype.hasOwnProperty.call(data.watches, character)) {
    return data.watches[character]
  }
}

export function watchProgress(watch: TrackedWatch, t: PluginSurfaceProps["t"]) {
  const hours = Math.floor(watch.position / 3600)
  const minutes = Math.floor(watch.position / 60) % 60
  const seconds = String(watch.position % 60).padStart(2, "0")
  const clock = hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`
  return t(watch.completed ? "xp.watchCompleted" : "xp.watchProgress", { clock })
}

export function WatchLink({ watch, t }: { watch: TrackedWatch; t: PluginSurfaceProps["t"] }) {
  return <a className="neko-button lwy-watch-open" data-tone="default"
    href={watch.url} target="_blank" rel="noopener noreferrer">
    <Icon name="ChevronRight" />{t(watch.completed ? "xp.watchReplay" : "xp.watchContinue")}
  </a>
}
