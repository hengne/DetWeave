"""Same Python geometry core inside the self-contained browser application.

No HTTP listener, subprocess, remote import, or execution of generated code.
"""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import time
import zipfile

os.environ['DETWEAVE_PROJECTS_DIR'] = '/storage/browser'
from detweave.model import validate, SCHEMA
from detweave.exporters import project_zip
from detweave.projects import ProjectStore, persisted_result
from detweave.providers import request_spec, response_text, parse_response, PROMPT_VERSION
from detweave.browser_stream import Assembler, timeouts

_STORE = ProjectStore()
_RUNS = {}
_STORAGE = Path('/storage')
_LOCATION_FILE = Path('browser/.locations.json')
_ID = re.compile(r'[0-9a-f]{32}')


def _examples():
    return [dict(id=p.stem, title=(m:=json.loads(p.read_text()))['title'], text=m['source_text'], model=m)
            for p in sorted(Path('/app/detweave/examples').glob('*.json'))]


def _prepare_result(run, model, provenance):
    result = dict(model=model, report=validate(model), provenance=provenance)
    clean, error = persisted_result(result, run['provider'])
    if error:
        raise ValueError('Invalid model or credential echo; generated output was discarded.')
    run['result'] = clean


def _project_location(path):
    parts = path.parts
    if len(parts) >= 3 and parts[0] == 'browser':
        root = Path(*parts[:2])
    elif len(parts) >= 4 and parts[0] == 'handles' and _ID.fullmatch(parts[1]):
        root = Path(*parts[:3])
    else:
        return None
    folder = root.name
    project_id = folder.rsplit(' -- ', 1)[-1]
    return (project_id, root) if ' -- ' in folder and _ID.fullmatch(project_id) else None


def _decode_snapshot(encoded):
    content = base64.b64decode(encoded, validate=True)
    files = {}
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        if sum(entry.file_size for entry in archive.infolist()) > 100_000_000:
            raise ValueError('Project archive exceeds 100 MB.')
        for entry in archive.infolist():
            relative = Path(entry.filename)
            if (relative.is_absolute() or len(relative.parts) < 2 or '..' in relative.parts
                    or '\\' in entry.filename or relative.as_posix() != entry.filename or entry.is_dir()
                    or relative.parts[0] not in ('browser', 'handles')):
                raise ValueError('Invalid project archive path.')
            if relative.parts[0] == 'handles' and (len(relative.parts) < 3 or not _ID.fullmatch(relative.parts[1])):
                raise ValueError('Invalid browser folder path in project archive.')
            if relative in files:
                raise ValueError('Duplicate project archive members.')
            files[relative] = archive.read(entry)
    if any(parent in files for relative in files for parent in relative.parents):
        raise ValueError('Project archive contains conflicting file and folder paths.')
    return files


def _registry_folders(files):
    if _LOCATION_FILE not in files:
        return []
    locations = json.loads(files[_LOCATION_FILE])
    if not isinstance(locations, list):
        raise ValueError('Invalid browser project location registry.')
    folders = []
    ids = set()
    for location in locations:
        if (not isinstance(location, dict) or not isinstance(location.get('path'), str)
                or not isinstance(location.get('label'), str) or not isinstance(location.get('id'), str)
                or not _ID.fullmatch(location['id']) or location['id'] in ids):
            raise ValueError('Invalid browser project location registry.')
        path = Path(location['path'])
        if path.parent != _STORAGE / 'handles' or not _ID.fullmatch(path.name) or str(path) != location['path']:
            raise ValueError('Invalid browser project location path.')
        if path in folders:
            raise ValueError('Duplicate browser project location.')
        ids.add(location['id'])
        folders.append(path)
    return folders


def _restore_snapshot(encoded, replace=False):
    files = _decode_snapshot(encoded)
    folders = _registry_folders(files)
    if not replace:
        existing = {}
        for path in _STORAGE.rglob('project.json'):
            relative = path.relative_to(_STORAGE)
            project = _project_location(relative)
            if project and relative.parent == project[1]:
                project_id, root = project
                existing.setdefault(project_id, set()).add(root)
        for relative, payload in files.items():
            path = _STORAGE / relative
            if (path.is_symlink() or any(parent.exists() and not parent.is_dir() for parent in path.parents)
                    or (path.exists() and (not path.is_file() or path.read_bytes() != payload))):
                raise ValueError('This archive conflicts with an existing project. Open it in a separate browser profile to preserve both.')
            project = _project_location(relative)
            if project:
                project_id, root = project
                if existing.get(project_id, {root}) != {root}:
                    raise ValueError('This project ID already belongs to a different folder. Open the archive in a separate browser profile.')
                existing[project_id] = {root}
    elif _STORAGE.exists():
        shutil.rmtree(_STORAGE)
    for relative, payload in files.items():
        path = _STORAGE / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            path.write_bytes(payload)
    for path in [_STORAGE / 'browser', *folders]:
        path.mkdir(parents=True, exist_ok=True)


