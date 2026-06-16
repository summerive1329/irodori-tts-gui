from datetime import datetime, timezone
from pathlib import Path
from threading import Thread
from threading import Event
from time import monotonic, sleep
from unittest.mock import patch

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from app.main import create_app
from app.models.project import Project
from app.services.project_store import ProjectStore
from app.services.runtime_manager import GenerationArtifact, PreparedReference


class FakeRuntimeManager:
    def __init__(self) -> None:
        self.generated_cells = 0

    def prepare_reference(self, settings, source_path: Path, cache_dir: Path) -> PreparedReference:
        return PreparedReference(runtime=object(), latent_path=cache_dir / "reference.pt")

    def synthesize(self, prepared, text, output_path: Path, parameters) -> GenerationArtifact:
        self.generated_cells += 1
        output_path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(output_path, np.zeros(1200, dtype=np.float32), 24000)
        used_seed = parameters.seed if parameters.seed is not None else 1000 + self.generated_cells
        return GenerationArtifact(sample_rate=24000, duration_sec=0.05, used_seed=used_seed)


class BlockingRuntimeManager(FakeRuntimeManager):
    def __init__(self) -> None:
        super().__init__()
        self.started = Event()
        self.release = Event()
        self.allow_regeneration = Event()

    def synthesize(self, prepared, text, output_path: Path, parameters) -> GenerationArtifact:
        self.started.set()
        if parameters.seed is None:
            if not self.release.wait(timeout=3):
                raise TimeoutError("Timed out waiting to release blocked generation")
        elif not self.allow_regeneration.wait(timeout=3):
            raise TimeoutError("Timed out waiting to release blocked regeneration")
        return super().synthesize(prepared, text, output_path, parameters)


class RegenerationBlockingRuntimeManager(FakeRuntimeManager):
    def __init__(self) -> None:
        super().__init__()
        self.started = Event()
        self.allow_regeneration = Event()

    def synthesize(self, prepared, text, output_path: Path, parameters) -> GenerationArtifact:
        if parameters.seed is not None:
            self.started.set()
            if not self.allow_regeneration.wait(timeout=3):
                raise TimeoutError("Timed out waiting to release blocked regeneration")
        return super().synthesize(prepared, text, output_path, parameters)


class SecondCellBlockingRuntimeManager(FakeRuntimeManager):
    def __init__(self) -> None:
        super().__init__()
        self.second_started = Event()
        self.allow_second = Event()
        self._generation_calls = 0

    def synthesize(self, prepared, text, output_path: Path, parameters) -> GenerationArtifact:
        if parameters.seed is None:
            self._generation_calls += 1
            if self._generation_calls == 2:
                self.second_started.set()
                if not self.allow_second.wait(timeout=3):
                    raise TimeoutError("Timed out waiting to release second generation")
        return super().synthesize(prepared, text, output_path, parameters)


class ErrorRuntimeManager(FakeRuntimeManager):
    def synthesize(self, prepared, text, output_path: Path, parameters) -> GenerationArtifact:
        raise RuntimeError("boom")


class FailingRegenerationRuntimeManager(FakeRuntimeManager):
    def __init__(self) -> None:
        super().__init__()
        self.started = Event()
        self.allow_failure = Event()

    def synthesize(self, prepared, text, output_path: Path, parameters) -> GenerationArtifact:
        if parameters.seed is not None:
            self.started.set()
            if not self.allow_failure.wait(timeout=3):
                raise TimeoutError("Timed out waiting to release failed regeneration")
            raise RuntimeError("boom")
        return super().synthesize(prepared, text, output_path, parameters)


def _client(tmp_path: Path, runtime_manager: FakeRuntimeManager | None = None) -> TestClient:
    return TestClient(create_app(tmp_path, runtime_manager=runtime_manager or FakeRuntimeManager()))


def _wav_bytes(tmp_path: Path) -> bytes:
    path = tmp_path / "upload.wav"
    sf.write(path, np.zeros(800, dtype=np.float32), 16000)
    return path.read_bytes()


def _wait_for_job(client: TestClient, project_id: str, job_id: str) -> dict:
    deadline = monotonic() + 3
    while monotonic() < deadline:
        response = client.get(f"/api/projects/{project_id}/jobs/{job_id}")
        assert response.status_code == 200
        job = response.json()
        if job["status"] != "running":
            return job
        sleep(0.01)
    raise AssertionError("Generation job did not finish")


