# Irodori GUI Regeneration Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make generation counts decrement as cells complete, move bulk regeneration to an explicit selection mode, write app logs to timestamped files under `logs/`, and update the demand document to reflect completed work.

**Architecture:** Keep the existing job registry and app log service, but tighten their semantics. Backend computes remaining-cell counts and mirrors logs to disk; frontend replaces always-visible selection controls with a lightweight mode switch while preserving normal cell focus behavior.

**Tech Stack:** FastAPI, Pydantic, React, TypeScript, Vitest, pytest

---

### Task 1: Spec And Plan

**Files:**
- Create: `docs/superpowers/specs/2026-06-16-irodori-gui-regeneration-followup-design.md`
- Create: `docs/superpowers/plans/2026-06-16-irodori-gui-regeneration-followup.md`

- [ ] **Step 1: Write the spec and plan files**

```md
Cover only:
- decrementing running counts
- explicit selection mode for bulk regeneration
- file-backed logs under logs/
- demand.md cleanup after implementation
```

- [ ] **Step 2: Run placeholder scan**

Run: `rg -n "TBD|TODO|placeholder" docs/superpowers/specs/2026-06-16-irodori-gui-regeneration-followup-design.md docs/superpowers/plans/2026-06-16-irodori-gui-regeneration-followup.md`
Expected: no matches

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-16-irodori-gui-regeneration-followup-design.md docs/superpowers/plans/2026-06-16-irodori-gui-regeneration-followup.md
git commit -m "docs: plan regeneration follow-up batch"
```

### Task 2: Remaining Generation Count

**Files:**
- Modify: `backend/app/api/projects.py`
- Test: `backend/tests/test_projects_api.py`

- [ ] **Step 1: Write the failing backend test**

```python
def test_running_job_count_decrements_as_cells_complete(tmp_path: Path) -> None:
    runtime_manager = BlockingRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one", "two"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )

    started = client.post(f"/api/projects/{project_id}/generate/jobs", json={"only_missing": True})
    assert started.status_code == 202
    assert runtime_manager.started.wait(timeout=1)

    running = client.get(f"/api/projects/{project_id}").json()
    assert running["generation_progress"]["running_job_count"] == 2

    runtime_manager.release.set()
    _wait_for_job(client, project_id, started.json()["id"])

    final_project = client.get(f"/api/projects/{project_id}").json()
    assert final_project["generation_progress"]["running_job_count"] == 0
```

- [ ] **Step 2: Run test to verify it fails for the intended reason**

Run: `cd backend; $env:PYTHONPATH='.'; uv run --project . --extra dev pytest tests/test_projects_api.py -k "decrements_as_cells_complete" -q`
Expected: FAIL before implementation if the count stays fixed while partially completed

- [ ] **Step 3: Write minimal implementation**

```python
running_job_count=sum(
    max(job.total_cells - job.completed_cells, 0)
    for job in running_jobs
),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend; $env:PYTHONPATH='.'; uv run --project . --extra dev pytest tests/test_projects_api.py -k "decrements_as_cells_complete" -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/projects.py backend/tests/test_projects_api.py
git commit -m "fix: decrement remaining generation count"
```

### Task 3: File-Backed Logs

**Files:**
- Modify: `backend/app/services/app_log_service.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_projects_api.py`

- [ ] **Step 1: Write the failing backend test**

```python
def test_logs_are_written_to_timestamped_file(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]

    logs_dir = tmp_path / "logs"
    log_files = list(logs_dir.glob("app-*.log"))

    assert len(log_files) == 1
    content = log_files[0].read_text(encoding="utf-8")
    assert "job_created" in content or content == ""
```
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend; $env:PYTHONPATH='.'; uv run --project . --extra dev pytest tests/test_projects_api.py -k "timestamped_file" -q`
Expected: FAIL because no logs directory/file exists yet

- [ ] **Step 3: Write minimal implementation**

```python
logs_dir = resolved_data_dir.parent / "logs"
logs_dir.mkdir(parents=True, exist_ok=True)
session_log_path = logs_dir / f"app-{datetime.now().strftime('%Y%m%d-%H%M%S')}.log"
log_service = AppLogService(log_path=session_log_path)
```

