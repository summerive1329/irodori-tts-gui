# Irodori GUI Frontend Logging And Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make selection-mode cells visually obvious and add separated frontend logging with local buffering plus backend ingestion.

**Architecture:** Keep the existing project log view and backend log service, but extend the log schema with `source`, split file output into backend/frontend directories, and add a dedicated frontend log queue backed by `localStorage`. On the UI side, preserve the current click-to-select flow and make selection visible via CSS classes and markers instead of changing interaction semantics.

**Tech Stack:** FastAPI, Pydantic, React, TypeScript, Vitest, pytest, localStorage

---

### Task 1: Extend Shared Log Types And Backend Log Storage

**Files:**
- Modify: `backend/app/services/app_log_service.py`
- Modify: `backend/app/main.py`
- Modify: `frontend/src/types.ts`
- Test: `backend/tests/test_projects_api.py`

- [ ] **Step 1: Write the failing backend tests for log source separation**

```python
def test_backend_logs_are_tagged_with_backend_source(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]

    logs = client.get(f"/api/logs?project_id={project_id}")

    assert logs.status_code == 200
    assert all(entry["source"] == "backend" for entry in logs.json())


def test_backend_logs_are_written_under_backend_directory(tmp_path: Path) -> None:
    client = _client(tmp_path)
    client.post("/api/projects", json={"name": "demo"})

    backend_logs_dir = tmp_path.parent / "logs" / "backend"
    log_files = list(backend_logs_dir.glob("app-*.log"))

    assert len(log_files) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend; $env:PYTHONPATH='.'; uv run --project . --extra dev pytest tests/test_projects_api.py -k "backend_source or backend_directory" -q`
Expected: FAIL because `source` does not exist and logs still write directly under `logs/`

- [ ] **Step 3: Write minimal implementation**

```python
LogSource = Literal["backend", "frontend"]


class AppLogEntry(BaseModel):
    ...
    source: LogSource = "backend"
```

```python
session_log_path = logs_dir / "backend" / f"app-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}.log"
log_service = AppLogService(log_path=session_log_path, source="backend")
```

```ts
export type AppLogEntry = {
  id: string;
  timestamp: string;
  level: "info" | "warning" | "error";
  source: "backend" | "frontend";
  event: string;
  project_id: string | null;
  job_id: string | null;
  message: string;
  context: Record<string, string | number | boolean | null>;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend; $env:PYTHONPATH='.'; uv run --project . --extra dev pytest tests/test_projects_api.py -k "backend_source or backend_directory" -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/app_log_service.py backend/app/main.py frontend/src/types.ts backend/tests/test_projects_api.py
git commit -m "feat: separate backend log source metadata"
```

### Task 2: Add Frontend Log Ingest API And Frontend File Output

**Files:**
- Modify: `backend/app/main.py`
- Modify: `backend/app/services/app_log_service.py`
- Test: `backend/tests/test_projects_api.py`

- [ ] **Step 1: Write the failing backend tests for frontend log ingestion**

```python
def test_frontend_logs_are_accepted_and_tagged(tmp_path: Path) -> None:
    client = _client(tmp_path)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]

    response = client.post(
        "/api/frontend-logs",
        json={
            "entries": [
                {
                    "timestamp": "2026-06-16T00:00:00Z",
                    "level": "error",
                    "event": "api_request_failed",
                    "project_id": project_id,
                    "job_id": None,
                    "message": "Failed to load project logs",
                    "context": {"session_id": "session-1", "request_path": "/api/logs"},
                }
            ]
        },
    )

    assert response.status_code == 202
    logs = client.get(f"/api/logs?project_id={project_id}").json()
    assert any(entry["source"] == "frontend" and entry["event"] == "api_request_failed" for entry in logs)


def test_frontend_logs_are_written_under_frontend_directory(tmp_path: Path) -> None:
    client = _client(tmp_path)
    client.post(
        "/api/frontend-logs",
        json={
            "entries": [
                {
                    "timestamp": "2026-06-16T00:00:00Z",
                    "level": "warning",
                    "event": "selection_mode_entered",
                    "project_id": None,
                    "job_id": None,
                    "message": "Selection mode entered",
                    "context": {"session_id": "session-1"},
                }
            ]
        },
    )

    frontend_logs_dir = tmp_path.parent / "logs" / "frontend"
    assert len(list(frontend_logs_dir.glob("app-*.log"))) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend; $env:PYTHONPATH='.'; uv run --project . --extra dev pytest tests/test_projects_api.py -k "frontend_logs_are_accepted or frontend_logs_are_written" -q`
