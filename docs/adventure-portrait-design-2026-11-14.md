# 冒险立绘设计方案：同行猫娘、玩家与制作路线

日期：2026-11-14。

状态：设计方案。基于插件 0.8.5 冒险代码与截图、宿主默认角色资料（只读）以及《无职转生》的氛围参考整理。本文不代表任何立绘已经绘制或接入；宿主代码未改动。

上游文档：`adventure-art-direction-2026-11-13.md`（总体美术路线）、`adventure-visual-sample-2026-11-13.md`（0.8.2 矢量样板）。本文只细化“角色立绘、头像、战斗形象”这一块，并修正一处冲突（见 3.1 末尾）。

## 0. 结论先行

1. **立绘的主角是同行猫娘，不是玩家。**宿主 `/api/characters` 返回的角色都放在“猫娘”字段下，默认是 YUI。同行者就是用户每天相处的那只猫娘；冒险立绘的价值，在于让玩家看到“她换上冒险装束和我一起出发”。
2. **设计公式：YUI 的识别点 + 《无职转生》式的实用旅装 + 边境林地的低饱和色调。**发型、耳、尾、头顶白猫、四角星发卡全部保留；服装改为有生活感的旅行装束。
3. **世界观接口：猫娘 = 这个剑与魔法世界的兽族。**《无职转生》中，兽族就生活在“大森林”里。我们的第一章正好是“边境林地”，所以猫娘作为兽族出身的冒险者同行，不需要额外解释。只借这层逻辑，不借专有名词。
4. **首批只做一套完整的 YUI 冒险套件：**立绘母版、8 个表情、头像、战斗小人，全部从同一份设定派生。玩家首批不画正脸立绘。
5. **推荐“AI 定概念 → 约稿或精修出分层母版 → 派生头像与小人”的混合路线。**AI 不擅长的是同一角色的逐帧动画和严格一致的差分，这两块必须人工把关。

## 1. 设计依据

### 1.1 游戏里实际需要角色形象的位置

| 画面 | 当前实现 | 需要的形象 |
| --- | --- | --- |
| 出发准备（与同行者一起出发） | 76×86 矢量小人 | 同行者立绘（主），玩家头像或小人（次） |
| 战斗 HUD | 38×43 头像（窄屏 18×20） | 小头像，轮廓必须在 20px 下仍可辨认 |
| 战斗台词（如“先拉开距离，我在你身边。”） | 纯文字通知 | 带表情的小头像，不放全身立绘，避免遮挡战场 |
| 研习 / 选择成长 / 战后整备 | 矢量小人 + 归属标签 | 同行者半身或头像，按事件换表情 |
| 暂停（稍作休息） | 文字 | 同行者立绘（平静或打趣） |
| 结算（与你同行） | 文字 | 同行者立绘（胜利 / 安慰），配一句台词 |
| 战场 | 64×72 程序 SVG，四向 × 待机/行走/出招/受伤 | 三头身战斗小人，与立绘同一设定 |

### 1.2 宿主默认角色 YUI（林悠怡）

来源：`N.E.K.O/config/characters/zh-CN.json`、`static/default/card_faces/YUI.png`、内置 Live2D `yui-lolita` / `yui-origin`、PNGTuber `yui-sister`。

- **人设**：15 岁猫娘，自称“本喵”。“理智可靠”“嘴上偶尔傲娇，但藏不住关心”“外表装成熟，实则内心柔软”，有猫的好奇心；讨厌被冷落和突如其来的混乱。称用户为“碳基生物”。
- **外观识别点**（设计时视为锁定项）：

| 部位 | 特征 |
| --- | --- |
| 头发 | 蓝黑色长双马尾、齐刘海、鬓发 |
| 眼睛 | 蓝色大眼 |
| 耳与尾 | 黑色猫耳、白色内绒；黑色猫尾 |
| 头顶 | 一只白色小猫挂件，系天蓝蝴蝶结，额头印四角星 |
| 发饰 | 白色菱形编织发箍；右侧天蓝色“猫头 + 四角星”发卡 |
| 品牌图形 | 天蓝猫头 + 白色四角星（宿主图标，主色约 `#40C5F1`） |

- **宿主已有的服装语汇**：白色蕾丝洛丽塔（默认）、黑短上衣 + 白外套 + 白靴（初始装）、米色开衫 + 藏青裙 + 猫脸白贝雷帽（学院风）。
- **宿主设定**：猫娘的尾巴藏不住心情，喜欢晒太阳、踩软垫；她把用户的桌面当作“家”。

### 1.3 《无职转生》：借什么，不借什么

