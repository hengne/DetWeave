#!/usr/bin/env python3
"""Build one offline HTML with embedded CPython/WASM and the unchanged geometry core.

Runtime assets are cached under local/, SHA-256 pinned, and never loaded from a
CDN by the delivered HTML. No API keys or local project data enter this build.
"""
from __future__ import annotations
import argparse
import ast
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'local/standalone-runtime'
VERSION = '0.28.2'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'dist/DetWeave-0.2.0.html')
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    lock = json.loads((ROOT / 'standalone/runtime-lock.json').read_text())
    for name, digest in lock.items():
        target = CACHE / name
        if not target.exists():
            if name.endswith('.whl'):
                package = name.split('-')[0] + '==' + name.split('-')[1]
                subprocess.run([sys.executable, '-m', 'pip', 'download', '--no-deps', '--only-binary=:all:', package, '-d', str(CACHE)], check=True)
            else:
                url = {'LICENSE-pyodide.txt':f'https://raw.githubusercontent.com/pyodide/pyodide/{VERSION}/LICENSE',
                       'LICENSE-python.txt':'https://raw.githubusercontent.com/python/cpython/v3.13.2/LICENSE'}.get(name,
                           f'https://cdn.jsdelivr.net/pyodide/v{VERSION}/full/{name}')
                target.write_bytes(urllib.request.urlopen(url, timeout=120).read())
        if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            raise SystemExit(f'Asset checksum mismatch: {name}')
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, 'w', zipfile.ZIP_DEFLATED) as archive:
        for file in sorted((ROOT/'detweave').rglob('*')):
            if file.is_file() and file.suffix not in ('.pyc',) and '__pycache__' not in file.parts and 'web' not in file.parts:
                archive.writestr(str(file.relative_to(ROOT)), file.read_bytes())
        source = (ROOT/'detweave/streaming.py').read_text()
        pieces = ['from .providers import ProviderError, MAX_RESPONSE_BYTES']
        for node in ast.parse(source).body:
            if isinstance(node, (ast.ClassDef, ast.FunctionDef)) and node.name in ('RunError', 'timeouts', 'safe_usage', 'Assembler'):
                pieces.append(ast.get_source_segment(source, node))
        archive.writestr('detweave/browser_stream.py', '\n\n'.join(pieces))
        archive.writestr('portable_bridge.py', (ROOT/'standalone/bridge.py').read_bytes())
        for file in ('LICENSE','NOTICE','CITATION.cff'):
            archive.writestr(file, (ROOT/file).read_bytes())
        wheels = sorted(CACHE.glob('*.whl')) + [ROOT/'packaging/vendor/pyrsistent-0.19.3-py3-none-any.whl']
        for wheel in wheels:
            with zipfile.ZipFile(wheel) as source:
                for entry in source.infolist():
                    if not entry.is_dir(): archive.writestr(entry.filename, source.read(entry))
        for file in CACHE.glob('LICENSE-*.txt'):
            archive.writestr('third-party-licenses/'+file.name, file.read_bytes())
    b64 = lambda content:base64.b64encode(content).decode()
    bundle = dict(runtime={name:b64((CACHE/name).read_bytes()) for name in ('pyodide.asm.wasm','python_stdlib.zip')},
                  lock=json.loads((CACHE/'pyodide-lock.json').read_text()), python=b64(payload.getvalue()))
    def script(content):
        return '<script>'+content.replace('</script', '<\\/script')+'</script>'
    html=(ROOT/'detweave/web/index.html').read_text()
    html=re.sub(r'<link[^>]+href="/?style.css"[^>]*>',lambda _: '<style>'+(ROOT/'detweave/web/style.css').read_text()+'\n.portable-bar{padding:8px 16px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:#112436;color:#d8e8f5;font:13px system-ui}.portable-bar span{flex:1;min-width:220px}</style>',html)
    html=re.sub(r'<script[^>]+src="/?(?:app|i18n|providers-catalog).js"[^>]*></script>','',html)
    html=html.replace('<body>', '<body><div id="portable-loading" style="position:fixed;inset:0;z-index:99999;background:#101d2d;color:#eef5ff;display:grid;place-items:center;font:18px system-ui;padding:24px">正在加载内置 Python 运行环境… / Loading embedded Python runtime…</div>')
    libraries='\n'.join(script((CACHE/name).read_text()) for name in ('pyodide.js','pyodide.asm.js'))
    libraries+='\n'+script((ROOT/'standalone/runtime.js').read_text())
    libraries+='\n'+script((ROOT/'detweave/web/i18n.js').read_text())
    libraries+='\n'+script((ROOT/'detweave/web/providers-catalog.js').read_text())
    app=(ROOT/'detweave/web/app.js').read_text()
    boot='const embeddedBundle='+json.dumps(bundle,separators=(',',':'))+';\nstartDetWeavePortable(embeddedBundle).then(() => {\n'+app+'\n}).catch(error => { (document.getElementById("portable-loading") || document.body).textContent="无法启动单文件版 / Could not start portable app: "+error.message; console.error(error); });'
    html=html.replace('</body>',libraries+'\n'+script(boot)+'\n</body>')
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(html)
    print(f'{args.output}: {args.output.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
