"""Private, local provider settings, deliberately outside project/export storage.

Credentials are plaintext in a user-restricted file, not an encrypted vault.
POSIX permissions are 0700 for the settings directory and 0600 for the file;
Windows uses the account's application-data directory and inherited ACLs.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import threading
from urllib.parse import urlsplit

_LOCK = threading.RLock()
_MAX_BYTES = 512_000


class SettingsError(OSError):
    pass


def settings_root():
    configured = os.environ.get('DETWEAVE_SETTINGS_DIR')
    if configured:
        return Path(configured).expanduser().absolute()
    if sys.platform in ('darwin', 'ios'):
        return Path.home() / 'Library' / 'Application Support' / 'DetWeave' / 'settings'
    if sys.platform == 'win32':
        return Path(os.environ.get('APPDATA', str(Path.home() / 'AppData' / 'Roaming'))) / 'DetWeave' / 'settings'
    return Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config'))) / 'detweave' / 'settings'


def _id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', value):
        raise ValueError('Invalid provider profile identifier.')
    return value


def _profile(value):
    if not isinstance(value, dict) or set(value) - {'id','base_url','model','api_key','thinking','total_timeout_s'}:
        raise ValueError('Invalid provider settings fields.')
    ident = _id(value.get('id'))
    result = {}
    for field, limit in [('base_url',4096),('model',200),('api_key',16384),('thinking',16)]:
        item = value.get(field, '')
        if not isinstance(item,str) or len(item)>limit or any(c in item for c in '\r\n\x00'):
            raise ValueError('Invalid provider '+field+' setting.')
        result[field] = item
    base = result['base_url']
    if base:
        parsed = urlsplit(base)
        if parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.hostname:
            raise ValueError('Provider URL must not contain credentials, query or fragment.')
        if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('localhost','127.0.0.1','::1')):
            raise ValueError('Provider URL requires HTTPS, or a local HTTP endpoint.')
    if result['thinking'] not in ('','enabled','disabled','auto'):
        raise ValueError('Invalid thinking setting.')
    timeout = value.get('total_timeout_s',600)
    if type(timeout) not in (int,float) or not 60 <= timeout <= 900 or timeout != int(timeout):
        raise ValueError('Provider timeout must be 60–900 whole seconds.')
    result['total_timeout_s'] = int(timeout)
    return ident, result


class ProviderSettings:
    def __init__(self, root=None):
        self.root = Path(root) if root is not None else settings_root()
        self.path = self.root / 'providers.json'

    def _safe(self):
        if self.root.is_symlink() or self.path.is_symlink():
            raise SettingsError('Provider settings cannot use a symbolic link.')

    def _read(self):
        self._safe()
        if not self.path.exists():
            return {'active':'demo','profiles':{}}
        if self.path.stat().st_size > _MAX_BYTES:
            raise SettingsError('Provider settings file exceeds its size limit.')
        try:
            value = json.loads(self.path.read_text(encoding='utf-8'))
            if not isinstance(value,dict) or set(value) != {'active','profiles'}:
                raise ValueError()
            active = _id(value['active'])
            if not isinstance(value['profiles'],dict) or len(value['profiles'])>100:
                raise ValueError()
            profiles = {}
            for ident,profile in value['profiles'].items():
                if not isinstance(profile,dict):raise ValueError()
                key,clean = _profile({'id':ident,**profile})
                if key != ident:raise ValueError()
                profiles[key] = clean
            return dict(active=active,profiles=profiles)
        except (ValueError,UnicodeError,TypeError) as exc:
            raise SettingsError('Provider settings file is damaged; it was not overwritten.') from exc

    def get(self):
        with _LOCK:
            return self._read()

    def update(self, change):
        if not isinstance(change,dict) or set(change) - {'active','profile','forget'}:
            raise ValueError('Invalid provider settings update.')
        if 'profile' in change and 'forget' in change:
            raise ValueError('Save or forget a profile in separate operations.')
        active = _id(change['active']) if 'active' in change else None
        profile = _profile(change['profile']) if 'profile' in change else None
        forget = _id(change['forget']) if 'forget' in change else None
        with _LOCK:
            value = self._read()
            if active is not None:value['active'] = active
            if profile:value['profiles'][profile[0]] = profile[1]
            if forget:value['profiles'].pop(forget,None)
            if len(value['profiles'])>100:raise ValueError('Too many provider profiles.')
            payload = (json.dumps(value,ensure_ascii=False,allow_nan=False)+'\n').encode()
            if len(payload)>_MAX_BYTES:raise ValueError('Provider settings exceed size limit.')
            self.root.mkdir(mode=0o700,parents=True,exist_ok=True)
            self._safe()
            if os.name != 'nt':self.root.chmod(0o700)
            fd, temporary = tempfile.mkstemp(prefix='.settings-',dir=self.root)
            try:
                with os.fdopen(fd,'wb') as stream:
                    if os.name != 'nt':os.fchmod(stream.fileno(),0o600)
                    stream.write(payload);stream.flush();os.fsync(stream.fileno())
                os.replace(temporary,self.path)
            finally:
                Path(temporary).unlink(missing_ok=True)
            return value


def settings_error(exc, root=None):
    root = Path(root) if root is not None else (Path(exc.filename).parent if getattr(exc,'filename',None) else settings_root())
    return dict(code='provider_settings_storage_error',error=
        'Could not read or save model settings in '+str(root)+
        '. Check permissions; settings were not silently reset. '
        '/ 无法读取或保存本机模型配置：'+str(root)+'。请检查权限；不会静默重置配置。')
