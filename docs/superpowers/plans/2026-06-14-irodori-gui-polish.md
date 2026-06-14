# Irodori GUI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize the Irodori Studio editor so generation jobs stay visible and responsive, matrix editing works reliably, and the UI polish matches the approved demand list.

**Architecture:** Keep the existing `App -> ProjectEditor -> editor components` structure, but split transient UI concerns into focused hooks and components. Track generation jobs separately from short mutations, make matrix layout explicit with a shared grid contract, and keep undo / width persistence in frontend-local state so project JSON compatibility stays untouched.

**Tech Stack:** React 19, TypeScript, React Router, Vitest, Testing Library, FastAPI, pytest

---

## File Structure

### Existing files to modify

- `frontend/src/App.tsx`
  - Split route loading, short mutation state, and generation job tracking.
- `frontend/src/App.test.tsx`
  - Cover route reload, loading shell, and multi-job polling behavior.
- `frontend/src/api/client.ts`
  - Add any tiny client helpers needed for clearer generation state usage.
- `frontend/src/features/editor/GenerationConsole.tsx`
  - Improve button hierarchy, disabled signaling, and visible job state.
- `frontend/src/features/editor/LineMatrix.tsx`
  - Rebuild matrix markup around a shared grid, played badge slot, drag slots, and resizable dialogue column.
- `frontend/src/features/editor/LineMatrix.test.tsx`
  - Cover second-row drag, visible column append UI, played badge stability, and regeneration while a job is active.
- `frontend/src/features/editor/ProjectEditor.tsx`
  - Wire new hooks/components for undo toast, menu, and width persistence.
- `frontend/src/features/editor/ProjectEditor.test.tsx`
  - Cover `Generate All`, deferred delete undo, and menu placement.
- `frontend/src/features/projects/ProjectHome.tsx`
  - Restore English copy for the home screen.
- `frontend/src/features/projects/ProjectHome.test.tsx`
  - Update assertions for English labels.
- `frontend/src/styles.css`
  - Apply the new color direction, audio sizing, button priority, and explicit grid styles.
- `backend/tests/test_projects_api.py`
  - Add regression coverage for overlapping generate/regenerate job acceptance if frontend changes expose a backend hole.

### New files to create

- `frontend/src/features/editor/useDialogueColumnWidth.ts`
  - LocalStorage-backed width state and resize handlers for the dialogue column.
- `frontend/src/features/editor/usePendingLineDeletion.ts`
  - Manage deferred line deletion timers and undo callbacks.
- `frontend/src/features/editor/PendingDeleteToast.tsx`
  - Present the temporary undo affordance.
- `frontend/src/features/editor/ProjectMenu.tsx`
  - Move destructive project actions behind a compact menu.
- `frontend/src/features/editor/useProjectJobs.test.tsx`
  - Focused polling/retry coverage without overloading `App.test.tsx`.

## Task 1: Stabilize Route Loading And Job Polling

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`
- Modify: `frontend/src/features/editor/useProjectJobs.ts`
- Create: `frontend/src/features/editor/useProjectJobs.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/App.test.tsx
it("does not flash the home screen while a routed project is loading", async () => {
  let resolveProject!: (value: Project) => void;
  apiMocks.getProject.mockReturnValue(new Promise((resolve) => {
    resolveProject = resolve;
  }));
  window.history.pushState({}, "", "/projects/project-1");

  render(<AppRouter />);

  expect(screen.queryByRole("heading", { name: "Create Project" })).not.toBeInTheDocument();
  expect(screen.getByText("Loading project…")).toBeInTheDocument();

  resolveProject(project);

  expect(await screen.findByDisplayValue("demo")).toBeInTheDocument();
});
```

```tsx
// frontend/src/features/editor/useProjectJobs.test.tsx
it("keeps polling after a transient getJob failure", async () => {
  const getProject = vi.spyOn(api, "getProject").mockResolvedValue(project);
  const getJob = vi.spyOn(api, "getJob")
    .mockRejectedValueOnce(new Error("temporary"))
    .mockResolvedValueOnce({
      ...runningJob,
      status: "completed",
      completed_cells: 2,
    });

  render(<HookHarness />);

  await waitFor(() => expect(getJob).toHaveBeenCalledTimes(2));
  expect(getProject).toHaveBeenCalledTimes(2);
});

