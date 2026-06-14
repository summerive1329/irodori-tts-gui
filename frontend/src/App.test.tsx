import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "./types";

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

    await screen.findByRole("heading", { name: /start a project/i });
    await user.type(screen.getByLabelText("Project name"), "demo");
    await user.click(screen.getByRole("button", { name: "Create project" }));

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
});
