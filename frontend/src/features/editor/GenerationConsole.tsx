import type { GenerationJob } from "../../types";

type Props = {
  job: GenerationJob | null;
  busy: boolean;
  canGenerate: boolean;
  autoPlay: boolean;
  onGenerateMissing: () => void;
  onGenerateAll: () => void;
  onToggleAutoPlay: (enabled: boolean) => void;
};

export function GenerationConsole({
  job,
  busy,
  canGenerate,
  autoPlay,
  onGenerateMissing,
  onGenerateAll,
  onToggleAutoPlay,
}: Props) {
  const status = job
    ? job.status === "failed"
      ? `失敗: ${job.error_message ?? "生成処理でエラーが発生しました"}`
      : `${job.completed_cells} / ${job.total_cells} セル完了`
    : "待機中";

  return (
    <section className="generation-console">
      <div className="generation-console-actions">
        <button type="button" className="button button-primary" disabled={busy || !canGenerate} onClick={onGenerateMissing}>未生成を実行</button>
        <button type="button" className="button button-accent" disabled={busy || !canGenerate} onClick={onGenerateAll}>全セルを実行</button>
      </div>
      <div className={`generation-progress${job?.status === "running" ? " is-running" : ""}`}>
        <span className="status-dot" />
        <div>
          <span className="eyebrow">GENERATION JOB</span>
          <strong>{status}</strong>
        </div>
      </div>
      <label className="autoplay-toggle">
        <input type="checkbox" checked={autoPlay} onChange={(event) => onToggleAutoPlay(event.target.checked)} />
        同一参照を連続再生
      </label>
    </section>
  );
}
