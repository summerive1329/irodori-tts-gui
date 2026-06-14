from __future__ import annotations

from pathlib import Path
from typing import Callable, Protocol
from uuid import uuid4

from app.models.project import Cell, CellResult, Project, ReferenceItem
from app.services.runtime_manager import (
    GenerationArtifact,
    PreparedReference,
    RuntimeSettings,
    SamplingParameters,
)


class RuntimeBackend(Protocol):
    def prepare_reference(
        self,
        settings: RuntimeSettings,
        source_path: Path,
        cache_dir: Path,
    ) -> PreparedReference: ...

    def synthesize(
        self,
        prepared: PreparedReference,
        text: str,
        output_path: Path,
        parameters: SamplingParameters,
    ) -> GenerationArtifact: ...


StateChangeCallback = Callable[[Project, Cell], None]


class GenerationService:
    def __init__(self, runtime_manager: RuntimeBackend, base_dir: Path) -> None:
        self.runtime_manager = runtime_manager
        self.base_dir = Path(base_dir)

    def generate_all(
        self,
        project: Project,
        *,
        only_missing: bool = True,
        on_state_change: StateChangeCallback | None = None,
    ) -> Project:
        line_by_id = {line.id: line for line in project.lines}
        project_dir = self._project_dir(project)
        for reference in project.references:
            cells = [
                cell
                for cell in project.cells
                if cell.reference_id == reference.id
                and (not only_missing or cell.current_result is None)
            ]
            if not cells:
                continue
            for cell in cells:
                cell.status = "queued"
                cell.error_message = None
                self._notify(project, cell, on_state_change)
            try:
                prepared = self._prepare(project, reference)
            except Exception as exc:
                for cell in cells:
                    cell.status = "error"
                    cell.error_message = str(exc)
                    self._notify(project, cell, on_state_change)
                project.touch()
                raise
            for cell in sorted(cells, key=lambda item: line_by_id[item.line_id].order_index):
                self._generate_cell(
                    project,
                    cell,
                    prepared,
                    project_dir,
                    on_state_change=on_state_change,
                )
        project.touch()
        return project

    def regenerate_cell(
        self,
        project: Project,
        cell_id: str,
        *,
        seed: int | None = None,
        on_state_change: StateChangeCallback | None = None,
    ) -> Project:
        cell = project.get_cell(cell_id)
        reference = next(item for item in project.references if item.id == cell.reference_id)
        try:
            prepared = self._prepare(project, reference)
        except Exception as exc:
            cell.status = "error"
            cell.error_message = str(exc)
            self._notify(project, cell, on_state_change)
            raise
        self._generate_cell(
            project,
            cell,
            prepared,
            self._project_dir(project),
            seed=seed,
            on_state_change=on_state_change,
        )
        project.touch()
        return project

    def _prepare(self, project: Project, reference: ReferenceItem) -> PreparedReference:
        project_dir = self._project_dir(project)
        return self.runtime_manager.prepare_reference(
            self._settings(project),
            project_dir / reference.copied_path,
            project_dir / "latents",
        )

    def _generate_cell(
        self,
        project: Project,
        cell: Cell,
        prepared: PreparedReference,
        project_dir: Path,
        *,
        seed: int | None = None,
        on_state_change: StateChangeCallback | None = None,
    ) -> None:
        line = next(item for item in project.lines if item.id == cell.line_id)
        output_path = project_dir / "cells" / f"{cell.id}.wav"
        temporary_path = output_path.with_name(f".{cell.id}.{uuid4().hex}.wav")
        previous_result = cell.current_result
        cell.status = "generating"
        cell.error_message = None
        self._notify(project, cell, on_state_change)
        try:
            artifact = self.runtime_manager.synthesize(
                prepared,
                line.text,
                temporary_path,
                SamplingParameters(
                    num_steps=project.num_steps,
                    cfg_scale_text=project.cfg_scale_text,
                    cfg_scale_speaker=project.cfg_scale_speaker,
                    seed=seed,
                ),
            )
        except Exception as exc:
            temporary_path.unlink(missing_ok=True)
            cell.status = "error"
            cell.error_message = str(exc)
            cell.current_result = previous_result
            self._notify(project, cell, on_state_change)
            raise
        output_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path.replace(output_path)
        cell.status = "ready"
        cell.current_result = CellResult(
            audio_path=output_path.relative_to(project_dir).as_posix(),
            sample_rate=artifact.sample_rate,
            duration_sec=artifact.duration_sec,
            seed=artifact.used_seed,
        )
        self._notify(project, cell, on_state_change)

    def _project_dir(self, project: Project) -> Path:
        return self.base_dir / "projects" / project.id

    @staticmethod
    def _notify(
        project: Project,
        cell: Cell,
        callback: StateChangeCallback | None,
    ) -> None:
        project.touch()
        if callback is not None:
            callback(project, cell)

    @staticmethod
    def _settings(project: Project) -> RuntimeSettings:
        return RuntimeSettings(
            checkpoint=project.checkpoint,
            model_device=project.model_device,
            model_precision=project.model_precision,
            codec_device=project.codec_device,
            codec_precision=project.codec_precision,
        )
