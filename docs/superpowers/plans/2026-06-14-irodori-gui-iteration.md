# Irodori GUI Iteration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the current Irodori GUI from a single-row export selector into a job-driven, route-persistent, playlist-based editor with clearer Japanese UX and safer regeneration behavior.

**Architecture:** The backend will first migrate the project model from `selected_for_export` to `export_playlist` and introduce an in-process generation job registry. The frontend will then switch from in-memory project selection to route-based loading, poll backend job/project state for cell-level updates, and split the UI into a matrix workspace plus a dedicated export playlist editor.

**Tech Stack:** FastAPI, Pydantic, pytest, React, TypeScript, React Router, Vitest, Testing Library

---

## File Structure

### Backend

- Modify: `backend/app/models/project.py`
- Modify: `backend/app/schemas/api.py`
- Modify: `backend/app/api/projects.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/services/generation_service.py`
- Modify: `backend/app/services/export_service.py`
- Create: `backend/app/services/job_registry.py`
- Create: `backend/tests/test_job_registry.py`
- Modify: `backend/tests/test_project_model.py`
- Modify: `backend/tests/test_generation_service.py`
- Modify: `backend/tests/test_export_service.py`
- Modify: `backend/tests/test_projects_api.py`

### Frontend

- Modify: `frontend/package.json`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`
- Modify: `frontend/src/styles.css`
- Create: `frontend/src/router.tsx`
- Create: `frontend/src/features/editor/ExportPlaylist.tsx`
- Create: `frontend/src/features/editor/GenerationConsole.tsx`
- Create: `frontend/src/features/editor/useProjectJobs.ts`
- Modify: `frontend/src/features/editor/ProjectEditor.tsx`
- Modify: `frontend/src/features/editor/LineMatrix.tsx`
- Modify: `frontend/src/features/editor/CellDetailPane.tsx`
- Modify: `frontend/src/features/editor/ReferenceSidebar.tsx`
- Modify: `frontend/src/features/projects/ProjectHome.tsx`
- Create: `frontend/src/features/editor/ExportPlaylist.test.tsx`
- Modify: `frontend/src/features/editor/LineMatrix.test.tsx`
- Modify: `frontend/src/features/editor/ProjectEditor.test.tsx`

### Docs

- Modify: `README.md`

---

### Task 1: Migrate The Backend Project Model

**Files:**
- Modify: `backend/app/models/project.py`
- Modify: `backend/tests/test_project_model.py`

- [ ] **Step 1: Write the failing playlist model test**

Add a new test in `backend/tests/test_project_model.py`:

```python
def test_project_can_append_duplicate_playlist_items() -> None:
    project = Project.create("demo")
    project.append_lines(["line a"])
    reference = project.add_reference(
        label="lize",
        source_filename="lize.mp3",
        copied_path="references/lize.mp3",
        duration_sec=1.0,
    )
    cell = project.find_cell(project.lines[0].id, reference.id)
    cell.current_result = CellResult(
        audio_path="cells/a.wav",
        sample_rate=48000,
        duration_sec=1.0,
    )

    first = project.append_playlist_item(cell.id)
    second = project.append_playlist_item(cell.id)

    assert first.cell_id == cell.id
    assert second.cell_id == cell.id
    assert [item.cell_id for item in project.export_playlist] == [cell.id, cell.id]
```

- [ ] **Step 2: Run the model test and verify it fails**

Run: `.\vendor\Irodori-TTS\.venv\Scripts\python.exe -m pytest backend\tests\test_project_model.py -v`

Expected: FAIL with missing `export_playlist` or `append_playlist_item`

- [ ] **Step 3: Add playlist and expanded cell state support**

Update `backend/app/models/project.py` with:

```python
class ExportPlaylistItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    cell_id: str
    line_id: str
    reference_id: str
    label: str
    created_at: datetime = Field(default_factory=_now)


class Cell(BaseModel):
    ...
    status: Literal["idle", "queued", "generating", "ready", "error"] = "idle"
    ...


class Project(BaseModel):
    ...
    export_playlist: list[ExportPlaylistItem] = Field(default_factory=list)
