import { render, screen } from "@testing-library/react";
import { useState, type Dispatch, type SetStateAction } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

async function flushRetryCycle(count: number) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
    await vi.runOnlyPendingTimersAsync();
  }
}

function HookHarness({
  initialTrackedJobIds = ["job-1"],
  initialDisplayJob = null,
}: {
  initialTrackedJobIds?: string[];
  initialDisplayJob?: GenerationJob | null;
}) {
  const [trackedJobIds, setTrackedJobIds] = useState(initialTrackedJobIds);
  const [, setProject] = useState<Project | null>(project);
  const [displayJob, setDisplayJob] = useState<GenerationJob | null>(initialDisplayJob);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <>
      <output data-testid="tracked-job-count">{trackedJobIds.length}</output>
      <output data-testid="display-job-status">{displayJob?.status ?? "none"}</output>
      <output data-testid="error-message">{error ?? "none"}</output>
    </>
  );
}

describe("useProjectJobs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
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

    await vi.advanceTimersByTimeAsync(750);

    expect(getJob).toHaveBeenCalledTimes(2);
    expect(getProject).toHaveBeenCalledTimes(2);
  });

  it("continues polling while any tracked job is still running", async () => {
    const getProject = vi.spyOn(api, "getProject").mockResolvedValue(project);
    const getJob = vi
      .spyOn(api, "getJob")
      .mockResolvedValueOnce({ ...runningJob, id: "job-1", status: "completed", completed_cells: 2, active_cell_id: null })
      .mockResolvedValueOnce({ ...runningJob, id: "job-2", status: "running" })
      .mockResolvedValueOnce({ ...runningJob, id: "job-2", status: "completed", completed_cells: 2, active_cell_id: null });

    render(<HookHarness initialTrackedJobIds={["job-1", "job-2"]} />);

    await vi.advanceTimersByTimeAsync(500);

    expect(getJob).toHaveBeenCalledTimes(3);
    expect(getProject).toHaveBeenCalledTimes(2);
  });

  it("clears the running job lock and display job after retry exhaustion", async () => {
    vi.spyOn(api, "getProject").mockResolvedValue(project);
    vi.spyOn(api, "getJob").mockRejectedValue(new Error("temporary"));

    render(<HookHarness initialDisplayJob={runningJob} />);

    await flushRetryCycle(4);
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.getByTestId("tracked-job-count")).toHaveTextContent("0");
    expect(screen.getByTestId("display-job-status")).toHaveTextContent("none");
    expect(screen.getByTestId("error-message")).toHaveTextContent("temporary");
  });
});
