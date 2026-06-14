import type { PendingLineDeletion } from "./usePendingLineDeletion";

type Props = {
  pending: PendingLineDeletion | null;
  onUndo: () => void;
};

export function PendingDeleteToast({ pending, onUndo }: Props) {
  if (!pending) return null;

  return (
    <div className="pending-delete-toast" role="status" aria-live="polite">
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
