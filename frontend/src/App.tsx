import { useEffect, useRef, useState } from "react";

import * as api from "./api/client";
import { ProjectEditor } from "./features/editor/ProjectEditor";
import { ProjectHome } from "./features/projects/ProjectHome";
import type { Project, ProjectSummary } from "./types";

export function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const referenceQueue = useRef(Promise.resolve());

  useEffect(() => {
    api.listProjects()
      .then(setProjects)
      .catch(showError)
      .finally(() => setBusy(false));
  }, []);

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

  async function refreshProjects() {
    try {
      setProjects(await api.listProjects());
    } catch (reason) {
      showError(reason);
    }
  }

  if (!project) {
    return (
      <>
        <ProjectHome
          projects={projects}
          busy={busy}
          onCreate={async (name) => {
            const created = await runProjectAction(() => api.createProject(name));
            if (created) await refreshProjects();
          }}
          onOpen={(projectId) => void runProjectAction(() => api.getProject(projectId))}
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
        busy={busy}
        selectedCellId={selectedCellId}
        exportUrl={exportUrl}
        onBack={() => {
          setProject(null);
          setSelectedCellId(null);
          setExportUrl(null);
          void refreshProjects();
        }}
        onDeleteProject={async () => {
          if (!window.confirm(`Delete project “${project.name}”?`)) return;
          setBusy(true);
          try {
            await api.deleteProject(project.id);
            setProject(null);
            await refreshProjects();
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
        onDeleteLine={(lineId) => void runProjectAction(() => api.deleteLine(project.id, lineId))}
        onReorder={(lineIds) => void runProjectAction(() => api.reorderLines(project.id, lineIds))}
        onGenerate={(onlyMissing) => void runProjectAction(() => api.generateAll(project.id, onlyMissing))}
        onRegenerate={(cellId, seed) => void runProjectAction(() => api.regenerateCell(project.id, cellId, seed))}
        onSelectForExport={(cellId) => void runProjectAction(() => api.selectCell(project.id, cellId))}
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
        onSaveSettings={(settings) => void runProjectAction(() => api.updateProject(project.id, settings))}
      />
      {error && <button type="button" className="global-error" onClick={() => setError(null)}>{error}</button>}
    </>
  );
}

