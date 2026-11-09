# Local DetWeave projects

The Python browser-server edition saves named projects in `~/Documents/DetWeave/projects` by default. Set `DETWEAVE_PROJECTS_DIR` before starting a standalone server to choose a different default. Desktop native launchers use their app data directory by default; iOS uses its shared Documents area, and Android uses app-private storage. The single-file HTML uses browser storage or an authorized directory handle; see [the standalone guide](../standalone/README.md). When creating a project, select the default or register an existing parent directory on the machine running DetWeave. DetWeave remembers these locations in `.locations.json` under the default directory and discovers projects there on restart. If a registered directory is temporarily unavailable, its projects appear again when it is accessible.

A project folder starts with a filesystem-safe version of its original title and ends with a unique identifier. Changing the displayed title updates the project metadata. Its folder path stays stable.

- `project.json` holds the title and current working draft.
- `prompts/<id>.json` records each distinct saved or submitted prompt revision. Submitting an unchanged prompt again links another run to that revision.
- `runs/<id>/run.json` records a submission before its provider call. `system-prompt.txt` contains the full system prompt for remote models. A completed run has an `outcome` directory with its status and, on success, separate IR, validation and public provenance JSON files.
- `exports/<id>/` contains a copy of a validated geometry ZIP and its SHA-256 digest.

The project records failed and cancelled submissions and preserves the last accepted model. A server restart during an unfinished run shows it as interrupted. Provider credentials, live reasoning and partial model output are kept out of the project folder. Draft text and geometry may contain sensitive material entered by the user. Back up or move an entire project folder to preserve its history. Use one workbench server per project library.

## Local API

All project mutations use JSON and the existing `X-DetWeave: 1` request header.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/projects` | Project summaries in `projects` |
| POST | `/api/projects` | Create a project with `title`, optional `location_id` and optional `draft` |
| GET | `/api/projects/locations` | The default ID and registered parent directories, including availability |
| POST | `/api/projects/locations` | Register an existing parent directory using its absolute `path` |
| POST | `/api/projects/locations/pick` | Open the desktop folder picker and register the selected directory |
| GET | `/api/projects/<id>` | Open the draft, prompt revisions, run summaries and export records |
| POST | `/api/projects/<id>` | Save `title`, `draft`, or both |
| GET | `/api/projects/<id>/runs/<run-id>` | Read a run and its result, when available |

A draft includes `text`, `model`, `provenance`, `review_pending` and optional `json_text` for unapplied editor text. `/api/extract`, `/api/extract/stream` and `/api/export` accept a top-level `project_id` to persist the operation. The server returns a storage error if it cannot save the operation. A connected browser receives storage errors before a result is accepted.

The standalone browser server offers the system picker on macOS and on Windows or Linux with Tk available in the graphical session. The location index reports picker support in `capabilities.system_picker`. Cancelling the system picker returns `{"cancelled": true}` without registering a directory. The absolute path entry remains available on the standalone server.

## 中文：保存位置与历史

新建项目时填写标题并明确选择保存位置，界面显示实际项目文件夹。桌面版可调用系统目录选择器，
Python 浏览器服务也可输入已有父目录的绝对路径。标题用于子文件夹名称，并附唯一标识，避免同名覆盖。

- iOS 默认使用应用 Documents 区域，通过“文件”共享；Android 使用应用私有目录，文件导出使用系统选择器。
- 单文件 HTML 可使用浏览器授权文件夹，或明确标注的浏览器项目库；项目库可完整导出和恢复 ZIP 备份。
- 每个不同的已保存／提交提示词都有版本记录。相同文本再次运行会关联原版本，同时新增运行记录。
- 成功结果保存模型、校验报告及公开来源信息；失败、取消及重启中断的运行也保留。
- 项目文件夹不保存模型 API 配置中的密钥、原始思考文本或未完成的模型输出。

修改显示标题不会移动现有文件夹。复制整个项目文件夹可保留历史；几何导出 ZIP 与完整项目历史备份是不同内容。


## Conversation development journal / 对话开发版记录

The development conversation flow stores an atomic `conversation.json` beside the legacy project files. It includes user/assistant messages, failure/cancellation status, immutable geometry revisions, parent links, deterministic parameter differences and the current revision pointer. Reading an old project imports its current draft without inventing assistant messages. Legacy prompt/run records are retained separately. API keys and raw reasoning are excluded. See [the development guide](CONVERSATION_DEV.md).

对话开发版在项目内新增原子保存的 `conversation.json`，记录完整消息、失败／取消状态、几何版本、父版本、参数差异和当前版本指针。旧项目迁入当前草稿，不伪造助手历史；旧提示词／运行记录单独保留。不保存 API Key 和原始思考。
