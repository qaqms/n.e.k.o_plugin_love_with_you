import { AdventureApi, errorText } from "./bridge.mjs"
import { TEXTURES } from "./textures.mjs"
import { button, element, loadoutSummary, renderShop, settlementDetails, wallet } from "./camp.mjs"
import { installCatalog } from "./skills.mjs"
import { SkillCombat } from "./combat.mjs"
import { renderStudy, renderCodex, mountSkillHud, updateSkillHud, buildDetails } from "./study.mjs"

try {
  const responses = await Promise.all(["skills.json", "skills-v2.json"].map(file => fetch(new URL(file, import.meta.url))))
  if (responses.some(response => !response.ok)) throw new Error("技能资源读取失败")
  installCatalog(...await Promise.all(responses.map(response => response.json())))
} catch (error) {
  document.getElementById("screen-body").textContent = "技能资源未能载入，请重新打开冒险面板。"
  throw error
}

const $ = id => document.getElementById(id)
const W = 1800, H = 1200, END = 1200000
const CLASSES = { guardian: "剑卫", mage: "元素使" }
const UPGRADES = {
  power: ["磨砺", "玩家", "攻击强度提高 18%。"],
  vitality: ["坚韧", "玩家", "生命上限提高 18，并恢复等量生命。"],
  stride: ["轻步", "玩家", "移动速度提高 6%。"],
  reach: ["共鸣拾取", "双方", "经验拾取范围扩大。"],
  partner: ["并肩", "同行", "同行攻击与支援强度提高 20%。"],
  haste: ["施法节律", "玩家", "自动攻击间隔缩短。"],
  ward: ["守望", "同行", "获得周期性护盾；剑卫的护盾更强。"],
  multishot: ["回响", "玩家", "自动攻击增加一枚散射弹体。"],
}
const timeText = ms => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`

class Forest extends Phaser.Scene {
  constructor() { super("forest"); this.activeRun = false; this.paused = true; this.touch = { x: 0, y: 0 } }
  preload() {
    for (const [key, svg] of Object.entries(TEXTURES)) this.load.image(key, `data:image/svg+xml;base64,${btoa(svg)}`)
  }
  create() {
    this.controller = controller
    this.physics.world.setBounds(24, 24, W - 48, H - 48)
    this.cameras.main.setBounds(0, 0, W, H)
    this.paintForest()
    this.enemies = this.physics.add.group()
    this.bullets = this.physics.add.group()
    this.drops = this.physics.add.group()
    this.player = this.physics.add.sprite(W / 2, H / 2, "guardian").setScale(.7).setDepth(10).setCollideWorldBounds(true)
    this.player.body.setSize(28, 30).setOffset(18, 34)
    this.companion = this.physics.add.sprite(W / 2 - 55, H / 2 + 20, "mage").setScale(.66).setDepth(9).setTint(0xc7d9ff)
    this.companion.body.setSize(26, 28).setOffset(19, 35)
    this.ring = this.add.ellipse(this.player.x, this.player.y + 12, 42, 21).setStrokeStyle(2, 0xe8d296, .6).setDepth(8)
    this.partnerRing = this.add.ellipse(this.companion.x, this.companion.y + 12, 37, 19).setStrokeStyle(2, 0x9dbbdb, .65).setDepth(8)
    const projectile = this.make.graphics({ x: 0, y: 0, add: false })
    projectile.fillStyle(0xfff4cb).fillCircle(10, 10, 6)
    projectile.lineStyle(2, 0xe6cf91).strokeCircle(10, 10, 8)
    projectile.generateTexture("bolt", 20, 20); projectile.destroy()
    const shapes = {
      fire: g => g.fillStyle(0xf6b879).fillCircle(17, 16, 7).fillTriangle(3, 16, 16, 10, 16, 22),
      wind: g => g.lineStyle(3, 0x91e1d2).lineBetween(6, 6, 25, 16).lineBetween(25, 16, 6, 26),
      ice: g => g.fillStyle(0xb2eeff).fillPoints([{ x: 30, y: 16 }, { x: 12, y: 10 }, { x: 3, y: 16 }, { x: 12, y: 22 }], true),
      awakened: g => g.fillStyle(0xffe8a1).fillCircle(16, 16, 7).lineStyle(2, 0xffe8a1).strokeCircle(16, 16, 12),
      fusion: g => g.lineStyle(3, 0x92ecdf).strokeCircle(16, 16, 10).fillStyle(0xffc880).fillCircle(16, 16, 5)
        .lineBetween(3, 10, 12, 3).lineBetween(20, 29, 29, 22),
    }
    for (const [name, draw] of Object.entries(shapes)) {
      const graphic = this.make.graphics({ add: false })
      draw(graphic); graphic.generateTexture(`bolt-${name}`, 32, 32); graphic.destroy()
    }
    const crystal = this.make.graphics({ x: 0, y: 0, add: false })
    crystal.fillStyle(0xc2a9e0).fillPoints([{x:8,y:0},{x:15,y:9},{x:8,y:17},{x:1,y:9}], true)
    crystal.lineStyle(1, 0xe3d5f0).strokePoints([{x:8,y:0},{x:15,y:9},{x:8,y:17},{x:1,y:9}], true)
    crystal.generateTexture("xp", 16, 18); crystal.destroy()
    this.physics.add.overlap(this.bullets, this.enemies, (bolt, enemy) => this.hit(bolt, enemy))
    this.physics.add.overlap(this.player, this.enemies, (_, enemy) => this.hurt(enemy))
    this.physics.add.overlap(this.player, this.drops, (_, drop) => this.collect(drop))
    this.keys = this.input.keyboard.addKeys({
      up: "W", down: "S", left: "A", right: "D",
      up2: "UP", down2: "DOWN", left2: "LEFT", right2: "RIGHT",
    })
    this.input.keyboard.on("keydown-ESC", () => controller.pause())
    this.input.keyboard.on("keydown-Q", event => { if (!event.repeat) this.combat?.castManual(0) })
    this.input.keyboard.on("keydown-E", event => { if (!event.repeat) this.combat?.castManual(1) })
    this.cameras.main.startFollow(this.player, true, .12, .12)
    // Panel bounds can change before the engine gets its next resize tick.
    const viewport = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0 && (this.scale.width !== width || this.scale.height !== height)) {
        this.scale.setParentSize(width, height)
      }
    })
    viewport.observe($("game"))
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => viewport.disconnect())
    this.physics.world.pause()
    controller.ready(this)
  }
  paintForest() {
    const rng = new Phaser.Math.RandomDataGenerator(["border-forest-v1"])
    const g = this.add.graphics().setDepth(-10)
    g.fillStyle(0x304a3b).fillRect(0, 0, W, H)
    for (let i = 0; i < 1100; i++) {
      const x = rng.between(0, W), y = rng.between(0, H)
      g.fillStyle(rng.pick([0x365442, 0x3c5946, 0x2b4337, 0x405846]), .85)
      g.fillEllipse(x, y, rng.between(12, 48), rng.between(7, 19))
    }
    // A broken stone circle gives the arena a fixed, readable landmark.
    for (let i = 0; i < 19; i++) {
      const angle = i / 19 * Math.PI * 2
      const x = W / 2 + Math.cos(angle) * 175, y = H / 2 + Math.sin(angle) * 125
      g.fillStyle(0x283b32).fillEllipse(x + 3, y + 6, 32, 22)
      g.fillStyle(i % 3 ? 0x788578 : 0x929888).fillRoundedRect(x - 12, y - 12, 25, 15, 3)
      g.lineStyle(1, 0xa3ac94, .5).lineBetween(x - 8, y - 9, x + 8, y - 9)
    }
    for (let i = 0; i < 50; i++) {
      const x = rng.between(50, W - 50), y = rng.between(40, H - 40)
      if (Math.hypot(x - W / 2, y - H / 2) < 230) continue
      g.fillStyle(0x203b30, .7).fillEllipse(x + 7, y + 25, 65, 28)
      g.fillStyle(0x52624a).fillRect(x - 4, y - 5, 8, 33)
      g.fillStyle(0x203c32).fillTriangle(x, y - 58, x - 28, y + 5, x + 28, y + 5)
      g.fillStyle(0x3a6045).fillTriangle(x - 2, y - 53, x - 21, y - 9, x + 12, y - 9)
    }
    for (let i = 0; i < 70; i++) {
      const x = rng.between(25, W - 25), y = rng.between(25, H - 25)
      g.fillStyle(rng.pick([0xb5ba80, 0xad91af, 0x86aeba])).fillCircle(x, y, 2)
    }
  }
  loadRun(run) {
    this.physics.world.pause()
    this.combat?.destroy(); this.combat = null
    for (const group of [this.enemies, this.bullets, this.drops]) group.clear(true, true)
    this.meta = run
    this.rng = new Phaser.Math.RandomDataGenerator([run.seed])
    this.elapsed = 0; this.level = 1; this.xp = 0; this.kills = 0; this.partnerKills = 0
    this.nextId = 1; this.ranks = Object.fromEntries(Object.keys(UPGRADES).map(key => [key, 0]))
    this.choices = []; this.spawnAt = 700; this.attackAt = 300; this.supportAt = 1500; this.hurtUntil = 0
    this.hp = this.maxHp(); this.shield = 0; this.bossSpawned = false; this.outcome = "playing"; this.lowHealth = false
    this.player.setTexture(run.player_class).setPosition(W / 2, H / 2).setVelocity(0)
    this.companion.setTexture(run.companion_class).setPosition(W / 2 - 55, H / 2 + 20).setVelocity(0)
    const s = run.snapshot
    if (s) {
      this.rng.state(s.rng); this.elapsed = s.elapsed; this.level = s.level; this.xp = s.xp
      this.kills = s.kills; this.partnerKills = s.partner_kills; this.nextId = s.next_id
      this.ranks = { ...(s.ranks || this.ranks) }; this.choices = [...s.choices]; this.spawnAt = s.spawn_at
      this.attackAt = s.attack_at; this.supportAt = s.support_at; this.hurtUntil = s.hurt_until
      this.hp = s.player.hp; this.shield = s.shield; this.bossSpawned = s.boss_spawned; this.outcome = s.outcome
      this.player.setPosition(s.player.x, s.player.y); this.companion.setPosition(s.companion.x, s.companion.y)
      for (const e of s.enemies) this.makeEnemy(e)
      for (const b of s.bullets) this.makeBullet(b)
      for (const d of s.drops) this.makeDrop(d)
    }
    if (run.rules >= 2) this.combat = new SkillCombat(this, controller, s)
    mountSkillHud(this)
    this.combat?.paint()
    this.activeRun = true; this.setPaused(true); this.updateHud()
    $("hud").hidden = false; $("companion-line").hidden = false; $("pause").disabled = false
    $("companion-text").textContent = `${run.character} · ${CLASSES[run.companion_class]} · 默契 +${run.bonus}%`
    $("companion-line").title = $("companion-text").textContent
    $("build-label").textContent = `${CLASSES[run.player_class]} × ${CLASSES[run.companion_class]}`
  }
  maxHp() { return 100 + this.meta.loadout.bonuses.vitality + (this.combat ? this.combat.talent("player", "vitality") * 12 : this.ranks.vitality * 18) }
  moveSpeed() { return 170 * (1 + this.meta.loadout.bonuses.stride / 100) * (1 + (this.combat ? this.combat.talent("player", "stride") * .04 : this.ranks.stride * .06)) }
  pickupRange() { return 60 * (1 + this.meta.loadout.bonuses.reach / 100) + (this.combat ? this.combat.talent("player", "reach") * 12 : this.ranks.reach * 16) }
  xpNeeded() { return this.combat ? 14 + this.level * 7 : 10 + this.level * 5 }
  setPaused(value) {
    this.paused = value
    this.player?.setVelocity(0); this.companion?.setVelocity(0); this.touch = { x: 0, y: 0 }
    this.input.keyboard.resetKeys()
    if (value) this.physics.world.pause()
    else this.physics.world.resume()
    $("joystick").hidden = value || !matchMedia("(pointer:coarse)").matches
    $("skill-bar").hidden = value || !this.combat
    $("auto-skills").hidden = value || !this.combat
  }
  next() { return this.nextId++ }
  makeEnemy(e) {
    const enemy = this.enemies.create(e.x, e.y, e.kind).setScale(e.kind === "boss" ? 1.45 : e.kind === "brute" ? .85 : .62).setDepth(6)
    enemy.body.setCircle(19, 13, 29)
    enemy.setData({ id: e.id, kind: e.kind, hp: e.hp })
    return enemy
  }
  makeBullet(b) {
    const bolt = this.bullets.create(b.x, b.y, "bolt").setDepth(12)
    bolt.body.setCircle(7, 3, 3)
    if (b.owner === "companion") bolt.setTint(0x99c7ff)
    bolt.setData({ id: b.id, life: b.life, damage: b.damage, owner: b.owner })
    if (b.skill) {
      bolt.setData({ skill: b.skill, pierce: b.pierce, hit_ids: [...b.hit_ids] })
      bolt.setTint(b.skill === "fire" ? 0xefae76 : 0x8bd8ca)
      if (this.meta.rules === 3) {
        bolt.setData("form", b.form)
        bolt.setTexture(`bolt-${b.form === "base" ? b.skill : b.form}`).clearTint()
        bolt.body.setCircle(7, 9, 9); bolt.setRotation(Math.atan2(b.vy, b.vx))
        if (b.form !== "base") bolt.setScale(1.15)
      }
    }
    bolt.setVelocity(b.vx, b.vy)
    return bolt
  }
  makeDrop(d) {
    if (this.drops.countActive() >= 160) {
      const drop = this.drops.getFirstAlive()
      drop.setData("amount", drop.getData("amount") + d.amount)
      return
    }
    const drop = this.drops.create(d.x, d.y, "xp").setScale(.65).setDepth(5)
    drop.body.setCircle(9)
    drop.setData({ id: d.id, amount: d.amount })
  }
  spawn() {
    if (this.enemies.countActive() >= 150) return
    const angle = this.rng.realInRange(0, Math.PI * 2), distance = this.rng.between(370, 560)
    const kind = this.elapsed > 180000 && this.rng.frac() < .18 ? "brute" : this.rng.frac() < .22 ? "wisp" : "slime"
    const scale = 1 + this.elapsed / 240000
    this.makeEnemy({ id: this.next(), kind, hp: (kind === "brute" ? 65 : kind === "wisp" ? 13 : 24) * scale,
      x: Phaser.Math.Clamp(this.player.x + Math.cos(angle) * distance, 35, W - 35),
      y: Phaser.Math.Clamp(this.player.y + Math.sin(angle) * distance, 35, H - 35) })
  }
  nearest(source, range) {
    let target = null, distance = range * range
    for (const e of this.enemies.getChildren()) {
      const d = Phaser.Math.Distance.Squared(source.x, source.y, e.x, e.y)
      if (d < distance) { target = e; distance = d }
    }
    return target
  }
  shoot(source, owner) {
    if (this.combat) return this.combat.shoot(source, owner)
    const isPlayer = owner === "player", kind = isPlayer ? this.meta.player_class : this.meta.companion_class
    const target = this.nearest(source, kind === "guardian" ? 180 : 520)
    if (!target) return
    const angle = Phaser.Math.Angle.Between(source.x, source.y, target.x, target.y)
    const count = isPlayer ? 1 + Math.min(3, this.ranks.multishot) : 1
    const damage = (kind === "guardian" ? 28 : 20) * (1 + this.meta.loadout.bonuses.power / 100)
      * (isPlayer ? 1 + this.ranks.power * .18 : (1 + this.ranks.partner * .2) * (1 + this.meta.bonus / 100) * .75)
    for (let i = 0; i < count && this.bullets.countActive() < 160; i++) {
      const a = angle + (i - (count - 1) / 2) * .18
      const speed = kind === "guardian" ? 500 : 430
      this.makeBullet({ id: this.next(), x: source.x, y: source.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        life: kind === "guardian" ? 340 : 1200, damage, owner })
    }
  }
  hit(bolt, enemy) {
    if (this.combat) return this.combat.hit(bolt, enemy)
    if (this.paused || !bolt.active || !enemy.active) return
    enemy.setData("hp", enemy.getData("hp") - bolt.getData("damage"))
    const owner = bolt.getData("owner")
    bolt.destroy()
    if (enemy.getData("hp") > 0) return
    const kind = enemy.getData("kind")
    const x = enemy.x, y = enemy.y
    enemy.destroy(); this.kills++
    if (owner === "companion") this.partnerKills++
    this.makeDrop({ id: this.next(), x, y, amount: kind === "brute" ? 12 : kind === "wisp" ? 5 : 4 })
    if (kind === "boss") this.end("cleared")
  }
  hurt(enemy) {
    if (this.paused || this.elapsed < this.hurtUntil || !enemy.active) return
    let amount = enemy.getData("kind") === "boss" ? 28 : enemy.getData("kind") === "brute" ? 18 : 9
    const blocked = Math.min(this.shield, amount)
    this.shield -= blocked; amount -= blocked
    this.hp = Math.max(0, this.hp - amount); this.hurtUntil = this.elapsed + 700
    if (this.hp / this.maxHp() <= .3 && !this.lowHealth) {
      this.lowHealth = true; controller.notice(`${this.meta.character}：先拉开距离，我在你身边。`)
    }
    if (this.hp <= 0) this.end("defeated")
    else this.combat?.onHurt(enemy)
  }
  collect(drop) {
    if (this.paused || !drop.active) return
    this.xp = Math.min(10000, this.xp + drop.getData("amount")); drop.destroy()
    this.checkLevel()
  }
  checkLevel() {
    if (this.combat) return this.combat.checkLevel()
    if (this.xp < this.xpNeeded() || this.choices.length || this.level >= 65) return
    const pool = Object.keys(UPGRADES).filter(key => this.ranks[key] < (key === "multishot" ? 3 : 8))
    if (!pool.length) { this.xp = this.xpNeeded(); return }
    this.xp -= this.xpNeeded(); this.level++
    this.choices = []
    // Always include a companion upgrade while one is still available.
    const support = pool.filter(key => key === "partner" || key === "ward")
    if (support.length) this.choices.push(support[this.rng.between(0, support.length - 1)])
    while (this.choices.length < 3 && pool.some(key => !this.choices.includes(key))) {
      const options = pool.filter(key => !this.choices.includes(key))
      this.choices.push(options[this.rng.between(0, options.length - 1)])
    }
    this.setPaused(true); controller.upgrades(true)
  }
  choose(key) {
    if (this.combat) return this.combat.choose(key)
    if (!this.choices.includes(key)) return
    this.ranks[key]++
    if (key === "vitality") { this.hp = Math.min(this.maxHp(), this.hp + 18); this.lowHealth = this.hp / this.maxHp() <= .3 }
    this.choices = []
    controller.play()
    this.checkLevel()
    if (!this.choices.length) controller.save().catch(error => controller.failure(error))
  }
  end(outcome) {
    if (this.outcome !== "playing") return
    this.outcome = outcome; this.setPaused(true)
    controller.finish()
  }
  snapshot() {
    const clampX = x => Phaser.Math.Clamp(x, 0, W), clampY = y => Phaser.Math.Clamp(y, 0, H)
    const snapshot = {
      rules: 1, elapsed: this.elapsed, rng: this.rng.state(),
      player: { x: this.player.x, y: this.player.y, hp: this.hp },
      companion: { x: clampX(this.companion.x), y: clampY(this.companion.y) },
      enemies: this.enemies.getChildren().map(e => ({
        id: e.getData("id"), kind: e.getData("kind"), x: clampX(e.x), y: clampY(e.y), hp: e.getData("hp"),
      })),
      bullets: this.bullets.getChildren().map(b => ({
        id: b.getData("id"), x: clampX(b.x), y: clampY(b.y), vx: b.body.velocity.x, vy: b.body.velocity.y,
        life: b.getData("life"), damage: b.getData("damage"), owner: b.getData("owner"),
        ...(this.combat ? { skill: b.getData("skill"), pierce: b.getData("pierce"), hit_ids: [...b.getData("hit_ids")] } : {}),
        ...(this.meta.rules === 3 ? { form: b.getData("form") } : {}),
      })),
      drops: this.drops.getChildren().map(d => ({
        id: d.getData("id"), x: clampX(d.x), y: clampY(d.y), amount: d.getData("amount"),
      })),
      level: this.level, xp: this.xp, kills: this.kills, partner_kills: this.partnerKills,
      next_id: this.nextId, ranks: { ...this.ranks }, choices: [...this.choices],
      spawn_at: this.spawnAt, attack_at: this.attackAt, support_at: this.supportAt,
      hurt_until: this.hurtUntil, shield: this.shield, boss_spawned: this.bossSpawned, outcome: this.outcome,
    }
    if (this.combat) {
      delete snapshot.ranks
      Object.assign(snapshot, { rules: this.meta.rules }, this.combat.data())
    }
    return snapshot
  }
  updateHud() {
    $("health-text").textContent = `生命 ${Math.ceil(this.hp)} / ${this.maxHp()}`
    $("health-fill").style.width = `${Math.max(0, this.hp / this.maxHp()) * 100}%`
    $("health-fill").style.background = this.hp / this.maxHp() <= .3 ? "#d38b96" : "#8ebc91"
    $("ward-text").textContent = this.shield > 0 ? `护盾 ${Math.ceil(this.shield)}` : ""
    $("clock").textContent = `${timeText(this.elapsed)} / 20:00`
    $("kills").textContent = `击败 ${this.kills}`
    $("level").textContent = `Lv.${this.level}`
    $("xp-fill").style.width = `${Math.min(100, this.xp / this.xpNeeded() * 100)}%`
    $("objective").textContent = this.bossSpawned ? "击败林地守望者" : this.elapsed < 180000 ? "抵御来袭 · 收集魔力结晶" : "深入林地 · 形成你的构筑"
    updateSkillHud(this)
  }
  update(_, rawDelta) {
    if (!this.activeRun || this.paused) return
    const delta = Math.min(50, Math.max(0, Math.round(rawDelta)))
    this.elapsed = Math.min(END, this.elapsed + delta)
    let x = Number(this.keys.right.isDown || this.keys.right2.isDown) - Number(this.keys.left.isDown || this.keys.left2.isDown) + this.touch.x
    let y = Number(this.keys.down.isDown || this.keys.down2.isDown) - Number(this.keys.up.isDown || this.keys.up2.isDown) + this.touch.y
    const length = Math.hypot(x, y)
    if (length > 1) { x /= length; y /= length }
    const speed = this.moveSpeed()
    if (this.combat && length > .01) this.combat.facing = { x: x / Math.hypot(x, y), y: y / Math.hypot(x, y) }
    this.player.setVelocity(x * speed, y * speed)
    const follow = Phaser.Math.Distance.Between(this.player.x - 48, this.player.y + 28, this.companion.x, this.companion.y)
    if (follow > 350) this.companion.setPosition(this.player.x - 48, this.player.y + 28)
    if (follow > 14) this.physics.moveTo(this.companion, this.player.x - 48, this.player.y + 28, speed * 1.15)
    else this.companion.setVelocity(0)
    this.ring.setPosition(this.player.x, this.player.y + 14)
    this.partnerRing.setPosition(this.companion.x, this.companion.y + 14)
    this.player.setAlpha(this.elapsed < this.hurtUntil ? .6 : 1)
    if (this.elapsed >= this.spawnAt) {
      this.spawn(); this.spawnAt = this.elapsed + Math.max(210, 1000 - this.elapsed / 1200)
    }
    if (!this.bossSpawned && this.elapsed >= 1080000) {
      this.bossSpawned = true
      this.makeEnemy({ id: this.next(), kind: "boss", x: Phaser.Math.Clamp(this.player.x + 300, 80, W - 80), y: this.player.y, hp: 4500 })
      controller.notice("林地守望者已经苏醒。")
    }
    if (!this.combat && this.elapsed >= this.attackAt) {
      this.shoot(this.player, "player"); this.attackAt = this.elapsed + 650 / (1 + this.ranks.haste * .1)
    }
    if (!this.combat && this.elapsed >= this.supportAt) {
      this.shoot(this.companion, "companion")
      if (this.meta.companion_class === "guardian" || this.ranks.ward) {
        this.shield = Math.max(this.shield, (12 + this.ranks.ward * 4) * (1 + this.ranks.partner * .2) * (1 + this.meta.bonus / 100))
      }
      this.supportAt = this.elapsed + (this.meta.companion_class === "guardian" ? 3500 : 1100)
    }
    for (const enemy of this.enemies.getChildren()) {
      const kind = enemy.getData("kind")
      const speed = (kind === "wisp" ? 76 : kind === "boss" ? 44 : 33) * (1 + Math.min(.6, this.elapsed / 1500000))
      this.physics.moveToObject(enemy, this.player, speed)
    }
    this.combat?.update(delta)
    if (this.outcome !== "playing") return
    for (const bolt of [...this.bullets.getChildren()]) {
      bolt.setData("life", bolt.getData("life") - delta)
      if (bolt.getData("life") <= 0 || bolt.x < 0 || bolt.x > W || bolt.y < 0 || bolt.y > H) bolt.destroy()
    }
    for (const drop of this.drops.getChildren()) {
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, drop.x, drop.y) < this.pickupRange()) {
        this.physics.moveToObject(drop, this.player, 330)
      } else drop.setVelocity(0)
    }
    this.updateHud()
    if (this.elapsed >= END) this.end("timeout")
    else controller.autosave()
  }
}

class Controller {
  constructor() { this.api = new AdventureApi(); this.scene = null; this.busy = false; this.saving = null; this.lastSaved = 0; this.noticeTimer = null }
  ready(scene) { this.scene = scene; this.refresh() }
  screen(title, eyebrow = "边境冒险") {
    $("screen").hidden = false
    $("hud").hidden = $("companion-line").hidden = true
    $("skill-bar").hidden = true
    $("auto-skills").hidden = true
    $("notice").hidden = true
    $("pause").disabled = true
    $("objective").textContent = title
    $("build-label").textContent = ""
    const body = $("screen-body")
    body.replaceChildren(element("p", eyebrow, "eyebrow"), element("h2", title))
    return body
  }
  notice(text) {
    $("notice").textContent = text
    clearTimeout(this.noticeTimer)
    this.noticeTimer = setTimeout(() => { $("notice").textContent = "" }, 5000)
  }
  async refresh() {
    this.scene?.setPaused(true)
    const body = this.screen("读取旅程")
    try {
      const view = await this.api.read()
      this.preflight(view)
      $("save-state").textContent = "旅程已读取"
    } catch (error) {
      body.append(element("p", errorText(error), "error"), button("重新读取", () => this.refresh()))
      $("save-state").textContent = "尚未连接"
    }
  }
  preflight(view) {
    const active = view.run?.status === "active"
    const body = this.screen(active ? "旅程仍在等你" : "与同行者一起出发", "第一章 / 边境林地")
    body.append(wallet(view.economy))
    body.append(element("p", active
      ? `${view.run.character} · ${CLASSES[view.run.player_class]} × ${CLASSES[view.run.companion_class]} · ${timeText(view.run.snapshot?.elapsed || 0)}`
      : "守住林地边境，在魔力回响中找到彼此的战斗节奏。", "lead"))
    if (active) {
      const actions = element("div", "", "actions")
      actions.append(button("继续旅程", () => this.resume(false), "primary"),
        button("接管此旅程", () => {
          if (confirm("接管后，另一个窗口将不能再保存这场冒险。")) this.resume(true)
        }), button("冒险商店", () => this.shop(), "", "ShoppingBag"))
      body.append(loadoutSummary(view), actions)
      return
    }
    const party = element("div", "", "party")
    const player = element("div"), partner = element("div")
    const playerSelect = document.createElement("select"), partnerSelect = document.createElement("select"), characterSelect = document.createElement("select")
    playerSelect.id = "player-class"; partnerSelect.id = "partner-class"; characterSelect.id = "character"
    for (const select of [playerSelect, partnerSelect]) {
      for (const [key, name] of Object.entries(select === playerSelect ? { guardian: "突击剑 · 迅斩 / 突进", mage: "火术 · 火丸 / 焰环" }
        : { guardian: "守护剑 · 回势斩 / 岩甲", mage: "引风术 · 风刃 / 引风" })) {
        const option = element("option", name); option.value = key; select.append(option)
      }
    }
    partnerSelect.value = "mage"
    playerSelect.value = "mage"
    for (const name of view.characters) {
      const option = element("option", name); option.value = name; characterSelect.append(option)
    }
    if (view.characters.includes(view.current_character)) characterSelect.value = view.current_character
    const label = (text, id) => { const l = element("label", text); l.htmlFor = id; return l }
    player.append(label("你的流派", "player-class"), playerSelect)
    partner.append(label("同行者", "character"), characterSelect, label("同行流派", "partner-class"), partnerSelect)
    characterSelect.className = "character-select"
    party.append(player, partner); body.append(party, loadoutSummary(view))
    const actions = element("div", "", "actions")
    const start = button("进入林地", () => this.start({
      character: characterSelect.value, player_class: playerSelect.value, companion_class: partnerSelect.value,
    }), "primary")
    start.disabled = !view.characters.length
    actions.append(start, button("冒险商店", () => this.shop(), "", "ShoppingBag")); body.append(actions)
    if (!view.characters.length) body.append(element("p", "请先在宿主中选择一位角色，再重新读取。", "muted"))
    if (view.run?.status === "ended") {
      const last = element("div", "", "last-journey")
      last.append(element("span", `上次旅程 ${timeText(view.run.snapshot.elapsed)} · 击败 ${view.run.snapshot.kills}`, "muted"),
        button("查看结算", () => this.results(view.run)))
      body.append(last)
    }
  }
  async shop(message = "") {
    this.scene?.setPaused(true)
    const body = this.screen("冒险商店", "营地 / 出征准备")
    try {
      const view = await this.api.read()
      renderShop(body, view, (operation, upgrade, level) => this.trade(operation, upgrade, level), () => this.refresh())
      if (message) {
        const feedback = element("p", message, "shop-feedback")
        feedback.setAttribute("role", "status")
        body.append(feedback)
      }
      $("save-state").textContent = message ? "交易已保存" : "商店已读取"
    } catch (error) {
      if (message) body.append(element("p", message, "shop-feedback"))
      body.append(element("p", errorText(error), "error"), button("重新读取商店", () => this.shop(message)))
      $("save-state").textContent = message ? "交易已保存 · 待刷新" : "商店尚未读取"
    }
  }
  trade(operation, upgrade, level) {
    return this.action(async () => {
      const result = await this.api.mutate(operation, { upgrade, level })
      await this.shop(this.tradeMessage(result))
    })
  }
  tradeMessage(result) {
    const t = result.transaction, name = this.api.view.shop.find(item => item.id === t.upgrade).name
    return result.operation === "buy" ? `${name}已强化至 ${t.after} 阶 · 花费 ${t.amount} 冒险金币`
      : `${name}已退还一阶 · 返还 ${t.amount} 冒险金币`
  }
  async action(task) {
    if (this.busy) return
    this.busy = true
    const buttons = [...$("screen-body").querySelectorAll("button")].map(node => [node, node.disabled])
    for (const [node] of buttons) node.disabled = true
    try { await task() }
    catch (error) { this.failure(error) }
    finally {
      this.busy = false
      for (const [node, disabled] of buttons) if (node.isConnected) node.disabled = disabled
    }
  }
  start(values) {
    return this.action(async () => {
      const ack = await this.api.mutate("start", { rules: this.api.view.rules, ...values })
      const view = await this.api.read()
      if (!view.owns_control || view.run?.status !== "active" || view.run.id !== ack.run_id) throw new Error("无法取得这场冒险的控制，请重新读取。")
      this.scene.loadRun(view.run); this.lastSaved = 0; this.play()
      await this.save(false)
    })
  }
  resume(takeover) {
    return this.action(async () => {
      const ack = await this.api.mutate("claim", { run_id: this.api.view.run.id, takeover })
      const view = await this.api.read()
      if (!view.owns_control || view.run?.status !== "active" || view.run.id !== ack.run_id) throw new Error("控制已发生变化，请重新读取。")
      this.scene.loadRun(view.run); this.lastSaved = this.scene.elapsed
      if (this.scene.choices.length) this.upgrades()
      else this.play()
    })
  }
  play() {
    if (document.hidden || !document.hasFocus()) { this.pause(true); return }
    $("screen").hidden = true; this.scene.setPaused(false)
    mountSkillHud(this.scene); $("skill-bar").hidden = !this.scene.combat
    $("hud").hidden = $("companion-line").hidden = false
    $("notice").hidden = false
    $("build-label").textContent = `${CLASSES[this.scene.meta.player_class]} × ${CLASSES[this.scene.meta.companion_class]}`
    this.scene.updateHud()
    $("pause").disabled = false
  }
  pause(force = false) {
    if (!this.scene?.activeRun || this.scene.outcome !== "playing" || (this.scene.paused && !force)) return
    this.scene.setPaused(true)
    if (this.api.pending) return
    if (this.scene.choices.length) { this.upgrades(); return }
    const body = this.screen("稍作休息", `${timeText(this.scene.elapsed)} / 20:00`)
    const actions = element("div", "", "actions")
    actions.append(button("继续", () => this.play(), "primary"),
      button("保存并返回", () => this.action(async () => { await this.save(true); this.scene.activeRun = false; await this.refresh() })),
      button("结束本次旅程", () => {
        if (confirm("结束后将不能继续本次旅程。")) this.scene.end("retreated")
      }, "danger"))
    if (this.scene.combat) {
      actions.append(button("技能图鉴", () => this.codex(), "", "BookOpen"))
      body.append(buildDetails(this.scene.snapshot()))
    }
    body.append(actions)
  }
  codex() {
    if (!this.scene.combat) return
    this.scene.setPaused(true)
    const body = this.screen("技能图鉴", "修行 / 分支与复合进化")
    body.append(button("返回", () => this.scene.choices.length ? this.upgrades() : this.pause(true), "", "ArrowLeft"))
    renderCodex(body, this.scene)
  }
  upgrades(checkpoint = false) {
    if (this.api.pending) return
    this.scene.setPaused(true)
    const body = this.screen("选择成长", `等级 ${this.scene.level}`)
    if (this.scene.combat) {
      body.querySelector("h2").textContent = "选择研习"
      renderStudy(body, this.scene)
      if (checkpoint) this.save().catch(error => this.failure(error))
      return
    }
    const grid = element("div", "", "upgrade-grid")
    for (const key of this.scene.choices) {
      const [name, who, description] = UPGRADES[key]
      const card = button("", () => { this.scene.choose(key) }, "upgrade")
      card.dataset.upgrade = key
      card.append(element("span", `${who} · ${this.scene.ranks[key] + 1} 阶`, "tag"),
        element("strong", name), element("span", description))
      grid.append(card)
    }
    body.append(grid)
    if (checkpoint) this.save().catch(error => this.failure(error))
  }
  async save(exit = false, finish = false) {
    const previous = this.saving
    const snapshot = this.scene.snapshot()
    const runId = this.scene.meta.id
    const task = (async () => {
      if (previous) await previous
      if (this.api.pending) throw new Error("请先确认上次保存。")
      $("save-state").textContent = "正在保存"
      const result = await this.api.mutate(finish ? "finish" : exit ? "release" : "checkpoint", {
        run_id: runId, snapshot,
      })
      if (finish) this.api.view.run = {
        ...this.scene.meta, snapshot, status: "ended", settlement: result.settlement,
      }
      this.lastSaved = snapshot.elapsed
      $("save-state").textContent = `已保存 ${timeText(snapshot.elapsed)}`
    })()
    this.saving = task
    try {
      await task
    } finally { if (this.saving === task) this.saving = null }
    if (exit) $("hud").hidden = $("companion-line").hidden = true
  }
  autosave() {
    if (this.scene.elapsed - this.lastSaved < 10000 || this.saving || this.busy || this.api.pending) return
    this.save().catch(error => this.failure(error))
  }
  failure(error) {
    this.scene?.setPaused(true)
    const financial = ["buy", "refund"].includes(this.api.pending?.operation)
    const body = this.screen(financial ? "交易尚待确认" : "旅程已暂停")
    body.append(element("p", errorText(error), "error"))
    const actions = element("div", "", "actions")
    if (this.api.pending) actions.append(button("确认上次操作", () => this.action(async () => {
      const args = this.api.pending
      const result = await this.api.retry()
      $("save-state").textContent = `已保存 ${timeText(result.elapsed)}`
      this.lastSaved = result.elapsed
      if (args.operation === "buy" || args.operation === "refund") await this.shop(this.tradeMessage(result))
      else if (args.operation === "finish") {
        this.api.view.run = { ...this.scene.meta, snapshot: args.values.snapshot, status: "ended", settlement: result.settlement }
        this.results()
      }
      else if (args.operation === "release") {
        this.scene.activeRun = false
        await this.refresh()
      }
      else if (args.operation === "checkpoint" && this.scene.activeRun) {
        if (this.scene.outcome !== "playing") await this.finish()
        else if (this.scene.choices.length) this.upgrades()
        else { this.scene.setPaused(false); this.pause() }
      } else await this.refresh()
    }), "primary"))
    actions.append(button(financial ? "重新读取商店" : "读取已保存进度", () => {
      if (this.scene?.activeRun && !confirm("读取会放弃尚未确认保存的进度，继续吗？")) return
      this.api.pending = null; this.api.pendingView = null; this.scene.activeRun = false
      if (financial) this.shop()
      else this.refresh()
    }))
    body.append(actions)
    $("save-state").textContent = financial ? "交易状态待确认" : "保存状态待确认"
  }
  async finish() {
    this.scene.setPaused(true)
    const body = this.screen("整理本次旅程")
    body.append(element("p", "正在保存结果。", "muted"))
    try { await this.save(false, true); this.results() }
    catch (error) { this.failure(error) }
  }
  results(run = this.api.view.run) {
    this.scene.activeRun = false
    $("pause").disabled = true
    const snapshot = run.snapshot
    const title = { cleared: "林地的回响归于平静", defeated: "这次旅程暂告一段落", retreated: "平安归来", timeout: "留待下一次挑战" }[snapshot.outcome]
    const body = this.screen(title, `${run.character} · 与你同行`)
    const stats = element("div", "", "result-stats")
    for (const [label, value] of [["旅途时间", timeText(snapshot.elapsed)], ["击败敌人", snapshot.kills], ["同行击败", snapshot.partner_kills]]) {
      const item = element("div", label, "muted"); item.append(element("strong", String(value))); stats.append(item)
    }
    body.append(stats, settlementDetails(run.settlement), buildDetails(snapshot))
    const actions = element("div", "", "actions")
    actions.append(button("返回营地", () => this.refresh(), "primary"),
      button("冒险商店", () => this.shop(), "", "ShoppingBag")); body.append(actions)
    $("save-state").textContent = run.settlement === null ? "旧版结果已读取" : "结果与金币已保存"
  }
}

export const controller = new Controller()
$("pause").addEventListener("click", () => controller.pause())
document.addEventListener("visibilitychange", () => { if (document.hidden) controller.pause(true) })
window.addEventListener("blur", () => controller.pause(true))
const joystick = $("joystick")
function touchMove(event) {
  const rect = joystick.getBoundingClientRect()
  let x = (event.clientX - rect.left - rect.width / 2) / 36, y = (event.clientY - rect.top - rect.height / 2) / 36
  const length = Math.hypot(x, y)
  if (length > 1) { x /= length; y /= length }
  controller.scene.touch = { x, y }
  joystick.firstElementChild.style.transform = `translate(${x * 30}px,${y * 30}px)`
}
joystick.addEventListener("pointerdown", event => { joystick.setPointerCapture(event.pointerId); touchMove(event) })
joystick.addEventListener("pointermove", event => { if (joystick.hasPointerCapture(event.pointerId)) touchMove(event) })
for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) joystick.addEventListener(name, () => {
  if (controller.scene) controller.scene.touch = { x: 0, y: 0 }
  joystick.firstElementChild.style.transform = ""
})

export const game = new Phaser.Game({
  type: Phaser.AUTO, parent: "game", backgroundColor: "#304a3b",
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: "arcade", arcade: { gravity: { x: 0, y: 0 }, debug: false } },
  scene: Forest, audio: { noAudio: true }, render: { antialias: true, roundPixels: true },
})
