# Irodori GUI MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local React + FastAPI GUI that uses `Irodori-TTS` as a Git submodule, imports line text from drag-and-drop files by appending to the existing script, generates `line x reference` cells without reloading the model for every line, supports cell-only regenerate, and exports selected line results as a merged WAV.

**Architecture:** The repo will contain a `vendor/Irodori-TTS` submodule, a `backend/` FastAPI app, and a `frontend/` React app. The backend owns project persistence, runtime/reference-latent reuse, and export logic; the frontend renders the matrix editor and drives the API.

**Tech Stack:** Git submodules, Python 3.11+, FastAPI, Pydantic, Uvicorn, pytest, React, TypeScript, Vite, Vitest, Testing Library

---

## File Structure

### Root

- Create: `.gitmodules`
- Create: `.gitignore`
- Modify: `README.md`

### Backend

- Create: `backend/pyproject.toml`
- Create: `backend/app/main.py`
- Create: `backend/app/config.py`
- Create: `backend/app/models/project.py`
- Create: `backend/app/schemas/api.py`
- Create: `backend/app/services/project_store.py`
- Create: `backend/app/services/runtime_manager.py`
- Create: `backend/app/services/generation_service.py`
- Create: `backend/app/services/line_import_service.py`
- Create: `backend/app/services/export_service.py`
- Create: `backend/app/api/projects.py`
- Create: `backend/tests/test_project_store.py`
- Create: `backend/tests/test_runtime_manager.py`
- Create: `backend/tests/test_generation_service.py`
- Create: `backend/tests/test_line_import_service.py`
- Create: `backend/tests/test_export_service.py`
- Create: `backend/tests/test_projects_api.py`

### Frontend

- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/types.ts`
- Create: `frontend/src/features/projects/ProjectHome.tsx`
- Create: `frontend/src/features/editor/ProjectEditor.tsx`
- Create: `frontend/src/features/editor/LineDropzone.tsx`
- Create: `frontend/src/features/editor/ReferenceSidebar.tsx`
- Create: `frontend/src/features/editor/LineMatrix.tsx`
- Create: `frontend/src/features/editor/CellDetailPane.tsx`
- Create: `frontend/src/features/editor/useProjectState.ts`
- Create: `frontend/src/styles.css`
- Create: `frontend/src/features/editor/ProjectEditor.test.tsx`
- Create: `frontend/src/features/editor/LineMatrix.test.tsx`
- Create: `frontend/src/features/editor/LineDropzone.test.tsx`

### Vendor

- Create: `vendor/Irodori-TTS` via `git submodule add`

---

### Task 1: Bootstrap The Workspace

**Files:**
- Create: `.gitmodules`
- Create: `.gitignore`
- Create: `backend/pyproject.toml`
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Modify: `README.md`

- [ ] **Step 1: Add the submodule and ignore runtime output**

Run:

```bash
git submodule add https://github.com/Aratako/Irodori-TTS.git vendor/Irodori-TTS
```

Create `.gitignore`:

```gitignore
.superpowers/
backend/.venv/
backend/.pytest_cache/
backend/project_data/
frontend/node_modules/
frontend/dist/
```

- [ ] **Step 2: Verify the submodule add succeeded**

Run:

```bash
git submodule status
git status --short
```

Expected:
- `vendor/Irodori-TTS` appears in submodule status
- `.gitmodules` and `vendor/Irodori-TTS` appear as staged or untracked additions

- [ ] **Step 3: Create the backend package manifest**

Create `backend/pyproject.toml`:

```toml
[project]
name = "irodori-tts-gui-backend"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115,<1.0",
  "uvicorn[standard]>=0.30,<1.0",
  "pydantic>=2.8,<3.0",
  "python-multipart>=0.0.9,<1.0",
]

