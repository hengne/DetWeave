# 运行过程、Thinking 与超时

v0.1.1 开始，点击“提取几何草稿”会自动展开 **运行过程 / Thinking** 窗口。
可随时收起，再用同名按钮展开；收起不会停止请求。“取消提取”会中断当前请求和已建立的上游连接。

## 页面展示什么

- 当前阶段：连接、等待模型数据、收到思考片段、生成几何 JSON、解析、校验、完成或失败。
- 已用时、距最近服务商数据的时间。尚无数据时显示“尚未收到”。
- 服务商公开返回的思考文本与几何 JSON 分栏展示。
- 有界事件日志：本地心跳仅证明本地请求仍在等待，不代表模型生成了新内容。

只有 API 实际提供的公开文本才会显示在思考栏。没有该字段的模型可能只提供输出片段，
或等到完整响应才返回；页面不会编造思考过程，也不会解密签名或隐藏内容。
这里的大模型工作是“讨论 → 几何 IR”；GDML、Geant4 C++ 和 DD4hep 文件随后由确定性导出器生成。

思考文本仅保留在当前页面内存中。重新提取或清空工作区会清除它，不写入项目 JSON、
本地持久存储、日志或工程 ZIP。每个文本栏最多展示 200,000 字符，超过后明确提示截断；
这只影响显示，不将显示截断误认为模型输出完成。

## 时限与失败行为

| 限制 | 默认值 | 配置方式 |
|---|---:|---|
| 总耗时 | 600 秒 | 页面“提取总时限”，60–900 秒；API `total_timeout_s` |
| 连接 socket 超时 | 至多 20 秒 | 内部上限；不含操作系统 DNS 解析的潜在额外时间 |
| 连续无网络数据 | 90 秒 | API `idle_timeout_s`，10–300 秒 |

持续有数据的推理可以越过原来的 120 秒限制。总耗时仍有上限；失败、取消、输出 token
耗尽、缺少正常完成标记或断流时，不将部分 JSON 接受为新模型。现有模型保留，新的
源文本若尚未完成提取，仍按原有一致性规则限制导出。

只有尚未开始消费响应的 HTTP 429、502、503、504 会在 1 秒后重试一次。
已生成部分内容后不会自动重试，以免重复计费或把两次生成拼接。
若接口不支持流式请求并返回错误，页面报告错误；不会静默切换模型。
如果接口接受请求但返回普通 JSON，会明确提示等待整段响应。

## 协议

浏览器调用 `POST /api/extract/stream`，请求仍为 `{text, provider}`。
服务端返回 `application/x-ndjson`：每行一个带 `type` 的事件。

| 事件 | 关键字段 |
|---|---|
| `status` | `stage`, `message`, `elapsed_s` |
| `heartbeat` | `stage`, `elapsed_s`, `seconds_since_provider_event`（收到事件前为 null） |
| `activity` | `elapsed_s`，服务商数据或 SSE 心跳已到达 |
| `reasoning` / `output` | `text`, `elapsed_s` |
| `usage` | `response_model`, 数值型 `usage` |
| `result` | `result: {model, report, provenance}`，终止事件 |
| `error` | `code`, `message`, `elapsed_s`，终止事件 |

流一旦开始，HTTP 状态为 200，后续失败由 `error` 事件表示；客户端必须检查终止事件。
只有 `result` 才可替换当前模型；其中 `report.ready` 仍可能为 false，例如待澄清草案。
原来的 `/api/extract` 保留为兼容接口，等待最终结果后一次返回。

上游支持 OpenAI 兼容 Chat Completions SSE、Anthropic Messages SSE、Gemini
`streamGenerateContent?alt=sse`。思考字段适配参考
[火山 Chat API](https://docs.volcengine.com/docs/ark/chat-api?lang=en)、
[Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)、
[Gemini generateContent](https://ai.google.dev/api/generate-content?hl=en)。
协议模拟通过不等于对应商业模型已做真实调用；此次真实回归只使用火山 `ark-code-latest`。

## 验证与复测

- `python -m pytest -q`：包含三种 SSE 协议、跨网络块 UTF-8、公开思考与模型隔离、拒绝／截断／断流、取消、总时限和空闲时限测试。
- `node scripts/check_stream_ui.cjs`：本地合成 SSE 服务加真实浏览器，检查完成前的更新、收起重开、取消关闭上游、只接受最终结果、文本转义、保存隔离及移动布局。
- `node scripts/check_ui.cjs`：原有三维、SVG、离线 HTML、ZIP、保存、撤销等界面回归。
- `python scripts/check_live_stream.py`：对运行中的本地应用发起真实火山合成案例；终端不回显 Key，只保存事件计数、时序与最终结果，不保存思考文本。

浏览器脚本需要安装 Playwright；可通过 `DETWEAVE_PLAYWRIGHT` 指向模块、
`DETWEAVE_CHROME` 指定浏览器、`DETWEAVE_URL` 指定本机应用地址。
真实回归的结果及边界见[模型测试第四轮](LIVE_MODELS.md#第四轮v011-流式进度与-120-秒超时回归)。
