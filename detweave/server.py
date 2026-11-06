"""Loopback-only local workbench. No uploaded code is executed by the server."""
from __future__ import annotations
import copy
import hashlib
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import queue
import time
from urllib.parse import urlsplit
from . import __version__
from .model import SCHEMA, validate
from .providers import extract, ProviderError
from .exporters import project_zip, svg
from .folder_picker import FolderPickerError, pick_folder, picker_backend
from .projects import ProjectNotFound, ProjectStore, persisted_result, public_provenance
from .streaming import RunControl, RunError, timeouts

ROOT=Path(__file__).parent
MAX_BODY=2_000_000
SLOTS=threading.BoundedSemaphore(3)
FOLDER_PICKER_SLOT = threading.Lock()
STORAGE_ERROR = dict(error="Could not read or save the local project. Check the project folder and available disk space.",
                     code="project_storage_error")
CAPACITY_ERROR = dict(error="Three requests are already active. Wait for one to finish.", code="local_busy")
STATIC = {
    "index.html": "text/html; charset=utf-8",
    "app.js": "text/javascript; charset=utf-8",
    "i18n.js": "text/javascript; charset=utf-8",
    "providers-catalog.js": "text/javascript; charset=utf-8",
    "style.css": "text/css; charset=utf-8",
}


def examples():
    return [dict(id=p.stem,title=(m:=json.loads(p.read_text()))["title"],text=m["source_text"],model=m) for p in sorted((ROOT/"examples").glob("*.json"))]


def run_extraction(text, provider, emit=None, control=None):
    if not isinstance(text,str) or not text.strip() or len(text)>30000:
        raise ValueError("Input must contain 1–30,000 characters.")
    if not isinstance(provider,dict):
        raise ValueError("Provider configuration must be an object.")
    if provider.get("kind")=="demo":
        for item in examples():
            if text.strip()==item["text"].strip():
                model=copy.deepcopy(item["model"])
                return dict(model=model,report=validate(model),provenance=dict(provider="demo",model="fixed-synthetic-fixture",prompt_version="0.1",source_sha256=hashlib.sha256(text.encode()).hexdigest(),duration_s=0,usage={}))
        raise ValueError("离线演示只识别内置示例。请加载示例，或配置模型 API 后解析自己的文本；不会把任意文本替换为演示几何。")
    model,provenance=extract(text,provider,emit=emit,control=control)
    if emit:emit(dict(type="status",stage="validating",message="检查 Schema、来源、层级和几何约束。"))
    report=validate(model)
    if control:control.check()
    return dict(model=model,report=report,provenance=provenance)