def test_projects_are_persisted_and_listed(tmp_path: Path) -> None:
    client = _client(tmp_path)
    created = client.post("/api/projects", json={"name": "demo"})

    assert created.status_code == 201
    project_id = created.json()["id"]

    restarted_client = _client(tmp_path)
    listed = restarted_client.get("/api/projects")
    loaded = restarted_client.get(f"/api/projects/{project_id}")

    assert listed.status_code == 200
    assert [(item["id"], item["name"]) for item in listed.json()] == [(project_id, "demo")]
    assert loaded.json()["name"] == "demo"


def test_list_projects_ignores_corrupt_project_files(tmp_path: Path) -> None:
    client = _client(tmp_path)
    created = client.post("/api/projects", json={"name": "demo"})
    assert created.status_code == 201

    broken_dir = tmp_path / "projects" / "broken-project"
    broken_dir.mkdir(parents=True, exist_ok=True)
    (broken_dir / "project.json").write_bytes(b"\x00" * 256)

    listed = client.get("/api/projects")

    assert listed.status_code == 200
    assert [(item["id"], item["name"]) for item in listed.json()] == [
        (created.json()["id"], "demo")
    ]
    assert next(broken_dir.glob("project.json.corrupt-*"), None) is not None


def test_mutation_response_updated_at_matches_persisted_project(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]

    with patch(
        "app.models.project._now",
        side_effect=[
            datetime(2026, 1, 1, tzinfo=timezone.utc),
            datetime(2026, 1, 2, tzinfo=timezone.utc),
        ],
    ):
        appended = client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one"]})
    loaded = client.get(f"/api/projects/{project_id}")

    assert appended.status_code == 200
    assert loaded.status_code == 200
    assert appended.json()["updated_at"] == loaded.json()["updated_at"]


def test_line_import_appends_files_and_reference_upload_creates_matrix(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]

    first = client.post(
        f"/api/projects/{project_id}/lines/import",
        files=[("files", ("lines.txt", "one\n\ntwo\n", "text/plain"))],
    )
    second = client.post(
        f"/api/projects/{project_id}/lines/import",
        files=[("files", ("more.txt", "three\n", "text/plain"))],
    )
    uploaded = client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )

    assert first.status_code == 200
    assert [line["text"] for line in second.json()["lines"]] == ["one", "two", "three"]
    assert uploaded.status_code == 200
    assert len(uploaded.json()["references"]) == 1
    assert len(uploaded.json()["cells"]) == 3


def test_generate_and_regenerate_jobs_update_only_target_cells(tmp_path: Path) -> None:
    runtime_manager = FakeRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one", "two"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )

    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    )
    assert started.status_code == 202
    assert started.json()["status"] == "running"

    job = _wait_for_job(client, project_id, started.json()["id"])
    assert job["status"] == "completed"
    assert runtime_manager.generated_cells == 2
    generated = client.get(f"/api/projects/{project_id}").json()
    assert all(cell["status"] == "ready" for cell in generated["cells"])

    first_cell_id = generated["cells"][0]["id"]
    untouched = generated["cells"][1]["current_result"]
    regenerated = client.post(
        f"/api/projects/{project_id}/cells/{first_cell_id}/regeneration-jobs",
        json={"seed": 22},
    )
    assert regenerated.status_code == 202
    _wait_for_job(client, project_id, regenerated.json()["id"])
    assert runtime_manager.generated_cells == 3
    after = client.get(f"/api/projects/{project_id}").json()
    assert after["cells"][1]["current_result"] == untouched


def test_bulk_regeneration_job_reprocesses_selected_cells(tmp_path: Path) -> None:
    runtime_manager = FakeRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one", "two"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )

    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    )
    assert started.status_code == 202
    _wait_for_job(client, project_id, started.json()["id"])

    generated = client.get(f"/api/projects/{project_id}").json()
    selected_ids = [generated["cells"][0]["id"], generated["cells"][1]["id"]]

    regen = client.post(
        f"/api/projects/{project_id}/cells/regeneration-jobs",
        json={"cell_ids": selected_ids, "seed": 55},
    )

    assert regen.status_code == 202
    _wait_for_job(client, project_id, regen.json()["id"])
    assert runtime_manager.generated_cells == 4

    refreshed = client.get(f"/api/projects/{project_id}").json()
    assert [cell["current_result"]["seed"] for cell in refreshed["cells"]] == [55, 55]


