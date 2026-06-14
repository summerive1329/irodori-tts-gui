from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.models.project import CellResult, Project
from app.services.export_service import ExportService


def _write_wav(path: Path, value: float, frames: int = 100, sample_rate: int = 1000) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, np.full(frames, value, dtype=np.float32), sample_rate)


def _ready_project(tmp_path: Path) -> Project:
    project = Project.create("demo")
    project.append_lines(["one", "two"])
    reference = project.add_reference("toru", "toru.wav", "references/toru.wav", 1.0)
    for index, line in enumerate(project.ordered_lines()):
        cell = project.find_cell(line.id, reference.id)
        relative_path = f"cells/{cell.id}.wav"
        _write_wav(tmp_path / "projects" / project.id / relative_path, index + 0.25)
        cell.current_result = CellResult(
            audio_path=relative_path,
            sample_rate=1000,
            duration_sec=0.1,
            seed=index,
        )
    return project


def test_export_playlist_concatenates_in_playlist_order_with_duplicates(tmp_path: Path) -> None:
    project = _ready_project(tmp_path)
    project.append_playlist_item(project.cells[1].id)
    project.append_playlist_item(project.cells[0].id)
    project.append_playlist_item(project.cells[1].id)
    service = ExportService(tmp_path)

    output = service.export_playlist(project)

    audio, sample_rate = sf.read(output, dtype="float32")
    assert sample_rate == 1000
    assert audio.shape == (300,)
    assert float(audio[:100].mean()) == pytest.approx(1.0, abs=0.01)
    assert float(audio[100:200].mean()) == pytest.approx(0.25, abs=0.01)
    assert float(audio[200:].mean()) == pytest.approx(1.0, abs=0.01)


def test_export_playlist_requires_at_least_one_item(tmp_path: Path) -> None:
    project = Project.create("demo")
    project.append_lines(["one"])
    project.add_reference("toru", "toru.wav", "references/toru.wav", 1.0)
    service = ExportService(tmp_path)

    with pytest.raises(ValueError, match="empty"):
        service.export_playlist(project)


def test_export_playlist_rejects_mixed_sample_rates(tmp_path: Path) -> None:
    project = _ready_project(tmp_path)
    second_line = project.ordered_lines()[1]
    second_cell = next(cell for cell in project.cells if cell.line_id == second_line.id)
    second_path = tmp_path / "projects" / project.id / second_cell.current_result.audio_path
    _write_wav(second_path, 0.5, sample_rate=2000)
    project.append_playlist_item(project.cells[0].id)
    project.append_playlist_item(project.cells[1].id)
    service = ExportService(tmp_path)

    with pytest.raises(ValueError, match="sample rate"):
        service.export_playlist(project)
