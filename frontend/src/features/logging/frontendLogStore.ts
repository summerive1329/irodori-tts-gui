import type { FrontendLogPayloadEntry } from "../../types";

const STORAGE_KEY = "irodori.frontend-log-queue";
const MAX_ENTRIES = 200;

type FrontendLogContext = Record<string, string | number | boolean | null>;

type FrontendLogInput = {
  level: FrontendLogPayloadEntry["level"];
  event: string;
  projectId?: string | null;
  jobId?: string | null;
  message: string;
  context?: FrontendLogContext;
};

type FrontendLogStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type FrontendLogStoreOptions = {
  storage?: FrontendLogStorage;
  postLogs: (entries: FrontendLogPayloadEntry[]) => Promise<{ accepted: number }>;
  now?: () => string;
  sessionId?: string;
};

function createSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadQueue(storage: FrontendLogStorage): FrontendLogPayloadEntry[] {
  const stored = storage.getItem(STORAGE_KEY);
  if (!stored) return [];

  try {
    const parsed = JSON.parse(stored) as FrontendLogPayloadEntry[];
    return Array.isArray(parsed) ? parsed.slice(-MAX_ENTRIES) : [];
  } catch {
    storage.removeItem(STORAGE_KEY);
    return [];
  }
}

function persistQueue(storage: FrontendLogStorage, queue: FrontendLogPayloadEntry[]): void {
  if (queue.length === 0) {
    storage.removeItem(STORAGE_KEY);
    return;
  }

  storage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

function entryKey(entry: FrontendLogPayloadEntry): string {
  return JSON.stringify(entry);
}

function mergeQueues(
  persisted: FrontendLogPayloadEntry[],
  local: FrontendLogPayloadEntry[],
): FrontendLogPayloadEntry[] {
  const baseCounts = new Map<string, number>();
  for (const entry of persisted) {
    const key = entryKey(entry);
    baseCounts.set(key, (baseCounts.get(key) ?? 0) + 1);
  }

  const localSeenCounts = new Map<string, number>();
  const merged = [...persisted];
  for (const entry of local) {
    const key = entryKey(entry);
    const seenCount = (localSeenCounts.get(key) ?? 0) + 1;
    localSeenCounts.set(key, seenCount);
    if (seenCount > (baseCounts.get(key) ?? 0)) {
      merged.push(entry);
    }
  }

  return merged.slice(-MAX_ENTRIES);
}

function removeEntries(
  persisted: FrontendLogPayloadEntry[],
  toRemove: FrontendLogPayloadEntry[],
): FrontendLogPayloadEntry[] {
  const removalCounts = new Map<string, number>();
  for (const entry of toRemove) {
    const key = entryKey(entry);
    removalCounts.set(key, (removalCounts.get(key) ?? 0) + 1);
  }

  return persisted.filter((entry) => {
    const key = entryKey(entry);
    const remaining = removalCounts.get(key) ?? 0;
    if (remaining === 0) return true;
    removalCounts.set(key, remaining - 1);
    return false;
  });
}

export function createFrontendLogStore(options: FrontendLogStoreOptions) {
  const storage = options.storage ?? window.localStorage;
  const sessionId = options.sessionId ?? createSessionId();
  const now = options.now ?? (() => new Date().toISOString());
  let queue = loadQueue(storage);

  function enqueue(input: FrontendLogInput): void {
    queue = mergeQueues(loadQueue(storage), [
      ...queue,
      {
        timestamp: now(),
        level: input.level,
        event: input.event,
        project_id: input.projectId ?? null,
        job_id: input.jobId ?? null,
        message: input.message,
        context: {
          ...(input.context ?? {}),
          session_id: sessionId,
        },
      },
    ].slice(-MAX_ENTRIES));

    persistQueue(storage, queue);
  }

  function snapshot(): FrontendLogPayloadEntry[] {
    return [...queue];
  }

  async function flush(): Promise<void> {
    const entries = queue.slice();
    if (entries.length === 0) return;

    try {
      await options.postLogs(entries);
      queue = removeEntries(loadQueue(storage), entries);
      persistQueue(storage, queue);
    } catch {
      // Keep the queue so a later flush can retry.
      queue = mergeQueues(loadQueue(storage), queue);
    }
  }

  return { enqueue, snapshot, flush, sessionId };
}
