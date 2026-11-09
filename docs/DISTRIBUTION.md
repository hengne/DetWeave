# Delivery formats / 发行形态

**2026-11-09: The standalone HTML application has been withdrawn from public distribution.** Direct browser access to Volcengine Coding Plan is blocked by the provider’s CORS configuration, so it does not meet the intended download-and-use workflow. Use a native application from [Releases](https://github.com/hengne/DetWeave/releases/tag/v0.2.0). Experimental source is retained; exported geometry HTML previews remain available.

**2026-11-09：单文件 HTML 应用已撤下，不再作为正式下载方式。** 火山 Coding Plan 的跨域配置阻止浏览器直接调用，无法满足下载即用的核心流程。请使用[发行页](https://github.com/hengne/DetWeave/releases/tag/v0.2.0)中的原生应用。实验源码保留，几何模型导出的 HTML 查看器仍可使用。

DetWeave retains a shared Python geometry core and HTML/JavaScript interface.
macOS, Windows and mobile shells bundle the interpreter, dependencies and UI.
The Linux Debian package links Ubuntu 24.04 system Python and declares its runtime
dependencies; installing with `sudo apt install ./detweave-native_*.deb` resolves
those dependencies. Users do not need to configure a separate Python environment.

DetWeave 共用 Python 几何核心与 HTML/JavaScript 界面。macOS、Windows 和手机封装包含解释器、依赖和页面；
Linux DEB 使用 Ubuntu 24.04 的系统 Python 库，安装时由 apt 处理依赖，不要求用户单独配置 Python 环境。

| Format / 形式 | Meaning / 含义 |
|---|---|
| Python wheel / source archive | Installable Python application; requires a suitable Python environment / 需要 Python 环境 |
| Withdrawn experimental single-file HTML application | Embedded Python/WASM; offline validation, projects, exports; direct model calls subject to browser CORS / 内嵌 Python 的完整单文件工作台 |
| Standalone geometry HTML preview | Small offline viewer exported from a model / 从模型导出的小型离线查看器 |
| Linux desktop package | Linux native build; package/architecture listed in release notes / Linux 原生包，格式与架构见发行说明 |
| macOS app / DMG | Bundled desktop application; signing/notarization status must be stated in release notes / 发行说明标明签名与公证情况 |
| Windows MSI | Bundled desktop installer built on Windows / 在 Windows 上构建的安装程序 |
| Android APK | Android application; signing and device-tested features must be recorded / 标明签名与真机测试范围 |
| iOS Xcode project | Rebuildable iOS application source; requires Xcode / 可编译的 iOS 工程 |
| iOS simulator app | Runs on matching simulator architecture; cannot be installed on a physical iPhone / 不能当作 iPhone 安装包 |
| Signed iOS device build | Requires an appropriate Apple developer identity and provisioning / 需要 Apple 签名与配置 |

## Can all Python go inside one HTML file? / Python 能全部放进单文件 HTML 吗？

The retained experimental single-file application can be built by
`python scripts/build_standalone.py`. It embeds CPython through Pyodide,
its standard library, dependencies, the Python geometry core and the interface
in one HTML file (about 16.5 MB). Open it directly; offline work needs no CDN or
local HTTP service. Browser fetch replaces ordinary sockets; IndexedDB and
optional authorized directory handles replace native filesystem access.
Remote model APIs still require internet and provider CORS permission.
See [the standalone guide](../standalone/README.md) for storage and backup details.

保留的实验性单文件版可由上述脚本构建，约 16.5 MB，内含 Python/WASM 解释器、依赖、几何核心与界面。
可直接双击，离线使用无需 CDN 或本地服务；浏览器负责模型网络调用、项目库和授权文件夹存储。
远程模型仍需联网且服务商允许跨域请求。它与从某个几何导出的小型 HTML 查看器是两种交付文件。

Sources: [Pyodide networking](https://pyodide.org/en/stable/usage/api/python-api/http.html),
[Briefcase](https://briefcase.readthedocs.io/en/stable/),
[Android app signing](https://developer.android.com/studio/publish/app-signing),
[Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

Geant4 and DD4hep runtimes are not automatically bundled with the workbench.
Generated code must be validated in the intended simulation environment;
packaging the authoring application is not a validation of detector physics.

工作台安装包不自动包含 Geant4/DD4hep 仿真运行环境；应用可运行与探测器物理配置已验证是不同结论。
