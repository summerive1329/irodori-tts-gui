from io import BytesIO
from pathlib import Path

import numpy as np
import soundfile as sf

from app.models.project import Project
from app.services.reference_service import ReferenceService


def _wav_bytes(duration_sec: float = 0.1, sample_rate: int = 16000) -> bytes:
    buffer = BytesIO()
    samples = np.zeros(int(duration_sec * sample_rate), dtype=np.float32)
    sf.write(buffer, samples, sample_rate, format="WAV")
    return buffer.getvalue()


def test_add_reference_copies_audio_and_creates_cells(tmp_path: Path) -> None:
    project = Project.create("demo")
    project.append_lines(["one", "two"])
    service = ReferenceService(tmp_path)

    reference = service.add_reference(project, "toru", "../toru.wav", _wav_bytes())

    copied = tmp_path / "projects" / project.id / reference.copied_path
    assert copied.is_file()
    assert copied.parent.name == "references"
    assert reference.source_filename == "toru.wav"
    assert reference.duration_sec == 0.1
    assert len(project.cells) == 2


def test_add_reference_rejects_non_audio_content(tmp_path: Path) -> None:
    project = Project.create("demo")
    service = ReferenceService(tmp_path)

    try:
        service.add_reference(project, "bad", "bad.wav", b"not audio")
    except ValueError as exc:
        assert "audio" in str(exc).lower()
    else:
        raise AssertionError("Expected invalid audio to be rejected")
