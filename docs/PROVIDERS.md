# Provider and subscription catalog / 服务商与订阅目录

Verified / 核对日期: 2026-11-06. This is public configuration data, not an account entitlement check or a claim that every model has been live-tested. No API keys are included. / 本目录不代表账号权限或所有模型已实测，不包含密钥。

## Volcengine Coding Plan / 火山 Coding Plan

- Protocol / 协议: `openai`
- Base URL: `https://ark.cn-beijing.volces.com/api/coding/v3`
- Models / 模型: `ark-code-latest`, `doubao-seed-evolving`, `doubao-seed-2.1-pro`, `doubao-seed-2.1-lite`, `doubao-seed-2.0-mini`, `glm-5.3`, `glm-5.3-flash`, `glm-latest`, `deepseek-v4.1-flash`, `deepseek-v4.1-flash-economy`, `deepseek-v4-flash`, `deepseek-v4-pro`, `kimi-k2.8-preview`, `kimi-k3`, `kimi-k3.1-pro`
- Lite / Pro 订阅；13 个生成模型、路由入口及别名。ark-code-latest 跟随控制台，选为 Auto 才自动路由。套餐使用范围以官方说明为准。
- Lite / Pro subscription; 13 generation models, a route and an alias. ark-code-latest follows the console selection; Auto must be selected there. Check official plan eligibility.
- Sources / 来源: [Configuration and models](https://docs.volcengine.com/docs/ark/coding-plan-personal-ai-other-tools?lang=zh), [Plan overview](https://docs.volcengine.com/docs/ark/coding-plan-personal-plan-overview?lang=zh)

## DeepSeek official API · metered / DeepSeek 官方 API · 按量

- Protocol / 协议: `openai`
- Base URL: `https://api.deepseek.com`
- Models / 模型: `deepseek-flash`, `deepseek-v4-pro`
- 官方按量 API。deepseek-flash 当前由 DeepSeek-V4.1-Flash-1017 提供；不是火山或其他平台订阅。
- Official metered API. deepseek-flash currently resolves to DeepSeek-V4.1-Flash-1017; separate from reseller subscriptions.
- Sources / 来源: [Official API](https://api-docs.deepseek.com/), [Usage pricing](https://api-docs.deepseek.com/quick_start/pricing)

## Kimi Code · official subscription / Kimi Code · 官方订阅

- Protocol / 协议: `openai`
- Base URL: `https://api.kimi.com/coding/v1`
- Models / 模型: `kimi-for-coding`, `k3.1-pro`, `k3.1-pro-highspeed`, `k3`, `k3-256k`, `kimi-for-coding-highspeed`
- 6 个官方 Coding ID，套餐档位决定模型权限。保留服务商默认思考；K3.1 Pro 不支持关闭思考。与 Moonshot 按量 API 分开。
- Six official Coding IDs; model access depends on membership. Provider-default thinking is retained; K3.1 Pro requires thinking. Separate from Moonshot metered API.
- Sources / 来源: [Models and membership tiers](https://www.kimi.com/code/docs/en/kimi-code/models.html), [Membership guide](https://www.kimi.com/en/help/kimi-code/membership-guide)

## GLM Coding Plan · BigModel subscription / GLM Coding Plan · 智谱官方订阅

- Protocol / 协议: `openai`
- Base URL: `https://open.bigmodel.cn/api/coding/paas/v4`
- Models / 模型: `glm-5.3`, `glm-5.3-flash`
- Lite / Pro / Max，另有团队版。仅适用于官方指定工具与产品环境；此处整理接口配置，不代表 DetWeave 已获套餐接入许可。
- Lite / Pro / Max and team plans. Restricted to officially supported tools and product environments; listing configuration does not establish DetWeave plan eligibility.
- Sources / 来源: [Plans and models](https://docs.bigmodel.cn/cn/coding-plan/overview), [Endpoint and eligible tools](https://docs.bigmodel.cn/cn/coding-plan/tool/others)

## Alibaba Cloud Model Studio Token Plan / 阿里云百炼 Token Plan

- Protocol / 协议: `openai`
- Base URL: `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`
- Models / 模型: `auto`, `qwen3.8-max`, `qwen3.8-flash`, `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-flash`, `deepseek-v4.1-flash`, `deepseek-v4-pro`, `deepseek-v4-pro-0813`, `deepseek-v4-flash-0731`, `glm-5.3`, `glm-5.2`
- 北京地域；个人版 Lite / Essential / Standard / Pro，另有团队版。此处列个人版文本生成模型。Token Plan 与旧 Coding Plan 的地址和凭据不同；文档对自研工具适用范围有差异，使用前以账号合同及平台确认为准。
- Beijing region; personal Lite / Essential / Standard / Pro, plus team plans. Personal text-generation models are listed. Token Plan and legacy Coding Plan use different endpoints and credentials. Official pages differ on custom-tool eligibility; confirm account terms with the provider.
- Sources / 来源: [Plans and models](https://help.aliyun.com/zh/model-studio/token-plan-personal-overview), [Base URL](https://help.aliyun.com/zh/model-studio/base-url), [Eligibility](https://help.aliyun.com/zh/model-studio/more-tools), [Product overview](https://help.aliyun.com/zh/model-studio/token-plan-overview)

## Tencent Hunyuan Hy Token Plan / 腾讯混元 Hy Token Plan

- Protocol / 协议: `openai`
- Base URL: `https://tokenhub.tencentmaas.com/plan/v3`
- Models / 模型: `hy4`, `hy4-preview`, `hy3`
- 混元专属订阅。Lite / Standard / Pro / Max：28 / 78 / 238 / 468 元每月（核对日标价）；560 / 1560 / 4760 / 9360 月积分。订阅限官方允许的交互式 AI 工具场景。
- Hunyuan subscription. Lite / Standard / Pro / Max: CNY 28 / 78 / 238 / 468 per month at verification; 560 / 1560 / 4760 / 9360 monthly credits. Restricted to provider-approved interactive AI-tool use.
- Sources / 来源: [Plan details and models](https://cloud.tencent.com/document/product/1823/130060), [Connection settings](https://cloud.tencent.com/document/product/1823/130119/)

## Tencent General Token Plan · multi-model / 腾讯通用 Token Plan · 多模型

- Protocol / 协议: `openai`
- Base URL: `https://tokenhub.tencentmaas.com/plan/v3`
- Models / 模型: `tc-code-latest`, `deepseek-v4.1-flash-1017`, `deepseek-v4-pro-0813`, `deepseek/deepseek-flash`, `hy4`, `hy4-preview`, `minimax-m3`, `glm-5.3`, `glm-5.3-flash`, `kimi-k2.7-code`, `kimi-k3`, `mimo-v2.6-flash`, `glm-5.2`, `deepseek/deepseek-v4-flash-0731`, `deepseek/deepseek-v4-pro-0813`, `minimax-m2.7`
- Lite / Standard / Pro / Max：39 / 99 / 299 / 599 元每月（核对日标价），780 / 1980 / 5980 / 11980 月积分。与 Hy Plan 共用密钥，但模型范围不同；限官方允许的交互式 AI 工具。
- Lite / Standard / Pro / Max: CNY 39 / 99 / 299 / 599 per month at verification; 780 / 1980 / 5980 / 11980 monthly credits. Shares the plan key with Hy Plan, but model eligibility differs; approved interactive AI tools only.
- Sources / 来源: [Plan details and models](https://cloud.tencent.com/document/product/1823/130060), [Connection settings](https://cloud.tencent.com/document/product/1823/130119/)

## OpenAI official API · metered / OpenAI 官方 API · 按量

- Protocol / 协议: `openai`
- Base URL: `https://api.openai.com/v1`
- Models / 模型: `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-astra`, `gpt-6-luna`, `gpt-4.1`
- 使用 OpenAI API 凭据和对应 API 额度。本列表使用 Chat Completions 文本提取；不启用工具调用。
- Use OpenAI API credentials and applicable API credits. This list uses Chat Completions for text extraction, without tool calls.
- Sources / 来源: [Current models](https://developers.openai.com/api/docs/guides/latest-model), [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1)

## Anthropic Claude official API / Anthropic Claude 官方 API

- Protocol / 协议: `anthropic`
- Base URL: `https://api.anthropic.com/v1`
- Models / 模型: `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-fable-5-1`, `claude-haiku-5-5`
- Claude Messages API；使用 API 凭据和对应额度，模型权限以账号为准。
- Claude Messages API; use API credentials and applicable credits. Account access determines availability.
- Sources / 来源: [Model catalog](https://platform.claude.com/docs/en/models/overview)

## Google Gemini official API / Google Gemini 官方 API

- Protocol / 协议: `gemini`
- Base URL: `https://generativelanguage.googleapis.com/v1beta`
- Models / 模型: `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-pro-preview`
- Gemini Developer API；模型与额度以 AI Studio 账号为准。Preview 型号可能变化。
- Gemini Developer API; models and quota depend on your AI Studio account. Preview model availability may change.
- Sources / 来源: [Model catalog](https://ai.google.dev/gemini-api/docs/models?hl=en)

## Boundaries / 范围

Only text generation models are listed. Image, video, speech and embedding endpoints are outside geometry extraction. Model names are provider-specific; never assume a reseller model ID is accepted by the original provider. / 仅列文本生成模型；各服务商模型 ID 不能混用。

Subscription terms can restrict custom applications even where protocols are compatible. Listings preserve those conditions and do not assert approval. Alibaba overview and integration pages currently give different eligibility descriptions; no automatic conclusion is drawn from that conflict. / 协议兼容不等于已取得订阅接入资格；百炼相关页面口径差异保留为待服务商确认。

Tencent prices above are dated official list prices, not personalized quotes or a purchase recommendation. / 腾讯价格为核对日官方标价，不是账号实际报价或购买建议。
