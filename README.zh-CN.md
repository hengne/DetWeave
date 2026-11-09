# DetWeave

**把探测器讨论转化为有依据、可审阅、可导出的几何模型。**

[English](README.md) · [下载发行版](https://github.com/hengne/DetWeave/releases) · [引用信息](CITATION.cff) · [使用许可](LICENSE)

DetWeave 是面向 Geant4 用户的本地几何建模工作台。粘贴无格式对话、会议纪要或设计讨论，选择模型服务商，审阅带原文依据的几何草案，再导出 GDML、Geant4 C++ 工程或 DD4hep compact XML 与 detector constructor。

**作者：李衡讷 / Hengne Li**
**单位：华南师范大学 / South China Normal University**
**邮箱：Hengne.Li@m.scnu.edu.cn · Hengne.Li@cern.ch**

## 对话式开发测试版

当前源码正在实现持续对话界面与本机 Python 后端。使用 `python -m detweave serve --dev-ui --open --port 0` 启动，详见[开发测试说明](docs/CONVERSATION_DEV.md)。现有 v0.2.0 安装包及下方演示仍为此前的操作流程；新版先完成开发测试，再重新打包各平台。

## 观看操作演示

![DetWeave 中文操作演示](docs/media/detweave-demo-zh.gif)

[下载中文 MP4](docs/media/detweave-demo-zh.mp4) · [English demonstration](docs/media/detweave-demo-en.mp4)

演示使用明确标记的合成样例，展示操作和项目保存流程，不代表任意探测器描述已经通过真实模型理解或 Geant4 验证。真实接口测试记录另见[模型验证记录](docs/LIVE_MODELS.md)。

## 下载与开始使用

从 [GitHub Releases](https://github.com/hengne/DetWeave/releases) 下载适合本机的文件。请查看发行说明中的平台验证状态：源码构建工程、模拟器程序和签名后的设备安装包是不同交付物。构建步骤和平台限制见[原生打包说明](packaging/README.md)。

运行 Python 版需要 Python 3.10 或以上版本：

```sh
git clone https://github.com/hengne/DetWeave.git
cd DetWeave
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
python -m detweave serve
```

Windows 激活命令为 `.venv\Scripts\activate`。Python 网页版打开 `http://127.0.0.1:8765`，服务仅监听本机。原生应用版内置 Python 运行环境，并使用独立应用窗口。

1. 在左侧下拉列表选择**新建项目**，填写标题、选择保存位置并创建本地项目。内置合成示例仍可用于离线体验。
2. 输入设计讨论或提示词，选择服务商和模型。真实调用时由用户自行填入 API Key。
3. 在左侧对话区发送消息，简洁状态和耗时显示运行活动，支持停止；主界面隐藏原始 Thinking。
4. 回答澄清问题或继续提出修改。新几何版本记录父版本与参数差异；普通提问不替换当前几何。可以恢复旧版本并从它继续修改。
5. 查看 SVG 正投影和交互三维；解决阻塞问题后导出，在目标 Geant4 / DD4hep 环境编译、加载和验证。

界面支持 **中文 / English** 切换；输入原文、模型回复和用户标题保留原语言。

## 模型与订阅目录

已整理火山 Coding Plan、DeepSeek 官方 API、Kimi Code、GLM Coding Plan、阿里云百炼 Token Plan、腾讯通用 Token Plan、腾讯混元 Hy Token Plan，以及 OpenAI、Anthropic、Google Gemini。各入口附有模型 ID、接口地址、计费类别、官方链接，核对日期为 **2026-11-06**。

完整清单见[服务商目录](docs/PROVIDERS.md)。订阅与按量 API 使用不同地址或权限；部分订阅限制适用工具，列出兼容接口不代表自研应用已取得套餐接入资格。模型目录不包含密钥，也不会自动获取密钥或购买套餐。

## 功能范围

| 功能 | 当前支持 |
|---|---|
| 无格式输入 | 中文、英文及混合讨论，由所选模型抽取 |
| 项目历史 | 命名的本地项目、提示词版本、调用结果、模型与校验快照、导出文件 |
| 几何结构 | 严格 JSON Schema；长方体、沿 z 的完整圆柱／圆管；平移、嵌套、重复阵列 |
| 来源与澄清 | 原文引用、明确／推导／假设／未解决状态；关键问题未解决前阻止导出 |
| 检查 | 单位、尺寸、引用、循环、展开数量及支持形状的解析重叠／越界 |
| 可视化 | XY／XZ／YZ SVG、可旋转三维、材料颜色、部件与依据关联、离线 HTML 预览 |
| 对话进度 | 简洁状态、耗时、停止；隐藏原始思考；默认 600 秒总时限，可调 60–900 秒 |
| 输出 | 自包含材料的 GDML、Geant4 C++、DD4hep XML 与 C++、来源、哈希清单、SVG、校验报告 |
| 原生验证工具 | Geant4 递归 CheckOverlaps、三轴导航、十事件 geantino 测试、实际几何与 IR 比对 |

**草案、可导出、后端已验证**是三个独立状态。成功导出不等于物理等价或几何完全正确。材料为 Geant4 11.1.3 NIST 的 12 种材料快照；当前未配置光学属性、读出、敏感探测器行为、磁场或能量沉积计分。

## 本地文件与数据

明确创建的项目保存到本地目录。提示词历史包括用户讨论和抽取系统提示词，因此项目目录及导出 ZIP 可能含研究内容。API Key 和原始 thinking 不写入项目记录。选择远程模型会把讨论发送给该服务商；离线演示与本地几何检查不发送外部请求。

**2026-11-09：单文件 HTML 应用已撤下，不再作为正式下载方式。** 火山 Coding Plan 的跨域配置阻止浏览器直接调用，无法满足下载即用的核心流程。请使用[发行页](https://github.com/hengne/DetWeave/releases/tag/v0.2.0)中的原生应用。实验源码保留，几何模型导出的 HTML 查看器仍可使用。

## 许可与引用

DetWeave 0.2.0 采用[非商业署名与引用许可](LICENSE)，是**源码可见、仅允许非商业使用**的软件。商业用途须取得李衡讷的另行书面授权。分发时保留作者署名，公开分享实质使用本软件产生的成果时引用：

> Hengne Li. *DetWeave: Conversation-driven detector geometry modelling and validation*. South China Normal University. Version 0.2.0, 2026. https://github.com/hengne/DetWeave

引用应注明实际使用版本或提交号。[CITATION.cff](CITATION.cff) 提供机器可读引用信息。此前已按 MIT 发布的开发快照保留历史许可记录，见 [NOTICE](NOTICE) 和 [旧版 MIT 许可](LICENSES/MIT-legacy.txt)；第三方依赖仍适用各自许可。

## 开发与验证

```sh
python -m pip install -e '.[dev]'
python -m pytest -q
python -m detweave validate examples/sampling.json
python -m detweave export examples/sampling.json --output local/sampling.zip
```

本地工作台不执行模型生成的程序。Geant4 / DD4hep 原生验证在指定环境中单独运行。[验证记录](docs/VALIDATION.md) 标明已测版本和边界，示例通过不能自动视为用户新模型通过。

- [系统架构](docs/ARCHITECTURE.md)
- [服务商与订阅](docs/PROVIDERS.md)
- [项目存储](docs/PROJECTS.md)
- [流式过程与超时](docs/STREAMING.md)
- [几何格式](docs/FORMAT.md)
- [开发路线](docs/ROADMAP.md)
- [原生打包](packaging/README.md)
- [参与贡献](CONTRIBUTING.md)

DetWeave 是独立软件，不是 CERN、Geant4、DD4hep 或模型服务商的官方产品。

### 应用版本与项目保存位置

发行页提供桌面和移动端应用。新建项目必须选择保存位置；桌面版使用系统目录选择框，手机端遵循系统文档权限。详见[发行形态](docs/DISTRIBUTION.md)。
