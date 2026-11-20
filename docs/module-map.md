# 模块职责与玩法扩展入口

结构覆盖至版本 0.9.26（2026-11-21）。文中的源码路径均相对插件根目录。[架构沿革](architecture.md)保留各版本设计。完整目录见[文档索引](README.md)。

「我们的小屋」通过 `ui/cottage.tsx` 按需加载 `static/cottage.html`。客厅几何、材质和灯光在 `static/cottage-scene.mjs`，客厅以外的整栋房子（厨房、门廊小院、二楼、楼梯、屋顶）由 `static/cottage-house.mjs` 按 `static/cottage-layout.mjs` 的布局数据生成；透视镜头、房间切换（总览与各房间视角，一楼视角时二楼整体抬走、挡在镜头前的侧墙淡出）、工具栏菜单（房间、光线与时段及画质、物品清单）、交互、本地偏好、分时段光照和画质档位在 `static/cottage.mjs`；物品清单按布局槽位标注所在房间，在其他房间选择客厅物品会先回到客厅再打开；后期处理与环境光照来自打包的 `static/engine/three-post.mjs`。`static/cottage-record.mjs` 布置唱机引线和封套，`static/cottage-picture.mjs` 将便签与一起看过的记录逐页放在木框内。面板接收相框选中的记录 ID，并通过 `ExperienceDestination` 打开原记录。

`static/cottage-living.mjs` 管理便签编辑、礼物选位及沙发控制。便签通过面板的 `experience_action` 使用角色修订号及请求回执，陈列架按已送礼物的记录 ID 恢复浏览器本地摆放。

`static/cottage-company.mjs` 管理双人杯、日历和投影幕的场景界面。面板读取现有纪念日与观看追踪，并将 `invite_cottage_chat` 交给宿主消息通道。宿主当前角色在提交时重新校验。

小屋改版的双层布局以数据形式放在 `static/cottage-layout.mjs`（房间、墙体开口、楼梯、家具占位和功能槽位），运行时用于生成房屋、房间视角和物品分组；`tools/tests/test_cottage_layout.mjs` 校验槽位不穿墙、不挡门和楼梯、现有功能各占一个槽位。开发用灰盒查看器 `tools/preview/cottage-blockout.*` 由预览服务的 `/blockout` 提供，不进入发布包。

发布工具 `tools/build/audit_release.py` 扫描源码、历史与导入包并隐去疑似凭据值；`verify_adventure_package.py` 验证运行资源、文件范围、哈希及合成旧存档迁移；`precheck_release.py` 在临时源码副本调用官方 SDK 预检。对应路径与凭据泄漏回归见 `tests/test_release_hygiene.py`，检查结果及素材许可待办见[发布审计](audits/release-readiness-2026-11-16.md)。浏览器测试拥有自己的临时存档目录，并在正常结束及启动失败时清理。

README 面向插件用户；安装、功能和隐私集中在首页，开发入口见 `docs/development.md`，旧内容保存在 `docs/readme-history-2026-11-16.md`。发布头像为 `assets/icon.png`，市场投稿路径见[发布资料说明](market-release-2026-11-16.md)；它不参与游戏或关系状态。

## 后端职责

