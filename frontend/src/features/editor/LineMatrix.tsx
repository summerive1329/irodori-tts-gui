import { Fragment, useRef, useState } from "react";

import type { CellItem, LineItem, ReferenceItem } from "../../types";

type Props = {
  projectId: string;
  lines: LineItem[];
  references: ReferenceItem[];
  cells: CellItem[];
  busy: boolean;
  allowRegenerateWhileBusy?: boolean;
  dialogueColumnWidth?: number;
  autoPlay: boolean;
  selectedCellId: string | null;
  onSelectCell: (cellId: string) => void;
  onRegenerate: (cellId: string) => void;
  onAppendToPlaylist: (cellId: string) => void;
  onAppendReferenceColumn: (referenceId: string) => void;
  onEditLine: (lineId: string, text: string) => void;
  onInsertLine: (index: number, text: string) => void;
  onDeleteLine?: (lineId: string) => void;
  onReorder: (lineIds: string[]) => void;
};

const statusLabel: Record<CellItem["status"], string> = {
  idle: "未生成",
  queued: "待機中",
  generating: "生成中",
  ready: "生成済み",
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
  selectedCellId,
  onSelectCell,
  onRegenerate,
  onAppendToPlaylist,
  onAppendReferenceColumn,
  onEditLine,
  onInsertLine,
  onDeleteLine,
  onReorder,
}: Props) {
  const [playedCellIds, setPlayedCellIds] = useState<string[]>([]);
  const [insertionIndex, setInsertionIndex] = useState<number | null>(null);
  const [insertionText, setInsertionText] = useState("");
  const [draggedLineId, setDraggedLineId] = useState<string | null>(null);
  const [dragTargetIndex, setDragTargetIndex] = useState<number | null>(null);
  const audioElements = useRef(new Map<string, HTMLAudioElement>());
  const orderedLines = [...lines].sort((a, b) => a.order_index - b.order_index);
  const gridTemplateColumns = `${dialogueColumnWidth}px repeat(${Math.max(references.length, 1)}, minmax(0, 288px))`;

  function markPlayed(cellId: string) {
    setPlayedCellIds((current) => current.includes(cellId) ? current : [...current, cellId]);
  }

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
        </div>
        {references.map((reference) => (
          <div className="matrix-reference-header" data-testid="matrix-header-cell" key={reference.id}>
            <strong>{reference.label}</strong>
            <small>{reference.source_filename}</small>
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
              <div className="line-editor">
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
                  {onDeleteLine && <button type="button" disabled={busy} aria-label={`削除: ${line.text}`} onClick={() => onDeleteLine(line.id)}>×</button>}
                </div>
              </div>

              <div className="line-cells">
                {references.map((reference) => {
                  const cell = cells.find((item) => item.line_id === line.id && item.reference_id === reference.id);
                  if (!cell) return <div className="result-cell is-missing" key={reference.id}>セルがありません</div>;
                  const audioUrl = cell.current_result
                    ? `/media/projects/${projectId}/${cell.current_result.audio_path}?v=${encodeURIComponent(cell.current_result.generated_at)}`
                    : null;
                  const isPlayed = playedCellIds.includes(cell.id);
                  const regenerateLocked = cell.status === "generating" || (busy && !allowRegenerateWhileBusy);
                  return (
                    <article
                      className={`result-cell status-${cell.status}${selectedCellId === cell.id ? " is-focused" : ""}${isPlayed ? " is-played" : ""}`}
                      key={cell.id}
                      onClick={() => onSelectCell(cell.id)}
                    >
                      <div className="cell-topline">
                        <span className="status-dot" />
                        <span>{statusLabel[cell.status]}</span>
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
                          ref={(element) => {
                            if (element) audioElements.current.set(cell.id, element);
                            else audioElements.current.delete(cell.id);
                          }}
                          aria-label={`音声: ${reference.label} / ${line.text}`}
                          controls
                          preload="none"
                          src={audioUrl}
                          onPlay={() => markPlayed(cell.id)}
                          onEnded={() => playNextInReference(cell)}
                        />
                      ) : <div className="audio-placeholder">音声はまだありません</div>}
                      <div className="cell-message-slot">
                        {cell.error_message ? <p className="cell-error">{cell.error_message}</p> : null}
                      </div>
                      <div className={`cell-play-state${isPlayed ? " is-played" : ""}`} aria-live="polite">
                        {isPlayed ? "再生済み" : "未再生"}
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
