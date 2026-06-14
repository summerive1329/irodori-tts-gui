# Irodori GUI Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragile per-job progress display with backend-owned project progress aggregation and redefine cell presentation state so `未生成 / 生成中 / 未再生 / 再生済み / エラー` stays consistent after generation and regeneration.

**Architecture:** Keep backend internal generation/job state intact, but add API-facing presentation fields at the project schema layer. Frontend components should stop inferring UI state from raw internal fields and instead render backend-supplied `running_job_count` and `display_status` directly.

**Tech Stack:** FastAPI, Pydantic, pytest, React 19, TypeScript, Vitest, Testing Library

---

## File Structure

### Existing files to modify

- `backend/app/models/project.py`
  - Add API-facing progress and display status models that can be serialized with the project response.
- `backend/app/schemas/api.py`
  - Extend response schemas if needed so project progress and cell display status are exposed explicitly.
- `backend/app/api/projects.py`
  - Populate project-level running job aggregate data before returning project payloads.
- `backend/app/services/job_registry.py`
  - Provide a project-scoped query for currently running jobs.
- `backend/tests/test_projects_api.py`
  - Add regression tests for project progress aggregation and `display_status` transitions.
- `frontend/src/types.ts`
  - Add typed fields for project progress and cell display status.
- `frontend/src/App.tsx`
  - Keep project polling wired to the enriched project payload without reconstructing progress client-side.
- `frontend/src/features/editor/GenerationConsole.tsx`
  - Render `生成中 X件` from backend-owned aggregate progress instead of `completed / total`.
- `frontend/src/features/editor/LineMatrix.tsx`
  - Use `display_status` for the top-left status slot and remove the old lower playback label behavior.
- `frontend/src/features/editor/LineMatrix.test.tsx`
  - Cover all display states and the removal of the lower playback label slot.
- `frontend/src/features/editor/ProjectEditor.test.tsx`
  - Cover the new generation console progress copy.
- `frontend/src/App.test.tsx`
  - Cover routed polling/render behavior with the new project payload shape.
- `frontend/src/styles.css`
  - Update status colors and ensure the top-left status slot is the only playback/generation indicator.

### New files to create

- None expected

## Task 1: Add Backend Project Progress Aggregation

**Files:**
- Modify: `backend/app/services/job_registry.py`
- Modify: `backend/app/api/projects.py`
- Test: `backend/tests/test_projects_api.py`

- [ ] **Step 1: Write the failing backend aggregation tests**

```python
def test_project_payload_includes_running_job_count_for_generate_and_regenerate(tmp_path: Path) -> None:
    runtime_manager = BlockingRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one", "two"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )

    generated = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": False},
    )
    assert generated.status_code == 202
    assert runtime_manager.started.wait(timeout=1)

    project = client.get(f"/api/projects/{project_id}").json()
    assert project["generation_progress"]["running_job_count"] == 1
    regen = client.post(
        f"/api/projects/{project_id}/cells/{project['cells'][1]['id']}/regeneration-jobs",
        json={"seed": 11},
    )
    assert regen.status_code == 202

    running = client.get(f"/api/projects/{project_id}").json()
    assert running["generation_progress"]["running_job_count"] == 2
    assert sorted(running["generation_progress"]["running_job_kinds"]) == [
        "generate_all",
        "regenerate_cell",
    ]
```

```python
def test_project_payload_excludes_completed_jobs_from_running_count(tmp_path: Path) -> None:
    runtime_manager = FakeRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )

    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    ).json()
    _wait_for_job(client, project_id, started["id"])

    final_project = client.get(f"/api/projects/{project_id}").json()
    assert final_project["generation_progress"]["running_job_count"] == 0
    assert final_project["generation_progress"]["running_job_kinds"] == []
    assert final_project["generation_progress"]["has_running_jobs"] is False
```

- [ ] **Step 2: Run backend tests to verify they fail**

Run:

```bash
C:\Users\RN\Engineering\irodori-tts-gui\vendor\Irodori-TTS\.venv\Scripts\python.exe -m pytest tests\test_projects_api.py -q
```

Expected:

```text
FAILED tests/test_projects_api.py::test_project_payload_includes_running_job_count_for_generate_and_regenerate
FAILED tests/test_projects_api.py::test_project_payload_excludes_completed_jobs_from_running_count
```

- [ ] **Step 3: Add minimal running-job aggregation support**

