import { useEffect, useState } from "react";

import { DELETE_DELAY_MS, type PendingLineDeletion } from "./usePendingLineDeletion";

type Props = {
  pending: PendingLineDeletion | null;
  onUndo: () => void;
};

export function PendingDeleteToast({ pending, onUndo }: Props) {
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    if (!pending) return;
    const currentPending = pending;

    function updateProgress() {
      const remaining = Math.max(0, currentPending.expiresAt - Date.now());
      setProgress(remaining / DELETE_DELAY_MS);
    }

    updateProgress();
    const intervalId = window.setInterval(updateProgress, 100);
    return () => window.clearInterval(intervalId);
  }, [pending]);

  if (!pending) return null;

  return (
    <div className="pending-delete-toast" role="status" aria-live="polite">
      <div
        className="pending-delete-ring"
        data-testid="pending-delete-ring"
        data-progress={progress.toFixed(1)}
      >
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
      <div>
        <strong>セリフを削除待ち</strong>
        <p>{pending.line.text}</p>
      </div>
      <button type="button" className="button button-quiet" onClick={onUndo}>
        元に戻す
      </button>
    </div>
  );
}
