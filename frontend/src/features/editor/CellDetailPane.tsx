import { useEffect, useState } from "react";

import type { CellItem, LineItem, ReferenceItem } from "../../types";

type Props = {
  projectId: string;
  cell: CellItem | null;
  line: LineItem | null;
  reference: ReferenceItem | null;
  busy: boolean;
  onRegenerate: (cellId: string, seed: number | null) => void;
};

export function CellDetailPane({ projectId, cell, line, reference, busy, onRegenerate }: Props) {
  const [seed, setSeed] = useState("");

  useEffect(() => setSeed(""), [cell?.id]);

  if (!cell || !line || !reference) {
    return (
      <aside className="detail-pane is-empty">
        <span className="eyebrow">TAKE INSPECTOR</span>
        <h2>Select a result cell</h2>
        <p>Playback, seed and cell-only regeneration live here.</p>
      </aside>
    );
  }

  const audioUrl = cell.current_result
    ? `/media/projects/${projectId}/${cell.current_result.audio_path}?v=${encodeURIComponent(cell.current_result.generated_at)}`
    : null;
  const parsedSeed = seed.trim() === "" ? null : Number(seed);

  return (
    <aside className="detail-pane">
      <span className="eyebrow">TAKE INSPECTOR</span>
      <div className="detail-voice">{reference.label}</div>
      <blockquote>{line.text}</blockquote>
      <dl>
        <div><dt>Status</dt><dd>{cell.status}</dd></div>
        <div><dt>Duration</dt><dd>{cell.current_result ? `${cell.current_result.duration_sec.toFixed(2)} sec` : "—"}</dd></div>
        <div><dt>Last seed</dt><dd>{cell.current_result?.seed ?? "random"}</dd></div>
      </dl>
      {audioUrl ? <audio className="detail-audio" controls src={audioUrl} /> : <div className="detail-no-audio">No generated audio yet.</div>}
      {cell.error_message && <p className="error-banner">{cell.error_message}</p>}
      <label className="field-label">
        Seed
        <input value={seed} inputMode="numeric" placeholder="random" onChange={(event) => setSeed(event.target.value)} />
      </label>
      <button
        type="button"
        className="button button-accent"
        disabled={busy || (parsedSeed !== null && !Number.isInteger(parsedSeed))}
        onClick={() => onRegenerate(cell.id, parsedSeed)}
      >
        Regenerate selected cell
      </button>
    </aside>
  );
}