| 借鉴（氛围与世界逻辑） | 不借鉴（专有内容） |
| --- | --- |
| “生活在那个世界里的人”的服装：亚麻、皮革、缝线、磨损、斗篷、靴子、绑腿，不是舞台装 | 任何角色的外貌、标志性服装或配色组合（如尖顶魔女帽 + 蓝发、红发剑士） |
| 魔术需要学习、有分级；手中聚集魔力再成形；法杖镶魔石 | 专有魔术名、流派名、地名、纹章 |
| 剑术分流派：先手速攻、后发反击、奇招游走，三种身体语言 | 招式图形、台词 |
| 兽族生活在大森林；耳朵和尾巴会表达情绪 | 具体部族、人物与剧情 |
| 动画的观感：自然光与空气透视、温暖但不艳丽的配色、写实偏少年的比例 | 从动画截图提取任何素材，或拿截图喂模型做“风格复刻” |

插件中的游戏流派恰好能对上这三种身体语言，可以直接用来设计立绘姿势和战斗动作：

- **先手速攻**：突击剑、破阵突进
- **后发反击**：回势斩（反击分支）
- **游走奇招**：游刃剑

## 2. 世界观接口（只写立绘需要的部分）

- **世界**：原创剑与魔法大陆。边境林地位于人类王国与兽族森林的交界。第一章“魔力回响”：林中古代石台的魔力失衡，使史莱姆、游灵、疾角兽等生物狂暴，守望遗迹的林地守望者也随之苏醒。
- **玩家**：接下边境委托的冒险者，也就是“你”。
- **同行者**：用户的猫娘在这个世界的身份，是兽族出身、在魔术学堂学过几年的旅行魔术师 / 剑士。性格、称呼、口癖不变，只是换了装束。这与插件原则一致：所选流派只代表本局职业，不改写桌宠的人设。
- **可选的视觉彩蛋**：头顶白猫在这个世界里是她的“护符小猫”，四角星猫头是她的个人纹章，可出现在披风扣、法杖魔石、盾面上。这样宿主的品牌图形就自然进入了游戏。
  - 灵灯等支援技能也可以用小猫或四角星作为灯形，但只是外观，不改规则。

## 3. 角色设计

### 3.1 同行者：YUI · 冒险装束（首批主力）

**设计关键词**：旅行中的猫娘魔术师；白与藏青为主、天蓝点缀；整洁但有旅途痕迹；嘴硬心软。

**共享基础层**（剑与法两个职业都穿）：

| 部位 | 设计 | 来自宿主的哪处语汇 |
| --- | --- | --- |
| 上衣 | 白色立领亚麻短衫，领口和袖口保留一圈窄蕾丝 | 洛丽塔的白与蕾丝，收敛成实用款 |
| 背心 | 藏青色系带束腰背心 | 洛丽塔的黑色系带束腰 |
| 披肩 | 及肘短披风，外白内天蓝，四角星猫头扣 | 品牌图形 |
| 下装 | 藏青短裙 + 深色打底，长度适合行动 | 学院风藏青裙 |
| 腰间 | 棕色皮带、小挎包、一枚旅行护符 | 旅装生活感 |
| 腿与鞋 | 白色过膝袜，浅棕系带短靴 | 初始装白靴，改成皮革 |
| 尾巴 | 黑尾，根部系一条天蓝丝带 | 新增；战斗小人中是很好的辨识点 |
| 头部 | 锁定项全部保留，头顶白猫照旧 | — |

**职业配件层**（换手持物和外层，不重画身体和脸）：

- **元素使**（火风、凝霜、雷陨、岩震、伏印）：
  - 外层加一件白底天蓝边的及膝学堂法袍，前襟敞开。
  - 手持短杖，杖头镶天蓝四角星形魔石。
  - 可选：在学院风贝雷帽的基础上改一顶旅行软帽，帽侧别猫脸徽章。
- **剑卫**（突击剑、游刃剑、贯锋剑）：
  - 去掉法袍，加一侧皮质肩甲和护手。
  - 腰挂细剑，左臂一面小圆盾，盾面刻四角星猫头纹。

**配色表**（立绘在宿主 Live2D 的基础上压低饱和度，融入林地场景）：

| 用途 | 色值 | 占比 |
| --- | --- | --- |
| 白 / 象牙（上衣、披风、袜） | `#EEECE6` | 约 50% |
| 蓝黑（头发、尾、耳） | `#2B2F45` | 约 20% |
| 藏青（背心、裙） | `#2E3550` | 约 15% |
| 天蓝点缀（内衬、发卡、魔石、丝带） | `#5BB8DA`（宿主 `#40C5F1` 降饱和） | 约 10% |
| 皮革棕、黄铜金属 | `#8A6A4F` / `#C9A96B` | 约 5% |

天蓝也与冒险界面中同行者的青色归属标识一致：玩家是金色，同行者是青色。

