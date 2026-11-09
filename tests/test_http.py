import json
import threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import urllib.request
import urllib.error
import pytest
from detweave.server import Handler,examples
from detweave.providers import extract

@pytest.fixture
def server():
    app=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=app.serve_forever,daemon=True);thread.start()
    yield f'http://127.0.0.1:{app.server_port}'
    app.shutdown();app.server_close();thread.join(timeout=2)


def request(url,body=None,headers=None):
    headers=headers or {}
    if body is not None:
        headers={'Content-Type':'application/json','X-DetWeave':'1',**headers}
        body=json.dumps(body).encode()
    return urllib.request.urlopen(urllib.request.Request(url,body,headers),timeout=5)


def test_end_to_end_http_demo_export_and_gates(server):
    with request(server+'/api/examples') as response:fixture=json.load(response)[0]
    with request(server+'/api/extract',{'text':fixture['text'],'provider':{'kind':'demo'}}) as response:result=json.load(response)
    assert result['report']['ready']
    with request(server+'/api/export',{'model':result['model']}) as response:
        assert response.headers['Content-Type']=='application/zip'
        assert response.read(2)==b'PK'
    result['model']['questions']=[{'id':'missing','question':'Specify layer count','targets':[]}]
    with pytest.raises(urllib.error.HTTPError) as error:request(server+'/api/export',{'model':result['model']})
    assert error.value.code==400


def test_csrf_and_host_protection(server):
    for headers in ({'X-DetWeave':''},{'Origin':'https://untrusted.example'},{'Host':'attacker.example'}):
        with pytest.raises(urllib.error.HTTPError) as error:request(server+'/api/validate',{'model':{}},headers)
        assert error.value.code==403
    with pytest.raises(urllib.error.HTTPError) as error:request(server+'/../../pyproject.toml')
    assert error.value.code==404


@pytest.mark.parametrize('kind',['openai','anthropic','gemini'])
def test_real_http_transport_with_mock_provider(kind):
    sample=examples()[0]['model']
    content=json.dumps(sample)
    responses={'openai':{'choices':[{'finish_reason':'stop','message':{'content':content}}],'usage':{'total_tokens':5}},'anthropic':{'stop_reason':'end_turn','content':[{'type':'text','text':content}],'usage':{'input_tokens':3}},'gemini':{'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':content}]}}],'usageMetadata':{'totalTokenCount':5}}}
    class Provider(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            assert 'source data' in json.dumps(body)
            raw=json.dumps(responses[kind]).encode()
            self.send_response(200);self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    app=ThreadingHTTPServer(('127.0.0.1',0),Provider)
    thread=threading.Thread(target=app.serve_forever,daemon=True);thread.start()
    try:
        model,provenance=extract('source data',dict(kind=kind,model='test',base_url=f'http://127.0.0.1:{app.server_port}/v1'))
        assert model['source_text']=='source data'
        assert provenance['provider']==kind
        assert 'api_key' not in json.dumps(provenance)
    finally:app.shutdown();app.server_close();thread.join(timeout=2)


def test_project_location_permission_error_is_actionable(server, monkeypatch):
    from detweave.projects import ProjectStore
    def denied(self, path):
        raise PermissionError(1, 'Operation not permitted', '/restricted/DetWeave')
    monkeypatch.setattr(ProjectStore, 'register_location', denied)
    with pytest.raises(urllib.error.HTTPError) as error:
        request(server+'/api/projects/locations', {'path':'/selected/folder'})
    assert error.value.code == 507
    body = json.load(error.value)
    assert body['code'] == 'project_permission_error'
    assert '/restricted/DetWeave' in body['error']
    assert 'DETWEAVE_PROJECTS_DIR' in body['error']
