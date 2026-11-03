# 与你相恋

给 N.E.K.O 角色加一层恋爱关系：好感度 0–100，五个阶段（陌生 → 熟悉 → 好感 → 暧昧 → 恋人）。
角色在文字聊天里按阶段调整语气和分寸；每轮对话后插件自动判断好感变化，好感会下降，阶段也能倒退。

- 默认用本地关键词判断，无需设置；在 N.E.K.O 的「Plugin API」页给「好感判断」绑定一个模型可以判断得更准。
- 每轮最多 ±3，每天最多 +15 / -30。
- 吐槽工作、心情不好不算冲着角色；每天第一次扣分减半。
- 好感到 80 后需要在聊天里真的告白才成为恋人（可关闭）。
- 可选：好久没聊时好感慢慢变淡，但不会让关系倒退（默认关闭）。
- 面板可以看 30 / 90 / 365 天的好感走势。
- 默认所有角色共用一份好感；可在面板里开启「每个角色独立好感」，切换不会清除任何数据。
- 你说话时插件会悄悄把当前关系告诉角色（不打断对话）。
- 可以给每个阶段设定角色对你的称呼，阶段变化后自动切换。
- 自动记录相识日和在一起的日子，第 100 / 520 / 1000 天和每个周年角色会记得；也可以添加生日等自定义纪念日。
- 使用说明见插件内的「使用指南」页（`docs/guide.md`）。

### 隐私

插件在内存里读取最近的聊天内容来判断好感，不把聊天内容写进文件。本机插件数据目录只保存好感数值、每天的好感、每次变化的一句理由、告白时的一句记录、你设置的称呼和纪念日。

没有绑定模型时不联网，只访问本机 N.E.K.O 主程序的角色列表和工具列表接口。绑定后，每一轮和上一轮的对话（每句最多 300 字）会经 N.E.K.O 发给你在「Plugin API」里配置的模型。

### 装饰立绘

把图片放到 `assets/decoration.webp`（也支持 `.png` / `.jpg` / `.jpeg` / `.gif`），面板左侧会显示它。
想让立绘随关系变化，再放 `assets/stage_<阶段>.webp`，阶段名为 `stranger` / `familiar` / `fond` / `ambiguous` / `lover`；
没有对应阶段图时使用 `decoration`。每张图需不超过 1 MB；建议使用透明背景的竖版立绘。请只放你有权分发的图片。

### 本地开发（不改动宿主）

1. 在 N.E.K.O 插件管理器左侧打开「开发模式」，点「加载未打包插件」，选择本目录。
2. 修改代码后点开发插件卡片上的「重载」。
3. 测试：在 N.E.K.O 目录运行 `uv run python -m pytest "../love_with_you/tests" -p no:cacheprovider --basetemp "../.pytest-tmp"`。
   （`--basetemp` 防止 pytest 在本机临时目录不可写时把临时文件写进插件或宿主目录。）

## Development

This directory is both the editable plugin source and its Git repository.

当前目录既是可编辑的插件源码，也是插件自己的 Git 仓库。

このディレクトリは、編集するプラグインソースであり、プラグイン自身の Git リポジトリでもあります。

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