| 模块 | 拥有什么 | 不应承担 | 首选验证 |
| --- | --- | --- | --- |
| `__init__.py` | SDK 入口、生命周期、锁、事务、原子保存调用、评分任务、工具注册、消息提交 | 在入口中复制一份玩法规则或界面算法 | `tests/test_runtime.py` |
| `backend/relationship/engine.py` | 关系、好感、阶段、称呼、日期来源、关系模式、兼容规范化 | SDK、网络、写文件、界面草稿 | `tests/test_engine.py`、`test_v3.py`、`test_v4.py`、`test_addressing.py` |
| `backend/relationship/shop.py` | 奖励资格、余额、库存、额度、流水、有限交易回执及商店投影 | 直接修改关系、发出角色回应 | `tests/test_shop.py`、`test_economy.py` |
| `backend/relationship/commerce.py` | 把领取、购买、送礼组合为跨关系与经济域的结算；返回结果和是否重放 | 加锁、回滚、保存、使评分失效、发送消息 | `tests/test_commerce.py`，再接运行时原子性测试 |
| `backend/relationship/experiences.py` | 按参与角色隔离的草稿、正式便签、事项、修订、请求回执和模型引用投影 | 宿主消息提交、钱包或好感奖励、界面弹窗 | `tests/test_experiences.py`，再接运行时工具与邀请测试 |
| `backend/relationship/conversation.py` | 来源过滤、游标、全文指纹、普通聊天配对、主动事件标记解析 | 修改关系或经济状态、请求模型、保存 | `tests/test_recent_chat.py`、`test_host_history.py`，再接运行时来源测试 |
| `backend/relationship/scoring.py`、`backend/infrastructure/judge.py` | 前者负责判断规则、提示与解析；后者负责官方模型网关及超时 | 前者不访问模型；两者都不直接保存关系 | `tests/test_scoring_cases.py`、`test_judge_timeout.py` |
| `backend/relationship/prompts.py`、`backend/relationship/calendar.py` | 模型提示及纯日期计算 | 另存一套关系事实、确认真实播放 | `tests/test_v4.py`、`test_addressing.py`、`test_calendar.py` |
| `backend/relationship/dashboard.py` | 锁内取得脱离原状态的快照，锁外生成只读展示 | 为了显示创建真实记录、清理存档、提交动作 | `tests/test_dashboard.py` |
| `backend/infrastructure/storage.py`、`backend/infrastructure/json_codec.py` | 原子文件替换、有界读写和严格 JSON | 判断玩法奖励、自动覆盖不支持的存档 | `tests/test_storage.py`、`test_host_transport.py` |
| `backend/infrastructure/host.py` | 有界本机只读查询、宿主历史适配 | 修改宿主、冒用授权或把旧历史当新事件 | `tests/test_host_history.py`、`test_host_transport.py` |
| `backend/relationship/portraits.py`、`backend/relationship/appearance.py` | 独立素材和外观文件、验证与偏好 | 关系评分代次或聊天内容 | `tests/test_portraits.py`、`test_appearance.py` |
| `backend/adventure/service.py` | 独立冒险存档、全局修订、单局控制、检查点、新旧战斗规则绑定、旧文件到 v18 的备份迁移、规则 17 开局、金币/终局/强化的原子保存和回执 | 修改关系/礼物金币、调用模型 | `tests/test_adventure.py`，再接运行时启停与隔离测试 |
| `backend/adventure/economy.py` | 冒险奖励公式、永久强化目录/上限/价格、购买/退款、钱包与效果校验 | SDK、网络、写文件、礼物经济 | 冒险规则与运行时经济隔离测试 |
| `backend/adventure/skills.py` | 按战斗版本读取目录，校验双方槽位、分支、进化、候选、冷却、弹体形态、区域、凝霜、敌人状态与协同快照；规则 7 增加选招阶段、四候选、类型改造、放逐与换招额度，遭遇校验在公共实体校验后执行 | 逐帧模拟、选择技能、写存档 | `tests/test_adventure.py` 的规则 2–7、异常快照与迁移测试 |

`backend.relationship.commerce.settle()` 会修改传入状态，但不保证异常时自己回滚。调用方必须在同一状态锁和事务内调用并保存；返回 `replayed=True` 时不再保存或发布一次结算通知。送礼涉及关系、库存、额度与回执，保留整体回滚。

状态变更的顺序是：核验运行代次与对象身份 → 在锁和事务内运行规则 → 原子保存 → 使相关旧工作失效或安排通知。消息消费不与插件落盘共享事务；本地提交不代表生成或播放完成。

## 界面职责