def test_regeneration_job_can_start_while_a_generation_job_is_running(tmp_path: Path) -> None:
    runtime_manager = BlockingRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one", "two"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )

    generated = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": False},
    )
    assert generated.status_code == 202
    assert runtime_manager.started.wait(timeout=1)

    project = client.get(f"/api/projects/{project_id}").json()
    regen = client.post(
        f"/api/projects/{project_id}/cells/{project['cells'][1]['id']}/regeneration-jobs",
        json={"seed": 11},
    )

    runtime_manager.release.set()
    generated_job = _wait_for_job(client, project_id, generated.json()["id"])
    runtime_manager.allow_regeneration.set()
    regeneration_job = _wait_for_job(client, project_id, regen.json()["id"])

    assert generated.json()["status"] == "running"
    assert regen.status_code == 202
    assert regen.json()["kind"] == "regenerate_cell"
    assert generated_job["status"] == "completed"
    assert regeneration_job["status"] == "completed"
    final_project = client.get(f"/api/projects/{project_id}").json()
    final_cells = {cell["id"]: cell for cell in final_project["cells"]}

    assert all(cell["status"] == "ready" for cell in final_cells.values())
    assert all(cell["error_message"] is None for cell in final_cells.values())
    assert all(cell["current_result"] is not None for cell in final_cells.values())
    assert final_cells[project["cells"][0]["id"]]["current_result"]["audio_path"].endswith(".wav")
    assert final_cells[project["cells"][1]["id"]]["current_result"]["audio_path"].endswith(".wav")
    assert final_cells[project["cells"][0]["id"]]["current_result"]["seed"] != 11
    assert final_cells[project["cells"][1]["id"]]["current_result"]["seed"] == 11


def test_project_payload_includes_running_job_count_for_generate_and_regenerate(tmp_path: Path) -> None:
    runtime_manager = BlockingRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one", "two"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )

    generated = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": False},
    )
    assert generated.status_code == 202
    assert runtime_manager.started.wait(timeout=1)

    regen = None
    try:
        project = client.get(f"/api/projects/{project_id}").json()
        assert project["generation_progress"]["running_job_count"] == 2
        assert project["generation_progress"]["has_running_jobs"] is True
        regen = client.post(
            f"/api/projects/{project_id}/cells/{project['cells'][1]['id']}/regeneration-jobs",
            json={"seed": 11},
        )
        assert regen.status_code == 202

        running = client.get(f"/api/projects/{project_id}").json()
        assert running["generation_progress"]["running_job_count"] == 3
        assert sorted(running["generation_progress"]["running_job_kinds"]) == [
            "generate_all",
            "regenerate_cell",
        ]
        assert running["generation_progress"]["active_jobs"] == [
            {
                "job_id": generated.json()["id"],
                "kind": "generate_all",
                "cell_id": project["cells"][0]["id"],
                "line_index": 1,
                "reference_label": "toru",
                "status": "generating",
            },
            {
                "job_id": regen.json()["id"],
                "kind": "regenerate_cell",
                "cell_id": project["cells"][1]["id"],
                "line_index": 2,
                "reference_label": "toru",
                "status": "queued",
            },
        ]
    finally:
        runtime_manager.release.set()
        runtime_manager.allow_regeneration.set()
        _wait_for_job(client, project_id, generated.json()["id"])
        if regen is not None:
            _wait_for_job(client, project_id, regen.json()["id"])


def test_project_payload_excludes_completed_jobs_from_running_count(tmp_path: Path) -> None:
    runtime_manager = FakeRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )

    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    ).json()
    _wait_for_job(client, project_id, started["id"])

    final_project = client.get(f"/api/projects/{project_id}").json()
    assert final_project["generation_progress"]["running_job_count"] == 0
    assert final_project["generation_progress"]["running_job_kinds"] == []
    assert final_project["generation_progress"]["has_running_jobs"] is False


def test_running_job_count_decrements_as_cells_complete(tmp_path: Path) -> None:
    runtime_manager = SecondCellBlockingRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one", "two"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )

    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    )
    assert started.status_code == 202
    assert runtime_manager.second_started.wait(timeout=1)

    running = client.get(f"/api/projects/{project_id}").json()
    assert running["generation_progress"]["running_job_count"] == 1

    runtime_manager.allow_second.set()
    _wait_for_job(client, project_id, started.json()["id"])

    final_project = client.get(f"/api/projects/{project_id}").json()
    assert final_project["generation_progress"]["running_job_count"] == 0


