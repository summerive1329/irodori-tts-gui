import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import * as api from "./api/client";
import { ProjectEditor } from "./features/editor/ProjectEditor";
import { useProjectJobs } from "./features/editor/useProjectJobs";
import { ProjectHome } from "./features/projects/ProjectHome";
import type { GenerationJob, Project, ProjectSummary } from "./types";

export function App() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [job, setJob] = useState<GenerationJob | null>(null);
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
    setSelectedCellId(null);
    setExportUrl(null);
    setJob(null);
    setTrackedJobIds([]);

    const request = projectId
      ? api.getProject(projectId).then((loaded) => {
          if (!cancelled) {
            setProject(loaded);
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
        setRouteLoading(false);
        if (projectId && reason instanceof api.ApiError && reason.status === 404) {
          setProject(null);
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
    setDisplayJob: setJob,
    setTrackedJobIds,
    setError,
  });

  function showError(reason: unknown) {
    setError(reason instanceof Error ? reason.message : String(reason));
  }

  async function runProjectAction(action: () => Promise<Project>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await action();
      setProject(updated);
      return updated;
    } catch (reason) {
      showError(reason);
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
      setJob(started);
      if (started.status === "running") {
        setTrackedJobIds((current) => [...new Set([...current, started.id])]);
      } else {
        setTrackedJobIds([]);
      }
      if (started.status !== "running" && projectId) {
        setProject(await api.getProject(projectId));
      }
    } catch (reason) {
      showError(reason);
    } finally {
      setBusy(false);
    }
  }

  if (projectId && routeLoading && !project) {
    return <div className="route-loading-shell">Loading project…</div>;
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
        busy={busy || job?.status === "running"}
        job={job}
        selectedCellId={selectedCellId}
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
        onReorder={(lineIds) => void runProjectAction(() => api.reorderLines(project.id, lineIds))}
        onGenerate={(onlyMissing) => void startJob(() => api.startGenerationJob(project.id, onlyMissing))}
        onRegenerate={(cellId, seed) => void startJob(() => api.startRegenerationJob(project.id, cellId, seed))}
        onAppendToPlaylist={(cellId) => void runProjectAction(() => api.appendPlaylistItem(project.id, cellId))}
        onAppendReferenceColumn={(referenceId) => void runProjectAction(() => api.appendReferenceColumn(project.id, referenceId))}
        onRemovePlaylistItem={(playlistItemId) => void runProjectAction(() => api.removePlaylistItem(project.id, playlistItemId))}
        onReorderPlaylist={(playlistItemIds) => void runProjectAction(() => api.reorderPlaylist(project.id, playlistItemIds))}
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
