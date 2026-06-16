import { useEffect, useRef, useState } from "react";

import type { LineItem } from "../../types";

export const DELETE_DELAY_MS = 5000;

export type PendingLineDeletion = {
  line: LineItem;
  expiresAt: number;
};

export function usePendingLineDeletion(onCommitDelete: (lineId: string) => void) {
  const [pending, setPending] = useState<PendingLineDeletion | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const pendingRef = useRef<PendingLineDeletion | null>(null);

  function clearPendingTimer() {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  function requestDelete(line: LineItem) {
    clearPendingTimer();
    if (pendingRef.current && pendingRef.current.line.id !== line.id) {
      onCommitDelete(pendingRef.current.line.id);
    }

    const nextPending = {
      line,
      expiresAt: Date.now() + DELETE_DELAY_MS,
    };
    pendingRef.current = nextPending;
    setPending(nextPending);
    timeoutRef.current = window.setTimeout(() => {
      pendingRef.current = null;
      setPending(null);
      onCommitDelete(line.id);
      timeoutRef.current = null;
    }, DELETE_DELAY_MS);
  }

  function undoDelete() {
    clearPendingTimer();
    pendingRef.current = null;
    setPending(null);
  }

  useEffect(() => () => clearPendingTimer(), []);

  return { pending, requestDelete, undoDelete };
}