def test_cells_start_as_not_generated_and_become_unplayed_after_generation(tmp_path: Path) -> None:
    client = _client(tmp_path, FakeRuntimeManager())
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one"]})
    created = client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    ).json()

    assert created["cells"][0]["display_status"] == "not_generated"

    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    ).json()
    _wait_for_job(client, project_id, started["id"])

    generated = client.get(f"/api/projects/{project_id}").json()
    assert generated["cells"][0]["display_status"] == "unplayed"


def test_regenerated_cell_returns_to_unplayed_after_being_played(tmp_path: Path) -> None:
    client = _client(tmp_path, FakeRuntimeManager())
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )
    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    ).json()
    _wait_for_job(client, project_id, started["id"])
    generated = client.get(f"/api/projects/{project_id}").json()
    cell_id = generated["cells"][0]["id"]

    client.post(f"/api/projects/{project_id}/cells/{cell_id}/playback-events")
    played = client.get(f"/api/projects/{project_id}").json()
    assert played["cells"][0]["display_status"] == "played"

    regen = client.post(
        f"/api/projects/{project_id}/cells/{cell_id}/regeneration-jobs",
        json={"seed": 22},
    ).json()
    _wait_for_job(client, project_id, regen["id"])

    regenerated = client.get(f"/api/projects/{project_id}").json()
    assert regenerated["cells"][0]["display_status"] == "unplayed"


def test_loaded_project_ignores_stale_serialized_display_status() -> None:
    project = Project.model_validate(
        {
            "id": "project-1",
            "name": "demo",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
            "references": [],
            "lines": [],
            "cells": [
                {
                    "id": "cell-1",
                    "line_id": "line-1",
                    "reference_id": "ref-1",
                    "status": "ready",
                    "playback_state": "played",
                    "display_status": "not_generated",
                    "current_result": {
                        "audio_path": "cells/cell-1.wav",
                        "sample_rate": 24000,
                        "generated_at": "2026-01-01T00:00:00Z",
                        "seed": 7,
                        "duration_sec": 0.05,
                    },
                }
            ],
            "export_playlist": [],
        }
    )

    assert project.model_dump()["cells"][0]["display_status"] == "played"


def test_cell_display_status_is_generating_while_job_is_running(tmp_path: Path) -> None:
    runtime_manager = BlockingRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )

    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    )
    assert started.status_code == 202
    assert runtime_manager.started.wait(timeout=1)

    try:
        running = client.get(f"/api/projects/{project_id}").json()
        assert running["cells"][0]["display_status"] == "generating"
    finally:
        runtime_manager.release.set()
        _wait_for_job(client, project_id, started.json()["id"])


def test_queued_cells_are_distinct_from_currently_generating_cells(tmp_path: Path) -> None:
    runtime_manager = BlockingRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one", "two"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )

    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    )
    assert started.status_code == 202
    assert runtime_manager.started.wait(timeout=1)

    try:
        running = client.get(f"/api/projects/{project_id}").json()
        assert [cell["display_status"] for cell in running["cells"]] == ["generating", "queued"]
    finally:
        runtime_manager.release.set()
        _wait_for_job(client, project_id, started.json()["id"])


def test_multiple_regeneration_jobs_can_be_queued_while_busy(tmp_path: Path) -> None:
    runtime_manager = RegenerationBlockingRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one", "two", "three"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )
    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    ).json()
    _wait_for_job(client, project_id, started["id"])
    generated = client.get(f"/api/projects/{project_id}").json()

    first = client.post(
        f"/api/projects/{project_id}/cells/{generated['cells'][0]['id']}/regeneration-jobs",
        json={"seed": 22},
    )
    assert first.status_code == 202
    assert runtime_manager.started.wait(timeout=1)

    second = client.post(
        f"/api/projects/{project_id}/cells/{generated['cells'][1]['id']}/regeneration-jobs",
        json={"seed": 23},
    )

    try:
        assert second.status_code == 202
        running = client.get(f"/api/projects/{project_id}").json()
        assert running["generation_progress"]["running_job_count"] == 2
        assert [job["status"] for job in running["generation_progress"]["active_jobs"]] == [
            "generating",
            "queued",
        ]
    finally:
        runtime_manager.allow_regeneration.set()
        _wait_for_job(client, project_id, first.json()["id"])
        _wait_for_job(client, project_id, second.json()["id"])


