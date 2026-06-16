from __future__ import annotations

import shutil
from pathlib import Path
from threading import Lock, RLock, Thread

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field

from app.models.project import ActiveGenerationJob, Cell, GenerationProgress, Project, ProjectSummary
from app.schemas.api import (
    AppendLinesRequest,
    CreateProjectRequest,
    ExportResponse,
    GenerateAllRequest,
    InsertLineRequest,
    PlaylistAppendRequest,
    PlaylistReorderRequest,
    RegenerateCellRequest,
    RegenerateCellsRequest,
    ReorderLinesRequest,
    UpdateLineRequest,
    UpdateProjectRequest,
)
from app.services.export_service import ExportService
from app.services.generation_service import GenerationService
from app.services.app_log_service import AppLogService
from app.services.job_registry import JobRegistry, JobSnapshot
from app.services.line_import_service import LineImportService
from app.services.project_store import ProjectStore
from app.services.reference_service import ReferenceService


class ProjectWithGenerationProgress(Project):
    generation_progress: GenerationProgress = Field(default_factory=GenerationProgress)


def create_projects_router(
    store: ProjectStore,
    line_import_service: LineImportService,
    reference_service: ReferenceService,
    generation_service: GenerationService,
    export_service: ExportService,
    job_registry: JobRegistry,
    log_service: AppLogService,
) -> APIRouter:
    router = APIRouter(prefix="/api/projects", tags=["projects"])
    project_job_locks: dict[str, Lock] = {}
    project_job_locks_guard = RLock()
    project_write_locks: dict[str, Lock] = {}
    project_write_locks_guard = RLock()

    def attach_generation_progress(project: Project) -> ProjectWithGenerationProgress:
        running_jobs = job_registry.list_running_for_project(project.id)
        line_index_by_id = {line.id: line.order_index + 1 for line in project.lines}
        reference_label_by_id = {
            reference.id: reference.label for reference in project.references
        }
        cell_by_id = {cell.id: cell for cell in project.cells}
        active_jobs: list[ActiveGenerationJob] = []
        for job in sorted(running_jobs, key=lambda item: item.created_at):
            candidate_cell_id = job.active_cell_id
            status = "generating"
            if candidate_cell_id is None:
                queued_cell = next(
                    (
                        cell.id
                        for cell in project.cells
                        if cell.id in job.target_cell_ids and cell.status == "queued"
                    ),
                    None,
                )
                candidate_cell_id = queued_cell or next(iter(job.target_cell_ids), None)
                status = "queued"
            if candidate_cell_id is None:
                continue
            cell = cell_by_id.get(candidate_cell_id)
            if cell is None:
                continue
            active_jobs.append(
                ActiveGenerationJob(
                    job_id=job.id,
                    kind=job.kind,
                    cell_id=cell.id,
                    line_index=line_index_by_id.get(cell.line_id, 0),
                    reference_label=reference_label_by_id.get(cell.reference_id, ""),
                    status=status,
                )
            )
        return ProjectWithGenerationProgress(
            **project.model_dump(exclude={"generation_progress"}),
            generation_progress=GenerationProgress(
                running_job_count=sum(
                    max(job.total_cells - job.completed_cells, 0)
                    for job in running_jobs
                ),
                running_job_kinds=[job.kind for job in running_jobs],
                has_running_jobs=bool(running_jobs),
                active_jobs=active_jobs,
            ),
        )

    def load_project(project_id: str) -> Project:
        try:
            return store.load(project_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    def save_project(project: Project) -> ProjectWithGenerationProgress:
        store.save(project)
        return attach_generation_progress(project)

    def remove_cell_audio(project: Project, cell_ids: set[str]) -> None:
        project_dir = store.project_dir(project.id)
        for cell in project.cells:
            if cell.id in cell_ids and cell.current_result is not None:
                (project_dir / cell.current_result.audio_path).unlink(missing_ok=True)

    def start_worker(target) -> None:
        Thread(target=target, daemon=True).start()

    def get_project_job_lock(project_id: str) -> Lock:
        with project_job_locks_guard:
            return project_job_locks.setdefault(project_id, Lock())

    def get_project_write_lock(project_id: str) -> Lock:
        with project_write_locks_guard:
            return project_write_locks.setdefault(project_id, Lock())

    def save_merged_cell_update(
        project_id: str,
        cell_id: str,
        apply_change,
    ) -> ProjectWithGenerationProgress:
        with get_project_write_lock(project_id):
            project = load_project(project_id)
            try:
                cell = project.get_cell(cell_id)
            except KeyError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc
            apply_change(cell)
            return save_project(project)

    def mutate_project(project_id: str, apply_change) -> ProjectWithGenerationProgress:
        with get_project_write_lock(project_id):
            project = load_project(project_id)
            apply_change(project)
            return save_project(project)

    def queue_cells(project_id: str, cell_ids: list[str]) -> ProjectWithGenerationProgress | None:
        if not cell_ids:
            return None

        def apply_change(project: Project) -> None:
            for cell_id in cell_ids:
                try:
                    cell = project.get_cell(cell_id)
                except KeyError as exc:
                    raise HTTPException(status_code=404, detail=str(exc)) from exc
                cell.status = "queued"
                cell.error_message = None
            project.touch()

        return mutate_project(project_id, apply_change)

    def persist_job_state(job_id: str, project: Project, cell) -> None:
        def apply_change(latest_cell: Cell) -> None:
            latest_cell.status = cell.status
            latest_cell.error_message = cell.error_message
            latest_cell.current_result = cell.current_result
            if cell.status == "ready":
                latest_cell.playback_state = cell.playback_state

        with get_project_write_lock(project.id):
            latest_project = store.load(project.id)
            latest_cell = latest_project.get_cell(cell.id)
            apply_change(latest_cell)
            save_project(latest_project)
        if cell.status == "generating":
            snapshot = job_registry.mark_generating(job_id, cell.id)
            log_service.log_info(
                "job_started",
                project_id=project.id,
                job_id=job_id,
                message="Generation started for cell",
                context={"cell_id": cell.id, "kind": snapshot.kind},
            )
        elif cell.status == "ready":
            snapshot = job_registry.mark_completed(job_id, cell.id)
            if snapshot.status == "completed":
                log_service.log_info(
                    "job_completed",
                    project_id=project.id,
                    job_id=job_id,
                    message="Generation job completed",
                    context={"kind": snapshot.kind, "total_cells": snapshot.total_cells},
                )
        elif cell.status == "error":
            job_registry.mark_failed(job_id, cell.error_message or "Generation failed", cell.id)
            log_service.log_error(
                "job_failed",
                project_id=project.id,
                job_id=job_id,
                message=cell.error_message or "Generation failed",
                context={"cell_id": cell.id},
            )

    def reject_if_conflicting_job(
        project_id: str,
        kind: str,
        target_cell_ids: list[str],
    ) -> None:
        running_jobs = job_registry.list_running_for_project(project_id)
        if kind in {"generate_all", "generate_missing"} and any(
            job.kind in {"generate_all", "generate_missing"} for job in running_jobs
        ):
            log_service.log_warning(
                "job_rejected",
                project_id=project_id,
                message="A generation job is already running for this project",
                context={"kind": kind},
            )
            raise HTTPException(
                status_code=409,
                detail="A generation job is already running for this project",
            )
        if kind == "regenerate_cell":
            target_cell_id_set = set(target_cell_ids)
            for job in running_jobs:
                if job.kind != "regenerate_cell":
                    continue
                if target_cell_id_set.intersection(job.target_cell_ids):
                    log_service.log_warning(
                        "job_rejected",
                        project_id=project_id,
                        message="One or more selected cells are already regenerating",
                        context={"kind": kind},
                    )
                    raise HTTPException(
                        status_code=409,
                        detail="One or more selected cells are already regenerating",
                    )

    @router.get("")
    def list_projects() -> list[ProjectSummary]:
        return store.list_projects()

    @router.post(
        "",
        response_model=ProjectWithGenerationProgress,
        status_code=status.HTTP_201_CREATED,
    )
    def create_project(payload: CreateProjectRequest) -> ProjectWithGenerationProgress:
        try:
            project = Project.create(payload.name)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return save_project(project)

    @router.get("/{project_id}", response_model=ProjectWithGenerationProgress)
    def get_project(project_id: str) -> ProjectWithGenerationProgress:
        return attach_generation_progress(load_project(project_id))

    @router.patch("/{project_id}", response_model=ProjectWithGenerationProgress)
    def update_project(
        project_id: str, payload: UpdateProjectRequest
    ) -> ProjectWithGenerationProgress:
        changes = payload.model_dump(exclude_none=True)
        def apply_change(project: Project) -> None:
            if "name" in changes:
                changes["name"] = changes["name"].strip()
                if not changes["name"]:
                    raise HTTPException(status_code=400, detail="Project name is required")
            for field, value in changes.items():
                setattr(project, field, value)

        return mutate_project(project_id, apply_change)

    @router.post("/{project_id}/lines", response_model=ProjectWithGenerationProgress)
    def append_lines(project_id: str, payload: AppendLinesRequest) -> ProjectWithGenerationProgress:
        return mutate_project(project_id, lambda project: project.append_lines(payload.texts))

    @router.post("/{project_id}/lines/insert", response_model=ProjectWithGenerationProgress)
    def insert_line(project_id: str, payload: InsertLineRequest) -> ProjectWithGenerationProgress:
        def apply_change(project: Project) -> None:
            try:
                project.insert_line(payload.index, payload.text)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc

        return mutate_project(project_id, apply_change)

    @router.get("/{project_id}/lines.txt")
    def export_lines_text(project_id: str) -> Response:
        project = load_project(project_id)
        content = "\n".join(line.text for line in project.ordered_lines())
        filename = f"{project.name.strip() or 'dialogue'}.txt"
        return Response(
            content=content,
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @router.post("/{project_id}/lines/import", response_model=ProjectWithGenerationProgress)
    async def import_lines(
        project_id: str,
        files: list[UploadFile] = File(...),
    ) -> ProjectWithGenerationProgress:
        file_payloads = [
            (upload.filename or "lines.txt", await upload.read())
            for upload in files
        ]

        def apply_change(project: Project) -> None:
            try:
                for filename, content in file_payloads:
                    line_import_service.import_file(project, filename, content)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc

        return mutate_project(project_id, apply_change)

    @router.patch("/{project_id}/lines/{line_id}", response_model=ProjectWithGenerationProgress)
    def update_line(
        project_id: str, line_id: str, payload: UpdateLineRequest
    ) -> ProjectWithGenerationProgress:
        def apply_change(project: Project) -> None:
            try:
                project.update_line(line_id, payload.text)
            except KeyError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc

        return mutate_project(project_id, apply_change)

    @router.delete("/{project_id}/lines/{line_id}", response_model=ProjectWithGenerationProgress)
    def delete_line(project_id: str, line_id: str) -> ProjectWithGenerationProgress:
        def apply_change(project: Project) -> None:
            cell_ids = {cell.id for cell in project.cells if cell.line_id == line_id}
            remove_cell_audio(project, cell_ids)
            try:
                project.remove_line(line_id)
            except KeyError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc

        return mutate_project(project_id, apply_change)

    @router.delete("/{project_id}/lines", response_model=ProjectWithGenerationProgress)
    def clear_lines(project_id: str) -> ProjectWithGenerationProgress:
        def apply_change(project: Project) -> None:
            remove_cell_audio(project, {cell.id for cell in project.cells})
            project.clear_lines()

        return mutate_project(project_id, apply_change)

    @router.put("/{project_id}/lines/order", response_model=ProjectWithGenerationProgress)
    def reorder_lines(
        project_id: str, payload: ReorderLinesRequest
    ) -> ProjectWithGenerationProgress:
        def apply_change(project: Project) -> None:
            try:
                project.reorder_lines(payload.line_ids)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc

        return mutate_project(project_id, apply_change)

    @router.post("/{project_id}/references", response_model=ProjectWithGenerationProgress)
    async def add_reference(
        project_id: str,
        label: str = Form(...),
        file: UploadFile = File(...),
    ) -> ProjectWithGenerationProgress:
        filename = file.filename or "reference.wav"
        content = await file.read()

        def apply_change(project: Project) -> None:
            try:
                reference_service.add_reference(project, label, filename, content)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc

        return mutate_project(project_id, apply_change)

    @router.delete(
        "/{project_id}/references/{reference_id}",
        response_model=ProjectWithGenerationProgress,
    )
    def delete_reference(project_id: str, reference_id: str) -> ProjectWithGenerationProgress:
        def apply_change(project: Project) -> None:
            cell_ids = {cell.id for cell in project.cells if cell.reference_id == reference_id}
            remove_cell_audio(project, cell_ids)
            try:
                reference = project.remove_reference(reference_id)
            except KeyError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc
            (store.project_dir(project.id) / reference.copied_path).unlink(missing_ok=True)

        return mutate_project(project_id, apply_change)

    @router.delete(
        "/{project_id}/references/{reference_id}/cells",
        response_model=ProjectWithGenerationProgress,
    )
    def clear_reference_column(
        project_id: str,
        reference_id: str,
    ) -> ProjectWithGenerationProgress:
        def apply_change(project: Project) -> None:
            if not any(reference.id == reference_id for reference in project.references):
                raise HTTPException(status_code=404, detail=f"Reference not found: {reference_id}")

            target_cell_ids = {
                cell.id for cell in project.cells if cell.reference_id == reference_id
            }
            remove_cell_audio(project, target_cell_ids)
            for cell in project.cells:
                if cell.reference_id != reference_id:
                    continue
                cell.status = "idle"
                cell.error_message = None
                cell.current_result = None
                cell.playback_state = "unplayed"
            project.export_playlist = [
                item for item in project.export_playlist if item.cell_id not in target_cell_ids
            ]
            project.touch()

        return mutate_project(project_id, apply_change)

    @router.post(
        "/{project_id}/generate/jobs",
        response_model=JobSnapshot,
        status_code=status.HTTP_202_ACCEPTED,
    )
    def start_generate_job(project_id: str, payload: GenerateAllRequest) -> JobSnapshot:
        project = load_project(project_id)
        target_cell_ids = [
            cell.id
            for cell in project.cells
            if not payload.only_missing or cell.current_result is None
        ]
        kind = "generate_missing" if payload.only_missing else "generate_all"
        reject_if_conflicting_job(project.id, kind, target_cell_ids)
        job = job_registry.create(project.id, kind, target_cell_ids)
        log_service.log_info(
            "job_created",
            project_id=project.id,
            job_id=job.id,
            message="Generation job created",
            context={"kind": kind, "total_cells": len(target_cell_ids)},
        )
        queue_cells(project_id, target_cell_ids)

        def run() -> None:
            with get_project_job_lock(project_id):
                worker_project = load_project(project_id)
                try:
                    generation_service.generate_all(
                        worker_project,
                        only_missing=payload.only_missing,
                        on_state_change=lambda current, cell: persist_job_state(job.id, current, cell),
                    )
                except Exception as exc:
                    if job_registry.get(job.id).status == "running":
                        job_registry.mark_failed(job.id, str(exc))
                        log_service.log_error(
                            "job_failed",
                            project_id=project.id,
                            job_id=job.id,
                            message=str(exc),
                            context={"kind": kind},
                        )

        if target_cell_ids:
            start_worker(run)
        return job

    @router.get("/{project_id}/jobs/{job_id}", response_model=JobSnapshot)
    def get_job(project_id: str, job_id: str) -> JobSnapshot:
        load_project(project_id)
        try:
            job = job_registry.get(job_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if job.project_id != project_id:
            raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
        return job

    @router.post(
        "/{project_id}/cells/regeneration-jobs",
        response_model=JobSnapshot,
        status_code=status.HTTP_202_ACCEPTED,
    )
    def start_bulk_regeneration_job(
        project_id: str,
        payload: RegenerateCellsRequest,
    ) -> JobSnapshot:
        cell_ids = list(dict.fromkeys(payload.cell_ids))
        if not cell_ids:
            raise HTTPException(status_code=400, detail="At least one cell is required")
        if len(cell_ids) != len(payload.cell_ids):
            raise HTTPException(status_code=400, detail="Duplicate cell ids are not allowed")
        project = load_project(project_id)
        for cell_id in cell_ids:
            try:
                project.get_cell(cell_id)
            except KeyError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc
        reject_if_conflicting_job(project.id, "regenerate_cell", cell_ids)
        job = job_registry.create(project.id, "regenerate_cell", cell_ids)
        log_service.log_info(
            "job_created",
            project_id=project.id,
            job_id=job.id,
            message="Bulk regeneration job created",
            context={"kind": job.kind, "total_cells": len(cell_ids)},
        )
        queue_cells(project_id, cell_ids)

        def run() -> None:
            with get_project_job_lock(project_id):
                worker_project = load_project(project_id)
                try:
                    for target_cell_id in cell_ids:
                        generation_service.regenerate_cell(
                            worker_project,
                            target_cell_id,
                            seed=payload.seed,
                            on_state_change=lambda current, changed: persist_job_state(
                                job.id, current, changed
                            ),
                        )
                except Exception as exc:
                    if job_registry.get(job.id).status == "running":
                        job_registry.mark_failed(job.id, str(exc))
                        log_service.log_error(
                            "job_failed",
                            project_id=project.id,
                            job_id=job.id,
                            message=str(exc),
                            context={"kind": job.kind},
                        )

        start_worker(run)
        return job

    @router.post(
        "/{project_id}/cells/{cell_id}/regeneration-jobs",
        response_model=JobSnapshot,
        status_code=status.HTTP_202_ACCEPTED,
    )
    def start_regeneration_job(
        project_id: str,
        cell_id: str,
        payload: RegenerateCellRequest,
    ) -> JobSnapshot:
        project = load_project(project_id)
        try:
            project.get_cell(cell_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        reject_if_conflicting_job(project.id, "regenerate_cell", [cell_id])
        job = job_registry.create(project.id, "regenerate_cell", [cell_id])
        log_service.log_info(
            "job_created",
            project_id=project.id,
            job_id=job.id,
            message="Regeneration job created",
            context={"kind": job.kind, "total_cells": 1, "cell_id": cell_id},
        )
        queue_cells(project_id, [cell_id])

        def run() -> None:
            with get_project_job_lock(project_id):
                worker_project = load_project(project_id)
                try:
                    generation_service.regenerate_cell(
                        worker_project,
                        cell_id,
                        seed=payload.seed,
                        on_state_change=lambda current, changed: persist_job_state(
                            job.id, current, changed
                        ),
                    )
                except Exception as exc:
                    if job_registry.get(job.id).status == "running":
                        job_registry.mark_failed(job.id, str(exc), cell_id)
                        log_service.log_error(
                            "job_failed",
                            project_id=project.id,
                            job_id=job.id,
                            message=str(exc),
                            context={"kind": job.kind, "cell_id": cell_id},
                        )

        start_worker(run)
        return job

    @router.post(
        "/{project_id}/cells/{cell_id}/playback-events",
        response_model=ProjectWithGenerationProgress,
    )
    def mark_cell_played(project_id: str, cell_id: str) -> ProjectWithGenerationProgress:
        def apply_change(cell: Cell) -> None:
            if cell.current_result is None:
                raise HTTPException(status_code=400, detail="Cell has no audio")
            cell.playback_state = "played"

        return save_merged_cell_update(project_id, cell_id, apply_change)

    @router.post("/{project_id}/playlist/items", response_model=ProjectWithGenerationProgress)
    def append_playlist_item(
        project_id: str,
        payload: PlaylistAppendRequest,
    ) -> ProjectWithGenerationProgress:
        def apply_change(project: Project) -> None:
            try:
                project.append_playlist_item(payload.cell_id)
            except KeyError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc

        return mutate_project(project_id, apply_change)

    @router.post(
        "/{project_id}/playlist/references/{reference_id}",
        response_model=ProjectWithGenerationProgress,
    )
    def append_reference_column(
        project_id: str, reference_id: str
    ) -> ProjectWithGenerationProgress:
        def apply_change(project: Project) -> None:
            if not any(reference.id == reference_id for reference in project.references):
                raise HTTPException(status_code=404, detail=f"Reference not found: {reference_id}")
            line_order = {line.id: line.order_index for line in project.lines}
            cells = sorted(
                (
                    cell
                    for cell in project.cells
                    if cell.reference_id == reference_id
                    and cell.status == "ready"
                    and cell.current_result is not None
                ),
                key=lambda cell: line_order[cell.line_id],
            )
            for cell in cells:
                project.append_playlist_item(cell.id)

        return mutate_project(project_id, apply_change)

    @router.delete(
        "/{project_id}/playlist/items/{playlist_item_id}",
        response_model=ProjectWithGenerationProgress,
    )
    def remove_playlist_item(
        project_id: str, playlist_item_id: str
    ) -> ProjectWithGenerationProgress:
        def apply_change(project: Project) -> None:
            try:
                project.remove_playlist_item(playlist_item_id)
            except KeyError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc

        return mutate_project(project_id, apply_change)

    @router.delete("/{project_id}/playlist/items", response_model=ProjectWithGenerationProgress)
    def clear_playlist(project_id: str) -> ProjectWithGenerationProgress:
        return mutate_project(project_id, lambda project: project.clear_playlist())

    @router.put("/{project_id}/playlist/order", response_model=ProjectWithGenerationProgress)
    def reorder_playlist(
        project_id: str,
        payload: PlaylistReorderRequest,
    ) -> ProjectWithGenerationProgress:
        def apply_change(project: Project) -> None:
            try:
                project.reorder_playlist(payload.playlist_item_ids)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc

        return mutate_project(project_id, apply_change)

    @router.post("/{project_id}/generate/all", response_model=ProjectWithGenerationProgress)
    def generate_all_legacy(
        project_id: str, payload: GenerateAllRequest
    ) -> ProjectWithGenerationProgress:
        with get_project_write_lock(project_id):
            project = load_project(project_id)
            try:
                generation_service.generate_all(project, only_missing=payload.only_missing)
            except Exception as exc:
                store.save(project)
                raise HTTPException(status_code=500, detail=str(exc)) from exc
            return save_project(project)

    @router.post(
        "/{project_id}/cells/{cell_id}/regenerate",
        response_model=ProjectWithGenerationProgress,
    )
    def regenerate_cell_legacy(
        project_id: str,
        cell_id: str,
        payload: RegenerateCellRequest,
    ) -> ProjectWithGenerationProgress:
        with get_project_write_lock(project_id):
            project = load_project(project_id)
            try:
                generation_service.regenerate_cell(project, cell_id, seed=payload.seed)
            except KeyError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc
            except Exception as exc:
                store.save(project)
                raise HTTPException(status_code=500, detail=str(exc)) from exc
            return save_project(project)

    @router.post("/{project_id}/export", response_model=ExportResponse)
    def export_project(project_id: str) -> ExportResponse:
        project = load_project(project_id)
        try:
            output_path = export_service.export_playlist(project)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        relative_path = output_path.relative_to(store.base_dir).as_posix()
        return ExportResponse(media_url=f"/media/{relative_path}")

    @router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_project(project_id: str) -> Response:
        with get_project_write_lock(project_id):
            project_dir = store.project_dir(project_id)
            if not project_dir.is_dir():
                raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
            shutil.rmtree(project_dir)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router
