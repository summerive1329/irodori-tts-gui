from pathlib import Path

from app.services.runtime_manager import (
    GenerationArtifact,
    RuntimeManager,
    RuntimeSettings,
    SamplingParameters,
)


def test_runtime_and_reference_latent_are_reused(tmp_path: Path) -> None:
    runtimes: list[object] = []
    encoded: list[Path] = []

    def factory(settings: RuntimeSettings) -> object:
        runtime = object()
        runtimes.append(runtime)
        return runtime

    def encoder(runtime: object, source: Path, output: Path) -> Path:
        encoded.append(source)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"latent")
        return output

    manager = RuntimeManager(factory=factory, reference_encoder=encoder)
    settings = RuntimeSettings("checkpoint", "cpu", "fp32", "cpu", "fp32")
    source = tmp_path / "reference.wav"
    source.write_bytes(b"audio")

    first = manager.prepare_reference(settings, source, tmp_path / "latents")
    second = manager.prepare_reference(settings, source, tmp_path / "latents")

    assert first.runtime is second.runtime
    assert first.latent_path == second.latent_path
    assert len(runtimes) == 1
    assert encoded == [source]


def test_changed_reference_file_gets_a_new_latent(tmp_path: Path) -> None:
    encoded: list[Path] = []

    def encoder(runtime: object, source: Path, output: Path) -> Path:
        encoded.append(source)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"latent")
        return output

    manager = RuntimeManager(factory=lambda settings: object(), reference_encoder=encoder)
    settings = RuntimeSettings("checkpoint", "cpu", "fp32", "cpu", "fp32")
    source = tmp_path / "reference.wav"
    source.write_bytes(b"first")
    first = manager.prepare_reference(settings, source, tmp_path / "latents")

    source.write_bytes(b"changed-size")
    second = manager.prepare_reference(settings, source, tmp_path / "latents")

    assert first.latent_path != second.latent_path
    assert len(encoded) == 2


def test_synthesize_delegates_to_injected_backend(tmp_path: Path) -> None:
    calls: list[tuple[str, Path]] = []

    def synthesizer(runtime, text, latent_path, output_path, parameters):
        calls.append((text, latent_path))
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"wav")
        return GenerationArtifact(sample_rate=24000, duration_sec=1.25, used_seed=42)

    manager = RuntimeManager(
        factory=lambda settings: object(),
        reference_encoder=lambda runtime, source, output: output,
        synthesizer=synthesizer,
    )
    settings = RuntimeSettings("checkpoint", "cpu", "fp32", "cpu", "fp32")
    source = tmp_path / "ref.wav"
    source.write_bytes(b"audio")
    prepared = manager.prepare_reference(settings, source, tmp_path)

    artifact = manager.synthesize(
        prepared,
        "hello",
        tmp_path / "cell.wav",
        SamplingParameters(num_steps=8, cfg_scale_text=2.0, cfg_scale_speaker=4.0),
    )

    assert artifact.used_seed == 42
    assert calls == [("hello", prepared.latent_path)]
