"""Local project folders with atomic snapshots and append-only prompt and run history."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import tempfile
import threading
import unicodedata
from uuid import uuid4

from .model import VALIDATOR
from .providers import PROMPT_VERSION, SYSTEM


_ID = re.compile(r"[0-9a-f]{32}")
_LOCK = threading.RLock()
_ACTIVE_RUNS = set()
_PUBLIC_USAGE = {
    "input_tokens", "output_tokens", "total_tokens", "prompt_tokens",
    "completion_tokens", "reasoning_tokens", "cached_tokens", "cache_creation_input_tokens",
    "cache_read_input_tokens", "promptTokenCount", "candidatesTokenCount", "totalTokenCount",
    "cachedContentTokenCount", "thoughtsTokenCount", "prompt_tokens_details", "completion_tokens_details",
}
_ERROR_CODES = {
    "cancelled", "configuration", "connect_timeout", "idle_timeout", "total_timeout",
    "provider_http", "provider_stream_error", "network_error", "completion_rejected",
    "incomplete_response", "protocol_error", "response_limit", "extraction_error",
    "project_storage_error", "unsafe_output", "schema", "local_busy",
}


class ProjectNotFound(LookupError):
    pass


class ProjectStorageError(OSError):
    pass


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _id(value):
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise ValueError("Invalid project or record ID.")
    return value


def _title(value):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= 100:
        raise ValueError("Project title must contain 1–100 characters.")
    title = unicodedata.normalize("NFC", value.strip())
    if any(unicodedata.category(character) in {"Cc", "Cs"} for character in title):
        raise ValueError("Project title cannot contain control characters.")
    return title


def _folder_name(title, project_id):
    safe = re.sub(r'[<>:"/\\|?*]', "-", title)
    safe = safe.encode("utf-8")[:120].decode("utf-8", errors="ignore").strip(" .")
    return (safe or "Project") + " -- " + project_id


def _text(value, limit=100_000):
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError(f"Project text must contain at most {limit:,} characters.")
    value.encode("utf-8")  # Reject unpaired surrogates before touching disk.
    return value


def _contains_key(value, key):
    """Scan generated values, not fixed dictionary field names."""
    if not isinstance(key, str) or not key:
        return False
    if isinstance(value, str):
        return key in value if len(key) >= 4 else bool(re.search(r'(?<!\w)' + re.escape(key) + r'(?!\w)', value))
    if isinstance(value, dict):
        return any(_contains_key(item, key) for item in value.values())
    if isinstance(value, list):
        return any(_contains_key(item, key) for item in value)
    return False


def model_contains_key(model, key):
    # Exempt constants only at their schema-defined paths, never in free text.
    def scan(value, path=()):
        if isinstance(value, dict):
            return any(scan(item, path + (name,)) for name, item in value.items()
                        if path or name != 'source_text')
        if isinstance(value, list):
            return any(scan(item, path + ('*',)) for item in value)
        if path == ('schema_version',) and value == '0.1': return False
        if path == ('volumes','*','shape','type') and value in ('box','tube'): return False
        if len(path) == 3 and path[0] == 'evidence' and path[2] == 'status' and value in ('stated','derived','assumed','unresolved','confirmed'): return False
        if path == ('placements','*','parent') and value == 'world': return False
        if path in (('world','material'),('volumes','*','material')) and value in (
            'G4_AIR','G4_Galactic','G4_W','G4_Pb','G4_Si','G4_Al','G4_Fe','G4_Cu',
            'G4_POLYSTYRENE','G4_SILICON_DIOXIDE','G4_CESIUM_IODIDE','G4_PbWO4'): return False
        return _contains_key(value,key)
    return scan(model)


def _public_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and abs(value) <= 10**15 and math.isfinite(value)


def _usage(value, depth=0):
    if not isinstance(value, dict):
        return {}
    clean = {}
    for key in _PUBLIC_USAGE.intersection(value):
        item = value[key]
        if _public_number(item):
            clean[key] = item
        elif depth == 0 and key in {"prompt_tokens_details", "completion_tokens_details"}:
            clean[key] = _usage(item, depth + 1)
    return clean


def public_provenance(value, api_key=None):
    if not isinstance(value, dict):
        return None
    clean = {}
    for key in ("provider", "model", "response_model", "thinking", "prompt_version", "source_sha256", "transport"):
        item = value.get(key)
        if isinstance(item, str) and re.fullmatch(r"[A-Za-z0-9._:/-]{1,300}", item):
            clean[key] = item
    for key in ("duration_s", "total_timeout_s", "idle_timeout_s", "output_bytes", "reasoning_bytes"):
        if _public_number(value.get(key)):
            clean[key] = value[key]
    if isinstance(value.get("usage"), dict):
        clean["usage"] = _usage(value["usage"])
    if api_key:
        clean = {name: item for name, item in clean.items() if not _contains_key(item, api_key)}
    return clean


def _public_provider(config):
    if not isinstance(config, dict):
        return {}
    key = config.get("api_key")
    kind = config.get("kind", "openai")
    public = {
        "provider": kind if kind in ("demo", "openai", "anthropic", "gemini") else None,
        "model": config.get("model"),
        "thinking": config.get("thinking"),
        "total_timeout_s": config.get("total_timeout_s"),
        "idle_timeout_s": config.get("idle_timeout_s"),
    }
    return public_provenance(public, key if isinstance(key, str) else None)


def _json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n").encode("utf-8")


def _check_path(path):
    if path.is_symlink():
        raise ProjectStorageError("A project file or folder is a symbolic link.")
    return path


def _read(path):
    try:
        return json.loads(_check_path(path).read_text(encoding="utf-8"))
    except (ValueError, UnicodeError) as exc:
        raise ProjectStorageError("A local project file could not be read.") from exc


def _write(path, data):
    _check_path(path)
    fd, name = tempfile.mkstemp(prefix=".saving-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


@contextmanager
def _publish_directory(path):
    _check_path(path)
    temporary = Path(tempfile.mkdtemp(prefix=".saving-", dir=path.parent))
    try:
        yield temporary
        os.rename(temporary, path)
    finally:
        shutil.rmtree(temporary, ignore_errors=True)


def _draft(value):
    if not isinstance(value, dict):
        raise ValueError("Project draft must be an object.")
    text = _text(value.get("text", ""))
    model = value.get("model")
    if model is not None and not VALIDATOR.is_valid(model):
        raise ValueError("Project draft model must match the DetWeave IR schema.")
    draft = dict(text=text, model=model, provenance=public_provenance(value.get("provenance")),
                 review_pending=value.get("review_pending") is True)
    if "json_text" in value:
        draft["json_text"] = _text(value["json_text"], 1_500_000)
    return draft


class ProjectStore:
    def __init__(self, root=None):
        configured = root if root is not None else os.environ.get("DETWEAVE_PROJECTS_DIR")
        self.root = (Path(configured).expanduser() if configured else
                     Path.home() / "Documents" / "DetWeave" / "projects").resolve()

    def _locations(self):
        locations = [dict(id="default", path=str(self.root), label="DetWeave")]
        try:
            registered = _read(self.root / ".locations.json")
        except FileNotFoundError:
            return locations
        if not isinstance(registered, list):
            raise ProjectStorageError("Invalid project location registry.")
        seen_ids = {"default"}
        seen_paths = {self.root}
        for item in registered:
            if (not isinstance(item, dict) or not isinstance(item.get("id"), str)
                    or not _ID.fullmatch(item["id"]) or item["id"] in seen_ids
                    or not isinstance(item.get("path"), str) or not isinstance(item.get("label"), str)):
                raise ProjectStorageError("Invalid project location registry.")
            path = Path(item["path"])
            if not path.is_absolute() or path in seen_paths:
                raise ProjectStorageError("Invalid project location registry.")
            seen_ids.add(item["id"])
            seen_paths.add(path)
            locations.append({key: item[key] for key in ("id", "path", "label")})
        return locations

    @staticmethod
    def _available(path):
        try:
            return path.is_dir() and path.resolve(strict=True) == path and os.access(path, os.R_OK | os.X_OK)
        except OSError:
            return False

    def locations(self):
        with _LOCK:
            return [{**item, "available": item["id"] == "default" or self._available(Path(item["path"]))}
                    for item in self._locations()]

    def register_location(self, path, *, label=None):
        path = Path(_text(os.fspath(path), 4096)).expanduser()
        if not path.is_absolute():
            raise ValueError("Choose an absolute path on the machine running DetWeave.")
        try:
            path = path.resolve(strict=True)
        except (FileNotFoundError, NotADirectoryError, RuntimeError) as exc:
            raise ValueError("The selected local folder does not exist.") from exc
        if not path.is_dir():
            raise ValueError("The selected location must be a folder.")
        if not self._available(path):
            raise ProjectStorageError("The selected local folder cannot be accessed.")
        label = _title(label) if label is not None else path.name or str(path)
        with _LOCK:
            locations = self._locations()
            for location in locations:
                registered = Path(location["path"])
                same_directory = registered == path
                if not same_directory and self._available(registered):
                    try:
                        same_directory = registered.samefile(path)
                    except OSError:
                        pass
                if same_directory:
                    return {**location, "available": True}
            location = dict(id=uuid4().hex, path=str(path), label=label)
            self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
            _write(self.root / ".locations.json", _json_bytes([*locations[1:], location]))
            return {**location, "available": True}

    def _location_path(self, location_id):
        if location_id is None or location_id == "default":
            self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
            return self.root
        _id(location_id)
        for location in self._locations():
            if location["id"] == location_id:
                path = Path(location["path"])
                if not self._available(path):
                    raise ProjectStorageError("The selected local folder is currently unavailable.")
                return path
        raise ProjectNotFound("Local project location not found.")

    def _path(self, project_id):
        _id(project_id)
        paths = []
        for location in self._locations():
            root = Path(location["path"])
            if self._available(root):
                paths.extend(path for path in root.glob("* -- " + project_id)
                             if path.is_symlink() or (path / "project.json").is_file())
        if not paths:
            raise ProjectNotFound("Local project not found.")
        if len(paths) != 1:
            raise ProjectStorageError("Multiple folders have the same local project ID.")
        return _check_path(paths[0])

    def _document(self, path):
        doc = _read(path / "project.json")
        if not isinstance(doc, dict) or doc.get("schema_version") != 1 or doc.get("id") != path.name.rsplit(" -- ", 1)[-1]:
            raise ProjectStorageError("Unsupported or damaged local project metadata.")
        return doc

    @staticmethod
    def _summary(path, doc, location_id):
        return {**{key: doc[key] for key in ("id", "title", "created_at", "updated_at")},
                "folder": str(path), "location_id": location_id}

    def list(self):
        with _LOCK:
            projects = []
            for location in self._locations():
                root = Path(location["path"])
                if not self._available(root):
                    continue
                for path in root.iterdir():
                    if path.name.startswith(".saving-") or not _ID.fullmatch(path.name.rsplit(" -- ", 1)[-1]):
                        continue
                    if " -- " in path.name and not path.is_symlink() and (path / "project.json").is_file():
                        projects.append(self._summary(path, self._document(path), location["id"]))
            return sorted(projects, key=lambda item: item["updated_at"], reverse=True)

    def create(self, title, draft=None, location_id=None):
        title = _title(title)
        initial_draft = _draft(draft if draft is not None else {})
        project_id = uuid4().hex
        created = _now()
        doc = dict(schema_version=1, id=project_id, title=title, created_at=created, updated_at=created,
                   draft=initial_draft, latest_prompt_id=None, pending_run_id=None)
        with _LOCK:
            root = self._location_path(location_id)
            path = root / _folder_name(title, project_id)
            with _publish_directory(path) as temporary:
                for directory in ("prompts", "runs", "exports"):
                    (temporary / directory).mkdir(mode=0o700)
                if initial_draft["text"]:
                    self._remember_prompt(temporary, doc, initial_draft["text"])
                _write(temporary / "project.json", _json_bytes(doc))
            return self._detail(path, doc)

    @staticmethod
    def _records(path, name):
        folder = _check_path(path / name)
        return sorted((record for record in folder.iterdir() if _ID.fullmatch(record.stem)), key=lambda p: p.name)

    @staticmethod
    def _run_path(path, run_id):
        directory = _check_path(_check_path(path / "runs") / _id(run_id))
        if not directory.is_dir():
            raise ProjectNotFound("Local run not found.")
        return directory

    def _run(self, path, run_id, include_result=False):
        directory = self._run_path(path, run_id)
        record = _read(directory / "run.json")
        outcome = _check_path(directory / "outcome")
        if outcome.exists():
            record.update(_read(outcome / "outcome.json"))
        else:
            record["status"] = "running" if directory in _ACTIVE_RUNS else "interrupted"
        if include_result:
            record["result"] = None
            if record["status"] == "succeeded":
                record["result"] = dict(model=_read(outcome / "model.json"), report=_read(outcome / "validation.json"),
                                        provenance=_read(outcome / "provenance.json"))
            if (directory / "system-prompt.txt").exists():
                record["system_prompt"] = _check_path(directory / "system-prompt.txt").read_text(encoding="utf-8")
        return record

    def _current_draft(self, path, doc):
        journal = path / 'conversation.json'
        if journal.exists():
            snapshot = _read(journal)
            current = next((r for r in snapshot['revisions'] if r['id'] == snapshot['current_revision_id']), None)
            if current:
                return dict(text=current['model']['source_text'], model=current['model'],
                            provenance=current.get('provenance'), review_pending=False)
        run_id = doc["pending_run_id"]
        seen = set()
        while run_id:
            if run_id in seen:
                raise ProjectStorageError("Local project run history contains a cycle.")
            seen.add(run_id)
            run = self._run(path, run_id)
            if run["status"] == "succeeded":
                outcome = _check_path(self._run_path(path, run_id) / "outcome")
                return dict(text=doc["draft"]["text"], model=_read(outcome / "model.json"),
                            provenance=_read(outcome / "provenance.json"), review_pending=False)
            run_id = run.get("previous_run_id")
        return doc["draft"]

    def _detail(self, path, doc):
        prompts = [_read(record) for record in self._records(path, "prompts")]
        runs = [self._run(path, directory.name) for directory in self._records(path, "runs")]
        exports = [_read(_check_path(directory) / "export.json") for directory in self._records(path, "exports")]
        location_id = next(item["id"] for item in self._locations() if Path(item["path"]) == path.parent)
        return {**self._summary(path, doc, location_id), "draft": self._current_draft(path, doc),
                "prompts": sorted(prompts, key=lambda item: item["created_at"]),
                "runs": sorted(runs, key=lambda item: item["created_at"], reverse=True),
                "exports": sorted(exports, key=lambda item: item["created_at"], reverse=True)}

    def get(self, project_id):
        with _LOCK:
            path = self._path(project_id)
            return self._detail(path, self._document(path))

    def get_run(self, project_id, run_id):
        with _LOCK:
            path = self._path(project_id)
            self._document(path)
            return self._run(path, run_id, include_result=True)

    @staticmethod
    def _remember_prompt(path, doc, text):
        folder = _check_path(path / "prompts")
        latest_id = doc["latest_prompt_id"]
        if latest_id and _read(folder / (_id(latest_id) + ".json"))["text"] == text:
            return latest_id
        prompt_id = uuid4().hex
        record = dict(id=prompt_id, text=text, created_at=_now(),
                      sha256=hashlib.sha256(text.encode("utf-8")).hexdigest())
        _write(folder / (prompt_id + ".json"), _json_bytes(record))
        doc["latest_prompt_id"] = prompt_id
        return prompt_id

    def update(self, project_id, changes):
        title = _title(changes["title"]) if "title" in changes else None
        draft = _draft(changes["draft"]) if "draft" in changes else None
        if title is None and draft is None:
            raise ValueError("Include a project title or draft to save.")
        with _LOCK:
            path = self._path(project_id)
            doc = self._document(path)
            changed = False
            if title is not None and title != doc["title"]:
                doc["title"] = title
                changed = True
            if draft is not None and (path / 'conversation.json').exists():
                from .conversation import Conversations
                Conversations(self).apply_draft(project_id, draft)
                doc = self._document(path)
                if title is not None:
                    doc['title'] = title
            if draft is not None and (draft != self._current_draft(path, doc) or doc['pending_run_id'] is not None or draft != doc['draft']):
                if draft["text"] != doc["draft"]["text"]:
                    self._remember_prompt(path, doc, draft["text"])
                doc.update(draft=draft, pending_run_id=None)
                changed = True
            if changed:
                doc["updated_at"] = _now()
                _write(path / "project.json", _json_bytes(doc))
            return self._detail(path, doc)

    def start_run(self, project_id, text, config):
        text = _text(text)
        demo = isinstance(config, dict) and config.get("kind") == "demo"
        provider = _public_provider(config)
        with _LOCK:
            path = self._path(project_id)
            doc = self._document(path)
            prompt_id = self._remember_prompt(path, doc, text)
            run_id = uuid4().hex
            directory = _check_path(path / "runs") / run_id
            created = _now()
            record = dict(id=run_id, prompt_id=prompt_id, created_at=created, finished_at=None,
                          provider=provider, prompt_version="0.1" if demo else PROMPT_VERSION, error_code=None,
                          previous_run_id=doc["pending_run_id"])
            draft = self._current_draft(path, doc)
            with _publish_directory(directory) as temporary:
                _write(temporary / "run.json", _json_bytes(record))
                if not demo:
                    _write(temporary / "system-prompt.txt", SYSTEM.encode("utf-8"))
            doc.update(draft={**draft, "text": text}, pending_run_id=run_id, updated_at=created)
            _write(path / "project.json", _json_bytes(doc))
            _ACTIVE_RUNS.add(directory)
            return run_id

    def finish_run(self, project_id, run_id, status, result=None, error_code=None):
        with _LOCK:
            path = self._path(project_id)
            directory = self._run_path(path, run_id)
            try:
                outcome = _check_path(directory / "outcome")
                if outcome.exists():
                    return
                record = dict(status=status, finished_at=_now(),
                              error_code=error_code if error_code in _ERROR_CODES else None)
                with _publish_directory(outcome) as temporary:
                    if result is not None:
                        for name, key in (("model.json", "model"), ("validation.json", "report"), ("provenance.json", "provenance")):
                            _write(temporary / name, _json_bytes(result[key]))
                    _write(temporary / "outcome.json", _json_bytes(record))
            finally:
                _ACTIVE_RUNS.discard(directory)

    def save_export(self, project_id, archive):
        with _LOCK:
            path = self._path(project_id)
            self._document(path)
            export_id = uuid4().hex
            record = dict(id=export_id, created_at=_now(), filename="DetWeave-project.zip",
                          sha256=hashlib.sha256(archive).hexdigest())
            with _publish_directory(_check_path(path / "exports") / export_id) as temporary:
                _write(temporary / record["filename"], archive)
                _write(temporary / "export.json", _json_bytes(record))


def persisted_result(result, config):
    """Drop out-of-schema output and credential echoes before writing a completed run."""
    if not isinstance(result, dict) or not VALIDATOR.is_valid(result.get("model")):
        return None, "schema"
    if any(issue["code"] in ("schema", "nonfinite") for issue in result["report"]["issues"]):
        return None, "schema"
    key = config.get("api_key")
    if isinstance(key, str) and key:
        model_without_source = {name: item for name, item in result["model"].items() if name != "source_text"}
        if model_contains_key(model_without_source, key):
            return None, "unsafe_output"
    return {**result, "provenance": public_provenance(result["provenance"], key if isinstance(key, str) else None)}, None
