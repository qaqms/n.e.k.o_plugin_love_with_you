# 开发工具

以下命令从插件根目录运行。工具和依赖只供开发使用，不进入导入包。

| 目录 | 内容 |
| --- | --- |
| `build/` | 面板构建、UI 检查、导入包验证 |
| `preview/` | 关系面板预览、使用临时存档的游戏预览 |
| `assets/` | 立绘处理、图标生成及立绘排除策略 |
| `development/` | 开发副本准备、隔离基准测试 |
| `tests/` | Node 规则测试与 Playwright 浏览器测试 |
| `game/` | 游戏引擎依赖和构建脚本 |
| `node_modules/`、`.build-env/` | 本地开发依赖 |

```powershell
npm --prefix tools run build:panel
npm --prefix tools run check
npm --prefix tools run test:rules
npm --prefix tools run test:navigation
npm --prefix tools test
npm --prefix tools run preview
python -B tools/preview/adventure_preview.py --port 4321
python -B tools/development/prepare_development.py
python -B tools/build/verify_adventure_package.py dist/love_with_you-0.9.0.neko-plugin
```

`build:panel` 只读取相邻 `N.E.K.O` 的渲染器并生成本插件的 `static/panel.html`。`preview` 是模拟关系数据；游戏预览是实际游戏后端配临时存档。`prepare_development.py` 在项目旁生成受管理的 `.neko-dev/love_with_you/`，该副本不包含归档。

浏览器测试可用 `NEKO_PYTHON` 指定 Python、`NEKO_UI_BROWSER` 指定 Chromium。默认截图在 `archive/reviews/browser/`，导航截图在 `archive/reviews/navigation/`；`NEKO_UI_ARTIFACTS` 可覆盖输出位置。测试不会启动或操作用户桌面上的浏览器。

只跑相关浏览器用例时：

```powershell
node --test --test-name-pattern="desktop navigation|short host panels" tools/tests/test_ui.mjs
```

`test:adventure` 包含耗时较长的游戏浏览器回归，日常规则检查用 `test:rules`。游戏规则测试直接使用随插件发布的 A* 库，无需单独安装 `tools/game/node_modules/`。