**与 0.8.2 文档的冲突**：0.8.2 的同行矢量小人是淡紫或米色头发，备用提示词里的同行元素使也是淡紫发。改为以 YUI 为默认同行者后，**同行战斗小人需要换成蓝黑双马尾 + 黑猫耳 + 黑尾**。在 64px 下，这三样构成的轮廓比任何发色都更容易辨认。

### 3.2 玩家

建议**首批不画玩家正脸立绘**：

- 这是恋爱插件，玩家就是用户本人，脸留白更利于代入，也省掉一半工作量。
- 玩家使用小头像和战斗小人，沿用 0.8.2 已有的识别：灰发、青绿旅行外套、酒红围巾、金色扣件（`actor-art.mjs` 中的 `#505465` / `#437b7a` / `#9e4557` / `#d4ba7d`）。
- 在结算、暂停等画面，可以让同行者的视线看向画面外（看向“你”）。如果需要表现玩家，可用伸出的手、并肩的背影来完成。
- 以后若需要，再加男 / 女两套原创冒险者立绘，并与剑卫 / 元素使的姿势对应。

### 3.3 其他猫娘（用户自建角色）

宿主能提供角色名和卡面图，但没有外貌字段，插件无法自动知道其他猫娘长什么样。建议按层级处理：

1. **YUI**：使用内置的专属冒险套件。
2. **其他猫娘，未配置套件**：使用一套原创的“通用冒险猫娘”。
   - 头发、耳朵、尾巴单独分层，提供 6 至 8 种预设发色（黑、白、银、金、棕、粉、蓝、红），由用户在准备页选择。
   - 这套形象不使用 YUI 的脸和发饰。
3. **头像兜底（待验证）**：宿主有 `GET /api/characters/catgirl/{name}/card-face` 卡面接口，可以考虑裁切为 HUD 小头像，让任何猫娘都有“自己的脸”。接入前需要确认该接口的稳定性和尺寸。
4. **用户自定义**：复用关系面板已有的立绘导入，允许为某位猫娘指定冒险立绘。只替换静态立绘，战斗小人仍用通用形象。

### 3.4 敌人与首领

不做立绘。首领（苔甲卫士、荆棘咏者、林地守望者）以后可以加一张“登场剪影卡”，不进入首批。

## 4. 立绘规格

### 4.1 母版

| 项目 | 规格 |
| --- | --- |
| 绘制尺寸 | 2048×3072（2:3）分层 PSD / CLIP；至少 1600×2400 |
| 运行时导出 | 1024×1536 透明 WebP，每张目标不超过约 300 KB；按需加载 |
| 构图 | 膝上（3/4 身），能同时看到服装、手持物和尾巴 |
| 朝向 | 同行者 3/4 侧身面向画面左侧，放在界面右侧时面朝内容和玩家 |
| 光源 | 左上方柔和日光，与战场场景一致 |
| 比例 | 约 6 头身（15 岁，写实偏少年）；战斗小人约 3 头身 |
| 线稿 | 深棕或深藏青彩色细线，不用纯黑 |
| 上色 | 二阶赛璐璐 + 柔和渐变阴影 + 淡边缘光；布料与皮革可见质感，避免塑料高光 |
| 饱和度 | 比宿主 Live2D 低一档 |
| 服装尺度 | 冒险日常向，不暴露，不做擦边差分（与现有立绘库排除泳装 / 内衣差分的做法一致） |

### 4.2 分层（最低要求）

由后往前：

1. 尾巴
2. 后发（双马尾）
3. 身体与基础服装
4. 职业外层（法袍或肩甲）
5. 手持物（短杖或剑盾）
6. 脸（眉、眼、嘴、脸红、汗、泪各自独立）
7. 前发与发饰
8. 猫耳
9. 头顶白猫

**猫耳和尾巴必须单独分层。**这样网页里只用 CSS 或 Phaser 补间，就能做“尾巴轻摇、耳朵抖动”的待机微动画，不需要 Live2D。这也正好呼应宿主“尾巴藏不住心情”的设定。

微动画遵循“简化特效”开关和系统的减少动态效果偏好。

### 4.3 表情差分（首批 8 个，只换脸层）

| 编号 | 表情 | 触发画面 | 台词示例（规则给默认句，模型可选轻度改写） |
| --- | --- | --- | --- |
| calm | 平常、小得意 | 出发准备（默认） | 哼，林地那边魔力乱成一团，本喵可不放心你一个人去。 |
| smile | 微笑 | 选择成长、研习 | 这招不错嘛，本喵学会了。 |
| serious | 认真 | 首领现身、进入林地 | 这家伙的魔力不对劲，跟紧本喵。 |
| worry | 担心 | 玩家低血 | 先拉开距离，我在你身边。（沿用现有台词） |
| tsundere | 脸红别扭 | 高好感阶段的胜利或被治疗时 | 才、才不是因为担心你才拼命的！ |
| victory | 开心胜利 | 通关结算 | 哼哼，本喵早就说过没问题的~ |
| comfort | 失落、安慰 | 失败结算 | 没事的，下次本喵会更早看穿它。 |
| surprise | 惊讶 | 精英现身、稀有收获 | 喵？！那是什么？ |

