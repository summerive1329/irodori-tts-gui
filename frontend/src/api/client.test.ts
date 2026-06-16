import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, clearLines, clearPlaylist, getProjectLogs, importLines, listProjects } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("API client", () => {
  it("uploads every dropped line file in one multipart request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "project-1", lines: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const files = [new File(["one"], "one.txt"), new File(["two"], "two.md")];

    await importLines("project-1", files);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/projects/project-1/lines/import");
    expect(init.method).toBe("POST");
    expect((init.body as FormData).getAll("files")).toEqual(files);
  });

  it("surfaces FastAPI error details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Project not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(listProjects()).rejects.toEqual(
      new ApiError(404, "Project not found"),
    );
  });

  it("calls the clear playlist endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "project-1", export_playlist: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await clearPlaylist("project-1");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/projects/project-1/playlist/items");
    expect(init.method).toBe("DELETE");
  });

  it("calls the clear lines endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "project-1", lines: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await clearLines("project-1");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/projects/project-1/lines");
    expect(init.method).toBe("DELETE");
  });

  it("calls the project logs endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getProjectLogs("project-1");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/logs?project_id=project-1");
    expect(init).toBeUndefined();
  });
});
