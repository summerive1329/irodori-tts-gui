# Irodori GUI Generation Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make generation progress counts match target cells, add bulk regeneration for selected cells, harden generation starts against duplicate requests, and expose a minimal project-aware log feed without touching layout work.

**Architecture:** Keep the existing project/job model and extend it in narrow seams. Backend owns counting, duplicate-start rejection, bulk regeneration orchestration, and log storage; frontend adds a separate multi-selection state and thin controls that call the new APIs without reshaping the wider editor.

**Tech Stack:** FastAPI, Pydantic, in-memory service objects, React, TypeScript, Vitest, pytest

---

### Task 1: Spec And API Surface Lock-In

**Files:**
- Create: `docs/superpowers/specs/2026-06-16-irodori-gui-generation-stability-design.md`
- Create: `docs/superpowers/plans/2026-06-16-irodori-gui-generation-stability.md`

- [ ] **Step 1: Write the approved spec and plan files**

```md
Document the 4 scoped items only:
- running_job_count counts target cells
- bulk regeneration endpoint and selection model
- duplicate-start guard via 409 responses
- in-memory log service + API + simple viewer
```

- [ ] **Step 2: Review both docs for contradictions**

Run: `rg -n "TBD|TODO|later|placeholder" docs/superpowers/specs/2026-06-16-irodori-gui-generation-stability-design.md docs/superpowers/plans/2026-06-16-irodori-gui-generation-stability.md`
Expected: no matches

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-16-irodori-gui-generation-stability-design.md docs/superpowers/plans/2026-06-16-irodori-gui-generation-stability.md
git commit -m "docs: plan generation stability batch"
```

### Task 2: Progress Count Semantics

**Files:**
- Modify: `backend/app/api/projects.py`
- Test: `backend/tests/test_projects_api.py`

- [ ] **Step 1: Write the failing backend tests**

```python
def test_project_payload_counts_generate_all_targets_in_running_job_count(tmp_path: Path) -> None:
    runtime_manager = BlockingRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one", "two"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )

    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": False},
    )
    assert started.status_code == 202
    assert runtime_manager.started.wait(timeout=1)

    try:
        running = client.get(f"/api/projects/{project_id}").json()
        assert running["generation_progress"]["running_job_count"] == 2
    finally:
        runtime_manager.release.set()
        _wait_for_job(client, project_id, started.json()["id"])
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `cd backend; $env:PYTHONPATH='.'; uv run --project . --extra dev pytest tests/test_projects_api.py -k "running_job_count" -q`
Expected: FAIL because the current API returns `1`

- [ ] **Step 3: Write the minimal implementation**

```python
return ProjectWithGenerationProgress(
    **project.model_dump(exclude={"generation_progress"}),
    generation_progress=GenerationProgress(
        running_job_count=sum(job.total_cells for job in running_jobs),
        running_job_kinds=[job.kind for job in running_jobs],
        has_running_jobs=bool(running_jobs),
        active_jobs=active_jobs,
    ),
)
```

- [ ] **Step 4: Run the targeted test to verify it passes**

Run: `cd backend; $env:PYTHONPATH='.'; uv run --project . --extra dev pytest tests/test_projects_api.py -k "running_job_count" -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/projects.py backend/tests/test_projects_api.py
git commit -m "fix: count running generation targets"
```

### Task 3: Bulk Regeneration API

**Files:**
- Modify: `backend/app/schemas/api.py`
- Modify: `backend/app/api/projects.py`
- Test: `backend/tests/test_projects_api.py`

- [ ] **Step 1: Write the failing backend tests**

```python
def test_bulk_regeneration_job_reprocesses_selected_cells(tmp_path: Path) -> None:
    runtime_manager = FakeRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one", "two"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )
    started = client.post(f"/api/projects/{project_id}/generate/jobs", json={"only_missing": True}).json()
    _wait_for_job(client, project_id, started["id"])
    generated = client.get(f"/api/projects/{project_id}").json()
    selected_ids = [generated["cells"][0]["id"], generated["cells"][1]["id"]]
    original_paths = {cell["id"]: cell["current_result"]["audio_path"] for cell in generated["cells"]}

    regen = client.post(
        f"/api/projects/{project_id}/cells/regeneration-jobs",
        json={"cell_ids": selected_ids, "seed": 55},
    )

    assert regen.status_code == 202
    _wait_for_job(client, project_id, regen.json()["id"])
    refreshed = client.get(f"/api/projects/{project_id}").json()
    for cell in refreshed["cells"]:
        assert cell["current_result"]["seed"] == 55
        assert cell["current_result"]["audio_path"] != original_paths[cell["id"]]
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `cd backend; $env:PYTHONPATH='.'; uv run --project . --extra dev pytest tests/test_projects_api.py -k "bulk_regeneration" -q`
Expected: FAIL with `404` because the endpoint does not exist yet

- [ ] **Step 3: Write the minimal implementation**

```python
class RegenerateCellsRequest(BaseModel):
    cell_ids: list[str]
    seed: int | None = None
