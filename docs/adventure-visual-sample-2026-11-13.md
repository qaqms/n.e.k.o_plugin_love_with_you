# 0.8.2：冒险视觉整合样板

## 已接入的范围

- 林地：程序绘制的纹理地表、小径、石铺遗迹、残墙与树冠；固定装饰种子，地表只在创建时绘制。
- 人物：剑卫、元素使按玩家/同行提供不同配色；四向待机、行走、出招、受伤帧。256 个人物帧与 12 个史莱姆/游灵帧装入一张本地图集，原有 64×72 帧尺寸、缩放与碰撞体保持。
- 技能：火、风、冰及觉醒/融合弹体重绘；弹体拖尾、施放与命中反馈；剑技斩弧、焰环火舌、引风流线、凝霜碎冰晶体。
- 界面：中性深色与金色/青色归属标识；准备页外观预览、双方 HUD 头像、研习归属头像与元素标识、自动/主动技能冷却进度。
- 简化特效：顶部按钮可切换，初次打开跟随系统减少动态效果偏好。该选择只在当前面板会话保留，不写正式游戏存档。

这是一版使用原创原生矢量与程序场景的可玩整合样板。正式的日式手绘场景贴图、高分辨率立绘、表情套件、指定桌宠的专属形象、其余敌人/首领动画仍待制作。当前小头像从战斗素材派生，不称为已完成正式角色立绘。

## 规则与性能边界

战斗规则、存档版本、学习候选、命中几何、金币、奖励和宿主接口沿用 0.8.1。0.8.2 的外观不会替换宿主桌宠模型，也不修改关系立绘设置。

动画及瞬时特效使用保存的战斗时间。暂停不推进动作；重开旅程时清理短期表现。装饰粒子最多 180 个，爆发反馈最多 24 个；使用本地序号分布，不读取战斗 RNG，也不写进快照。敌方危险提示在友方效果上层绘制。

静态场景缓存、角色图集与粒子限额是已实现的预算措施，不代表已经达到指定 FPS。独立预览和无头浏览器不能代替真实宿主模型并行运行的性能验收。

## 验证

自动化覆盖：

- 角色方向/动作帧实际变化，暂停后帧保持；双方职业相同时使用不同的外观帧。
- 反复播放表现后，保存快照、战斗随机数和物理碰撞体尺寸/偏移保持原值。
- 粒子/爆发预算、简化特效按钮、图片实际解码，以及 1280px/390px 的准备、战斗和研习截图。
- 原有技能学习、双方成长归属、实际碰撞、Q/E、触屏与横屏、旧规则继续、保存恢复、经济结算、首领预警和协同回归。

触屏移动检查改为在按住摇杆期间等待实际位移，再释放并断言；避免把固定 400ms 墙钟时间当作浏览器启动时必然取得的模拟时间。横屏 HUD、通知和技能栏仍分别检查位置。

本轮执行结果：

- 冒险浏览器、协议、技能及遭遇回归：68 项全部通过。
- 后端冒险测试：140 项全部通过。
- 宿主插件 CLI 检查：0 错误，保留 `models` 字段与源目录没有独立 Git 仓库两项既有警告。
- 已查看 1280px 战场、390px 战场、390px 准备页及双方研习截图；检查了图集角色、晶体、火丸和树冠实际渲染。
- 宿主 Git 状态为空；未安装、重载或调用真实角色模型。

上述测试不代表完成全部后端测试、完整二十分钟真人试玩或真实宿主并行性能验收。

## 后续正式素材规格

完整路线见 `adventure-art-direction-2026-11-13.md`。后续素材必须保持双方可区分、脚底锚点稳定、危险提示可读，并用同一角色设定派生头像、立绘和战斗动画。

当前会话未提供内置图片生成工具。已核对 imagegen 技能；其 CLI/API 备选要求用户明确选择，不能自动启用。本轮没有调用图片生成 API，没有使用密钥或产生生图费用。

### 待使用的提示规格

以下仅为素材制作输入，没有执行生图：

```text
Use case: stylized-concept
Asset type: original fantasy game character design reference
Primary request: one original traveling swordsman, matching full-body view and waist-up portrait
Subject: short ash hair, silver shoulder armor, muted teal travel coat, burgundy scarf, straight sword and small shield
Style/medium: polished Japanese fantasy illustration; readable three-head-tall battle design derived from the same identity
Lighting: soft daylight from upper left
Constraints: preserve hairstyle, costume colors, weapon and accessories between views; no existing anime character, no labels, no logo, no watermark
```

```text
Use case: stylized-concept
Asset type: original fantasy game companion design reference
Primary request: one original traveling element mage, matching full-body view and waist-up portrait
Subject: pale lavender hair, blue travel robe, ivory front panel, small turquoise crystal staff, practical travel accessories
Style/medium: polished Japanese fantasy illustration; same drawing language, proportions and lighting as the swordsman reference
Lighting: soft daylight from upper left
Constraints: preserve identity between views; adult character; no existing anime character, no labels, no logo, no watermark
```

```text
Use case: stylized-concept
Asset type: top-down 2D fantasy forest environment concept
Primary request: a traversable woodland clearing with a weathered stone ritual platform, worn footpaths, broken masonry and trees framing the clearing
Style/medium: cohesive hand-painted game environment, restrained texture contrast in the playable center
Lighting: soft daylight from upper left, readable stone planes and contact shadows
Constraints: no characters, no HUD, no text, no logo, no watermark; preserve the existing top-down navigation and arena layout
```

正式图像如由内置工具或用户明确选择的 CLI 生成，应另行记录实际提示、工具模式、文件路径、来源与检查结果；角色动画仍需逐帧验证，不能直接把概念设定图切格当作动作帧。
