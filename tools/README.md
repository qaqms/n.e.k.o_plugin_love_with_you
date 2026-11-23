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
npm --prefix tools run build:cottage
npm --prefix tools run check
npm --prefix tools run test:rules
npm --prefix tools run test:navigation
npm --prefix tools run test:cottage
npm --prefix tools test
npm --prefix tools run preview
python -B tools/preview/adventure_preview.py --port 4321
python -B tools/development/prepare_development.py
python -B tools/build/verify_adventure_package.py dist/love_with_you-0.9.0.neko-plugin
python -B tools/build/audit_release.py --history --package dist/love_with_you-0.9.0.neko-plugin
.\tools\.build-env\Scripts\python.exe -B tools/build/precheck_release.py --report archive/reviews/release-audit-20261116/market-precheck.json
```

`build:panel` 读取相邻宿主目录（`N.E.K.O` 或 `N.E.K.O-main`，`NEKO_HOST_ROOT` 可覆盖，见 `build/host_root.mjs`）的渲染器，在 `plugin.toml` 声明的 `static/panel-<版本>.html` 生成主面板。发布时同步更新入口文件名和版本号，生成新版页面后将旧页面移入归档。`preview` 是模拟关系数据；游戏预览是实际游戏后端配临时存档。`prepare_development.py` 在项目旁生成受管理的 `.neko-dev/love_with_you/`，该副本不包含归档。

浏览器测试可用 `NEKO_PYTHON` 指定 Python（不设时用宿主 `.venv`，没有则用 PATH 里的 `python`）、`NEKO_UI_BROWSER` 指定 Chromium。默认截图在 `archive/reviews/browser/`，导航截图在 `archive/reviews/navigation/`；`NEKO_UI_ARTIFACTS` 可覆盖输出位置。测试不会启动或操作用户桌面上的浏览器。

只跑相关浏览器用例时：

```powershell
node --test --test-name-pattern="desktop navigation|short host panels" tools/tests/test_ui.mjs
```

`test:adventure` 包含耗时较长的游戏浏览器回归，日常规则检查用 `test:rules`。游戏规则测试直接使用随插件发布的 A* 库，无需单独安装 `tools/game/node_modules/`。

游戏浏览器测试显式分配 `neko-adventure-test-*` 临时目录，关闭服务器后删除测试存档；预览失败也执行清理。手动预览不指定 `--data` 时使用临时目录，指定时使用该目录并保留数据。

发布检查扫描当前源码、全部本地 Git 引用可达的历史对象和导入包，输出仅含规则、文件位置、行号与指纹，不回显疑似密钥。扫描覆盖常见凭据格式和直接写入代码的高熵配置值，不能保证发现所有编码或自定义形式的秘密。它同时检查发布文件范围，拒绝开发记录、存档、日志、私有配置和密钥文件。

`precheck_release.py` 将已跟踪及未忽略的新文件导出到临时目录，再调用相邻宿主的官方 SDK 预检，包含 lint、sync 和 release-check。它检查当前工作内容，不要求先提交；结束后清理副本，包写入 `dist/precheck/`。本地 `.build-env` 需安装宿主锁定的运行依赖和检查依赖。一种做法（在宿主目录里运行，只读取宿主的 `uv.lock`，依赖装进插件的 `tools/.build-env`）：`uv venv <插件>/tools/.build-env --python 3.12`，`uv export --frozen --no-dev --no-hashes --no-emit-project > <临时目录>/host-req.txt`，`uv pip install --python <插件>/tools/.build-env/Scripts/python.exe -r <临时目录>/host-req.txt pytest pytest-randomly pytest-asyncio ruff==0.12.4`。插件目录没有 `.git` 时，预检和发布扫描用临时的空索引按 `.gitignore` 列出文件，不会在插件目录里建仓库。本次使用 pytest 9.1.1、pytest-randomly 4.1.0、pytest-asyncio 1.4.0 和 Ruff 0.12.4。