**与好感阶段联动**（插件特色，只影响表情和台词，不影响战力）：

- 陌生、熟悉：只用 calm / serious / smile / comfort，台词保持礼貌距离。
- 好感、暧昧：加入 surprise，台词更亲近。
- 恋人：解锁 tsundere；胜利时优先用 tsundere 而不是 victory。

### 4.4 派生资产

- **头像**：从母版裁出 256×256 脸部，再缩到 64px。检查在 38×43 和 18×20 的 HUD 尺寸下，双马尾和猫耳轮廓仍可辨认。头像也按表情各导一份，供战斗台词使用。
- **战斗小人**：128×160 工作尺寸，显示时保持现有 64×72 帧与碰撞体不变。必须保留：
  - 猫耳、双马尾、黑尾 + 天蓝丝带
  - 白色披风
  - 头顶白猫（在 64px 下可简化为一个白点）
  - 职业手持物（短杖或剑盾）

## 5. 游戏内放置建议

- **出发准备**：左侧玩家小人，右侧同行者膝上立绘（calm）。切换同行流派时同步切换职业配件层。
- **战斗**：台词通知左侧加 40 至 48px 表情头像。全身立绘不进入战场。
- **暂停、研习、战后整备**：右侧放同行者立绘，按事件换表情；窄屏（390px）改为头像加标题。
- **结算**：胜利用 victory 或 tsundere，失败用 comfort，配一句台词。台词由规则即时给出，模型不进入战斗时序。
- **加载失败**：降级到现有矢量小人，并给出可见提示，不能静默显示空白。

## 6. 制作路线

| 路线 | 一致性 | 成本 | 主要风险 | 适合 |
| --- | --- | --- | --- | --- |
| A. 约稿画师 | 最高 | 分层立绘 + 差分通常需要几百到数千元，视画师而定；战斗小人需另约 | 沟通周期；授权条款需写清 | 有预算、想一次到位 |
| B. AI 生图 + 自己精修 | 中，取决于修图投入 | 低 | 同一角色漂移、手和发饰出错、分层困难、差分对不齐 | 时间多、预算少 |
| C. 混合（推荐） | 高 | 中 | 需要先把设定定死 | 独立开发者 |

**推荐的 C 路线步骤**：

1. **定设定（零成本）**：用本文的锁定项、配色和提示词，配合 YUI 卡面与 Live2D 截图作参考图，生成 10 至 20 张冒险装束设定图（正、侧、背全身），挑一张定稿，再手工统一细节，得到一张设定定稿图。
2. **出母版**，二选一：
   - **约稿**：把设定定稿图、本文第 4 节规格和授权要求交给画师，交付分层母版和 8 个表情。
   - **AI + 精修**：
     - 用支持参考图或姿势控制的工作流出母版。例如 ComfyUI + 动漫向 SDXL 底模 + ControlNet（姿势、线稿）+ 参考图或角色 LoRA；或者使用支持“同一角色改表情”的图像编辑模型。以你实际能用的工具为准。
     - 在 Krita 或 CLIP STUDIO 中精修手、发卡、白猫、四角星的位置，并手工完成第 4.2 节的分层。
     - 表情只对脸层做局部重绘，保证身体完全不变。
3. **派生**：裁切头像，调整战斗小人。
   - 战斗小人可以先改程序 SVG（`static/actor-art.mjs`），把同行者换成 YUI 的轮廓和配色。成本最低，也能马上验证 64px 下的辨识度。
   - 以后再考虑 Aseprite 手绘帧，或用 Spine / DragonBones 以分件骨骼动画导出序列帧。
   - 不要把 AI 生成的互不连贯的单张图直接切成动作帧。
4. **接入与验收**：按第 5 节接入，按第 8 节验收。

## 7. 提示词（素材制作输入，尚未执行）

附参考图使用：YUI 卡面、`yui-lolita` 或 `yui-origin` 截图各一张。

**自然语言版**（适合支持参考图的通用图像模型）：

