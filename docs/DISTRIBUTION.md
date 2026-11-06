# Delivery formats / 发行形态

DetWeave retains a shared Python geometry core and HTML/JavaScript interface.
The native shells bundle the interpreter, dependencies and UI. Users do not
need to install Python separately for a verified native package.

DetWeave 共用 Python 几何核心与 HTML/JavaScript 界面。原生封装包含解释器、依赖和页面；
经验证的原生安装包不要求用户另装 Python。

| Format / 形式 | Meaning / 含义 |
|---|---|
| Python wheel / source archive | Installable Python application; requires a suitable Python environment / 需要 Python 环境 |
| Standalone HTML preview | Offline geometry viewer generated from a model; not the complete extraction backend / 离线几何查看器 |
| macOS app / DMG | Bundled desktop application; signing/notarization status must be stated in release notes / 发行说明标明签名与公证情况 |
| Windows MSI | Bundled desktop installer built on Windows / 在 Windows 上构建的安装程序 |
| Android APK | Android application; signing and device-tested features must be recorded / 标明签名与真机测试范围 |
| iOS Xcode project | Rebuildable iOS application source; requires Xcode / 可编译的 iOS 工程 |
| iOS simulator app | Runs on matching simulator architecture; cannot be installed on a physical iPhone / 不能当作 iPhone 安装包 |
| Signed iOS device build | Requires an appropriate Apple developer identity and provisioning / 需要 Apple 签名与配置 |

## Can all Python go inside one HTML file? / Python 能全部放进单文件 HTML 吗？

Source text can be embedded, but executing it requires a runtime. Pyodide can
run Python via WebAssembly in a browser, but ordinary sockets and the existing
HTTP server/threading architecture cannot simply be reused. Browser fetch is
subject to CORS, including when calling model providers. A truly offline,
single-file Python browser build would need embedded runtime/dependency assets
and a separate networking/filesystem adaptation, with browser-specific tests.
It is a distinct engineering target, not concatenation of the current files.

源码可以嵌入 HTML，但执行仍需要运行时。Pyodide 可通过 WebAssembly 在浏览器执行 Python，
不过当前普通 socket、HTTP 服务及线程架构不能原样搬入，模型请求还受浏览器跨域规则限制。
真正离线的单文件还需嵌入解释器和依赖，并适配网络、文件存储，逐浏览器验证。
因此本轮优先采用包含 Python 的应用安装包，同时保留独立几何 HTML 预览。

Sources: [Pyodide networking](https://pyodide.org/en/stable/usage/api/python-api/http.html),
[Briefcase](https://briefcase.readthedocs.io/en/stable/),
[Android app signing](https://developer.android.com/studio/publish/app-signing),
[Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

Geant4 and DD4hep runtimes are not automatically bundled with the workbench.
Generated code must be validated in the intended simulation environment;
packaging the authoring application is not a validation of detector physics.

工作台安装包不自动包含 Geant4/DD4hep 仿真运行环境；应用可运行与探测器物理配置已验证是不同结论。
