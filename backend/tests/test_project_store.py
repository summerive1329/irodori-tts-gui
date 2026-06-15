from pathlib import Path
from threading import Event, Thread

from app.models.project import Project
from app.services.project_store import ProjectStore


def test_project_store_round_trip_and_list(tmp_path: Path) -> None:
    store = ProjectStore(tmp_path)
    project = Project.create("demo")
    project.append_lines(["こんにちは"])

    store.save(project)
    loaded = store.load(project.id)

    assert loaded.model_dump() == project.model_dump()
    assert [(item.id, item.name) for item in store.list_projects()] == [
        (project.id, "demo")
    ]


def test_project_store_raises_for_unknown_project(tmp_path: Path) -> None:
    store = ProjectStore(tmp_path)

    try:
        store.load("missing")
    except FileNotFoundError as exc:
        assert "missing" in str(exc)
    else:
        raise AssertionError("Expected FileNotFoundError")


def test_project_store_serializes_reads_and_writes(tmp_path: Path, monkeypatch) -> None:
    store = ProjectStore(tmp_path)
    project = Project.create("demo")
    store.save(project)

    read_started = Event()
    release_read = Event()
    write_started = Event()
    errors: list[BaseException] = []
    original_read_text = Path.read_text
    original_write_text = Path.write_text

    def blocking_read(path: Path, *args, **kwargs) -> str:
        if path.name == "project.json":
            read_started.set()
            if not release_read.wait(timeout=1):
                raise TimeoutError("Timed out waiting to release project read")
        return original_read_text(path, *args, **kwargs)

    def observed_write(path: Path, *args, **kwargs) -> int:
        if path.name == "project.json.tmp":
            write_started.set()
        return original_write_text(path, *args, **kwargs)

    def capture(operation) -> None:
        try:
            operation()
        except BaseException as exc:
            errors.append(exc)

    monkeypatch.setattr(Path, "read_text", blocking_read)
    monkeypatch.setattr(Path, "write_text", observed_write)

    reader = Thread(target=lambda: capture(lambda: store.load(project.id)))
    writer = Thread(target=lambda: capture(lambda: store.save(project)))
    reader.start()
    assert read_started.wait(timeout=1)
    writer.start()

    try:
        assert not write_started.wait(timeout=0.1)
    finally:
        release_read.set()
        reader.join(timeout=1)
        writer.join(timeout=1)

    assert not reader.is_alive()
    assert not writer.is_alive()
    assert errors == []


def test_list_projects_skips_corrupt_project_files(tmp_path: Path) -> None:
    store = ProjectStore(tmp_path)
    valid = Project.create("valid")
    store.save(valid)
    broken_dir = store.project_dir("broken-project")
    broken_dir.mkdir(parents=True, exist_ok=True)
    (broken_dir / "project.json").write_bytes(b"\x00" * 128)

    summaries = store.list_projects()

    assert [(item.id, item.name) for item in summaries] == [(valid.id, "valid")]
    quarantined = next(broken_dir.glob("project.json.corrupt-*"), None)
    assert quarantined is not None
    assert (broken_dir / "project.json").exists() is False
