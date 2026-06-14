from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.projects import create_projects_router
from app.services.export_service import ExportService
from app.services.generation_service import GenerationService
from app.services.job_registry import JobRegistry
from app.services.line_import_service import LineImportService
from app.services.project_store import ProjectStore
from app.services.reference_service import ReferenceService
from app.services.runtime_manager import RuntimeManager


DEFAULT_DATA_DIR = Path(__file__).resolve().parents[1] / "project_data"


def create_app(data_dir: Path | None = None, runtime_manager: object | None = None) -> FastAPI:
    resolved_data_dir = Path(data_dir or os.environ.get("IRODORI_GUI_DATA_DIR", DEFAULT_DATA_DIR))
    resolved_data_dir.mkdir(parents=True, exist_ok=True)
    store = ProjectStore(resolved_data_dir)
    runtime_backend = runtime_manager or RuntimeManager()

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
        )
    )
    app.mount("/media", StaticFiles(directory=resolved_data_dir, check_dir=False), name="media")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
