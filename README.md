# 与你相恋

给 N.E.K.O 角色加一层恋爱关系：好感度 0–100，五个阶段（陌生 → 熟悉 → 好感 → 暧昧 → 恋人）。
角色在文字聊天里按阶段调整语气和分寸；每轮对话后插件自动判断好感变化，好感会下降，阶段也能倒退。

- 默认用本地关键词判断，无需设置；在 N.E.K.O 的「Plugin API」页给「好感判断」绑定一个模型可以判断得更准。
- 每轮最多 ±3，每天最多 +15 / -30。
- 吐槽工作、心情不好不算冲着角色；每天第一次扣分减半。
- 好感到 80 后需要在聊天里真的告白才成为恋人（可关闭）。
- 可选：开启「允许猫娘主动告白」，角色达到条件后在正常聊天后主动表达心意，等你明确答应；有冷却与次数限制，默认关闭。
- 可选：好久没聊时好感慢慢变淡，但不会让关系倒退（默认关闭）。
- 面板可以看 30 / 90 / 365 天的好感走势。
- 默认所有角色共用一份好感；可在面板里开启「每个角色独立好感」，切换不会清除任何数据。
- 你说话时插件会悄悄把当前关系告诉角色（不打断对话）。
- 可以给每个阶段设定角色对你的称呼，阶段变化后自动切换。
- 自动记录相识日和在一起的日子，第 100 / 520 / 1000 天和每个周年角色会记得；也可以添加生日等自定义纪念日。
- 共用立绘库支持固定图片、随机展示和关闭，可浏览缩略图并选择随机范围。
- 使用说明见插件内的「使用指南」页（`docs/guide.md`）。

### 隐私

插件在内存里读取最近的聊天内容来判断好感，不把聊天内容写进文件。本机插件数据目录保存好感数值、每天的好感、每次变化的一句理由、告白时的一句记录、主动告白的状态与时间和次数、你设置的称呼和纪念日，以及单独存放的立绘和外观偏好。

没有绑定模型时不联网，只访问本机 N.E.K.O 主程序的角色列表和工具列表接口。绑定后，每一轮和上一轮的对话（每句最多 300 字）会经 N.E.K.O 发给你在「Plugin API」里配置的模型。

主动告白由 N.E.K.O 当前角色的聊天模型生成，与普通聊天使用相同的模型配置；它不需要为「好感判断」另外绑定模型。

### 装饰立绘

在「设置 → 立绘」选择固定、随机或关闭。图库及偏好所有角色共用，与独立好感开关无关。

- 固定模式：浏览图集、搜索名称、选择一张图片；选择会保存，重启后仍生效。
- 随机模式：每次打开面板抽取一张；切页、切角色和刷新数据不换图。可手动「换一张」，有多张候选时避免紧接着重复，也会避开上次打开面板时的最后一张。
- 随机范围：可跨页勾选任意图片，「全部加入」包含以后新增的图片，「清空选择」保持空范围，不会自动变回全部。
- 关闭：不显示立绘，正文使用全部可用宽度。

当前测试图库使用用户提供的「千恋万花_立绘」目录，共 18 张，含子目录服装素材。展示图和缩略图放在 `assets/portraits/`，通过 `catalog.json` 管理；不复制原始大图。运行时仅按需读取本地图片。

新增图库：安装开发工具 Pillow 后运行 `uv run --project "../N.E.K.O" python tools/prepare_portraits.py "素材目录"`，默认重建 `assets/portraits/catalog.json`（同一来源相对路径保持相同 ID）。需要合并多套图库时使用 `--output` 分别生成到临时目录，再合并清单中的 `items` 和各 ID 子目录；清单格式见 `assets/README.md`。整理工具不进入插件包。

旧版 `assets/decoration.webp` 和 `assets/stage_<阶段>.webp` 仍可在「旧版阶段图」模式使用；阶段为 `stranger` / `familiar` / `fond` / `ambiguous` / `lover`，缺少阶段图时回退默认图。也支持 PNG、JPG、JPEG、GIF，每张不超过 1 MiB。新图库不会按宿主角色或好感阶段自动切换。

面板分为「关系概览 / 心动记录 / 纪念日 / 专属称呼 / 设置」五页。桌面侧栏可收起为 56px 的图标导航，仍可直接切页；700px 以下窗口自动使用图标导航，鼠标悬停显示页面名称。数据刷新保留当前页面、侧栏和所选角色。

立绘在关系概览展示，设置页显示小图预览，其他页面让正文使用全部宽度。桌面立绘栏最大宽 220px、高 360px；899px 以下移到标题右侧。支持深浅色主题和减少动态效果偏好。

称呼草稿按角色临时保留，切页、切角色和后台刷新不会覆盖未保存的修改；可保存或撤销，关闭面板后未保存草稿会丢弃。好感调整支持数字输入和滑块，相识日输入限制为 1970 年至今天。保存过程中禁止重复提交和关闭弹窗；保存成功后若刷新失败，会单独提示刷新，不重复执行保存。

本轮审查记录见 `docs/ui-review-2026-11-07.md`。

### 主题配色

在「设置 → 外观」选择樱粉、晴空蓝、薄荷绿、雾紫、杏桃或湖水青，也可以用取色器自选颜色，或输入 `#RRGGBB` 色号。选择后立即预览，点击「保存」后生效到后续打开的面板；未保存时可撤销，也可恢复默认樱粉。

显示模式支持跟随系统、浅色和深色。文字、按钮和图表按所选颜色自动生成可读的深浅变化。设置对所有角色共用，保存在插件数据目录的 `appearance.json`；重启保留，不修改宿主主题。切页或切角色不会丢掉正在预览的配色，关闭面板会丢弃未保存修改。

