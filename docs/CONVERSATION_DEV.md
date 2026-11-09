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

The earlier v0.2.0 native downloads do not contain this flow. v0.3.0 release candidates use the same conversation core.
Validate conversation behavior and persistence here first; rebuild and test each
native platform in the next stage. A successful local browser test is not a
Windows/Linux/mobile runtime test or a Geant4/DD4hep validation.

此前 v0.2.0 安装包不含这次新流程；v0.3.0 候选包已采用同一对话核心。先在这里验证对话和保存，再进入各平台重新
打包、测试阶段。本机浏览器通过不等于其他系统或几何引擎已经验证。

## Remembering provider settings / 记忆模型配置

Provider/model/endpoint/key settings are saved automatically to the backend user's
application configuration directory, separately for each provider. They survive
browser refresh, backend restart and port changes. Use the clear-saved-configuration
button to remove the current provider profile. Changing its endpoint clears the
previous key; enter the key appropriate to the new endpoint.

服务商、模型、接口和 API Key 会自动保存，按服务商分别记忆。刷新页面、重启后端或
改变端口后可恢复；通过“清除已保存配置”删除当前服务商配置。更改接口地址后会清空
原 Key，需要填入新地址对应的 Key。

Storage is a local plaintext settings file, not keychain encryption. On POSIX
systems the directory/file permissions are 0700/0600. Windows uses the user's
application-data directory and inherited filesystem access controls. Settings
are excluded from project journals, geometry exports and browser localStorage.

这是本机明文配置文件，不是钥匙串加密。macOS/Linux 使用 0700 目录和 0600 文件
权限；Windows 使用用户应用数据目录的文件访问控制。配置不进入项目记录、几何
导出或浏览器 localStorage。

- macOS: `~/Library/Application Support/DetWeave/settings/providers.json`
- Windows: `%APPDATA%/DetWeave/settings/providers.json`
- Linux: `$XDG_CONFIG_HOME/detweave/settings/providers.json` (default `~/.config`)
- Tests/custom deployment: `DETWEAVE_SETTINGS_DIR` overrides the settings directory.

Native applications override the settings directory with their platform app-data `settings` folder, beside (not inside) `projects`. / 原生应用将配置保存在各平台应用数据目录的 `settings` 子目录，与 `projects` 并列。
