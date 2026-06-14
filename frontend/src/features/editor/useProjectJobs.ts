import { useEffect, type Dispatch, type SetStateAction } from "react";

import * as api from "../../api/client";
import type { GenerationJob, Project } from "../../types";

type Options = {
  projectId: string | null;
  activeJobId: string | null;
  setProject: Dispatch<SetStateAction<Project | null>>;
  setJob: Dispatch<SetStateAction<GenerationJob | null>>;
  setActiveJobId: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
};

export function useProjectJobs({
  projectId,
  activeJobId,
  setProject,
  setJob,
  setActiveJobId,
  setError,
}: Options) {
  useEffect(() => {
    if (!projectId || !activeJobId) return;

    const currentProjectId = projectId;
    const currentJobId = activeJobId;
    let cancelled = false;
    let timer: number | undefined;

    async function poll() {
      try {
        const [project, job] = await Promise.all([
          api.getProject(currentProjectId),
          api.getJob(currentProjectId, currentJobId),
        ]);
        if (cancelled) return;
        setProject(project);
        setJob(job);
        if (job.status === "running") {
          timer = window.setTimeout(poll, 500);
        } else {
          setActiveJobId(null);
        }
      } catch (reason) {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setActiveJobId(null);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activeJobId, projectId, setActiveJobId, setError, setJob, setProject]);
}
