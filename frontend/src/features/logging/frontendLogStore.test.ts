import { afterEach, describe, expect, it, vi } from "vitest";

import { createFrontendLogStore } from "./frontendLogStore";

afterEach(() => {
  window.localStorage.clear();
});

describe("frontend log store", () => {
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
