from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile, status

from app.models.project import Project, ProjectSummary
from app.schemas.api import (
    AppendLinesRequest,
    CreateProjectRequest,
    ExportResponse,
    GenerateAllRequest,
    RegenerateCellRequest,
    ReorderLinesRequest,
    SelectCellRequest,
    UpdateLineRequest,
    UpdateProjectRequest,
)
from app.services.export_service import ExportService
from app.services.generation_service import GenerationService
from app.services.line_import_service import LineImportService
from app.services.project_store import ProjectStore
from app.services.reference_service import ReferenceService


def create_projects_router(
    store: ProjectStore,
    line_import_service: LineImportService,
    reference_service: ReferenceService,
    generation_service: GenerationService,
    export_service: ExportService,
) -> APIRouter:
    router = APIRouter(prefix="/api/projects", tags=["projects"])

    def load_project(project_id: str) -> Project:
        try:
            return store.load(project_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    def save_project(project: Project) -> Project:
        store.save(project)
        return project

    def remove_cell_audio(project: Project, cell_ids: set[str]) -> None:
        project_dir = store.project_dir(project.id)
        for cell in project.cells:
            if cell.id in cell_ids and cell.current_result is not None:
                (project_dir / cell.current_result.audio_path).unlink(missing_ok=True)

    @router.get("")
    def list_projects() -> list[ProjectSummary]:
        return store.list_projects()

    @router.post("", response_model=Project, status_code=status.HTTP_201_CREATED)
    def create_project(payload: CreateProjectRequest) -> Project:
        try:
            project = Project.create(payload.name)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return save_project(project)

    @router.get("/{project_id}", response_model=Project)
    def get_project(project_id: str) -> Project:
        return load_project(project_id)

    @router.patch("/{project_id}", response_model=Project)
    def update_project(project_id: str, payload: UpdateProjectRequest) -> Project:
        project = load_project(project_id)
        changes = payload.model_dump(exclude_none=True)
        if "name" in changes:
            changes["name"] = changes["name"].strip()
            if not changes["name"]:
                raise HTTPException(status_code=400, detail="Project name is required")
        for field, value in changes.items():
            setattr(project, field, value)
        return save_project(project)

    @router.post("/{project_id}/lines", response_model=Project)
    def append_lines(project_id: str, payload: AppendLinesRequest) -> Project:
        project = load_project(project_id)
        project.append_lines(payload.texts)
        return save_project(project)

    @router.post("/{project_id}/lines/import", response_model=Project)
    async def import_lines(
        project_id: str,
        files: list[UploadFile] = File(...),
    ) -> Project:
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

    @router.patch("/{project_id}/lines/{line_id}", response_model=Project)
    def update_line(project_id: str, line_id: str, payload: UpdateLineRequest) -> Project:
        project = load_project(project_id)
        try:
            project.update_line(line_id, payload.text)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return save_project(project)

    @router.delete("/{project_id}/lines/{line_id}", response_model=Project)
    def delete_line(project_id: str, line_id: str) -> Project:
        project = load_project(project_id)
        cell_ids = {cell.id for cell in project.cells if cell.line_id == line_id}
        remove_cell_audio(project, cell_ids)
        try:
            project.remove_line(line_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return save_project(project)

    @router.put("/{project_id}/lines/order", response_model=Project)
    def reorder_lines(project_id: str, payload: ReorderLinesRequest) -> Project:
        project = load_project(project_id)
        try:
            project.reorder_lines(payload.line_ids)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return save_project(project)

    @router.post("/{project_id}/references", response_model=Project)
    async def add_reference(
        project_id: str,
        label: str = Form(...),
        file: UploadFile = File(...),
    ) -> Project:
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

    @router.delete("/{project_id}/references/{reference_id}", response_model=Project)
    def delete_reference(project_id: str, reference_id: str) -> Project:
        project = load_project(project_id)
        cell_ids = {cell.id for cell in project.cells if cell.reference_id == reference_id}
        remove_cell_audio(project, cell_ids)
        try:
            reference = project.remove_reference(reference_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        (store.project_dir(project.id) / reference.copied_path).unlink(missing_ok=True)
        return save_project(project)

    @router.post("/{project_id}/generate/all", response_model=Project)
    def generate_all(project_id: str, payload: GenerateAllRequest) -> Project:
        project = load_project(project_id)
        try:
            generation_service.generate_all(project, only_missing=payload.only_missing)
        except Exception as exc:
            save_project(project)
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return save_project(project)

    @router.post("/{project_id}/cells/{cell_id}/regenerate", response_model=Project)
    def regenerate_cell(
        project_id: str,
        cell_id: str,
        payload: RegenerateCellRequest,
    ) -> Project:
        project = load_project(project_id)
        try:
            generation_service.regenerate_cell(project, cell_id, seed=payload.seed)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except Exception as exc:
            save_project(project)
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return save_project(project)

    @router.put("/{project_id}/cells/{cell_id}/selection", response_model=Project)
    def select_cell(
        project_id: str,
        cell_id: str,
        payload: SelectCellRequest,
    ) -> Project:
        project = load_project(project_id)
        try:
            if payload.selected:
                project.select_export_cell(cell_id)
            else:
                project.get_cell(cell_id).selected_for_export = False
                project.touch()
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return save_project(project)

    @router.post("/{project_id}/export", response_model=ExportResponse)
    def export_project(project_id: str) -> ExportResponse:
        project = load_project(project_id)
        try:
            output_path = export_service.export_selected(project)
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
