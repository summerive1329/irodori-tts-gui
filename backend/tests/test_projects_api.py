from pathlib import Path

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
        return GenerationArtifact(sample_rate=24000, duration_sec=0.05, used_seed=11)


def _client(tmp_path: Path, runtime_manager: FakeRuntimeManager | None = None) -> TestClient:
    return TestClient(create_app(tmp_path, runtime_manager=runtime_manager or FakeRuntimeManager()))


def _wav_bytes(tmp_path: Path) -> bytes:
    path = tmp_path / "upload.wav"
    sf.write(path, np.zeros(800, dtype=np.float32), 16000)
    return path.read_bytes()


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


def test_generate_regenerate_select_and_export_flow(tmp_path: Path) -> None:
    runtime_manager = FakeRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one", "two"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )

    generated = client.post(
        f"/api/projects/{project_id}/generate/all",
        json={"only_missing": True},
    )
    assert generated.status_code == 200
    assert runtime_manager.generated_cells == 2
    assert all(cell["status"] == "ready" for cell in generated.json()["cells"])

    first_cell_id = generated.json()["cells"][0]["id"]
    regenerated = client.post(
        f"/api/projects/{project_id}/cells/{first_cell_id}/regenerate",
        json={"seed": 22},
    )
    assert regenerated.status_code == 200
    assert runtime_manager.generated_cells == 3

    project = regenerated.json()
    for line in project["lines"]:
        cell = next(item for item in project["cells"] if item["line_id"] == line["id"])
        selected = client.put(
            f"/api/projects/{project_id}/cells/{cell['id']}/selection",
            json={"selected": True},
        )
        assert selected.status_code == 200

    exported = client.post(f"/api/projects/{project_id}/export")

    assert exported.status_code == 200
    media_url = exported.json()["media_url"]
    media = client.get(media_url)
    assert media.status_code == 200
    assert media.headers["content-type"].startswith("audio/")


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
