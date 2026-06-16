import { afterEach, describe, expect, it, vi } from "vitest";

import { createFrontendLogStore } from "./frontendLogStore";

afterEach(() => {
  window.localStorage.clear();
});

describe("frontend log store", () => {
  it("merges persisted entries before writing so multiple stores do not clobber each other", () => {
    const postLogs = vi.fn().mockResolvedValue({ accepted: 0 });
    const storeA = createFrontendLogStore({
      storage: window.localStorage,
      postLogs,
      sessionId: "session-a",
    });
    const storeB = createFrontendLogStore({
      storage: window.localStorage,
      postLogs,
      sessionId: "session-b",
    });

    storeA.enqueue({
      level: "info",
      event: "selection_mode_entered",
      message: "store A",
    });
    storeB.enqueue({
      level: "info",
      event: "selection_mode_entered",
      message: "store B",
    });

    expect(storeB.snapshot()).toHaveLength(2);
    expect(window.localStorage.getItem("irodori.frontend-log-queue")).toContain("store A");
    expect(window.localStorage.getItem("irodori.frontend-log-queue")).toContain("store B");
  });

  it("defaults to window.localStorage when storage is omitted", () => {
    const store = createFrontendLogStore({ postLogs: vi.fn().mockResolvedValue({ accepted: 0 }) });

    store.enqueue({
      level: "warning",
      event: "selection_mode_entered",
      message: "selection mode entered",
      context: { selection_mode: true },
    });

    const stored = window.localStorage.getItem("irodori.frontend-log-queue");
    expect(stored).toContain("selection_mode_entered");
    expect(store.snapshot()).toHaveLength(1);
  });

  it("keeps the generated session_id even when input context provides one", () => {
    const store = createFrontendLogStore({
      storage: window.localStorage,
      postLogs: vi.fn().mockResolvedValue({ accepted: 0 }),
      sessionId: "session-expected",
    });

    store.enqueue({
      level: "warning",
      event: "selection_mode_entered",
      message: "selection mode entered",
      context: {
        session_id: "session-spoofed",
        selection_mode: true,
      },
    });

    expect(store.snapshot()[0]?.context.session_id).toBe("session-expected");
  });

  it("stores frontend log entries in localStorage until flush succeeds", async () => {
    const postLogs = vi.fn().mockResolvedValue({ accepted: 1 });
    const store = createFrontendLogStore({ storage: window.localStorage, postLogs });

    store.enqueue({
      level: "error",
      event: "api_request_failed",
      projectId: "project-1",
      message: "request failed",
      context: { request_path: "/api/logs" },
    });

    expect(store.snapshot()).toHaveLength(1);

    await store.flush();

    expect(postLogs).toHaveBeenCalledTimes(1);
    expect(store.snapshot()).toHaveLength(0);
  });

  it("keeps queued entries when flush fails", async () => {
    const postLogs = vi.fn().mockRejectedValue(new Error("offline"));
    const store = createFrontendLogStore({ storage: window.localStorage, postLogs });

    store.enqueue({
      level: "error",
      event: "api_request_failed",
      projectId: "project-1",
      message: "request failed",
      context: { request_path: "/api/logs" },
    });

    await store.flush();

    expect(store.snapshot()).toHaveLength(1);
  });

  it("caps the queue at the newest 200 entries", () => {
    const store = createFrontendLogStore({
      storage: window.localStorage,
      postLogs: vi.fn().mockResolvedValue({ accepted: 0 }),
    });

    for (let index = 0; index < 205; index += 1) {
      store.enqueue({
        level: "info",
        event: "selection_mode_entered",
        message: `entry-${index}`,
      });
    }

    const snapshot = store.snapshot();
    expect(snapshot).toHaveLength(200);
    expect(snapshot[0]?.message).toBe("entry-5");
    expect(snapshot.at(-1)?.message).toBe("entry-204");
  });

  it("recovers from malformed persisted JSON", () => {
    window.localStorage.setItem("irodori.frontend-log-queue", "{broken");

    const store = createFrontendLogStore({
      storage: window.localStorage,
      postLogs: vi.fn().mockResolvedValue({ accepted: 0 }),
    });

    expect(store.snapshot()).toEqual([]);
    expect(window.localStorage.getItem("irodori.frontend-log-queue")).toBeNull();
  });
});
