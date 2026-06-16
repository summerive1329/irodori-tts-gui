import { Fragment, useEffect, useRef, useState } from "react";

import type { CellDisplayStatus, CellItem, LineItem, ReferenceItem } from "../../types";

type Props = {
  projectId: string;
  lines: LineItem[];
  references: ReferenceItem[];
  cells: CellItem[];
  busy: boolean;
  allowRegenerateWhileBusy?: boolean;
  dialogueColumnWidth?: number;
  autoPlay: boolean;
  selectionMode: boolean;
  hiddenLineIds?: Set<string>;
  selectedCellId: string | null;
  selectedCellIds: string[];
  onSelectCell: (cellId: string) => void;
  onToggleCellSelection: (cellId: string) => void;
  onRegenerate: (cellId: string) => void;
  onMarkCellPlayed?: (cellId: string) => void;
  onAppendToPlaylist: (cellId: string) => void;
  onAppendReferenceColumn: (referenceId: string) => void;
  onClearReferenceColumn?: (referenceId: string) => void;
  onEditLine: (lineId: string, text: string) => void;
  onInsertLine: (index: number, text: string) => void;
  onDeleteLine?: (lineId: string) => void;
  onReorder: (lineIds: string[]) => void;
  onResizeDialogueColumn?: (width: number) => void;
};

const displayStatusLabel: Record<CellDisplayStatus, string> = {
  not_generated: "未生成",
  queued: "待機中",
  generating: "生成中",
  unplayed: "未再生",
  played: "再生済み",
  error: "エラー",
};