```python
with self._lock:
    self._entries.append(entry)
    if self._log_path is not None:
        self._log_path.parent.mkdir(parents=True, exist_ok=True)
        with self._log_path.open("a", encoding="utf-8") as handle:
            handle.write(...)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend; $env:PYTHONPATH='.'; uv run --project . --extra dev pytest tests/test_projects_api.py -k "timestamped_file" -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/app_log_service.py backend/app/main.py backend/tests/test_projects_api.py
git commit -m "feat: write app logs to files"
```

### Task 4: Selection-Mode Bulk Regeneration UX

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/features/editor/GenerationConsole.tsx`
- Modify: `frontend/src/features/editor/LineMatrix.tsx`
- Modify: `frontend/src/features/editor/ProjectEditor.tsx`
- Test: `frontend/src/features/editor/LineMatrix.test.tsx`
- Test: `frontend/src/features/editor/ProjectEditor.test.tsx`
- Test: `frontend/src/App.test.tsx`

- [ ] **Step 1: Write the failing frontend tests**

```tsx
it("enters selection mode before allowing bulk regeneration", async () => {
  render(<ProjectEditor {...editorProps} />);
  await user.click(screen.getByRole("button", { name: "複数選択で再生成" }));
  expect(screen.getByText("セルをクリックして選択")).toBeInTheDocument();
});
```

```tsx
it("uses cell clicks to toggle selection only while selection mode is active", async () => {
  render(<LineMatrix {...props} selectionMode />);
  await user.click(screen.getByText("未再生"));
  expect(props.onToggleCellSelection).toHaveBeenCalledWith("cell-1");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend; npx vitest run src/features/editor/LineMatrix.test.tsx src/features/editor/ProjectEditor.test.tsx src/App.test.tsx`
Expected: FAIL because selection mode UI does not exist yet

- [ ] **Step 3: Write minimal implementation**

```tsx
const [selectionMode, setSelectionMode] = useState(false);
```

```tsx
{selectionMode ? (
  <>
    <button ...>選択セルを再生成 ({selectedRegeneratableCount})</button>
    <button ...>キャンセル</button>
    <span>セルをクリックして選択</span>
  </>
) : (
  <button ...>複数選択で再生成</button>
)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend; npx vitest run src/features/editor/LineMatrix.test.tsx src/features/editor/ProjectEditor.test.tsx src/App.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/features/editor/GenerationConsole.tsx frontend/src/features/editor/LineMatrix.tsx frontend/src/features/editor/ProjectEditor.tsx frontend/src/features/editor/LineMatrix.test.tsx frontend/src/features/editor/ProjectEditor.test.tsx frontend/src/App.test.tsx
git commit -m "feat: switch bulk regeneration to selection mode"
```

### Task 5: Demand Document Cleanup

**Files:**
- Modify: `docs/communication/demand.md`

- [ ] **Step 1: Update the demand document**

```md
Move completed items out of "未対応" and into a clear completed or re-check section:
- generation count decrement behavior
- selection mode bulk regeneration UI
- file-backed logs
```

- [ ] **Step 2: Verify document shape**

Run: `Get-Content docs/communication/demand.md -Raw`
Expected: completed items are no longer duplicated under `未対応`

- [ ] **Step 3: Commit**

```bash
git add docs/communication/demand.md
git commit -m "docs: refresh demand status"
```

### Task 6: Final Verification

**Files:**
- Modify: only fallout files if needed

- [ ] **Step 1: Run backend verification**

Run: `cd backend; $env:PYTHONPATH='.'; uv run --project . --extra dev pytest tests/test_projects_api.py -q`
Expected: PASS

- [ ] **Step 2: Run frontend verification**

Run: `cd frontend; npx vitest run`
Expected: PASS

- [ ] **Step 3: Run production build**

Run: `cd frontend; npm run build`
Expected: PASS

- [ ] **Step 4: Commit fallout only if needed**

```bash
git add <fallout files only>
git commit -m "fix: polish regeneration follow-up batch"
```