Expected: FAIL because `/api/frontend-logs` does not exist

- [ ] **Step 3: Write minimal implementation**

```python
frontend_log_path = logs_dir / "frontend" / f"app-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}.log"
frontend_log_service = AppLogService(log_path=frontend_log_path, source="frontend")
```

```python
class FrontendLogIngestEntry(BaseModel):
    timestamp: datetime
    level: LogLevel
    event: str
    project_id: str | None = None
    job_id: str | None = None
    message: str
    context: dict[str, LogContextValue] = Field(default_factory=dict)


@app.post("/api/frontend-logs", status_code=202)
def ingest_frontend_logs(payload: FrontendLogIngestRequest) -> dict[str, int]:
    for item in payload.entries:
        frontend_log_service.log(
            item.level,
            item.event,
            project_id=item.project_id,
            job_id=item.job_id,
            message=item.message,
            context=item.context,
            timestamp=item.timestamp,
            source="frontend",
        )
    return {"accepted": len(payload.entries)}
```

```python
def list_logs(project_id: str | None = None) -> list[dict]:
    entries = (
        log_service.list_entries(project_id=project_id)
        + frontend_log_service.list_entries(project_id=project_id)
    )
    return [entry.model_dump(mode="json") for entry in sorted(entries, key=lambda entry: entry.timestamp, reverse=True)]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend; $env:PYTHONPATH='.'; uv run --project . --extra dev pytest tests/test_projects_api.py -k "frontend_logs_are_accepted or frontend_logs_are_written" -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/app/services/app_log_service.py backend/tests/test_projects_api.py
git commit -m "feat: ingest frontend logs separately"
```

### Task 3: Add Frontend Log Queue And Client API

**Files:**
- Create: `frontend/src/features/logging/frontendLogStore.ts`
- Create: `frontend/src/features/logging/frontendLogStore.test.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/client.test.ts`
- Modify: `frontend/src/types.ts`

- [ ] **Step 1: Write the failing frontend tests for queueing and flushing**

```tsx
it("stores frontend log entries in localStorage until flush succeeds", async () => {
  const postLogs = vi.fn().mockResolvedValue({ accepted: 1 });
  const store = createFrontendLogStore({ storage: window.localStorage, postLogs });

  store.enqueue({
    level: "error",
    event: "api_request_failed",
    projectId: "project-1",
    message: "request failed",
    context: { request_path: "/api/logs" },
  });

  expect(store.snapshot()).toHaveLength(1);

  await store.flush();

  expect(postLogs).toHaveBeenCalledTimes(1);
  expect(store.snapshot()).toHaveLength(0);
});

it("keeps queued entries when flush fails", async () => {
  const postLogs = vi.fn().mockRejectedValue(new Error("offline"));
  const store = createFrontendLogStore({ storage: window.localStorage, postLogs });

  store.enqueue({
    level: "error",
    event: "api_request_failed",
    projectId: "project-1",
    message: "request failed",
    context: { request_path: "/api/logs" },
  });

  await store.flush();

  expect(store.snapshot()).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend; npx vitest run src/features/logging/frontendLogStore.test.ts src/api/client.test.ts`
Expected: FAIL because the store and frontend log API do not exist

- [ ] **Step 3: Write minimal implementation**

```ts
export type FrontendLogPayloadEntry = {
  timestamp: string;
  level: "info" | "warning" | "error";
  event: string;
  project_id: string | null;
  job_id: string | null;
  message: string;
  context: Record<string, string | number | boolean | null>;
};
```

```ts
const STORAGE_KEY = "irodori.frontend-log-queue";
const MAX_ENTRIES = 200;

export function createFrontendLogStore(...) {
  function enqueue(input: ...) { ... }
  function snapshot() { ... }
  async function flush() { ... }
  return { enqueue, snapshot, flush, sessionId };
}
```