```python
# backend/app/services/job_registry.py
class JobRegistry:
    ...
    def list_running_for_project(self, project_id: str) -> list[JobSnapshot]:
        with self._lock:
            return [
                job.model_copy(deep=True)
                for job in self._jobs.values()
                if job.project_id == project_id and job.status == "running"
            ]
```

```python
# backend/app/api/projects.py
def attach_generation_progress(project: Project) -> Project:
    running_jobs = job_registry.list_running_for_project(project.id)
    project.generation_progress = GenerationProgress(
        running_job_count=len(running_jobs),
        running_job_kinds=[job.kind for job in running_jobs],
        has_running_jobs=bool(running_jobs),
    )
    return project

def load_project(project_id: str) -> Project:
    try:
        project = store.load(project_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return attach_generation_progress(project)

def save_project(project: Project) -> Project:
    store.save(project)
    return attach_generation_progress(project)
```

- [ ] **Step 4: Run backend tests to verify they pass**

Run:

```bash
C:\Users\RN\Engineering\irodori-tts-gui\vendor\Irodori-TTS\.venv\Scripts\python.exe -m pytest tests\test_projects_api.py -q
```

Expected:

```text
...........                                                              [100%]
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/job_registry.py backend/app/api/projects.py backend/tests/test_projects_api.py
git commit -m "feat: expose project-level running job progress"
```

## Task 2: Add API-Facing Cell Display Status

**Files:**
- Modify: `backend/app/models/project.py`
- Modify: `backend/app/api/projects.py`
- Test: `backend/tests/test_projects_api.py`

- [ ] **Step 1: Write failing tests for `display_status` transitions**

```python
def test_cells_start_as_not_generated_and_become_unplayed_after_generation(tmp_path: Path) -> None:
    client = _client(tmp_path, FakeRuntimeManager())
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one"]})
    created = client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    ).json()

    assert created["cells"][0]["display_status"] == "not_generated"

    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    ).json()
    _wait_for_job(client, project_id, started["id"])

    generated = client.get(f"/api/projects/{project_id}").json()
    assert generated["cells"][0]["display_status"] == "unplayed"
```

```python
def test_regenerated_cell_returns_to_unplayed_after_being_played(tmp_path: Path) -> None:
    client = _client(tmp_path, FakeRuntimeManager())
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )
    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    ).json()
    _wait_for_job(client, project_id, started["id"])
    generated = client.get(f"/api/projects/{project_id}").json()
    cell_id = generated["cells"][0]["id"]

    client.post(f"/api/projects/{project_id}/cells/{cell_id}/playback-events")
    played = client.get(f"/api/projects/{project_id}").json()
    assert played["cells"][0]["display_status"] == "played"

    regen = client.post(
        f"/api/projects/{project_id}/cells/{cell_id}/regeneration-jobs",
        json={"seed": 22},
    ).json()
    _wait_for_job(client, project_id, regen["id"])

    regenerated = client.get(f"/api/projects/{project_id}").json()
    assert regenerated["cells"][0]["display_status"] == "unplayed"
```

- [ ] **Step 2: Run backend tests to verify they fail**

Run:

```bash
C:\Users\RN\Engineering\irodori-tts-gui\vendor\Irodori-TTS\.venv\Scripts\python.exe -m pytest tests\test_projects_api.py -q
```

Expected:

```text
FAILED tests/test_projects_api.py::test_cells_start_as_not_generated_and_become_unplayed_after_generation
FAILED tests/test_projects_api.py::test_regenerated_cell_returns_to_unplayed_after_being_played
```

- [ ] **Step 3: Add presentation-state models and mapping**

```python
# backend/app/models/project.py
CellDisplayStatus = Literal["not_generated", "generating", "unplayed", "played", "error"]

class GenerationProgress(BaseModel):
    running_job_count: int = 0
    running_job_kinds: list[str] = Field(default_factory=list)
    has_running_jobs: bool = False

class Cell(BaseModel):
    ...
    playback_state: Literal["unplayed", "played"] = "unplayed"
    display_status: CellDisplayStatus = "not_generated"

    def refresh_display_status(self) -> None:
        if self.status == "error":
            self.display_status = "error"
        elif self.status in {"queued", "generating"}:
            self.display_status = "generating"
        elif self.current_result is None:
            self.display_status = "not_generated"
        elif self.playback_state == "played":
            self.display_status = "played"
        else:
            self.display_status = "unplayed"
```

```python
# backend/app/api/projects.py
def refresh_project_presentation(project: Project) -> Project:
    for cell in project.cells:
        cell.refresh_display_status()
    return attach_generation_progress(project)
```

