# 与你相恋 Design Brief

## Identity Lock
- plugin_id: `love_with_you`
- folder: `love_with_you/`（开发模式加载 / 打包均要求目录名 = 插件 ID）
- GitHub 仓库: `n.e.k.o_plugin_love_with_you`
- name: 与你相恋
- entry: `plugin.plugins.love_with_you:LoveWithYouPlugin`
- main class: `LoveWithYouPlugin`

## Purpose
给 N.E.K.O 角色加一层“恋爱关系”：好感度 0–100、五个关系阶段，角色在文字聊天中按阶段调整语气，并由模型按规则加减好感。

## Package Type and Capabilities
- package type: `plugin`（独立插件，走插件市场分发）
- capabilities: LLM 工具（动态注册）、`push_message(ai_behavior="read")`、`timer_interval`、Hosted TSX 面板、Markdown 指南
- inferred architecture: 纯逻辑 `_engine.py`（可单测）+ 原子 JSON 持久化 `_storage.py` + 宿主 HTTP 只读查询 `_host.py` + 模型文案 `_prompts.py` + 主类 `__init__.py`

## First Version Scope
- 好感度 0–100；阶段 陌生(0) / 熟悉(20) / 好感(40) / 暧昧(60) / 恋人(80)。会扣分、阶段可倒退；倒退有 5 分缓冲防抖。
- 模型工具：`love_state`（读状态与语气）、`love_update`（±5/次、每日加分上限 15、扣分上限 30，必须给理由）。
- 阶段描述写进 `love_update` 工具描述，阶段变化时重新注册，模型每轮都能看到当前语气。
- 阶段变化时 `ai_behavior="read"` 通知角色（`coalesce_key` 去重），不打断、不主动发言。
- 多角色：默认全部角色共用一份好感。“每个角色独立好感”开关：
  - 开启：当前角色沿用共用值；其他角色恢复各自旧记录，没有记录的从 0 开始。
  - 关闭：共用值 = 当前角色的值；其他角色的独立记录原样保留。
  - 开关永远不删除、不重置任何角色的数据。
  - 独立模式下按 `role=角色名` 为每个角色注册一对工具（方案 A）。
- 面板：极简风，好感圆环、阶段轨道、心动记录、设置（独立开关、手动调整、重置需确认）；支持作者放置二次元装饰立绘 `assets/decoration.(webp|png|jpg|gif)`（≤1 MiB）。

## Out of Scope
主动发起对话、改写角色人设、语音模式专项优化、面板内上传装饰图。（读取会话总线自动评分已在 v0.4.0 加入。）

## Phase 2 (v0.2.0)
- **诊断日志**：每次 `love_update` 写一行 INFO（scope、requested/applied、当前值、阶段、limited_by、理由）；被拒绝、阶段变化、面板操作也各写一行。称呼文字不写日志。
- **称呼**：每条记录 `nicknames: {stage: text}`（≤ 12 字，去换行/控制符），只由用户在面板设置。空阶段沿用更低阶段；全空则不写称呼行，沿用人设。
- **纪念日**：
  - 每条记录 `first_met`（可改，不得晚于今天或早于 1970）和 `milestones: {stage: date}`（首次到达日期，只写不改，重置与倒退都保留）。
  - 全局 `anniversaries: [{id, title, month, day}]`（≤ 20 个，标题 ≤ 20 字），所有角色共用。闰日在平年按 2 月 28 日。
  - 自动纪念：相识 / 在一起（= 首次到达恋人）的第 100/200/300/520/1000/1314/2000 天与每个周年；第 1 天 = 起始日。
  - **提醒方式改为写进当天的 `love_update` 工具描述**，不用 `read` 推送：`read` 会排队到用户下一次说话，当天没聊就会隔天才说「今天是……」。描述按日期重算，跨天后自动恢复；当天未聊则该提醒作废。