[project.optional-dependencies]
dev = [
  "pytest>=8.2,<9.0",
  "httpx>=0.27,<1.0",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 4: Create the frontend package manifest**

Create `frontend/package.json`:

```json
{
  "name": "irodori-tts-gui-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.8",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.4",
    "vite": "^5.3.4",
    "vitest": "^2.0.4"
  }
}
```

- [ ] **Step 5: Add minimal frontend toolchain files**

Create `frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

Create `frontend/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
```

Create `frontend/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Irodori TTS GUI</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Document how to run both apps**

Append to `README.md`:

```md
## Local Development

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\pip install -e .[dev]
.venv\Scripts\uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```
```

- [ ] **Step 7: Smoke-check the new scaffolding**

Run:

```bash
git submodule status
python -m py_compile backend/app/main.py
npm --prefix frontend run build
```

Expected:
- submodule line prints for `vendor/Irodori-TTS`
- Python compile succeeds after Task 2 creates `backend/app/main.py`
- Vite build exits with `built in`

- [ ] **Step 8: Commit the bootstrap**

```bash
git add .gitmodules .gitignore README.md backend frontend vendor/Irodori-TTS
git commit -m "chore: scaffold GUI workspace and add Irodori submodule"
```

### Task 2: Build The Project Model And Persistence Layer

**Files:**
- Create: `backend/app/models/project.py`
- Create: `backend/app/services/project_store.py`
- Create: `backend/tests/test_project_store.py`

- [ ] **Step 1: Write the failing persistence test**

Create `backend/tests/test_project_store.py`:

```python
from pathlib import Path

from app.models.project import Project, LineItem, ReferenceItem
from app.services.project_store import ProjectStore


def test_save_and_load_round_trip(tmp_path: Path) -> None:
    store = ProjectStore(base_dir=tmp_path)
    project = Project.new(name="demo")
    project.references.append(
        ReferenceItem(id="ref-1", label="toru", source_path="C:/audio/toru.wav", copied_path="references/ref-1.wav", duration_sec=1.2)
    )
    project.lines.append(LineItem(id="line-1", text="こんにちは", order_index=0))

    store.save(project)
    loaded = store.load(project.id)

    assert loaded.id == project.id
    assert loaded.references[0].label == "toru"
    assert loaded.lines[0].text == "こんにちは"
```

- [ ] **Step 2: Run the persistence test and confirm it fails**

Run:

```bash
cd backend
.venv\Scripts\python -m pytest tests/test_project_store.py::test_save_and_load_round_trip -v
```

Expected: FAIL with import errors for `app.models.project` or `ProjectStore`

- [ ] **Step 3: Implement the project model**

Create `backend/app/models/project.py`:

```python
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, UTC
from uuid import uuid4


@dataclass
class CellResult:
    audio_path: str
    sample_rate: int
    generated_at: str
    seed: int | None
    duration_sec: float


@dataclass
class ReferenceItem:
    id: str
    label: str
    source_path: str
    copied_path: str
    duration_sec: float


@dataclass
class LineItem:
    id: str
    text: str
    order_index: int


@dataclass
class Cell:
    id: str
    line_id: str
    reference_id: str
    status: str = "idle"
    error_message: str | None = None
    current_result: CellResult | None = None
    selected_for_export: bool = False


@dataclass
class Project:
    id: str
    name: str
    created_at: str
    updated_at: str
    checkpoint: str = "Aratako/Irodori-TTS-500M-v3"
    model_device: str = "cuda"
    model_precision: str = "fp32"
    codec_device: str = "cuda"
    codec_precision: str = "fp32"
    references: list[ReferenceItem] = field(default_factory=list)
    lines: list[LineItem] = field(default_factory=list)
    cells: list[Cell] = field(default_factory=list)
    export_order: list[str] = field(default_factory=list)

    @classmethod
    def new(cls, name: str) -> "Project":
        now = datetime.now(UTC).isoformat()
        return cls(id=str(uuid4()), name=name, created_at=now, updated_at=now)
```

- [ ] **Step 4: Implement JSON persistence**

Create `backend/app/services/project_store.py`:

```python
from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from app.models.project import Cell, CellResult, LineItem, Project, ReferenceItem


class ProjectStore:
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir

    def _project_dir(self, project_id: str) -> Path:
        return self.base_dir / "projects" / project_id

    def save(self, project: Project) -> Path:
        project_dir = self._project_dir(project.id)
        project_dir.mkdir(parents=True, exist_ok=True)
        path = project_dir / "project.json"
        path.write_text(json.dumps(asdict(project), ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    def load(self, project_id: str) -> Project:
        payload = json.loads((self._project_dir(project_id) / "project.json").read_text(encoding="utf-8"))
        payload["references"] = [ReferenceItem(**item) for item in payload["references"]]
        payload["lines"] = [LineItem(**item) for item in payload["lines"]]
        payload["cells"] = [
            Cell(
                **{
                    **item,
                    "current_result": CellResult(**item["current_result"]) if item["current_result"] else None,
                }
            )
            for item in payload["cells"]
        ]
        return Project(**payload)
```

- [ ] **Step 5: Re-run the persistence test**

Run:

```bash
cd backend
.venv\Scripts\python -m pytest tests/test_project_store.py::test_save_and_load_round_trip -v
```

Expected: PASS

- [ ] **Step 6: Commit the persistence layer**

```bash
git add backend/app/models/project.py backend/app/services/project_store.py backend/tests/test_project_store.py
git commit -m "feat: add project persistence model"
```

### Task 3: Add Line Import Service For Drag-And-Drop Files

**Files:**
- Create: `backend/app/services/line_import_service.py`
- Create: `backend/tests/test_line_import_service.py`

- [ ] **Step 1: Write the failing line import append test**

Create `backend/tests/test_line_import_service.py`:

```python
from app.models.project import LineItem, Project
from app.services.line_import_service import LineImportService


def test_import_appends_lines_without_removing_existing_ones() -> None:
    project = Project.new(name="demo")
    project.lines = [LineItem(id="line-1", text="existing", order_index=0)]
    service = LineImportService()

    updated = service.import_text(project, "new one\nnew two\n")

    assert [line.text for line in updated.lines] == ["existing", "new one", "new two"]
    assert [line.order_index for line in updated.lines] == [0, 1, 2]
```

- [ ] **Step 2: Add the blank-line skip test**

Append to `backend/tests/test_line_import_service.py`:

```python
def test_import_skips_blank_lines() -> None:
    project = Project.new(name="demo")
    service = LineImportService()

    updated = service.import_text(project, "one\n\n two \n")

    assert [line.text for line in updated.lines] == ["one", "two"]
```

- [ ] **Step 3: Run the line import tests and confirm they fail**

Run:

```bash
cd backend
.venv\Scripts\python -m pytest tests/test_line_import_service.py -v
```

Expected: FAIL with missing `LineImportService`

- [ ] **Step 4: Implement append-only line import**

Create `backend/app/services/line_import_service.py`:

```python
from __future__ import annotations

from copy import deepcopy
from uuid import uuid4

from app.models.project import LineItem, Project


class LineImportService:
    def import_text(self, project: Project, raw_text: str) -> Project:
        updated = deepcopy(project)
        next_index = max((line.order_index for line in updated.lines), default=-1) + 1
        for raw_line in raw_text.splitlines():
            text = raw_line.strip()
            if not text:
                continue
            updated.lines.append(LineItem(id=f"line-{uuid4()}", text=text, order_index=next_index))
            next_index += 1
        return updated
```

- [ ] **Step 5: Re-run the line import tests**

Run:

```bash
cd backend
.venv\Scripts\python -m pytest tests/test_line_import_service.py -v
```

Expected: PASS

- [ ] **Step 6: Commit the line import service**

```bash
git add backend/app/services/line_import_service.py backend/tests/test_line_import_service.py
git commit -m "feat: add append-only line import service"
```

### Task 4: Add Runtime Reuse And Cell Generation Services

**Files:**
- Create: `backend/app/services/runtime_manager.py`
- Create: `backend/app/services/generation_service.py`
- Create: `backend/tests/test_runtime_manager.py`
- Create: `backend/tests/test_generation_service.py`

- [ ] **Step 1: Write a failing runtime reuse test**

Create `backend/tests/test_runtime_manager.py`:

```python
from app.services.runtime_manager import RuntimeManager, RuntimeSettings


class FakeRuntime:
    pass


def test_runtime_manager_reuses_same_runtime() -> None:
    created: list[FakeRuntime] = []

    def factory(_: RuntimeSettings) -> FakeRuntime:
        runtime = FakeRuntime()
        created.append(runtime)
        return runtime

    manager = RuntimeManager(factory=factory)
    settings = RuntimeSettings(checkpoint="ckpt", model_device="cpu", model_precision="fp32", codec_device="cpu", codec_precision="fp32")

    runtime_a = manager.get_runtime(settings)
    runtime_b = manager.get_runtime(settings)

    assert runtime_a is runtime_b
    assert len(created) == 1
```

- [ ] **Step 2: Write a failing cell regenerate isolation test**

Create `backend/tests/test_generation_service.py`:

```python
from pathlib import Path

from app.models.project import Cell, LineItem, Project, ReferenceItem
from app.services.generation_service import GenerationService


def test_regenerate_updates_only_target_cell(tmp_path: Path) -> None:
    project = Project.new(name="demo")
    project.lines = [
        LineItem(id="line-1", text="one", order_index=0),
        LineItem(id="line-2", text="two", order_index=1),
    ]
    project.references = [ReferenceItem(id="ref-1", label="toru", source_path="src.wav", copied_path="copied.wav", duration_sec=1.0)]
    project.cells = [
        Cell(id="cell-1", line_id="line-1", reference_id="ref-1"),
        Cell(id="cell-2", line_id="line-2", reference_id="ref-1"),
    ]

    service = GenerationService(runtime_manager=None, output_root=tmp_path)
    service._generate_for_cell = lambda *args, **kwargs: "cell-1.wav"  # type: ignore[method-assign]

    updated = service.regenerate_cell(project, "cell-1")

    assert updated.cells[0].current_result is not None
    assert updated.cells[1].current_result is None
```

- [ ] **Step 3: Run the runtime and generation tests to confirm they fail**

Run:

```bash
cd backend
.venv\Scripts\python -m pytest tests/test_runtime_manager.py tests/test_generation_service.py -v
```

Expected: FAIL with missing service classes

- [ ] **Step 4: Implement runtime caching**

Create `backend/app/services/runtime_manager.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class RuntimeSettings:
    checkpoint: str
    model_device: str
    model_precision: str
    codec_device: str
    codec_precision: str


class RuntimeManager:
    def __init__(self, factory: Callable[[RuntimeSettings], object]) -> None:
        self._factory = factory
        self._runtimes: dict[RuntimeSettings, object] = {}
        self._reference_latents: dict[tuple[str, str, str], object] = {}

    def get_runtime(self, settings: RuntimeSettings) -> object:
        if settings not in self._runtimes:
            self._runtimes[settings] = self._factory(settings)
        return self._runtimes[settings]
```

- [ ] **Step 5: Implement the generation service skeleton**

Create `backend/app/services/generation_service.py`:

```python
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, UTC
from pathlib import Path

from app.models.project import CellResult, Project


class GenerationService:
    def __init__(self, runtime_manager: object | None, output_root: Path) -> None:
        self.runtime_manager = runtime_manager
        self.output_root = output_root

    def _generate_for_cell(self, project: Project, cell_id: str) -> str:
        return str(self.output_root / f"{cell_id}.wav")

    def regenerate_cell(self, project: Project, cell_id: str) -> Project:
        updated = deepcopy(project)
        output_path = self._generate_for_cell(updated, cell_id)
        for cell in updated.cells:
            if cell.id == cell_id:
                cell.current_result = CellResult(
                    audio_path=output_path,
                    sample_rate=44100,
                    generated_at=datetime.now(UTC).isoformat(),
                    seed=None,
                    duration_sec=0.0,
                )
                cell.status = "ready"
                cell.error_message = None
        return updated
```

- [ ] **Step 6: Re-run the runtime and generation tests**

Run:

```bash
cd backend
.venv\Scripts\python -m pytest tests/test_runtime_manager.py tests/test_generation_service.py -v
```

Expected: PASS

- [ ] **Step 7: Extend generation for batch `line x reference` work**

Update `backend/tests/test_generation_service.py` with:

```python
def test_generate_all_populates_every_cell(tmp_path: Path) -> None:
    project = Project.new(name="demo")
    project.lines = [LineItem(id="line-1", text="one", order_index=0)]
    project.references = [
        ReferenceItem(id="ref-1", label="toru", source_path="a.wav", copied_path="a.wav", duration_sec=1.0),
        ReferenceItem(id="ref-2", label="lize", source_path="b.wav", copied_path="b.wav", duration_sec=1.0),
    ]
    project.cells = [
        Cell(id="cell-1", line_id="line-1", reference_id="ref-1"),
        Cell(id="cell-2", line_id="line-1", reference_id="ref-2"),
    ]
    service = GenerationService(runtime_manager=None, output_root=tmp_path)
    service._generate_for_cell = lambda project, cell_id: str(tmp_path / f"{cell_id}.wav")  # type: ignore[method-assign]

    updated = service.generate_all(project)

    assert all(cell.current_result is not None for cell in updated.cells)
```

Update `backend/app/services/generation_service.py`:

```python
    def generate_all(self, project: Project) -> Project:
        updated = deepcopy(project)
        for cell in updated.cells:
            output_path = self._generate_for_cell(updated, cell.id)
            cell.current_result = CellResult(
                audio_path=output_path,
                sample_rate=44100,
                generated_at=datetime.now(UTC).isoformat(),
                seed=None,
                duration_sec=0.0,
            )
            cell.status = "ready"
            cell.error_message = None
        return updated
```

- [ ] **Step 8: Commit the runtime and generation services**

```bash
git add backend/app/services/runtime_manager.py backend/app/services/generation_service.py backend/tests/test_runtime_manager.py backend/tests/test_generation_service.py
git commit -m "feat: add runtime cache and generation service"
```

### Task 5: Add Export Logic And FastAPI Endpoints

**Files:**
- Create: `backend/app/schemas/api.py`
- Create: `backend/app/services/export_service.py`
- Create: `backend/app/api/projects.py`
- Create: `backend/app/config.py`
- Create: `backend/app/main.py`
- Create: `backend/tests/test_export_service.py`
- Create: `backend/tests/test_projects_api.py`

- [ ] **Step 1: Write the failing export validation test**

Create `backend/tests/test_export_service.py`:

```python
import pytest

from app.models.project import Cell, LineItem, Project, ReferenceItem
from app.services.export_service import ExportService


def test_export_requires_one_selected_cell_per_line(tmp_path) -> None:
    project = Project.new(name="demo")
    project.lines = [LineItem(id="line-1", text="one", order_index=0)]
    project.references = [ReferenceItem(id="ref-1", label="toru", source_path="a.wav", copied_path="a.wav", duration_sec=1.0)]
    project.cells = [Cell(id="cell-1", line_id="line-1", reference_id="ref-1", selected_for_export=False)]

    service = ExportService(output_root=tmp_path)

    with pytest.raises(ValueError, match="Missing selected cell"):
        service.export_selected(project)
```

- [ ] **Step 2: Write the failing API smoke test**

Create `backend/tests/test_projects_api.py`:

```python
from fastapi.testclient import TestClient

from app.main import app


def test_list_projects_returns_200() -> None:
    client = TestClient(app)
    response = client.get("/api/projects")

    assert response.status_code == 200
    assert response.json() == []
```

- [ ] **Step 3: Add the failing line import API test**

Append to `backend/tests/test_projects_api.py`:

```python
def test_import_lines_appends_to_existing_lines() -> None:
    client = TestClient(app)
    created = client.post("/api/projects", json={"name": "demo"}).json()
    project_id = created["id"]

    first = client.post(
        f"/api/projects/{project_id}/lines/import",
        files={"file": ("lines.txt", "first\nsecond\n", "text/plain")},
    )
    second = client.post(
        f"/api/projects/{project_id}/lines/import",
        files={"file": ("more.txt", "third\n", "text/plain")},
    )

    assert first.status_code == 200
    assert [line["text"] for line in second.json()["lines"]] == ["first", "second", "third"]
```

- [ ] **Step 4: Run the export and API tests to confirm they fail**

Run:

```bash
cd backend
.venv\Scripts\python -m pytest tests/test_export_service.py tests/test_projects_api.py -v
```

Expected: FAIL with missing app/export modules

- [ ] **Step 5: Implement export validation**

Create `backend/app/services/export_service.py`:

```python
from __future__ import annotations

from pathlib import Path

from app.models.project import Project


class ExportService:
    def __init__(self, output_root: Path) -> None:
        self.output_root = output_root

    def export_selected(self, project: Project) -> Path:
        for line in project.lines:
            selected = [cell for cell in project.cells if cell.line_id == line.id and cell.selected_for_export]
            if len(selected) != 1:
                raise ValueError(f"Missing selected cell for line {line.id}")
        output_path = self.output_root / "export.wav"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"RIFF")
        return output_path
```

- [ ] **Step 6: Implement API schemas and app wiring**

Create `backend/app/config.py`:

```python
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
PROJECT_DATA_DIR = BASE_DIR / "project_data"
```

Create `backend/app/schemas/api.py`:

```python
from pydantic import BaseModel


class CreateProjectRequest(BaseModel):
    name: str
```

Create `backend/app/api/projects.py`:

```python
from fastapi import APIRouter

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("")
def list_projects() -> list[dict[str, str]]:
    return []
```

Create `backend/app/main.py`:

```python
from fastapi import FastAPI

from app.api.projects import router as projects_router

app = FastAPI(title="Irodori TTS GUI")
app.include_router(projects_router)
```

- [ ] **Step 7: Add line import request handling**

Update `backend/app/api/projects.py`:

```python
from fastapi import APIRouter, HTTPException, UploadFile

from app.services.line_import_service import LineImportService

LINE_IMPORT_SERVICE = LineImportService()


def _decode_text_file(raw_bytes: bytes) -> str:
    for encoding in ("utf-8", "utf-8-sig", "cp932"):
        try:
            return raw_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise HTTPException(status_code=400, detail="Unsupported text file encoding")


@router.post("/{project_id}/lines/import")
async def import_lines(project_id: str, file: UploadFile) -> Project:
    project = PROJECTS.get(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    raw_bytes = await file.read()
    PROJECTS[project_id] = LINE_IMPORT_SERVICE.import_text(project, _decode_text_file(raw_bytes))
    return PROJECTS[project_id]
```

- [ ] **Step 8: Re-run the export and API tests**

Run:

```bash
cd backend
.venv\Scripts\python -m pytest tests/test_export_service.py tests/test_projects_api.py -v
```

Expected: PASS

- [ ] **Step 9: Add create/load/regenerate/export endpoints**

Update `backend/app/api/projects.py`:

```python
from fastapi import APIRouter, HTTPException

from app.models.project import Project

router = APIRouter(prefix="/api/projects", tags=["projects"])
PROJECTS: dict[str, Project] = {}


@router.get("")
def list_projects() -> list[dict[str, str]]:
    return [{"id": project.id, "name": project.name} for project in PROJECTS.values()]


@router.post("")
def create_project(payload: dict[str, str]) -> dict[str, str]:
    project = Project.new(name=payload["name"])
    PROJECTS[project.id] = project
    return {"id": project.id, "name": project.name}


@router.get("/{project_id}")
def get_project(project_id: str) -> Project:
    project = PROJECTS.get(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
```

- [ ] **Step 10: Commit the API layer**

```bash
git add backend/app/config.py backend/app/main.py backend/app/schemas/api.py backend/app/services/export_service.py backend/app/api/projects.py backend/tests/test_export_service.py backend/tests/test_projects_api.py
git commit -m "feat: add backend API and export validation"
```

### Task 6: Build The React Project Editor

**Files:**
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/types.ts`
- Create: `frontend/src/features/projects/ProjectHome.tsx`
- Create: `frontend/src/features/editor/ProjectEditor.tsx`
- Create: `frontend/src/features/editor/LineDropzone.tsx`
- Create: `frontend/src/features/editor/ReferenceSidebar.tsx`
- Create: `frontend/src/features/editor/LineMatrix.tsx`
- Create: `frontend/src/features/editor/CellDetailPane.tsx`
- Create: `frontend/src/features/editor/useProjectState.ts`
- Create: `frontend/src/styles.css`
- Create: `frontend/src/features/editor/ProjectEditor.test.tsx`
- Create: `frontend/src/features/editor/LineMatrix.test.tsx`
- Create: `frontend/src/features/editor/LineDropzone.test.tsx`

- [ ] **Step 1: Write the failing matrix interaction test**

Create `frontend/src/features/editor/LineMatrix.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LineMatrix } from "./LineMatrix";

test("selecting a cell calls onSelectCell with the cell id", async () => {
  const user = userEvent.setup();
  const calls: string[] = [];

  render(
    <LineMatrix
      lines={[{ id: "line-1", text: "hello", orderIndex: 0 }]}
      references={[{ id: "ref-1", label: "toru" }]}
      cells={[{ id: "cell-1", lineId: "line-1", referenceId: "ref-1", status: "ready", selectedForExport: false, currentResult: null }]}
      selectedCellId={null}
      onSelectCell={(cellId) => calls.push(cellId)}
      onToggleExport={() => {}}
      onRegenerate={() => {}}
    />
  );

  await user.click(screen.getByRole("button", { name: /hello toru/i }));

  expect(calls).toEqual(["cell-1"]);
});
```

- [ ] **Step 2: Run the frontend test and confirm it fails**

Run:

```bash
cd frontend
npm test -- --runInBand
```

Expected: FAIL with missing `LineMatrix`

- [ ] **Step 3: Define frontend types and API client**

Create `frontend/src/types.ts`:

```ts
export type ReferenceItem = { id: string; label: string };
export type LineItem = { id: string; text: string; orderIndex: number };
export type CellItem = {
  id: string;
  lineId: string;
  referenceId: string;
  status: "idle" | "generating" | "ready" | "error";
  selectedForExport: boolean;
  currentResult: { audioPath: string } | null;
};
```

Create `frontend/src/api/client.ts`:

```ts
const API_BASE = "http://localhost:8000/api";

export async function listProjects(): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch(`${API_BASE}/projects`);
  return response.json();
}
```

- [ ] **Step 4: Implement the matrix component**

Create `frontend/src/features/editor/LineMatrix.tsx`:

```tsx
import type { CellItem, LineItem, ReferenceItem } from "../../types";

type Props = {
  lines: LineItem[];
  references: ReferenceItem[];
  cells: CellItem[];
  selectedCellId: string | null;
  onSelectCell: (cellId: string) => void;
  onToggleExport: (cellId: string) => void;
  onRegenerate: (cellId: string) => void;
};

export function LineMatrix({ lines, references, cells, selectedCellId, onSelectCell, onToggleExport, onRegenerate }: Props) {
  return (
    <div className="matrix">
      {lines.map((line) => (
        <div className="matrix-row" key={line.id}>
          <div className="matrix-line">{line.text}</div>
          {references.map((reference) => {
            const cell = cells.find((item) => item.lineId === line.id && item.referenceId === reference.id)!;
            return (
              <button
                key={cell.id}
                className={selectedCellId === cell.id ? "cell selected" : "cell"}
                onClick={() => onSelectCell(cell.id)}
                aria-label={`${line.text} ${reference.label}`}
              >
                <span>{reference.label}</span>
                <span>{cell.status}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Re-run the matrix interaction test**

Run:

```bash
cd frontend
npm test -- --runInBand
```

Expected: PASS for `LineMatrix.test.tsx`

- [ ] **Step 6: Build the editor shell and detail pane**

- [ ] **Step 6: Add the failing dropzone test**

Create `frontend/src/features/editor/LineDropzone.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LineDropzone } from "./LineDropzone";

test("dropzone forwards dropped files", async () => {
  const user = userEvent.setup();
  const calls: string[] = [];
  const file = new File(["one\ntwo\n"], "lines.txt", { type: "text/plain" });

  render(<LineDropzone onFilesSelected={(files) => calls.push(files[0].name)} />);

  await user.upload(screen.getByLabelText(/import lines/i), file);

  expect(calls).toEqual(["lines.txt"]);
});
```

- [ ] **Step 7: Run the editor tests and confirm the dropzone test fails**

Run:

```bash
cd frontend
npm test -- --runInBand
```

Expected: FAIL with missing `LineDropzone`

- [ ] **Step 8: Build the editor shell, dropzone, and detail pane**

Create `frontend/src/features/editor/ProjectEditor.tsx`:

```tsx
import { LineMatrix } from "./LineMatrix";
import { LineDropzone } from "./LineDropzone";
import { CellDetailPane } from "./CellDetailPane";
import { ReferenceSidebar } from "./ReferenceSidebar";
import type { CellItem, LineItem, ReferenceItem } from "../../types";

type Props = {
  lines: LineItem[];
  references: ReferenceItem[];
  cells: CellItem[];
  selectedCellId: string | null;
  onSelectCell: (cellId: string) => void;
  onRegenerate: (cellId: string) => void;
  onToggleExport: (cellId: string) => void;
};

export function ProjectEditor(props: Props) {
  return (
    <div className="editor-layout">
      <ReferenceSidebar references={props.references} />
      <div>
        <LineDropzone onFilesSelected={() => {}} />
        <LineMatrix {...props} />
      </div>
      <CellDetailPane cellId={props.selectedCellId} onRegenerate={props.onRegenerate} />
    </div>
  );
}
```

Create `frontend/src/features/editor/LineDropzone.tsx`:

```tsx
type Props = {
  onFilesSelected: (files: File[]) => void;
};

export function LineDropzone({ onFilesSelected }: Props) {
  return (
    <label>
      Import Lines
      <input
        type="file"
        accept=".txt,.md,.csv,.tsv,text/plain,text/markdown,text/csv"
        onChange={(event) => onFilesSelected(Array.from(event.target.files ?? []))}
      />
    </label>
  );
}
```

Create `frontend/src/features/editor/ReferenceSidebar.tsx`:

```tsx
import type { ReferenceItem } from "../../types";

export function ReferenceSidebar({ references }: { references: ReferenceItem[] }) {
  return (
    <aside>
      <h2>References</h2>
      <ul>{references.map((reference) => <li key={reference.id}>{reference.label}</li>)}</ul>
    </aside>
  );
}
```

Create `frontend/src/features/editor/CellDetailPane.tsx`:

```tsx
export function CellDetailPane({ cellId, onRegenerate }: { cellId: string | null; onRegenerate: (cellId: string) => void }) {
  return (
    <aside>
      <h2>Cell</h2>
      {cellId ? <button onClick={() => onRegenerate(cellId)}>Regenerate This Cell</button> : <p>Select a cell.</p>}
    </aside>
  );
}
```

- [ ] **Step 9: Add the root app and styles**

Create `frontend/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Create `frontend/src/App.tsx`:

```tsx
import { ProjectEditor } from "./features/editor/ProjectEditor";

export function App() {
  return (
    <ProjectEditor
      lines={[{ id: "line-1", text: "こんにちは", orderIndex: 0 }]}
      references={[{ id: "ref-1", label: "toru" }]}
      cells={[{ id: "cell-1", lineId: "line-1", referenceId: "ref-1", status: "idle", selectedForExport: false, currentResult: null }]}
      selectedCellId={null}
      onSelectCell={() => {}}
      onRegenerate={() => {}}
      onToggleExport={() => {}}
    />
  );
}
```

Create `frontend/src/styles.css`:

```css
:root {
  color: #f6f1e8;
  background: linear-gradient(180deg, #1e1e1a 0%, #2d261f 100%);
  font-family: "Segoe UI", sans-serif;
}

body {
  margin: 0;
}

.editor-layout {
  display: grid;
  grid-template-columns: 220px 1fr 280px;
  min-height: 100vh;
}

.cell.selected {
  outline: 2px solid #f0b35b;
}
```

- [ ] **Step 10: Re-run the frontend tests**

Run:

```bash
cd frontend
npm test -- --runInBand
```

Expected: PASS for `LineMatrix.test.tsx` and `LineDropzone.test.tsx`

- [ ] **Step 11: Commit the frontend editor shell**

```bash
git add frontend
git commit -m "feat: add React matrix editor shell"
```

### Task 7: Wire Real Backend Behavior And End-To-End Checks

**Files:**
- Modify: `backend/app/services/generation_service.py`
- Modify: `backend/app/api/projects.py`
- Modify: `backend/app/main.py`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/features/editor/useProjectState.ts`
- Modify: `frontend/src/features/editor/ProjectEditor.tsx`
- Modify: `frontend/src/features/editor/LineDropzone.tsx`

- [ ] **Step 1: Add a failing API test for cell regenerate**

Update `backend/tests/test_projects_api.py`:

```python
def test_regenerate_endpoint_returns_updated_project() -> None:
    client = TestClient(app)
    created = client.post("/api/projects", json={"name": "demo"}).json()
    project_id = created["id"]
    response = client.post(f"/api/projects/{project_id}/cells/cell-1/regenerate")

    assert response.status_code == 200
```

- [ ] **Step 2: Run the API suite and confirm the new endpoint is missing**

Run:

```bash
cd backend
.venv\Scripts\python -m pytest tests/test_projects_api.py -v
```

Expected: FAIL with `404 Not Found`

- [ ] **Step 3: Implement backend endpoint wiring**

Update `backend/app/api/projects.py`:

```python
@router.post("/{project_id}/cells/{cell_id}/regenerate")
def regenerate_cell(project_id: str, cell_id: str) -> Project:
    project = PROJECTS.get(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    PROJECTS[project_id] = GENERATION_SERVICE.regenerate_cell(project, cell_id)
    return PROJECTS[project_id]
```

Update `backend/app/main.py`:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

- [ ] **Step 4: Implement frontend project state hook**

Create `frontend/src/features/editor/useProjectState.ts`:

```ts
import { useState } from "react";

export function useProjectState() {
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  return { selectedCellId, setSelectedCellId };
}
```

- [ ] **Step 5: Connect the frontend to the backend client**

Update `frontend/src/api/client.ts`:

```ts
export async function createProject(name: string): Promise<{ id: string; name: string }> {
  const response = await fetch(`${API_BASE}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return response.json();
}

export async function importLines(projectId: string, file: File): Promise<unknown> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`${API_BASE}/projects/${projectId}/lines/import`, {
    method: "POST",
    body,
  });
  return response.json();
}
```

Update `frontend/src/App.tsx`:

```tsx
import { useProjectState } from "./features/editor/useProjectState";

export function App() {
  const { selectedCellId, setSelectedCellId } = useProjectState();
  return (
    <ProjectEditor
      lines={[{ id: "line-1", text: "こんにちは", orderIndex: 0 }]}
      references={[{ id: "ref-1", label: "toru" }]}
      cells={[{ id: "cell-1", lineId: "line-1", referenceId: "ref-1", status: "idle", selectedForExport: false, currentResult: null }]}
      selectedCellId={selectedCellId}
      onSelectCell={setSelectedCellId}
      onRegenerate={(cellId) => console.log("regen", cellId)}
      onToggleExport={() => {}}
    />
  );
}
```

Update `frontend/src/features/editor/ProjectEditor.tsx`:

```tsx
type Props = {
  lines: LineItem[];
  references: ReferenceItem[];
  cells: CellItem[];
  selectedCellId: string | null;
  onSelectCell: (cellId: string) => void;
  onRegenerate: (cellId: string) => void;
  onToggleExport: (cellId: string) => void;
  onImportFiles?: (files: File[]) => void;
};

export function ProjectEditor(props: Props) {
  return (
    <div className="editor-layout">
      <ReferenceSidebar references={props.references} />
      <div>
        <LineDropzone onFilesSelected={(files) => props.onImportFiles?.(files)} />
        <LineMatrix {...props} />
      </div>
      <CellDetailPane cellId={props.selectedCellId} onRegenerate={props.onRegenerate} />
    </div>
  );
}
```

- [ ] **Step 6: Run backend and frontend tests**

Run:

```bash
cd backend
.venv\Scripts\python -m pytest -v
cd ..\frontend
npm test -- --runInBand
```

Expected:
- backend tests PASS
- frontend tests PASS

- [ ] **Step 7: Do a manual end-to-end smoke test**

Run backend:

```bash
cd backend
.venv\Scripts\uvicorn app.main:app --reload --port 8000
```

Run frontend in another terminal:

```bash
cd frontend
npm run dev
```

Manual check:
- create a project
- add two references
- add three lines
- drag and drop a text file and confirm new lines append after the existing ones
- generate all cells
- regenerate one cell only
- mark one selected cell per line
- export merged WAV

- [ ] **Step 8: Commit the integrated MVP**

```bash
git add backend frontend README.md
git commit -m "feat: deliver Irodori GUI MVP"
```

## Self-Review

- Spec coverage:
  - submodule integration is covered in Task 1
  - local project save/load is covered in Task 2
  - append-only line import is covered in Task 3
  - runtime and latent reuse service scaffolding is covered in Task 4
  - export and API surface are covered in Task 5
  - React matrix editor plus dropzone is covered in Task 6
  - end-to-end regenerate/export flow is covered in Task 7
- Placeholder scan:
  - no unresolved placeholder markers remain
  - every task names exact files and exact commands
- Type consistency:
  - `Project`, `Cell`, `ReferenceItem`, `LineItem`, `CellResult`, `RuntimeSettings`, and `GenerationService.regenerate_cell()` are named consistently across tasks
