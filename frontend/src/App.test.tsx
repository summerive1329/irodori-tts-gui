import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "./types";
import { ApiError } from "./api/client";

const apiMocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  getProject: vi.fn(),
  getProjectLogs: vi.fn(),
  listProjects: vi.fn(),
  markCellPlayed: vi.fn(),
  startBulkRegenerationJob: vi.fn(),
  startGenerationJob: vi.fn(),
}));

const jobHookControls = vi.hoisted(() => ({
  calls: [] as string[][],
  seedTrackedJobIds: null as string[] | null,
  seedDisplayJob: null as {
    id: string;
    project_id: string;
    kind: "generate_missing" | "generate_all" | "regenerate_cell";
    status: "running" | "completed" | "failed";
    total_cells: number;
    completed_cells: number;
    target_cell_ids: string[];
    active_cell_id: string | null;
    error_message: string | null;
    created_at: string;
    updated_at: string;
  } | null,
}));

const frontendLogStoreMocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  sessionId: "session-test",
  createFrontendLogStore: vi.fn(),
}));

vi.mock("./api/client", async () => {
  const actual = await vi.importActual<typeof import("./api/client")>("./api/client");
  return { ...actual, ...apiMocks };
});

vi.mock("./features/logging/frontendLogStore", () => ({
  createFrontendLogStore: frontendLogStoreMocks.createFrontendLogStore,
}));

vi.mock("./features/editor/useProjectJobs", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    useProjectJobs: (options: {
      projectId: string | null;
      trackedJobIds: string[];
      setTrackedJobIds: React.Dispatch<React.SetStateAction<string[]>>;
      setDisplayJob: React.Dispatch<
        React.SetStateAction<{
          id: string;
          project_id: string;
          kind: "generate_missing" | "generate_all" | "regenerate_cell";
          status: "running" | "completed" | "failed";
          total_cells: number;
          completed_cells: number;
          target_cell_ids: string[];
          active_cell_id: string | null;
          error_message: string | null;
          created_at: string;
          updated_at: string;
        } | null>
      >;
    }) => {
      jobHookControls.calls.push([...options.trackedJobIds]);
      React.useEffect(() => {
        if (jobHookControls.seedTrackedJobIds) {
          options.setTrackedJobIds((current) =>
            current.length === 0 ? jobHookControls.seedTrackedJobIds ?? current : current,
          );
        }
        if (jobHookControls.seedDisplayJob) {
          options.setDisplayJob(jobHookControls.seedDisplayJob);
        }
      }, [options.projectId, options.setDisplayJob, options.setTrackedJobIds]);
    },
  };
});

import { AppRouter } from "./router";
import { App } from "./App";

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
  generation_progress: {
    running_job_count: 0,
    running_job_kinds: [],
    has_running_jobs: false,
    active_jobs: [],
  },
  references: [],
  lines: [],
  cells: [],
  export_playlist: [],
};

const projectWithCells: Project = {
  ...project,
  lines: [{ id: "line-1", text: "hello", order_index: 0 }],
  references: [
    {
      id: "ref-1",
      label: "toru",
      source_filename: "toru.wav",
      copied_path: "references/toru.wav",
      duration_sec: 1,
    },
  ],
  cells: [
    {
      id: "cell-1",
      line_id: "line-1",
      reference_id: "ref-1",
      status: "idle",
      display_status: "not_generated",
      error_message: null,
      current_result: null,
    },
  ],
};

const projectWithUnplayedCell: Project = {
  ...project,
  lines: [{ id: "line-1", text: "hello", order_index: 0 }],
  references: [
    {
      id: "ref-1",
      label: "toru",
      source_filename: "toru.wav",
      copied_path: "references/toru.wav",
      duration_sec: 1,
    },
  ],
  cells: [
    {
      id: "cell-1",
      line_id: "line-1",
      reference_id: "ref-1",
      status: "ready",
      display_status: "unplayed",
      error_message: null,
      current_result: {
        audio_path: "cells/cell-1.wav",
        sample_rate: 24000,
        generated_at: "2026-06-14T00:00:00Z",
        seed: 7,
        duration_sec: 1,
      },
    },
  ],
};