```

- [ ] **Step 4: Implement playlist mutation helpers**

Add methods to `Project`:

```python
def append_playlist_item(self, cell_id: str) -> ExportPlaylistItem:
    cell = self.get_cell(cell_id)
    if cell.current_result is None:
        raise ValueError("Only generated cells can be added to the export playlist")
    line = next(item for item in self.lines if item.id == cell.line_id)
    reference = next(item for item in self.references if item.id == cell.reference_id)
    item = ExportPlaylistItem(
        cell_id=cell.id,
        line_id=line.id,
        reference_id=reference.id,
        label=f"{reference.label} / {line.text[:24]}",
    )
    self.export_playlist.append(item)
    self.touch()
    return item


def remove_playlist_item(self, playlist_item_id: str) -> None:
    ...


def reorder_playlist(self, ordered_ids: list[str]) -> None:
    ...
```

- [ ] **Step 5: Replace insert/reorder line behavior in the model**

Add explicit insertion support:

```python
def insert_line(self, index: int, text: str) -> LineItem:
    clean_text = text.strip()
    if not clean_text:
        raise ValueError("Line text is required")
    line = LineItem(text=clean_text, order_index=index)
    self.lines.append(line)
    for reference in self.references:
        self.cells.append(Cell(line_id=line.id, reference_id=reference.id))
    self._reindex_lines()
    self.touch()
    return line
```

- [ ] **Step 6: Add a helper for line reindexing and remove `selected_for_export` APIs**

Use:

```python
def _reindex_lines(self) -> None:
    for index, line in enumerate(self.ordered_lines()):
        line.order_index = index
```

Then delete:

```python
selected_for_export: bool = False
def select_export_cell(...)
```

- [ ] **Step 7: Re-run the model tests**

Run: `.\vendor\Irodori-TTS\.venv\Scripts\python.exe -m pytest backend\tests\test_project_model.py -v`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/app/models/project.py backend/tests/test_project_model.py
git commit -m "feat: add export playlist project model"
```

### Task 2: Add Backend Job Tracking And Safer Regeneration

**Files:**
- Create: `backend/app/services/job_registry.py`
- Modify: `backend/app/services/generation_service.py`
- Create: `backend/tests/test_job_registry.py`
- Modify: `backend/tests/test_generation_service.py`

- [ ] **Step 1: Write the failing regeneration isolation test**

Add this to `backend/tests/test_generation_service.py`:

```python
def test_regenerate_preserves_other_reference_results(tmp_path: Path) -> None:
    project = Project.create("demo")
    project.append_lines(["same line"])
    left = project.add_reference("lize", "lize.mp3", "references/lize.mp3", 1.0)
    right = project.add_reference("toru", "toru.mp3", "references/toru.mp3", 1.0)

    target = project.find_cell(project.lines[0].id, left.id)
    neighbor = project.find_cell(project.lines[0].id, right.id)
    neighbor.current_result = CellResult(
        audio_path="cells/right.wav",
        sample_rate=48000,
        duration_sec=1.0,
    )

    runtime = StubRuntimeBackend()
    service = GenerationService(runtime, tmp_path)
    service.regenerate_cell(project, target.id, seed=7)

    assert neighbor.current_result is not None
    assert neighbor.current_result.audio_path == "cells/right.wav"
```

- [ ] **Step 2: Write the failing job registry test**

Create `backend/tests/test_job_registry.py`:

```python
def test_registry_tracks_completed_cells() -> None:
    registry = JobRegistry()
    job = registry.create(project_id="p1", kind="generate_missing", target_cell_ids=["a", "b"])

    registry.mark_generating(job.id, "a")
    registry.mark_completed(job.id, "a")

    snapshot = registry.get(job.id)
    assert snapshot.completed_cells == 1
    assert snapshot.total_cells == 2
    assert snapshot.status == "running"
```

- [ ] **Step 3: Run the failing backend tests**

Run:

```bash
.\vendor\Irodori-TTS\.venv\Scripts\python.exe -m pytest backend\tests\test_generation_service.py backend\tests\test_job_registry.py -v
```

Expected: FAIL for missing registry and state support

- [ ] **Step 4: Implement the job registry**

Create `backend/app/services/job_registry.py`:

```python
class JobSnapshot(BaseModel):
    id: str
    project_id: str
    kind: Literal["generate_missing", "generate_all", "regenerate_cell"]
    status: Literal["running", "completed", "failed"] = "running"
    total_cells: int
    completed_cells: int = 0
    target_cell_ids: list[str]
    active_cell_id: str | None = None
    error_message: str | None = None
```

Add `create`, `get`, `mark_generating`, `mark_completed`, and `mark_failed`.

- [ ] **Step 5: Update `GenerationService` to preserve old takes during regeneration**

Use this shape inside `_generate_cell`:

```python
previous_result = cell.current_result
cell.status = "generating"
cell.error_message = None
try:
    artifact = self.runtime_manager.synthesize(...)
except Exception as exc:
    cell.status = "error"
    cell.current_result = previous_result
    cell.error_message = str(exc)
    raise
```

- [ ] **Step 6: Introduce `queued` transitions for batch generation**

Before synthesis starts:

```python
for cell in cells:
    cell.status = "queued"
    cell.error_message = None
```

Then only flip the active cell to `generating` when it is actually being synthesized.

- [ ] **Step 7: Re-run the backend job and generation tests**

Run:

```bash
.\vendor\Irodori-TTS\.venv\Scripts\python.exe -m pytest backend\tests\test_generation_service.py backend\tests\test_job_registry.py -v
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/job_registry.py backend/app/services/generation_service.py backend/tests/test_job_registry.py backend/tests/test_generation_service.py
git commit -m "feat: add generation job tracking"
```

### Task 3: Expand Backend API For Jobs, Playlist, Txt Export, And Insertions

**Files:**
- Modify: `backend/app/schemas/api.py`
- Modify: `backend/app/api/projects.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_projects_api.py`

- [ ] **Step 1: Write the failing API tests**

Add tests in `backend/tests/test_projects_api.py` for:

```python
def test_generate_all_returns_job_snapshot() -> None: ...
def test_append_playlist_item_endpoint_allows_duplicates() -> None: ...
def test_append_reference_column_to_playlist_uses_line_order() -> None: ...
def test_insert_line_endpoint_places_line_in_requested_slot() -> None: ...
def test_export_lines_txt_returns_plain_text() -> None: ...
```

- [ ] **Step 2: Run the API tests and verify they fail**

Run: `.\vendor\Irodori-TTS\.venv\Scripts\python.exe -m pytest backend\tests\test_projects_api.py -v`

Expected: FAIL with missing endpoints and schema mismatches

- [ ] **Step 3: Add request and response schemas**

Update `backend/app/schemas/api.py`:

```python
class InsertLineRequest(BaseModel):
    index: int = Field(ge=0)
    text: str


class PlaylistAppendRequest(BaseModel):
    cell_id: str


class PlaylistReorderRequest(BaseModel):
    playlist_item_ids: list[str]
```

Add:

```python
class JobResponse(BaseModel):
    id: str
    project_id: str
    kind: str
    status: str
    total_cells: int
    completed_cells: int
    target_cell_ids: list[str]
    active_cell_id: str | None = None
    error_message: str | None = None
```

- [ ] **Step 4: Wire job endpoints**

Add API routes like:

```python
@router.post("/{project_id}/generate/jobs", response_model=JobResponse)
def start_generate_job(...): ...

@router.get("/{project_id}/jobs/{job_id}", response_model=JobResponse)
def get_job(...): ...
```

Use `BackgroundTasks` or a short-lived thread to dispatch generation work after the response.

- [ ] **Step 5: Add playlist endpoints**

Add:

```python
@router.post("/{project_id}/playlist/items", response_model=Project)
def append_playlist_item(...): ...

@router.post("/{project_id}/playlist/references/{reference_id}", response_model=Project)
def append_reference_column_to_playlist(...): ...

@router.delete("/{project_id}/playlist/items/{playlist_item_id}", response_model=Project)
def remove_playlist_item(...): ...

@router.put("/{project_id}/playlist/order", response_model=Project)
def reorder_playlist(...): ...
```

- [ ] **Step 6: Add line insertion and txt export endpoints**

Add:

```python
@router.post("/{project_id}/lines/insert", response_model=Project)
def insert_line(...): ...

@router.get("/{project_id}/lines.txt")
def export_lines_text(...): ...
```

Return the txt response with:

