import { JOURNEY, nodeAt, areaAt, skinAt, lastNode, firstNode, drawDoors, enter, progress, pace, hpScale, interval } from "./journey-rules.mjs"
import { button, element } from "./camp.mjs"
import { levelCap } from "./skills.mjs"
import { icon } from "./icons.mjs"
import { FOES } from "./encounter-rules.mjs"
import { STOPS, offersStop, stopDoor, openStop, eventOf, canBuy, choose, shardsFor, emptyStops } from "./stop-rules.mjs"

const clock = ms => `${Math.floor(ms / 60000)}:${String(Math.ceil(ms / 1000) % 60).padStart(2, "0")}`

// Rule 8: the run is nine short nodes. This class owns node progress and the door choice.
export class Journey {
  constructor(scene, controller, snapshot) {
    this.s = scene; this.controller = controller
    this.state = snapshot ? structuredClone(snapshot.journey) : firstNode()
    this.exits = []
    // Rule 14: shards, a pending boon, the charm, extra vitality and the stop being visited.
    if (!snapshot && scene.meta.rules >= 14) Object.assign(this.state, emptyStops())
  }
  get stops() { return this.s.meta.rules >= 14 }
  // Rule 17: after a node the doors stand at the arena edge as exits; walking into one takes it.
  get walking() { return this.s.meta.rules >= 17 }
  get roaming() { return this.walking && this.state.phase === "doors" }
  exitPoints() {
    const a = this.s.terrain.geometry.area, cx = (a.left + a.right) / 2, cy = (a.top + a.bottom) / 2
    return [{ x: cx, y: a.top + 45 }, { x: a.right - 45, y: cy }, { x: a.left + 45, y: cy }, { x: cx, y: a.bottom - 45 }]
  }
  clearExits() { for (const item of this.exits || []) item.destroy(); this.exits = [] }
  drawExits() {
    this.clearExits()
    if (!this.roaming) return
    const s = this.s, points = this.exitPoints(), next = this.state.node + 1, area = areaAt(next)
    this.exitG = s.add.graphics().setDepth(40)
    this.exits.push(this.exitG)
    this.state.doors.forEach((door, index) => {
      const p = points[index]
      const label = door.goal === "stop" ? `停靠 · ${STOPS.kinds[door.reward].name}`
        : `${JOURNEY.goals[door.goal].name}${door.hard ? "（险路）" : ""}${JOURNEY.rewards[door.reward] ? ` · ${JOURNEY.rewards[door.reward].name}${door.hard ? "×2" : ""}` : ""}`
      const text = s.add.text(p.x, p.y - 58, `${door.goal === "boss" ? "最终一战" : area.name}\n${label}`, {
        fontFamily: "sans-serif", fontSize: "15px", color: door.hard ? "#ffd0c4" : door.goal === "stop" ? "#d7f0ff" : "#fff6d8",
        align: "center", stroke: "#1b1f24", strokeThickness: 4 }).setOrigin(.5, 1).setDepth(5000)
      this.exits.push(text)
    })
  }
  paintExits() {
    if (!this.roaming || !this.exitG) return
    const g = this.exitG, points = this.exitPoints(), t = this.s.elapsed / 600
    g.clear()
    this.state.doors.forEach((door, index) => {
      const p = points[index], color = door.hard ? 0xff9a7a : door.goal === "stop" ? 0x9cd8ff : 0xffe39a
      g.fillStyle(color, .18 + .08 * Math.sin(t + index)).fillEllipse(p.x, p.y, 92, 54)
      g.lineStyle(3, color, .85).strokeEllipse(p.x, p.y, 92 + 6 * Math.sin(t + index), 54 + 4 * Math.sin(t + index))
      g.lineStyle(2, 0xffffff, .5).strokeEllipse(p.x, p.y, 60, 34)
    })
  }
  walk() {
    const s = this.s, c = this.controller
    if (!this.roaming || s.paused || c.busy || c.saving || c.api.pending || s.outcome !== "playing") return
    const index = this.exitPoints().slice(0, this.state.doors.length).findIndex(p => Math.hypot(s.player.x - p.x, s.player.y - p.y) < 50)
    if (index < 0) return
    s.setPaused(true)
    this.pick(index)
  }
  get stopping() { return this.state.phase === "stop" }
  boost() { return this.stops && this.fighting && this.state.boon === "power" ? 1.2 : 1 }
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
    if (this.roaming) { this.paintExits(); this.walk(); return }
    if (this.s.outcome !== "playing" || !this.fighting || !this.status().done) return
    this.complete()
  }
  complete() {
    const s = this.s, j = this.state, goal = JOURNEY.goals[j.goal]
    for (const enemy of [...s.enemies.getChildren()]) { s.art?.kill?.(enemy, "player"); enemy.destroy() }
    s.encounters.foes.clear(); s.encounters.threats = []; s.encounters.paint()
    s.combat.frost?.marks.clear()
    s.combat.burns.clear(); s.combat.blasts = []; s.combat.line?.clear(); s.combat.flameLine?.clear(); s.combat.swordLine?.clear(); s.combat.dashLine?.clear()
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
    let gained = 0
    if (this.stops) {
      gained = shardsFor(this.node.type, j.hard, j.boon)
      j.shards = Math.min(STOPS.shards.cap, j.shards + gained); j.boon = ""
    }
    j.phase = "doors"
    j.doors = drawDoors(j.node + 1, { level: s.level, rerolls: s.combat.rerolls, cap: levelCap(s.combat.builds.player), hardFrom: s.meta.rules >= 12 ? 1 : undefined }, s.rng)
    if (this.stops && offersStop(j.node + 1)) j.doors.push(stopDoor(s.rng))
    if (this.walking) { this.drawExits(); this.controller.save().catch(error => this.controller.failure(error)) }
    const reward = JOURNEY.rewards[j.reward]
    this.controller.notice(`${goal.name}完成${reward ? ` · ${reward.name}${j.hard ? " ×2" : ""}` : ""}${gained ? ` · 林晶 +${gained}` : ""}`)
  }
  openDoors(force = false) {
    const s = this.s, c = this.controller
    if (this.roaming && !force) return false
    if (s.outcome !== "playing" || this.fighting || s.choices.length || s.encounters.state.pending
      || (!force && (s.paused || c.busy || c.saving || c.api.pending))) return false
    s.setPaused(true); c.doors(true)
    return true
  }
  heading() {
    if (!this.stopping) return "选择去路"
    const stop = this.state.stop
    return stop.kind === "event" ? `奇遇 · ${eventOf(stop).name}` : `停靠 · ${STOPS.kinds[stop.kind].name}`
  }
  title() {
    const shards = this.stops ? ` · 林晶 ${this.state.shards}` : ""
    if (this.stopping) return `${STOPS.kinds[this.state.stop.kind].name}${shards}`
    return `${this.area.name} · 第 ${this.state.node + 1} / ${JOURNEY.nodes.length} 段已完成${shards}`
  }
  render(body) {
    if (this.stopping) { this.renderStop(body); return }
    const next = this.state.node + 1, area = areaAt(next), entering = area.id !== this.area.id
    body.append(element("p", this.roaming ? "出口已经在场地边缘亮起，走过去就能进入；也可以在这里直接选。"
      : entering ? `前方是${area.name}。选一条路继续。` : "选一条路继续。门后的目标与奖励如下。", "lead"))
    const grid = element("div", "", "upgrade-grid door-grid")
    this.state.doors.forEach((door, index) => {
      const card = button("", () => this.pick(index), "upgrade door")
      card.dataset.door = String(index); card.dataset.goal = door.goal
      if (door.goal === "stop") {
        const kind = STOPS.kinds[door.reward]
        card.dataset.stop = door.reward
        card.append(element("span", "停靠 · 不战斗", "tag"), icon(kind.icon), element("strong", kind.name), element("span", kind.text))
        const note = element("span", "", "door-reward")
        note.append(element("span", "处理完回到这里，其余的门仍然可选"))
        card.append(note); grid.append(card); return
      }
      const goal = JOURNEY.goals[door.goal], reward = JOURNEY.rewards[door.reward]
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
    if (this.roaming) actions.append(button("回到场地 · 走向出口", () => this.controller.play(), "primary", "Footprints"))
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
    if (!s.paused || this.fighting || this.stopping || !door || s.choices.length || c.busy || c.api.pending) return
    this.clearExits()
    if (door.goal === "stop") {
      const j = this.state
      j.doors.splice(index, 1); j.phase = "stop"; j.stop = openStop(door.reward, s.rng)
      c.action(async () => { await c.save(); c.doors() })
      return
    }
    enter(this.state, door, s.elapsed, s.kills)
    for (const group of [s.bullets, s.drops]) group.clear(true, true)
    s.combat.zones = []
    s.art.reset(); s.fireArt.reset(); s.swordArt?.reset()
    s.terrain.load(this.node.arena, skinAt(this.state.node)); s.terrain.reset(true); s.hazards?.reset()
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
    if (!this.fighting) return `${this.area.name} · ${this.stopping ? "停靠" : "选择去路"}`
    const head = `${this.area.name} · ${goal.name}${j.hard ? "（险路）" : ""}${this.stops ? ` · 林晶 ${j.shards}${j.boon === "power" ? " · 战意" : ""}` : ""}`
    return j.goal === "hold" ? `${head} · 还剩 ${clock(status.left)}` : j.goal === "clear" ? `${head} · ${status.count} / ${j.need}`
      : `${head} · 击败${FOES[this.node.foe].name}`
  }
  stage() { return `第 ${Math.min(this.state.node + 1, lastNode() + 1)} / ${JOURNEY.nodes.length} 段` }
  // Rule 14 stops: one quiet panel, then back to the remaining doors.
  renderStop(body) {
    const s = this.s, j = this.state, stop = j.stop, kind = STOPS.kinds[stop.kind]
    const banner = document.createElement("img")
    banner.className = "stop-art"; banner.alt = ""; banner.src = new URL(`art/stop-${stop.kind}.jpg`, import.meta.url).href
    banner.onerror = () => banner.remove()
    body.append(banner)
    const status = [`生命 ${Math.ceil(s.hp)} / ${s.maxHp()}`, `林晶 ${j.shards}`]
    if (j.boon) status.push(STOPS.boons[j.boon])
    if (j.charm) status.push("替身护符")
    body.append(element("p", stop.kind === "event" ? eventOf(stop).text : kind.text, "lead"), element("p", status.join(" · "), "muted stop-status"))
    const grid = element("div", "", "upgrade-grid door-grid")
    const card = (name, text, iconName, onClick, extra = "") => {
      const item = button("", onClick, "upgrade door")
      item.append(icon(iconName), element("strong", name), element("span", text))
      if (extra) item.append(element("span", extra, "door-reward"))
      grid.append(item); return item
    }
    if (stop.kind === "camp") STOPS.camp.forEach(option => {
      card(option.name, option.text, kind.icon, () => this.resolve(option.effects, `篝火 · ${option.name}`)).dataset.camp = option.id
    })
    if (stop.kind === "event") eventOf(stop).options.forEach((option, index) => {
      card(option.label, option.text, option.gamble ? "Sparkles" : "Check", () => {
        const outcome = choose(stop, index, s.rng)
        this.resolve(outcome.effects, outcome.result)
      }).dataset.option = String(index)
    })
    if (stop.kind === "shop") for (const id of stop.offer) {
      const item = STOPS.items[id], sold = stop.bought.includes(id)
      const node = card(item.name, item.text, item.icon, () => this.buy(id), sold ? "已购买" : `${item.price} 林晶`)
      node.dataset.item = id
      node.disabled = sold || !canBuy(stop, j, id)
    }
    const actions = element("div", "", "actions")
    if (stop.kind === "shop") actions.append(button("离开", () => this.resolve([], "行商挥手道别。"), "primary", "ArrowLeft"))
    body.append(grid, actions)
  }
  buy(id) {
    const s = this.s, c = this.controller, j = this.state
    if (!this.stopping || !canBuy(j.stop, j, id) || c.busy || c.api.pending) return
    j.shards -= STOPS.items[id].price; j.stop.bought.push(id)
    this.apply(STOPS.items[id].effects)
    c.action(async () => { await c.save(); c.doors(); c.notice(`买下了${STOPS.items[id].name}`) })
  }
  resolve(effects, text) {
    const c = this.controller, j = this.state
    if (!this.stopping || c.busy || c.api.pending) return
    this.apply(effects)
    j.phase = "doors"; j.stop = null
    c.action(async () => {
      await c.save()
      if (this.walking) { this.drawExits(); c.play() } else c.doors()
      c.notice(text)
    })
  }
  apply(effects) {
    const s = this.s, j = this.state, max = () => s.maxHp()
    for (const [kind, value] of effects) {
      if (kind === "heal") s.hp = Math.min(max(), s.hp + Math.ceil(max() * value))
      if (kind === "hurt") s.hp = Math.max(1, s.hp - Math.ceil(max() * value))
      if (kind === "vigor" && j.vigor < STOPS.vigor.cap) { j.vigor = Math.min(STOPS.vigor.cap, j.vigor + value); s.hp = Math.min(max(), s.hp + value) }
      if (kind === "study") s.xp = Math.min(10000, s.xp + 14 + s.level * 7)
      if (kind === "reroll") s.combat.rerolls = Math.min(2, s.combat.rerolls + value)
      if (kind === "boon") j.boon = value
      if (kind === "charm") j.charm = true
      if (kind === "shards") j.shards = Math.min(STOPS.shards.cap, j.shards + value)
    }
    s.lowHealth = s.hp / max() <= .3
    s.updateHud?.()
  }
  // The charm turns one lethal blow into a narrow escape.
  spare() {
    if (!this.stops || !this.state.charm) return false
    this.state.charm = false
    return true
  }
}
