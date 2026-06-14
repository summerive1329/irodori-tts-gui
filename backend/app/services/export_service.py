from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import numpy as np
import soundfile as sf

from app.models.project import Project


class ExportService:
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = Path(base_dir)

    def export_playlist(self, project: Project) -> Path:
        if not project.export_playlist:
            raise ValueError("Export playlist is empty")
        project_dir = self.base_dir / "projects" / project.id
        try:
            selected_cells = [
                project.get_cell(item.cell_id) for item in project.export_playlist
            ]
        except KeyError as exc:
            raise ValueError(str(exc)) from exc

        chunks: list[np.ndarray] = []
        sample_rate: int | None = None
        channel_shape: tuple[int, ...] | None = None
        for cell in selected_cells:
            result = cell.current_result
            if result is None:
                raise ValueError(f"Playlist cell {cell.id} has no generated result")
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
            raise ValueError("Export playlist is empty")

        exports_dir = project_dir / "exports"
        exports_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        output_path = exports_dir / f"export_{stamp}_{uuid4().hex[:8]}.wav"
        sf.write(output_path, np.concatenate(chunks, axis=0), sample_rate)
        return output_path
