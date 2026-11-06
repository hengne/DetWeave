"""Run the existing local application inside a native window."""
import os
import threading
import sys
from pathlib import Path
from http.server import ThreadingHTTPServer

import toga
from .bridge import NativeHandler, SAVE_SCRIPT


class DetWeaveApp(toga.App):
    def startup(self):
        # Bind an exclusive ephemeral loopback port for this app instance.
        os.environ["DETWEAVE_PROJECTS_DIR"] = str(self.paths.data / "projects")
        self.main_window = toga.MainWindow(title=self.formal_name, size=(1280, 850))
        try:
            NativeHandler.export_dir = (Path.home() / "Documents" / "DetWeave Exports"
                                        if sys.platform == "ios" else self.paths.data / "exports")
            self.server = ThreadingHTTPServer(("127.0.0.1", 0), NativeHandler)
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

    async def install_bridge(self, widget, **kwargs):
        if widget.url and widget.url.startswith(self.local_url):
            await widget.evaluate_javascript(SAVE_SCRIPT)

    def on_exit(self):
        server = getattr(self, "server", None)
        if server:
            server.shutdown()
            server.server_close()
        return True


def main():
    return DetWeaveApp()
