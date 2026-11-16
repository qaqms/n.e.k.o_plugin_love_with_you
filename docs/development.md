# 开发说明

从插件仓库根目录运行下列命令。相邻 `../N.E.K.O` 仅提供 SDK、渲染器和构建工具，不修改宿主代码。游戏的规则版本和存档约定先读[开发总览](adventure-project-overview.md)，各模块入口见[模块职责](module-map.md)。

## 本地加载

需要 Python 3.11 或以上。准备宿主可加载的开发副本：

```powershell
python -B tools/development/prepare_development.py
```

脚本会在仓库旁生成 `../.neko-dev/love_with_you/`。在宿主插件管理器中打开「开发模式」，选择「加载未打包插件」，加载脚本输出的绝对路径。宿主要求目录名与入口包名一致，不要直接加载带点号的仓库目录。

修改当前源码后重新运行脚本，再在宿主中重载。生成副本可重复创建，不要直接编辑；脚本不会覆盖玩家数据。

## 检查与预览

Python 测试需要 pytest；宿主预检还使用其锁定的测试依赖，详见[工具说明](../tools/README.md)。

```powershell
python -B -m pytest tests --rootdir=tests --confcutdir=tests --import-mode=importlib -p no:cacheprovider --basetemp "../.pytest-love-with-you"
npm --prefix tools install
npm --prefix tools exec -- playwright install chromium
npm --prefix tools run check
npm --prefix tools run test:rules
npm --prefix tools test
npm --prefix tools run test:navigation
```

独立预览使用模拟关系数据或临时冒险存档，不需要启动宿主：

```powershell
npm --prefix tools run preview
python -B tools/preview/adventure_preview.py --port 4321
```

关系面板默认地址为 `http://127.0.0.1:4318`，游戏预览为 `http://127.0.0.1:4321`。浏览器测试不操作桌面浏览器；依赖、端口、截图目录及定向测试的参数见[工具说明](../tools/README.md)。

## 构建与发布检查

修改界面、翻译或宿主渲染器后，先重建静态主面板：

```powershell
npm --prefix tools run build:panel
```

使用已经准备好宿主 SDK 和检查依赖的本地 Python 环境：

```powershell
.\tools\.build-env\Scripts\python.exe -B tools/build/precheck_release.py --report archive/reviews/market-precheck.json
python -B tools/build/verify_adventure_package.py dist/precheck/love_with_you.neko-plugin
python -B tools/build/audit_release.py --history --package dist/precheck/love_with_you.neko-plugin
```

预检会导出当前源码到临时目录，调用官方 SDK 的 lint、sync 和 release-check；不会创建标签、推送或提交市场。开发工具、测试、历史文档和本地归档不进入导入包。

市场头像路径和本次首页整理见[发布资料说明](market-release-2026-11-16.md)。正式发布前处理[发布审计](audits/release-readiness-2026-11-16.md)中的待确认事项，并以宿主 SDK 当前的发布流程为准。

## 历史记录

历次功能说明与旧版 README 保留在[历史文档](readme-history-2026-11-16.md)。它们记录当时的规则、数值和测试边界，不能替代当前使用指南。
