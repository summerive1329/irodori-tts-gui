import { useRef, useState } from "react";

import type { CellItem, LineItem, ReferenceItem } from "../../types";

type Props = {
  projectId: string;
  lines: LineItem[];
  references: ReferenceItem[];
  cells: CellItem[];
  autoPlay: boolean;
  selectedCellId: string | null;
  onSelectCell: (cellId: string) => void;
  onRegenerate: (cellId: string) => void;
  onAppendToPlaylist: (cellId: string) => void;
  onAppendReferenceColumn: (referenceId: string) => void;
  onEditLine: (lineId: string, text: string) => void;
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
  autoPlay,
  selectedCellId,
  onSelectCell,
  onRegenerate,
  onAppendToPlaylist,
  onAppendReferenceColumn,
  onEditLine,
  onDeleteLine,
  onReorder,
}: Props) {
  const [playedCellIds, setPlayedCellIds] = useState<string[]>([]);
  const audioElements = useRef(new Map<string, HTMLAudioElement>());
  const orderedLines = [...lines].sort((a, b) => a.order_index - b.order_index);

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

  function move(lineId: string, direction: -1 | 1) {
    const ids = orderedLines.map((line) => line.id);
    const current = ids.indexOf(lineId);
    const target = current + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[current], ids[target]] = [ids[target], ids[current]];
    onReorder(ids);
  }

  if (orderedLines.length === 0) {
    return (
      <div className="empty-state">
        <span>01</span>
        <h2>Add your first dialogue lines</h2>
        <p>Paste text manually or drop a text file above.</p>
      </div>
    );
  }

  return (
    <div className="matrix-scroll">
      <div className="matrix" style={{ "--reference-count": Math.max(references.length, 1) } as React.CSSProperties}>
        <div className="matrix-corner">
          <span className="eyebrow">DIALOGUE</span>
          <span>{orderedLines.length} lines</span>
        </div>
        {references.map((reference) => (
          <div className="matrix-reference-header" key={reference.id}>
            <strong>{reference.label}</strong>
            <small>{reference.source_filename}</small>
            <button
              type="button"
              className="column-add-button"
              aria-label={`${reference.label}を上から追加`}
              onClick={() => onAppendReferenceColumn(reference.id)}
            >
              上から追加
            </button>
          </div>
        ))}
        {references.length === 0 && <div className="matrix-reference-header is-empty">Add a reference to create result cells</div>}

        {orderedLines.map((line, lineIndex) => (
          <div className="matrix-row" key={line.id}>
            <div className="line-editor">
              <span className="line-number">{String(lineIndex + 1).padStart(2, "0")}</span>
              <textarea
                defaultValue={line.text}
                aria-label={`Dialogue line ${lineIndex + 1}`}
                onBlur={(event) => {
                  if (event.target.value.trim() !== line.text) {
                    onEditLine(line.id, event.target.value);
                  }
                }}
              />
              <div className="line-order-controls">
                <button type="button" aria-label={`Move ${line.text} up`} disabled={lineIndex === 0} onClick={() => move(line.id, -1)}>↑</button>
                <button type="button" aria-label={`Move ${line.text} down`} disabled={lineIndex === orderedLines.length - 1} onClick={() => move(line.id, 1)}>↓</button>
                {onDeleteLine && <button type="button" aria-label={`Delete ${line.text}`} onClick={() => onDeleteLine(line.id)}>×</button>}
              </div>
            </div>

            <div className="line-cells">
              {references.map((reference) => {
                const cell = cells.find((item) => item.line_id === line.id && item.reference_id === reference.id);
                if (!cell) return <div className="result-cell is-missing" key={reference.id}>Missing cell</div>;
                const audioUrl = cell.current_result
                  ? `/media/projects/${projectId}/${cell.current_result.audio_path}?v=${encodeURIComponent(cell.current_result.generated_at)}`
                  : null;
                return (
                  <article
                    className={`result-cell status-${cell.status}${selectedCellId === cell.id ? " is-focused" : ""}${playedCellIds.includes(cell.id) ? " is-played" : ""}`}
                    key={cell.id}
                    onClick={() => onSelectCell(cell.id)}
                  >
                    <div className="cell-topline">
                      <span className="status-dot" />
                      <span>{statusLabel[cell.status]}</span>
                      <button
                        type="button"
                        className="playlist-add-button"
                        disabled={!cell.current_result}
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
                    <button
                      type="button"
                      className="regen-button"
                      aria-label={`Regenerate ${reference.label} / ${line.text}`}
                      disabled={cell.status === "generating"}
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
        ))}
      </div>
    </div>
  );
}