def test_duplicate_regeneration_start_returns_conflict(tmp_path: Path) -> None:
    runtime_manager = RegenerationBlockingRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )
    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    ).json()
    _wait_for_job(client, project_id, started["id"])
    generated = client.get(f"/api/projects/{project_id}").json()
    cell_id = generated["cells"][0]["id"]

    first = client.post(
        f"/api/projects/{project_id}/cells/{cell_id}/regeneration-jobs",
        json={"seed": 11},
    )
    assert first.status_code == 202
    assert runtime_manager.started.wait(timeout=1)

    second = client.post(
        f"/api/projects/{project_id}/cells/{cell_id}/regeneration-jobs",
        json={"seed": 12},
    )

    runtime_manager.allow_regeneration.set()
    _wait_for_job(client, project_id, first.json()["id"])
    assert second.status_code == 409


def test_logs_endpoint_includes_job_rejection_and_completion(tmp_path: Path) -> None:
    runtime_manager = RegenerationBlockingRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )
    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    ).json()
    _wait_for_job(client, project_id, started["id"])
    generated = client.get(f"/api/projects/{project_id}").json()
    cell_id = generated["cells"][0]["id"]

    first = client.post(
        f"/api/projects/{project_id}/cells/{cell_id}/regeneration-jobs",
        json={"seed": 11},
    )
    assert first.status_code == 202
    assert runtime_manager.started.wait(timeout=1)

    rejected = client.post(
        f"/api/projects/{project_id}/cells/{cell_id}/regeneration-jobs",
        json={"seed": 12},
    )
    assert rejected.status_code == 409

    runtime_manager.allow_regeneration.set()
    _wait_for_job(client, project_id, first.json()["id"])

    logs = client.get(f"/api/logs?project_id={project_id}")

    assert logs.status_code == 200
    events = [entry["event"] for entry in logs.json()]
    assert "job_rejected" in events
    assert "job_completed" in events


def test_logs_are_written_to_timestamped_file(tmp_path: Path) -> None:
    logs_dir = tmp_path.parent / "logs"
    existing_log_names = {path.name for path in logs_dir.glob("app-*.log")} if logs_dir.exists() else set()

    client = _client(tmp_path, FakeRuntimeManager())
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )

    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    )
    assert started.status_code == 202
    _wait_for_job(client, project_id, started.json()["id"])

    log_files = [path for path in logs_dir.glob("app-*.log") if path.name not in existing_log_names]

    assert len(log_files) == 1
    content = log_files[0].read_text(encoding="utf-8")
    assert "job_created" in content
    assert "job_completed" in content


def test_cell_display_status_is_error_after_generation_failure(tmp_path: Path) -> None:
    client = _client(tmp_path, ErrorRuntimeManager())
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )

    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    ).json()
    job = _wait_for_job(client, project_id, started["id"])
    project = client.get(f"/api/projects/{project_id}").json()

    assert job["status"] == "failed"
    assert project["cells"][0]["display_status"] == "error"
    assert project["cells"][0]["error_message"] == "boom"


def test_playback_event_returns_400_without_audio_and_404_for_missing_cell(tmp_path: Path) -> None:
    client = _client(tmp_path, FakeRuntimeManager())
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    created = client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one"]}).json()
    line_id = created["lines"][0]["id"]
    project = client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    ).json()
    cell_id = next(cell["id"] for cell in project["cells"] if cell["line_id"] == line_id)

    missing_audio = client.post(f"/api/projects/{project_id}/cells/{cell_id}/playback-events")
    missing_cell = client.post(
        f"/api/projects/{project_id}/cells/not-a-real-cell/playback-events"
    )

    assert missing_audio.status_code == 400
    assert missing_audio.json()["detail"] == "Cell has no audio"
    assert missing_cell.status_code == 404


def test_played_cell_survives_concurrent_regeneration_persistence(tmp_path: Path) -> None:
    runtime_manager = RegenerationBlockingRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one", "two"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )
    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    ).json()
    _wait_for_job(client, project_id, started["id"])
    generated = client.get(f"/api/projects/{project_id}").json()
    first_cell_id = generated["cells"][0]["id"]
    second_cell_id = generated["cells"][1]["id"]

    regen = client.post(
        f"/api/projects/{project_id}/cells/{second_cell_id}/regeneration-jobs",
        json={"seed": 22},
    )
    assert regen.status_code == 202
    assert runtime_manager.started.wait(timeout=1)

    played = client.post(f"/api/projects/{project_id}/cells/{first_cell_id}/playback-events")
    assert played.status_code == 200

    during_regen = client.get(f"/api/projects/{project_id}").json()
    first_cell = next(cell for cell in during_regen["cells"] if cell["id"] == first_cell_id)
    second_cell = next(cell for cell in during_regen["cells"] if cell["id"] == second_cell_id)
    assert first_cell["display_status"] == "played"
    assert second_cell["display_status"] == "generating"

    runtime_manager.allow_regeneration.set()
    _wait_for_job(client, project_id, regen.json()["id"])

    final_project = client.get(f"/api/projects/{project_id}").json()
    final_first = next(cell for cell in final_project["cells"] if cell["id"] == first_cell_id)
    final_second = next(cell for cell in final_project["cells"] if cell["id"] == second_cell_id)
    assert final_first["display_status"] == "played"
    assert final_second["display_status"] == "unplayed"


