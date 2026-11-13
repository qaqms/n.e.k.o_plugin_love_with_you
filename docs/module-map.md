# 模块职责与玩法扩展入口

适用版本：0.7.7。本文描述当前结构；`DESIGN.md` 中的各版本章节保留设计沿革。

## 后端职责

| 模块 | 拥有什么 | 不应承担 | 首选验证 |
| --- | --- | --- | --- |
| `__init__.py` | SDK 入口、生命周期、锁、事务、原子保存调用、评分任务、工具注册、消息提交 | 在入口中复制一份玩法规则或界面算法 | `tests/test_runtime.py` |
| `_engine.py` | 关系、好感、阶段、称呼、日期来源、关系模式、兼容规范化 | SDK、网络、写文件、界面草稿 | `tests/test_engine.py`、`test_v3.py`、`test_v4.py`、`test_addressing.py` |
| `_shop.py` | 奖励资格、余额、库存、额度、流水、有限交易回执及商店投影 | 直接修改关系、发出角色回应 | `tests/test_shop.py`、`test_economy.py` |
| `_commerce.py` | 把领取、购买、送礼组合为跨关系与经济域的结算；返回结果和是否重放 | 加锁、回滚、保存、使评分失效、发送消息 | `tests/test_commerce.py`，再接运行时原子性测试 |
| `_experiences.py` | 按参与角色隔离的草稿、正式便签、事项、修订、请求回执和模型引用投影 | 宿主消息提交、钱包或好感奖励、界面弹窗 | `tests/test_experiences.py`，再接运行时工具与邀请测试 |
| `_conversation.py` | 来源过滤、游标、全文指纹、普通聊天配对、主动事件标记解析 | 修改关系或经济状态、请求模型、保存 | `tests/test_recent_chat.py`、`test_host_history.py`，再接运行时来源测试 |
| `_scoring.py`、`_judge.py` | 前者负责判断规则、提示与解析；后者负责官方模型网关及超时 | 前者不访问模型；两者都不直接保存关系 | `tests/test_scoring_cases.py`、`test_judge_timeout.py` |
| `_prompts.py`、`_calendar.py` | 模型提示及纯日期计算 | 另存一套关系事实、确认真实播放 | `tests/test_v4.py`、`test_addressing.py`、`test_calendar.py` |
| `_dashboard.py` | 锁内取得脱离原状态的快照，锁外生成只读展示 | 为了显示创建真实记录、清理存档、提交动作 | `tests/test_dashboard.py` |
| `_storage.py`、`_json.py` | 原子文件替换、有界读写和严格 JSON | 判断玩法奖励、自动覆盖不支持的存档 | `tests/test_storage.py`、`test_host_transport.py` |
| `_host.py` | 有界本机只读查询、宿主历史适配 | 修改宿主、冒用授权或把旧历史当新事件 | `tests/test_host_history.py`、`test_host_transport.py` |
| `_portraits.py`、`_appearance.py` | 独立素材和外观文件、验证与偏好 | 关系评分代次或聊天内容 | `tests/test_portraits.py`、`test_appearance.py` |
| `_adventure.py` | 独立冒险存档、全局修订、单局控制、检查点、新旧战斗规则绑定、v1/v2/v3 到 v4 的备份迁移、金币/终局/强化的原子保存和回执 | 修改关系/礼物金币、调用模型 | `tests/test_adventure.py`，再接运行时启停与隔离测试 |
| `_adventure_economy.py` | 冒险奖励公式、永久强化目录/上限/价格、购买/退款、钱包与效果校验 | SDK、网络、写文件、礼物经济 | 冒险规则与运行时经济隔离测试 |
| `_adventure_skills.py` | 按战斗版本读取目录，校验双方槽位、分支、进化、候选、冷却、弹体形态、区域与凝霜快照 | 逐帧模拟、选择技能、写存档 | `tests/test_adventure.py` 的规则 2/3、异常快照与迁移测试 |

`_commerce.settle()` 会修改传入状态，但不保证异常时自己回滚。调用方必须在同一状态锁和事务内调用并保存；返回 `replayed=True` 时不再保存或发布一次结算通知。送礼涉及关系、库存、额度与回执，保留整体回滚。

状态变更的顺序是：核验运行代次与对象身份 → 在锁和事务内运行规则 → 原子保存 → 使相关旧工作失效或安排通知。消息消费不与插件落盘共享事务；本地提交不代表生成或播放完成。

## 界面职责

