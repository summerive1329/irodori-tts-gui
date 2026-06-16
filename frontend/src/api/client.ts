import type { GenerationJob, Project, ProjectSummary } from "../types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`.trim();
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) message = payload.detail;
    } catch {
      // Keep the HTTP status when the server did not return JSON.
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function listProjects(): Promise<ProjectSummary[]> {
  return request("/api/projects");
}

export function createProject(name: string): Promise<Project> {
  return request("/api/projects", json("POST", { name }));
}

export function getProject(projectId: string): Promise<Project> {
  return request(`/api/projects/${projectId}`);
}

export function updateProject(projectId: string, updates: Partial<Project>): Promise<Project> {
  return request(`/api/projects/${projectId}`, json("PATCH", updates));
}

export function deleteProject(projectId: string): Promise<void> {
  return request(`/api/projects/${projectId}`, { method: "DELETE" });
}

export function appendLines(projectId: string, texts: string[]): Promise<Project> {
  return request(`/api/projects/${projectId}/lines`, json("POST", { texts }));
}

export function insertLine(projectId: string, index: number, text: string): Promise<Project> {
  return request(`/api/projects/${projectId}/lines/insert`, json("POST", { index, text }));
}

export function importLines(projectId: string, files: File[]): Promise<Project> {
  const body = new FormData();
  for (const file of files) body.append("files", file);
  return request(`/api/projects/${projectId}/lines/import`, { method: "POST", body });
}

export function updateLine(projectId: string, lineId: string, text: string): Promise<Project> {
  return request(`/api/projects/${projectId}/lines/${lineId}`, json("PATCH", { text }));
}

export function deleteLine(projectId: string, lineId: string): Promise<Project> {
  return request(`/api/projects/${projectId}/lines/${lineId}`, { method: "DELETE" });
}

export function clearLines(projectId: string): Promise<Project> {
  return request(`/api/projects/${projectId}/lines`, { method: "DELETE" });
}

export function reorderLines(projectId: string, lineIds: string[]): Promise<Project> {
  return request(`/api/projects/${projectId}/lines/order`, json("PUT", { line_ids: lineIds }));
}

export function addReference(projectId: string, label: string, file: File): Promise<Project> {
  const body = new FormData();
  body.append("label", label);
  body.append("file", file);
  return request(`/api/projects/${projectId}/references`, { method: "POST", body });
}

export function deleteReference(projectId: string, referenceId: string): Promise<Project> {
  return request(`/api/projects/${projectId}/references/${referenceId}`, { method: "DELETE" });
}

export function startGenerationJob(projectId: string, onlyMissing: boolean): Promise<GenerationJob> {
  return request(`/api/projects/${projectId}/generate/jobs`, json("POST", { only_missing: onlyMissing }));
}

export function getJob(projectId: string, jobId: string): Promise<GenerationJob> {
  return request(`/api/projects/${projectId}/jobs/${jobId}`);
}

export function startRegenerationJob(
  projectId: string,
  cellId: string,
  seed: number | null,
): Promise<GenerationJob> {
  return request(`/api/projects/${projectId}/cells/${cellId}/regeneration-jobs`, json("POST", { seed }));
}

export function startBulkRegenerationJob(
  projectId: string,
  cellIds: string[],
  seed: number | null,
): Promise<GenerationJob> {
  return request(`/api/projects/${projectId}/cells/regeneration-jobs`, json("POST", { cell_ids: cellIds, seed }));
}

export function markCellPlayed(projectId: string, cellId: string): Promise<Project> {
  return request(`/api/projects/${projectId}/cells/${cellId}/playback-events`, { method: "POST" });
}

export function appendPlaylistItem(projectId: string, cellId: string): Promise<Project> {
  return request(`/api/projects/${projectId}/playlist/items`, json("POST", { cell_id: cellId }));
}

export function appendReferenceColumn(projectId: string, referenceId: string): Promise<Project> {
  return request(`/api/projects/${projectId}/playlist/references/${referenceId}`, { method: "POST" });
}

export function removePlaylistItem(projectId: string, playlistItemId: string): Promise<Project> {
  return request(`/api/projects/${projectId}/playlist/items/${playlistItemId}`, { method: "DELETE" });
}

export function clearPlaylist(projectId: string): Promise<Project> {
  return request(`/api/projects/${projectId}/playlist/items`, { method: "DELETE" });
}

export function reorderPlaylist(projectId: string, playlistItemIds: string[]): Promise<Project> {
  return request(
    `/api/projects/${projectId}/playlist/order`,
    json("PUT", { playlist_item_ids: playlistItemIds }),
  );
}

export function downloadLinesText(projectId: string): void {
  const link = document.createElement("a");
  link.href = `/api/projects/${projectId}/lines.txt`;
  link.download = "";
  link.click();
}

export function exportProject(projectId: string): Promise<{ media_url: string }> {
  return request(`/api/projects/${projectId}/export`, { method: "POST" });
}