def test_played_cell_survives_failed_regeneration_on_another_cell(tmp_path: Path) -> None:
    runtime_manager = FailingRegenerationRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one", "two"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )
    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    ).json()
    _wait_for_job(client, project_id, started["id"])
    generated = client.get(f"/api/projects/{project_id}").json()
    first_cell_id = generated["cells"][0]["id"]
    second_cell_id = generated["cells"][1]["id"]

    regen = client.post(
        f"/api/projects/{project_id}/cells/{second_cell_id}/regeneration-jobs",
        json={"seed": 22},
    )
    assert regen.status_code == 202
    assert runtime_manager.started.wait(timeout=1)

    played = client.post(f"/api/projects/{project_id}/cells/{first_cell_id}/playback-events")
    assert played.status_code == 200

    runtime_manager.allow_failure.set()
    failed = _wait_for_job(client, project_id, regen.json()["id"])
    final_project = client.get(f"/api/projects/{project_id}").json()
    final_first = next(cell for cell in final_project["cells"] if cell["id"] == first_cell_id)
    final_second = next(cell for cell in final_project["cells"] if cell["id"] == second_cell_id)

    assert failed["status"] == "failed"
    assert final_first["playback_state"] == "played"
    assert final_first["display_status"] == "played"
    assert final_second["display_status"] == "error"
    assert final_second["current_result"] is not None


def test_failed_regeneration_on_same_cell_preserves_latest_playback_state(tmp_path: Path) -> None:
    runtime_manager = FailingRegenerationRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )
    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    ).json()
    _wait_for_job(client, project_id, started["id"])
    generated = client.get(f"/api/projects/{project_id}").json()
    cell_id = generated["cells"][0]["id"]
    original_audio = generated["cells"][0]["current_result"]

    regen = client.post(
        f"/api/projects/{project_id}/cells/{cell_id}/regeneration-jobs",
        json={"seed": 22},
    )
    assert regen.status_code == 202
    assert runtime_manager.started.wait(timeout=1)

    played = client.post(f"/api/projects/{project_id}/cells/{cell_id}/playback-events")
    assert played.status_code == 200

    runtime_manager.allow_failure.set()
    failed = _wait_for_job(client, project_id, regen.json()["id"])
    final_project = client.get(f"/api/projects/{project_id}").json()
    final_cell = final_project["cells"][0]

    assert failed["status"] == "failed"
    assert final_cell["playback_state"] == "played"
    assert final_cell["display_status"] == "error"
    assert final_cell["current_result"] == original_audio
    assert final_cell["error_message"] == "boom"


def test_playback_event_survives_concurrent_project_update(tmp_path: Path) -> None:
    client = _client(tmp_path, FakeRuntimeManager())
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )
    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    ).json()
    _wait_for_job(client, project_id, started["id"])
    generated = client.get(f"/api/projects/{project_id}").json()
    cell_id = generated["cells"][0]["id"]

    original_save = ProjectStore.save
    save_started = Event()
    allow_save = Event()

    def blocking_save(self, project):
        if project.id == project_id and project.name == "renamed" and not save_started.is_set():
            save_started.set()
            if not allow_save.wait(timeout=3):
                raise TimeoutError("Timed out waiting to release blocked project save")
        return original_save(self, project)

    update_response: dict[str, object] = {}
    playback_response: dict[str, object] = {}

    def run_update() -> None:
        update_response["response"] = client.patch(
            f"/api/projects/{project_id}",
            json={"name": "renamed"},
        )

    def run_playback() -> None:
        playback_response["response"] = client.post(
            f"/api/projects/{project_id}/cells/{cell_id}/playback-events"
        )

    with patch("app.services.project_store.ProjectStore.save", autospec=True, side_effect=blocking_save):
        update_thread = Thread(target=run_update, daemon=True)
        playback_thread = Thread(target=run_playback, daemon=True)
        update_thread.start()
        assert save_started.wait(timeout=1)

        playback_thread.start()

        allow_save.set()
        update_thread.join(timeout=3)
        playback_thread.join(timeout=3)

    updated = update_response["response"]
    played = playback_response["response"]
    assert updated.status_code == 200
    assert played.status_code == 200
    final_project = client.get(f"/api/projects/{project_id}").json()
    final_cell = final_project["cells"][0]

    assert final_project["name"] == "renamed"
    assert final_cell["playback_state"] == "played"
    assert final_cell["display_status"] == "played"


