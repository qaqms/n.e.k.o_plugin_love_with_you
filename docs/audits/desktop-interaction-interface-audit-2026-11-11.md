# 桌宠交互接口核实

核实日期：2026-11-11。

核实对象为本机 `D:\neko kaifa\N.E.K.O`，Git 提交 `3a7f4555d562002cc5215333d52f67abc618626b`。结论以这一份源码为准，不推断其他宿主版本。宿主代码未修改，也未向正在运行的角色发送测试消息。

## 结论

宿主已有桌宠点击、局部触摸反馈、动作、表情、头顶情绪气泡和若干互动道具。但“宿主前端能执行”与“当前 Python 插件能通过 SDK 订阅或控制”是两个不同边界。

在本插件现有 Python + Hosted TSX 架构下，已确认可用的是聊天回应、带插件来源的聊天内容和插件自己的面板交互。没有发现用于接收桌宠点击/摸头事实，或直接控制主桌宠动作、表情、自定义头顶气泡的正式插件接口。

| 能力 | 宿主已有实现 | 当前插件接入结论 |
| --- | --- | --- |
| 直接点击桌宠 | Live2D 检测短按和命中区域，按配置播放动作或表情 | 未发现对应的结构化插件事件，不能据此可靠推进插件事件 |
| 摸头 | Live2D 可配置原生命中区或自定义区域的点击反馈；部分道具协议带 `head` 等区域信息 | 不等于已有持续抚摸手势，也没有统一的 `head_pat` 插件事件 |
| 指定动作 | 主页面渲染器有动作播放方法 | 未发现 Python SDK 到主桌宠的动作控制通道；模型类型与资源也有限制 |
| 指定表情 | 主页面可按情绪映射驱动 Live2D、VRM、MMD | 可随实际聊天回应间接触发宿主自动情绪反馈；插件不能通过现有 SDK 保证指定表情 |
| 聊天文字展示 | `push_message` 可请求模型回应，或直接展示插件内容 | 可用；直接展示会带插件来源，不能冒充角色实际回复 |
| 头顶情绪气泡 | 监听聊天轮次、语音和情绪事件，显示思考或情绪图形 | 可随聊天间接出现，取决于设置与宿主状态；未发现自定义文案、图案、时长的插件接口 |
| 原生互动道具 | 棒棒糖、拳头戳戳、锤子、猜拳和本地自定义道具 | 宿主内部协议可用，但未发现向本插件发送可靠互动结果的订阅接口 |

## 1. 点击与摸头

Live2D 的短按分支判断是否移动和点击时长，解析命中区后调用 `_playTouchSetWithFallback`。命中区来自模型 HitArea 或自定义矩形；未配置时回退为随机情绪。配置内容是动作与表情候选，并非插件回调地址。

相关代码：

- [短按与触摸区域路由](</D:/neko kaifa/N.E.K.O/static/live2d/live2d-interaction.js:2217>)
- [配置缺失时的回退](</D:/neko kaifa/N.E.K.O/static/live2d/live2d-interaction.js:4428>)
- [模型命中区监听](</D:/neko kaifa/N.E.K.O/static/live2d/live2d-interaction.js:4506>)
- [实际播放触摸动作或表情](</D:/neko kaifa/N.E.K.O/static/live2d/live2d-interaction.js:4576>)

因此可以在宿主已有界面配置“点头部区域后做什么反馈”，前提是当前模型有适合的区域和资源。不能把这个事实写成“插件已能识别玩家摸头”，也不能把短按命中头部等同于连续抚摸。

宿主还提供 `PATCH /api/characters/catgirl/{name}/touch_set` 保存当前模型的触摸配置。这是持久配置接口，会更新角色数据，不是本次播放动作或订阅触摸事件的接口。本次未调用。

- [触摸配置保存接口](</D:/neko kaifa/N.E.K.O/main_routers/characters_router/live2d_models.py:1058>)

## 2. 动作和表情

主页面暴露 `window.LanLan1.setEmotion(emotion)`：委派到 Live2D 情绪管理器、VRM 的 `setMood` 或 MMD 的情绪管理器。`window.LanLan1.playMotion(group, no, priority)` 只处理 Live2D，明确忽略 VRM、MMD、PNGTuber。

- [表情与动作前端兼容接口](</D:/neko kaifa/N.E.K.O/static/live2d/live2d-init.js:265>)

这些方法在主桌宠页面的 JavaScript 环境中。本插件面板运行在 `sandbox="allow-scripts"` 的 Hosted TSX iframe，不能直接取得主页面的 `window.live2dManager` 或 `window.LanLan1`。其宿主请求桥也没有转发任意动作、表情命令的方法。

- [Hosted TSX iframe 边界](</D:/neko kaifa/N.E.K.O/frontend/plugin-manager/src/components/plugin/HostedSurfaceFrame.vue:33>)
- [Hosted UI 请求桥](</D:/neko kaifa/N.E.K.O/frontend/plugin-manager/src/components/plugin/HostedSurfaceFrame.vue:533>)

`push_message` 虽支持 `ui_action` 部件，当前宿主桥实际处理的是 `media_play_url`、`media_allowlist_add` 和 `jukebox_control`；未知 action 只记警告。不能仅因为 schema 接受了字符串，就认为 `set_emotion` 或 `play_motion` 能控制桌宠。

- [实际 ui_action 分发](</D:/neko kaifa/N.E.K.O/plugin/server/messaging/proactive_bridge.py:406>)

模型与情绪映射的 REST 路由主要用于列举资源、编辑映射和保存参数，不能当作“立即播放”的接口。

- [Live2D REST 接口用途](</D:/neko kaifa/N.E.K.O/docs/zh-CN/api/rest/live2d.md:1>)