const projectWithSelectableCells: Project = {
  ...project,
  lines: [{ id: "line-1", text: "hello", order_index: 0 }],
  references: [
    {
      id: "ref-1",
      label: "toru",
      source_filename: "toru.wav",
      copied_path: "references/toru.wav",
      duration_sec: 1,
    },
    {
      id: "ref-2",
      label: "lize",
      source_filename: "lize.wav",
      copied_path: "references/lize.wav",
      duration_sec: 1,
    },
  ],
  cells: [
    {
      id: "cell-1",
      line_id: "line-1",
      reference_id: "ref-1",
      status: "ready",
      display_status: "unplayed",
      error_message: null,
      current_result: {
        audio_path: "cells/cell-1.wav",
        sample_rate: 24000,
        generated_at: "2026-06-14T00:00:00Z",
        seed: 7,
        duration_sec: 1,
      },
    },
    {
      id: "cell-2",
      line_id: "line-1",
      reference_id: "ref-2",
      status: "ready",
      display_status: "unplayed",
      error_message: null,
      current_result: {
        audio_path: "cells/cell-2.wav",
        sample_rate: 24000,
        generated_at: "2026-06-14T00:00:00Z",
        seed: 8,
        duration_sec: 1,
      },
    },
  ],
};

const projectWithPlayedCell: Project = {
  ...projectWithUnplayedCell,
  cells: [
    {
      ...projectWithUnplayedCell.cells[0],
      display_status: "played",
    },
  ],
};

