from __future__ import annotations

import shutil
from pathlib import Path
from threading import Lock, RLock, Thread

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field

from app.models.project import GenerationProgress, Project, ProjectSummary
from app.schemas.api import (
    AppendLinesRequest,
    CreateProjectRequest,
    ExportResponse,
    GenerateAllRequest,
    InsertLineRequest,
    PlaylistAppendRequest,
    PlaylistReorderRequest,
    RegenerateCellRequest,
    ReorderLinesRequest,
    UpdateLineRequest,
    UpdateProjectRequest,
)
from app.services.export_service import ExportService
from app.services.generation_service import GenerationService
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
) -> APIRouter:
    router = APIRouter(prefix="/api/projects", tags=["projects"])
    project_job_locks: dict[str, Lock] = {}
    project_job_locks_guard = RLock()

    def refresh_project_presentation(project: Project) -> Project:
        for cell in project.cells:
            cell.refresh_display_status()
        return project

    def attach_generation_progress(project: Project) -> ProjectWithGenerationProgress:
        refresh_project_presentation(project)
        running_jobs = job_registry.list_running_for_project(project.id)
        return ProjectWithGenerationProgress(
            **project.model_dump(exclude={"generation_progress"}),
            generation_progress=GenerationProgress(
                running_job_count=len(running_jobs),
                running_job_kinds=[job.kind for job in running_jobs],
                has_running_jobs=bool(running_jobs),
            ),
        )

    def load_project(project_id: str) -> Project:
        try:
            return store.load(project_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    def save_project(project: Project) -> ProjectWithGenerationProgress:
        refresh_project_presentation(project)
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

    def persist_job_state(job_id: str, project: Project, cell) -> None:
        save_project(project)
        if cell.status == "generating":
            job_registry.mark_generating(job_id, cell.id)
        elif cell.status == "ready":
            job_registry.mark_completed(job_id, cell.id)
        elif cell.status == "error":
            job_registry.mark_failed(job_id, cell.error_message or "Generation failed", cell.id)

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
        project = load_project(project_id)
        changes = payload.model_dump(exclude_none=True)
        if "name" in changes:
            changes["name"] = changes["name"].strip()
            if not changes["name"]:
                raise HTTPException(status_code=400, detail="Project name is required")
        for field, value in changes.items():
            setattr(project, field, value)
        return save_project(project)

    @router.post("/{project_id}/lines", response_model=ProjectWithGenerationProgress)
    def append_lines(project_id: str, payload: AppendLinesRequest) -> ProjectWithGenerationProgress:
        project = load_project(project_id)
        project.append_lines(payload.texts)
        return save_project(project)

    @router.post("/{project_id}/lines/insert", response_model=ProjectWithGenerationProgress)
    def insert_line(project_id: str, payload: InsertLineRequest) -> ProjectWithGenerationProgress:
        project = load_project(project_id)
        try:
            project.insert_line(payload.index, payload.text)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return save_project(project)

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
        project = load_project(project_id)
        try:
            for upload in files:
                line_import_service.import_file(
                    project,
                    upload.filename or "lines.txt",
                    await upload.read(),
                )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return save_project(project)

    @router.patch("/{project_id}/lines/{line_id}", response_model=ProjectWithGenerationProgress)
    def update_line(
        project_id: str, line_id: str, payload: UpdateLineRequest
    ) -> ProjectWithGenerationProgress:
        project = load_project(project_id)
        try:
            project.update_line(line_id, payload.text)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return save_project(project)

    @router.delete("/{project_id}/lines/{line_id}", response_model=ProjectWithGenerationProgress)
    def delete_line(project_id: str, line_id: str) -> ProjectWithGenerationProgress:
        project = load_project(project_id)
        cell_ids = {cell.id for cell in project.cells if cell.line_id == line_id}
        remove_cell_audio(project, cell_ids)
        try:
            project.remove_line(line_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return save_project(project)

    @router.put("/{project_id}/lines/order", response_model=ProjectWithGenerationProgress)
    def reorder_lines(
        project_id: str, payload: ReorderLinesRequest
    ) -> ProjectWithGenerationProgress:
        project = load_project(project_id)
        try:
            project.reorder_lines(payload.line_ids)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return save_project(project)

    @router.post("/{project_id}/references", response_model=ProjectWithGenerationProgress)
    async def add_reference(
        project_id: str,
        label: str = Form(...),
        file: UploadFile = File(...),
    ) -> ProjectWithGenerationProgress:
        project = load_project(project_id)
        try:
            reference_service.add_reference(
                project,
                label,
                file.filename or "reference.wav",
                await file.read(),
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return save_project(project)

    @router.delete(
        "/{project_id}/references/{reference_id}",
        response_model=ProjectWithGenerationProgress,
    )
    def delete_reference(project_id: str, reference_id: str) -> ProjectWithGenerationProgress:
        project = load_project(project_id)
        cell_ids = {cell.id for cell in project.cells if cell.reference_id == reference_id}
        remove_cell_audio(project, cell_ids)
        try:
            reference = project.remove_reference(reference_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        (store.project_dir(project.id) / reference.copied_path).unlink(missing_ok=True)
        return save_project(project)

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
        job = job_registry.create(project.id, kind, target_cell_ids)

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
                    save_project(worker_project)

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
        job = job_registry.create(project.id, "regenerate_cell", [cell_id])

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
                    save_project(worker_project)

        start_worker(run)
        return job

    @router.post(
        "/{project_id}/cells/{cell_id}/playback-events",
        response_model=ProjectWithGenerationProgress,
    )
    def mark_cell_played(project_id: str, cell_id: str) -> ProjectWithGenerationProgress:
        project = load_project(project_id)
        try:
            cell = project.get_cell(cell_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if cell.current_result is None:
            raise HTTPException(status_code=400, detail="Cell has no audio")
        cell.playback_state = "played"
        return save_project(project)

    @router.post("/{project_id}/playlist/items", response_model=ProjectWithGenerationProgress)
    def append_playlist_item(
        project_id: str,
        payload: PlaylistAppendRequest,
    ) -> ProjectWithGenerationProgress:
        project = load_project(project_id)
        try:
            project.append_playlist_item(payload.cell_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return save_project(project)

    @router.post(
        "/{project_id}/playlist/references/{reference_id}",
        response_model=ProjectWithGenerationProgress,
    )
    def append_reference_column(
        project_id: str, reference_id: str
    ) -> ProjectWithGenerationProgress:
        project = load_project(project_id)
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
        return save_project(project)

    @router.delete(
        "/{project_id}/playlist/items/{playlist_item_id}",
        response_model=ProjectWithGenerationProgress,
    )
    def remove_playlist_item(
        project_id: str, playlist_item_id: str
    ) -> ProjectWithGenerationProgress:
        project = load_project(project_id)
        try:
            project.remove_playlist_item(playlist_item_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return save_project(project)

    @router.put("/{project_id}/playlist/order", response_model=ProjectWithGenerationProgress)
    def reorder_playlist(
        project_id: str,
        payload: PlaylistReorderRequest,
    ) -> ProjectWithGenerationProgress:
        project = load_project(project_id)
        try:
            project.reorder_playlist(payload.playlist_item_ids)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return save_project(project)

    @router.post("/{project_id}/generate/all", response_model=ProjectWithGenerationProgress)
    def generate_all_legacy(
        project_id: str, payload: GenerateAllRequest
    ) -> ProjectWithGenerationProgress:
        project = load_project(project_id)
        try:
            generation_service.generate_all(project, only_missing=payload.only_missing)
        except Exception as exc:
            save_project(project)
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
        project = load_project(project_id)
        try:
            generation_service.regenerate_cell(project, cell_id, seed=payload.seed)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except Exception as exc:
            save_project(project)
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
        project_dir = store.project_dir(project_id)
        if not project_dir.is_dir():
            raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
        shutil.rmtree(project_dir)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router
