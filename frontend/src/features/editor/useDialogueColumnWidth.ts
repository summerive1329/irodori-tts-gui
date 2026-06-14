import { useState } from "react";

const STORAGE_KEY = "irodori.dialogueColumnWidth";
const DEFAULT_WIDTH = 440;
const MIN_WIDTH = 320;
const MAX_WIDTH = 760;

export function useDialogueColumnWidth() {
  const [width, setWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_WIDTH;
    const stored = Number(window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_WIDTH);
    return Number.isFinite(stored) ? stored : DEFAULT_WIDTH;
  });

  function commitWidth(nextWidth: number) {
    const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(nextWidth)));
    setWidth(clamped);
    window.localStorage.setItem(STORAGE_KEY, String(clamped));
  }

  return { width, commitWidth };
}
