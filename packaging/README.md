# Native packaging / 原生应用封装

This is a separate Briefcase project. It bundles the repository's current `detweave/` Python package and web assets; no external Python installation is needed at runtime. Build from this directory after updating the repository source. Builds are not a substitute for testing each platform, especially mobile file import/export and model networking.

这是独立的 Briefcase 打包项目，构建时直接包含仓库中的 `detweave/` 及网页资源，运行时不要求用户另装 Python。请在本目录构建；各平台功能（尤其移动端导入导出和模型网络连接）仍需分别实测。

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install 'briefcase==0.4.7'
briefcase create macOS
briefcase build macOS
briefcase package macOS --adhoc-sign
briefcase create iOS
briefcase build iOS
briefcase create android
briefcase build android
briefcase create windows
briefcase build windows
briefcase package windows
```

Windows builds require Windows; iOS requires macOS and Xcode. Android builds require Android SDK/JDK and the Android license acceptance. A distributable Android release APK needs a persistent signing key, which must be stored separately and securely; never commit the key. A simulator build is not an iPhone-installable signed IPA. Device installation and App Store distribution require an Apple developer team and appropriate signing. An ad-hoc-signed macOS bundle is intended for local testing and cannot be redistributed as a signed release.

Briefcase's stock mobile WebView does not guarantee blob download or file dialogs. Until verified or a native share bridge is implemented, do not claim mobile import/export support. Each launch uses a fresh local port: browser local storage is not persistent across launches; use the project storage instead.
