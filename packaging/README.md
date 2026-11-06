# Native packaging / 原生应用封装

This Briefcase project packages the repository's Python core and web interface with a Python runtime; users need not install Python. Build from this directory. The published binaries need platform-specific testing; a successful build alone does not establish usability.

此目录为独立的 Briefcase 工程，打包现有 Python 核心、界面及运行时，用户无需另装 Python。各平台构建成功不等于已经完成运行验证。

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install 'briefcase==0.4.7'
briefcase create macOS
briefcase build macOS
briefcase package macOS --adhoc-sign --no-notarize
briefcase create iOS
briefcase build iOS
briefcase create android
briefcase build android
briefcase package android -p debug-apk
# On Windows:
briefcase create windows
briefcase build windows
briefcase package windows
# On Ubuntu 24.04 (see CI for system dependencies):
briefcase create linux system --target ubuntu:noble
briefcase build linux system --target ubuntu:noble
briefcase package linux system --target ubuntu:noble --adhoc-sign
```

Windows requires Windows; iOS requires macOS and Xcode; Android requires Android SDK and JDK 17. Android debug APKs are installable test builds signed using the builder's debug key. Their signatures are not a stable release identity, so builds from different machines may not update one another. A release APK needs a persistent signing key; never commit the key. An iOS simulator app is not a signed iPhone IPA; a physical device and App Store distribution require Apple signing credentials. The macOS ad-hoc build is an unnotarized test build, not a Developer ID signed release. It can be shared for evaluation, but Gatekeeper or the operating system may block it and Briefcase warns that ad-hoc signed applications may not run on other machines.

Native exports use the application's exports directory on desktop. Android implements the system document picker for exports; its device implementation still requires real-device verification. On iOS projects and exports are stored under the app's Documents folder, with file sharing enabled so that Files can expose them; physical-device verification remains necessary. The native desktop folder picker selects the parent of a project. Mobile project storage currently uses the application document area: selecting arbitrary external folders as live project roots is not implemented; Android exports can be saved through the document picker. Each launch uses a fresh local port, so browser local storage is not persistent across launches; use project storage for persistent work.

Android、Windows 与 Linux CI 的产物是候选构建；签名状态与已完成的运行测试以实际构建记录为准。iOS 物理设备和 Android 真机文件选择、保存仍需实测。
