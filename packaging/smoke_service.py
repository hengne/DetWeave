"""Stdlib-only checks against an already-running native app; synthetic data only."""
from __future__ import annotations
import argparse
import json
import time
from pathlib import Path
import urllib.request
from urllib.parse import urlsplit
from uuid import uuid4


def check_service(origin):
    parsed = urlsplit(origin)
    if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or not parsed.port:
        raise ValueError('Smoke checks require an explicitly selected loopback app URL.')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def request(route, body=None, stream=False):
        headers = {'X-DetWeave':'1'}
        data = None
        if body is not None:
            headers['Content-Type'] = 'application/json'
            data = json.dumps(body).encode()
        with opener.open(urllib.request.Request(origin.rstrip('/')+route,data,headers),timeout=20) as response:
            if stream:
                events = [json.loads(line) for line in response if line.strip()]
                assert events[-1]['type'] == 'result', events[-1].get('code','Missing result')
                return events[-1]['result']
            return json.load(response)
    health = request('/api/health')
    assert health['status'] == 'ok'
    deadline = time.monotonic() + 60
    while True:
        ui = request('/api/native-ui')
        if ui.get('ready'):
            break
        if time.monotonic() >= deadline:
            raise RuntimeError(f'Native UI did not render chat/project controls: {ui}')
        time.sleep(1)
    fixtures = request('/api/examples')
    assert len(fixtures) >= 2
    report = request('/api/validate', {'model':fixtures[0]['model']})
    assert report['ready'] and report['instances']
    project = request('/api/projects', {'title':'Native smoke '+uuid4().hex[:8], 'location_id':'default'})
    route = '/api/projects/'+project['id']+'/conversation'
    state = request(route)
    def turn(text):
        nonlocal state
        result = request(route+'/stream', {'text':text,'provider':{'kind':'demo'},
                         'base_revision_id':state['current_revision_id']}, stream=True)
        state = result['conversation']
        return result
    first = turn(fixtures[0]['text'])
    initial = state['current_revision_id']
    assert len(state['revisions']) == 1
    turn('Synthetic clarification check; no real model request.')
    assert state['current_revision_id'] == initial and len(state['revisions']) == 1
    turn('demo change thickness')
    assert len(state['revisions']) == 2 and state['revisions'][-1]['parent_id'] == initial
    assert state['revisions'][-1]['model'] != first['model']
    restored = request(route+'/select', {'revision_id':initial})
    assert restored['current_revision_id'] == initial
    assert request('/api/projects/'+project['id'])['draft']['model'] == first['model']
    assert request(route)['current_revision_id'] == initial
    # Merge a uniquely named profile, delete it, and restore the original active
    # selection. Never alter any existing profile/key, even if run manually.
    settings = request('/api/settings/providers')
    ident = 'native-smoke-'+uuid4().hex
    try:
        request('/api/settings/providers', {'active':ident, 'profile':{
            'id':ident,'base_url':'https://example.invalid/v1','model':'synthetic',
            'api_key':'synthetic-native-smoke-key','thinking':'','total_timeout_s':600}})
        saved = request('/api/settings/providers')
        assert saved['profiles'][ident]['api_key'] == 'synthetic-native-smoke-key'
    finally:
        request('/api/settings/providers', {'active':settings['active'],'forget':ident})
    assert request('/api/settings/providers') == settings
    return {'version':health['version'],'status':'passed','project_id':project['id'],
            'native_ui':ui,
            'checks':['health','rendered native chat and project controls','bundled examples','geometry validation','named project',
                      'conversation generation','clarification preserves revision','geometry edit',
                      'restore and persisted model','provider settings save/read/delete'],
            'model_calls':'none; deterministic fixtures only'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('origin')
    parser.add_argument('--output',type=Path)
    args = parser.parse_args()
    result = check_service(args.origin)
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))
