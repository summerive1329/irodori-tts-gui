# Irodori GUI Editing And Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 行番号指定移動、参照音声列一括消去、削除 undo リング、セル内再生 UI 改善を既存ワークフローに沿って追加する。

**Architecture:** 破壊的な列消去だけ backend に専用 API を追加し、行移動は既存 reorder API を再利用する。フロントでは `LineMatrix` を中心に局所 UI を足し、`PendingDeleteToast` で undo の時間表示を補強し、再生 UI はネイティブ `audio controls` を活かしたレイアウト改善に留める。

**Tech Stack:** FastAPI, Pydantic, React, TypeScript, Vitest, Testing Library, CSS

---

## File Structure

- Modify: `backend/app/api/projects.py`
  - 列消去エンドポイントを追加する
- Modify: `backend/tests/test_projects_api.py`
  - 列消去APIの backend テストを追加する
- Modify: `frontend/src/api/client.ts`
  - 列消去APIクライアントを追加する
- Modify: `frontend/src/api/client.test.ts`
  - 列消去リクエストのテストを追加する
- Modify: `frontend/src/features/editor/ProjectEditor.tsx`
  - 列消去ハンドラ、移動ハイライト状態、undo リング表示を `LineMatrix` / `PendingDeleteToast` へ渡す
- Modify: `frontend/src/features/editor/ProjectEditor.test.tsx`
  - 列消去確認、undo リング、行移動UIまわりの統合テストを追加する
- Modify: `frontend/src/features/editor/LineMatrix.tsx`
  - 行移動 UI、移動先ハイライト、列消去ボタン、再生 UI 配置改善を追加する
- Modify: `frontend/src/features/editor/LineMatrix.test.tsx`
  - 行移動、列消去、再生UI配置のテストを追加する
- Modify: `frontend/src/features/editor/PendingDeleteToast.tsx`
  - 円形リングを追加する
- Create: `frontend/src/features/editor/PendingDeleteToast.test.tsx`
  - 円形リング描画の単体テストを追加する
- Modify: `frontend/src/features/editor/usePendingLineDeletion.ts`
  - トースト表示に必要な締切時刻を公開する
- Modify: `frontend/src/styles.css`
  - 移動UI、列消去ボタン、undo リング、再生UIのスタイルを追加する

## Task 1: Add Reference Column Clear API

**Files:**
- Modify: `backend/app/api/projects.py`
- Modify: `backend/tests/test_projects_api.py`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/client.test.ts`

- [ ] **Step 1: Write the failing backend test**

```python
def test_clear_reference_column_resets_only_target_cells(tmp_path: Path) -> None:
    client = _client(tmp_path, FakeRuntimeManager())
    project_id = client.post("/api/projects", json={"name": "demo"}).json()["id"]
    client.post(f"/api/projects/{project_id}/lines", json={"texts": ["one", "two"]})
    project = client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "toru"},
        files={"file": ("toru.wav", _wav_bytes(tmp_path), "audio/wav")},
    ).json()
    project = client.post(
        f"/api/projects/{project_id}/references",
        data={"label": "lize"},
        files={"file": ("lize.wav", _wav_bytes(tmp_path), "audio/wav")},
    ).json()

    started = client.post(
        f"/api/projects/{project_id}/generate/jobs",
        json={"only_missing": True},
    ).json()
    _wait_for_job(client, project_id, started["id"])

    target_reference_id = next(
        reference["id"] for reference in project["references"] if reference["label"] == "toru"
    )
    cleared = client.delete(
        f"/api/projects/{project_id}/references/{target_reference_id}/cells"
    )

    assert cleared.status_code == 200
    payload = cleared.json()
    target_cells = [
        cell for cell in payload["cells"] if cell["reference_id"] == target_reference_id
    ]
    other_cells = [
        cell for cell in payload["cells"] if cell["reference_id"] != target_reference_id
    ]
    assert all(cell["current_result"] is None for cell in target_cells)
    assert all(cell["display_status"] == "not_generated" for cell in target_cells)
    assert all(cell["current_result"] is not None for cell in other_cells)
    assert len(payload["references"]) == 2
