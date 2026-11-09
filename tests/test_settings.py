import json
import os
import stat
import urllib.error
import pytest
from detweave.settings import ProviderSettings, SettingsError
from test_http import request, server


@pytest.fixture
def settings(tmp_path,monkeypatch):
    root=tmp_path/'private-settings'
    monkeypatch.setenv('DETWEAVE_SETTINGS_DIR',str(root))
    return ProviderSettings()


def profile(ident='ark-coding',key='synthetic-secret'):
    return dict(id=ident,base_url='https://api.example.test/v1',model='synthetic-model',api_key=key,thinking='',total_timeout_s=600)


def test_restart_merge_change_delete_and_permissions(settings):
    assert settings.get()==dict(active='demo',profiles={})
    settings.update(dict(active='ark-coding',profile=profile()))
    restored=ProviderSettings().get()
    assert restored['profiles']['ark-coding']['api_key']=='synthetic-secret'
    settings.update(dict(active='deepseek',profile=profile('deepseek','second-key')))
    settings.update(dict(active='ark-coding'))
    assert len(settings.get()['profiles'])==2
    settings.update(dict(active='ark-coding',profile=profile(key='replaced-secret')))
    settings.update(dict(active='deepseek',forget='ark-coding'))
    assert list(settings.get()['profiles'])==['deepseek']
    assert 'synthetic-secret' not in settings.path.read_text()
    assert 'replaced-secret' not in settings.path.read_text()
    if os.name!='nt':
        assert stat.S_IMODE(settings.root.stat().st_mode)==0o700
        assert stat.S_IMODE(settings.path.stat().st_mode)==0o600
    assert not list(settings.root.glob('.settings-*'))


def test_invalid_and_corrupt_settings_are_not_overwritten(settings):
    settings.update(dict(active='ark-coding',profile=profile()))
    original=settings.path.read_bytes()
    for mutation in [{'active':'../bad'}, {'profile':{**profile(),'base_url':'https://user:password@example.test'}},
                     {'profile':{**profile(),'api_key':'secret\nheader'}}, {'profile':{**profile(),'total_timeout_s':float('nan')}},
                     {'profile':{**profile(),'unexpected':'value'}}]:
        with pytest.raises(ValueError):settings.update(mutation)
        assert settings.path.read_bytes()==original
    settings.path.write_text('{broken')
    with pytest.raises(SettingsError):settings.update({'active':'demo'})
    assert settings.path.read_text()=='{broken'


def test_symbolic_links_are_rejected(settings,tmp_path):
    target=tmp_path/'outside';target.mkdir()
    settings.root.symlink_to(target,target_is_directory=True)
    with pytest.raises(SettingsError):settings.get()


def test_settings_http_requires_client_header_and_restores(settings,server):
    endpoint=server+'/api/settings/providers'
    with pytest.raises(urllib.error.HTTPError) as error:request(endpoint)
    assert error.value.code==403
    with request(endpoint,{'active':'ark-coding','profile':profile()}) as response:
        assert json.load(response)['active']=='ark-coding'
    with request(endpoint,headers={'X-DetWeave':'1'}) as response:
        assert response.headers['Cache-Control']=='no-store'
        assert json.load(response)['profiles']['ark-coding']['api_key']=='synthetic-secret'
    with pytest.raises(urllib.error.HTTPError) as error:
        request(endpoint,headers={'X-DetWeave':'1','Origin':'https://untrusted.example'})
    assert error.value.code==403
    with request(endpoint,{'active':'ark-coding','forget':'ark-coding'}) as response:
        assert json.load(response)['profiles']=={}


def test_settings_failure_has_own_diagnostic(settings,server,monkeypatch):
    def denied(self):raise PermissionError('blocked')
    monkeypatch.setattr(ProviderSettings,'get',denied)
    with pytest.raises(urllib.error.HTTPError) as error:
        request(server+'/api/settings/providers',headers={'X-DetWeave':'1'})
    body=json.load(error.value)
    assert error.value.code==507
    assert body['code']=='provider_settings_storage_error'
    assert str(settings.root) in body['error']


def test_storage_error_reports_actual_custom_location(tmp_path):
    from detweave.settings import settings_error
    error = PermissionError(13, 'denied', str(tmp_path / 'custom' / 'providers.json'))
    assert str(tmp_path / 'custom') in settings_error(error)['error']
    assert str(tmp_path / 'explicit') in settings_error(error, tmp_path / 'explicit')['error']
