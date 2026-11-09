import base64
import hashlib
import re
from detweave.dev_ui import bundle_document


def test_single_document_contains_assets_and_exact_csp_hash():
    data, csp = bundle_document()
    html = data.decode()
    assert not re.search(r'<script[^>]+src=', html)
    assert not re.search(r'<link[^>]+href="/?[^" ]+\.css', html)
    scripts = re.findall(r'<script>(.*?)</script>', html, re.S)
    assert len(scripts) == 1
    digest = base64.b64encode(hashlib.sha256(scripts[0].encode()).digest()).decode()
    assert "'sha256-" + digest + "'" in csp
    assert "connect-src 'self'" in csp
    assert "script-src 'unsafe-inline'" not in csp
    assert "location.protocol==='file:'" in scripts[0]
    assert '--dev-ui --open' in html