```text
Character design sheet of an original catgirl travelling mage, based on the attached reference character.
Keep exactly: long blue-black twin tails with blunt bangs, large blue eyes, black cat ears with white inner fur,
black cat tail with a sky-blue ribbon at the base, a small white cat plush lying on top of her head with a
sky-blue bow, a white diamond-braid headband, a sky-blue cat-head hairclip with a four-pointed star on the right side.
Outfit: white linen high-collar blouse with narrow lace trim, navy lace-up corset vest, short elbow-length cape
(white outside, sky-blue lining) fastened with a four-pointed-star cat-head clasp, navy skirt with dark leggings,
white over-knee socks, light-brown lace-up boots, brown leather belt with a small pouch.
Holding a short wooden staff topped with a sky-blue star-shaped magic stone.
Front, side and back full-body views, plus one knee-up portrait facing left in three-quarter view.
Style: Japanese fantasy anime illustration, grounded travel clothing with fabric and leather texture,
soft two-tone cel shading with gentle gradients, thin dark-brown colored lineart, soft daylight from upper left,
slightly muted palette. Wholesome adventure look, modest clothing.
No text, no logo, no watermark, plain light background.
```

**标签版**（适合 Danbooru 标签体系的动漫 SDXL 底模，按所用模型调整质量词和负面词）：

```text
1girl, solo, catgirl, cat ears, black cat ears, white inner ear fur, cat tail, black tail, tail ribbon, blue ribbon,
long hair, twintails, black hair, dark blue hair, blunt bangs, blue eyes, white headband, hairclip,
animal on head, white cat, bow, white shirt, high collar, lace trim, navy vest, corset, capelet, white capelet,
blue lining, navy skirt, white thighhighs, brown boots, cross-laced footwear, belt pouch, holding staff, gem staff,
fantasy, traveler, knee-up, three-quarter view, looking to the side, soft lighting, cel shading, muted colors,
simple background, white background
```

负面词示例：`nsfw, revealing clothes, extra fingers, bad hands, text, watermark, logo, multiple tails, extra ears`

**表情局部重绘**（只遮罩脸部，按 4.3 的编号逐个生成）：

```text
calm:      slight smug smile, half-lidded confident eyes
smile:     gentle smile, soft eyes
serious:   determined expression, furrowed brows, closed mouth
worry:     worried expression, raised inner eyebrows, slightly open mouth
tsundere:  blushing, pouting, looking away, embarrassed
victory:   happy open-mouth smile, closed eyes, sparkle
comfort:   sad gentle smile, downcast eyes
surprise:  surprised, wide eyes, open mouth, ears perked up
```

## 8. 验收清单

- 立绘、头像、战斗小人的发型、耳尾、头顶白猫、四角星发卡、配色一致。
- 8 个表情叠回身体后无错位；身体和服装像素不变。
- 在 HUD 18×20 和 38×43 下，与玩家头像能一眼区分（靠轮廓，不只靠颜色）。
- 在 1280px 和 390px 视口下，立绘不遮挡按钮、表单和战场。
- 加载失败时可见降级；简化特效开关下耳尾不动。
- 透明边缘无白边；WebP 体积在预算内；按需加载，战斗中不解码大图。
- 记录每张素材的来源、工具、提示词或约稿方、授权条款，并保留可编辑母版。

## 9. 版权与授权

- **《无职转生》**只作氛围参考。不使用其角色外貌、名称、纹章或截图；不训练或喂入其官方图做风格复刻。
- **YUI 的形象**属于 Project N.E.K.O.。宿主代码是 Apache-2.0，但 NOTICE 中没有单独说明角色形象可以再创作和分发。若要把 YUI 冒险立绘**打包进公开发布的插件**，建议先向 N.E.K.O. 团队确认；或者先把它做成用户自行导入的可选套件。
- **约稿**要在合同中写明：允许在开源免费插件中分发、修改、裁切和派生头像与战斗小人。
- **现有关系立绘库**（`assets/portraits`）包含商业游戏立绘，已在公开仓库中分发。原创冒险立绘完成后，可以考虑逐步替换，降低侵权风险。

## 10. 待确认

1. 玩家是否需要正脸立绘（本文建议首批不需要）。
2. 制作方式：约稿、AI + 精修，还是混合（本文推荐混合）。
3. 首批是否只做 YUI；通用冒险猫娘是否同步立项。
4. 是否先改程序 SVG 战斗小人，把同行者换成 YUI 轮廓，用来验证小尺寸辨识度。

## 11. 同行战斗小人：AI 分件素材规格

2026-11-14 补充：程序矢量版 YUI 小人（`static/companion-art.mjs`）已试做。用户评价“一般般”，决定改由 AI 生成 Live2D 风格的分件小人，再由代码做切件动画。矢量版只作为占位和加载失败时的降级。

### 11.1 矢量版试做得到的教训