class Handler(BaseHTTPRequestHandler):
    server_version="DetWeave/"+__version__
    def log_message(self,*args):
        pass  # request bodies, credentials and source discussions are not logged

    def send(self,status,data,kind="application/json; charset=utf-8",download=None):
        if not isinstance(data,bytes):
            data=(json.dumps(data,ensure_ascii=False,allow_nan=False) if kind.startswith("application/json") else data).encode()
        self.send_response(status)
        self.send_header("Content-Type",kind)
        self.send_header("Content-Length",str(len(data)))
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("Referrer-Policy","no-referrer")
        self.send_header("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        if download:self.send_header("Content-Disposition",f'attachment; filename="{download}"')
        self.end_headers()
        try:self.wfile.write(data)
        except (BrokenPipeError,ConnectionResetError):pass

    def allowed(self,post=False):
        expected={f"127.0.0.1:{self.server.server_port}",f"localhost:{self.server.server_port}"}
        if self.headers.get("Host") not in expected:
            self.send(403,{"error":"Loopback host required."});return False
        origin=self.headers.get("Origin")
        if origin and origin not in {"http://"+host for host in expected}:
            self.send(403,{"error":"Cross-origin requests are disabled."});return False
        if post and self.headers.get("X-DetWeave")!="1":
            self.send(403,{"error":"Missing local client request header."});return False
        return True

    def do_GET(self):
        if not self.allowed():return
        path=urlsplit(self.path).path
        if path=="/api/schema":self.send(200,SCHEMA)
        elif path=="/api/examples":self.send(200,examples())
        elif path=="/api/health":self.send(200,dict(version=__version__,status="ok",backend_execution="external-only"))
        elif path=="/api/projects" or path.startswith("/api/projects/"):
            try:
                self.get_project(path)
            except ProjectNotFound as exc:self.send(404,{"error":str(exc)})
            except ValueError as exc:self.send(400,{"error":str(exc)})
            except (OSError, KeyError, TypeError):self.send(507,STORAGE_ERROR)
        elif path=="/" or path[1:] in STATIC:
            name="index.html" if path=="/" else path[1:]
            try:data=(ROOT/"web"/name).read_bytes()
            except FileNotFoundError:self.send(404,{"error":"Not found."})
            else:self.send(200,data,STATIC[name])
        else:self.send(404,{"error":"Not found."})

    def get_project(self, path):
        store = ProjectStore()
        parts = path.split("/")
        if path == "/api/projects":
            self.send(200, {"projects": store.list()})
        elif path == "/api/projects/locations":
            capabilities = dict(mode="desktop", system_picker=picker_backend() is not None, register_path=True)
            self.send(200, {"default_id": "default", "locations": store.locations(), "capabilities": capabilities})
        elif len(parts) == 4:
            self.send(200, store.get(parts[3]))
        elif len(parts) == 6 and parts[4] == "runs":
            self.send(200, store.get_run(parts[3], parts[5]))
        else:
            self.send(404, {"error": "Not found."})

    def post_project(self, path, body):
        store = ProjectStore()
        parts = path.split("/")
        if path == "/api/projects":
            self.send(201, store.create(body.get("title"), body.get("draft"), body.get("location_id")))
        elif path == "/api/projects/locations":
            self.send(201, store.register_location(body.get("path")))
        elif path == "/api/projects/locations/pick":
            self.pick_project_location(store)
        elif len(parts) == 4:
            self.send(200, store.update(parts[3], body))
        else:
            self.send(404, {"error": "Not found."})

    def pick_project_location(self, store):
        backend = picker_backend()
        if backend is None:
            self.send(501, {"error": "A desktop folder picker is unavailable on the machine running DetWeave."})
            return
        if not FOLDER_PICKER_SLOT.acquire(blocking=False):
            self.send(409, {"error": "Close the current folder picker before opening another one."})
            return
        try:
            selected = pick_folder(backend)
            if selected is None:
                self.send(200, {"cancelled": True})
            else:
                self.send(201, store.register_location(selected))
        except FolderPickerError as exc:
            self.send(503, {"error": str(exc)})
        finally:
            FOLDER_PICKER_SLOT.release()

    @staticmethod
    def save_run_result(store, project_id, run_id, result, provider):
        safe_result, error = persisted_result(result, provider)
        if error:
            message = ("The generated model did not match the DetWeave IR schema."
                       if error == "schema" else "The generated output contained credentials and was discarded.")
            raise RunError(message, error)
        store.finish_run(project_id, run_id, "succeeded", result=safe_result)
        return {**safe_result, "project_run_id": run_id}

    def extract_request(self, body, stream):
        text = body.get("text")
        provider = body.get("provider", {})
        project_id = body.get("project_id")
        store = ProjectStore() if project_id is not None else None
        run_id = store.start_run(project_id, text, provider) if store else None
        if not SLOTS.acquire(blocking=False):
            if store:
                store.finish_run(project_id, run_id, "failed", error_code=CAPACITY_ERROR["code"])
            self.send(429, CAPACITY_ERROR)
            return
        try:
            if stream:
                self.stream_extraction(body, store, project_id, run_id)
            else:
                result = run_extraction(text, provider)
                if store:
                    result = self.save_run_result(store, project_id, run_id, result, provider)
                self.send(200, result)
        except Exception as exc:
            if store:
                self.save_run_failure(store, project_id, run_id, exc)
            raise
        finally:
            SLOTS.release()

    @staticmethod
    def save_run_failure(store, project_id, run_id, exc):
        code = getattr(exc, "code", "configuration" if isinstance(exc, ValueError) else "extraction_error")
        status = "cancelled" if code == "cancelled" else "failed"
        store.finish_run(project_id, run_id, status, error_code=code)

    def stream_extraction(self, body, store=None, project_id=None, run_id=None):
        provider = body.get("provider", {})
        if not isinstance(provider, dict):
            raise ValueError("Provider configuration must be an object.")
        total_s, idle_s = timeouts(provider)
        control = RunControl(total_s, idle_s)
        events = queue.Queue(maxsize=128)
        finished = threading.Event()
        activity = {"last": None}

        def emit(event):
            control.check()
            if event.get("type") in ("activity", "reasoning", "output", "usage"):
                activity["last"] = time.monotonic()
            event = {**event, "elapsed_s": round(control.elapsed, 2)}
            while True:
                control.check()
                try:
                    events.put(event, timeout=0.1)
                    return
                except queue.Full:
                    continue

        def worker():
            try:
                if provider.get("kind") == "demo":
                    emit(dict(type="status", stage="validating", message="校验内置合成示例；此模式不调用模型。"))
                result = run_extraction(body.get("text"), provider, emit, control)
                control.check()
                emit(dict(type="result", result=result))
            except Exception as exc:
                if control.reason == "cancelled":
                    return
                message = str(exc) if isinstance(exc, (ProviderError, ValueError)) else "本地提取失败；没有接受部分几何。"
                event = dict(type="error", code=getattr(exc, "code", "extraction_error"), message=message[:500], elapsed_s=round(control.elapsed, 2))
                # Deadline errors must reach the browser even after control.check would reject emits.
                try:events.put(event, timeout=0.5)
                except queue.Full:pass
            finally:
                control.finish()
                finished.set()

        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store, no-transform")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        self.connection.settimeout(5)
        thread = threading.Thread(target=worker, daemon=True)
        stage = "starting"
        def write(event):
            self.wfile.write((json.dumps(event,ensure_ascii=False,allow_nan=False)+"\n").encode())
            self.wfile.flush()
        terminal_handled = False
        thread.start()
        try:
            write(dict(type="status", stage=stage, message="请求已接收，正在启动模型调用。", elapsed_s=0))
            while True:
                try:
                    event = events.get(timeout=1)
                except queue.Empty:
                    if finished.is_set():
                        event = dict(type="error", code="incomplete_response", message="调用结束但没有完整结果。", elapsed_s=round(control.elapsed,2))
                    else:
                        last = activity["last"]
                        event = dict(type="heartbeat", stage=stage, elapsed_s=round(control.elapsed,2),
                                     seconds_since_provider_event=None if last is None else round(time.monotonic()-last,2))
                if event["type"] == "status":stage=event.get("stage",stage)
                elif event["type"] == "reasoning":stage="thinking"
                elif event["type"] == "output":stage="generating"
                if store and event["type"] in ("result", "error"):
                    terminal_handled = True
                    try:
                        if event["type"] == "result":
                            try:
                                event["result"] = self.save_run_result(store, project_id, run_id, event["result"], provider)
                            except RunError as exc:
                                self.save_run_failure(store, project_id, run_id, exc)
                                event = dict(type="error", code=exc.code, message=str(exc))
                        else:
                            store.finish_run(project_id, run_id, "failed", error_code=event["code"])
                    except (OSError, ProjectNotFound):
                        event = dict(type="error", code=STORAGE_ERROR["code"], message=STORAGE_ERROR["error"])
                write(event)
                if event["type"] in ("result","error"):
                    break
        except (BrokenPipeError,ConnectionResetError,TimeoutError,OSError):
            control.abort("cancelled")
        finally:
            if not finished.is_set():control.abort("cancelled")
            if store and not terminal_handled:
                try:store.finish_run(project_id, run_id, "cancelled", error_code="cancelled")
                except (OSError, ProjectNotFound):pass  # Client has disconnected.
            thread.join(timeout=21)  # pending DNS/TLS connection has its own <=20 s timeout
            control.finish()

    def do_POST(self):
        if not self.allowed(post=True):return
        path=urlsplit(self.path).path
        project_api=path=="/api/projects" or path.startswith("/api/projects/")
        extraction=path in ("/api/extract", "/api/extract/stream")
        needs_slot=not (project_api or extraction)
        if needs_slot and not SLOTS.acquire(blocking=False):
            self.send(429,CAPACITY_ERROR);return
        try:
            if self.headers.get("Content-Type","").split(";")[0]!="application/json":
                self.send(415,{"error":"Use application/json."});return
            size=int(self.headers.get("Content-Length","0"))
            if size<=0 or size>MAX_BODY:
                self.send(413,{"error":"Request must be between 1 byte and 2 MB."});return
            self.connection.settimeout(250)
            body=json.loads(self.rfile.read(size),parse_constant=lambda s: (_ for _ in ()).throw(ValueError("Non-finite JSON value.")))
            if not isinstance(body,dict):raise ValueError("Request must be an object.")
            if extraction:
                self.extract_request(body, stream=path.endswith("/stream"))
            elif project_api:
                self.post_project(path, body)
            elif path=="/api/validate":self.send(200,validate(body.get("model")))
            elif path=="/api/export":
                project_id = body.get("project_id")
                provenance = body.get("provenance")
                if project_id is not None:
                    provenance = public_provenance(provenance)
                archive = project_zip(body.get("model"), provenance)
                if project_id is not None:
                    ProjectStore().save_export(project_id, archive)
                self.send(200,archive,"application/zip","DetWeave-project.zip")
            elif path=="/api/svg":
                model=body.get("model");report=validate(model)
                if any(i["code"]=="schema" for i in report["issues"]):raise ValueError("Fix the model schema before previewing.")
                self.send(200,svg(model,report["instances"],body.get("plane","xz")),"image/svg+xml; charset=utf-8")
            else:self.send(404,{"error":"Not found."})
        except ProjectNotFound as exc:self.send(404,{"error":str(exc)})
        except OSError:self.send(507,STORAGE_ERROR)
        except ProviderError as exc:self.send(502,{"error":str(exc)})
        except (ValueError,TypeError,KeyError,RecursionError) as exc:self.send(400,{"error":str(exc)[:500]})
        except Exception:
            self.send(500,{"error":"Internal operation failed. No output was accepted."})
        finally:
            if needs_slot:SLOTS.release()


def serve(port=8765):
    server=ThreadingHTTPServer(("127.0.0.1",port),Handler)
    server.daemon_threads=True
    print(f"DetWeave {__version__}: http://127.0.0.1:{server.server_port} — Ctrl+C to stop",flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