```ts
export function postFrontendLogs(entries: FrontendLogPayloadEntry[]): Promise<{ accepted: number }> {
  return request("/api/frontend-logs", json("POST", { entries }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend; npx vitest run src/features/logging/frontendLogStore.test.ts src/api/client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/logging/frontendLogStore.ts frontend/src/features/logging/frontendLogStore.test.ts frontend/src/api/client.ts frontend/src/api/client.test.ts frontend/src/types.ts
git commit -m "feat: buffer frontend logs locally"
```

### Task 4: Wire Frontend Logging Into App Flow And Selection UI

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`
- Modify: `frontend/src/features/editor/LineMatrix.tsx`
- Modify: `frontend/src/features/editor/LineMatrix.test.tsx`
- Modify: `frontend/src/features/editor/ProjectEditor.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Write the failing frontend tests for visible selection and logging hooks**

```tsx
it("marks selected cells with a dedicated selected class", async () => {
  const user = userEvent.setup();
  const props = matrixProps();
  props.selectionMode = true;
  props.selectedCellIds = ["cell-1"];

  render(<LineMatrix {...props} />);

  expect(screen.getByLabelText("音声: toru / hello").closest("article")).toHaveClass("is-selected");
});

it("queues a frontend log when project log refresh fails", async () => {
  window.history.pushState({}, "", "/projects/project-1");
  apiMocks.getProject.mockResolvedValue(projectWithCells);
  apiMocks.getProjectLogs.mockRejectedValue(new Error("network down"));

  render(<AppRouter />);

  expect(await screen.findByRole("button", { name: "network down" })).toBeInTheDocument();
  expect(window.localStorage.getItem("irodori.frontend-log-queue")).toContain("project_log_refresh_failed");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend; npx vitest run src/features/editor/LineMatrix.test.tsx src/App.test.tsx`
Expected: FAIL because selection visibility and frontend log queue integration are not implemented yet

- [ ] **Step 3: Write minimal implementation**

```tsx
const frontendLogs = useRef(createFrontendLogStore({ storage: window.localStorage, postLogs: api.postFrontendLogs }));
```

```tsx
function logFrontendEvent(...) {
  frontendLogs.current.enqueue(...);
  void frontendLogs.current.flush();
}
```

```tsx
onEnterSelectionMode={() => {
  setSelectionMode(true);
  setSelectedCellIds([]);
  logFrontendEvent("selection_mode_entered", "Selection mode entered", { selection_mode: true });
}}
```

```tsx
className={`result-cell ...${isSelected ? " is-selected" : ""}`}
```

```css
.result-cell.is-selected {
  position: relative;
  box-shadow: inset 0 0 0 2px var(--blue);
  background: linear-gradient(180deg, rgba(214, 231, 251, 0.92), rgba(255, 255, 255, 0.5));
}

.result-cell.is-selected::after {
  content: "SELECTED";
  position: absolute;
  top: 8px;
  right: 10px;
  color: var(--blue);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.12em;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend; npx vitest run src/features/editor/LineMatrix.test.tsx src/App.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/features/editor/LineMatrix.tsx frontend/src/features/editor/LineMatrix.test.tsx frontend/src/features/editor/ProjectEditor.tsx frontend/src/styles.css
git commit -m "feat: highlight selected cells and sync frontend logs"
```

### Task 5: Update Demand Document And Verify End To End

**Files:**
- Modify: `docs/communication/demand.md`
- Modify: fallout files only if needed

- [ ] **Step 1: Move completed items in the demand document**

```md
Move these items from pending/recheck into a clearly completed section:
- 選択したセルの視覚強化
- フロントエンド、バックエンドのログを両方取りたい
```

- [ ] **Step 2: Verify document shape**

Run: `Get-Content docs/communication/demand.md -Raw`
Expected: completed items are no longer duplicated under pending sections

- [ ] **Step 3: Run backend verification**

Run: `cd backend; $env:PYTHONPATH='.'; uv run --project . --extra dev pytest tests/test_projects_api.py -q`
Expected: PASS

- [ ] **Step 4: Run frontend verification**

Run: `cd frontend; npx vitest run`
Expected: PASS

- [ ] **Step 5: Run production build**

Run: `cd frontend; npm run build`
Expected: PASS

- [ ] **Step 6: Commit document updates and fallout only if needed**

```bash
git add docs/communication/demand.md
git commit -m "docs: refresh frontend logging demand status"
```