function RoutedAppHarness() {
  const navigate = useNavigate();

  return (
    <>
      <button type="button" onClick={() => navigate("/projects/project-2")}>next project</button>
      <App />
    </>
  );
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobHookControls.calls = [];
    jobHookControls.seedTrackedJobIds = null;
    jobHookControls.seedDisplayJob = null;
    frontendLogStoreMocks.createFrontendLogStore.mockReturnValue({
      enqueue: frontendLogStoreMocks.enqueue,
      flush: frontendLogStoreMocks.flush,
      sessionId: frontendLogStoreMocks.sessionId,
    });
    window.history.pushState({}, "", "/");
    apiMocks.listProjects.mockResolvedValue([]);
    apiMocks.createProject.mockResolvedValue(project);
    apiMocks.deleteProject.mockResolvedValue(undefined);
    apiMocks.getProject.mockResolvedValue(project);
    apiMocks.getProjectLogs.mockResolvedValue([]);
    apiMocks.markCellPlayed.mockResolvedValue(projectWithPlayedCell);
    apiMocks.startBulkRegenerationJob.mockResolvedValue({
      id: "job-regen-bulk",
      project_id: "project-1",
      kind: "regenerate_cell",
      status: "running",
      total_cells: 2,
      completed_cells: 0,
      target_cell_ids: ["cell-1", "cell-2"],
      active_cell_id: "cell-1",
      error_message: null,
      created_at: "2026-06-14T00:00:00Z",
      updated_at: "2026-06-14T00:00:00Z",
    });
    apiMocks.startGenerationJob.mockResolvedValue({
      id: "job-started",
      project_id: "project-1",
      kind: "generate_missing",
      status: "running",
      total_cells: 1,
      completed_cells: 0,
      target_cell_ids: ["cell-1"],
      active_cell_id: "cell-1",
      error_message: null,
      created_at: "2026-06-14T00:00:00Z",
      updated_at: "2026-06-14T00:00:00Z",
    });
  });

  it("opens the editor after creating a project", async () => {
    const user = userEvent.setup();
    render(<AppRouter />);

    await screen.findByRole("heading", { name: "Create a New Project" });
    await user.type(screen.getByLabelText("Project name"), "demo");
    await user.click(screen.getByRole("button", { name: "Create Project" }));

    expect(await screen.findByDisplayValue("demo")).toBeInTheDocument();
    expect(apiMocks.createProject).toHaveBeenCalledWith("demo");
  });

  it("deletes a project from the home screen and refreshes the list", async () => {
    const user = userEvent.setup();
    apiMocks.listProjects
      .mockResolvedValueOnce([{ id: "project-1", name: "demo", updated_at: "2026-06-16T00:00:00Z" }])
      .mockResolvedValueOnce([]);

    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<App />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "プロジェクトを削除: demo" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "プロジェクトを削除: demo" }));

    await waitFor(() => expect(apiMocks.deleteProject).toHaveBeenCalledWith("project-1"));
    expect(await screen.findByText("No saved projects yet.")).toBeInTheDocument();
  });

  it("reloading a project route re-fetches the same project", async () => {
    window.history.pushState({}, "", "/projects/project-1");
    apiMocks.getProject.mockResolvedValue({ ...project, name: "Voice Session 01" });

    render(<AppRouter />);

    expect(await screen.findByDisplayValue("Voice Session 01")).toBeInTheDocument();
    expect(apiMocks.getProject).toHaveBeenCalledWith("project-1");
  });

  it("keeps playlist controls visible after a project route reload", async () => {
    window.history.pushState({}, "", "/projects/project-1");

    render(<AppRouter />);

    expect(await screen.findByRole("heading", { name: "書き出しリスト" })).toBeInTheDocument();
  });

  it("does not flash the home screen while a routed project is loading", async () => {
    let resolveProject!: (value: Project) => void;
    apiMocks.getProject.mockReturnValue(
      new Promise((resolve) => {
        resolveProject = resolve;
      }),
    );
    window.history.pushState({}, "", "/projects/project-1");

    render(<AppRouter />);

    expect(screen.queryByRole("heading", { name: "Create a New Project" })).not.toBeInTheDocument();
    expect(screen.getByText("Loading project…")).toBeInTheDocument();

    resolveProject(project);

    expect(await screen.findByDisplayValue("demo")).toBeInTheDocument();
  });

  it("shows the route loading shell while switching between project routes", async () => {
    let resolveSecondProject!: (value: Project) => void;
    apiMocks.getProject.mockImplementation((projectId: string) => {
      if (projectId === "project-1") return Promise.resolve(project);
      return new Promise((resolve) => {
        resolveSecondProject = resolve;
      });
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route path="/projects/:projectId" element={<RoutedAppHarness />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByDisplayValue("demo")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "next project" }));

    expect(screen.getByText("Loading project…")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("demo")).not.toBeInTheDocument();

    resolveSecondProject({ ...project, id: "project-2", name: "second project" });

    expect(await screen.findByDisplayValue("second project")).toBeInTheDocument();
  });

  it("does not re-show the previous project when switching routes and the next project load fails", async () => {
    let rejectSecondProject!: (reason?: unknown) => void;
    apiMocks.getProject.mockImplementation((projectId: string) => {
      if (projectId === "project-1") return Promise.resolve(project);
      return new Promise((_, reject) => {
        rejectSecondProject = reject;
      });
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route path="/projects/:projectId" element={<RoutedAppHarness />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByDisplayValue("demo")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "next project" }));
    expect(screen.getByText("Loading project…")).toBeInTheDocument();

    rejectSecondProject(new Error("network down"));

    expect(await screen.findByRole("button", { name: "network down" })).toBeInTheDocument();
    expect(screen.getByText("Unable to load project.")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("demo")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Create a New Project" })).not.toBeInTheDocument();
  });

  it("keeps the editor locked when a completed display job coexists with tracked running jobs", async () => {
    window.history.pushState({}, "", "/projects/project-1");
    apiMocks.getProject.mockResolvedValue(projectWithCells);
    jobHookControls.seedTrackedJobIds = ["job-existing"];
    jobHookControls.seedDisplayJob = {
      id: "job-finished",
      project_id: "project-1",
      kind: "generate_missing",
      status: "completed",
      total_cells: 1,
      completed_cells: 1,
      target_cell_ids: ["cell-1"],
      active_cell_id: null,
      error_message: null,
      created_at: "2026-06-14T00:00:00Z",
      updated_at: "2026-06-14T00:00:00Z",
    };

    render(<AppRouter />);

    const button = await screen.findByRole("button", { name: "未生成を実行" });
    await waitFor(() => expect(button).toBeDisabled());
    await waitFor(() => expect(jobHookControls.calls.at(-1)).toEqual(["job-existing"]));
  });

  it("refreshes backend generation progress immediately after starting a running job", async () => {
    const user = userEvent.setup();
    const readyProject: Project = {
      ...projectWithCells,
      generation_progress: {
        running_job_count: 0,
        running_job_kinds: [],
        has_running_jobs: false,
        active_jobs: [],
      },
    };
    const runningProject: Project = {
      ...readyProject,
      generation_progress: {
        running_job_count: 2,
        running_job_kinds: ["generate_all", "regenerate_cell"],
        has_running_jobs: true,
        active_jobs: [],
      },
    };

    window.history.pushState({}, "", "/projects/project-1");
    apiMocks.getProject
      .mockResolvedValueOnce(readyProject)
      .mockResolvedValueOnce(runningProject);

    render(<AppRouter />);

    expect(await screen.findByDisplayValue("demo")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "未生成を実行" }));

    expect(await screen.findByText("生成中 2件")).toBeInTheDocument();
  });

  it("disables generation controls while a start request is in flight", async () => {
    const user = userEvent.setup();
    let release!: (job: {
      id: string;
      project_id: string;
      kind: "generate_missing" | "generate_all" | "regenerate_cell";
      status: "running" | "completed" | "failed";
      total_cells: number;
      completed_cells: number;
      target_cell_ids: string[];
      active_cell_id: string | null;
      error_message: string | null;
      created_at: string;
      updated_at: string;
    }) => void;
    window.history.pushState({}, "", "/projects/project-1");
    apiMocks.getProject.mockResolvedValue(projectWithCells);
    apiMocks.startGenerationJob.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    render(<AppRouter />);

    await user.click(await screen.findByRole("button", { name: "未生成を実行" }));
    expect(screen.getByRole("button", { name: "全セルを実行" })).toBeDisabled();

    release({
      id: "job-started",
      project_id: "project-1",
      kind: "generate_missing",
      status: "running",
      total_cells: 1,
      completed_cells: 0,
      target_cell_ids: ["cell-1"],
      active_cell_id: "cell-1",
      error_message: null,
      created_at: "2026-06-14T00:00:00Z",
      updated_at: "2026-06-14T00:00:00Z",
    });
  });

  it("starts bulk regeneration for the currently selected cells", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/projects/project-1");
    apiMocks.getProject
      .mockResolvedValueOnce(projectWithSelectableCells)
      .mockResolvedValueOnce(projectWithSelectableCells);

    render(<AppRouter />);

    await user.click(await screen.findByRole("button", { name: "複数選択で再生成" }));
    await user.click(screen.getAllByText("未再生")[0]);
    await user.click(screen.getAllByText("未再生")[1]);
    await user.click(screen.getByRole("button", { name: "選択セルを再生成 (2)" }));

    await waitFor(() =>
      expect(apiMocks.startBulkRegenerationJob).toHaveBeenCalledWith(
        "project-1",
        ["cell-1", "cell-2"],
        null,
      ),
    );
  });

  it("records selection-mode actions in the frontend log store", async () => {
    const user = userEvent.setup();
    apiMocks.getProject
      .mockResolvedValueOnce(projectWithSelectableCells)
      .mockResolvedValueOnce(projectWithSelectableCells);

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route path="/projects/:projectId" element={<App />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "複数選択で再生成" }));
    await user.click(screen.getAllByText("未再生")[0]);
    await user.click(screen.getAllByText("未再生")[1]);
    await user.click(screen.getByRole("button", { name: "選択セルを再生成 (2)" }));

    expect(frontendLogStoreMocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      level: "info",
      event: "selection_mode_entered",
      projectId: "project-1",
    }));
    expect(frontendLogStoreMocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      level: "info",
      event: "cell_selection_toggled",
      projectId: "project-1",
      context: expect.objectContaining({
        cell_id: "cell-1",
        selected_cell_count: 1,
      }),
    }));
    expect(frontendLogStoreMocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      level: "info",
      event: "bulk_regeneration_requested",
      projectId: "project-1",
      context: expect.objectContaining({
        selected_cell_count: 2,
      }),
    }));
  });

  it("records API failures in the frontend log store", async () => {
    const user = userEvent.setup();
    apiMocks.getProject.mockResolvedValue(projectWithCells);
    apiMocks.startGenerationJob.mockRejectedValue(new Error("network down"));

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route path="/projects/:projectId" element={<App />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "未生成を実行" }));

    await waitFor(() => expect(frontendLogStoreMocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      level: "error",
      event: "api_request_failed",
      projectId: "project-1",
      message: "network down",
    })));
  });

  it("records unhandled frontend errors in the frontend log store", async () => {
    apiMocks.getProject.mockResolvedValue(projectWithCells);

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route path="/projects/:projectId" element={<App />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByDisplayValue("demo");

    window.dispatchEvent(new ErrorEvent("error", { message: "boom" }));

    await waitFor(() => expect(frontendLogStoreMocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      level: "error",
      event: "unhandled_frontend_error",
      projectId: "project-1",
      message: "boom",
    })));
  });

  it("renders fetched project logs for the active project", async () => {
    apiMocks.getProject.mockResolvedValue(projectWithCells);
    apiMocks.getProjectLogs.mockResolvedValue([
      {
        id: "log-1",
        timestamp: "2026-06-16T00:00:00Z",
        level: "warning",
        source: "backend",
        event: "job_rejected",
        project_id: "project-1",
        job_id: null,
        message: "One or more selected cells are already regenerating",
        context: {},
      },
    ]);

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route path="/projects/:projectId" element={<App />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("job_rejected")).toBeInTheDocument();
    expect(screen.getByText("backend")).toBeInTheDocument();
  });

  it("posts playback events when audio playback starts", async () => {
    window.history.pushState({}, "", "/projects/project-1");
    apiMocks.getProject.mockResolvedValue(projectWithUnplayedCell);
    apiMocks.markCellPlayed.mockResolvedValue(projectWithPlayedCell);

    render(<AppRouter />);

    const audio = await screen.findByLabelText("音声: toru / hello");
    audio.dispatchEvent(new Event("play"));

    await waitFor(() => expect(apiMocks.markCellPlayed).toHaveBeenCalledWith("project-1", "cell-1"));
  });

  it("returns to the project list when a routed project is missing", async () => {
    window.history.pushState({}, "", "/projects/missing");
    apiMocks.getProject.mockRejectedValue(new ApiError(404, "Project not found"));

    render(<AppRouter />);

    expect(await screen.findByRole("heading", { name: "Create a New Project" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });
});
