"""Exercise the portable Python bridge before its browser packaging step."""
import base64
import importlib.util
import io
import json
from pathlib import Path
import sys
import zipfile

import pytest

from detweave import streaming
from detweave.projects import ProjectStore
from detweave.server import examples


@pytest.fixture
def bridge(tmp_path, monkeypatch):
    monkeypatch.setitem(sys.modules, "detweave.browser_stream", streaming)
    monkeypatch.setenv("DETWEAVE_PROJECTS_DIR", str(tmp_path))
    source = Path(__file__).resolve().parents[1] / "standalone" / "bridge.py"
    spec = importlib.util.spec_from_file_location("detweave_portable_test", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module._STORAGE = tmp_path / "storage"
    module._STORE = ProjectStore(module._STORAGE / "browser")
    module._examples = examples
    return module


def archive(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as snapshot:
        for path, data in files.items():
            snapshot.writestr(path, data)
    return base64.b64encode(buffer.getvalue()).decode()


def test_staged_geometry_rollback_reopens_pending_project(bridge):
    project = bridge.dw_operation("create", {"title": "Rollback"})
    fixture = examples()[0]
    args = {"operation_id": "demo", "project_id": project["id"], "text": fixture["text"],
            "provider": {"kind": "demo"}}
    assert bridge.dw_operation("start", args) == {"demo": True}
    pending = bridge.dw_operation("snapshot", {})
    assert bridge.dw_operation("demo", args) is None
    assert bridge._STORE.get(project["id"])["draft"]["model"] is None
    assert bridge.dw_operation("accept", args)["model"] == fixture["model"]
    assert bridge._STORE.get(project["id"])["runs"][0]["status"] == "succeeded"

    bridge.dw_operation("reset", {"archive": pending})
    reopened = bridge._STORE.get(project["id"])
    assert reopened["draft"]["model"] is None
    assert reopened["exports"] == []
    bridge.dw_operation("fail", {"operation_id": "demo", "code": "cancelled"})
    assert bridge._STORE.get(project["id"])["runs"][0]["status"] == "cancelled"
    assert "demo" in bridge._RUNS
    bridge.dw_operation("release", args)
    assert bridge._RUNS == {}


def test_restore_refuses_conflicts_and_rebuilds_empty_location(bridge):
    project = bridge.dw_operation("create", {"title": "Project"})
    folder = Path(project["folder"]).name
    existing = f"browser/{folder}/project.json"
    project_data = (bridge._STORAGE / existing).read_bytes()
    unsafe_registry = json.dumps([{"id": "a" * 32, "path": "/app", "label": "invalid"}])
    cases = [
        ({"browser/unrelated.txt": "must not be written", existing: "modified"}, "conflicts"),
        ({"browser/new/./project.json": "x", "browser/new/project.json": "y"}, "Invalid project archive path"),
        ({"browser/file": "x", "browser/file/child": "y"}, "file and folder"),
        ({f"handles/{'a' * 32}/{folder}/project.json": project_data}, "already belongs to a different folder"),
        ({"browser/.locations.json": unsafe_registry}, "location path"),
    ]
    before = bridge._decode_snapshot(bridge.dw_operation("snapshot", {}))
    for files, error in cases:
        with pytest.raises(ValueError, match=error):
            bridge.dw_operation("restore", {"archive": archive(files)})
        assert bridge._decode_snapshot(bridge.dw_operation("snapshot", {})) == before

    bridge.dw_operation("register", {"handle_id": "a" * 32, "label": "Empty folder"})
    snapshot = bridge.dw_operation("snapshot", {})
    bridge.dw_operation("reset", {"archive": snapshot})
    assert bridge._STORE.locations()[1]["available"]
    assert bridge._STORE.get(project["id"]) == project