export function LineMatrix({
  projectId,
  lines,
  references,
  cells,
  busy,
  allowRegenerateWhileBusy = false,
  dialogueColumnWidth = 440,
  autoPlay,
  selectionMode,
  hiddenLineIds = new Set<string>(),
  selectedCellId,
  selectedCellIds,
  onSelectCell,
  onToggleCellSelection,
  onRegenerate,
  onMarkCellPlayed,
  onAppendToPlaylist,
  onAppendReferenceColumn,
  onClearReferenceColumn,
  onEditLine,
  onInsertLine,
  onDeleteLine,
  onReorder,
  onResizeDialogueColumn,
}: Props) {
  const [insertionIndex, setInsertionIndex] = useState<number | null>(null);
  const [insertionText, setInsertionText] = useState("");
  const [moveLineId, setMoveLineId] = useState<string | null>(null);
  const [moveTargetValue, setMoveTargetValue] = useState("");
  const [movedLineId, setMovedLineId] = useState<string | null>(null);
  const [draggedLineId, setDraggedLineId] = useState<string | null>(null);
  const [dragTargetIndex, setDragTargetIndex] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const audioElements = useRef(new Map<string, HTMLAudioElement>());
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(dialogueColumnWidth);
  const orderedLines = [...lines]
    .filter((line) => !hiddenLineIds.has(line.id))
    .sort((a, b) => a.order_index - b.order_index);
  const gridTemplateColumns = `${dialogueColumnWidth}px repeat(${Math.max(references.length, 1)}, minmax(0, 288px))`;

  useEffect(() => {
    if (!resizing || !onResizeDialogueColumn) return;
    const commitWidth = onResizeDialogueColumn;

    function handlePointerMove(event: PointerEvent) {
      commitWidth(resizeStartWidth.current + (event.clientX - resizeStartX.current));
    }

    function handlePointerUp() {
      setResizing(false);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [onResizeDialogueColumn, resizing]);

  useEffect(() => {
    if (!movedLineId) return;
    const timeoutId = window.setTimeout(() => setMovedLineId(null), 1500);
    return () => window.clearTimeout(timeoutId);
  }, [movedLineId]);

  function playNextInReference(cell: CellItem) {
    if (!autoPlay) return;
    const lineOrder = new Map(orderedLines.map((line, index) => [line.id, index]));
    const playable = cells
      .filter((candidate) => candidate.reference_id === cell.reference_id && candidate.current_result)
      .sort((left, right) => (lineOrder.get(left.line_id) ?? 0) - (lineOrder.get(right.line_id) ?? 0));
    const next = playable[playable.findIndex((candidate) => candidate.id === cell.id) + 1];
    if (next) void audioElements.current.get(next.id)?.play();
  }

  function dropLineAt(index: number) {
    if (!draggedLineId) return;
    const ids = orderedLines.map((line) => line.id);
    const sourceIndex = ids.indexOf(draggedLineId);
    const reordered = ids.filter((id) => id !== draggedLineId);
    const adjustedIndex = sourceIndex < index ? index - 1 : index;
    reordered.splice(Math.max(0, Math.min(adjustedIndex, reordered.length)), 0, draggedLineId);
    setDraggedLineId(null);
    setDragTargetIndex(null);
    if (reordered.some((id, itemIndex) => id !== ids[itemIndex])) onReorder(reordered);
  }

  function closeMovePanel() {
    setMoveLineId(null);
    setMoveTargetValue("");
  }

  function moveLineToPosition(lineId: string, targetPosition: number) {
    if (!Number.isInteger(targetPosition) || targetPosition < 1 || targetPosition > orderedLines.length) {
      return;
    }
    const ids = orderedLines.map((line) => line.id);
    const reordered = ids.filter((id) => id !== lineId);
    reordered.splice(targetPosition - 1, 0, lineId);
    closeMovePanel();
    if (reordered.some((id, itemIndex) => id !== ids[itemIndex])) onReorder(reordered);
    setMovedLineId(lineId);
  }

  function updateMoveTargetValue(nextValue: string) {
    if (!nextValue) {
      setMoveTargetValue("");
      return;
    }
    if (!/^\d+$/.test(nextValue)) return;
    const nextNumber = Number(nextValue);
    if (nextNumber < 1 || nextNumber > orderedLines.length) return;
    setMoveTargetValue(nextValue);
  }

  function insertionSlot(index: number, label: string) {
    const moveLabel = index === 0 ? "先頭へ移動" : `${index}番目へ移動`;
    return (
      <div
        className={`line-insert-slot${dragTargetIndex === index ? " is-drag-target" : ""}`}
        style={{ gridColumn: "1 / -1" }}
        aria-label={moveLabel}
        onDragEnter={(event) => {
          event.preventDefault();
          if (draggedLineId) setDragTargetIndex(index);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (draggedLineId && dragTargetIndex !== index) setDragTargetIndex(index);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dropLineAt(index);
        }}
      >
        {insertionIndex === index ? (
          <form
            className="line-insert-form"
            onSubmit={(event) => {
              event.preventDefault();
              const text = insertionText.trim();
              if (!text) return;
              onInsertLine(index, text);
              setInsertionText("");
              setInsertionIndex(null);
            }}
          >
            <label>追加するセリフ<input autoFocus disabled={busy} value={insertionText} onChange={(event) => setInsertionText(event.target.value)} /></label>
            <button type="submit" className="button button-primary" disabled={busy || !insertionText.trim()}>挿入</button>
            <button type="button" className="button button-quiet" onClick={() => setInsertionIndex(null)}>閉じる</button>
          </form>
        ) : (
          <button type="button" className="line-insert-button" disabled={busy} onClick={() => setInsertionIndex(index)}>＋ {label}</button>
        )}
        {dragTargetIndex === index && <span className="drop-hint">ここへ移動</span>}
      </div>
    );
  }

  if (orderedLines.length === 0) {
    return (
      <div className="empty-state">
        <span>01</span>
        <h2>最初のセリフを追加</h2>
        <p>上の入力欄へ貼り付けるか、テキストファイルをドロップしてください。</p>
      </div>
    );
  }

  return (
    <div className="matrix-scroll">
      <div
        className="matrix"
        style={{
          "--dialogue-column-width": `${dialogueColumnWidth}px`,
          "--reference-count": Math.max(references.length, 1),
          gridTemplateColumns,
        } as React.CSSProperties}
      >
        <div className="matrix-corner" data-testid="matrix-header-cell">
          <span className="eyebrow">DIALOGUE</span>
          <span>{orderedLines.length} セリフ</span>
          {onResizeDialogueColumn ? (
            <div
              className="dialogue-column-resizer"
              role="separator"
              aria-label="セリフ列の幅を変更"
              aria-orientation="vertical"
              onPointerDown={(event) => {
                resizeStartX.current = event.clientX;
                resizeStartWidth.current = dialogueColumnWidth;
                setResizing(true);
              }}
            />
          ) : null}
        </div>
        {references.map((reference) => (
          <div className="matrix-reference-header" data-testid="matrix-header-cell" key={reference.id}>
            <strong>{reference.label}</strong>
            <small>{reference.source_filename}</small>
            {onClearReferenceColumn ? (
              <button
                type="button"
                className="column-clear-button"
                disabled={busy}
                aria-label={`${reference.label}列を消去`}
                onClick={() => onClearReferenceColumn(reference.id)}
              >
                この列を消去
              </button>
            ) : null}
            <button
              type="button"
              className="column-add-button"
              disabled={busy}
              aria-label={`${reference.label}を上から追加`}
              onClick={() => onAppendReferenceColumn(reference.id)}
            >
              上からリスト追加
            </button>
          </div>
        ))}
        {references.length === 0 && <div className="matrix-reference-header is-empty">参照音声を追加すると生成セルが表示されます</div>}

        {insertionSlot(0, "先頭に追加")}
        {orderedLines.map((line, lineIndex) => (
          <Fragment key={line.id}>
            <div className="matrix-row">
              <div className={`line-editor${movedLineId === line.id ? " is-moved" : ""}`}>
                <span className="line-number">{String(lineIndex + 1).padStart(2, "0")}</span>
                <textarea
                  defaultValue={line.text}
                  disabled={busy}
                  aria-label={`セリフ ${lineIndex + 1}`}
                  onBlur={(event) => {
                    if (event.target.value.trim() !== line.text) onEditLine(line.id, event.target.value);
                  }}
                />
                <div className="line-order-controls">
                  <button
                    type="button"
                    className="drag-handle"
                    draggable={!busy}
                    disabled={busy}
                    aria-label={`並べ替え: ${line.text}`}
                    onDragStart={(event) => {
                      setDraggedLineId(line.id);
                      setDragTargetIndex(lineIndex);
                      event.dataTransfer?.setData("text/plain", line.id);
                    }}
                    onDragEnd={() => {
                      setDraggedLineId(null);
                      setDragTargetIndex(null);
                    }}
                  >
                    ≡
                  </button>
                  <button
                    type="button"
                    className="line-move-button"
                    disabled={busy}
                    aria-label={`移動: ${line.text}`}
                    onClick={() => {
                      setMoveLineId(line.id);
                      setMoveTargetValue(String(lineIndex + 1));
                    }}
                  >
                    移動
                  </button>
                  {onDeleteLine && <button type="button" disabled={busy} aria-label={`削除: ${line.text}`} onClick={() => onDeleteLine(line.id)}>×</button>}
                </div>
                {moveLineId === line.id ? (
                  <div className="line-move-panel">
                    <label>
                      移動先番号
                      <input
                        autoFocus
                        aria-label="移動先番号"
                        type="number"
                        min={1}
                        max={orderedLines.length}
                        inputMode="numeric"
                        value={moveTargetValue}
                        onChange={(event) => updateMoveTargetValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            closeMovePanel();
                            return;
                          }
                          if (event.key === "Enter" && event.ctrlKey) {
                            event.preventDefault();
                            moveLineToPosition(line.id, Number(moveTargetValue));
                          }
                        }}
                      />
                    </label>
                    <button type="button" className="button button-quiet" onClick={() => closeMovePanel()}>
                      閉じる
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="line-cells">
                {references.map((reference) => {
                  const cell = cells.find((item) => item.line_id === line.id && item.reference_id === reference.id);
                  if (!cell) return <div className="result-cell is-missing" key={reference.id}>セルがありません</div>;
                  const audioUrl = cell.current_result
                    ? `/media/projects/${projectId}/${cell.current_result.audio_path}?v=${encodeURIComponent(cell.current_result.generated_at)}`
                    : null;
                  const isPlayed = cell.display_status === "played";
                  const isSelected = selectedCellIds.includes(cell.id);
                  const isUnplayed = cell.display_status === "unplayed";
                  const regenerateLocked = (cell.display_status === "generating" || cell.display_status === "queued") || (busy && !allowRegenerateWhileBusy);
                  return (
                    <article
                      className={`result-cell status-${cell.display_status}${selectedCellId === cell.id ? " is-focused" : ""}${isSelected ? " is-selected" : ""}${isPlayed ? " is-played" : ""}${isUnplayed ? " is-unplayed" : ""}`}
                      key={cell.id}
                      onClick={() => {
                        if (selectionMode) onToggleCellSelection(cell.id);
                        else onSelectCell(cell.id);
                      }}
                    >
                      <div className="cell-topline">
                        <span className="status-dot" />
                        <span>{displayStatusLabel[cell.display_status]}</span>
                        <button
                          type="button"
                          className="playlist-add-button"
                          disabled={busy || !cell.current_result}
                          aria-label={`リストに追加: ${reference.label} / ${line.text}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onAppendToPlaylist(cell.id);
                          }}
                        >
                          ＋ リスト
                        </button>
                      </div>
                      {audioUrl ? (
                        <audio
                          className="result-audio"
                          ref={(element) => {
                            if (element) audioElements.current.set(cell.id, element);
                            else audioElements.current.delete(cell.id);
                          }}
                          aria-label={`音声: ${reference.label} / ${line.text}`}
                          controls
                          preload="none"
                          src={audioUrl}
                          onClick={(event) => event.stopPropagation()}
                          onPlay={() => {
                            onMarkCellPlayed?.(cell.id);
                          }}
                          onEnded={() => playNextInReference(cell)}
                        />
                      ) : <div className="audio-placeholder">音声はまだありません</div>}
                      <div className="cell-message-slot">
                        {cell.error_message ? <p className="cell-error">{cell.error_message}</p> : null}
                      </div>
                      <button
                        type="button"
                        className="regen-button"
                        aria-label={`再生成: ${reference.label} / ${line.text}`}
                        disabled={regenerateLocked}
                        onClick={(event) => {
                          event.stopPropagation();
                          onRegenerate(cell.id);
                        }}
                      >
                        再生成
                      </button>
                    </article>
                  );
                })}
              </div>
            </div>
            {insertionSlot(lineIndex + 1, `${lineIndex + 1}行目の後に追加`)}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
