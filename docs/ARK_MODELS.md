# 火山 Coding Plan 模型下拉目录

核对日期：2026-11-06。清单来自[官方“其他工具”配置说明](https://docs.volcengine.com/docs/ark/coding-plan-personal-ai-other-tools?lang=zh)，页面标注更新时间为 2026-11-04 17:47:41。
这是文档支持清单的版本快照，不是账号权限的实时探测，也不代表已经逐个做过真实推理测试。

| 分组 | 可直接发送的模型 ID |
|---|---|
| 路由入口 | `ark-code-latest` |
| Doubao | `doubao-seed-evolving`、`doubao-seed-2.1-pro`、`doubao-seed-2.1-lite`、`doubao-seed-2.0-mini` |
| GLM | `glm-5.3`、`glm-5.3-flash` |
| DeepSeek | `deepseek-v4.1-flash`、`deepseek-v4.1-flash-economy`、`deepseek-v4-flash`、`deepseek-v4-pro` |
| Kimi | `kimi-k2.8-preview`、`kimi-k3`、`kimi-k3.1-pro` |
| 别名 | `glm-latest`（当前指向 `glm-5.3`） |

共 13 个具体文本生成模型、1 个路由入口、1 个别名。下拉菜单另有“手动输入模型 ID”，
方便配置新模型或特定账号允许的 ID。选择模型只修改本次请求中的 `model`，不会修改控制台路由、
切换 Base URL 或清除已填写的 Key；不请求普通按量付费模型目录。

`ark-code-latest` 跟随控制台配置，控制台选为 Auto 时才智能路由。应用不把 `auto` 当作
可直接发送的模型 ID。列表按生成模型筛选：Embedding 向量模型不适用于几何文本抽取接口。

根据[官方套餐概览](https://docs.volcengine.com/docs/ark/coding-plan-personal-plan-overview?lang=zh)，
`glm-5.3` 和 `kimi-k3` 默认思考且不支持关闭。因此选择这些模型（包括当前 `glm-latest` 别名）时，
界面禁用“关闭深度思考”；若此前选了关闭，会回到默认模式并提示。

[官方发布公告](https://docs.volcengine.com/docs/ark/coding-plan-personal-feature-release?lang=zh)
记录 MiniMax M3 与 Kimi K2.7 Code 于 2026 年 10 月启动下线；它们已不在上述当前配置页的清单中，
因此没有作为默认候选继续展示。实际区域和账号可用性仍以服务商返回结果为准。

维护时应同时更新 `detweave/web/index.html` 的选项、核对日期、此记录，以及
`scripts/check_ui.cjs` 的完整菜单与请求模型断言。应用不在加载时自动访问服务商或变更账户设置。