| 文件 | 状态与职责 | 验证入口 |
| --- | --- | --- |
| `ui/panel.tsx` | 导航、当前展示关系、跨页称呼和外观草稿、全局操作互斥、反馈及弹窗编排 | `tools/tests/test_ui.mjs` |
| `ui/portrait-lightbox.tsx`、`ui/portrait-touch-presets.ts` | 关系概览灯箱、内置立绘的部位预设、抚摸光标、背包及同行游戏入口 | `tools/tests/test_portrait_lightbox.mjs` |
| `ui/companion-game.tsx`、`static/panel-<版本>.html` | 「专属称呼」下方的「同行游戏」入口；主面板由 TSX 编译为带发布号的同源静态入口，内嵌游戏并只代理指定子窗口的冒险动作；同步显示状态，离开暂停、返回保留文档；真实游戏交互确认前台，控制权冲突提供显式接管恢复 | `tools/tests/test_companion_navigation.mjs`（计时、移动、焦点失效、切页、刷新及接管）；生成入口用 `npm --prefix tools run build:panel` |
| `static/index.html`、`static/adventure.css` | 游戏文档和布局；顶部常驻测试版提示，桌面与窄屏均完整显示 | `tools/tests/test_companion_navigation.mjs`；截图检查 |
| `ui/shop.tsx` | 商店页签、送礼参与者、送礼确认、原请求、商店回执字段核对 | `tools/tests/test_ui.mjs` 中商店用例 |
| `ui/experiences.tsx` | 经历参与者、页签、绑定角色与修订的表单、原请求、经历回执核对 | `tools/tests/test_experiences_ui.mjs` |
| `ui/together.tsx` | 概览折叠区内按角色显示的只读摘要与跳转目标 | `tools/tests/test_overview_ui.mjs` |
| `ui/requests.ts` | 共用返回值解包、完整错误码识别、提交/确认/刷新结果；`RunAction` 合同 | `tools/tests/test_requests.mjs` |
| `ui/refresh.ts` | 单次读取完成后安排下一次后台刷新；操作、编辑或隐藏时暂停，卸载后不继续排队 | 浏览器整页回归 |
| `ui/portrait-import.tsx` | 文件预览、裁边编码、批次状态及内容去重导入 | `tools/tests/test_ui.mjs` 中导入用例 |
| `ui/addressing.ts`、`ui/theme.ts` | 可单独验证的预览、草稿合并或配色算法；后端仍拥有最终规则 | 称呼浏览器测试、`tools/tests/test_theme.mjs` |
| `ui/interaction.ts`、`ui/scrollbars.ts` | 控件即时反馈和滚动状态 | `tools/tests/test_ui.mjs` 中交互与滚动用例 |
| `static/adventure.mjs`、`textures.mjs` | Phaser 战斗场景、原创素材、局内状态、暂停与升级；不修改关系、发模型消息或直接决定永久资产 | `tools/tests/test_adventure.mjs` |
| `static/actor-art.mjs`、`companion-art.mjs`、`forest-art.mjs` | 原创原生角色帧与运行时图集；同行者采用 `static/art/companion-yui*.png` 的 YUI 外观，玩家采用 `static/art/player-traveller*.png` 的旅人外观，载入失败各自回退矢量版、程序地表、独立场景物件和弹体纹理；装饰种子独立，不决定碰撞与伤害 | 冒险浏览器的素材像素、双方动作、碰撞尺寸与响应式截图 |
| `static/terrain-rules.mjs`、`forest-map.mjs` | 规则 5 固定布局、脚底排序、遮挡淡化、静态碰撞体、扫掠截停、安全恢复及有预算的本地 A* 绕行；不消费战斗 RNG，不决定伤害、奖励或读写存档 | `tools/tests/test_terrain_rules.mjs` 及冒险浏览器的实际移动、突进、冲锋、层次和恢复 |
| `static/battle-art.mjs` | 按战斗时钟更新动作、有界装饰粒子、伤害数字、受击与死亡演出、玩家受伤提示、震屏和顿帧；不消费战斗随机数，不进入快照、不做伤害结算，不改变碰撞体 | 冒险浏览器的随机数/快照不变性、预算、暂停、顿帧和简化特效 |
| `static/foe-art.mjs` | 全部八种敌人的分件动画帧表（`static/art/foe-*.png`）：载入、按显示尺寸替换敌人贴图并保持世界坐标碰撞圆；载入失败沿用矢量外观 | 冒险浏览器的贴图、碰撞圆、移动/受击/死亡帧 |
| `static/fx-art.mjs`、`zone-art.mjs` | 反馈用的运行时纹理、元素配色和弹体外形；持续区域、电链、光枪与斩弧的绘制，只读取战斗状态 | 冒险浏览器的效果截图、弹体碰撞圆和重绘不变性 |
| `static/bridge.mjs` | 动作通信、严格回执核对与原请求；不自动抢占控制，通信失败不宣称保存完成 | 冒险浏览器的回执丢失与接管测试 |
| `static/camp.mjs` | 营地钱包、商店与结果明细的显示及交互；不发放金币、决定价格或读写存档 | 冒险商店浏览器与协议回归 |
| `static/skills.json`、`skills-v2.json`、`skills-expanded.json`、`routes.json`、`build-mods.json`、`skills.mjs` | 版本化技能与旧路线目录，规则 7 类型改造与自由候选、纯构筑、保底、分支、进化和同槽换招计算；不在重绘时重抽候选 | `tools/tests/test_adventure_skills.mjs`、`test_expanded_combat.mjs`、`test_buildcraft.mjs` |
| `static/combat.mjs` | 规则 2–7 的技能施放、同行策略、有限接续、范围效果与贡献；通过地图服务取得突进与击退实际落点，场景保留实体和物理 | 冒险浏览器的技能、融合、终态、障碍与冷却恢复测试 |
| `static/buildcraft.mjs` | 规则 7 起手选招、放逐、重选、战后换招及额度，先保存再恢复；保护融合与协同、保留冷却并清理替换角色的旧效果 | `tools/tests/test_buildcraft.mjs` 与冒险浏览器的真实控件、重放和恢复 |
| `static/expanded-combat.mjs` | 规则 6 雷链、岩弹命中、贯刺、刃环、伏印、震地、剑舞、天坠、治疗和灵灯；复用统一伤害与保存区域时钟，仅雷链线段是有界装饰，不拥有文件或奖励 | `tools/tests/test_expanded_combat.mjs`、冒险浏览器的新招实际施放、密度与恢复 |
| `static/frost.mjs` | 有界凝霜标记、减速、短冻结、免疫、直接剑技碎冰和同行贡献；时钟使用可保存的战斗时间 | 纯状态测试与浏览器命中、读档回归 |
| `static/encounters.json`、`encounter-rules.mjs` | 共用敌人与协同目录，前置筛选、有限候选抽取、预警几何与安全出生点 | `tools/tests/test_encounter_rules.mjs` 与后端快照校验 |
| `static/encounters.mjs` | 首领时间线、敌人招式、预警与命中、战后协同选择、首领血条；通过控制器保存，不直接发放永久资产 | `tools/tests/test_adventure.mjs` 的规则 4、重试、移动与触屏回归 |
| `static/journey.json`、`journey-rules.mjs` | 规则 8 的九段路程、区域与目标目录；选门抽取、进入下一段、目标进度、按段计算的难度与金币公式，全部为纯函数 | `tools/tests/test_journey_rules.mjs` 与后端 `backend/adventure/journey.py` 的快照校验 |
| `static/journey.mjs` | 规则 8 的运行时：段落完成时清场与发奖、选门界面、换场地与召唤守关强敌；通过控制器保存，不直接发放金币 | `tools/tests/test_adventure.mjs` 的 rule8 用例（整局、读档、响应丢失、手机布局） |
| `static/mastery.json` | 规则 10 的精通目录（每个技能三档的名称与说明）和流派共鸣的档位；`skills.mjs` 的 `installMastery`、`masteryOf`、`resonance` 读取它，后端 `backend/adventure/skills.py` 用同一份文件校验 | `tools/tests/test_mastery.mjs`，`tests/test_adventure.py` 的 rule10 用例 |
| `static/fire-line.json`、`fire-line.mjs` | 规则 11 的火系技能线：进阶形态目录，以及焰刃、喷焰、爆炎、熔流、狱炎弹、瞬燃的判定与连携；计时器、待爆法阵和熔岩池是短时状态，不进存档。进阶的合法性与数值在 `skills.mjs`（`installLine`、`artStats`、`levelCap`） | `tools/tests/test_mastery.mjs`、`tools/tests/test_adventure.mjs` 的 rule11 用例、`tests/test_adventure.py` 的 rule11 用例 |
| `static/flame-line.json`、`flame-line.mjs` | 规则 13 的火系手动技能线：炎墙、大炎球、地脉、燃域、炎柱的目录、一键连招队列、判定与连携；短时状态不存档，画面在 `fire-art.mjs` 的 `paintCasts` | 写快照、消费战斗随机数 | `tools/tests/test_flame_line.mjs`、`tests/test_adventure.py` 的规则 13 用例、浏览器 `rule13` 用例 |
| `static/stops.json`、`stop-rules.mjs`（及 `journey.mjs` 的停靠部分） | 规则 14 的停靠点：停靠门、篝火／行商／奇遇的内容与效果、林晶、战意与带路、替身护符；内容从存档随机数抽取并存进旅程快照 | 修改局外金币或结算公式 | `tools/tests/test_stops.mjs`、`tests/test_adventure.py` 的规则 14 用例、浏览器 `rule14` 用例 |
| `static/sword-line.json`、`sword-line.mjs`、`sword-art.mjs` | 规则 15 的剑系自动线（瞬光、流返、幻剑、剑压、千刃、断界）、剑意、剑系共鸣，以及 `ultimate.mjs` 里按流派选择的拔刀斩；剑意和形态计时不存档 | 写快照、消费战斗随机数 | `tools/tests/test_swords.mjs`、`tests/test_adventure.py` 的规则 15 用例、浏览器 `rule15` 用例 |
| `static/forest-art.mjs` 的 `paintSkin`、`forest-map.mjs` 的 `load(arena, skin)`、`journey-rules.mjs` 的 `skinAt` | 步骤 0.9.4 起旅程各段的正式画面：林缘、苔石遗迹、荆棘深处、首领圣所的底图和障碍物贴图；只改画面，碰撞来自布局 | 改碰撞框、写快照 | 浏览器 `painted arenas` 用例和地形相关用例 |
| `static/hazards.mjs`，`terrain-rules.mjs` 的 `HAZARDS`，`forest-map.mjs` 的 `removeProp` | 规则 16 的地形机制：遗迹石柱磨损与倒塌（存档 `terrain`）、深处荆棘减速与毒雾 | 改其他布局、消费战斗随机数 | `tests/test_adventure.py` 的规则 16 用例、浏览器 `rule16` 用例 |
| `static/journey.mjs` 的出口部分（`walking`、`drawExits`、`walk`）与 `hazards.mjs` 的 `sanctuary` | 规则 17：打完一段后在场地边缘亮出出口，走进去选路，暂停仍可用面板；首领圣所第二阶段立石发光，第三阶段根须封场 | 改快照格式 | 浏览器 `rule17` 用例 |
| `static/foe-art.mjs` 的 `FOE_SHEETS`，`battle-art.mjs` 的 `motionOf`、`lunge`、`strikeFx` | 步骤 0.9.7 卡通怪物：16 格动作表（移动、蓄力、出招、受击、死亡），蓄力跟随遭遇战 AI，出手和接触时播放出招与特效，面向玩家；只改画面 | 改碰撞体或缩放 | 浏览器 `cartoon enemies`、`raster` 用例 |
| `static/cel-fx.mjs`，`zone-art.mjs` 的 `paintSlash`，`battle-art.mjs` 的 `impact` | 卡通描边特效：迅斩刀光（扫开、停顿、从尾部消失）、命中十字星和碎片、地面划痕；只改画面 | 写快照、改命中判定 | 浏览器 `sword is an area`、`combat feedback` 用例 |
| `static/actor-art.mjs` 的 `PLAYER_SHEET`、`COMPANION_SHEET`、`FRAME_TIME`、`actorKey`、`fitPlayer`、`fitCompanion` | 新人物动作表：160×150 帧，脚在精灵位置下方 24，帧留在各自贴图上；碰撞框不变 | 改碰撞框、改精灵缩放 | 浏览器 `raster player traveller`、`art sample` 用例 |
| `static/dash-line.json`、`dash-line.mjs`，`sword-art.mjs` 的 `DASH_ART` | 规则 18 的突进手动线（连斩、回身斩、八方斩、残影、剑域）与一键连招；每刀走 `swordLine.strike`，连招队列和剑域计时不存档 | 写快照、绕过地形落点检查 | `tools/tests/test_strikes.mjs`、`tests/test_adventure.py` 的规则 18 用例、浏览器 `rule18` 用例 |
| `static/encounters.mjs`、`encounter-rules.mjs`（规则 12 部分） | 精英词缀的目录、出现概率与抽取，分裂与援兵的生成，守关强敌和首领按阶段选择的预警排布；精英光环在同一个预警图层绘制 | `tools/tests/test_adventure.mjs` 的 rule12 用例、`tests/test_adventure.py` 的 rule12 用例 |
| `static/fire-art.mjs` | 火系的贴图特效：爆炸图池与焰环法阵；只读战斗状态，不参与结算，贴图缺失时由调用方回退到矢量爆炸 | 浏览器截图检查 |
| `static/ultimate.mjs` | 规则 9 的终结技：按击败充能、流派归属、特写定帧、落地伤害与叠加特效；能量随快照保存，特写与特效不进存档 | `tools/tests/test_journey_rules.mjs` 的纯函数用例与 `tools/tests/test_adventure.mjs` 的 rule9 用例 |
| `static/study.mjs` | 技能研习、图鉴、Q/E 按钮与冷却显示；不写存档、不发奖励 | 冒险浏览器的归属、触屏、升级响应丢失测试 |