| 文件 | 状态与职责 | 验证入口 |
| --- | --- | --- |
| `ui/panel.tsx` | 导航、当前展示关系、跨页称呼和外观草稿、全局操作互斥、反馈及弹窗编排 | `tools/test_ui.mjs` |
| `ui/shop.tsx` | 商店页签、送礼参与者、送礼确认、原请求、商店回执字段核对 | `tools/test_ui.mjs` 中商店用例 |
| `ui/experiences.tsx` | 经历参与者、页签、绑定角色与修订的表单、原请求、经历回执核对 | `tools/test_experiences_ui.mjs` |
| `ui/together.tsx` | 首页只读摘要与跳转目标 | `tools/test_overview_ui.mjs` |
| `ui/requests.ts` | 共用返回值解包、完整错误码识别、提交/确认/刷新结果；`RunAction` 合同 | `tools/test_requests.mjs` |
| `ui/refresh.ts` | 单次读取完成后安排下一次后台刷新；操作、编辑或隐藏时暂停，卸载后不继续排队 | 浏览器整页回归 |
| `ui/portrait-import.tsx` | 文件预览、裁边编码、批次状态及内容去重导入 | `tools/test_ui.mjs` 中导入用例 |
| `ui/addressing.ts`、`ui/theme.ts` | 可单独验证的预览、草稿合并或配色算法；后端仍拥有最终规则 | 称呼浏览器测试、`tools/test_theme.mjs` |
| `ui/interaction.ts`、`ui/scrollbars.ts` | 控件即时反馈和滚动状态 | `tools/test_ui.mjs` 中交互与滚动用例 |
| `static/adventure.mjs`、`textures.mjs` | Phaser 战斗场景、原创素材、局内状态、暂停与升级；不修改关系、发模型消息或直接决定永久资产 | `tools/test_adventure.mjs` |
| `static/bridge.mjs` | 动作通信、严格回执核对与原请求；不自动抢占控制，通信失败不宣称保存完成 | 冒险浏览器的回执丢失与接管测试 |
| `static/camp.mjs` | 营地钱包、商店与结果明细的显示及交互；不发放金币、决定价格或读写存档 | 冒险商店浏览器与协议回归 |
| `static/skills.json`、`skills-v2.json`、`skills.mjs` | 规则 3 十招目录与冻结的规则 2 八招目录，纯构筑、候选、保底、分支与进化计算；不在重绘时重抽候选 | `tools/test_adventure_skills.mjs` |
| `static/combat.mjs` | 规则 2/3 的技能施放、同行策略、有限接续、范围效果与贡献；场景保留实体和物理 | 冒险浏览器的技能、融合、终态与冷却恢复测试 |
| `static/frost.mjs` | 有界凝霜标记、减速、短冻结、免疫、直接剑技碎冰和同行贡献；时钟使用可保存的战斗时间 | 纯状态测试与浏览器命中、读档回归 |
| `static/study.mjs` | 技能研习、图鉴、Q/E 按钮与冷却显示；不写存档、不发奖励 | 冒险浏览器的归属、触屏、升级响应丢失测试 |

冒险原型使用第二个静态面板，不把游戏引擎塞进 Hosted TSX。`adventure_action` 使用已有素材 I/O 门控与启动代次，关系锁只用于读取开局身份/阶段；冒险文件另用服务锁与原子保存。停用会排空已接纳的 I/O，下一次启动重建会话代次并释放内存控制权。

检查点、冒险钱包与永久强化保持在独立文件内；本局终态、规则计算的金币与回执原子保存。归来共创尚未实现，后续接入时仍需独立的玩家确认流程。金币不兑换礼物币；商店在未结束旅程期间只读。

后端快照是已保存事实的来源；页面输入是草稿，两者不能直接互相覆盖。共同经历一直归参与角色，不能用共用好感的 scope 代替。表单打开时绑定身份与修订，后台切换当前角色不能改写提交目标。

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
2. 规则放在所属域；确实跨域的结算像 `_commerce.py` 一样集中组合。只需要少量规则时复用已有模块，不为每个按钮增加一层通用框架。
3. 先测规则的边界、重放和角色隔离，再接 SDK 入口。入口复用现有锁和事务，保存成功之后才报告已完成。
4. 区分草稿、玩家确认、消息提交、观察到回复；缺少宿主证据时保留未知。不要从普通聊天文本猜测另一个事件已经完成。
5. 页面保留自己的表单和原请求；共用 `RunAction`、返回值解包和后台刷新。带资产或内容写入的回执必须先验证，不能只因 Promise 成功便显示保存成功。
6. 至少验证保存失败回滚、响应丢失后同请求核对、并发修订、编辑时切角色、保存后刷新失败，以及停用或重开后的旧调用。
7. 更新迁移或兼容说明、多语言键和本文对应验证入口。构建后检查资源完整性；导入与真实角色表现另作实机验收。

从插件根目录运行：

```powershell
& '../N.E.K.O/.venv/Scripts/python.exe' -B -m pytest tests/test_commerce.py tests/test_runtime.py -q
$env:NEKO_UI_DEPS='D:\neko kaifa\.neko-ui-review'
$env:NEKO_UI_BROWSER='C:\Program Files\Google\Chrome\Application\chrome.exe'
node tools/check_ui.mjs
node --test tools/test_requests.mjs
npm --prefix tools test
```

新增玩法必须经过适合它的域测试和运行时验证，不能仅依靠界面模拟数据证明保存原子性或真实模型行为。当前入口类和面板仍较大；后续按实际新增的职责逐步拆分，避免一次性搬动生命周期、锁和调用绑定。
