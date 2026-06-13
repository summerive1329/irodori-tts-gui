from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import soundfile as sf

from app.models.project import Project, ReferenceItem


class ReferenceService:
    allowed_suffixes = {".wav", ".mp3", ".flac", ".ogg"}

    def __init__(self, base_dir: Path) -> None:
        self.base_dir = Path(base_dir)

    def add_reference(
        self,
        project: Project,
        label: str,
        filename: str,
        content: bytes,
    ) -> ReferenceItem:
        source_filename = Path(filename).name
        suffix = Path(source_filename).suffix.lower()
        if suffix not in self.allowed_suffixes:
            raise ValueError(f"Unsupported reference audio: {source_filename}")

        references_dir = self.base_dir / "projects" / project.id / "references"
        references_dir.mkdir(parents=True, exist_ok=True)
        destination = references_dir / f"{uuid4()}{suffix}"
        destination.write_bytes(content)
        try:
            info = sf.info(destination)
        except (RuntimeError, sf.LibsndfileError) as exc:
            destination.unlink(missing_ok=True)
            raise ValueError(f"Reference file is not readable audio: {source_filename}") from exc

        relative_path = destination.relative_to(references_dir.parent).as_posix()
        return project.add_reference(
            label=label,
            source_filename=source_filename,
            copied_path=relative_path,
            duration_sec=float(info.frames) / float(info.samplerate),
        )