游戏使用主面板内的独立静态子页面，引擎与关系组件隔离；宿主只注册一个主面板。`adventure_action` 使用已有素材 I/O 门控与启动代次，关系锁只用于读取开局身份/阶段；冒险文件另用服务锁与原子保存。停用会排空已接纳的 I/O，下一次启动重建会话代次并释放内存控制权。

检查点、冒险钱包与永久强化保持在独立文件内；本局终态、规则计算的金币与回执原子保存。归来共创尚未实现，后续接入时仍需独立的玩家确认流程。金币不兑换礼物币；商店在未结束旅程期间只读。

后端快照是已保存事实的来源；页面输入是草稿，两者不能直接互相覆盖。共同经历一直归参与角色，不能用共用好感的 scope 代替。表单打开时绑定身份与修订，后台切换当前角色不能改写提交目标。

「一起相处」复用 `experience_action` 和共同经历存档。每个角色可以有一个进行中的活动，确认保存后成为带活动类型和进度的回忆。宿主负责媒体播放和屏幕共享，插件保存玩家填写的标题、进度和感想。

开启观看追踪时，`dashboard()` 通过 `backend/infrastructure/host.py` 的 `fetch_recent_watches()` 读取宿主最近 100 条观看会话。面板按角色显示同意开启后的最新有效进度。`save_tracked_watch` 复用共同经历的角色修订与请求回执，确认后才把标题、进度和感想写入回忆。

