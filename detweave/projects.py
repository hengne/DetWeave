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
    "project_storage_error", "unsafe_output", "schema",
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
    if isinstance(value, str):
        return value == key or (len(key) >= 8 and key in value)
    if isinstance(value, dict):
        return any(_contains_key(name, key) or _contains_key(item, key) for name, item in value.items())
    if isinstance(value, list):
        return any(_contains_key(item, key) for item in value)
    return False


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

    def _path(self, project_id):
        _id(project_id)
        paths = list(self.root.glob("* -- " + project_id))
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
    def _summary(path, doc):
        return {**{key: doc[key] for key in ("id", "title", "created_at", "updated_at")}, "folder": str(path)}

    def list(self):
        with _LOCK:
            if not self.root.exists():
                return []
            projects = []
            for path in self.root.iterdir():
                if path.name.startswith(".saving-") or not _ID.fullmatch(path.name.rsplit(" -- ", 1)[-1]):
                    continue
                if " -- " in path.name and path.is_dir() and not path.is_symlink():
                    projects.append(self._summary(path, self._document(path)))
            return sorted(projects, key=lambda item: item["updated_at"], reverse=True)

    def create(self, title, draft=None):
        title = _title(title)
        initial_draft = _draft(draft if draft is not None else {})
        project_id = uuid4().hex
        created = _now()
        doc = dict(schema_version=1, id=project_id, title=title, created_at=created, updated_at=created,
                   draft=initial_draft, latest_prompt_id=None, pending_run_id=None)
        with _LOCK:
            self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
            path = self.root / _folder_name(title, project_id)
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

    def _run(self, path, run_id, include_result=False):
        directory = _check_path(_check_path(path / "runs") / _id(run_id))
        if not directory.is_dir():
            raise ProjectNotFound("Local run not found.")
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
        run_id = doc["pending_run_id"]
        if run_id:
            run = self._run(path, run_id, include_result=True)
            if run["result"]:
                result = run["result"]
                return dict(text=doc["draft"]["text"], model=result["model"], provenance=result["provenance"], review_pending=False)
        return doc["draft"]

    def _detail(self, path, doc):
        prompts = [_read(record) for record in self._records(path, "prompts")]
        runs = [self._run(path, directory.name) for directory in self._records(path, "runs")]
        exports = [_read(_check_path(directory) / "export.json") for directory in self._records(path, "exports")]
        return {**self._summary(path, doc), "draft": self._current_draft(path, doc),
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
            if draft is not None and draft != self._current_draft(path, doc):
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
                          provider=provider, prompt_version="0.1" if demo else PROMPT_VERSION, error_code=None)
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
            directory = _check_path(_check_path(path / "runs") / _id(run_id))
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
    if any(issue["code"] in ("schema", "nonfinite") for issue in result["report"]["issues"]):
        return None, "schema"
    key = config.get("api_key")
    if isinstance(key, str) and key:
        model_without_source = {name: item for name, item in result["model"].items() if name != "source_text"}
        if _contains_key(model_without_source, key) or _contains_key(result["report"], key):
            return None, "unsafe_output"
    return {**result, "provenance": public_provenance(result["provenance"], key if isinstance(key, str) else None)}, None
