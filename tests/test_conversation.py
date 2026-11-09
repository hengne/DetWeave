import copy
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import pytest
from detweave.conversation import Conversations, ConversationConflict, run_turn, parse_proposal
from detweave.projects import ProjectStore
from detweave.server import examples
from detweave.streaming import RunControl, RunError
from test_http import request, server as http_server


@pytest.fixture
def project(tmp_path, monkeypatch):
    monkeypatch.setenv('DETWEAVE_PROJECTS_DIR', str(tmp_path))
    return ProjectStore().create('Conversation QA')


def turn(journal, project, text, provider=None):
    provider = provider or {'kind':'demo'}
    before = journal.get(project['id'])
    turn_id, doc = journal.start(project['id'],text,before['current_revision_id'],provider)
    proposal, provenance = run_turn(doc, provider, lambda e:None, RunControl())
    return journal.finish(project['id'],turn_id,proposal,provenance,provider)


def test_clarify_revise_restore_and_branch(project):
    journal = Conversations()
    first = turn(journal,project,examples()[0]['text'])
    v1 = first['revision_id']
    assert len(first['conversation']['revisions']) == 1
    clarification = turn(journal,project,'Make it thicker')
    assert clarification['revision_id'] is None
    assert clarification['conversation']['current_revision_id'] == v1
    assert clarification['model'] == first['model']
    revised = turn(journal,project,'demo change thickness')
    assert revised['model']['world'] == first['model']['world']
    assert revised['model']['placements'] == first['model']['placements']
    assert revised['conversation']['revisions'][-1]['parent_id'] == v1
    assert revised['conversation']['revisions'][-1]['changes']
    journal.select(project['id'],v1)
    assert Conversations().current(journal.get(project['id']))['model'] == first['model']
    branched = turn(journal,project,'demo change thickness')
    assert branched['conversation']['revisions'][-1]['parent_id'] == v1
    assert len(branched['conversation']['revisions']) == 3


def test_concurrency_stale_failure_and_key_privacy(project):
    journal = Conversations()
    config={'kind':'demo','api_key':'private-test-key-1234'}
    tid,doc = journal.start(project['id'],'first',None,config)
    with pytest.raises(ConversationConflict):journal.start(project['id'],'second',None,config)
    with pytest.raises(ConversationConflict):journal.select(project['id'],'anything')
    journal.fail(project['id'],tid,'cancelled')
    assert journal.get(project['id'])['messages'][-1]['status']=='cancelled'
    first=turn(journal,project,examples()[0]['text'])
    with pytest.raises(ConversationConflict):journal.start(project['id'],'stale',None,config)
    tid,doc=journal.start(project['id'],'explain',first['revision_id'],config)
    with pytest.raises(RunError):journal.finish(project['id'],tid,dict(action='answer',reply=config['api_key'],model=None),{},config)
    journal.fail(project['id'],tid,'unsafe_output')
    assert config['api_key'] not in open(project['folder']+'/conversation.json').read()
    with pytest.raises(ValueError):journal.start(project['id'],config['api_key'],first['revision_id'],config)


def test_migration_and_schema_rejection(project):
    model=examples()[0]['model']
    ProjectStore().update(project['id'],{'draft':{'text':model['source_text'],'model':model}})
    doc=Conversations().get(project['id'])
    assert len(doc['revisions'])==1 and doc['messages'][0]['role']=='user'
    for value in [dict(action='revise',reply='Changed',model={}),dict(action='answer',reply='Answer',model=model)]:
        with pytest.raises(RunError):parse_proposal(json.dumps(value),'source')
    assert parse_proposal(json.dumps(dict(action='clarify',reply='Which thickness?',model=None)),'source')['action']=='clarify'
    model=copy.deepcopy(model)
    key=next(iter(model['evidence']))
    model['evidence'][key]['status']='confirmed'
    parsed=parse_proposal(json.dumps(dict(action='revise',reply='Changed',model=model)),model['source_text'])
    assert parsed['model']['evidence'][key]['status']=='stated'