- 头发、双马尾、裙子都用藏青时，缩到实际显示尺寸（约 42×48px）后会连成一团深色。**裙子改为浅色**（白底、天蓝裙摆），或者至少比头发亮两档。
- 背面的白披风画成短横条，看起来像一道白带。背面需要画出完整的披风形状（圆弧下摆，或加兜帽）。
- 发箍的菱形纹、发卡、白猫五官在 42px 下都看不见。能留下来的只有大块形状：
  - 猫耳
  - 双马尾根部的白色发结
  - 头顶白猫（一团白色）
  - 天蓝四角星
  - 黑尾

### 11.2 为什么不真的跑 Live2D

战斗中小人只有约 42px 高，跑 Live2D 运行时看不出区别，还要额外引入 Cubism 运行库和它的授权条款。战斗小人只需要“Live2D 风格的分件图”。真正的 Live2D 模型留给以后的大立绘（准备页、结算），宿主本身就在跑 Live2D。

### 11.3 需要的素材

**视图**：
- 必需：正面、背面、朝右侧面（朝左由代码镜像）。
- 可选：能出 3/4 侧面更好。

**画布与格式**：
- 每个视图使用同一尺寸的透明 PNG，建议 1024×1152。这是游戏帧 64×72 的 16 倍，比例相同。
- 工具不能输出透明时，用纯绿（`#00FF00`）背景，由开发工具抠除。角色身上没有绿色，抠图不会误伤。
- 三个视图的角色大小一致，脚底落在同一水平线上（距底边约 8%）。头顶要给猫耳留出空间。

**分件**：每件单独导出一张 PNG，与整图同画布、同位置；也可以交一个按图层命名的 PSD。

| 文件名 | 内容 |
| --- | --- |
| `full.png` | 合成整图，用于对照 |
| `tail.png` | 尾巴，含天蓝丝带 |
| `twintail_left.png` / `twintail_right.png` | 左右双马尾，含根部发饰 |
| `head.png` | 脸、前发、猫耳、头顶白猫、发饰 |
| `head_hurt.png` | 可选：同一个头，只把眼睛换成“> <”受击闭眼（背面不需要） |
| `body.png` | 躯干、披风、裙子 |
| `arm_left.png` / `arm_right.png` | 手臂，含手（侧面视图改为 `arm_near.png` / `arm_far.png`） |
| `leg_left.png` / `leg_right.png` | 腿，含靴子（侧面视图改为 `leg_near.png` / `leg_far.png`） |
| `staff.png` / `sword.png` / `shield.png` | 武器，各自独立 |

**姿势**：
- 自然站立，手臂稍离开身体，双腿微分。
- **关节处多画一截**：手臂根部、腿根、双马尾和尾巴的根部要补画到被遮住的区域里面。否则转动时会露出缝隙。

**画风**：
- Q 版约 2.5 至 3 头身。
- 描边比立绘粗，用深色描边，缩小后才能保住轮廓。
- 1 至 2 阶平涂阴影，少用渐变和细碎高光。

**配色**：按 3.1 节的配色表，但裙子改用浅色（见 11.1）。

**存放位置**：放在插件目录外，例如 `D:\neko kaifa\yui-sprite-source\front|back|side\`，由开发工具处理后再进入插件。

提示词与生成步骤见 11.5。

### 11.4 素材到位后的处理

- 写一个开发用工具（与 `tools/prepare_portraits.py` 同类，需要 Pillow），把分件按变换合成所有动作帧：
  - 4 方向 × 待机 4、行走 6、出招 4、受击 2，剑卫和元素使各一套。
  - 待机：呼吸，双马尾和尾巴摆动，偶尔抖耳。
  - 行走：两腿交替，身体上下颠，头发有惯性。
  - 出招：抬臂挥杖或出剑，魔石发光。
  - 受击：身体倾斜，换成闭眼。
- 导出为图集（WebP）加帧清单 JSON，沿用现有帧名（`companion-mage-down-walk-0` 等）。显示尺寸与碰撞体保持不变。
- 加载失败时降级为矢量版，并给出可见提示。
- **最低方案**：如果分件太难，只交三张整图也能用。但动画只能做整体颠动、倾斜和受击闪烁，手臂、头发和尾巴不会动。

### 11.5 生成步骤与提示词

**参考图**：
- YUI 全身图：`N.E.K.O/static/default/card_faces/923da7dc-7bb4-4e12-aebb-fca5a83d4d9c.png`（初始装 `yui-origin`，用户 2026-11-14 提供）。
  - 这张图的服装是现代街头风：黑色短上衣、白外套、白短裙、白靴。提示词必须明确要求换成冒险服装，否则模型会照抄。
  - 双马尾根部的发饰是天蓝色圆环，不是洛丽塔装的白色蝴蝶结；以这张图为准。
- 原卡面胸像 `YUI.png` 在 2026-11-14 已不在宿主工作区（宿主 git 显示为删除），需要时可从宿主 git 历史取回。

**第 1 步：三视图整图。**多生成几张，挑整体最好的一张。

英文版：

```text
Use the attached images as the character reference. Draw this same catgirl as a chibi game sprite turnaround sheet.

