from pathlib import Path

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
