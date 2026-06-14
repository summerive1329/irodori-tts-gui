from pathlib import Path

from app.models.project import CellResult, Project
from app.services.generation_service import GenerationService
from app.services.runtime_manager import GenerationArtifact, PreparedReference


class FakeRuntimeManager:
    def __init__(self) -> None:
        self.prepared: list[Path] = []
        self.generated: list[tuple[str, Path]] = []

    def prepare_reference(self, settings, source_path: Path, cache_dir: Path) -> PreparedReference:
        self.prepared.append(source_path)
        return PreparedReference(runtime=object(), latent_path=cache_dir / "ref.pt")

    def synthesize(self, prepared, text, output_path: Path, parameters) -> GenerationArtifact:
        self.generated.append((text, output_path))
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"wav")
        return GenerationArtifact(sample_rate=24000, duration_sec=1.0, used_seed=7)


class FailingRuntimeManager(FakeRuntimeManager):
    def synthesize(self, prepared, text, output_path: Path, parameters) -> GenerationArtifact:
        raise RuntimeError("synthesis failed")


def _project() -> Project:
    project = Project.create("demo")
    project.append_lines(["one", "two"])
    project.add_reference("toru", "toru.wav", "references/toru.wav", 1.0)
    project.add_reference("lize", "lize.wav", "references/lize.wav", 1.0)
    return project


def test_generate_all_prepares_each_reference_once_and_fills_every_cell(tmp_path: Path) -> None:
    project = _project()
    manager = FakeRuntimeManager()
    service = GenerationService(manager, tmp_path)

    service.generate_all(project)

    assert len(manager.prepared) == 2
    assert len(manager.generated) == 4
    assert all(cell.status == "ready" for cell in project.cells)
    assert all(cell.current_result is not None for cell in project.cells)


def test_regenerate_updates_only_the_target_cell(tmp_path: Path) -> None:
    project = _project()
    untouched = project.cells[1]
    untouched.current_result = CellResult(
        audio_path="cells/original.wav",
        sample_rate=24000,
        duration_sec=1.0,
        seed=1,
    )
    manager = FakeRuntimeManager()
    service = GenerationService(manager, tmp_path)

    service.regenerate_cell(project, project.cells[0].id)

    assert len(manager.generated) == 1
    assert project.cells[0].current_result is not None
    assert untouched.current_result.audio_path == "cells/original.wav"


def test_failed_regenerate_preserves_the_previous_target_result(tmp_path: Path) -> None:
    project = _project()
    target = project.cells[0]
    target.current_result = CellResult(
        audio_path="cells/previous.wav",
        sample_rate=24000,
        duration_sec=1.0,
        seed=1,
    )
    service = GenerationService(FailingRuntimeManager(), tmp_path)

    try:
        service.regenerate_cell(project, target.id)
    except RuntimeError:
        pass

    assert target.status == "error"
    assert target.current_result is not None
    assert target.current_result.audio_path == "cells/previous.wav"


def test_generate_all_reports_cell_state_transitions(tmp_path: Path) -> None:
    project = Project.create("demo")
    project.append_lines(["one"])
    project.add_reference("toru", "toru.wav", "references/toru.wav", 1.0)
    transitions: list[str] = []
    service = GenerationService(FakeRuntimeManager(), tmp_path)

    service.generate_all(
        project,
        on_state_change=lambda _project, cell: transitions.append(cell.status),
    )

    assert transitions == ["queued", "generating", "ready"]