关系概览通过 `AdventureStore.resume_summary()` 读取同行存档的角色、区域与段数，并复用现有游戏导航。共同经历与冒险的保存路径各自管理自己的记录。

`useLocalState` 只保证同一面板内切页保留相关状态，不是进程级存档。商店和共同经历保留各自原请求；共用请求模块不生成交易 ID，也不修改玩法内容。组件的返回值描述函数先验证对应回执，成功后才释放原请求。

| 请求结果 | 原请求 | 表单和显示 |
| --- | --- | --- |
| 后台明确拒绝且能够识别 | 商店或经历请求释放；新编辑可新建请求 | 保留输入；冲突要求显式刷新后重新核对 |
| 通信异常、空回执、字段或操作不符 | 保留原参数和请求 ID | 不提示已保存；异常回执要求刷新并核对原操作 |
| 保存确认，刷新成功 | 释放 | 更新显示并结束相应编辑 |
| 保存确认，刷新失败 | 释放 | 保存仍成功；只重试刷新，不重复提交保存 |

历史兼容允许 `result` / `data` / `value` 包装，有最大解包层数；这不是任意对象均有效。只消费本次动作所需的字段，拒绝不完整或身份不符的回执。错误码优先读结构化 `code`，兼容旧错误消息中的完整标识，不做子串匹配。