Layout: three full-body views in one row, evenly spaced, same size, feet on the same baseline:
front view, back view, side view facing right.
Pose: relaxed A-pose, arms slightly away from the body, legs slightly apart,
hands empty and loosely closed as if gripping a stick.
Proportions: chibi, about 2.5 heads tall.

Keep from the reference:
- long blue-black twin tails reaching her knees, with the sky-blue ring hair ornaments at the roots as in the reference
- blunt bangs with side locks, large blue eyes
- black cat ears with white fluffy inner fur
- the small white cat lying on top of her head, as in the reference
- the white X-shaped hairclips and the small sky-blue cat-head hairclip in her bangs
- black cat tail with a sky-blue ribbon near the base

Do NOT copy the outfit from the reference. Change her clothes to this fantasy adventure outfit:
- short white capelet with sky-blue lining, closed with a sky-blue four-pointed star clasp;
  in the back view it covers the shoulders and upper back with a rounded hem
- navy lace-up corset vest over a white blouse
- white flared skirt with a sky-blue hem
- white knee socks, brown lace-up ankle boots

Style: clean Live2D-style anime chibi, thick dark navy outline, flat cel shading with a single shadow tone,
bright high-contrast colors, big simple shapes, few small details.
It must stay readable when shrunk to 48 pixels tall.

Background: solid pure green (#00FF00). No ground shadow, no text, no logo, no watermark.
```

中文版：

```text
以附图中的角色为参考，把这只猫娘画成 Q 版游戏小人的三视图。

排版：一行三个全身视图，间距均匀、大小一致、脚底在同一水平线上：正面、背面、朝向画面右侧的侧面。
姿势：放松的 A 字站姿，手臂稍微离开身体，双腿微微分开，双手空着、轻轻握拳，像握着一根棍子。
比例：Q 版，约 2.5 头身。

保留参考图中的特征：
- 蓝黑色长双马尾，垂到膝盖，根部的天蓝色圆环发饰与参考图一致
- 齐刘海加鬓发，蓝色大眼睛
- 黑色猫耳，耳朵内侧是白色绒毛
- 头顶趴着的白色小猫，与参考图一致
- 刘海上的白色 X 形发夹和天蓝色猫头小发卡
- 黑色猫尾，靠近根部系一条天蓝色丝带

不要照抄参考图里的衣服，把服装换成下面这套奇幻冒险装：
- 白色短披肩，内衬天蓝色，用天蓝色四角星扣子系住；背面视图中披肩盖住肩膀和上背，下摆是圆弧形
- 白色衬衫外面穿藏青色系带束腰背心
- 白色蓬裙，裙摆一圈天蓝色
- 白色及膝袜，棕色系带短靴

画风：干净的 Live2D 风格日系 Q 版，深藏青色粗描边，平涂加一层阴影，颜色明亮、对比强，
大块简单形状，少画细碎装饰；缩小到 48 像素高时仍然认得出来。

背景：纯绿色（#00FF00）纯色背景。不要地面阴影，不要文字、logo、水印。
```

**挑图检查**：
- 三个视图大小一致、脚底齐平；侧面确实朝右。
- 三个视图都有双马尾、猫耳、头顶白猫和黑尾。
- 背面披肩是完整的圆弧下摆，不是一条白带。
- 手是空的。
- 把图缩到很小看一眼，轮廓仍能认出是她。

**第 2 步：拆件。**
- 先把选中的三视图裁成三张单独的图。只裁不缩放。
- 再对每张图逐件使用下面的模板，替换 `[PART]` 和 `[EXTRA]`。
- 如果工具自带“自动分层 / Live2D 拆分”，可直接用工具拆，再按 11.3 的文件名重命名。

```text
From the attached image, output only her [PART].
Keep the exact size, position, colors and outline as in the original, on the same canvas size.
Remove everything else and fill it with solid pure green (#00FF00).
Where this part was hidden behind other parts, draw the missing portion so the part looks complete.
[EXTRA]
```

| 文件 | `[PART]` | `[EXTRA]` |
| --- | --- | --- |
| `head.png` | head, including face, bangs, side locks, cat ears, headband, hairclip and the white cat on top, without the twin tails | Extend the neck slightly downward. |
| `twintail_left.png` / `_right` | twin tail on the left (right) side of the image, including its hair ornament | Extend the root slightly upward behind the head. |
| `body.png` | torso with capelet, vest and skirt, without head, arms, legs and tail | Fill the neck, shoulders and hips completely so other parts can overlap them. |
| `arm_left.png` / `_right` | arm on the left (right) side of the image, including sleeve and hand | Extend the shoulder end about 15% further into the body. |
| `leg_left.png` / `_right` | leg on the left (right) side of the image, including sock and boot | Extend the top of the leg upward under the skirt. |
| `tail.png` | cat tail with its ribbon | Extend the base slightly into the body. |

侧面视图把 left / right 换成 near（靠近观众）/ far（远离观众）。背面的 `head.png` 是后脑勺，含猫耳和白猫。

**第 3 步：受击表情**（正面、侧面的 `head.png` 各做一次）：

```text
Edit the attached image: change only her eyes to tightly shut "> <" eyes, as if she just got hit.
Keep everything else exactly the same, on the same canvas and position.
```

**第 4 步：武器**（附第 1 步选中的图作画风参考）：

```text
In the same chibi style as the attached sprite (thick dark navy outline, flat cel shading),
draw three separate items, each standing upright and not held by anyone, on a solid pure green (#00FF00) background:
1) a short wooden staff topped with a sky-blue four-pointed star gem, as tall as the character from shoulder to feet;
2) a short straight sword with a gold crossguard and a navy grip, about as long as the staff;
3) a small round navy shield with a white rim and a sky-blue four-pointed star emblem, about the size of her head.
No text, no watermark.
```

**交付目录**：

```text
D:\neko kaifa\yui-sprite-source\
  sheet.png              第 1 步选中的三视图
  front\  head.png  head_hurt.png  twintail_left.png  twintail_right.png  body.png
          arm_left.png  arm_right.png  leg_left.png  leg_right.png  tail.png
  back\   （同上，无 head_hurt.png）
  side\   head.png  head_hurt.png  twintail_left.png  twintail_right.png  body.png
          arm_near.png  arm_far.png  leg_near.png  leg_far.png  tail.png
  weapons\  staff.png  sword.png  shield.png