it("continues polling while any tracked job is still running", async () => {
  const getJob = vi.spyOn(api, "getJob")
    .mockResolvedValueOnce({ ...runningJob, id: "job-1", status: "completed" })
    .mockResolvedValueOnce({ ...runningJob, id: "job-2", status: "running" })
    .mockResolvedValueOnce({ ...runningJob, id: "job-2", status: "completed" });

  render(<HookHarness trackedJobIds={["job-1", "job-2"]} />);

  await waitFor(() => expect(getJob).toHaveBeenCalledTimes(3));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- --run src/App.test.tsx src/features/editor/useProjectJobs.test.tsx
```

Expected:

```text
FAIL src/App.test.tsx > does not flash the home screen while a routed project is loading
FAIL src/features/editor/useProjectJobs.test.tsx > keeps polling after a transient getJob failure
```

- [ ] **Step 3: Write the minimal implementation**

```tsx
// frontend/src/App.tsx
const [isMutating, setIsMutating] = useState(false);
const [isRouteLoading, setIsRouteLoading] = useState(Boolean(projectId));
const [trackedJobIds, setTrackedJobIds] = useState<string[]>([]);
const [displayJob, setDisplayJob] = useState<GenerationJob | null>(null);

if (projectId && isRouteLoading && !project) {
  return <div className="route-loading-shell">Loading project…</div>;
}

async function startJob(action: () => Promise<GenerationJob>) {
  setIsMutating(true);
  setError(null);
  try {
    const started = await action();
    setDisplayJob(started);
    if (started.status === "running") {
      setTrackedJobIds((current) => [...new Set([...current, started.id])]);
    }
  } finally {
    setIsMutating(false);
  }
}
```

```ts
// frontend/src/features/editor/useProjectJobs.ts
type Options = {
  projectId: string | null;
  trackedJobIds: string[];
  setProject: Dispatch<SetStateAction<Project | null>>;
  setDisplayJob: Dispatch<SetStateAction<GenerationJob | null>>;
  setTrackedJobIds: Dispatch<SetStateAction<string[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
};

const MAX_RETRIES = 3;

export function useProjectJobs({
  projectId,
  trackedJobIds,
  setProject,
  setDisplayJob,
  setTrackedJobIds,
  setError,
}: Options) {
  useEffect(() => {
    if (!projectId || trackedJobIds.length === 0) return;

    let cancelled = false;
    let timer: number | undefined;
    let failures = 0;

    async function poll() {
      try {
        const [project, jobs] = await Promise.all([
          api.getProject(projectId),
          Promise.all(trackedJobIds.map((jobId) => api.getJob(projectId, jobId))),
        ]);
        if (cancelled) return;
        failures = 0;
        setProject(project);
        setDisplayJob(jobs.at(-1) ?? null);
        const stillRunning = jobs.filter((job) => job.status === "running").map((job) => job.id);
        setTrackedJobIds(stillRunning);
        if (stillRunning.length > 0) {
          timer = window.setTimeout(poll, 500);
        }
      } catch (reason) {
        if (cancelled) return;
        failures += 1;
        if (failures > MAX_RETRIES) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setTrackedJobIds([]);
          return;
        }
        timer = window.setTimeout(poll, failures * 750);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [projectId, trackedJobIds, setDisplayJob, setError, setProject, setTrackedJobIds]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- --run src/App.test.tsx src/features/editor/useProjectJobs.test.tsx
```

Expected:

```text
PASS src/App.test.tsx
PASS src/features/editor/useProjectJobs.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/features/editor/useProjectJobs.ts frontend/src/features/editor/useProjectJobs.test.tsx
git commit -m "fix: stabilize project route loading and job polling"
```

## Task 2: Allow Useful Generation Actions During Active Jobs

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/features/editor/GenerationConsole.tsx`
- Modify: `frontend/src/features/editor/ProjectEditor.tsx`
- Modify: `frontend/src/features/editor/ProjectEditor.test.tsx`
- Modify: `frontend/src/features/editor/LineMatrix.tsx`
- Modify: `frontend/src/features/editor/LineMatrix.test.tsx`
- Modify: `backend/tests/test_projects_api.py`

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/features/editor/ProjectEditor.test.tsx
it("starts full generation from the console", async () => {
  const user = userEvent.setup();
  const editorProps = props();
  editorProps.project = projectWithCells;
  render(<ProjectEditor {...editorProps} />);

  await user.click(screen.getByRole("button", { name: "全セルを実行" }));

  expect(editorProps.onGenerate).toHaveBeenCalledWith(false);
});
```

```tsx
// frontend/src/features/editor/LineMatrix.test.tsx
it("keeps regenerate available while the project is busy", async () => {
  const user = userEvent.setup();
  const props = matrixProps();
  props.busy = true;
  render(<LineMatrix {...props} allowRegenerateWhileBusy />);

  await user.click(screen.getByRole("button", { name: "再生成: toru / hello" }));

  expect(props.onRegenerate).toHaveBeenCalledWith("cell-1");
});
```

```python
# backend/tests/test_projects_api.py
def test_regeneration_job_can_start_while_a_generation_job_is_running(tmp_path: Path) -> None:
    runtime_manager = BlockingRuntimeManager()
    client = _client(tmp_path, runtime_manager)
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one", "two"]})
    client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    )
    generated = client.post(f"/api/projects/{project_id}/generate/jobs", json={"only_missing": False}).json()
    project = client.get(f"/api/projects/{project_id}").json()
    regen = client.post(
        f"/api/projects/{project_id}/cells/{project['cells'][0]['id']}/regeneration-jobs",
        json={"seed": 11},
    )

    assert generated["status"] == "running"
    assert regen.status_code == 202
    assert regen.json()["kind"] == "regenerate_cell"
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- --run src/features/editor/ProjectEditor.test.tsx src/features/editor/LineMatrix.test.tsx
.\vendor\Irodori-TTS\.venv\Scripts\python.exe -m pytest backend\tests\test_projects_api.py -q
```

Expected:

```text
FAIL src/features/editor/LineMatrix.test.tsx > keeps regenerate available while the project is busy
FAIL backend/tests/test_projects_api.py::test_regeneration_job_can_start_while_a_generation_job_is_running
```

- [ ] **Step 3: Write the minimal implementation**

```tsx
// frontend/src/features/editor/ProjectEditor.tsx
const isJobRunning = job?.status === "running";
const matrixBusy = busy && !isJobRunning;

<GenerationConsole
  job={job}
  busy={busy}
  canGenerate={canGenerate}
  onGenerateMissing={() => onGenerate(true)}
  onGenerateAll={() => onGenerate(false)}
/>

<LineMatrix
  busy={isJobRunning || busy}
  allowRegenerateWhileBusy={Boolean(isJobRunning)}
  onRegenerate={(cellId) => onRegenerate(cellId, null)}
/>
```

```tsx
// frontend/src/features/editor/LineMatrix.tsx
type Props = {
  busy: boolean;
  allowRegenerateWhileBusy?: boolean;
  // ...
};

const mutationLocked = busy;
const regenerateLocked = cell.status === "generating" || (mutationLocked && !allowRegenerateWhileBusy);

<button
  type="button"
  className="regen-button"
  disabled={regenerateLocked}
  onClick={(event) => {
    event.stopPropagation();
    onRegenerate(cell.id);
  }}
>
  再生成
</button>
```

```tsx
// frontend/src/features/editor/GenerationConsole.tsx
<button
  type="button"
  className="button button-primary"
  disabled={busy || !canGenerate}
  onClick={onGenerateMissing}
>
  未生成を実行
</button>
<button
  type="button"
  className="button button-accent"
  disabled={busy || !canGenerate}
  onClick={onGenerateAll}
>
  全セルを実行
</button>
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- --run src/features/editor/ProjectEditor.test.tsx src/features/editor/LineMatrix.test.tsx
.\vendor\Irodori-TTS\.venv\Scripts\python.exe -m pytest backend\tests\test_projects_api.py -q
```

Expected:

```text
PASS src/features/editor/ProjectEditor.test.tsx
PASS src/features/editor/LineMatrix.test.tsx
PASS backend/tests/test_projects_api.py
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/features/editor/GenerationConsole.tsx frontend/src/features/editor/ProjectEditor.tsx frontend/src/features/editor/ProjectEditor.test.tsx frontend/src/features/editor/LineMatrix.tsx frontend/src/features/editor/LineMatrix.test.tsx backend/tests/test_projects_api.py
git commit -m "fix: keep generation controls responsive during active jobs"
```

## Task 3: Rebuild The Matrix Grid And Drag Interactions

**Files:**
- Modify: `frontend/src/features/editor/LineMatrix.tsx`
- Modify: `frontend/src/features/editor/LineMatrix.test.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/features/editor/LineMatrix.test.tsx
it("renders a corner cell before the first reference header", () => {
  render(<LineMatrix {...matrixProps()} />);

  const headers = screen.getAllByTestId("matrix-header-cell");
  expect(headers[0]).toHaveTextContent("DIALOGUE");
  expect(headers[1]).toHaveTextContent("toru");
});

it("supports dragging the second row to the top slot", () => {
  const props = matrixPropsWithThreeLines();
  render(<LineMatrix {...props} />);

  fireEvent.dragStart(screen.getByRole("button", { name: "並べ替え: two" }));
  fireEvent.dragEnter(screen.getByLabelText("先頭へ移動"));
  fireEvent.drop(screen.getByLabelText("先頭へ移動"));

  expect(props.onReorder).toHaveBeenCalledWith(["line-2", "line-1", "line-3"]);
});

it("keeps a fixed played badge slot even before playback", () => {
  render(<LineMatrix {...matrixProps()} />);

  expect(screen.getAllByText("未再生")).toHaveLength(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- --run src/features/editor/LineMatrix.test.tsx
```

Expected:

```text
FAIL src/features/editor/LineMatrix.test.tsx > renders a corner cell before the first reference header
FAIL src/features/editor/LineMatrix.test.tsx > supports dragging the second row to the top slot
```

- [ ] **Step 3: Write the minimal implementation**

```tsx
// frontend/src/features/editor/LineMatrix.tsx
const gridTemplateColumns = `${dialogueWidth}px repeat(${Math.max(references.length, 1)}, 288px)`;

<div className="matrix" style={{ gridTemplateColumns }}>
  <div className="matrix-corner" data-testid="matrix-header-cell">
    <span className="eyebrow">DIALOGUE</span>
    <span>{orderedLines.length} lines</span>
  </div>
  {references.map((reference) => (
    <div className="matrix-reference-header" data-testid="matrix-header-cell" key={reference.id}>
      <strong>{reference.label}</strong>
      <small>{reference.source_filename}</small>
      <button type="button" className="column-add-button" onClick={() => onAppendReferenceColumn(reference.id)}>
        上からリスト追加
      </button>
    </div>
  ))}
```

```tsx
// frontend/src/features/editor/LineMatrix.tsx
<div className="cell-play-state" aria-live="polite">
  {playedCellIds.includes(cell.id) ? "再生済み" : "未再生"}
</div>
```

```css
/* frontend/src/styles.css */
.matrix {
  display: grid;
  align-items: stretch;
}

.matrix-row,
.line-cells,
.line-insert-slot {
  display: contents;
}

.line-insert-slot-button,
.line-insert-slot-spacer,
.line-insert-slot-drop {
  min-height: 30px;
}

.cell-play-state {
  min-height: 1rem;
  font-size: 10px;
  font-weight: 800;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- --run src/features/editor/LineMatrix.test.tsx
```

Expected:

```text
PASS src/features/editor/LineMatrix.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/editor/LineMatrix.tsx frontend/src/features/editor/LineMatrix.test.tsx frontend/src/styles.css
git commit -m "fix: align matrix headers and drag targets"
```

## Task 4: Add Deferred Delete Undo And Dialogue Column Resizing

**Files:**
- Create: `frontend/src/features/editor/usePendingLineDeletion.ts`
- Create: `frontend/src/features/editor/useDialogueColumnWidth.ts`
- Create: `frontend/src/features/editor/PendingDeleteToast.tsx`
- Modify: `frontend/src/features/editor/ProjectEditor.tsx`
- Modify: `frontend/src/features/editor/ProjectEditor.test.tsx`
- Modify: `frontend/src/features/editor/LineMatrix.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/features/editor/ProjectEditor.test.tsx
it("lets the user undo a line deletion before the API call is sent", async () => {
  vi.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const editorProps = propsWithTwoLines();
  render(<ProjectEditor {...editorProps} />);

  await user.click(screen.getByRole("button", { name: "削除: hello" }));
  expect(screen.getByRole("button", { name: "元に戻す" })).toBeInTheDocument();
  expect(editorProps.onDeleteLine).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "元に戻す" }));
  vi.runAllTimers();

  expect(editorProps.onDeleteLine).not.toHaveBeenCalled();
});

it("persists the dialogue column width after resize", async () => {
  render(<ProjectEditor {...propsWithTwoLines()} />);

  fireEvent.pointerDown(screen.getByRole("separator", { name: "セリフ列の幅を変更" }), { clientX: 440 });
  fireEvent.pointerMove(window, { clientX: 520 });
  fireEvent.pointerUp(window);

  expect(window.localStorage.getItem("irodori.dialogueColumnWidth")).toBe("520");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- --run src/features/editor/ProjectEditor.test.tsx
```

Expected:

```text
FAIL src/features/editor/ProjectEditor.test.tsx > lets the user undo a line deletion before the API call is sent
FAIL src/features/editor/ProjectEditor.test.tsx > persists the dialogue column width after resize
```

- [ ] **Step 3: Write the minimal implementation**

```ts
// frontend/src/features/editor/usePendingLineDeletion.ts
const DELETE_DELAY_MS = 5000;

export function usePendingLineDeletion(onCommitDelete: (lineId: string) => void) {
  const [pending, setPending] = useState<PendingDelete | null>(null);

  function requestDelete(line: LineItem) {
    window.clearTimeout(timeoutRef.current);
    setPending({ line });
    timeoutRef.current = window.setTimeout(() => {
      onCommitDelete(line.id);
      setPending(null);
    }, DELETE_DELAY_MS);
  }

  function undoDelete() {
    window.clearTimeout(timeoutRef.current);
    setPending(null);
  }

  return { pending, requestDelete, undoDelete };
}
```

```ts
// frontend/src/features/editor/useDialogueColumnWidth.ts
const STORAGE_KEY = "irodori.dialogueColumnWidth";
const DEFAULT_WIDTH = 440;
const MIN_WIDTH = 320;
const MAX_WIDTH = 760;

export function useDialogueColumnWidth() {
  const [width, setWidth] = useState(() => Number(window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_WIDTH));

  function commitWidth(nextWidth: number) {
    const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, nextWidth));
    setWidth(clamped);
    window.localStorage.setItem(STORAGE_KEY, String(clamped));
  }

  return { width, commitWidth };
}
```

```tsx
// frontend/src/features/editor/ProjectEditor.tsx
const { pending, requestDelete, undoDelete } = usePendingLineDeletion(onDeleteLine);
const { width, commitWidth } = useDialogueColumnWidth();
const hiddenLineIds = new Set(pending ? [pending.line.id] : []);

<LineMatrix
  dialogueColumnWidth={width}
  hiddenLineIds={hiddenLineIds}
  onResizeDialogueColumn={commitWidth}
  onDeleteLine={(lineId) => {
    const line = project.lines.find((item) => item.id === lineId);
    if (line) requestDelete(line);
  }}
/>
<PendingDeleteToast pending={pending} onUndo={undoDelete} />
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- --run src/features/editor/ProjectEditor.test.tsx
```

Expected:

```text
PASS src/features/editor/ProjectEditor.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/editor/usePendingLineDeletion.ts frontend/src/features/editor/useDialogueColumnWidth.ts frontend/src/features/editor/PendingDeleteToast.tsx frontend/src/features/editor/ProjectEditor.tsx frontend/src/features/editor/ProjectEditor.test.tsx frontend/src/features/editor/LineMatrix.tsx frontend/src/styles.css
git commit -m "feat: add undoable line deletion and resizable dialogue column"
```

## Task 5: Polish Copy, Menus, Colors, And Audio Controls

**Files:**
- Create: `frontend/src/features/editor/ProjectMenu.tsx`
- Modify: `frontend/src/features/editor/ProjectEditor.tsx`
- Modify: `frontend/src/features/projects/ProjectHome.tsx`
- Modify: `frontend/src/features/projects/ProjectHome.test.tsx`
- Modify: `frontend/src/features/editor/GenerationConsole.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/features/projects/ProjectHome.test.tsx
it("shows the home screen copy in English", () => {
  render(<ProjectHome projects={[]} busy={false} onCreate={() => undefined} onOpen={() => undefined} />);

  expect(screen.getByRole("heading", { name: "Create a New Project" })).toBeInTheDocument();
  expect(screen.getByText("Compare voices and polish each line.")).toBeInTheDocument();
});
```

```tsx
// frontend/src/features/editor/ProjectEditor.test.tsx
it("moves project deletion behind the project menu", async () => {
  const user = userEvent.setup();
  const editorProps = props();
  render(<ProjectEditor {...editorProps} />);

  expect(screen.queryByRole("button", { name: "プロジェクト削除" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "プロジェクトメニュー" }));
  await user.click(screen.getByRole("button", { name: "プロジェクトを削除" }));

  expect(editorProps.onDeleteProject).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- --run src/features/projects/ProjectHome.test.tsx src/features/editor/ProjectEditor.test.tsx
```

Expected:

```text
FAIL src/features/projects/ProjectHome.test.tsx > shows the home screen copy in English
FAIL src/features/editor/ProjectEditor.test.tsx > moves project deletion behind the project menu
```

- [ ] **Step 3: Write the minimal implementation**

```tsx
// frontend/src/features/projects/ProjectHome.tsx
<section className="home-intro">
  <span className="eyebrow">IRODORI STUDIO / LOCAL</span>
  <h1>Compare voices and polish each line.</h1>
  <p>Review each generated take by reference voice, then build the final export in the order you want.</p>
</section>
```

```tsx
// frontend/src/features/editor/ProjectMenu.tsx
export function ProjectMenu({ onDeleteProject }: { onDeleteProject: () => void }) {
  return (
    <details className="project-menu">
      <summary className="button button-quiet" aria-label="プロジェクトメニュー">•••</summary>
      <div className="project-menu-panel">
        <button type="button" className="button button-danger-quiet" onClick={onDeleteProject}>
          プロジェクトを削除
        </button>
      </div>
    </details>
  );
}
```

```css
/* frontend/src/styles.css */
:root {
  --ink: #1f2522;
  --muted: #66706a;
  --paper: #f4f0e8;
  --paper-deep: #e6e0d6;
  --green: #2e6a55;
  --green-soft: #d8eadf;
  --amber: #c98639;
}

.result-cell.is-unplayed {
  background: rgba(216, 234, 223, 0.96);
}

.result-cell.is-played {
  background: rgba(243, 239, 231, 0.92);
}

audio {
  width: 100%;
  height: 38px;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- --run src/features/projects/ProjectHome.test.tsx src/features/editor/ProjectEditor.test.tsx
npm run build
```

Expected:

```text
PASS src/features/projects/ProjectHome.test.tsx
PASS src/features/editor/ProjectEditor.test.tsx
✓ built in
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/editor/ProjectMenu.tsx frontend/src/features/editor/ProjectEditor.tsx frontend/src/features/projects/ProjectHome.tsx frontend/src/features/projects/ProjectHome.test.tsx frontend/src/styles.css
git commit -m "feat: polish project controls and editor visuals"
```

## Final Verification

- [ ] Run the backend suite:

```bash
.\vendor\Irodori-TTS\.venv\Scripts\python.exe -m pytest backend\tests -q
```

Expected:

```text
39 passed in
```

- [ ] Run the frontend suite:

```bash
npm test -- --run
```

Expected:

```text
Test Files  ... passed
Tests  ... passed
```

- [ ] Run the production build:

```bash
npm run build
```

Expected:

```text
✓ built in
```

- [ ] Run the app smoke test:

```bash
.\run.bat
```

Expected:

```text
http://127.0.0.1:8000/api/health -> 200
http://127.0.0.1:5173 -> 200
```

- [ ] Commit any last documentation or test touch-ups:

```bash
git add -A
git commit -m "test: verify Irodori GUI polish flow"
```