def dw_operation(operation, data):
    if operation == 'schema':
        return SCHEMA
    if operation == 'examples':
        return _examples()
    if operation == 'validate':
        return validate(data['model'])
    if operation == 'locations':
        (_STORAGE / 'browser').mkdir(parents=True, exist_ok=True)
        return dict(default_id='default', locations=_STORE.locations(),
                    register_path=False, system_picker=False, mode='browser')
    if operation == 'register':
        if not isinstance(data['handle_id'], str) or not _ID.fullmatch(data['handle_id']):
            raise ValueError('Invalid directory handle ID.')
        directory = _STORAGE / 'handles' / data['handle_id']
        directory.mkdir(parents=True, exist_ok=True)
        return _STORE.register_location(str(directory), label=data['label'])
    if operation == 'projects':
        return dict(projects=_STORE.list())
    if operation == 'create':
        return _STORE.create(data['title'], data.get('draft'), data.get('location_id'))
    if operation == 'get':
        return _STORE.get(data['id'])
    if operation == 'update':
        return _STORE.update(data['id'], data['changes'])
    if operation == 'run':
        return _STORE.get_run(data['id'], data['run_id'])
    if operation == 'export':
        archive = project_zip(data['model'], data.get('provenance'))
        if data.get('project_id'):
            _STORE.save_export(data['project_id'], archive)
        return base64.b64encode(archive).decode()
    if operation == 'start':
        text, config = data['text'], data['provider']
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 30000:
            raise ValueError('Input must contain 1–30,000 characters.')
        project_id = data.get('project_id')
        run_id = _STORE.start_run(project_id, text, config) if project_id else data['operation_id']
        run = dict(text=text, provider=config, project_id=project_id, run_id=run_id, events=[], started=time.monotonic())
        _RUNS[data['operation_id']] = run
        if config.get('kind') == 'demo':
            return dict(demo=True)
        kind, url, headers, body = request_spec(config, text)
        if kind == 'gemini':
            url = url.removesuffix(':generateContent') + ':streamGenerateContent?alt=sse'
        else:
            body['stream'] = True
        headers['Accept'] = 'text/event-stream, application/json'
        if kind == 'anthropic':
            headers['anthropic-dangerous-direct-browser-access'] = 'true'
        run['assembler'] = Assembler(kind, run['events'].append)
        total, idle = timeouts(config)
        return dict(url=url, headers=headers, body=body, total_s=total, idle_s=idle)
    if operation == 'release':
        _RUNS.pop(data['operation_id'], None)
        return None
    if operation in ('demo', 'feed', 'buffered', 'finish', 'accept', 'fail'):
        run = _RUNS[data['operation_id']]
        if operation == 'demo':
            for example in _examples():
                if run['text'].strip() == example['text'].strip():
                    _prepare_result(run, example['model'], dict(provider='demo', model='fixed-synthetic-fixture',
                        prompt_version='0.1', source_sha256=hashlib.sha256(run['text'].encode()).hexdigest(), duration_s=0, usage={}))
                    return None
            raise ValueError('Offline demo accepts only the bundled synthetic examples. Select an API provider for your own text.')
        if operation == 'accept':
            result = run['result']
            if run['project_id']:
                _STORE.finish_run(run['project_id'], run['run_id'], 'succeeded', result=result)
                return {**result, 'project_run_id': run['run_id']}
            return result
        if operation == 'fail':
            if run['project_id']:
                _STORE.finish_run(run['project_id'], run['run_id'],
                    'cancelled' if data['code'] == 'cancelled' else 'failed', error_code=data['code'])
            return None
        assembler = run['assembler']
        if operation == 'feed':
            assembler.feed(data['event'])
            events, run['events'] = run['events'][:], []
            assembler.emit = run['events'].append
            return events
        if operation == 'buffered':
            text, usage = response_text(assembler.kind, data['response'])
            assembler.metadata(data['response'].get('model'), usage)
            run['buffered'] = text
            return run['events'] + [dict(type='output', text=text)]
        text = run['buffered'] if 'buffered' in run else assembler.complete()
        model = parse_response(text, run['text'])
        _prepare_result(run, model, dict(provider=assembler.kind, model=run['provider']['model'],
            response_model=assembler.model, prompt_version=PROMPT_VERSION,
            source_sha256=hashlib.sha256(run['text'].encode()).hexdigest(), duration_s=round(time.monotonic()-run['started'], 2),
            usage=assembler.usage, transport='browser-fetch', output_bytes=assembler.output_bytes,
            reasoning_bytes=assembler.reasoning_bytes))
        return None
    if operation == 'snapshot':
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(_STORAGE.rglob('*')):
                if path.is_file():
                    archive.writestr(str(path.relative_to(_STORAGE)), path.read_bytes())
        return base64.b64encode(buffer.getvalue()).decode()
    if operation in ('restore', 'reset'):
        _restore_snapshot(data['archive'], replace=operation == 'reset')
        return None
    raise ValueError('Unsupported operation.')


def dw_call(operation, payload):
    try:
        return json.dumps(dict(value=dw_operation(operation, json.loads(payload))), ensure_ascii=False, allow_nan=False)
    except Exception as error:
        return json.dumps(dict(error=str(error), code=getattr(error, 'code', 'configuration')), ensure_ascii=False)