```

```python
@router.post(
    "/{project_id}/cells/regeneration-jobs",
    response_model=JobSnapshot,
    status_code=status.HTTP_202_ACCEPTED,
)
def start_bulk_regeneration_job(
    project_id: str,
    payload: RegenerateCellsRequest,
) -> JobSnapshot:
    unique_ids = list(dict.fromkeys(payload.cell_ids))
    if not unique_ids:
        raise HTTPException(status_code=400, detail="At least one cell is required")
    if len(unique_ids) != len(payload.cell_ids):
        raise HTTPException(status_code=400, detail="Duplicate cell ids are not allowed")
    project = load_project(project_id)
    for cell_id in unique_ids:
        try:
            project.get_cell(cell_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
    job = job_registry.create(project.id, "regenerate_cell", unique_ids)
    queue_cells(project_id, unique_ids)

    def run() -> None:
        with get_project_job_lock(project_id):
            worker_project = load_project(project_id)
            try:
                for target_cell_id in unique_ids:
                    generation_service.regenerate_cell(
                        worker_project,
                        target_cell_id,
                        seed=payload.seed,
                        on_state_change=lambda current, changed: persist_job_state(job.id, current, changed),
                    )
            except Exception as exc:
                if job_registry.get(job.id).status == "running":
                    job_registry.mark_failed(job.id, str(exc))

    start_worker(run)
    return job
```

- [ ] **Step 4: Run the targeted test to verify it passes**

Run: `cd backend; $env:PYTHONPATH='.'; uv run --project . --extra dev pytest tests/test_projects_api.py -k "bulk_regeneration" -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/api.py backend/app/api/projects.py backend/tests/test_projects_api.py
git commit -m "feat: add bulk regeneration jobs"
```

### Task 4: Duplicate-Start Guard And Logging

**Files:**
- Create: `backend/app/services/app_log_service.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/api/projects.py`
- Test: `backend/tests/test_projects_api.py`

- [ ] **Step 1: Write the failing backend tests**

```python
def test_duplicate_regeneration_start_returns_conflict(tmp_path: Path) -> None:
    runtime_manager = RegenerationBlockingRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )
    started = client.post(f"/api/projects/{project_id}/generate/jobs", json={"only_missing": True}).json()
    _wait_for_job(client, project_id, started["id"])
    project = client.get(f"/api/projects/{project_id}").json()
    cell_id = project["cells"][0]["id"]

    first = client.post(f"/api/projects/{project_id}/cells/{cell_id}/regeneration-jobs", json={"seed": 11})
    assert first.status_code == 202
    assert runtime_manager.started.wait(timeout=1)

    second = client.post(f"/api/projects/{project_id}/cells/{cell_id}/regeneration-jobs", json={"seed": 12})

    runtime_manager.allow_regeneration.set()
    _wait_for_job(client, project_id, first.json()["id"])
    assert second.status_code == 409
```

```python
def test_logs_endpoint_includes_job_rejection_and_completion(tmp_path: Path) -> None:
    runtime_manager = RegenerationBlockingRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )
    started = client.post(f"/api/projects/{project_id}/generate/jobs", json={"only_missing": True}).json()
    _wait_for_job(client, project_id, started["id"])
    project = client.get(f"/api/projects/{project_id}").json()
    cell_id = project["cells"][0]["id"]

    first = client.post(f"/api/projects/{project_id}/cells/{cell_id}/regeneration-jobs", json={"seed": 11})
    assert first.status_code == 202
    assert runtime_manager.started.wait(timeout=1)
    client.post(f"/api/projects/{project_id}/cells/{cell_id}/regeneration-jobs", json={"seed": 12})
    runtime_manager.allow_regeneration.set()
    _wait_for_job(client, project_id, first.json()["id"])

    logs = client.get(f"/api/logs?project_id={project_id}")
    assert logs.status_code == 200
    events = [entry["event"] for entry in logs.json()]
    assert "job_rejected" in events
    assert "job_completed" in events
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `cd backend; $env:PYTHONPATH='.'; uv run --project . --extra dev pytest tests/test_projects_api.py -k "duplicate_regeneration_start or logs_endpoint" -q`
Expected: FAIL because there is no conflict guard and no logs API

