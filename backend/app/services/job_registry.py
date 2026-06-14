from __future__ import annotations

from datetime import datetime, timezone
from threading import RLock
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


JobKind = Literal["generate_missing", "generate_all", "regenerate_cell"]
JobStatus = Literal["running", "completed", "failed"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


class JobSnapshot(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    project_id: str
    kind: JobKind
    status: JobStatus = "running"
    total_cells: int
    completed_cells: int = 0
    target_cell_ids: list[str]
    active_cell_id: str | None = None
    error_message: str | None = None
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class JobRegistry:
    def __init__(self) -> None:
        self._jobs: dict[str, JobSnapshot] = {}
        self._completed_cell_ids: dict[str, set[str]] = {}
        self._lock = RLock()

    def create(
        self,
        project_id: str,
        kind: JobKind,
        target_cell_ids: list[str],
    ) -> JobSnapshot:
        job = JobSnapshot(
            project_id=project_id,
            kind=kind,
            total_cells=len(target_cell_ids),
            target_cell_ids=list(target_cell_ids),
        )
        if not target_cell_ids:
            job.status = "completed"
        with self._lock:
            self._jobs[job.id] = job
            self._completed_cell_ids[job.id] = set()
        return job.model_copy(deep=True)

    def get(self, job_id: str) -> JobSnapshot:
        with self._lock:
            return self._get_mutable(job_id).model_copy(deep=True)

    def mark_generating(self, job_id: str, cell_id: str) -> JobSnapshot:
        with self._lock:
            job = self._get_mutable(job_id)
            self._validate_target(job, cell_id)
            job.active_cell_id = cell_id
            job.updated_at = _now()
            return job.model_copy(deep=True)

    def mark_completed(self, job_id: str, cell_id: str) -> JobSnapshot:
        with self._lock:
            job = self._get_mutable(job_id)
            self._validate_target(job, cell_id)
            completed = self._completed_cell_ids[job_id]
            completed.add(cell_id)
            job.completed_cells = len(completed)
            job.active_cell_id = None
            if job.completed_cells >= job.total_cells:
                job.status = "completed"
            job.updated_at = _now()
            return job.model_copy(deep=True)

    def mark_failed(
        self,
        job_id: str,
        error_message: str,
        cell_id: str | None = None,
    ) -> JobSnapshot:
        with self._lock:
            job = self._get_mutable(job_id)
            if cell_id is not None:
                self._validate_target(job, cell_id)
            job.status = "failed"
            job.active_cell_id = None
            job.error_message = error_message
            job.updated_at = _now()
            return job.model_copy(deep=True)

    def _get_mutable(self, job_id: str) -> JobSnapshot:
        try:
            return self._jobs[job_id]
        except KeyError as exc:
            raise KeyError(f"Job not found: {job_id}") from exc

    @staticmethod
    def _validate_target(job: JobSnapshot, cell_id: str) -> None:
        if cell_id not in job.target_cell_ids:
            raise ValueError(f"Cell {cell_id} is not part of job {job.id}")
