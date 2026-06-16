import { afterEach, describe, expect, it, vi } from "vitest";

import { createFrontendLogStore } from "./frontendLogStore";

afterEach(() => {
  window.localStorage.clear();
});

describe("frontend log store", () => {
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
});