def test_delete_project_waits_for_inflight_playback_save(tmp_path: Path) -> None:
    client = _client(tmp_path, FakeRuntimeManager())
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )
    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    ).json()
    _wait_for_job(client, project_id, started["id"])
    generated = client.get(f"/api/projects/{project_id}").json()
    cell_id = generated["cells"][0]["id"]

    original_save = ProjectStore.save
    save_started = Event()
    allow_save = Event()

    def blocking_save(self, project):
        played_cell = next((cell for cell in project.cells if cell.id == cell_id), None)
        if (
            project.id == project_id
            and played_cell is not None
            and played_cell.playback_state == "played"
            and not save_started.is_set()
        ):
            save_started.set()
            if not allow_save.wait(timeout=3):
                raise TimeoutError("Timed out waiting to release blocked playback save")
        return original_save(self, project)

    playback_response: dict[str, object] = {}
    delete_response: dict[str, object] = {}
    delete_finished = Event()

    def run_playback() -> None:
        playback_response["response"] = client.post(
            f"/api/projects/{project_id}/cells/{cell_id}/playback-events"
        )

    def run_delete() -> None:
        delete_response["response"] = client.delete(f"/api/projects/{project_id}")
        delete_finished.set()

    with patch("app.services.project_store.ProjectStore.save", autospec=True, side_effect=blocking_save):
        playback_thread = Thread(target=run_playback, daemon=True)
        delete_thread = Thread(target=run_delete, daemon=True)
        playback_thread.start()
        assert save_started.wait(timeout=1)

        delete_thread.start()
        assert not delete_finished.wait(timeout=0.2)

        allow_save.set()
        playback_thread.join(timeout=3)
        delete_thread.join(timeout=3)

    played = playback_response["response"]
    deleted = delete_response["response"]
    assert played.status_code == 200
    assert deleted.status_code == 204
    final_project = client.get(f"/api/projects/{project_id}")
    assert final_project.status_code == 404


def test_generate_all_legacy_persists_error_state_on_failure(tmp_path: Path) -> None:
    client = _client(tmp_path, ErrorRuntimeManager())
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )

    failed = client.post(
        f"/api/projects/{project_id}/generate/all",
        json={"only_missing": True},
    )
    project = client.get(f"/api/projects/{project_id}").json()

    assert failed.status_code == 500
    assert project["cells"][0]["status"] == "error"
    assert project["cells"][0]["display_status"] == "error"
    assert project["cells"][0]["error_message"] == "boom"


def test_regenerate_legacy_persists_error_state_on_failure(tmp_path: Path) -> None:
    runtime_manager = FailingRegenerationRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )
    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    ).json()
    _wait_for_job(client, project_id, started["id"])
    generated = client.get(f"/api/projects/{project_id}").json()
    cell_id = generated["cells"][0]["id"]
    original_audio = generated["cells"][0]["current_result"]
    runtime_manager.allow_failure.set()

    failed = client.post(
        f"/api/projects/{project_id}/cells/{cell_id}/regenerate",
        json={"seed": 22},
    )
    project = client.get(f"/api/projects/{project_id}").json()

    assert failed.status_code == 500
    assert project["cells"][0]["status"] == "error"
    assert project["cells"][0]["display_status"] == "error"
    assert project["cells"][0]["error_message"] == "boom"
    assert project["cells"][0]["current_result"] == original_audio