```

- [ ] **Step 2: Run backend test to verify it fails**

Run: `cd backend; $env:PYTHONPATH='.'; uv run --project . --extra dev pytest tests/test_projects_api.py -k "clear_reference_column_resets_only_target_cells" -q`

Expected: FAIL because `DELETE /api/projects/{project_id}/references/{reference_id}/cells` does not exist yet

- [ ] **Step 3: Write the minimal backend implementation**

```python
@router.delete(
    "/{project_id}/references/{reference_id}/cells",
    response_model=ProjectWithGenerationProgress,
)
def clear_reference_column(
    project_id: str,
    reference_id: str,
) -> ProjectWithGenerationProgress:
    def apply_change(project: Project) -> None:
        if not any(reference.id == reference_id for reference in project.references):
            raise HTTPException(status_code=404, detail=f"Reference not found: {reference_id}")

        for cell in project.cells:
            if cell.reference_id != reference_id:
                continue
            cell.current_result = None
            cell.status = "idle"
            cell.playback_state = "unplayed"
            cell.error_message = None

    return mutate_project(project_id, apply_change)
```

- [ ] **Step 4: Run backend test to verify it passes**

Run: `cd backend; $env:PYTHONPATH='.'; uv run --project . --extra dev pytest tests/test_projects_api.py -k "clear_reference_column_resets_only_target_cells" -q`

Expected: PASS

- [ ] **Step 5: Write the failing frontend client test**

```ts
it("calls the clear reference column endpoint", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: "project-1", references: [], cells: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  await clearReferenceColumn("project-1", "ref-1");

  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/projects/project-1/references/ref-1/cells");
  expect(init.method).toBe("DELETE");
});
```

- [ ] **Step 6: Run frontend client test to verify it fails**

Run: `cd frontend; npx vitest run src/api/client.test.ts -t "calls the clear reference column endpoint"`

Expected: FAIL because `clearReferenceColumn` is not exported yet

- [ ] **Step 7: Write the minimal frontend client implementation**

```ts
export function clearReferenceColumn(
  projectId: string,
  referenceId: string,
): Promise<Project> {
  return request(`/api/projects/${projectId}/references/${referenceId}/cells`, {
    method: "DELETE",
  });
}
```

- [ ] **Step 8: Run frontend client test to verify it passes**

Run: `cd frontend; npx vitest run src/api/client.test.ts -t "calls the clear reference column endpoint"`

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add backend/app/api/projects.py backend/tests/test_projects_api.py frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "feat: add reference column clear API"
```

## Task 2: Add Numbered Line Move And Column Clear Controls

**Files:**
- Modify: `frontend/src/features/editor/LineMatrix.tsx`
- Modify: `frontend/src/features/editor/LineMatrix.test.tsx`
- Modify: `frontend/src/features/editor/ProjectEditor.tsx`
- Modify: `frontend/src/features/editor/ProjectEditor.test.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Write the failing LineMatrix tests**

```ts
it("moves a line to the requested 1-based position with ctrl+enter", async () => {
  const user = userEvent.setup();
  const props = matrixProps();
  props.lines = [
    { id: "line-1", text: "one", order_index: 0 },
    { id: "line-2", text: "two", order_index: 1 },
    { id: "line-3", text: "three", order_index: 2 },
  ];
  props.references = [];
  props.cells = [];
  render(<LineMatrix {...props} />);

  await user.click(screen.getByRole("button", { name: "移動: one" }));
  const input = screen.getByLabelText("移動先番号");
  await user.clear(input);
  await user.type(input, "3");
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });

  expect(props.onReorder).toHaveBeenCalledWith(["line-2", "line-3", "line-1"]);
});

it("shows a clear-column action in the reference header", async () => {
  const user = userEvent.setup();
  const props = matrixProps();
  props.onClearReferenceColumn = vi.fn();
  render(<LineMatrix {...props} />);

  await user.click(screen.getByRole("button", { name: "toru列を消去" }));

  expect(props.onClearReferenceColumn).toHaveBeenCalledWith("ref-1");
});
```

- [ ] **Step 2: Run LineMatrix tests to verify they fail**

Run: `cd frontend; npx vitest run src/features/editor/LineMatrix.test.tsx -t "moves a line to the requested 1-based position with ctrl+enter|shows a clear-column action in the reference header"`

Expected: FAIL because the move UI and clear-column callback do not exist yet

- [ ] **Step 3: Write the minimal LineMatrix and ProjectEditor implementation**

```tsx
type Props = {
  // ...
  onClearReferenceColumn?: (referenceId: string) => void;
};

const [moveLineId, setMoveLineId] = useState<string | null>(null);
const [moveTargetValue, setMoveTargetValue] = useState("");
const [highlightedLineId, setHighlightedLineId] = useState<string | null>(null);

