"""Bundle the development UI into one HTML document, served by the local backend.

This is deliberately not a file:// application: API calls stay on the loopback
origin. Scripts are permitted by exact CSP hashes, not unsafe-inline.
"""
from __future__ import annotations
import base64
import hashlib
from pathlib import Path
import re

WEB = Path(__file__).parent / 'web'


def bundle_document():
    html = (WEB / 'index.html').read_text(encoding='utf-8')

    def asset(name):
        if not re.fullmatch(r'[A-Za-z0-9_-]+\.(?:js|css)', name):
            raise ValueError('Only local UI assets may be bundled.')
        return (WEB / name).read_text(encoding='utf-8')

    sources = re.findall(r'<script\b[^>]*\bsrc="/?([A-Za-z0-9_-]+\.js)"[^>]*>\s*</script>', html)
    html = re.sub(r'<script\b[^>]*\bsrc="/?[A-Za-z0-9_-]+\.js"[^>]*>\s*</script>', '', html)
    html = re.sub(r'<link\b[^>]*\bhref="/?([A-Za-z0-9_-]+\.css)"[^>]*>',
                  lambda m: '<style>' + asset(m.group(1)).replace('</style', '<\\/style') + '</style>', html)
    guard = "if(location.protocol==='file:'){document.body.innerHTML='<main style=\"padding:3em;font:18px system-ui\">此开发界面需要本机后端。请运行 python -m detweave serve --dev-ui --open，然后使用打开的浏览器页面。<br>This development UI requires its local backend. Run python -m detweave serve --dev-ui --open.</main>';throw new Error('Local backend required');}"
    # One script ensures the file-origin guard stops all application code.
    joined = guard + '\n' + '\n'.join(asset(n).replace('</script', '<\\/script') for n in sources)
    hashes = ["'sha256-" + base64.b64encode(hashlib.sha256(joined.encode()).digest()).decode() + "'"]
    html = html.replace('</body>', '<script>' + joined + '</script>\n</body>')
    csp = ("default-src 'self'; script-src " + ' '.join(hashes) + "; style-src 'self' 'unsafe-inline'; "
           "img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
    return html.encode('utf-8'), csp