## 新增玩法

1. 明确内容属于关系 scope、实际参与角色，还是全局资产。先选所有者，再设计字段、修订、限额和恢复规则。
2. 规则放在所属域；确实跨域的结算像 `backend/relationship/commerce.py` 一样集中组合。只需要少量规则时复用已有模块，不为每个按钮增加一层通用框架。
3. 先测规则的边界、重放和角色隔离，再接 SDK 入口。入口复用现有锁和事务，保存成功之后才报告已完成。
4. 区分草稿、玩家确认、消息提交、观察到回复；缺少宿主证据时保留未知。不要从普通聊天文本猜测另一个事件已经完成。
5. 页面保留自己的表单和原请求；共用 `RunAction`、返回值解包和后台刷新。带资产或内容写入的回执必须先验证，不能只因 Promise 成功便显示保存成功。
6. 至少验证保存失败回滚、响应丢失后同请求核对、并发修订、编辑时切角色、保存后刷新失败，以及停用或重开后的旧调用。
7. 更新迁移或兼容说明、多语言键和本文对应验证入口。构建后检查资源完整性；导入与真实角色表现另作实机验收。

从插件根目录运行：

```powershell
python -B -m pytest tests/test_commerce.py tests/test_runtime.py -q
$env:NEKO_UI_BROWSER='C:\Program Files\Google\Chrome\Application\chrome.exe'
node tools/build/check_ui.mjs
node --test tools/tests/test_requests.mjs
npm --prefix tools test
```

新增玩法必须经过适合它的域测试和运行时验证，不能仅依靠界面模拟数据证明保存原子性或真实模型行为。当前入口类和面板仍较大；后续按实际新增的职责逐步拆分，避免一次性搬动生命周期、锁和调用绑定。
