import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import * as api from "./api/client";
import { ProjectEditor } from "./features/editor/ProjectEditor";
import { useProjectJobs } from "./features/editor/useProjectJobs";
import { createFrontendLogStore } from "./features/logging/frontendLogStore";
import { ProjectHome } from "./features/projects/ProjectHome";
import type { AppLogEntry, GenerationJob, Project, ProjectSummary } from "./types";

export function App() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [selectedCellIds, setSelectedCellIds] = useState<string[]>([]);
  const [projectLogs, setProjectLogs] = useState<AppLogEntry[]>([]);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [displayJob, setDisplayJob] = useState<GenerationJob | null>(null);
  const [trackedJobIds, setTrackedJobIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [routeLoading, setRouteLoading] = useState(Boolean(projectId));
  const [error, setError] = useState<string | null>(null);
  const referenceQueue = useRef(Promise.resolve());
  const frontendLogStoreRef = useRef<ReturnType<typeof createFrontendLogStore> | null>(null);

  if (!frontendLogStoreRef.current) {
    frontendLogStoreRef.current = createFrontendLogStore({ postLogs: api.postFrontendLogs });
  }

  function showError(reason: unknown) {
    setError(reason instanceof Error ? reason.message : String(reason));
  }

  function describeReason(reason: unknown) {
    return {
      name: reason instanceof Error ? reason.name : typeof reason,
      message: reason instanceof Error ? reason.message : String(reason),
      networkState: reason instanceof api.ApiError ? "online_http_error" : "offline_or_unreachable",
    };
  }

  function enqueueFrontendLog(input: {
    level: "info" | "warning" | "error";
    event: string;
    projectId?: string | null;
    jobId?: string | null;
    message: string;
    context?: Record<string, string | number | boolean | null>;
  }) {
    frontendLogStoreRef.current?.enqueue(input);
  }

  async function flushFrontendLogs() {
    await frontendLogStoreRef.current?.flush();
  }

  async function logApiFailure(
    event: "api_request_failed" | "project_log_refresh_failed" | "unhandled_frontend_error",
    reason: unknown,
    context: Record<string, string | number | boolean | null> = {},
    activeProjectId: string | null = projectId ?? null,
  ) {
    const described = describeReason(reason);
    enqueueFrontendLog({
      level: "error",
      event,
      projectId: activeProjectId,
      message: described.message,
      context: {
        ...context,
        error_name: described.name,
        network_state: described.networkState,
      },
    });
    await flushFrontendLogs();
  }

  useEffect(() => {
    let cancelled = false;
    setRouteLoading(Boolean(projectId));
    if (!projectId) setBusy(true);
    if (projectId) setError(null);
    if (projectId) setProject(null);
    setSelectionMode(false);
    setSelectedCellId(null);
    setSelectedCellIds([]);
    setProjectLogs([]);
    setExportUrl(null);
    setDisplayJob(null);
    setTrackedJobIds([]);

    const request = projectId
      ? api.getProject(projectId).then(async (loaded) => {
          const logs = await api.getProjectLogs(projectId).catch(async (reason) => {
            await logApiFailure(
              "project_log_refresh_failed",
              reason,
              {
                event_type: "route_load",
                request_method: "GET",
                request_path: `/api/logs?project_id=${encodeURIComponent(projectId)}`,
              },
              projectId,
            );
            return [];
          });
          if (!cancelled) {
            setProject(loaded);
            setProjectLogs(logs);
            setRouteLoading(false);
          }
          await flushFrontendLogs();
        })
      : api.listProjects().then(async (listed) => {
          if (!cancelled) {
            setProject(null);
            setProjects(listed);
            setRouteLoading(false);
          }
          await flushFrontendLogs();
        });

    request
      .catch(async (reason) => {
        if (cancelled) return;
        await logApiFailure(
          "api_request_failed",
          reason,
          {
            event_type: "route_load",
            request_method: "GET",
            request_path: projectId ? `/api/projects/${projectId}` : "/api/projects",
          },
          projectId ?? null,
        );
        showError(reason);
        if (projectId) setProject(null);
        setRouteLoading(false);
        if (projectId && reason instanceof api.ApiError && reason.status === 404) {
          navigate("/", { replace: true });
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    function handleError(event: ErrorEvent) {
      void logApiFailure(
        "unhandled_frontend_error",
        event.error ?? new Error(event.message || "Unhandled frontend error"),
        {
          event_type: "window_error",
          filename: event.filename || null,
          line_number: event.lineno || null,
          column_number: event.colno || null,
        },
      );
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      const reason = event.reason instanceof Error
        ? event.reason
        : new Error(typeof event.reason === "string" ? event.reason : "Unhandled promise rejection");
      void logApiFailure("unhandled_frontend_error", reason, { event_type: "unhandledrejection" });
    }

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, [projectId]);

  useProjectJobs({
    projectId: projectId ?? null,
    trackedJobIds,
    setProject,
    setDisplayJob,
    setTrackedJobIds,
    setError,
  });

  async function refreshProjectLogs(activeProjectId: string) {
    await flushFrontendLogs();
    try {
      setProjectLogs(await api.getProjectLogs(activeProjectId));
    } catch (reason) {
      await logApiFailure(
        "project_log_refresh_failed",
        reason,
        {
          event_type: "project_refresh",
          request_method: "GET",
          request_path: `/api/logs?project_id=${encodeURIComponent(activeProjectId)}`,
        },
        activeProjectId,
      );
    }
  }

  async function runProjectAction(action: () => Promise<Project>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await action();
      setProject(updated);
      await flushFrontendLogs();
      if (projectId) {
        await refreshProjectLogs(projectId);
      }
      return updated;
    } catch (reason) {
      await logApiFailure(
        "api_request_failed",
        reason,
        { event_type: "project_action" },
        projectId ?? null,
      );
      showError(reason);
      if (projectId) {
        await refreshProjectLogs(projectId);
      }
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function startJob(action: () => Promise<GenerationJob>) {
    setBusy(true);
    setError(null);
    try {
      const started = await action();
      await flushFrontendLogs();
      if (started.status === "running") {
        setDisplayJob(started);
        setTrackedJobIds((current) => [...new Set([...current, started.id])]);
        if (projectId) {
          const updatedProject = await api.getProject(projectId);
          setProject(updatedProject);
          await refreshProjectLogs(projectId);
        }
      } else if (trackedJobIds.length === 0) {
        setDisplayJob(started);
      }
      if (started.status !== "running" && projectId) {
        const updatedProject = await api.getProject(projectId);
        setProject(updatedProject);
        await refreshProjectLogs(projectId);
      }
    } catch (reason) {
      await logApiFailure(
        "api_request_failed",
        reason,
        { event_type: "generation_job" },
        projectId ?? null,
      );
      showError(reason);
      if (projectId) {
        await refreshProjectLogs(projectId);
      }
    } finally {
      setBusy(false);
    }
  }

  if (projectId && routeLoading) {
    return <div className="route-loading-shell">Loading project…</div>;
  }

  if (projectId && (!project || project.id !== projectId)) {
    return (
      <>
        <div className="route-loading-shell">Unable to load project.</div>
        {error && <button type="button" className="global-error" onClick={() => setError(null)}>{error}</button>}
      </>
    );
  }

  if (!project) {
    return (
      <>
        <ProjectHome
          projects={projects}
          busy={busy}
          onCreate={async (name) => {
            setBusy(true);
            setError(null);
            try {
              const created = await api.createProject(name);
              await flushFrontendLogs();
              setProject(created);
              navigate(`/projects/${created.id}`);
            } catch (reason) {
              await logApiFailure(
                "api_request_failed",
                reason,
                {
                  event_type: "project_create",
                  request_method: "POST",
                  request_path: "/api/projects",
                },
              );
              showError(reason);
            } finally {
              setBusy(false);
            }
          }}
          onOpen={(id) => navigate(`/projects/${id}`)}
          onDelete={async (id) => {
            const target = projects.find((item) => item.id === id);
            if (!target) return;
            if (!window.confirm(`プロジェクト「${target.name}」を削除しますか？`)) return;
            setBusy(true);
            setError(null);
            try {
              await api.deleteProject(id);
              await flushFrontendLogs();
              setProjects((current) => current.filter((item) => item.id !== id));
            } catch (reason) {
              await logApiFailure(
                "api_request_failed",
                reason,
                {
                  event_type: "project_delete",
                  request_method: "DELETE",
                  request_path: `/api/projects/${id}`,
                },
              );
              showError(reason);
            } finally {
              setBusy(false);
            }
          }}
        />
        {error && <button type="button" className="global-error" onClick={() => setError(null)}>{error}</button>}
      </>
    );
  }

  return (
    <>
      <ProjectEditor
        key={project.id}
        project={project}
        busy={busy || trackedJobIds.length > 0}
        job={displayJob}
        selectionMode={selectionMode}
        selectedCellId={selectedCellId}
        selectedCellIds={selectedCellIds}
        projectLogs={projectLogs}
        exportUrl={exportUrl}
        onBack={() => navigate("/")}
        onDeleteProject={async () => {
          if (!window.confirm(`プロジェクト「${project.name}」を削除しますか？`)) return;
          setBusy(true);
          try {
            await api.deleteProject(project.id);
            await flushFrontendLogs();
            navigate("/");
          } catch (reason) {
            await logApiFailure(
              "api_request_failed",
              reason,
              {
                event_type: "project_delete",
                request_method: "DELETE",
                request_path: `/api/projects/${project.id}`,
              },
              project.id,
            );
            showError(reason);
          } finally {
            setBusy(false);
          }
        }}
        onSelectCell={setSelectedCellId}
        onToggleCellSelection={(cellId) => {
          setSelectedCellIds((current) => {
            const next = current.includes(cellId)
              ? current.filter((id) => id !== cellId)
              : [...current, cellId];
            enqueueFrontendLog({
              level: "info",
              event: "cell_selection_toggled",
              projectId: project.id,
              message: `セル選択を${current.includes(cellId) ? "解除" : "追加"}しました`,
              context: {
                cell_id: cellId,
                selected_cell_count: next.length,
                selection_mode: true,
              },
            });
            return next;
          });
        }}
        onEnterSelectionMode={() => {
          setSelectionMode(true);
          setSelectedCellIds([]);
          enqueueFrontendLog({
            level: "info",
            event: "selection_mode_entered",
            projectId: project.id,
            message: "複数選択モードに入りました",
            context: {
              selected_cell_count: 0,
              selection_mode: true,
            },
          });
        }}
        onCancelSelectionMode={() => {
          setSelectionMode(false);
          setSelectedCellIds([]);
          enqueueFrontendLog({
            level: "info",
            event: "selection_mode_canceled",
            projectId: project.id,
            message: "複数選択モードを終了しました",
            context: {
              selected_cell_count: 0,
              selection_mode: false,
            },
          });
        }}
        onImportFiles={(files) => void runProjectAction(() => api.importLines(project.id, files))}
        onAppendLines={(texts) => void runProjectAction(() => api.appendLines(project.id, texts))}
        onAddReference={(label, file) => {
          referenceQueue.current = referenceQueue.current.then(async () => {
            await runProjectAction(() => api.addReference(project.id, label, file));
          });
        }}
        onDeleteReference={(referenceId) => void runProjectAction(() => api.deleteReference(project.id, referenceId))}
        onEditLine={(lineId, text) => void runProjectAction(() => api.updateLine(project.id, lineId, text))}
        onInsertLine={(index, text) => void runProjectAction(() => api.insertLine(project.id, index, text))}
        onDeleteLine={(lineId) => void runProjectAction(() => api.deleteLine(project.id, lineId))}
        onClearLines={() => void runProjectAction(() => api.clearLines(project.id))}
        onReorder={(lineIds) => void runProjectAction(() => api.reorderLines(project.id, lineIds))}
        onGenerate={(onlyMissing) => void startJob(() => api.startGenerationJob(project.id, onlyMissing))}
        onRegenerateSelected={(cellIds, seed) => {
          enqueueFrontendLog({
            level: "info",
            event: "bulk_regeneration_requested",
            projectId: project.id,
            message: "選択セルの再生成を開始しました",
            context: {
              selected_cell_count: cellIds.length,
              selection_mode: true,
              seed,
            },
          });
          setSelectionMode(false);
          setSelectedCellIds([]);
          void startJob(() => api.startBulkRegenerationJob(project.id, cellIds, seed));
        }}
        onRegenerate={(cellId, seed) => void startJob(() => api.startRegenerationJob(project.id, cellId, seed))}
        onMarkCellPlayed={(cellId) => void runProjectAction(() => api.markCellPlayed(project.id, cellId))}
        onAppendToPlaylist={(cellId) => void runProjectAction(() => api.appendPlaylistItem(project.id, cellId))}
        onAppendReferenceColumn={(referenceId) => void runProjectAction(() => api.appendReferenceColumn(project.id, referenceId))}
        onRemovePlaylistItem={(playlistItemId) => void runProjectAction(() => api.removePlaylistItem(project.id, playlistItemId))}
        onReorderPlaylist={(playlistItemIds) => void runProjectAction(() => api.reorderPlaylist(project.id, playlistItemIds))}
        onClearPlaylist={() => void runProjectAction(() => api.clearPlaylist(project.id))}
        onExport={async () => {
          setBusy(true);
          setError(null);
          try {
            const result = await api.exportProject(project.id);
            setExportUrl(result.media_url);
          } catch (reason) {
            showError(reason);
          } finally {
            setBusy(false);
          }
        }}
        onExportText={() => api.downloadLinesText(project.id)}
        onSaveSettings={(settings) => void runProjectAction(() => api.updateProject(project.id, settings))}
      />
      {error && <button type="button" className="global-error" onClick={() => setError(null)}>{error}</button>}
    </>
  );
}
