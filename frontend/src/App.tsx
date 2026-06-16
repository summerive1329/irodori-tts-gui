import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import * as api from "./api/client";
import { ProjectEditor } from "./features/editor/ProjectEditor";
import { useProjectJobs } from "./features/editor/useProjectJobs";
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
      ? Promise.all([api.getProject(projectId), api.getProjectLogs(projectId)]).then(([loaded, logs]) => {
          if (!cancelled) {
            setProject(loaded);
            setProjectLogs(logs);
            setRouteLoading(false);
          }
        })
      : api.listProjects().then((listed) => {
          if (!cancelled) {
            setProject(null);
            setProjects(listed);
            setRouteLoading(false);
          }
        });

    request
      .catch((reason) => {
        if (cancelled) return;
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

  useProjectJobs({
    projectId: projectId ?? null,
    trackedJobIds,
    setProject,
    setDisplayJob,
    setTrackedJobIds,
    setError,
  });

  function showError(reason: unknown) {
    setError(reason instanceof Error ? reason.message : String(reason));
  }

  async function refreshProjectLogs(activeProjectId: string) {
    setProjectLogs(await api.getProjectLogs(activeProjectId));
  }

  async function runProjectAction(action: () => Promise<Project>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await action();
      setProject(updated);
      if (projectId) {
        await refreshProjectLogs(projectId);
      }
      return updated;
    } catch (reason) {
      showError(reason);
      if (projectId) {
        try {
          await refreshProjectLogs(projectId);
        } catch {
          // Ignore log refresh failures while showing the main error.
        }
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
      if (started.status === "running") {
        setDisplayJob(started);
        setTrackedJobIds((current) => [...new Set([...current, started.id])]);
        if (projectId) {
          const [updatedProject, logs] = await Promise.all([
            api.getProject(projectId),
            api.getProjectLogs(projectId),
          ]);
          setProject(updatedProject);
          setProjectLogs(logs);
        }
      } else if (trackedJobIds.length === 0) {
        setDisplayJob(started);
      }
      if (started.status !== "running" && projectId) {
        const [updatedProject, logs] = await Promise.all([
          api.getProject(projectId),
          api.getProjectLogs(projectId),
        ]);
        setProject(updatedProject);
        setProjectLogs(logs);
      }
    } catch (reason) {
      showError(reason);
      if (projectId) {
        try {
          await refreshProjectLogs(projectId);
        } catch {
          // Ignore log refresh failures while showing the main error.
        }
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
              setProject(created);
              navigate(`/projects/${created.id}`);
            } catch (reason) {
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
              setProjects((current) => current.filter((item) => item.id !== id));
            } catch (reason) {
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
            navigate("/");
          } catch (reason) {
            showError(reason);
          } finally {
            setBusy(false);
          }
        }}
        onSelectCell={setSelectedCellId}
        onToggleCellSelection={(cellId) => {
          setSelectedCellIds((current) => (
            current.includes(cellId)
              ? current.filter((id) => id !== cellId)
              : [...current, cellId]
          ));
        }}
        onEnterSelectionMode={() => {
          setSelectionMode(true);
          setSelectedCellIds([]);
        }}
        onCancelSelectionMode={() => {
          setSelectionMode(false);
          setSelectedCellIds([]);
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
