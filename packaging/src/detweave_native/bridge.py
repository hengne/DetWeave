"""Native export endpoint. File names and request sizes are constrained."""
import asyncio
import base64
import binascii
from concurrent.futures import Future
import json
import re
from threading import Lock
from pathlib import Path

from detweave.server import Handler
from detweave.projects import ProjectStore

MAX_EXPORT = 24_000_000
MIME_TYPES = {
    ".zip": "application/zip",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".html": "text/html",
}


class AndroidExport:
    """Choose a writable document on the activity thread and stream bytes off it."""

    def __init__(self, app):
        self.app = app
        self.lock = Lock()

    def _choose_document(self, filename, selection):
        try:
            from android.app import Activity
            from android.content import Intent

            def completed(code, result):
                if code == Activity.RESULT_CANCELED:
                    selection.set_result(None)
                    return
                try:
                    uri = result.getData() if code == Activity.RESULT_OK and result is not None else None
                except Exception:
                    uri = None
                if uri is None:
                    selection.set_exception(OSError("Android did not return a writable document."))
                else:
                    selection.set_result(uri)

            intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
            intent.addCategory(Intent.CATEGORY_OPENABLE)
            intent.setType(MIME_TYPES.get(Path(filename).suffix.lower(), "application/octet-stream"))
            intent.putExtra(Intent.EXTRA_TITLE, filename)
            self.app._impl.start_activity(intent, on_complete=completed)
        except Exception:
            selection.set_exception(OSError("Could not open the Android file picker."))

    def __call__(self, filename, data):
        if not self.lock.acquire(blocking=False):
            raise OSError("Close the existing Android file picker before exporting again.")
        try:
            selection = Future()
            self.app.loop.call_soon_threadsafe(self._choose_document, filename, selection)
            uri = selection.result()
            if uri is None:
                return {"saved": False, "cancelled": True}
            self._write_document(uri, data)
            return {"saved": True}
        finally:
            self.lock.release()

    def _write_document(self, uri, data):
        try:
            from java import jarray, jbyte

            resolver = self.app._impl.native.getContentResolver()
            stream = resolver.openOutputStream(uri, "w")
            if stream is None:
                raise OSError("Document provider returned no output stream.")
            try:
                chunk_size = 256 * 1024
                for start in range(0, len(data), chunk_size):
                    stream.write(jarray(jbyte)(data[start:start + chunk_size]))
            finally:
                stream.close()
        except Exception as exc:
            raise OSError("Could not write to the selected Android document.") from exc


class DesktopFolderPicker:
    """Run the system folder dialog on the GUI event loop."""
    def __init__(self, app):
        self.app = app
        self.lock = Lock()

    async def _choose(self, result):
        try:
            import toga
            path = await self.app.main_window.dialog(toga.SelectFolderDialog(
                "Choose a project parent folder / 选择项目父文件夹"))
            result.set_result(str(path) if path is not None else None)
        except Exception as exc:
            result.set_exception(OSError("Could not open the system folder picker."))

    def __call__(self):
        if not self.lock.acquire(blocking=False):
            raise OSError("A folder picker is already open.")
        try:
            result = Future()
            self.app.loop.call_soon_threadsafe(lambda: asyncio.create_task(self._choose(result)))
            path = result.result()
            return ProjectStore().register_location(path) if path else None
        finally:
            self.lock.release()


class NativeHandler(Handler):
    export_dir = None

    def get_project(self, path):
        if path == "/api/projects/locations" and getattr(self.server, "mobile", False):
            self.send(200, {"default_id": "default", "locations": ProjectStore().locations(),
                            "capabilities": {"mode": "mobile", "system_picker": False, "register_path": False}})
            return
        return super().get_project(path)

    def do_POST(self):
        if self.path == "/api/native-pick-folder":
            if not self.allowed(post=True): return
            try:
                picker = getattr(self.server, "folder_picker", None)
                if picker is None: raise OSError("Folder selection is unavailable on this platform.")
                self.send(200, {"location": picker()})
            except (OSError, ValueError) as exc:
                self.send(400, {"error": str(exc)[:300]})
            return
        if self.path != "/api/native-save":
            return super().do_POST()
        if not self.allowed(post=True):
            return
        try:
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                raise ValueError("Expected JSON.")
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > MAX_EXPORT:
                raise ValueError("Export is too large.")
            self.connection.settimeout(30)
            obj = json.loads(self.rfile.read(size))
            if not isinstance(obj, dict):
                raise ValueError("Expected a JSON object.")
            filename = obj.get("filename", "")
            if not isinstance(filename, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,120}", filename) or filename.startswith("."):
                raise ValueError("Invalid export filename.")
            data = base64.b64decode(obj["data"], validate=True)
            android_export = getattr(self.server, "android_export", None)
            if android_export is not None:
                self.send(200, android_export(filename, data))
                return
            self.export_dir.mkdir(parents=True, exist_ok=True)
            path = self.export_dir / filename
            stem, suffix = path.stem, path.suffix
            for i in range(10000):
                candidate = path if i == 0 else path.with_name(f"{stem}-{i}{suffix}")
                try:
                    with candidate.open("xb") as target:
                        target.write(data)
                    break
                except FileExistsError:
                    continue
            else:
                raise ValueError("No available filename.")
            self.send(200, {"saved": True, "path": str(candidate)})
        except OSError as exc:
            self.send(507, {"error": str(exc)[:300]})
        except (ValueError, TypeError, KeyError, binascii.Error) as exc:
            self.send(400, {"error": str(exc)[:300]})


SAVE_SCRIPT = r"""
window.DetWeaveNativeSave = async (blob, filename) => {
  const data = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  const response = await fetch('/api/native-save', {
    method:'POST', headers:{'Content-Type':'application/json','X-DetWeave':'1'},
    body:JSON.stringify({filename, data})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Save failed');
  if (result.saved) {
    alert(result.path ? 'Saved / 已保存:\n' + result.path : 'Saved to the selected location / 已保存到所选位置');
  }
  return result;
};
true;
"""

PICKER_SCRIPT = r"""
window.DetWeaveSelectProjectFolder = async () => {
  const response = await fetch('/api/native-pick-folder', {
    method: 'POST', headers: {'Content-Type': 'application/json', 'X-DetWeave': '1'},
    body: '{}'
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Folder selection failed');
  return result.location;
};
true;
"""
