import json
from contextlib import ExitStack
from pathlib import Path
import socket
import struct
import threading
import time
from types import SimpleNamespace
import urllib.error
import zipfile

import pytest

from detweave import folder_picker, server as workbench
from detweave.model import validate
from detweave.projects import ProjectStore
from detweave.streaming import RunError
from test_http import request, server as http_server


@pytest.fixture
def project_root(tmp_path, monkeypatch):
    root = tmp_path / "project library"
    monkeypatch.setenv("DETWEAVE_PROJECTS_DIR", str(root))
    return root


def api(server, path, body=None):
    with request(server + path, body) as response:
        return json.load(response)


def contents(folder):
    return b"\n".join(path.read_bytes() for path in folder.rglob("*") if path.is_file())


def test_project_title_history_reload_and_containment(http_server, project_root, tmp_path):
    assert api(http_server, "/api/projects") == {"projects": []}
    title = "../粒子 / detector"
    first = api(http_server, "/api/projects", {"title": title})
    second = api(http_server, "/api/projects", {"title": title})
    first_path = Path(first["folder"])
    assert first["id"] != second["id"]
    assert first["title"] == second["title"] == title
    assert first_path.parent == project_root
    assert "粒子" in first_path.name

    path = "/api/projects/" + first["id"]
    for text in ("first", "second", "second", "first"):
        api(http_server, path, {"draft": {"text": text}})
    saved = api(http_server, path, {"title": "新标题"})
    assert saved["folder"] == first["folder"]
    assert saved["title"] == "新标题"
    assert [prompt["text"] for prompt in saved["prompts"]] == ["first", "second", "first"]
    assert ProjectStore(project_root).get(first["id"]) == saved

    for invalid in ("%2e%2e", "a" * 32):
        with pytest.raises(urllib.error.HTTPError) as error:
            api(http_server, "/api/projects/" + invalid)
        assert error.value.code in (400, 404)

    external = tmp_path / "external"
    external.mkdir()
    symlink_id = "b" * 32
    (project_root / ("outside -- " + symlink_id)).symlink_to(external)
    with pytest.raises(urllib.error.HTTPError) as error:
        api(http_server, "/api/projects/" + symlink_id, {"draft": {"text": "no write"}})
    assert error.value.code == 507
    assert list(external.iterdir()) == []


def test_registered_parent_persists_and_recovers_when_available(http_server, project_root, tmp_path):
    default_project = api(http_server, "/api/projects", {"title": "Original default project"})
    locations_api = "/api/projects/locations"
    default = api(http_server, locations_api)
    assert default["default_id"] == default_project["location_id"] == "default"
    assert Path(default["locations"][0]["path"]) == project_root

    selected = tmp_path / "beam test folder"
    selected.mkdir()
    location = api(http_server, locations_api, {"path": str(selected)})
    assert location["available"]
    assert api(http_server, locations_api, {"path": str(selected) + "/."}) == location
    alternate_case = selected.with_name("BEAM TEST FOLDER")
    if alternate_case.is_dir() and alternate_case.samefile(selected):
        assert api(http_server, locations_api, {"path": str(alternate_case)}) == location
        assert len(ProjectStore().locations()) == 2
    project = api(http_server, "/api/projects", {"title": "外置项目", "location_id": location["id"]})
    assert project["location_id"] == location["id"]
    assert Path(project["folder"]).parent == selected
    project_api = "/api/projects/" + project["id"]
    updated = api(http_server, project_api, {"draft": {"text": "write into the selected parent"}})
    assert ProjectStore().get(project["id"]) == updated
    assert {entry["id"] for entry in ProjectStore().list()} == {default_project["id"], project["id"]}

    moved = selected.with_name("disconnected volume")
    selected.rename(moved)
    assert not ProjectStore().locations()[1]["available"]
    assert [entry["id"] for entry in api(http_server, "/api/projects")["projects"]] == [default_project["id"]]
    with pytest.raises(urllib.error.HTTPError) as unavailable:
        api(http_server, "/api/projects", {"title": "Do not recreate missing folder", "location_id": location["id"]})
    assert unavailable.value.code == 507
    assert not selected.exists()
    moved.rename(selected)
    assert api(http_server, project_api) == updated


def test_project_location_requires_existing_absolute_directory(http_server, tmp_path):
    regular_file = tmp_path / "file.txt"
    regular_file.write_text("file")
    for invalid in ("relative/project", str(tmp_path / "missing"), str(regular_file)):
        with pytest.raises(urllib.error.HTTPError) as error:
            api(http_server, "/api/projects/locations", {"path": invalid})
        assert error.value.code == 400
    with pytest.raises(urllib.error.HTTPError) as error:
        api(http_server, "/api/projects", {"title": "Unknown location", "location_id": "a" * 32})
    assert error.value.code == 404


