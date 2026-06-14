import { Fragment, useState } from "react";

import type { ExportPlaylistItem } from "../../types";

type Props = {
  items: ExportPlaylistItem[];
  durationByCellId: Record<string, number>;
  busy: boolean;
  exportUrl: string | null;
  onRemove: (playlistItemId: string) => void;
  onReorder: (playlistItemIds: string[]) => void;
  onExport: () => void;
  onExportText: () => void;
};

export function ExportPlaylist({
  items,
  durationByCellId,
  busy,
  exportUrl,
  onRemove,
  onReorder,
  onExport,
  onExportText,
}: Props) {
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const totalDuration = items.reduce((total, item) => total + (durationByCellId[item.cell_id] ?? 0), 0);

  function dropItemAt(index: number) {
    if (!draggedItemId) return;
    const ids = items.map((item) => item.id);
    const sourceIndex = ids.indexOf(draggedItemId);
    const reordered = ids.filter((id) => id !== draggedItemId);
    const adjustedIndex = sourceIndex < index ? index - 1 : index;
    reordered.splice(Math.max(0, Math.min(adjustedIndex, reordered.length)), 0, draggedItemId);
    setDraggedItemId(null);
    if (reordered.some((id, itemIndex) => id !== ids[itemIndex])) onReorder(reordered);
  }

  function dropSlot(index: number) {
    return (
      <li
        className={`playlist-drop-slot${draggedItemId ? " is-active" : ""}`}
        aria-label={`書き出し位置 ${index}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          dropItemAt(index);
        }}
      >
        {draggedItemId ? "ここへ移動" : null}
      </li>
    );
  }

  return (
    <section className="playlist-panel">
      <header className="playlist-header">
        <div>
          <span className="eyebrow">FINAL ASSEMBLY</span>
          <h2>書き出しリスト</h2>
          <p className="playlist-summary">{items.length} 件 · 合計 {totalDuration.toFixed(1)} 秒</p>
        </div>
        <span className="playlist-count">{String(items.length).padStart(2, "0")}</span>
      </header>

      {items.length === 0 ? (
        <p className="playlist-empty">生成済みセルを自由な順番で追加してください。同じセルも複数回追加できます。</p>
      ) : (
        <ol className="playlist-items">
          {dropSlot(0)}
          {items.map((item, index) => (
            <Fragment key={item.id}>
              <li className="playlist-item">
                <button
                  type="button"
                  className="playlist-drag-handle"
                  draggable
                  disabled={busy}
                  aria-label={`並べ替え: ${item.label}`}
                  onDragStart={(event) => {
                    setDraggedItemId(item.id);
                    event.dataTransfer?.setData("text/plain", item.id);
                  }}
                  onDragEnd={() => setDraggedItemId(null)}
                >
                  ≡
                </button>
                <span className="playlist-index">{String(index + 1).padStart(2, "0")}</span>
                <div className="playlist-item-copy">
                  <strong>{item.label}</strong>
                  <small>{(durationByCellId[item.cell_id] ?? 0).toFixed(1)} 秒</small>
                </div>
                <button type="button" className="playlist-remove" disabled={busy} aria-label={`${item.label}を削除`} onClick={() => onRemove(item.id)}>×</button>
              </li>
              {dropSlot(index + 1)}
            </Fragment>
          ))}
        </ol>
      )}

      <div className="playlist-export-actions">
        <button type="button" className="button button-quiet" disabled={busy} onClick={onExportText}>セリフを txt 出力</button>
        <button type="button" className="button button-accent" disabled={busy || items.length === 0} onClick={onExport}>WAV を書き出し</button>
      </div>
      {exportUrl && <a className="export-link" href={exportUrl} download>最新の WAV をダウンロード</a>}
    </section>
  );
}