- [ ] **Step 3: Write the minimal implementation**

```python
class AppLogEntry(BaseModel):
    timestamp: datetime = Field(default_factory=_now)
    level: Literal["info", "warning", "error"] = "info"
    event: str
    project_id: str | None = None
    job_id: str | None = None
    message: str
    context: dict[str, str | int | float | bool | None] = Field(default_factory=dict)
```

```python
def reject_if_conflicting_running_job(project_id: str, target_cell_ids: list[str], kind: str) -> None:
    running_jobs = job_registry.list_running_for_project(project_id)
    if kind in {"generate_all", "generate_missing"} and any(
        job.kind in {"generate_all", "generate_missing"} for job in running_jobs
    ):
        log_service.log_warning("job_rejected", project_id=project_id, message="Generation job already running")
        raise HTTPException(status_code=409, detail="A generation job is already running for this project")
    if kind == "regenerate_cell":
        target_set = set(target_cell_ids)
        for job in running_jobs:
            if job.kind == "regenerate_cell" and target_set.intersection(job.target_cell_ids):
                log_service.log_warning("job_rejected", project_id=project_id, message="Selected cell is already regenerating")
                raise HTTPException(status_code=409, detail="One or more selected cells are already regenerating")
```

- [ ] **Step 4: Run the targeted tests to verify they pass**

Run: `cd backend; $env:PYTHONPATH='.'; uv run --project . --extra dev pytest tests/test_projects_api.py -k "duplicate_regeneration_start or logs_endpoint" -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/app_log_service.py backend/app/main.py backend/app/api/projects.py backend/tests/test_projects_api.py
git commit -m "feat: add generation guards and app logs"
```

