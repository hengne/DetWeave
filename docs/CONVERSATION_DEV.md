# Conversation development preview / 对话开发测试版

This development stage uses **one HTML document plus a local Python backend**.
It is not the withdrawn standalone Python/WASM file, and it is not a hosted
relay service. The browser calls only the same local backend; Python connects
to the selected model provider. Users supply their own API key.

本阶段采用**单个 HTML 界面＋本机 Python 后端**。浏览器只访问本机服务，由 Python
直接调用火山等模型接口；不需要我们运营在线转发服务器。它不是此前撤下的独立
Python/WASM 单文件版，也不能脱离后端双击运行。

## Start / 启动

With Python 3.10+ in the repository / 在仓库目录中使用 Python 3.10+：

```sh
python -m pip install -e '.[dev]'
python -m detweave serve --dev-ui --open --port 0
```

The OS selects an available port and opens the browser. Keep the terminal open;
Ctrl+C stops the backend. Alternatively run `python scripts/start_dev.py`.
On macOS, `scripts/start_dev.command` is a double-click launcher when Python and
the project dependencies are installed. The server binds only to 127.0.0.1.

系统自动选择空闲端口并打开浏览器；使用期间保留终端，Ctrl+C 停止服务。
也可运行 `python scripts/start_dev.py`；macOS 已安装 Python 和依赖时可双击
`scripts/start_dev.command`。服务仅监听本机。

`python scripts/build_dev_ui.py` writes `dist/DetWeave-dev.html` for inspection.
The server builds the same HTML from source at page load, embedding local CSS and
JavaScript. A detached file shows a backend-required notice rather than silently
trying a remote service. No external CDN or runtime download is used by this UI.

构建脚本可生成单个 HTML 供检查；开发服务在页面加载时从源码生成同样的界面，将
CSS 和 JavaScript 内嵌。直接打开文件会提示启动后端，不会偷偷访问代理。

## Workflow / 工作流程

Create a named project and choose its location. Paste initial notes into the
chat composer, then keep sending questions or changes. A clarification/answer
keeps the current revision. A geometry revision includes a parent revision and
programmatic validation. Restore an earlier revision explicitly before editing
from it; a stale client cannot silently overwrite a newer revision.

新建项目并选择位置；在左侧粘贴初始讨论，随后持续提问、补充或修改。澄清和普通
回答不替换当前几何；修改产生关联父版本的新版本，并执行程序校验。恢复旧版本
后可以继续修改；过期页面不能静默覆盖新版本。

The main UI hides raw Thinking and model JSON streams. It shows concise status,
elapsed time and cancellation. Right-side SVG/3D and export tools use the selected
geometry. PDF design-report generation remains a subsequent stage; it is not
claimed as implemented in this preview.

主界面隐藏 Thinking 和原始 JSON 流，只保留简洁状态、耗时和停止操作；右侧
SVG／3D 和导出使用当前几何。PDF 设计报告生成属于后续阶段，本阶段不宣称完成。

The offline demo is a deterministic fixture, not a language model. Load an example
for the first revision; the explicitly labelled `demo change thickness` /
`演示修改厚度` command exercises revision handling. Arbitrary edits require a real
provider. Failed/cancelled messages remain in history, without API keys or raw
reasoning being saved.

离线演示只用于固定样例；首次加载示例，再发送明确的演示命令测试版本机制。
它不理解任意自然语言。真实设计修改需要配置模型；失败／取消记录保留，
API Key 和模型原始思考不保存。

## Release boundary / 发行边界

Existing v0.2.0 native downloads are unchanged and do not contain this new flow.
Validate conversation behavior and persistence here first; rebuild and test each
native platform in the next stage. A successful local browser test is not a
Windows/Linux/mobile runtime test or a Geant4/DD4hep validation.

现有 v0.2.0 安装包不含这次新流程。先在这里验证对话和保存，再进入各平台重新
打包、测试阶段。本机浏览器通过不等于其他系统或几何引擎已经验证。
