# 文档索引

先看[项目说明](../README.md)、[模块职责](module-map.md)和[同行游戏总览](adventure-project-overview.md)。本文中的目录相对插件根目录。

| 目录或文件 | 用途 |
| --- | --- |
| `__init__.py` | 宿主 SDK 入口、生命周期和调用编排 |
| `backend/relationship/` | 关系、称呼、纪念日、商店、经历和立绘业务 |
| `backend/adventure/` | 同行游戏服务、经济、旅程与快照校验 |
| `backend/infrastructure/` | 文件存储、严格 JSON、宿主查询和判断模型接口 |
| `backend/paths.py` | 后端共用的插件与静态资源位置 |
| `ui/` | 主面板 TSX 和界面逻辑 |
| `static/` | 已构建面板、游戏页面、游戏逻辑与发布美术 |
| `assets/`、`i18n/` | 立绘资源与多语言 |
| `tests/` | Python 业务和运行时测试 |
| `tools/` | 开发工具，见[工具说明](../tools/README.md) |
| `archive/` | 本地备份、截图、基准与迁移记录，不随包发布 |
| `dist/` | 当前导入包；旧包在 `dist/archive/` |

## 使用与开发

- [使用指南](guide.md)
- [开发说明与检查命令](development.md)
- [市场发布资料与头像路径](market-release-2026-11-16.md)
- [礼物资料](gifts.md)
- [模块职责与扩展入口](module-map.md)
- [架构与设计沿革](architecture.md)
- [2026-11-16 目录整理](project-structure-2026-11-16.md)
- [旧版 README 与历史开发记录](readme-history-2026-11-16.md)

## 同行游戏

专题文档集中在 `docs/adventure/`；[开发总览](adventure-project-overview.md)保留固定入口。

- [入口与导航](adventure/adventure-navigation-2026-11-16.md)
- [焦点、暂停与控制权恢复](adventure/adventure-focus-recovery-2026-11-16.md)
- [测试版提示](adventure/adventure-test-label-2026-11-16.md)
- [关卡与长期规划](adventure/adventure-chapter-structure-proposal-2026-11-15.md)
- [精英与首领阶段](adventure/adventure-difficulty-2026-11-15.md)
- [火系技能线](adventure/adventure-fire-line-2026-11-15.md)

## 审计与方案

审计记录在 `docs/audits/`，包括[稳定性](audits/stability-audit-2026-11-12.md)、[模块与界面状态](audits/module-ui-state-audit-2026-11-12.md)和[解耦、性能与安全](audits/decoupling-performance-security-audit-2026-11-12.md)。

市场发布前先看[2026-11-16 发布审计](audits/release-readiness-2026-11-16.md)，其中列明扫描范围、清理结果和仍待项目主人确认的事项。

后续方案在 `docs/plans/`，包括[开发调研](plans/next-development-research-2026-11-11.md)、[专属称呼](plans/relationship-addressing-plan-2026-11-11.md)和[桌面互动](plans/body-touch-interaction-proposal-2026-11-11.md)。历史文档描述的是对应日期的状态，当前实现以模块职责和开发总览为准。
