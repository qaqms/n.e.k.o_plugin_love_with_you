import { newSkill, parameters, starterSkills, drawChoices, replacementChoices } from "./skills.mjs"
import { legalCooperations } from "./encounter-rules.mjs"

// Rule 7 decisions share the checkpoint acknowledgement path with ordinary study.
export class Buildcraft {
  constructor(combat, snapshot) {
    this.c = combat; this.s = combat.s; this.controller = combat.controller
    this.preparation = snapshot?.preparation ?? "player"
    this.swaps = snapshot ? { ...snapshot.swaps } : { player: 0, companion: 0 }
  }
  data() { return { preparation: this.preparation, swaps: { ...this.swaps } } }
  idle() {
    return this.s.activeRun && this.s.paused && this.s.outcome === "playing"
      && !this.controller.busy && !this.controller.api.pending
  }
  chooseStarter(id) {
    const owner = this.preparation
    if (!this.idle() || !owner || !starterSkills().some(s => s.id === id)) return
    return this.controller.action(async () => {
      this.c.builds[owner].skills.push(newSkill(id))
      this.preparation = owner === "player" ? "companion" : ""
      await this.controller.save()
      if (this.preparation) this.controller.initialStudy()
      else this.controller.play()
    })
  }
  reroll() {
    if (!this.idle() || this.preparation || !this.c.studyOwner || !this.c.rerolls) return
    return this.controller.action(async () => {
      this.c.rerolls--
      this.s.choices = drawChoices(this.c.builds[this.c.studyOwner], this.c.studyOwner, this.s.rng, false)
      await this.controller.save()
      this.controller.upgrades()
    })
  }
  banish(id) {
    const owner = this.c.studyOwner, build = this.c.builds[owner]
    if (!this.idle() || this.preparation || !owner || build.banished.length >= 2
      || !this.s.choices.includes(`${id}:learn`) || build.skills.some(s => s.id === id)) return
    return this.controller.action(async () => {
      build.banished.push(id)
      this.s.choices = drawChoices(build, owner, this.s.rng, false)
      await this.controller.save()
      this.controller.upgrades()
    })
  }
  available(owner) { return Math.max(0, (this.s.encounters?.state.resolved.length || 0) - this.swaps[owner]) }
  canRefit() {
    return this.idle() && !this.preparation && !this.s.choices.length && !this.s.encounters?.state.pending
  }
  options(owner, id) {
    const build = this.c.builds[owner]
    if (!build) return []
    const selected = this.s.encounters?.state.selected || []
    return replacementChoices(build, id).filter(next => {
      const builds = structuredClone(this.c.builds)
      builds[owner].skills.splice(build.skills.findIndex(s => s.id === id), 1, newSkill(next))
      const legal = legalCooperations(builds, [])
      return selected.every(key => legal.includes(key))
    })
  }
  replace(owner, id, next) {
    if (!this.canRefit() || !["player", "companion"].includes(owner) || !this.available(owner)
      || !this.options(owner, id).includes(next)) return
    return this.controller.action(async () => {
      const build = this.c.builds[owner], index = build.skills.findIndex(s => s.id === id), old = build.skills[index]
      const learned = newSkill(next)
      learned.ready_at = Math.max(old.ready_at, this.s.elapsed + parameters(learned, build).cooldown)
      build.skills.splice(index, 1, learned)
      this.swaps[owner]++
      // Remove effects that would outlive their owning skill or catalyst.
      for (const bolt of [...this.s.bullets.getChildren()]) if (bolt.getData("owner") === owner) bolt.destroy()
      this.c.zones = this.c.zones.filter(z => z.owner !== owner)
      for (const [target, mark] of this.c.frost.marks) if (mark.source === owner) this.c.frost.marks.delete(target)
      this.c.expanded.lines = []
      await this.controller.save()
      this.controller.refit(owner)
    })
  }
}
