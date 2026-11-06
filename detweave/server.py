"""Loopback-only local workbench. No uploaded code is executed by the server."""
from __future__ import annotations
import copy
import hashlib
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
from urllib.parse import urlsplit
from . import __version__
from .model import SCHEMA, validate
from .providers import extract, ProviderError
from .exporters import project_zip, svg

ROOT=Path(__file__).parent
MAX_BODY=2_000_000
SLOTS=threading.BoundedSemaphore(3)


def examples():
    return [dict(id=p.stem,title=(m:=json.loads(p.read_text()))["title"],text=m["source_text"],model=m) for p in sorted((ROOT/"examples").glob("*.json"))]


def run_extraction(text, provider):
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
    model,provenance=extract(text,provider)
    return dict(model=model,report=validate(model),provenance=provenance)


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
        elif path in ("/","/index.html","/app.js","/style.css"):
            name="index.html" if path=="/" else path[1:]
            kind={"index.html":"text/html; charset=utf-8","app.js":"text/javascript; charset=utf-8","style.css":"text/css; charset=utf-8"}[name]
            self.send(200,(ROOT/"web"/name).read_bytes(),kind)
        else:self.send(404,{"error":"Not found."})

    def do_POST(self):
        if not self.allowed(post=True):return
        if not SLOTS.acquire(blocking=False):
            self.send(429,{"error":"Three requests are already active. Wait for one to finish."});return
        try:
            if self.headers.get("Content-Type","").split(";")[0]!="application/json":
                self.send(415,{"error":"Use application/json."});return
            size=int(self.headers.get("Content-Length","0"))
            if size<=0 or size>MAX_BODY:
                self.send(413,{"error":"Request must be between 1 byte and 2 MB."});return
            self.connection.settimeout(250)
            body=json.loads(self.rfile.read(size),parse_constant=lambda s: (_ for _ in ()).throw(ValueError("Non-finite JSON value.")))
            if not isinstance(body,dict):raise ValueError("Request must be an object.")
            path=urlsplit(self.path).path
            if path=="/api/extract":
                result=run_extraction(body.get("text"),body.get("provider",{}))
                self.send(200,result)
            elif path=="/api/validate":self.send(200,validate(body.get("model")))
            elif path=="/api/export":
                self.send(200,project_zip(body.get("model"), body.get("provenance")),"application/zip","DetWeave-project.zip")
            elif path=="/api/svg":
                model=body.get("model");report=validate(model)
                if any(i["code"]=="schema" for i in report["issues"]):raise ValueError("Fix the model schema before previewing.")
                self.send(200,svg(model,report["instances"],body.get("plane","xz")),"image/svg+xml; charset=utf-8")
            else:self.send(404,{"error":"Not found."})
        except ProviderError as exc:self.send(502,{"error":str(exc)})
        except (ValueError,TypeError,KeyError,RecursionError) as exc:self.send(400,{"error":str(exc)[:500]})
        except Exception:
            self.send(500,{"error":"Internal operation failed. No output was accepted."})
        finally:SLOTS.release()


def serve(port=8765):
    server=ThreadingHTTPServer(("127.0.0.1",port),Handler)
    server.daemon_threads=True
    print(f"DetWeave {__version__}: http://127.0.0.1:{server.server_port} — Ctrl+C to stop",flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
