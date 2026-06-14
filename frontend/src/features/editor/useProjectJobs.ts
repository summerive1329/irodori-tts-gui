import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import * as api from "../../api/client";
import type { GenerationJob, Project } from "../../types";

const MAX_RETRIES = 3;

type Options = {
  projectId: string | null;
  trackedJobIds: string[];
  setProject: Dispatch<SetStateAction<Project | null>>;
  setDisplayJob: Dispatch<SetStateAction<GenerationJob | null>>;
  setTrackedJobIds: Dispatch<SetStateAction<string[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
};

export function useProjectJobs({
  projectId,
  trackedJobIds,
  setProject,
  setDisplayJob,
  setTrackedJobIds,
  setError,
}: Options) {
  const trackedJobIdsRef = useRef(trackedJobIds);
  trackedJobIdsRef.current = trackedJobIds;

  useEffect(() => {
    if (!projectId || trackedJobIds.length === 0) return;

    let cancelled = false;
    let timer: number | undefined;
    let failures = 0;

    async function poll() {
      const currentJobIds = trackedJobIdsRef.current;
      if (currentJobIds.length === 0) return;

      try {
        const [project, jobs] = await Promise.all([
          api.getProject(projectId),
          Promise.all(currentJobIds.map((jobId) => api.getJob(projectId, jobId))),
        ]);
        if (cancelled) return;
        failures = 0;
        setProject(project);
        const runningJobIds = jobs.filter((job) => job.status === "running").map((job) => job.id);
        const latestRunningJob = jobs.findLast((job) => job.status === "running") ?? null;
        setDisplayJob(latestRunningJob ?? jobs.at(-1) ?? null);
        trackedJobIdsRef.current = runningJobIds;
        setTrackedJobIds(runningJobIds);
        if (runningJobIds.length > 0) {
          timer = window.setTimeout(poll, 500);
        }
      } catch (reason) {
        if (cancelled) return;
        failures += 1;
        if (failures > MAX_RETRIES) {
          setError(reason instanceof Error ? reason.message : String(reason));
          trackedJobIdsRef.current = [];
          setDisplayJob(null);
          setTrackedJobIds([]);
          return;
        }
        timer = window.setTimeout(poll, failures * 750);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [projectId, setDisplayJob, setError, setProject, setTrackedJobIds, trackedJobIds.length]);
}
