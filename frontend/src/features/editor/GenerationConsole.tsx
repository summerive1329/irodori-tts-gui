import type { GenerationJob, GenerationProgress } from "../../types";

type Props = {
  job: GenerationJob | null;
  generationProgress: GenerationProgress;
  busy: boolean;
  canGenerate: boolean;
  autoPlay: boolean;
  selectionMode: boolean;
  selectedRegeneratableCount: number;
  onGenerateMissing: () => void;
  onGenerateAll: () => void;
  onEnterSelectionMode: () => void;
  onCancelSelectionMode: () => void;
  onRegenerateSelected: () => void;
  onToggleAutoPlay: (enabled: boolean) => void;
};

export function GenerationConsole({
  job,
  generationProgress,
  busy,
  canGenerate,
  autoPlay,
  selectionMode,
  selectedRegeneratableCount,
  onGenerateMissing,
  onGenerateAll,
  onEnterSelectionMode,
  onCancelSelectionMode,
  onRegenerateSelected,
  onToggleAutoPlay,
}: Props) {
  const status = job?.status === "failed"
    ? `失敗: ${job.error_message ?? "生成処理でエラーが発生しました"}`
    : generationProgress.running_job_count > 0
      ? `生成中 ${generationProgress.running_job_count}件`
      : "待機中";
  const activeJobLines = generationProgress.active_jobs.map((activeJob) => (
    `${activeJob.status === "generating" ? "実行中" : "待機中"}: ${activeJob.line_index}行目 / ${activeJob.reference_label}`
  ));

  return (
    <section className="generation-console">
      <div className="generation-console-actions">
        <button type="button" className="button button-primary" disabled={busy || !canGenerate} onClick={onGenerateMissing}>未生成を実行</button>
        <button type="button" className="button button-accent" disabled={busy || !canGenerate} onClick={onGenerateAll}>全セルを実行</button>
        {selectionMode ? (
          <>
            <button type="button" className="button button-quiet" disabled={selectedRegeneratableCount === 0} onClick={onRegenerateSelected}>選択セルを再生成 ({selectedRegeneratableCount})</button>
            <button type="button" className="button button-quiet" onClick={onCancelSelectionMode}>キャンセル</button>
            <span>セルをクリックして選択</span>
          </>
        ) : (
          <button type="button" className="button button-quiet" disabled={busy} onClick={onEnterSelectionMode}>複数選択で再生成</button>
        )}
      </div>
      <div className={`generation-progress${generationProgress.has_running_jobs ? " is-running" : ""}`}>
        <span className="status-dot" />
        <div>
          <span className="eyebrow">GENERATION JOB</span>
          <strong>{status}</strong>
          {activeJobLines.length > 0 ? (
            <div className="generation-progress-detail">
              {activeJobLines.map((line) => <span key={line}>{line}</span>)}
            </div>
          ) : null}
        </div>
      </div>
      <label className="autoplay-toggle">
        <input type="checkbox" checked={autoPlay} onChange={(event) => onToggleAutoPlay(event.target.checked)} />
        同一参照を連続再生
      </label>
    </section>
  );
}