@pytest.mark.parametrize('kind',['openai','anthropic','gemini'])
def test_conversation_real_transport_mock_provider(project,kind):
    received=[]
    answer=dict(action='clarify',reply='What is the shell thickness?',model=None)
    content=json.dumps(answer)
    responses={'openai':{'choices':[{'finish_reason':'stop','message':{'content':content}}]},
               'anthropic':{'stop_reason':'end_turn','content':[{'type':'text','text':content}]},
               'gemini':{'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':content}]}}]}}
    class Provider(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            received.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
            raw=json.dumps(responses[kind]).encode()
            self.send_response(200);self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    app=ThreadingHTTPServer(('127.0.0.1',0),Provider)
    worker=threading.Thread(target=app.serve_forever,daemon=True);worker.start()
    try:
        provider=dict(kind=kind,model='synthetic',base_url=f'http://127.0.0.1:{app.server_port}')
        result=turn(Conversations(),project,'Make an aluminium shell',provider)
        assert result['reply']==answer['reply']
        assert result['conversation']['revisions']==[]
        encoded=json.dumps(received[0])
        assert 'conversational detector geometry editor' in encoded
        assert 'latest_message' in encoded
    finally:app.shutdown();app.server_close();worker.join(timeout=2)


def test_conversation_http_stream_and_restore(project,http_server):
    url=http_server+'/api/projects/'+project['id']+'/conversation'
    with request(url) as response:assert json.load(response)['current_revision_id'] is None
    with request(url+'/stream',{'text':examples()[0]['text'],'provider':{'kind':'demo'},'base_revision_id':None}) as response:
        events=[json.loads(line) for line in response]
    assert events[-1]['type']=='result'
    assert all(e['type'] not in ('reasoning','output') for e in events)
    first=events[-1]['result']
    with request(http_server+'/api/projects/'+project['id']) as response:
        assert json.load(response)['draft']['model']==first['model']
    with request(url+'/select',{'revision_id':first['revision_id']}) as response:
        assert json.load(response)['current_revision_id']==first['revision_id']


def test_human_confirmation_revision_preserved_only_for_unchanged_values(project):
    journal=Conversations()
    first=turn(journal,project,examples()[0]['text'])
    confirmed=journal.confirm(project['id'],first['revision_id'],['world.material'])
    revision=journal.current(confirmed)
    assert revision['model']['evidence']['world.material']['status']=='confirmed'
    assert revision['parent_id']==first['revision_id']
    assert 'User confirmed' in confirmed['messages'][-1]['content']
    with pytest.raises(ConversationConflict):journal.confirm(project['id'],first['revision_id'],['world.material'])
    with pytest.raises(ValueError):journal.confirm(project['id'],revision['id'],['unknown.target'])
    for changed in (False,True):
        before=journal.get(project['id'])
        previous=journal.current(before)
        tid,doc=journal.start(project['id'],'Change material' if changed else 'Keep material',before['current_revision_id'],{'kind':'demo'})
        model=copy.deepcopy(previous['model'])
        if changed:model['world']['material']='G4_Al'
        proposal=parse_proposal(json.dumps(dict(action='revise',reply='Proposal',model=model)),model['source_text'])
        assert proposal['model']['evidence']['world.material']['status']=='stated'
        result=journal.finish(project['id'],tid,proposal,{}, {'kind':'demo'})
        assert result['model']['evidence']['world.material']['status']==('stated' if changed else 'confirmed')


def test_http_disconnect_cancels_turn_and_keeps_geometry(project,http_server,monkeypatch):
    import socket
    import time
    from detweave import server
    journal=Conversations()
    first=turn(journal,project,examples()[0]['text'])
    def waiting(doc,provider,emit,control):
        while True:
            control.check()
            time.sleep(.02)
    monkeypatch.setattr(server,'run_turn',waiting)
    url=http_server+'/api/projects/'+project['id']+'/conversation'
    response=request(url+'/stream',{'text':'Pending change','provider':{'kind':'demo'},'base_revision_id':first['revision_id']})
    assert json.loads(response.readline())['type']=='status'
    response.fp.raw._sock.shutdown(socket.SHUT_RDWR)
    response.close()
    until=time.monotonic()+5
    while time.monotonic()<until:
        snapshot=journal.get(project['id'])
        if snapshot['messages'][-1]['status']=='cancelled':break
        time.sleep(.05)
    assert snapshot['messages'][-1]['status']=='cancelled'
    assert snapshot['current_revision_id']==first['revision_id']
    assert len(snapshot['revisions'])==1


def test_manual_edit_is_revision_and_stale_confirmation_rejected(project):
    journal = Conversations()
    first = turn(journal, project, examples()[0]['text'])
    model = copy.deepcopy(first['model'])
    model['world']['size_mm'][0] += 500
    saved = ProjectStore().update(project['id'], {'draft':{'text':model['source_text'],'model':model}})
    assert saved['draft']['model'] == model
    current = journal.get(project['id'])
    assert current['current_revision_id'] != first['revision_id']
    with pytest.raises(ConversationConflict):
        journal.confirm(project['id'],first['revision_id'],['world.size_mm'])
    confirmed = journal.confirm(project['id'],current['current_revision_id'],['world.size_mm'])
    assert journal.current(confirmed)['model']['world']['size_mm'] == model['world']['size_mm']


def test_journal_commit_survives_mirror_failure(project, monkeypatch):
    import detweave.conversation as module
    journal = Conversations()
    original_write = module._write
    def fail_mirror(path, data):
        if path.name == 'project.json':raise OSError('synthetic mirror failure')
        return original_write(path,data)
    monkeypatch.setattr(module,'_write',fail_mirror)
    first = turn(journal,project,examples()[0]['text'])
    assert ProjectStore().get(project['id'])['draft']['model'] == first['model']
    assert journal.current(journal.get(project['id']))['model'] == first['model']
    monkeypatch.setattr(module,'_write',original_write)
    journal.get(project['id'])
    with open(project['folder']+'/project.json') as stream:
        assert json.load(stream)['draft']['model'] == first['model']


def test_finish_rejection_releases_lock_and_records_failure(project):
    journal=Conversations()
    provider={'kind':'openai','api_key':'sk-1234'}
    tid,_=journal.start(project['id'],'Explain geometry',None,provider)
    with pytest.raises(RunError):
        journal.finish(project['id'],tid,{'action':'answer','reply':'Token sk-1234 leaked','model':None},{},provider)
    assert journal.get(project['id'])['messages'][-1]['status']=='failed'
    next_id,_=journal.start(project['id'],'Retry',None,provider)
    journal.fail(project['id'],next_id,'cancelled')


def test_schema_constants_not_exempt_in_free_text(project):
    from detweave.projects import model_contains_key
    sample=copy.deepcopy(examples()[0]['model'])
    # Shape type is a fixed enum; a note containing the same token is free text.
    sample['notes']=['box']
    assert model_contains_key(sample,'box')
    sample['notes']=['credential sk-1234 disclosed']
    assert model_contains_key(sample,'sk-1234')