def test_desktop_location_picker_capability_cancel_and_registration(http_server, project_root, tmp_path, monkeypatch):
    path = "/api/projects/locations"
    monkeypatch.setattr(workbench, "picker_backend", lambda: None)
    assert not api(http_server, path)["capabilities"]["system_picker"]
    with pytest.raises(urllib.error.HTTPError) as unavailable:
        api(http_server, path + "/pick", {})
    assert unavailable.value.code == 501

    monkeypatch.setattr(workbench, "picker_backend", lambda: "macos")
    monkeypatch.setattr(workbench, "pick_folder", lambda backend: None)
    assert api(http_server, path)["capabilities"]["system_picker"]
    assert api(http_server, path + "/pick", {}) == {"cancelled": True}
    assert not project_root.exists()

    selected = tmp_path / "几何 & test"
    selected.mkdir()
    monkeypatch.setattr(workbench, "pick_folder", lambda backend: str(selected))
    location = api(http_server, path + "/pick", {})
    assert location["path"] == str(selected)
    assert ProjectStore().locations()[-1] == location
    with workbench.FOLDER_PICKER_SLOT, pytest.raises(urllib.error.HTTPError) as busy:
        api(http_server, path + "/pick", {})
    assert busy.value.code == 409


def test_macos_picker_passes_fixed_argv_and_preserves_path(monkeypatch):
    selected = "/Users/local/项目 & calculations\n"

    def run(command, **kwargs):
        assert command == ["/usr/bin/osascript", "-e", folder_picker.MAC_SCRIPT]
        assert kwargs["check"] and not kwargs.get("shell")
        return SimpleNamespace(stdout=(selected + "\n").encode())

    monkeypatch.setattr(folder_picker.subprocess, "run", run)
    assert folder_picker.pick_folder("macos") == selected


def test_successful_stream_and_export_save_only_public_data(http_server, project_root, monkeypatch):
    first = api(http_server, "/api/projects", {"title": "ECAL design"})
    fixture = workbench.examples()[0]
    key = "sensitive-example-key"
    reasoning = "temporary reasoning channel"

    def extraction(text, provider, emit=None, control=None):
        assert provider["api_key"] == key
        stored = ProjectStore(project_root).get(first["id"])
        assert stored["prompts"][0]["text"] == text
        assert stored["runs"][0]["status"] == "running"
        emit({"type": "reasoning", "text": reasoning})
        return dict(model=fixture["model"], report=validate(fixture["model"]), provenance={
            "provider": "openai", "model": "test", "prompt_version": "0.2", "api_key": key,
            "reasoning": reasoning, "usage": {"total_tokens": 9, "secret_ledger": 12},
        })

    monkeypatch.setattr(workbench, "run_extraction", extraction)
    with request(http_server + "/api/extract/stream", {
        "project_id": first["id"], "text": fixture["text"],
        "provider": {"kind": "openai", "model": "test", "api_key": key, "base_url": "https://example.test/private"},
    }) as response:
        events = [json.loads(line) for line in response]
    assert any(event.get("text") == reasoning for event in events)
    result = events[-1]["result"]
    assert result["provenance"]["usage"] == {"total_tokens": 9}
    assert result["report"]["ready"]

    project_path = "/api/projects/" + first["id"]
    stored = api(http_server, project_path)
    run = api(http_server, project_path + "/runs/" + result["project_run_id"])
    assert run["status"] == "succeeded"
    assert run["result"]["model"] == stored["draft"]["model"] == fixture["model"]
    assert run["result"]["report"] == result["report"]
    assert "Schema follows:" in run["system_prompt"]
    with request(http_server + "/api/export", {
        "project_id": first["id"], "model": result["model"],
        "provenance": {**result["provenance"], "api_key": key, "reasoning": reasoning},
    }) as response:
        archive = response.read()
    folder = Path(first["folder"])
    exports = api(http_server, project_path)["exports"]
    assert len(exports) == 1
    saved_zip = folder / "exports" / exports[0]["id"] / exports[0]["filename"]
    assert saved_zip.read_bytes() == archive
    with zipfile.ZipFile(saved_zip) as saved:
        assert "DetWeave/geometry.gdml" in saved.namelist()
    disk = contents(folder)
    for secret in (key, reasoning, "example.test/private", "secret_ledger"):
        assert secret.encode() not in disk