- **工具描述对账**：`_registered` 记录注册时的完整描述，阶段、称呼、当天纪念日任一变化都会同名重注册；5 秒定时器顺带处理跨天。
- **分阶段立绘**：`assets/stage_<stage>.<ext>` 优先于 `assets/decoration.<ext>`；每张 ≤ 1 MiB，超限的列在面板提示里。后端按路径 + 版本缓存 data URL（最多 6 张），面板按版本缓存。
- **面板**：分「心动 / 纪念日 / 设置」三页；心动页加称呼和今日纪念横幅，纪念日页显示天数、阶段达成日、未来 60 天和自定义纪念日。
- **状态文件 v2**：旧记录自动补字段；`first_met` 取最早一条心动记录的日期（没有就是今天），不为旧阶段编造达成日期。
- 仍不做：角色主动说「想你」、好感随时间衰减、短期情绪（见下方风险）。

## Phase 3 (v0.3.0)
参考 `参考/astrbot-plugin-wifepicker-main`（AGPL-3.0，只借鉴思路，未复制代码）的群友好感度设计。
- **扣分更保守**：规则写明「只在明确冲着你时扣分」，吐槽工作/学习/食物/自己、累了、说话简短都算中性；拿不准就不调用。引擎侧：每天第一次扣分减半（向下取整，至少 1），`limited_by="grace"`。
- **同方向冷却**：`last_model_ts/last_model_sign`，120 秒内同号变化不生效、不写记录，工具返回「刚刚已经调整过」。反方向不受限；被每日上限挡住的调用不重置冷却。
- **好感走势**：每条记录 `daily: {date: value}`（≤ 400 天），每次数值变化写当天。v1/v2 从现存心动记录重建。`trend_view` 向前填充到今天，无数据的日子为 `null`（不画成 0）。面板用 CSS 柱状图（30/90/365 天），虚线为阶段分界。
- **好感变淡（可选，默认关）**：不读取会话总线，用「角色最后一次用本插件工具的日期」`last_active` 作活跃信号。
  - 超过 3 天后每天 -1，下限为当前阶段下界，永不导致阶段倒退；`decay_checked` 每天前移，开启开关当天重置两个日期，所以不会补扣开关前的日子；停用后重启一次最多补 7 天。
  - 只对当前模式在用的记录扣；切换共用/独立模式时按「活跃」处理。
  - 闲置超过宽限时，`love_update` 描述加一句「在今天之前你们已经 N 天没怎么说话」，模型一调用工具就消失。
  - 已知局限：用户每天聊但角色不调用工具，会被误判为闲置；已写进指南。
- **告白门槛（可选，默认开）**：`settings.require_confession`。
  - 门槛开启且 `confessed=false` 时，阶段最高停在 ambiguous，数值可继续涨到 100；面板显示「只差一句告白」。
  - 此时才注册 `love_confess`（独立模式带角色后缀），`love_update` 描述提示只在真正告白并彼此答应时调用。成功后记 `confessed_on` 与一句 `confession`，写一条 `source=confession` 记录；不再发 `read` 通知，因为模型当轮就看到结果。
  - 以任何方式到达 lover 都会置 `confessed=true`，所以告白只需一次；升级前已是 lover 的记录视为已告白。重置不清除告白。
  - 关闭门槛时，等待中的记录立刻成为 lover 并发阶段通知；重新开启不会收回 lover。
- **状态文件 v3**：新增 `settings`、以及每条记录的 `last_model_ts/sign`、`last_active`、`decay_checked`、`confessed/confessed_on/confession`、`daily`；全部可从 v1/v2 自动补齐。
- 未采纳：只在调试模式记录理由的日志开关、群聊/戳一戳/关系图/本地情感模型。