```

分件与整图有轻微错位时，开发工具可以按整图对齐；但同一视图的各件缩放必须一致。

### 11.6 实际制作结果（2026-11-14）

- **生成模型**：`gpt-image-2.6-sunburst`（用户提供的 OpenAI 兼容中转接口）。
  - 参考图：宿主初始装全身图，以及宿主 git 历史中的卡面胸像。
  - 三视图生成了 4 张候选，用户选定 A。
- **拆件方式**：没有按 11.5 第 2 步逐件生成。改为每个视图生成一张“分件展开图”，一次调用就拿到 9 个部件，被遮挡处也补画完整。之后由脚本按连通区域拆开。
  - 另外单独生成了武器（法杖、剑、盾）和正面、侧面的受击闭眼头部。
  - 成功生成 11 张：三视图 4 张，分件图 4 张（正面 2、背面 1、侧面 1），受击头部 2 张，武器 1 张。另有 1 次请求因网络错误失败。
- **组装**：先尝试用模板匹配把部件对齐到原三视图，长发等深色部件定位不稳，放弃。改为手工设定转轴与关节的骨骼（`rig.json`）。
  - 躯干分上下两层，夹住手臂；头部的脖子单独垫在领口下。
  - 用户指出“脖子离身体太远”后，已把头部下移，三个视图的身高也重新校齐（头顶约 y=9，脚底约 y=66）。
- **动作**：
  - 待机：呼吸，双马尾和尾巴摆动。
  - 行走：正面、背面抬脚；侧面迈腿、摆臂，身体前倾。
  - 出招：元素使举杖，魔石发光；剑卫挥剑。
  - 受击：身体倾斜，换成闭眼表情。
  - 朝左的帧由朝右的帧镜像得到。
- **接入**：
  - `static/art/companion-yui.png`：128 帧，约 415 KB，帧名与原来一致。
    - 首版沿用 64×72 帧格，游戏中再缩放到 0.66，人物只有约 38 px 高。用户试玩后反馈“太小、太模糊”。
    - 已改为 80×90 帧格，按显示尺寸直接绘制（精灵缩放 1，人物约 47 px 高），游戏中不再二次缩放，并加了轻度锐化。
    - `fitCompanion()` 按帧尺寸设置缩放和碰撞体。实测世界坐标中的碰撞体与原来完全相同：17.16×18.48，位于精灵位置左侧 8.58、上方 0.66。
    - 矢量回退帧仍为 64×72，缩放 0.66。
  - `static/art/companion-yui-{guardian,mage}.png`：头像。
  - 素材加载失败时，战斗回退到 `companion-art.mjs` 矢量版，并提示“同行外观未能载入”；头像图失败时也回退为矢量版。
  - 用 PNG 而不用 WebP：宿主静态路由在 Python 3.11 / Windows 下无法识别 `.webp` 的 MIME 类型。
- **素材源与生成脚本**：在插件外的 `D:\neko kaifa\yui-sprite-source\`，说明见其中的 README。