### Task 5: Frontend Multi-Selection And Bulk Regeneration

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/features/editor/GenerationConsole.tsx`
- Modify: `frontend/src/features/editor/LineMatrix.tsx`
- Modify: `frontend/src/features/editor/ProjectEditor.tsx`
- Test: `frontend/src/features/editor/GenerationConsole.tsx`
- Test: `frontend/src/features/editor/LineMatrix.test.tsx`
- Test: `frontend/src/features/editor/ProjectEditor.test.tsx`
- Test: `frontend/src/App.test.tsx`

- [ ] **Step 1: Write the failing frontend tests**

```tsx
it("shows a bulk regeneration button with selected count", () => {
  render(
    <GenerationConsole
      job={null}
      generationProgress={{ running_job_count: 0, running_job_kinds: [], has_running_jobs: false, active_jobs: [] }}
      busy={false}
      canGenerate
      autoPlay={false}
      selectedRegeneratableCount={2}
      startingJob={false}
      onGenerateMissing={() => {}}
      onGenerateAll={() => {}}
      onRegenerateSelected={() => {}}
      onToggleAutoPlay={() => {}}
    />,
  );

  expect(screen.getByRole("button", { name: "選択セルを再生成 (2)" })).toBeEnabled();
});
```

```tsx
it("toggles cell selection without losing focused cell", async () => {
  const onSelectionChange = vi.fn();
  render(<LineMatrix {...matrixProps({ selectedCellIds: [], onSelectionChange })} />);
  await userEvent.click(screen.getByLabelText("セル選択: toru / one"));
  expect(onSelectionChange).toHaveBeenCalledWith(["cell-1"]);
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `cd frontend; npx vitest run src/features/editor/LineMatrix.test.tsx src/features/editor/ProjectEditor.test.tsx src/App.test.tsx`
Expected: FAIL because the new props and controls do not exist

- [ ] **Step 3: Write the minimal implementation**

```ts
export function startBulkRegenerationJob(
  projectId: string,
  cellIds: string[],
  seed: number | null,
): Promise<GenerationJob> {
  return request(`/api/projects/${projectId}/cells/regeneration-jobs`, json("POST", { cell_ids: cellIds, seed }));
}
```

```tsx
const [selectedCellIds, setSelectedCellIds] = useState<string[]>([]);
const [startingJob, setStartingJob] = useState(false);
```

```tsx
<GenerationConsole
  ...
  selectedRegeneratableCount={selectedRegeneratableCellIds.length}
  startingJob={startingJob}
  onRegenerateSelected={() => void startJob(() => api.startBulkRegenerationJob(project.id, selectedRegeneratableCellIds, null))}
/>
```

- [ ] **Step 4: Run the targeted tests to verify they pass**

Run: `cd frontend; npx vitest run src/features/editor/LineMatrix.test.tsx src/features/editor/ProjectEditor.test.tsx src/App.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/types.ts frontend/src/App.tsx frontend/src/features/editor/GenerationConsole.tsx frontend/src/features/editor/LineMatrix.tsx frontend/src/features/editor/ProjectEditor.tsx frontend/src/features/editor/LineMatrix.test.tsx frontend/src/features/editor/ProjectEditor.test.tsx frontend/src/App.test.tsx
git commit -m "feat: add bulk cell regeneration"
```

### Task 6: Frontend Log Viewer And Start Guard UX

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/features/editor/ProjectEditor.tsx`
- Test: `frontend/src/api/client.test.ts`
- Test: `frontend/src/App.test.tsx`
- Test: `frontend/src/features/editor/ProjectEditor.test.tsx`

- [ ] **Step 1: Write the failing frontend tests**

```tsx
it("disables generation buttons immediately while a start request is in flight", async () => {
  let release!: () => void;
  vi.spyOn(api, "startGenerationJob").mockImplementation(
    () => new Promise((resolve) => {
      release = () => resolve(runningJob);
    }),
  );
  renderAppAtProject();
  await userEvent.click(screen.getByRole("button", { name: "未生成を実行" }));
  expect(screen.getByRole("button", { name: "全セルを実行" })).toBeDisabled();
  release();
});
```

```tsx
it("renders project logs when the log API succeeds", async () => {
  vi.spyOn(api, "getProjectLogs").mockResolvedValue([
    { id: "log-1", timestamp: "2026-06-16T00:00:00Z", level: "warning", event: "job_rejected", project_id: "project-1", job_id: null, message: "Selected cell is already regenerating", context: {} },
  ]);
  renderProjectEditor();
  expect(await screen.findByText("job_rejected")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `cd frontend; npx vitest run src/api/client.test.ts src/App.test.tsx src/features/editor/ProjectEditor.test.tsx`
Expected: FAIL because there is no log API client and no start-specific lock

- [ ] **Step 3: Write the minimal implementation**

```ts
export type AppLogEntry = {
  id: string;
  timestamp: string;
  level: "info" | "warning" | "error";
  event: string;
  project_id: string | null;
  job_id: string | null;
  message: string;
  context: Record<string, string | number | boolean | null>;
};
```

```tsx
async function startJob(action: () => Promise<GenerationJob>) {
  setStartingJob(true);
  setBusy(true);
  ...
  setStartingJob(false);
}
```

- [ ] **Step 4: Run the targeted tests to verify they pass**

Run: `cd frontend; npx vitest run src/api/client.test.ts src/App.test.tsx src/features/editor/ProjectEditor.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/types.ts frontend/src/App.tsx frontend/src/features/editor/ProjectEditor.tsx frontend/src/api/client.test.ts frontend/src/App.test.tsx frontend/src/features/editor/ProjectEditor.test.tsx
git commit -m "feat: show project logs and guard job starts"
```

### Task 7: Final Verification

**Files:**
- Modify: only files changed by previous tasks if fallout appears

- [ ] **Step 1: Run backend verification**

Run: `cd backend; $env:PYTHONPATH='.'; uv run --project . --extra dev pytest tests/test_projects_api.py -q`
Expected: PASS

- [ ] **Step 2: Run frontend verification**

Run: `cd frontend; npx vitest run`
Expected: PASS

- [ ] **Step 3: Run production build**

Run: `cd frontend; npm run build`
Expected: PASS

- [ ] **Step 4: Commit any fallout fixes**

```bash
git add <only fallout files if needed>
git commit -m "fix: polish generation stability batch"
```
