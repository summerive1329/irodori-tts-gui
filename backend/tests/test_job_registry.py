import pytest

from app.services.job_registry import JobRegistry


def test_registry_tracks_completed_cells() -> None:
    registry = JobRegistry()
    job = registry.create(
        project_id="p1",
        kind="generate_missing",
        target_cell_ids=["a", "b"],
    )

    registry.mark_generating(job.id, "a")
    registry.mark_completed(job.id, "a")

    snapshot = registry.get(job.id)
    assert snapshot.completed_cells == 1
    assert snapshot.total_cells == 2
    assert snapshot.status == "running"
    assert snapshot.active_cell_id is None


def test_registry_completes_after_last_cell() -> None:
    registry = JobRegistry()
    job = registry.create("p1", "regenerate_cell", ["a"])

    registry.mark_generating(job.id, "a")
    registry.mark_completed(job.id, "a")

    assert registry.get(job.id).status == "completed"


def test_registry_rejects_unknown_jobs() -> None:
    with pytest.raises(KeyError, match="Job not found"):
        JobRegistry().get("missing")