## 3. 气泡与聊天演出

需要区分聊天记录中的消息与跟随桌宠头部的情绪气泡。

`push_message(visibility=[], ai_behavior="respond", parts=[...])` 可请求角色使用聊天模型生成回应；`visibility=["chat"], ai_behavior="blind"` 可直接展示插件内容而不让模型读取。后者保留插件来源，不代表角色真的说过或记住。

- [SDK 的 visibility / ai_behavior 合同](</D:/neko kaifa/N.E.K.O/plugin/sdk/shared/core/push_message_schema.py:1>)
- [实际聊天展示帧与来源标识](</D:/neko kaifa/N.E.K.O/main_logic/core/turn.py:3232>)

角色实际回应后，宿主前端可调用 `analyzeEmotion`，再用 `applyEmotion` 应用情绪，并发出 `neko-assistant-emotion-ready`。头顶气泡监听轮次、情绪和语音事件，且受用户的气泡开关约束。因此插件发起聊天可能间接带来已有演出，但不能保证笑、脸红或在指定毫秒出现指定气泡。

- [聊天完成后的情绪分析与应用](</D:/neko kaifa/N.E.K.O/static/app/app-websocket.js:1839>)
- [头顶气泡的轮次与情绪处理](</D:/neko kaifa/N.E.K.O/static/avatar/avatar-reaction-bubble.js:2480>)
- [头顶气泡当前暴露的方法](</D:/neko kaifa/N.E.K.O/static/avatar/avatar-reaction-bubble.js:2772>)

该气泡暴露的方法主要用于隐藏、读取状态和锚点，不包含供插件调用的任意内容展示接口。

## 4. 原生道具与小游戏 SDK

原生互动协议 `avatar_interaction` 支持棒棒糖、拳头、锤子、猜拳，以及经过宿主验证的本地自定义道具；区域可包含 `ear/head/face/body`。前端通过已有聊天 WebSocket 发送，宿主校验事实、去重与冷却，再产生一次专用回应。这条路径还会在语音会话中拒绝相应文字互动。

进一步核对身体分区时发现：原生道具的区域分类目前按角色外框比例判断；提示源码明确注明这种方式可能误判，所以暂时省略部位台词与部位记忆。协议中的 `head/body` 字段不能当作已验证准确的身体识别，更不能直接区分肚子和腿。

- [外框比例分区](</D:/neko kaifa/N.E.K.O/frontend/react-neko-chat/src/avatar-tools/interaction.ts:340>)
- [暂时省略部位台词的源码说明](</D:/neko kaifa/N.E.K.O/config/prompts/prompts_avatar_interaction.py:57>)

- [允许的道具、动作与区域](</D:/neko kaifa/N.E.K.O/config/prompts/avatar_interaction_contract.py:19>)
- [WebSocket 入口](</D:/neko kaifa/N.E.K.O/main_routers/websocket_router.py:1424>)
- [互动处理与专用回应](</D:/neko kaifa/N.E.K.O/main_logic/core/greeting.py:168>)
- [发给前端的确认](</D:/neko kaifa/N.E.K.O/main_logic/core/notify.py:1125>)

未发现对应的结构化互动事实向插件事件总线发布。现有 AI 回复向插件会话总线发布的是文本、轮次类型和时间等信息，不能把“读到一句像摸头回应的话”视为可验证的点击、部位或游戏结果。

- [AI 回复的插件会话发布字段](</D:/neko kaifa/N.E.K.O/main_logic/core/turn.py:707>)

另有小游戏 SDK 的 `avatar.mount(...)` 与返回控制器的 `setEmotion(...)`。它面向小游戏自己的渲染槽位，不是对主桌宠的远程控制接口，不能直接接入当前 Hosted TSX 面板后宣称已经控制桌宠。

- [小游戏 Avatar 挂载与控制器](</D:/neko kaifa/N.E.K.O/static/game/sdk/neko-minigame-sdk.d.ts:614>)

`/plugin/{plugin_id}/ui-api/push` 则广播到该插件静态页面的 SSE 订阅者；其中的 `avatar`、`style` 元数据不是主桌宠动作或头顶气泡指令。

- [插件静态 UI 的推送用途](</D:/neko kaifa/N.E.K.O/plugin/server/routes/plugin_ui.py:460>)

## 5. 验证与后续边界

本次除追踪源码和本地文档外，执行了以下隔离检查：

- 宿主已有触摸手势与 Live2D 表情测试共 45 项，通过。命令：`node --test tests/frontend/model_touch_gestures.test.cjs tests/frontend/live2d_expression_lipsync.test.cjs`。
- 使用仅收集 JSON 的模拟接收端运行实际 `ProactiveBridge._dispatch`，共 7 项断言通过：未知的 `set_emotion/play_motion/avatar_bubble` 不产生前端事件；已有媒体动作能分发；三种聊天行为分别生成正确的投递模式。未使用网络套接字或真实角色。
- 未修改宿主代码；检查后宿主 Git 工作区仍干净。

上述测试不证明实机模型的观感、聊天模型执行效果或完整桌宠演出时序。

当前可以继续使用聊天与面板承载事件，让宿主的已有情绪机制自然跟随实际回应。若以后要可靠实现“玩家摸头后推进剧情、播放指定动作、显示自定义头顶气泡”，需要宿主公开两类能力：带角色、区域、手势、事件 ID 和时间的交互事件，以及带资源校验、播放确认和取消机制的演出命令。这是建议的接口需求，不是当前已有 API；本次没有实现或改动宿主。

2026-11-12 用户决定：宿主未提供的接口能力暂不开发，继续保持宿主代码零修改。上述接口建议保留为研究记录，不进入当前实施计划；后续功能以现有正式插件接口为边界。
