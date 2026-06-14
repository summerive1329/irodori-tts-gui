import type { ExportPlaylistItem } from "../../types";

type Props = {
  items: ExportPlaylistItem[];
  busy: boolean;
  exportUrl: string | null;
  onRemove: (playlistItemId: string) => void;
  onReorder: (playlistItemIds: string[]) => void;
  onExport: () => void;
  onExportText: () => void;
};

export function ExportPlaylist({
  items,
  busy,
  exportUrl,
  onRemove,
  onReorder,
  onExport,
  onExportText,
}: Props) {
  function move(itemId: string, direction: -1 | 1) {
    const ids = items.map((item) => item.id);
    const current = ids.indexOf(itemId);
    const target = current + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[current], ids[target]] = [ids[target], ids[current]];
    onReorder(ids);
  }

  return (
    <section className="playlist-panel">
      <header className="playlist-header">
        <div>
          <span className="eyebrow">FINAL ASSEMBLY</span>
          <h2>書き出しリスト</h2>
        </div>
        <span className="playlist-count">{String(items.length).padStart(2, "0")}</span>
      </header>

      {items.length === 0 ? (
        <p className="playlist-empty">生成済みセルを自由な順番で追加してください。同じセルも複数回追加できます。</p>
      ) : (
        <ol className="playlist-items">
          {items.map((item, index) => (
            <li key={item.id}>
              <span className="playlist-index">{String(index + 1).padStart(2, "0")}</span>
              <strong>{item.label}</strong>
              <div className="playlist-item-actions">
                <button type="button" disabled={busy || index === 0} aria-label={`${item.label}を上へ`} onClick={() => move(item.id, -1)}>↑</button>
                <button type="button" disabled={busy || index === items.length - 1} aria-label={`${item.label}を下へ`} onClick={() => move(item.id, 1)}>↓</button>
                <button type="button" disabled={busy} aria-label={`${item.label}を削除`} onClick={() => onRemove(item.id)}>×</button>
              </div>
            </li>
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