```python
return Response("\n".join(line.text for line in project.ordered_lines()), media_type="text/plain; charset=utf-8")
```

- [ ] **Step 7: Mount the registry in `main.py`**

Create a single `JobRegistry()` instance inside `create_app()` and pass it to the router factory.

- [ ] **Step 8: Re-run the API tests**

Run: `.\vendor\Irodori-TTS\.venv\Scripts\python.exe -m pytest backend\tests\test_projects_api.py -v`

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add backend/app/schemas/api.py backend/app/api/projects.py backend/app/main.py backend/tests/test_projects_api.py
git commit -m "feat: expose playlist and generation job APIs"
```

### Task 4: Rework Export Services Around The Playlist

**Files:**
- Modify: `backend/app/services/export_service.py`
- Modify: `backend/tests/test_export_service.py`

- [ ] **Step 1: Write the failing export playlist test**

Add to `backend/tests/test_export_service.py`:

```python
def test_export_selected_uses_playlist_order(tmp_path: Path) -> None:
    project = build_project_with_two_ready_cells()
    project.append_playlist_item(project.cells[1].id)
    project.append_playlist_item(project.cells[0].id)

    path = ExportService(tmp_path).export_playlist(project)

    audio, _ = sf.read(path, dtype="float32")
    assert len(audio) > 0
```

- [ ] **Step 2: Run the export tests to verify failure**

Run: `.\vendor\Irodori-TTS\.venv\Scripts\python.exe -m pytest backend\tests\test_export_service.py -v`

Expected: FAIL because the service still expects `selected_for_export`

- [ ] **Step 3: Replace row-selection export with playlist export**

Update `backend/app/services/export_service.py`:

```python
def export_playlist(self, project: Project) -> Path:
    if not project.export_playlist:
        raise ValueError("Export playlist is empty")
    selected_cells = [project.get_cell(item.cell_id) for item in project.export_playlist]
    ...
```

- [ ] **Step 4: Keep sample rate and channel validation**

Preserve the existing checks:

```python
if int(current_rate) != sample_rate:
    raise ValueError("Selected audio files must use the same sample rate")
```

- [ ] **Step 5: Update the API caller name**

Make `backend/app/api/projects.py` call `export_service.export_playlist(project)` instead of `export_selected(project)`.

- [ ] **Step 6: Re-run the export tests**

Run: `.\vendor\Irodori-TTS\.venv\Scripts\python.exe -m pytest backend\tests\test_export_service.py -v`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/export_service.py backend/app/api/projects.py backend/tests/test_export_service.py
git commit -m "feat: export wavs from playlist order"
```

### Task 5: Add Route Persistence And Frontend Job Polling

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/router.tsx`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/types.ts`
- Create: `frontend/src/features/editor/useProjectJobs.ts`
- Modify: `frontend/src/App.test.tsx`

- [ ] **Step 1: Write the failing route persistence test**

Update `frontend/src/App.test.tsx`:

```tsx
test("reloading a project route re-fetches the same project", async () => {
  window.history.pushState({}, "", "/projects/project-1");
  render(<App />);
  expect(await screen.findByDisplayValue("Voice Session 01")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the frontend test to verify it fails**

Run: `npm test -- --run App.test.tsx`

Expected: FAIL because routing is not implemented

- [ ] **Step 3: Add React Router**

Update `frontend/package.json`:

```json
"dependencies": {
  ...
  "react-router-dom": "^7.0.0"
}
```

- [ ] **Step 4: Add a router wrapper**

Create `frontend/src/router.tsx`:

```tsx
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { App } from "./App";

