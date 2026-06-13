from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import numpy as np
import soundfile as sf

from app.models.project import Cell, Project


class ExportService:
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = Path(base_dir)

    def export_selected(self, project: Project) -> Path:
        project_dir = self.base_dir / "projects" / project.id
        line_order = project.export_order or [line.id for line in project.ordered_lines()]
        selected_cells = [self._selected_cell(project, line_id) for line_id in line_order]

        chunks: list[np.ndarray] = []
        sample_rate: int | None = None
        channel_shape: tuple[int, ...] | None = None
        for cell in selected_cells:
            result = cell.current_result
            if result is None:
                raise ValueError(f"Line {cell.line_id} has no selected result")
            source_path = project_dir / result.audio_path
            if not source_path.is_file():
                raise ValueError(f"Selected audio file is missing: {result.audio_path}")
            audio, current_rate = sf.read(source_path, dtype="float32", always_2d=False)
            if sample_rate is None:
                sample_rate = int(current_rate)
                channel_shape = audio.shape[1:]
            elif int(current_rate) != sample_rate:
                raise ValueError("Selected audio files must use the same sample rate")
            elif audio.shape[1:] != channel_shape:
                raise ValueError("Selected audio files must use the same channel layout")
            chunks.append(audio)

        if sample_rate is None or not chunks:
            raise ValueError("There are no selected results to export")

        exports_dir = project_dir / "exports"
        exports_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        output_path = exports_dir / f"export_{stamp}_{uuid4().hex[:8]}.wav"
        sf.write(output_path, np.concatenate(chunks, axis=0), sample_rate)
        return output_path

    @staticmethod
    def _selected_cell(project: Project, line_id: str) -> Cell:
        selected = [
            cell
            for cell in project.cells
            if cell.line_id == line_id and cell.selected_for_export
        ]
        if len(selected) != 1 or selected[0].current_result is None:
            raise ValueError(f"Line {line_id} must have exactly one selected result")
        return selected[0]
