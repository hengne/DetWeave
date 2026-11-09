# Single-file browser application / 单文件浏览器版

**2026-11-09: The standalone HTML application has been withdrawn from public distribution.** Direct browser access to Volcengine Coding Plan is blocked by the provider’s CORS configuration, so it does not meet the intended download-and-use workflow. Use a native application from [Releases](https://github.com/hengne/DetWeave/releases/tag/v0.2.0). Experimental source is retained; exported geometry HTML previews remain available.

**2026-11-09：单文件 HTML 应用已撤下，不再作为正式下载方式。** 火山 Coding Plan 的跨域配置阻止浏览器直接调用，无法满足下载即用的核心流程。请使用[发行页](https://github.com/hengne/DetWeave/releases/tag/v0.2.0)中的原生应用。实验源码保留，几何模型导出的 HTML 查看器仍可使用。

Build with `python scripts/build_standalone.py`. The resulting
`dist/DetWeave-0.2.0.html` embeds the interface, provider catalogue, CPython 3.13.2
via Pyodide 0.28.2, Python standard library, dependencies, and DetWeave's Python
geometry core. It opens directly with `file://`; it does not start a server,
load runtime assets from a CDN, or require Python on the end user's computer.

运行上述构建命令生成单一 HTML。界面、模型列表、Python 解释器及依赖全部嵌入，
可双击打开；不要求用户安装 Python，也不依赖在线 CDN。

## Projects and locations / 项目与位置

- Choose a parent folder when the browser supports `showDirectoryPicker`.
  Each project gets a named subfolder containing prompts, run history and exports.
  The browser may require folder permission again after reopening.
- Otherwise choose **Browser project library**. IndexedDB stores all project
  versions on this browser profile. This is not a folder in Downloads. Use
  **Back up all projects (ZIP)** to retain a portable copy, particularly before
  clearing browser data or moving the HTML file to another machine/browser.
- **Import library backup** restores nonconflicting project files. Conflicting
  existing content is rejected rather than overwritten. Restored folder copies
  without directory permission stay in browser storage until reconnected.
- One tab owns the browser library at a time; a second tab is blocked to prevent
  competing snapshots. A file write failure is surfaced even if browser storage
  retained a recovery copy. API keys and provider reasoning are never included
  in library snapshots.

支持文件夹选择的浏览器可选择父目录，项目保存在以标题命名的子目录中；重开后可能需重新授权。
其余浏览器使用明确标注的“浏览器项目库”，保存在当前浏览器配置的数据中，不等于下载文件夹。
可以将完整项目库导出 ZIP，包含所有讨论版本、运行记录、模型和导出文件，并在另一浏览器导入。
导入不会覆盖相冲突的已有内容。浏览器只允许一个标签页打开同一项目库，防止互相覆盖。
清除浏览器数据前请保存备份。

## Model calls and validation / 模型调用与校验

Offline examples, IR editing, validation, SVG/3D viewing, and geometry code
export run entirely locally. Model extraction uses browser `fetch` directly
against the user-selected API and therefore needs internet and a provider that
allows the browser's CORS origin. An API working in a native application is not
proof it permits `file://` browser calls. Use a native build when the provider
blocks browser access; the HTML does not silently proxy requests elsewhere.

The Python validation and exporters are shared with the native application.
The stream assembler is extracted verbatim from `detweave/streaming.py` at
build time; only networking and storage are adapted. The browser never runs
model-produced Python/C++ code or Geant4/DD4hep itself.

离线示例、IR 编辑、校验、SVG/3D 和代码导出完全在本地执行。调用模型需要联网，且服务商须允许
浏览器跨域访问；原生版可调用不代表单文件版一定可调用。遇到跨域限制请使用原生版，
HTML 不会自动将请求发送给第三方代理。几何校验及导出使用与原生版相同的 Python 核心。
生成的仿真代码需要在 Geant4/DD4hep 环境另行编译运行。

## Reproducibility and third-party notices / 重建与第三方许可

`runtime-lock.json` pins SHA-256 checksums for downloaded runtime files and
pure Python wheels. Cached files live under ignored `local/standalone-runtime`.
The HTML contains Pyodide's license, CPython's license, and the unmodified
license/metadata files from attrs, jsonschema and pyrsistent wheels.
DetWeave's noncommercial license does not replace those third-party licenses.

- Pyodide 0.28.2 source: https://github.com/pyodide/pyodide/tree/0.28.2
- CPython 3.13.2 source: https://github.com/python/cpython/tree/v3.13.2
- Browser architecture: https://pyodide.org/en/0.28.2/usage/downloading-and-deploying.html

Run `node scripts/check_standalone.cjs` with Playwright to verify an offline
`file://` session and synthetic provider streams. Browser folder-picker support,
file-origin behavior, storage quota and WebAssembly memory differ by browser;
release notes record the actual tested environment.
