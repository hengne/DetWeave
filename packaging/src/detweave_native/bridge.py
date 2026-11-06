"""Native export endpoint. File names and request sizes are constrained."""
import base64
import binascii
import json
import re
from pathlib import Path

from detweave.server import Handler

MAX_EXPORT = 24_000_000


class NativeHandler(Handler):
    export_dir = None

    def do_POST(self):
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
            obj = json.loads(self.rfile.read(size))
            filename = obj.get("filename", "")
            if not isinstance(filename, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,120}", filename) or filename.startswith("."):
                raise ValueError("Invalid export filename.")
            data = base64.b64decode(obj["data"], validate=True)
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
        except (ValueError, TypeError, KeyError, OSError, binascii.Error) as exc:
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
  alert('Saved / 已保存:\n' + result.path);
  return true;
};
"""
