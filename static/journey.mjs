import { JOURNEY, nodeAt, areaAt, lastNode, firstNode, drawDoors, enter, progress, pace, hpScale, interval } from "./journey-rules.mjs"
import { button, element } from "./camp.mjs"
import { levelCap } from "./skills.mjs"
import { icon } from "./icons.mjs"
import { FOES } from "./encounter-rules.mjs"

const clock = ms => `${Math.floor(ms / 60000)}:${String(Math.ceil(ms / 1000) % 60).padStart(2, "0")}`

// Rule 8: the run is nine short nodes. This class owns node progress and the door choice.
export class Journey {
  constructor(scene, controller, snapshot) {
    this.s = scene; this.controller = controller
    this.state = snapshot ? structuredClone(snapshot.journey) : firstNode()
  }
  data() { return { journey: structuredClone(this.state) } }
  get node() { return nodeAt(this.state.node) }
  get area() { return areaAt(this.state.node) }
  get fighting() { return this.state.phase === "fight" }
  pace() { return pace(this.state, this.s.elapsed) }
  // Rule 11 raises the pressure: sturdier and more frequent enemies, most of all in the later areas.
  hpScale() { return hpScale(this.state) * (this.s.meta.rules >= 11 ? { edge: 1.15, ruin: 1.4, deep: 1.45 }[this.area.id] : 1) }
  interval() { return interval(this.state, this.s.elapsed) * (this.s.meta.rules >= 11 ? .85 : 1) }
  // A fresh node (also the first one) brings its gatekeeper with it.
  arrive() {
    const s = this.s, foe = this.node.foe
    if (!foe || !this.fighting) return
    if (foe === "boss" ? s.bossSpawned : s.encounters.state.milestones[foe].spawned) return
    s.encounters.summon(foe)
  }
  status() {
    const s = this.s, j = this.state
    return progress(j, s.elapsed, s.kills, Boolean(this.node.foe && s.encounters.state.milestones[this.node.foe]?.defeated))
  }
  update() {
    if (this.s.outcome !== "playing" || !this.fighting || !this.status().done) return
    this.complete()
  }
  complete() {
    const s = this.s, j = this.state, goal = JOURNEY.goals[j.goal]
    for (const enemy of [...s.enemies.getChildren()]) { s.art?.kill?.(enemy, "player"); enemy.destroy() }
    s.encounters.foes.clear(); s.encounters.threats = []; s.encounters.paint()
    s.combat.frost?.marks.clear()
    s.combat.burns.clear(); s.combat.blasts = []; s.combat.line?.clear()
    // Whatever is still on the ground comes along; nothing is lost between nodes.
    for (const drop of [...s.drops.getChildren()]) { s.xp = Math.min(10000, s.xp + drop.getData("amount")); drop.destroy() }
    const times = j.hard ? 2 : 1
    if (j.reward === "study") {
      for (let i = 0; i < times; i++) s.xp = Math.min(10000, s.xp + 14 + (s.level + i) * 7)
    } else if (j.reward === "mend") {
      s.hp = Math.min(s.maxHp(), s.hp + Math.ceil(s.maxHp() * .3 * times))
      s.lowHealth = s.hp / s.maxHp() <= .3
    } else if (j.reward === "insight") s.combat.rerolls = Math.min(2, s.combat.rerolls + times)
    // Rule 9: a short breather after every fight, so one bad node does not doom the next.
    if (s.meta.rules >= 9 && this.node.type === "fight") {
      s.hp = Math.min(s.maxHp(), s.hp + Math.ceil(s.maxHp() * .1)); s.lowHealth = s.hp / s.maxHp() <= .3
    }
    if (this.node.type === "fight" && j.hard) j.hard_cleared++
    j.phase = "doors"
    j.doors = drawDoors(j.node + 1, { level: s.level, rerolls: s.combat.rerolls, cap: levelCap(s.combat.builds.player), hardFrom: s.meta.rules >= 12 ? 1 : undefined }, s.rng)
    const reward = JOURNEY.rewards[j.reward]
    this.controller.notice(`${goal.name}完成${reward ? ` · ${reward.name}${j.hard ? " ×2" : ""}` : ""}`)
  }
  openDoors(force = false) {
    const s = this.s, c = this.controller
    if (s.outcome !== "playing" || this.fighting || s.choices.length || s.encounters.state.pending
      || (!force && (s.paused || c.busy || c.saving || c.api.pending))) return false
    s.setPaused(true); c.doors(true)
    return true
  }
  title() { return `${this.area.name} · 第 ${this.state.node + 1} / ${JOURNEY.nodes.length} 段已完成` }
  render(body) {
    const next = this.state.node + 1, area = areaAt(next), entering = area.id !== this.area.id
    body.append(element("p", entering ? `前方是${area.name}。选一条路继续。` : "选一条路继续。门后的目标与奖励如下。", "lead"))
    const grid = element("div", "", "upgrade-grid door-grid")
    this.state.doors.forEach((door, index) => {
      const goal = JOURNEY.goals[door.goal], reward = JOURNEY.rewards[door.reward]
      const card = button("", () => this.pick(index), "upgrade door")
      card.dataset.door = String(index); card.dataset.goal = door.goal
      if (door.hard) card.dataset.hard = "true"
      const text = door.goal === "clear" ? `击败 ${door.need} 个敌人，越快越早结束` : door.goal === "elite" || door.goal === "boss"
        ? `${FOES[nodeAt(next).foe].name}${door.goal === "boss" ? "在圣所等候" : "拦在路上"}` : goal.text
      card.append(element("span", door.hard ? "险路 · 敌人更强" : door.goal === "boss" ? "最终一战" : area.name, "tag"),
        icon(goal.icon), element("strong", goal.name), element("span", text))
      const prize = element("span", "", "door-reward")
      if (reward) prize.append(icon(reward.icon), element("span", `${reward.name}${door.hard ? " ×2" : ""} · ${reward.text}`))
      else prize.append(element("span", door.goal === "boss" ? "击败后完成旅程" : "击败后研习双人协同"))
      card.append(prize)
      grid.append(card)
    })
    const actions = element("div", "", "actions")
    actions.append(button("技能图鉴", () => this.controller.codex(), "", "BookOpen"),
      button("保存并返回", () => this.controller.action(async () => {
        await this.controller.save(true); this.s.activeRun = false; await this.controller.refresh()
      }), "", "Save"))
    const craft = this.s.combat.craft, spare = craft.available("player") + craft.available("companion")
    if (spare) actions.prepend(button(`战后整备 · ${spare}`, () => this.controller.refit(), "", "RotateCw"))
    body.append(grid, actions)
  }
  pick(index) {
    const s = this.s, c = this.controller, door = this.state.doors[index]
    if (!s.paused || this.fighting || !door || s.choices.length || c.busy || c.api.pending) return
    enter(this.state, door, s.elapsed, s.kills)
    for (const group of [s.bullets, s.drops]) group.clear(true, true)
    s.combat.zones = []
    s.art.reset(); s.fireArt.reset()
    s.terrain.load(this.node.arena); s.terrain.reset(true)
    s.enterArena()
    s.spawnAt = s.elapsed + 1800
    s.encounters.state.rest_until = Math.min(s.encounters.state.rest_until, s.elapsed)
    this.arrive()
    s.combat.paint(); s.terrain.updateDepth(); s.art.update()
    c.action(async () => {
      await c.save()
      c.play()
      c.notice(this.node.foe ? `${FOES[this.node.foe].name}现身了。` : `${this.area.name} · ${JOURNEY.goals[this.state.goal].name}`)
    })
  }
  objective() {
    const j = this.state, status = this.status(), goal = JOURNEY.goals[j.goal]
    if (!this.fighting) return `${this.area.name} · 选择去路`
    const head = `${this.area.name} · ${goal.name}${j.hard ? "（险路）" : ""}`
    return j.goal === "hold" ? `${head} · 还剩 ${clock(status.left)}` : j.goal === "clear" ? `${head} · ${status.count} / ${j.need}`
      : `${head} · 击败${FOES[this.node.foe].name}`
  }
  stage() { return `第 ${Math.min(this.state.node + 1, lastNode() + 1)} / ${JOURNEY.nodes.length} 段` }
}