const router = createBrowserRouter([
  { path: "/", element: <App /> },
  { path: "/projects/:projectId", element: <App /> },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
```

- [ ] **Step 5: Replace in-memory project boot with route-driven loading**

Use `useParams`, `useNavigate`, and a polling hook:

```tsx
const { projectId } = useParams();
useEffect(() => {
  if (!projectId) return;
  void api.getProject(projectId).then(setProject).catch(...)
}, [projectId]);
```

- [ ] **Step 6: Add job polling**

Create `frontend/src/features/editor/useProjectJobs.ts`:

```tsx
export function useProjectJobs(projectId: string | null, activeJobId: string | null) {
  useEffect(() => {
    if (!projectId || !activeJobId) return;
    const timer = window.setInterval(async () => {
      const [project, job] = await Promise.all([
        api.getProject(projectId),
        api.getJob(projectId, activeJobId),
      ]);
      ...
    }, 500);
    return () => window.clearInterval(timer);
  }, [projectId, activeJobId]);
}
```

- [ ] **Step 7: Expand the client types for jobs and playlist**

Update `frontend/src/types.ts`:

```ts
export type CellStatus = "idle" | "queued" | "generating" | "ready" | "error";
export type ExportPlaylistItem = { ... };
export type GenerationJob = { ... };
```

- [ ] **Step 8: Re-run the route test**

Run: `npm test -- --run App.test.tsx`

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add frontend/package.json frontend/src/main.tsx frontend/src/router.tsx frontend/src/App.tsx frontend/src/api/client.ts frontend/src/types.ts frontend/src/features/editor/useProjectJobs.ts frontend/src/App.test.tsx
git commit -m "feat: add route persistence and job polling"
```

### Task 6: Rebuild The Editor Around Console, Matrix, And Playlist

**Files:**
- Create: `frontend/src/features/editor/GenerationConsole.tsx`
- Create: `frontend/src/features/editor/ExportPlaylist.tsx`
- Modify: `frontend/src/features/editor/ProjectEditor.tsx`
- Modify: `frontend/src/features/editor/LineMatrix.tsx`
- Modify: `frontend/src/features/editor/CellDetailPane.tsx`
- Modify: `frontend/src/features/editor/ReferenceSidebar.tsx`
- Modify: `frontend/src/features/editor/ProjectEditor.test.tsx`
- Create: `frontend/src/features/editor/ExportPlaylist.test.tsx`

- [ ] **Step 1: Write the failing playlist UI test**

Create `frontend/src/features/editor/ExportPlaylist.test.tsx`:

```tsx
test("playlist can show duplicate cell entries", () => {
  render(
    <ExportPlaylist
      items={[
        { id: "a", cell_id: "cell-1", label: "lize / line 1", created_at: "2026-06-14T00:00:00Z" },
        { id: "b", cell_id: "cell-1", label: "lize / line 1", created_at: "2026-06-14T00:00:01Z" },
      ]}
      ...
    />,
  );

  expect(screen.getAllByText("lize / line 1")).toHaveLength(2);
});
```

- [ ] **Step 2: Run the editor tests to verify failure**

Run:

```bash
npm test -- --run frontend/src/features/editor/ProjectEditor.test.tsx frontend/src/features/editor/ExportPlaylist.test.tsx
```

Expected: FAIL with missing playlist component and outdated props

- [ ] **Step 3: Add the console bar**

Create `GenerationConsole.tsx`:

```tsx
export function GenerationConsole({ job, busy, onGenerateMissing, onGenerateAll, autoPlay, onToggleAutoPlay }: Props) {
  return (
    <section className="generation-console">
      <button ...>未生成を実行</button>
      <button ...>全セルを実行</button>
      <p>{job ? `${job.completed_cells} / ${job.total_cells} セル完了` : "待機中"}</p>
      <label><input type="checkbox" ... /> 同一参照を連続再生</label>
    </section>
  );
}
```

- [ ] **Step 4: Add the playlist panel**

Create `ExportPlaylist.tsx`:

```tsx
export function ExportPlaylist({ items, onRemove, onReorder, onExport, onExportText }: Props) {
  return (
    <section className="playlist-panel">
      <header>
        <h2>書き出しリスト</h2>
        <button ...>セリフを txt 出力</button>
        <button ...>WAV を書き出し</button>
      </header>
      ...
    </section>
  );
}
```

- [ ] **Step 5: Remove radio-based row export from the matrix**

In `LineMatrix.tsx`, replace:

```tsx
<input type="radio" ... />
```

with:

```tsx
<button type="button" onClick={() => onAppendToPlaylist(cell.id)}>リストに追加</button>
```

- [ ] **Step 6: Add header-level column bulk actions**

Under each reference header:

```tsx
<button type="button" onClick={() => onAppendReferenceColumn(reference.id)}>
  上から追加
</button>
```

- [ ] **Step 7: Re-run the playlist and editor tests**

Run:

```bash
npm test -- --run frontend/src/features/editor/ProjectEditor.test.tsx frontend/src/features/editor/ExportPlaylist.test.tsx
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/editor/GenerationConsole.tsx frontend/src/features/editor/ExportPlaylist.tsx frontend/src/features/editor/ProjectEditor.tsx frontend/src/features/editor/LineMatrix.tsx frontend/src/features/editor/CellDetailPane.tsx frontend/src/features/editor/ReferenceSidebar.tsx frontend/src/features/editor/ProjectEditor.test.tsx frontend/src/features/editor/ExportPlaylist.test.tsx
git commit -m "feat: redesign editor around export playlist"
```

### Task 7: Improve Matrix UX, Playback, Localization, And Layout Stability

**Files:**
- Modify: `frontend/src/features/editor/LineMatrix.tsx`
- Modify: `frontend/src/features/editor/LineMatrix.test.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Write the failing cell-status test**

Add to `frontend/src/features/editor/LineMatrix.test.tsx`:

```tsx
test("generating cells remain playable when an older take exists", () => {
  render(...status: "generating", current_result: { ... }...);
  expect(screen.getByText("生成中")).toBeInTheDocument();
  expect(screen.getByRole("audio")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the matrix test and verify failure**

Run: `npm test -- --run frontend/src/features/editor/LineMatrix.test.tsx`

Expected: FAIL because Japanese labels and playable generating state are missing

- [ ] **Step 3: Add Japanese labels and fixed-status slots**

In `LineMatrix.tsx`:

```tsx
const statusLabel = {
  idle: "未生成",
  queued: "待機中",
  generating: "生成中",
  ready: "生成済み",
  error: "エラー",
};
```

Reserve a stable message area:

```tsx
<div className="cell-message-slot">
  {cell.error_message ? <p className="cell-error">{cell.error_message}</p> : null}
</div>
```

- [ ] **Step 4: Track played state in the UI**

Use local state keyed by `cell.id`:

```tsx
const [playedCellIds, setPlayedCellIds] = useState<string[]>([]);
```

Mark the card:

```tsx
className={playedCellIds.includes(cell.id) ? "result-cell is-played" : "result-cell"}
```

- [ ] **Step 5: Add auto-play chaining within the same reference column**

When a cell audio ends, find the next generated cell in that same `reference_id` and play it only if auto-play is on.

- [ ] **Step 6: Update `styles.css` for wider line column and steadier layout**

Add:

```css
.matrix {
  grid-template-columns: minmax(24rem, 34rem) repeat(var(--reference-count), minmax(18rem, 1fr));
}

.cell-message-slot {
  min-height: 1.5rem;
}
```

- [ ] **Step 7: Re-run matrix tests**

Run: `npm test -- --run frontend/src/features/editor/LineMatrix.test.tsx`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/editor/LineMatrix.tsx frontend/src/features/editor/LineMatrix.test.tsx frontend/src/styles.css
git commit -m "feat: improve matrix playback and status UX"
```

### Task 8: Add Drag Reorder, Line Insertion, And Text Export Controls

**Files:**
- Modify: `frontend/src/features/editor/ProjectEditor.tsx`
- Modify: `frontend/src/features/editor/LineMatrix.tsx`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/features/editor/ProjectEditor.test.tsx`
- Modify: `README.md`

- [ ] **Step 1: Write the failing insert-line test**

Add to `frontend/src/features/editor/ProjectEditor.test.tsx`:

```tsx
test("insert line button calls the requested insertion index", async () => {
  const user = userEvent.setup();
  const calls: Array<{ index: number; text: string }> = [];
  render(<ProjectEditor ... onInsertLine={(index, text) => calls.push({ index, text })} />);

  await user.click(screen.getByRole("button", { name: /ここに追加/i }));
  await user.type(screen.getByLabelText(/追加するセリフ/i), "new line");
  await user.click(screen.getByRole("button", { name: /挿入/i }));

  expect(calls).toEqual([{ index: 1, text: "new line" }]);
});
```

- [ ] **Step 2: Run the editor test and verify failure**

Run: `npm test -- --run frontend/src/features/editor/ProjectEditor.test.tsx`

Expected: FAIL because insertion UI is not present

- [ ] **Step 3: Add line insertion and reorder client APIs**

Update `frontend/src/api/client.ts`:

```ts
export function insertLine(projectId: string, index: number, text: string): Promise<Project> {
  return request(`/api/projects/${projectId}/lines/insert`, json("POST", { index, text }));
}

export function exportLinesText(projectId: string): Promise<string> {
  return fetch(`/api/projects/${projectId}/lines.txt`).then((response) => response.text());
}
```

- [ ] **Step 4: Add row insertion controls**

In `ProjectEditor.tsx`, pass:

```tsx
onInsertLine={(index, text) => ...}
onExportText={() => ...}
```

In `LineMatrix.tsx`, render insertion affordances between rows.

- [ ] **Step 5: Replace arrow-based reorder with drag handles**

Use a lightweight drag library or native HTML drag events. Render:

```tsx
<button type="button" className="drag-handle" aria-label={`並べ替え: ${line.text}`}>≡</button>
```

Then update `onReorder` with the final line id order after drop.

- [ ] **Step 6: Update README usage notes**

Add a short section describing:

```md
- Open a project directly at `/projects/<project-id>`
- Build an export playlist from individual cells or full reference columns
- Export the current script as txt
```

- [ ] **Step 7: Re-run editor tests**

Run: `npm test -- --run frontend/src/features/editor/ProjectEditor.test.tsx`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/editor/ProjectEditor.tsx frontend/src/features/editor/LineMatrix.tsx frontend/src/api/client.ts frontend/src/features/editor/ProjectEditor.test.tsx README.md
git commit -m "feat: add line insertion and drag reorder controls"
```

### Task 9: Full Verification

**Files:**
- Modify: `backend/tests/test_projects_api.py`
- Modify: `frontend/src/App.test.tsx`

- [ ] **Step 1: Add a backend integration test for the end-to-end playlist flow**

Add a test in `backend/tests/test_projects_api.py` that:

```python
def test_playlist_flow_supports_column_append_and_wav_export() -> None:
    ...
```

The flow should:

- create a project
- add two lines
- add one reference
- generate two ready cells
- append the column to playlist
- export wav

- [ ] **Step 2: Add a frontend integration test for route reload**

Add a test in `frontend/src/App.test.tsx` that:

```tsx
test("project route survives reload and keeps playlist controls visible", async () => {
  window.history.pushState({}, "", "/projects/project-1");
  render(<App />);
  expect(await screen.findByText("書き出しリスト")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run the backend suite**

Run: `.\vendor\Irodori-TTS\.venv\Scripts\python.exe -m pytest backend\tests -q`

Expected: PASS

- [ ] **Step 4: Run the frontend suite**

Run: `npm test -- --run`

Expected: PASS

- [ ] **Step 5: Run the production build**

Run: `npm run build`

Expected: PASS with generated `dist/`

- [ ] **Step 6: Manual smoke test**

Run:

```bash
.\run.bat
```

Verify:

- open a project route directly
- generate cells and watch status update from `待機中` to `生成中` to `生成済み`
- append a whole reference column to the playlist
- append a single cell again to confirm duplicates
- export txt
- export wav
- reload the page and confirm the same project reopens

- [ ] **Step 7: Commit**

```bash
git add backend/tests/test_projects_api.py frontend/src/App.test.tsx README.md
git commit -m "test: verify playlist iteration end to end"
```

## Self-Review

- Spec coverage:
  - route persistence is covered in Task 5
  - job-driven sequential cell updates are covered in Tasks 2 and 3
  - export playlist and column bulk append are covered in Tasks 1, 3, 4, and 6
  - txt export is covered in Tasks 3 and 8
  - line insertion and drag reorder are covered in Tasks 1 and 8
  - localization, playback, and matrix stability are covered in Tasks 6 and 7
  - regeneration isolation regression is covered in Task 2

- Placeholder scan:
  - no `TBD` or `TODO` markers remain
  - each task names exact files and verification commands

- Type consistency:
  - `export_playlist`, `ExportPlaylistItem`, `GenerationJob`, `CellStatus`, and route `/projects/:projectId` naming are used consistently across backend and frontend tasks

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-14-irodori-gui-iteration.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
