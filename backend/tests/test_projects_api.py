from datetime import datetime, timezone
from pathlib import Path
from threading import Event
from time import monotonic, sleep
from unittest.mock import patch

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from app.main import create_app
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
        assert project["generation_progress"]["running_job_count"] == 1
        assert project["generation_progress"]["has_running_jobs"] is True
        regen = client.post(
            f"/api/projects/{project_id}/cells/{project['cells'][1]['id']}/regeneration-jobs",
            json={"seed": 11},
        )
        assert regen.status_code == 202

        running = client.get(f"/api/projects/{project_id}").json()
        assert running["generation_progress"]["running_job_count"] == 2
        assert sorted(running["generation_progress"]["running_job_kinds"]) == [
            "generate_all",
            "regenerate_cell",
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