def test_playlist_endpoints_allow_duplicates_and_column_append(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one", "two"]})
    project = client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    ).json()
    reference_id = project["references"][0]["id"]
    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    ).json()
    _wait_for_job(client, project_id, started["id"])
    ready = client.get(f"/api/projects/{project_id}").json()
    first_cell_id = ready["cells"][0]["id"]

    first = client.post(
        f"/api/projects/{project_id}/playlist/items",
        json={"cell_id": first_cell_id},
    )
    second = client.post(
        f"/api/projects/{project_id}/playlist/items",
        json={"cell_id": first_cell_id},
    )
    column = client.post(
        f"/api/projects/{project_id}/playlist/references/{reference_id}"
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert [item["cell_id"] for item in column.json()["export_playlist"]] == [
        first_cell_id,
        first_cell_id,
        ready["cells"][0]["id"],
        ready["cells"][1]["id"],
    ]


def test_playlist_flow_supports_column_append_and_wav_export(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one", "two"]})
    project = client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    ).json()
    reference_id = project["references"][0]["id"]
    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    ).json()

    job = _wait_for_job(client, project_id, started["id"])
    playlist = client.post(
        f"/api/projects/{project_id}/playlist/references/{reference_id}"
    )
    exported = client.post(f"/api/projects/{project_id}/export")
    media = client.get(exported.json()["media_url"])

    assert job["status"] == "completed"
    assert len(playlist.json()["export_playlist"]) == 2
    assert exported.status_code == 200
    assert media.status_code == 200
    assert media.headers["content-type"].startswith("audio/")


def test_clear_playlist_removes_all_playlist_items(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one"]})
    project = client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    ).json()
    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    ).json()
    _wait_for_job(client, project_id, started["id"])
    ready = client.get(f"/api/projects/{project_id}").json()
    client.post(
        f"/api/projects/{project_id}/playlist/items",
        json={"cell_id": ready["cells"][0]["id"]},
    )

    cleared = client.delete(f"/api/projects/{project_id}/playlist/items")

    assert cleared.status_code == 200
    assert cleared.json()["export_playlist"] == []
    assert len(cleared.json()["lines"]) == 1
    assert len(cleared.json()["cells"]) == 1


def test_clear_lines_removes_lines_cells_and_playlist_items(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )

    cleared = client.delete(f"/api/projects/{project_id}/lines")

    assert cleared.status_code == 200
    assert cleared.json()["lines"] == []
    assert cleared.json()["cells"] == []
    assert cleared.json()["export_playlist"] == []


def test_insert_line_and_export_text_use_current_line_order(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one", "three"]})

    inserted = client.post(
        f"/api/projects/{project_id}/lines/insert",
        json={"index": 1, "text": "two"},
    )
    exported = client.get(f"/api/projects/{project_id}/lines.txt")

    assert inserted.status_code == 200
    assert [line["text"] for line in sorted(inserted.json()["lines"], key=lambda line: line["order_index"])] == [
        "one",
        "two",
        "three",
    ]
    assert exported.status_code == 200
    assert exported.text == "one\ntwo\nthree"
    assert "attachment" in exported.headers["content-disposition"]


def test_edit_and_reorder_lines(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    project = client.post(
        f"/api/projects/{project_id}/lines",
        json={"texts": ["one", "two"]},
    ).json()
    first_id, second_id = [line["id"] for line in project["lines"]]

    edited = client.patch(
        f"/api/projects/{project_id}/lines/{first_id}",
        json={"text": "changed"},
    )
    reordered = client.put(
        f"/api/projects/{project_id}/lines/order",
        json={"line_ids": [second_id, first_id]},
    )

    assert edited.status_code == 200
    assert [line["text"] for line in reordered.json()["lines"]] == ["changed", "two"]
    ordered = sorted(reordered.json()["lines"], key=lambda line: line["order_index"])
    assert [line["text"] for line in ordered] == ["two", "changed"]


def test_delete_line_reference_and_project(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    project = client.post(
        f"/api/projects/{project_id}/lines",
        json={"texts": ["one", "two"]},
    ).json()
    project = client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    ).json()
    line_id = project["lines"][0]["id"]
    reference_id = project["references"][0]["id"]
    reference_path = tmp_path / "projects" / project_id / project["references"][0]["copied_path"]

    after_line = client.delete(f"/api/projects/{project_id}/lines/{line_id}")
    after_reference = client.delete(f"/api/projects/{project_id}/references/{reference_id}")
    deleted = client.delete(f"/api/projects/{project_id}")

    assert after_line.status_code == 200
    assert len(after_line.json()["lines"]) == 1
    assert after_reference.status_code == 200
    assert after_reference.json()["references"] == []
    assert reference_path.exists() is False
    assert deleted.status_code == 204
    assert client.get(f"/api/projects/{project_id}").status_code == 404