def test_failed_and_cancelled_streams_preserve_submitted_prompts(http_server, project_root, monkeypatch):
    project = api(http_server, "/api/projects", {"title": "Runs"})
    project_path = "/api/projects/" + project["id"]
    started = threading.Event()

    def extraction(text, provider, emit=None, control=None):
        if text == "failed prompt":
            raise RunError("transient upstream error", "provider_http")
        started.set()
        until = time.monotonic() + 8
        while time.monotonic() < until:
            control.check()
            time.sleep(0.025)
        pytest.fail("disconnect should cancel model work")

    monkeypatch.setattr(workbench, "run_extraction", extraction)
    body = {"project_id": project["id"], "provider": {"kind": "openai"}, "text": "failed prompt"}
    with request(http_server + "/api/extract/stream", body) as response:
        assert [json.loads(line) for line in response][-1]["code"] == "provider_http"

    body["text"] = "cancelled prompt"
    raw_body = json.dumps(body).encode()
    port = int(http_server.rsplit(":", 1)[1])
    with socket.create_connection(("127.0.0.1", port), timeout=3) as conn:
        conn.sendall((f"POST /api/extract/stream HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n"
                      f"X-DetWeave: 1\r\nContent-Type: application/json\r\nContent-Length: {len(raw_body)}\r\n\r\n").encode() + raw_body)
        assert b"200" in conn.recv(4096)
        assert started.wait(3)
        conn.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))

    until = time.monotonic() + 5
    while time.monotonic() < until:
        stored = api(http_server, project_path)
        if stored["runs"][0]["status"] == "cancelled":
            break
        time.sleep(0.05)
    assert [run["status"] for run in stored["runs"]] == ["cancelled", "failed"]
    assert [run["error_code"] for run in stored["runs"]] == ["cancelled", "provider_http"]
    assert [prompt["text"] for prompt in stored["prompts"]] == ["failed prompt", "cancelled prompt"]
    assert stored["draft"]["text"] == "cancelled prompt"
    assert stored["draft"]["model"] is None


def test_concurrent_draft_edit_survives_older_run_completion(project_root):
    store = ProjectStore()
    project_id = store.create("Prototype")["id"]
    fixture = workbench.examples()[0]
    run_id = store.start_run(project_id, fixture["text"], {"kind": "demo"})
    store.update(project_id, {"draft": {"text": "the newer edit"}})
    store.finish_run(project_id, run_id, "succeeded",
                     result=dict(model=fixture["model"], report=validate(fixture["model"]), provenance=None))
    assert store.get(project_id)["draft"]["text"] == "the newer edit"
    assert store.get_run(project_id, run_id)["result"]["model"] == fixture["model"]


def test_newer_failed_run_preserves_concurrent_success_as_current_model(project_root):
    store = ProjectStore()
    project_id = store.create("Parallel runs")["id"]
    fixture = workbench.examples()[0]
    first = store.start_run(project_id, fixture["text"], {"kind": "demo"})
    second = store.start_run(project_id, "later submission", {"kind": "demo"})

    store.finish_run(project_id, first, "succeeded",
                     result=dict(model=fixture["model"], report=validate(fixture["model"]), provenance=None))
    store.finish_run(project_id, second, "failed", error_code="configuration")

    project = ProjectStore().get(project_id)
    assert project["draft"]["text"] == "later submission"
    assert project["draft"]["model"] == fixture["model"]
    assert [run["status"] for run in project["runs"]] == ["failed", "succeeded"]


def test_storage_failure_prevents_provider_call(http_server, project_root, monkeypatch):
    project = api(http_server, "/api/projects", {"title": "Read-only project"})
    monkeypatch.setattr(workbench, "run_extraction", lambda *args: pytest.fail("provider called before saving"))

    def disk_full(*args):
        raise OSError("simulated disk full")

    monkeypatch.setattr("detweave.projects._write", disk_full)
    with pytest.raises(urllib.error.HTTPError) as error:
        api(http_server, "/api/extract/stream", {"project_id": project["id"], "text": "record first"})
    assert error.value.code == 507
    assert json.load(error.value)["code"] == "project_storage_error"


def test_busy_provider_slots_preserve_submitted_project_prompt(http_server, project_root):
    project = api(http_server, "/api/projects", {"title": "Queued geometry"})
    with ExitStack() as slots:
        for _ in range(3):
            assert workbench.SLOTS.acquire(timeout=3)
            slots.callback(workbench.SLOTS.release)
        with pytest.raises(urllib.error.HTTPError) as error:
            api(http_server, "/api/extract/stream", {"project_id": project["id"], "text": "retry this prompt"})
        assert error.value.code == 429
        assert json.load(error.value)["code"] == "local_busy"
    stored = ProjectStore().get(project["id"])
    assert stored["prompts"][0]["text"] == "retry this prompt"
    assert stored["runs"][0]["status"] == "failed"
    assert stored["runs"][0]["error_code"] == "local_busy"


def test_credential_echo_is_not_persisted(http_server, project_root, monkeypatch):
    project = api(http_server, "/api/projects", {"title": "Clean outputs"})
    fixture = workbench.examples()[0]
    model = fixture["model"]
    key = "unpublishable-provider-key"
    model["notes"].append("Bearer " + key)
    monkeypatch.setattr(workbench, "run_extraction", lambda *args: {
        "model": model, "report": validate(model), "provenance": {},
    })
    with pytest.raises(urllib.error.HTTPError) as error:
        api(http_server, "/api/extract", {
            "project_id": project["id"], "text": fixture["text"], "provider": {"kind": "openai", "api_key": key},
        })
    assert error.value.code == 502
    stored = ProjectStore().get(project["id"])
    assert stored["runs"][0]["error_code"] == "unsafe_output"
    assert stored["draft"]["model"] is None
    assert key.encode() not in contents(Path(project["folder"]))