## Phase 4 (v0.4.0)
实机测试发现两个问题：`free-model` 几乎从不调用 `love_update`，好感不动；阶段语气只放在工具描述里，被人设压过（陌生阶段照样撒娇）。
- **插件侧评分（默认开，`settings.auto_score`）**：每 5 秒读 `ctx.bus.conversations`（宿主每条消息都会发布，`metadata.turn_type` = `user_message` / `assistant_message`；主动搭话的 `proactive_*` 忽略）。`BusCursor` 去重并只取启动后的消息，`ExchangeTracker` 按角色把用户消息和下一条回复配成一轮（最多合并 4 条用户消息，带上一轮作语境，每句截 300 字）。一轮进入后台线程队列（满了丢最旧），评分后走 `apply_model_delta(cooldown=0, source="auto")`，每轮 ±3，日上限与首次扣分减半照旧。开启时只注册 `love_state`；关闭后恢复 v0.3 的工具计分。
- **评分方式**：
  - 绑定了模型：经官方插件模型网关 `ctx.models.get_client()` 调用 usage `judge`（`plugin.toml` 中 `[plugin.models.judge]`，`required = false`）。插件不接触任何服务商地址或密钥。未绑定时网关返回 403，之后 60 秒内不再尝试。
  - 未绑定或本轮失败：离线关键词判断 `rule_verdict`（只看用户的话；伤人词优先于温柔词；紧邻否定词「不/没/别」不算；普通消息为 0，不会自己漂移）。告白需同时出现「喜欢你/爱你」与「在一起/交往」类词，且回复里明确答应、没有拒绝词。
  - 曾尝试直接复用宿主的情绪模型配置，免费线路会拒绝非 N.E.K.O 自身的请求；借用宿主 `/api/emotion/analysis` 需要冒用浏览器 CSRF 令牌和 Origin，也会消耗免费额度，因此都不采用。
- **阶段语气改为 `read` 推送**：`relationship_context` 写明阶段的可做/不可做（陌生：不撒娇、不说喜欢，对突然的亲昵会害羞或躲开），附称呼、告白提示和久别提示。在状态变化、阶段转换或每 6 条用户消息时推一次，`coalesce_key` 合并排队中的旧提示；失败 60 秒后重试。文字模式下会作为下一条用户消息的前缀进入上下文。
- **活跃信号**：好感变淡改用「收到这个角色的用户消息」，不再依赖工具调用。
- 状态文件结构不变（仍为 v3），历史记录多一个 `source` 值 `auto`。

## Inferred Technical Needs
- plugin.toml sections: `[plugin.i18n]`、`[plugin.ui]` panel + guide、`[plugin_runtime]`
- SDK surfaces: `register_llm_tool` / `unregister_llm_tool`、`push_message`、`ui.context` / `ui.action`、`timer_interval`、`lifecycle`
- UI surfaces: `ui/panel.tsx`（`state:read`, `action:call`）、`docs/guide.md`（`state:read`）
- state/config: `data_path("state.json")` 原子写；不使用 `config:write`
- lifecycle/background work: `startup` 只读本地状态并注册工具；5 秒维护定时器负责工具对账、每分钟同步角色列表、每 2 分钟核对宿主工具表（宿主重启后自愈）
- external integrations: 本机 `main_server` 只读接口 `/api/characters`、`/api/tools`；会话总线（只读）；可选的插件模型网关 usage `judge`

## Page Layout
- 左侧固定导航：关系概览、心动记录、纪念日、专属称呼、设置；右侧正文独立滚动。
- 导航默认宽度 144px（原 192px），小窗口进一步缩窄；顶部箭头可收起到 36px 窄边并随时展开。状态使用 Hosted UI 本地状态保存，刷新不复位，收起不影响当前页、角色和表单草稿。
- 关系概览保留好感圆环、阶段轨道、今日变化，并显示相识日与下一次纪念；走势和完整变化记录移到心动记录页，称呼编辑独立成页。
- 桌面概览的阶段信息与下一次纪念共用靠右的信息列，好感圆环和相识日保持左侧；右侧信息在立绘之前结束，窄窗口恢复自然换行。
- 概览采用上下两层：上层是好感圆环、阶段信息、进度与立绘，下层是相识日和下一次纪念。下层上下分隔线延伸至整个正文右缘，日期文字仍与上层信息列对齐；随上层实际高度自然下移，避免与立绘或长文案重叠。不增加装饰卡片和填充内容，用通栏细线、留白和字重组织层次。
- 每页共享右上方立绘栏，从标题旁开始，桌面端最大宽 220px、高 360px（较窄桌面 336px），在预留栏内再向右上偏移 12px，降低视觉比重，窗口变小时同步缩小；正文、图表和操作按钮让出立绘区域。透明背景图片保持完整比例，继续使用已有默认图和分阶段图片加载接口；不随本次改动分发其他来源的图片。
- 宽屏为包含标题的正文与立绘两栏，立绘在滚动时停靠右上；窄窗口立绘缩小并与标题并排，正文在下方通栏显示；没有图片时不占位。导航保持在左侧。
- 当前页、角色和走势范围继续使用 Hosted UI 本地状态保存，刷新数据不回到首页。切页保留未保存的称呼草稿。
- 新增导航及概览文案同步八种语言；新增语言文件仅包含这些文案，既有文案继续使用宿主 i18n 回退。

