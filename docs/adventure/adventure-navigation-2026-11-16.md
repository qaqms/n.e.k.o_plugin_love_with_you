# 同行游戏入口（0.12.1）

- 游戏入口从宿主顶部的第二个面板移至插件左侧导航，紧接「专属称呼」。
- 入口和游戏标题改为「同行游戏」；林地仍是第一章的场景。
- 宿主只注册 `main` 面板，入口为 `static/panel.html`，上下文仍为 `dashboard`。
- `tools/build/build_panel.mjs` 使用相邻宿主原有的 TSX 渲染器和 UI Kit，把现有关系组件及翻译编译进静态主面板；不改宿主。修改 UI、翻译或更新宿主工具后，打包前运行 `npm --prefix tools run build:panel`。
- 采用同源静态主面板是因为 Hosted TSX 的不透明来源沙箱无法直接承载需要同源资源的 Phaser 子页面。
- 宿主「打开界面」使用的静态根地址自动进入主面板，显式 `index.html` 地址保留游戏兼容。静态主面板自行刷新关系上下文，后台刷新失败保留当前页面与草稿。
- 游戏首次访问才挂载，此后切页只隐藏，保留原文档和控制身份；离开时发送暂停消息，返回后由玩家继续。代理只接受指定游戏 iframe、同源、固定 `adventure_action` 的请求。
- 不改变战斗规则、快照、存档版本或结算；规则 12、存档版本 13 保持兼容。

验证入口：后端 `pytest tests`；前端 `tools/build/check_ui.mjs`；导航定向回归 `tools/tests/test_ui.mjs`；真实静态主面板及游戏通信 `tools/tests/test_companion_navigation.mjs`；打包后 `tools/build/verify_adventure_package.py`。真实宿主的导入替换与角色模型对话仍需实机验收。
