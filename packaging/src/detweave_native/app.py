"""Run the existing local application inside a native window."""
import asyncio
import json
import os
import threading
import sys
from pathlib import Path
from http.server import ThreadingHTTPServer

import toga
from .bridge import AndroidExport, DesktopFolderPicker, NativeHandler, PICKER_SCRIPT, SAVE_SCRIPT


class AppHandler(NativeHandler):
    def do_GET(self):
        if self.path == "/api/native-ui":
            if self.allowed():
                self.send(200, getattr(self.server, "ui_status", {"ready": False}))
            return
        super().do_GET()


# Only structural readiness is returned; never capture project text or credentials.
UI_PROBE = """JSON.stringify((() => {
 const visible = id => { const e = document.getElementById(id);
   if (!e) return false;
   const r = e.getBoundingClientRect(), s = getComputedStyle(e);
   return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
 return {ready: document.readyState === 'complete' && visible('chat-input') &&
   visible('project-menu') && window.detweaveProviderSettingsReady === true &&
   typeof window.DetWeaveNativeSave === 'function',
   nativeSaveReady: typeof window.DetWeaveNativeSave === 'function',
   folderPickerReady: typeof window.DetWeaveSelectProjectFolder === 'function',
   documentReady: document.readyState, chatVisible: visible('chat-input'),
   projectVisible: visible('project-menu'), settingsReady: window.detweaveProviderSettingsReady === true,
   viewportWidth: innerWidth, viewportHeight: innerHeight};
})())"""


class DetWeaveApp(toga.App):
    def startup(self):
        os.environ["DETWEAVE_SETTINGS_DIR"] = str(self.paths.data / "settings")
        # Bind an exclusive ephemeral loopback port for this app instance.
        os.environ["DETWEAVE_PROJECTS_DIR"] = str(
            Path.home() / "Documents" / "DetWeave Projects" if sys.platform == "ios"
            else self.paths.data / "projects")
        self.main_window = toga.MainWindow(title=self.formal_name, size=(1280, 850))
        try:
            NativeHandler.export_dir = (Path.home() / "Documents" / "DetWeave Exports"
                                        if sys.platform == "ios" else self.paths.data / "exports")
            self.server = ThreadingHTTPServer(("127.0.0.1", 0), AppHandler)
            self.server.mobile = sys.platform == "ios" or sys.platform == "android" or hasattr(sys, "getandroidapilevel")
            if sys.platform == "android" or hasattr(sys, "getandroidapilevel"):
                self.server.android_export = AndroidExport(self)
            elif sys.platform != "ios":
                self.server.folder_picker = DesktopFolderPicker(self)
        except OSError:
            self.main_window.content = toga.Label(
                "DetWeave cannot start its local service.\n无法启动本地服务。"
            )
            self.main_window.show()
            return
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.local_url = f"http://127.0.0.1:{self.server.server_port}/"
        self.webview = toga.WebView(url=self.local_url, on_webview_load=self.install_bridge)
        self.main_window.content = self.webview
        self.main_window.show()
        if sys.platform == "ios":
            self._ui_probe_task = asyncio.get_event_loop().create_task(self.probe_ui(self.webview))

    async def install_bridge(self, widget, **kwargs):
        if widget.url and widget.url.startswith(self.local_url):
            await widget.evaluate_javascript(SAVE_SCRIPT)
            if getattr(self.server, "folder_picker", None):
                await widget.evaluate_javascript(PICKER_SCRIPT)
            if sys.platform != "ios":
                await self.probe_ui(widget)

    async def probe_ui(self, widget):
        for _ in range(60):
            status = {"ready": False}
            try:
                if sys.platform == "ios":
                    bounds = widget._impl.native.bounds.size
                    status["nativeWidth"] = float(bounds.width)
                    status["nativeHeight"] = float(bounds.height)
                self.server.ui_status = dict(status)
                measured = json.loads(await asyncio.wait_for(widget.evaluate_javascript(UI_PROBE), timeout=5))
                status.update(measured)
                if getattr(self.server, "folder_picker", None):
                    status["ready"] = status["ready"] and status.get("folderPickerReady", False)
                if sys.platform == "ios":
                    status["ready"] = status["ready"] and status["nativeWidth"] > 100 and status["nativeHeight"] > 100
                self.server.ui_status = status
                if status["ready"]:
                    return
            except Exception as exc:
                status.update(ready=False, errorType=type(exc).__name__)
                self.server.ui_status = status
            await asyncio.sleep(1)

    def on_exit(self):
        server = getattr(self, "server", None)
        if server:
            server.shutdown()
            server.server_close()
        return True


def main():
    return DetWeaveApp()