```python
# backend/app/services/generation_service.py
cell.status = "ready"
cell.playback_state = "unplayed"
cell.current_result = CellResult(...)
```

- [ ] **Step 4: Add a minimal playback event endpoint and verify tests pass**

```python
# backend/app/api/projects.py
@router.post("/{project_id}/cells/{cell_id}/playback-events", response_model=Project)
def mark_cell_played(project_id: str, cell_id: str) -> Project:
    project = load_project(project_id)
    try:
        cell = project.get_cell(cell_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if cell.current_result is None:
        raise HTTPException(status_code=400, detail="Cell has no audio")
    cell.playback_state = "played"
    return save_project(project)
```

Run:

```bash
C:\Users\RN\Engineering\irodori-tts-gui\vendor\Irodori-TTS\.venv\Scripts\python.exe -m pytest tests\test_projects_api.py -q
```

Expected:

```text
.............                                                            [100%]
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/project.py backend/app/api/projects.py backend/app/services/generation_service.py backend/tests/test_projects_api.py
git commit -m "feat: add UI-facing cell display status"
```

## Task 3: Render Backend-Owned Status In The Frontend

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/features/editor/GenerationConsole.tsx`
- Modify: `frontend/src/features/editor/LineMatrix.tsx`
- Modify: `frontend/src/styles.css`
- Test: `frontend/src/features/editor/LineMatrix.test.tsx`
- Test: `frontend/src/features/editor/ProjectEditor.test.tsx`

- [ ] **Step 1: Write failing frontend tests**

```tsx
it("shows running job count instead of completed/total progress", () => {
  render(
    <GenerationConsole
      busy={false}
      canGenerate
      autoPlay={false}
      job={null}
      generationProgress={{
        running_job_count: 2,
        running_job_kinds: ["generate_all", "regenerate_cell"],
        has_running_jobs: true,
      }}
      onGenerateMissing={() => undefined}
      onGenerateAll={() => undefined}
      onToggleAutoPlay={() => undefined}
    />,
  );

  expect(screen.getByText("生成中 2件")).toBeInTheDocument();
  expect(screen.queryByText(/0 \/ 1/)).not.toBeInTheDocument();
});
```

```tsx
it("renders top-left display status from backend and removes the lower playback label", () => {
  const props = matrixProps();
  props.cells = [
    { ...cells[0], display_status: "not_generated", current_result: null },
    { ...cells[1], display_status: "unplayed" },
  ];
  render(<LineMatrix {...props} />);

  expect(screen.getByText("未生成")).toBeInTheDocument();
  expect(screen.getByText("未再生")).toBeInTheDocument();
  expect(screen.queryByText("再生済み")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run frontend tests to verify they fail**

Run:

```bash
cd frontend
npm test -- --run src/features/editor/ProjectEditor.test.tsx src/features/editor/LineMatrix.test.tsx
```

Expected:

```text
FAIL src/features/editor/ProjectEditor.test.tsx
FAIL src/features/editor/LineMatrix.test.tsx
```

- [ ] **Step 3: Update frontend types and components with minimal implementation**

```ts
// frontend/src/types.ts
export type CellDisplayStatus = "not_generated" | "generating" | "unplayed" | "played" | "error";

export type GenerationProgress = {
  running_job_count: number;
  running_job_kinds: GenerationJob["kind"][];
  has_running_jobs: boolean;
};

export type CellItem = {
  ...
  display_status: CellDisplayStatus;
};

export type Project = {
  ...
  generation_progress: GenerationProgress;
};
```

```tsx
// frontend/src/features/editor/GenerationConsole.tsx
type Props = {
  ...
  generationProgress: GenerationProgress;
};

const status = generationProgress.running_job_count > 0
  ? `生成中 ${generationProgress.running_job_count}件`
  : "待機中";
```

```tsx
// frontend/src/features/editor/LineMatrix.tsx
const displayStatusLabel: Record<CellDisplayStatus, string> = {
  not_generated: "未生成",
  generating: "生成中",
  unplayed: "未再生",
  played: "再生済み",
  error: "エラー",
};

<span>{displayStatusLabel[cell.display_status]}</span>
```

```css
/* frontend/src/styles.css */
.status-not_generated .status-dot { background: #8b8f97; }
.status-generating .status-dot { background: #2d79c7; }
.status-unplayed .status-dot { background: #d18330; }
.status-played .status-dot { background: #3d8f57; }
.status-error .status-dot { background: #b54135; }
```

- [ ] **Step 4: Run frontend tests and build to verify they pass**

Run:

```bash
cd frontend
npm test -- --run src/features/editor/ProjectEditor.test.tsx src/features/editor/LineMatrix.test.tsx
npm run build
```

Expected:

```text
PASS src/features/editor/ProjectEditor.test.tsx
PASS src/features/editor/LineMatrix.test.tsx
✓ built in
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/features/editor/GenerationConsole.tsx frontend/src/features/editor/LineMatrix.tsx frontend/src/features/editor/LineMatrix.test.tsx frontend/src/features/editor/ProjectEditor.test.tsx frontend/src/styles.css
git commit -m "feat: render aggregated job progress and display status"
```

## Task 4: Wire Playback Events And Full Regression Coverage

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/features/editor/LineMatrix.tsx`
- Modify: `frontend/src/features/editor/CellDetailPane.tsx`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/App.test.tsx`
- Test: `frontend/src/features/editor/LineMatrix.test.tsx`
- Test: `frontend/src/features/editor/ProjectEditor.test.tsx`

- [ ] **Step 1: Write failing tests for playback-state reset and API wiring**

```tsx
it("marks a freshly generated cell as played only after audio playback starts", () => {
  const props = matrixProps();
  props.cells = [{ ...cells[0], display_status: "unplayed" }, { ...cells[1], display_status: "played" }];
  render(<LineMatrix {...props} />);

  expect(screen.getByText("未再生")).toBeInTheDocument();
  expect(screen.getByText("再生済み")).toBeInTheDocument();
});
```

```tsx
it("posts playback events so a regenerated cell returns to unplayed", async () => {
  apiMocks.getProject.mockResolvedValue(projectWithUnplayedCell);
  apiMocks.markCellPlayed.mockResolvedValue(projectWithPlayedCell);

  render(<AppRouter />);

  const audio = await screen.findByLabelText("音声: toru / hello");
  fireEvent.play(audio);

  await waitFor(() => expect(apiMocks.markCellPlayed).toHaveBeenCalledWith("project-1", "cell-1"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd frontend
npm test -- --run src/App.test.tsx src/features/editor/LineMatrix.test.tsx
```

Expected:

```text
FAIL src/App.test.tsx
FAIL src/features/editor/LineMatrix.test.tsx
```

- [ ] **Step 3: Add playback-event API and UI wiring**

```ts
// frontend/src/api/client.ts
export function markCellPlayed(projectId: string, cellId: string) {
  return request(`/api/projects/${projectId}/cells/${cellId}/playback-events`, json("POST"));
}
```

```tsx
// frontend/src/App.tsx
onMarkCellPlayed={(cellId) => void runProjectAction(() => api.markCellPlayed(project.id, cellId))}
```

```tsx
// frontend/src/features/editor/LineMatrix.tsx
type Props = {
  ...
  onMarkCellPlayed?: (cellId: string) => void;
};

onPlay={() => {
  markPlayed(cell.id);
  onMarkCellPlayed?.(cell.id);
}}
```

- [ ] **Step 4: Run frontend regression tests, full frontend suite, and backend suite**

Run:

```bash
cd frontend
npm test -- --run
npm run build
cd ..\backend
C:\Users\RN\Engineering\irodori-tts-gui\vendor\Irodori-TTS\.venv\Scripts\python.exe -m pytest tests -q
```

Expected:

```text
Test Files  ... passed
✓ built in
40 passed in
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/api/client.ts frontend/src/features/editor/LineMatrix.tsx frontend/src/features/editor/CellDetailPane.tsx frontend/src/App.test.tsx frontend/src/features/editor/LineMatrix.test.tsx
git commit -m "test: cover playback event and status regressions"
```

## Self-Review

### Spec Coverage

- Project-scoped running job aggregation is covered by Task 1.
- UI-facing `display_status` and replay reset semantics are covered by Task 2.
- `GenerationConsole` and `LineMatrix` rendering changes are covered by Task 3.
- End-to-end playback event wiring and regression coverage are covered by Task 4.

No spec requirement is left without a task.

### Placeholder Scan

- No `TODO`, `TBD`, or "similar to" placeholders remain.
- Every test step includes concrete test code.
- Every implementation step includes concrete code snippets and commands.

### Type Consistency

- Backend uses `GenerationProgress` and `display_status` consistently.
- Frontend uses `generation_progress` on `Project` and `display_status` on `CellItem` consistently.
- Playback reset is always modeled as `display_status == "unplayed"` after successful regeneration.
