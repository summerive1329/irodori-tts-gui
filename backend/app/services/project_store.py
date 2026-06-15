from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from threading import RLock

from pydantic import ValidationError

from app.models.project import Project, ProjectSummary


class ProjectStore:
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = Path(base_dir)
        self._lock = RLock()

    def project_dir(self, project_id: str) -> Path:
        return self.base_dir / "projects" / project_id

    def save(self, project: Project) -> Path:
        with self._lock:
            project.touch()
            project_dir = self.project_dir(project.id)
            project_dir.mkdir(parents=True, exist_ok=True)
            path = project_dir / "project.json"
            temporary_path = path.with_suffix(".json.tmp")
            temporary_path.write_text(project.model_dump_json(indent=2), encoding="utf-8")
            temporary_path.replace(path)
            return path

    def load(self, project_id: str) -> Project:
        with self._lock:
            path = self.project_dir(project_id) / "project.json"
            if not path.is_file():
                raise FileNotFoundError(f"Project not found: {project_id}")
            return Project.model_validate_json(path.read_text(encoding="utf-8"))

    def list_projects(self) -> list[ProjectSummary]:
        with self._lock:
            projects_dir = self.base_dir / "projects"
            if not projects_dir.exists():
                return []
            summaries: list[ProjectSummary] = []
            for path in projects_dir.glob("*/project.json"):
                try:
                    project = Project.model_validate_json(path.read_text(encoding="utf-8"))
                except (OSError, ValidationError):
                    self._quarantine_corrupt_project_file(path)
                    continue
                summaries.append(
                    ProjectSummary(id=project.id, name=project.name, updated_at=project.updated_at)
                )
            return sorted(summaries, key=lambda item: item.updated_at, reverse=True)

    def _quarantine_corrupt_project_file(self, path: Path) -> None:
        suffix = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        quarantined = path.with_name(f"{path.name}.corrupt-{suffix}")
        counter = 1
        while quarantined.exists():
            counter += 1
            quarantined = path.with_name(f"{path.name}.corrupt-{suffix}-{counter}")
        path.replace(quarantined)
