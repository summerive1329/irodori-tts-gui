import type { CellItem, LineItem, ReferenceItem } from "../../types";

type Props = {
  projectId: string;
  lines: LineItem[];
  references: ReferenceItem[];
  cells: CellItem[];
  selectedCellId: string | null;
  onSelectCell: (cellId: string) => void;
  onRegenerate: (cellId: string) => void;
  onSelectForExport: (cellId: string) => void;
  onEditLine: (lineId: string, text: string) => void;
  onReorder: (lineIds: string[]) => void;
};

const statusLabel: Record<CellItem["status"], string> = {
  idle: "Not generated",
  generating: "Generating",
  ready: "Ready",
  error: "Error",
};

export function LineMatrix({
  projectId,
  lines,
  references,
  cells,
  selectedCellId,
  onSelectCell,
  onRegenerate,
  onSelectForExport,
  onEditLine,
  onReorder,
}: Props) {
  const orderedLines = [...lines].sort((a, b) => a.order_index - b.order_index);

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
                    className={`result-cell status-${cell.status}${selectedCellId === cell.id ? " is-focused" : ""}`}
                    key={cell.id}
                    onClick={() => onSelectCell(cell.id)}
                  >
                    <div className="cell-topline">
                      <span className="status-dot" />
                      <span>{statusLabel[cell.status]}</span>
                      <label className="pick-result" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="radio"
                          name={`export-${line.id}`}
                          checked={cell.selected_for_export}
                          disabled={!cell.current_result}
                          aria-label={`Use ${reference.label} for ${line.text}`}
                          onChange={() => onSelectForExport(cell.id)}
                        />
                        Use
                      </label>
                    </div>
                    {audioUrl ? <audio controls preload="none" src={audioUrl} /> : <div className="audio-placeholder">No take yet</div>}
                    {cell.error_message && <p className="cell-error">{cell.error_message}</p>}
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
                      Regenerate
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