## Shared Portrait Library (v0.5.0)
- `assets/portraits/catalog.json` 管理稳定 ID、显示名、图集、展示图与缩略图；用户提供素材转换为 WebP，保留透明通道，原始大图不进入插件包。当前测试集 18 张。
- 立绘全局共用，不绑定宿主角色；固定、随机、关闭三种模式。旧版阶段图是独立兼容模式，不覆盖图库选择。
- 随机在面板首次挂载、偏好变化或用户点击换图时抽取；切页、切角色、刷新其他数据不抽取。保存上一张 ID，多候选时避开紧接着重复；单候选正常显示，空范围保持空。
- 偏好独立写入 SDK 数据目录 `portraits.json`，使用现有原子写工具，不修改好感状态结构。`pool_ids=null` 包含当前及以后新增的所有图；显式 ID 列表固定范围。
- 图库按 12 张分页，支持图集筛选与搜索；缩略图在接近可见区域时读取。展示图每张 ≤1 MiB、缩略图 ≤64 KiB，后端缓存 ≤8 MiB / 48 项，前端最多 6 张展示图和 32 张缩略图。
- `_portraits.py` 负责目录白名单、元数据、缓存、随机与偏好；UI action 只接受图片 ID，不接受用户传入文件路径。界面上下文只放元数据，图片经独立 action 按需获取。
- 开发整理工具 `tools/prepare_portraits.py` 使用 Pillow，仅开发时需要，不引入运行时依赖、不进入插件包。

## Read Context Plan
`.agent/skills/neko-plugin/`、`docs/zh-CN/plugins/`、`main_routers/tool_router.py`、`plugin/server/routes/llm_tools.py`、`plugin/server/messaging/proactive_bridge.py`、`frontend/plugin-manager/.../hosted/ui-kit/`

## Write Workspace
`love_with_you/`（宿主 N.E.K.O 不做任何修改）

## Risk Follow-ups
- v0.4：关键词判断只看字面，听不懂反话；需要更准时请用户绑定模型。`read` 推送进入历史，每 6 条消息一次，略增 token。语音模式下推送要等会话切换才生效。
- v0.4：好感变淡的活跃信号来自会话总线；总线不可读时（宿主关闭用户插件）面板会提示，此时不要开启变淡。
- 模型调用 `love_update` 的频率与准确度依赖宿主内置模型，需要实机多轮验证。
- “工具描述承载阶段语气”利用宿主现有行为（每轮下发工具描述、同名重注册即时同步），文档未承诺。
- 宿主主动搭话不带插件工具，看不到好感度；建议用户在角色设定里加一句引导。
- 普通 LLM 工具拿不到角色名，独立模式依赖按角色注册；新增角色最多 60 秒后同步。
- UI context 走 ~4 MiB 控制通道，超限会静默丢帧，所以装饰图单独获取并限制 1 MiB。
- 纪念日提醒在工具描述里挂一整天，模型可能提不止一次；描述里已要求「说过就不要重复」，实际效果待实机验证。
- 工具描述变长（称呼 + 纪念日行），每轮多占少量 token。
- （v0.3）好感变淡曾用工具调用作活跃信号，可能误判；v0.4 已改为会话总线的用户消息，仍默认关闭、只降到阶段下界。
- 告白判定完全交给模型：它可能把玩笑当告白，也可能一直不调用 `love_confess`；用户可关闭门槛兜底。待实机验证。
