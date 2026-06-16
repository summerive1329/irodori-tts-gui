from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.api.projects import create_projects_router
from app.services.app_log_service import AppLogService, LogContextValue, LogLevel
from app.services.export_service import ExportService
from app.services.generation_service import GenerationService
from app.services.job_registry import JobRegistry
from app.services.line_import_service import LineImportService
from app.services.project_store import ProjectStore
from app.services.reference_service import ReferenceService
from app.services.runtime_manager import RuntimeManager


DEFAULT_DATA_DIR = Path(__file__).resolve().parents[1] / "project_data"


class FrontendLogIngestEntry(BaseModel):
    timestamp: datetime
    level: LogLevel
    event: str
    project_id: str | None = None
    job_id: str | None = None
    message: str
    context: dict[str, LogContextValue] = Field(default_factory=dict)


class FrontendLogIngestRequest(BaseModel):
    entries: list[FrontendLogIngestEntry]


def create_app(data_dir: Path | None = None, runtime_manager: object | None = None) -> FastAPI:
    resolved_data_dir = Path(data_dir or os.environ.get("IRODORI_GUI_DATA_DIR", DEFAULT_DATA_DIR))
    resolved_data_dir.mkdir(parents=True, exist_ok=True)
    store = ProjectStore(resolved_data_dir)
    runtime_backend = runtime_manager or RuntimeManager()
    logs_dir = resolved_data_dir.parent / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    session_log_path = logs_dir / "backend" / f"app-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}.log"
    log_service = AppLogService(log_path=session_log_path, source="backend")
    frontend_log_path = logs_dir / "frontend" / f"app-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}.log"
    frontend_log_service = AppLogService(log_path=frontend_log_path, source="frontend")

    app = FastAPI(title="Irodori Studio", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(
        create_projects_router(
            store=store,
            line_import_service=LineImportService(),
            reference_service=ReferenceService(resolved_data_dir),
            generation_service=GenerationService(runtime_backend, resolved_data_dir),
            export_service=ExportService(resolved_data_dir),
            job_registry=JobRegistry(),
            log_service=log_service,
        )
    )
    app.mount("/media", StaticFiles(directory=resolved_data_dir, check_dir=False), name="media")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/frontend-logs", status_code=202)
    def ingest_frontend_logs(payload: FrontendLogIngestRequest) -> dict[str, int]:
        for item in payload.entries:
            context = dict(item.context)
            context["client_timestamp"] = item.timestamp.isoformat()
            frontend_log_service.log(
                item.level,
                item.event,
                project_id=item.project_id,
                job_id=item.job_id,
                message=item.message,
                context=context,
            )
        return {"accepted": len(payload.entries)}

    @app.get("/api/logs")
    def list_logs(project_id: str | None = None) -> list[dict]:
        entries = (
            log_service.list_entries(project_id=project_id)
            + frontend_log_service.list_entries(project_id=project_id)
        )
        return [
            entry.model_dump(mode="json")
            for entry in sorted(entries, key=lambda entry: entry.timestamp, reverse=True)
        ]

    return app


app = create_app()
