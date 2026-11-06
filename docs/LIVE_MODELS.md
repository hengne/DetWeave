# 真实模型接入与小样本测试

日期：2026-11-06。使用用户授权的火山 Coding Plan 订阅接口，仅发送仓库内的合成描述。
API Key 没有写入代码、测试产物或公开仓库。

## 配置

在工作台选择“火山 Coding Plan · OpenAI 兼容”：

- Base URL：`https://ark.cn-beijing.volces.com/api/coding/v3`
- 模型：`ark-code-latest`，或套餐当前允许的具体模型 ID。
- API Key：在密码框输入，不持久保存。
- 深度思考：默认沿用服务商设置；也可显式开启／关闭。模型不支持时显示接口错误，不自动换模型。

接口路径依据[火山官方其他工具接入文档](https://docs.volcengine.com/docs/ark/coding-plan-personal-ai-other-tools?lang=en)。
本次 `ark-code-latest` 的响应模型名是 `auto`，无法从该字段识别底层路由模型。
指定 `deepseek-v4-flash` 时，接口返回 `deepseek-v4-flash-ga-260731`。
账号权限与网关模型别名会变化；成功的 HTTP 状态不代表底层模型身份已得到完整确认。

## 第一轮：Prompt 0.1，服务商默认思考

| 请求模型 | 案例 | 时间 | 结果 |
|---|---|---:|---|
| ark-code-latest | 英文明确描述 | 103.76 s | 8 实例，尺寸／材料／位置与参考一致，来源检查通过，可导出 |
| ark-code-latest | 中文口语描述 | 69.04 s | 同上 |
| ark-code-latest | 20×(1+5) mm 与 100 mm 上限冲突 | 120.18 s | 超时，未接受任何模型 |
| ark-code-latest | 缺单位／未定层数 | 120.19 s | 超时，未接受任何模型 |
| deepseek-v4-flash | 英文明确描述 | 107.34 s | 几何正确，但拼接了不连续原文，来源检查阻止导出 |
| deepseek-v4-flash | 中文口语描述 | 107.57 s | 几何正确，但漏填两组重复放置的依据，阻止导出 |
| deepseek-v4-flash | 尺寸冲突 | 120.17 s | 超时 |
| deepseek-v4-flash | 缺单位／未定层数 | 54.07 s | 提出澄清，未擅自确定参数，阻止导出 |

[完整摘要与 token 记录](verification/live-models/default-thinking.json)。
这是严格验收下的 3/8 案例通过；不能把“生成了正确外形”与“带完整可靠来源、可导出”合并统计。

## 第二轮：Prompt 0.1，显式关闭深度思考

`ark-code-latest` 对尺寸冲突和缺单位分别在 **22.00 s / 21.20 s** 返回澄清并阻止导出。
冲突反馈正确指出 20×(1+5)=120 mm 超过 100 mm，并询问哪项要求可以调整。
明确英文／中文描述分别耗时 **27.71 s / 17.72 s**，几何均正确，但仍将两段不连续原文
拼成一条引用；校验器正确拒绝了该引用，没有自动放宽来源要求。

[歧义案例摘要](verification/live-models/disabled-thinking-ambiguity.json)、
[明确描述摘要](verification/live-models/disabled-thinking-clear-prompt01.json)。

## 根据实测改进

- 将请求超时从 60 秒调整为 120 秒；超时与限流是明确失败，不展示虚构结果。
- 保存请求模型名、响应模型名、提示版本、思考配置、耗时和 token 用量。
- 工作台提供显式思考模式选择，不声称关闭后对所有任务都更准确。
- Prompt 0.2 和 IR 支持多段独立引文：`quote` 可以是字符串数组，各段仍必须逐字存在于原文。
  这解决了跨段参数来源的表达问题，不进行模糊匹配，也不把无依据参数自动确认为正确。

## 第三轮：Prompt 0.2，多段引用回归

使用 `ark-code-latest`、`thinking=disabled` 重测明确描述：

| 案例 | 时间 | 几何与参考比对 | 每段来源核对 | 导出状态 |
|---|---:|---|---|---|
| 英文 | 28.44 s | 通过，8 实例 | 通过 | 可导出 |
| 中文 | 21.87 s | 通过，8 实例 | 通过 | 可导出 |

[本轮完整记录](verification/live-models/disabled-thinking-clear-prompt02.json)。
本轮仅回归上述两个来源失败案例；未把前一提示版本的所有通过项目冒记为本版本已复测。

## 实际模型输出到 Geant4

第一轮 `ark-code-latest` 的英文抽取结果已直接送入原生验证流程，未手工改动其几何。
GDML 与直接 C++ 均编译／加载成功；8 个实例的实际材料、全局位置和体积与 IR 一致；
各放置 10,000 点、容差 0 mm 的重叠检查和三条中心轴导航通过；10 个 geantino 事件通过。

[模型及抽取记录](verification/live-models/ark-code-latest-sampling.json)、
[与模型哈希绑定的 Geant4 记录](verification/ark-sampling-geant4.json)。

## 如何复测

```sh
python scripts/evaluate_models.py \
  --base-url https://ark.cn-beijing.volces.com/api/coding/v3 \
  --models ark-code-latest \
  --thinking disabled \
  --output local/my-evaluation
```

脚本以不回显的终端提示读取 Key，也可读取 `DETWEAVE_TEST_API_KEY` 环境变量。
结果只含合成输入、结构化输出、校验结果及用量元数据。此小样本未检验复杂旋转、真实会议
中的方案撤回、大规模阵列、光学／读出配置，也没有 GPT-4 的真实 API 测试结果。
