import { render, waitFor } from "@testing-library/react";
import { useState, type Dispatch, type SetStateAction } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "../../api/client";
import type { GenerationJob, Project } from "../../types";
import { useProjectJobs } from "./useProjectJobs";

const project: Project = {
  id: "project-1",
  name: "demo",
  created_at: "2026-06-14T00:00:00Z",
  updated_at: "2026-06-14T00:00:00Z",
  checkpoint: "Aratako/Irodori-TTS-500M-v3",
  model_device: "cuda",
  model_precision: "fp32",
  codec_device: "cuda",
  codec_precision: "fp32",
  num_steps: 40,
  cfg_scale_text: 3,
  cfg_scale_speaker: 5,
  references: [],
  lines: [],
  cells: [],
  export_playlist: [],
};

const runningJob: GenerationJob = {
  id: "job-1",
  project_id: "project-1",
  kind: "generate_missing",
  status: "running",
  total_cells: 2,
  completed_cells: 1,
  target_cell_ids: ["cell-1", "cell-2"],
  active_cell_id: "cell-2",
  error_message: null,
  created_at: "2026-06-14T00:00:00Z",
  updated_at: "2026-06-14T00:00:00Z",
};

function HookHarness({ initialTrackedJobIds = ["job-1"] }: { initialTrackedJobIds?: string[] }) {
  const [trackedJobIds, setTrackedJobIds] = useState(initialTrackedJobIds);
  const [, setProject] = useState<Project | null>(project);
  const [, setDisplayJob] = useState<GenerationJob | null>(null);
  const [, setError] = useState<string | null>(null);

  (
    useProjectJobs as unknown as (options: {
      projectId: string | null;
      trackedJobIds: string[];
      setProject: Dispatch<SetStateAction<Project | null>>;
      setDisplayJob: Dispatch<SetStateAction<GenerationJob | null>>;
      setTrackedJobIds: Dispatch<SetStateAction<string[]>>;
      setError: Dispatch<SetStateAction<string | null>>;
    }) => void
  )({
    projectId: "project-1",
    trackedJobIds,
    setProject,
    setDisplayJob,
    setTrackedJobIds,
    setError,
  });

  return null;
}

describe("useProjectJobs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps polling after a transient getJob failure", async () => {
    const getProject = vi.spyOn(api, "getProject").mockResolvedValue(project);
    const getJob = vi
      .spyOn(api, "getJob")
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({
        ...runningJob,
        status: "completed",
        completed_cells: 2,
        active_cell_id: null,
      });

    render(<HookHarness />);

    await waitFor(() => expect(getJob).toHaveBeenCalledTimes(2), { timeout: 1200 });
    await waitFor(() => expect(getProject).toHaveBeenCalledTimes(2), { timeout: 1200 });
  });

  it("continues polling while any tracked job is still running", async () => {
    const getProject = vi.spyOn(api, "getProject").mockResolvedValue(project);
    const getJob = vi
      .spyOn(api, "getJob")
      .mockResolvedValueOnce({ ...runningJob, id: "job-1", status: "completed", completed_cells: 2, active_cell_id: null })
      .mockResolvedValueOnce({ ...runningJob, id: "job-2", status: "running" })
      .mockResolvedValueOnce({ ...runningJob, id: "job-2", status: "completed", completed_cells: 2, active_cell_id: null });

    render(<HookHarness initialTrackedJobIds={["job-1", "job-2"]} />);

    await waitFor(() => expect(getJob).toHaveBeenCalledTimes(3), { timeout: 1200 });
    await waitFor(() => expect(getProject).toHaveBeenCalledTimes(2), { timeout: 1200 });
  });
});
