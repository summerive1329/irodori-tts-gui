import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "./types";
import { ApiError } from "./api/client";

const apiMocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  getProject: vi.fn(),
  listProjects: vi.fn(),
}));

vi.mock("./api/client", async () => {
  const actual = await vi.importActual<typeof import("./api/client")>("./api/client");
  return { ...actual, ...apiMocks };
});

import { AppRouter } from "./router";

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

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/");
    apiMocks.listProjects.mockResolvedValue([]);
    apiMocks.createProject.mockResolvedValue(project);
    apiMocks.getProject.mockResolvedValue(project);
  });

  it("opens the editor after creating a project", async () => {
    const user = userEvent.setup();
    render(<AppRouter />);

    await screen.findByRole("heading", { name: "新しいプロジェクト" });
    await user.type(screen.getByLabelText("プロジェクト名"), "demo");
    await user.click(screen.getByRole("button", { name: "プロジェクトを作成" }));

    expect(await screen.findByDisplayValue("demo")).toBeInTheDocument();
    expect(apiMocks.createProject).toHaveBeenCalledWith("demo");
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

    expect(screen.queryByRole("heading", { name: "新しいプロジェクト" })).not.toBeInTheDocument();
    expect(screen.getByText("Loading project…")).toBeInTheDocument();

    resolveProject(project);

    expect(await screen.findByDisplayValue("demo")).toBeInTheDocument();
  });

  it("returns to the project list when a routed project is missing", async () => {
    window.history.pushState({}, "", "/projects/missing");
    apiMocks.getProject.mockRejectedValue(new ApiError(404, "Project not found"));

    render(<AppRouter />);

    expect(await screen.findByRole("heading", { name: "新しいプロジェクト" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });
});