function moveLineToPosition(lineId: string, targetPosition: number) {
  const ids = orderedLines.map((line) => line.id);
  const sourceIndex = ids.indexOf(lineId);
  const reordered = ids.filter((id) => id !== lineId);
  reordered.splice(targetPosition - 1, 0, lineId);
  onReorder(reordered);
  setMoveLineId(null);
  setMoveTargetValue("");
  setHighlightedLineId(lineId);
}
```

```tsx
<button
  type="button"
  className="line-move-button"
  aria-label={`移動: ${line.text}`}
  onClick={() => {
    setMoveLineId(line.id);
    setMoveTargetValue(String(lineIndex + 1));
  }}
>
  移動
</button>

{moveLineId === line.id ? (
  <div className="line-move-panel">
    <label>
      移動先番号
      <input
        aria-label="移動先番号"
        type="number"
        min={1}
        max={orderedLines.length}
        value={moveTargetValue}
        onChange={(event) => setMoveTargetValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setMoveLineId(null);
          if (event.key === "Enter" && event.ctrlKey) {
            moveLineToPosition(line.id, Number(moveTargetValue));
          }
        }}
      />
    </label>
    <button type="button" onClick={() => setMoveLineId(null)}>閉じる</button>
  </div>
) : null}
```

```tsx
<button
  type="button"
  className="column-clear-button"
  disabled={busy}
  aria-label={`${reference.label}列を消去`}
  onClick={() => onClearReferenceColumn?.(reference.id)}
>
  この列を消去
</button>
```

```tsx
onClearReferenceColumn={(referenceId) => {
  const reference = project.references.find((item) => item.id === referenceId);
  if (!reference) return;
  if (!window.confirm(`参照音声「${reference.label}」列の生成結果を消去しますか？`)) return;
  void runProjectAction(() => api.clearReferenceColumn(project.id, referenceId));
}}
```

- [ ] **Step 4: Run LineMatrix and ProjectEditor tests to verify they pass**

Run: `cd frontend; npx vitest run src/features/editor/LineMatrix.test.tsx src/features/editor/ProjectEditor.test.tsx`

Expected: PASS for the new move/clear-column tests and no regressions in existing editor tests

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/editor/LineMatrix.tsx frontend/src/features/editor/LineMatrix.test.tsx frontend/src/features/editor/ProjectEditor.tsx frontend/src/features/editor/ProjectEditor.test.tsx frontend/src/styles.css
git commit -m "feat: add matrix move and clear controls"
```

## Task 3: Add Undo Ring Visualization

