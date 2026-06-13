from __future__ import annotations

import hashlib
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


@dataclass(frozen=True)
class RuntimeSettings:
    checkpoint: str
    model_device: str
    model_precision: str
    codec_device: str
    codec_precision: str


@dataclass(frozen=True)
class SamplingParameters:
    num_steps: int
    cfg_scale_text: float
    cfg_scale_speaker: float
    seed: int | None = None


@dataclass(frozen=True)
class PreparedReference:
    runtime: object
    latent_path: Path


@dataclass(frozen=True)
class GenerationArtifact:
    sample_rate: int
    duration_sec: float
    used_seed: int


RuntimeFactory = Callable[[RuntimeSettings], object]
ReferenceEncoder = Callable[[object, Path, Path], Path]
Synthesizer = Callable[
    [object, str, Path, Path, SamplingParameters],
    GenerationArtifact,
]


class RuntimeManager:
    def __init__(
        self,
        factory: RuntimeFactory | None = None,
        reference_encoder: ReferenceEncoder | None = None,
        synthesizer: Synthesizer | None = None,
    ) -> None:
        self._factory = factory or _default_runtime_factory
        self._reference_encoder = reference_encoder or _default_reference_encoder
        self._synthesizer = synthesizer or _default_synthesizer
        self._runtimes: dict[RuntimeSettings, object] = {}
        self._prepared_references: dict[tuple[RuntimeSettings, str, int, int], Path] = {}

    def get_runtime(self, settings: RuntimeSettings) -> object:
        if settings not in self._runtimes:
            self._runtimes[settings] = self._factory(settings)
        return self._runtimes[settings]

    def prepare_reference(
        self,
        settings: RuntimeSettings,
        source_path: Path,
        cache_dir: Path,
    ) -> PreparedReference:
        source_path = Path(source_path).resolve()
        stat = source_path.stat()
        cache_key = (settings, str(source_path), stat.st_mtime_ns, stat.st_size)
        runtime = self.get_runtime(settings)
        cached = self._prepared_references.get(cache_key)
        if cached is not None and cached.is_file():
            return PreparedReference(runtime=runtime, latent_path=cached)

        digest = hashlib.sha256(repr(cache_key).encode("utf-8")).hexdigest()[:20]
        latent_path = Path(cache_dir) / f"{digest}.pt"
        if not latent_path.is_file():
            latent_path.parent.mkdir(parents=True, exist_ok=True)
            self._reference_encoder(runtime, source_path, latent_path)
        self._prepared_references[cache_key] = latent_path
        return PreparedReference(runtime=runtime, latent_path=latent_path)

    def synthesize(
        self,
        prepared: PreparedReference,
        text: str,
        output_path: Path,
        parameters: SamplingParameters,
    ) -> GenerationArtifact:
        return self._synthesizer(
            prepared.runtime,
            text,
            prepared.latent_path,
            output_path,
            parameters,
        )


def _ensure_irodori_importable() -> None:
    repository_root = Path(__file__).resolve().parents[3]
    source_dir = repository_root / "vendor" / "Irodori-TTS"
    if not source_dir.is_dir():
        raise RuntimeError(
            "Irodori-TTS submodule is missing. Run: git submodule update --init --recursive"
        )
    source_text = str(source_dir)
    if source_text not in sys.path:
        sys.path.insert(0, source_text)


def _default_runtime_factory(settings: RuntimeSettings) -> object:
    _ensure_irodori_importable()
    try:
        from huggingface_hub import hf_hub_download
        from irodori_tts.inference_runtime import InferenceRuntime, RuntimeKey
    except ImportError as exc:
        raise RuntimeError(
            "Irodori-TTS dependencies are not installed in the backend Python environment"
        ) from exc

    checkpoint_path = Path(settings.checkpoint).expanduser()
    if checkpoint_path.is_file():
        resolved_checkpoint = str(checkpoint_path.resolve())
    else:
        resolved_checkpoint = hf_hub_download(
            repo_id=settings.checkpoint,
            filename="model.safetensors",
        )
    return InferenceRuntime.from_key(
        RuntimeKey(
            checkpoint=resolved_checkpoint,
            model_device=settings.model_device,
            model_precision=settings.model_precision,
            codec_device=settings.codec_device,
            codec_precision=settings.codec_precision,
        )
    )


def _default_reference_encoder(runtime: object, source_path: Path, output_path: Path) -> Path:
    _ensure_irodori_importable()
    try:
        import torch
        from irodori_tts.inference_runtime import _load_audio
    except ImportError as exc:
        raise RuntimeError("Irodori-TTS audio dependencies are not installed") from exc

    waveform, sample_rate = _load_audio(source_path)
    latent = runtime.codec.encode_waveform(
        waveform.unsqueeze(0),
        sample_rate=int(sample_rate),
        normalize_db=-16.0,
        ensure_max=True,
    ).cpu()
    torch.save(latent, output_path)
    return output_path


def _default_synthesizer(
    runtime: object,
    text: str,
    latent_path: Path,
    output_path: Path,
    parameters: SamplingParameters,
) -> GenerationArtifact:
    _ensure_irodori_importable()
    try:
        from irodori_tts.inference_runtime import SamplingRequest, save_wav
    except ImportError as exc:
        raise RuntimeError("Irodori-TTS inference dependencies are not installed") from exc

    result = runtime.synthesize(
        SamplingRequest(
            text=text,
            ref_latent=str(latent_path),
            num_steps=parameters.num_steps,
            cfg_scale_text=parameters.cfg_scale_text,
            cfg_scale_speaker=parameters.cfg_scale_speaker,
            seed=parameters.seed,
        )
    )
    save_wav(output_path, result.audio, result.sample_rate)
    duration_sec = float(result.audio.shape[-1]) / float(result.sample_rate)
    return GenerationArtifact(
        sample_rate=int(result.sample_rate),
        duration_sec=duration_sec,
        used_seed=int(result.used_seed),
    )

