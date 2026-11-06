import io
import json
import socket
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.request
import pytest
from detweave.providers import extract
from detweave.streaming import Assembler, RunControl, RunError, read_sse, timeouts
from detweave.server import Handler, examples, SLOTS

SAMPLE=examples()[0]['model']
CONTENT=json.dumps(SAMPLE,ensure_ascii=False)


def frame(value):
    return ('data: '+json.dumps(value,ensure_ascii=False)+'\r\n\r\n').encode()


def openai(delta=None,finish=None,**extra):
    return dict(model='test-model-returned',choices=[dict(index=0,delta=delta or {},finish_reason=finish)],**extra)


@contextmanager
def mock_provider(action):
    class Provider(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            self.server.body=body
            self.server.path=self.path
            self.send_response(200)
            self.send_header('Content-Type','text/event-stream')
            self.end_headers()
            try:action(self)
            except (BrokenPipeError,ConnectionResetError,OSError):pass
    app=ThreadingHTTPServer(('127.0.0.1',0),Provider);app.daemon_threads=True
    thread=threading.Thread(target=app.serve_forever,daemon=True);thread.start()
    try:yield app,dict(kind='openai',model='test',base_url=f'http://127.0.0.1:{app.server_port}/v1')
    finally:app.shutdown();app.server_close();thread.join(timeout=2)


@pytest.mark.parametrize('kind',['openai','anthropic','gemini'])
def test_live_chunks_assembled_without_reasoning_in_model_or_provenance(kind):
    reasoning='服务商公开片段：检查尺寸。'
    if kind=='openai':
        chunks=[openai({'reasoning_content':reasoning}),openai({'content':CONTENT[:30]}),openai({'content':CONTENT[30:]}),openai(finish='stop',usage={'completion_tokens':12})]
    elif kind=='anthropic':
        chunks=[{'type':'message_start','message':{'model':'test-returned','usage':{'input_tokens':3}}},
                {'type':'content_block_delta','delta':{'type':'thinking_delta','thinking':reasoning}},
                {'type':'content_block_delta','delta':{'type':'signature_delta','signature':'HIDDEN-SIGNATURE'}},
                {'type':'content_block_delta','delta':{'type':'text_delta','text':CONTENT}},
                {'type':'message_delta','delta':{'stop_reason':'end_turn'},'usage':{'output_tokens':12}}, {'type':'message_stop'}]
    else:
        chunks=[{'candidates':[{'content':{'parts':[{'thought':True,'text':reasoning}]}}]},
                {'candidates':[{'content':{'parts':[{'text':CONTENT}]},'finishReason':'STOP'}],'usageMetadata':{'totalTokenCount':12}}]
    def action(handler):
        for chunk in chunks:
            data=frame(chunk)
            # Deliberately split UTF-8 sequences and SSE delimiters over socket writes.
            for i in range(0,len(data),7):handler.wfile.write(data[i:i+7])
            handler.wfile.flush()
        if kind=='openai':handler.wfile.write(b'data: [DONE]\n\n')
    seen=[]
    with mock_provider(action) as (server,config):
        config['kind']=kind
        model,provenance=extract(SAMPLE['source_text'],config,seen.append)
        if kind!='gemini':assert server.body['stream'] is True
        else:assert server.path.endswith(':streamGenerateContent?alt=sse')
    assert model==SAMPLE
    assert any(e['type']=='reasoning' and e['text']==reasoning for e in seen)
    assert ''.join(e['text'] for e in seen if e['type']=='output')==CONTENT
    assert reasoning not in json.dumps(provenance,ensure_ascii=False)
    assert 'HIDDEN-SIGNATURE' not in json.dumps(seen)
    assert provenance['reasoning_bytes']==len(reasoning.encode())


@pytest.mark.parametrize('chunks,code',[
    ([openai({'content':'{}'})],'incomplete_response'),
    ([openai({'content':'{}'},finish='length')],'incomplete_response'),
    ([{'error':{'message':'DO-NOT-ECHO-KEY'}}],'provider_stream_error'),
    ([openai({'tool_calls':[{'function':'x'}]})],'completion_rejected'),
    ([openai({'refusal':'no'})],'completion_rejected'),
])
def test_partial_json_and_stream_errors_never_accepted(chunks,code):
    assembler=Assembler('openai',lambda e:None)
    with pytest.raises(RunError) as error:
        read_sse(io.BytesIO(b''.join(frame(c) for c in chunks)),assembler,RunControl())
    assert error.value.code==code
    assert 'DO-NOT-ECHO-KEY' not in str(error.value)


def test_comment_and_usage_frames_are_liveness_not_fake_thinking():
    events=[];assembler=Assembler('openai',events.append)
    data=b': heartbeat\n\n'+frame(openai({'content':'{}'}))+frame(openai(finish='stop'))+frame({'choices':[],'usage':{'total_tokens':2,'secret':'DO-NOT-SAVE'}})+b'data: [DONE]\n\n'
    assert read_sse(io.BytesIO(data),assembler,RunControl())=='{}'
    assert any(e['type']=='activity' for e in events)
    assert not any(e['type']=='reasoning' for e in events)
    assert assembler.usage=={'total_tokens':2}


def test_total_deadline_interrupts_an_active_stream():
    def action(handler):
        for _ in range(50):
            handler.wfile.write(b': still alive\n\n');handler.wfile.flush();time.sleep(.02)
    with mock_provider(action) as (_,config):
        started=time.monotonic()
        with pytest.raises(RunError) as error:extract('text',config,control=RunControl(total_s=.15,idle_s=1))
        assert error.value.code=='total_timeout'
        assert time.monotonic()-started<.8


def test_idle_timeout_is_separate_from_total_deadline():
    def action(handler):
        handler.wfile.write(b': first\n\n');handler.wfile.flush();time.sleep(.5)
    with mock_provider(action) as (_,config):
        with pytest.raises(RunError) as error:extract('text',config,control=RunControl(total_s=5,idle_s=.12))
        assert error.value.code=='idle_timeout'


def test_cancel_interrupts_read_and_returns_no_model():
    ready=threading.Event()
    def action(handler):
        handler.wfile.write(frame(openai({'reasoning_content':'visible'})));handler.wfile.flush();ready.set();time.sleep(.5)
    with mock_provider(action) as (_,config):
        control=RunControl(total_s=5,idle_s=5);results=[]
        def work():
            try:results.append(extract('text',config,control=control))
            except RunError as exc:results.append(exc.code)
        worker=threading.Thread(target=work);worker.start();assert ready.wait(1)
        control.abort();worker.join(timeout=1)
        assert not worker.is_alive() and results==['cancelled']


def test_no_absolute_120_second_cutoff_when_provider_is_active():
    def action(handler):handler.wfile.write(frame(openai({'content':CONTENT},finish='stop'))+b'data: [DONE]\n\n')
    with mock_provider(action) as (_,config):
        control=RunControl(total_s=600,idle_s=90)
        control.started-=121 # deterministic elapsed-time regression; no 2-minute test sleep
        model,meta=extract(SAMPLE['source_text'],config,control=control)
        assert model==SAMPLE and meta['duration_s']>=121


@pytest.mark.parametrize('config',[{'total_timeout_s':0},{'total_timeout_s':901},{'total_timeout_s':True},{'idle_timeout_s':float('nan')}])
def test_timeout_configuration_is_bounded(config):
    with pytest.raises(RunError):timeouts(config)


def test_ndjson_endpoint_delivers_early_activity_then_validated_result():
    def action(handler):
        handler.wfile.write(frame(openai({'reasoning_content':'检查层数'})));handler.wfile.flush()
        time.sleep(.1)
        handler.wfile.write(frame(openai({'content':CONTENT},finish='stop'))+b'data: [DONE]\n\n')
    with mock_provider(action) as (_,config):
        app=ThreadingHTTPServer(('127.0.0.1',0),Handler);app.daemon_threads=True
        thread=threading.Thread(target=app.serve_forever,daemon=True);thread.start()
        try:
            req=urllib.request.Request(f'http://127.0.0.1:{app.server_port}/api/extract/stream',data=json.dumps({'text':SAMPLE['source_text'],'provider':config}).encode(),headers={'Content-Type':'application/json','X-DetWeave':'1'})
            with urllib.request.urlopen(req,timeout=5) as response:
                assert 'ndjson' in response.headers['Content-Type']
                first=json.loads(response.readline());assert first['type']=='status'
                events=[json.loads(line) for line in response if line.strip()]
            assert any(e['type']=='reasoning' for e in events)
            assert events[-1]['type']=='result' and events[-1]['result']['report']['ready']
        finally:app.shutdown();app.server_close();thread.join(timeout=2)