### UI 开发与检查

以下工具读取相邻宿主的真实 Hosted TSX 渲染器和控件，在独立浏览器页面里使用模拟数据，不启动或修改宿主。先在插件根目录安装开发依赖：

```powershell
npm --prefix tools install
npm --prefix tools exec -- playwright install chromium
npm --prefix tools run check
npm --prefix tools test
npm --prefix tools run preview
```

预览地址为 `http://127.0.0.1:4318`。可追加 `?locale=en`、`?art=off`、`?empty=1` 或 `?page=settings` 检查不同状态。默认宿主目录为 `../N.E.K.O`；可用 `NEKO_HOST_ROOT` 指定其他宿主源码目录，`PORT` 指定预览端口。已有外置依赖时，`NEKO_UI_DEPS` 可指定含 `node_modules` 的目录；`NEKO_UI_BROWSER` 可指定已有 Chromium 可执行文件。浏览器截图写入仓库外的 `.neko-ui-review/artifacts`（可由 `NEKO_UI_ARTIFACTS` 指定）。

UI 检查包含 SDK 类型、多语言参数一致性、17 项浏览器回归和 4 项主题配色测试；布局覆盖 320 / 390 / 700 / 800 / 980 / 1440px、深浅主题和五个页面。配色测试覆盖六种预设、黑白及 216 种自定义颜色的文字和按钮对比度。工具和开发依赖不进入开发副本或发布包。

### 本地开发（不改动宿主）

1. 在本目录运行 `python -B tools/prepare_development.py`（Python 3.11 或以上），在仓库旁生成 `../.neko-dev/love_with_you`。也可以使用宿主已有的 Python：`& "../N.E.K.O/.venv/Scripts/python.exe" -B tools/prepare_development.py`（PowerShell）。
2. 在 N.E.K.O 插件管理器左侧打开「开发模式」，点「加载未打包插件」，选择脚本输出的 `.neko-dev/love_with_you` 绝对路径。宿主要求加载目录名与入口包名一致，不能直接选择带点号的仓库目录。
3. 继续在当前源码目录修改文件；修改后重新运行准备脚本，再点开发插件卡片上的「重载」。生成目录是可重复生成的副本，不要在那里编辑；脚本不会改动宿主或插件数据目录。
4. 测试：在本插件目录使用已安装 pytest 的 Python 运行 `python -B -m pytest tests --rootdir=tests --confcutdir=tests --import-mode=importlib -p no:cacheprovider --basetemp "../.pytest-love-with-you"`。
   （`--basetemp` 防止 pytest 在本机临时目录不可写时把临时文件写进插件或宿主目录。）
   测试无需启动宿主或绑定模型；运行时测试会隔离 SDK 边界，并实际验证评分线程、过期结果丢弃和停止/重启行为。

## Development

This directory contains the editable plugin source. Local archives may not include Git metadata.

当前目录是可编辑的插件源码；从本地归档解压的副本可能不包含 Git 元数据。

このディレクトリには編集用ソースがあります。アーカイブには Git メタデータが含まれない場合があります。

When publishing to the plugin market, use this GitHub repository name:

发布到插件市场时，请使用以下 GitHub 仓库名：

プラグインマーケットへ公開する際は、次の GitHub リポジトリ名を使用してください：

```text
n.e.k.o_plugin_love_with_you
```

From this plugin repository root:

```bash
uvx ruff==0.12.4 check --ignore-noqa --config ruff.toml .
```

From this plugin repository root / 在当前插件仓库根目录中 / このプラグインリポジトリのルートで：

```bash
uv run --project "../N.E.K.O" neko-plugin sync . --clean
uv run --project "../N.E.K.O" neko-plugin check .
uv run --project "../N.E.K.O" neko-plugin check -r .
```

Python runtime dependencies are declared in `pyproject.toml` and synced into
`vendor/` for packaging. The generated `vendor/` directory is not committed;
local builds and CI recreate it before release checks.

Python 运行时依赖声明在 `pyproject.toml` 中，并在打包时同步到 `vendor/`。
生成的 `vendor/` 不提交；本地构建和 CI 会在发布检查前重新生成它。

Python ランタイム依存関係は `pyproject.toml` に宣言し、パッケージ化時に
`vendor/` へ同期します。生成された `vendor/` はコミットせず、ローカルビルドと
CI が公開前チェックで再生成します。

## Market release / Market 发布 / Market 公開

Publish the version declared in `plugin.toml`. By default this pushes the Git
tag, waits for the standard GitHub Release, and notifies the plugin market.

发布 `plugin.toml` 中声明的版本。默认会推送 Git tag、等待标准 GitHub
Release，然后通知插件市场。

`plugin.toml` で宣言されたバージョンを公開します。既定では Git tag を
push し、標準 GitHub Release を待ってからプラグインマーケットへ通知します。

```bash
uv run --project "../N.E.K.O" neko-plugin publish .
```

To run only one half explicitly / 如需仅执行一部分 / 一方のみを実行する場合:

```bash
uv run --project "../N.E.K.O" neko-plugin publish github .
uv run --project "../N.E.K.O" neko-plugin publish market https://github.com/owner/repo/releases/tag/v0.1.0
```

The generated `.github/workflows/release.yml` builds and uploads
`love_with_you.neko-plugin`. The market independently verifies that Release
before publishing it.

生成的 `.github/workflows/release.yml` 会构建并上传插件包；Market 会独立验证
该 Release 后再发布。

生成された `.github/workflows/release.yml` がプラグインパッケージをビルドして
アップロードし、Market はその Release を独立検証してから公開します。

## Entry

```toml
entry = "plugin.plugins.love_with_you:LoveWithYouPlugin"
```