**Files:**
- Modify: `frontend/src/features/editor/usePendingLineDeletion.ts`
- Modify: `frontend/src/features/editor/PendingDeleteToast.tsx`
- Create: `frontend/src/features/editor/PendingDeleteToast.test.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Write the failing toast test**

```ts
it("renders a shrinking undo ring while deletion is pending", () => {
  vi.useFakeTimers();
  const deadlineAt = Date.now() + 5000;
  render(
    <PendingDeleteToast
      pending={{
        line: { id: "line-1", text: "hello", order_index: 0 },
        expiresAt: deadlineAt,
      }}
      onUndo={vi.fn()}
    />,
  );

  expect(screen.getByTestId("pending-delete-ring")).toBeInTheDocument();
  vi.advanceTimersByTime(2500);
  expect(screen.getByTestId("pending-delete-ring")).toHaveAttribute("data-progress", "0.5");
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run toast test to verify it fails**

Run: `cd frontend; npx vitest run src/features/editor/PendingDeleteToast.test.tsx`

Expected: FAIL because the toast test file and `expiresAt` field do not exist yet

- [ ] **Step 3: Write the minimal pending-delete implementation**

```ts
export type PendingLineDeletion = {
  line: LineItem;
  expiresAt: number;
};

const nextPending = {
  line,
  expiresAt: Date.now() + DELETE_DELAY_MS,
};
```

```tsx
const [progress, setProgress] = useState(1);

useEffect(() => {
  if (!pending) return;
  function tick() {
    const remaining = Math.max(0, pending.expiresAt - Date.now());
    setProgress(remaining / 5000);
  }
  tick();
  const id = window.setInterval(tick, 100);
  return () => window.clearInterval(id);
}, [pending]);
```

```tsx
<div className="pending-delete-ring" data-testid="pending-delete-ring" data-progress={progress.toFixed(1)}>
  <svg viewBox="0 0 36 36" aria-hidden="true">
    <circle className="pending-delete-ring-track" cx="18" cy="18" r="15" />
    <circle
      className="pending-delete-ring-progress"
      cx="18"
      cy="18"
      r="15"
      strokeDasharray={`${progress * 94.2} 94.2`}
    />
  </svg>
</div>
```

- [ ] **Step 4: Run toast test to verify it passes**

Run: `cd frontend; npx vitest run src/features/editor/PendingDeleteToast.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/editor/usePendingLineDeletion.ts frontend/src/features/editor/PendingDeleteToast.tsx frontend/src/features/editor/PendingDeleteToast.test.tsx frontend/src/styles.css
git commit -m "feat: visualize pending line deletion timeout"
```

## Task 4: Polish Playback Layout And Final Verification

**Files:**
- Modify: `frontend/src/features/editor/LineMatrix.tsx`
- Modify: `frontend/src/features/editor/LineMatrix.test.tsx`
- Modify: `frontend/src/features/editor/ProjectEditor.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Write the failing playback layout tests**

```ts
it("renders playback controls between the status row and the action row", () => {
  render(<LineMatrix {...matrixProps()} />);

  const cell = screen.getByLabelText("音声: toru / hello").closest("article");
  expect(cell?.querySelector(".cell-topline")).toBeInTheDocument();
  expect(cell?.querySelector(".result-audio")).toBeInTheDocument();
  expect(cell?.querySelector(".cell-actions")).toBeInTheDocument();
});

it("keeps playlist and regenerate actions separated in the action row", () => {
  render(<LineMatrix {...matrixProps()} />);

  expect(screen.getByRole("button", { name: "リストに追加: toru / hello" })).toHaveClass("cell-action-button");
  expect(screen.getByRole("button", { name: "再生成: toru / hello" })).toHaveClass("cell-action-button");
});
```

- [ ] **Step 2: Run playback layout tests to verify they fail**

Run: `cd frontend; npx vitest run src/features/editor/LineMatrix.test.tsx -t "renders playback controls between the status row and the action row|keeps playlist and regenerate actions separated in the action row"`

Expected: FAIL because the playback action row does not exist yet

- [ ] **Step 3: Write the minimal playback layout implementation**

```tsx
<article className={`result-cell ...`}>
  <div className="cell-topline">
    <span className="status-dot" />
    <span>{displayStatusLabel[cell.display_status]}</span>
  </div>
  {audioUrl ? <audio className="result-audio result-audio-large" ... /> : <div className="audio-placeholder">音声はまだありません</div>}
  <div className="cell-message-slot">
    {cell.error_message ? <p className="cell-error">{cell.error_message}</p> : null}
  </div>
  <div className="cell-actions">
    <button type="button" className="cell-action-button playlist-add-button" ...>＋ リスト</button>
    <button type="button" className="cell-action-button regen-button" ...>再生成</button>
  </div>
</article>
```

```css
.result-cell {
  grid-template-rows: auto auto minmax(1.5rem, auto) auto;
  gap: 12px;
}

.result-audio-large,
.detail-audio {
  height: 54px;
}

.cell-actions {
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.cell-action-button {
  min-height: 36px;
  padding: 8px 12px;
}
```

- [ ] **Step 4: Run focused playback tests to verify they pass**

Run: `cd frontend; npx vitest run src/features/editor/LineMatrix.test.tsx`

Expected: PASS

- [ ] **Step 5: Run final verification**

Run: `cd backend; $env:PYTHONPATH='.'; uv run --project . --extra dev pytest tests/test_projects_api.py -k "clear_reference_column_resets_only_target_cells or logs" -q`

Expected: PASS

Run: `cd frontend; npx vitest run`

Expected: PASS

Run: `cd frontend; npm run build`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/editor/LineMatrix.tsx frontend/src/features/editor/LineMatrix.test.tsx frontend/src/features/editor/ProjectEditor.tsx frontend/src/styles.css
git commit -m "feat: improve playback controls layout"
```

## Self-Review

- Spec coverage:
  - 行番号指定移動: Task 2
  - 参照音声列一括消去: Task 1 and Task 2
  - undo リング: Task 3
  - 再生 UI 改善: Task 4
- Placeholder scan:
  - `TBD`, `TODO`, `appropriate`, `similar to` のような曖昧表現は入れていない
- Type consistency:
  - 列消去のフロント名は `clearReferenceColumn`
  - backend ルートは `DELETE /{project_id}/references/{reference_id}/cells`
  - pending delete 拡張フィールドは `expiresAt`

