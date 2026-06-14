import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Project } from "../../types";
import { ProjectEditor } from "./ProjectEditor";

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

function props() {
  return {
    project,
    busy: false,
    selectedCellId: null,
    exportUrl: null,
    onBack: vi.fn(),
    onDeleteProject: vi.fn(),
    onSelectCell: vi.fn(),
    onImportFiles: vi.fn(),
    onAppendLines: vi.fn(),
    onAddReference: vi.fn(),
    onDeleteReference: vi.fn(),
    onEditLine: vi.fn(),
    onDeleteLine: vi.fn(),
    onReorder: vi.fn(),
    onGenerate: vi.fn(),
    onRegenerate: vi.fn(),
    onSelectForExport: vi.fn(),
    onExport: vi.fn(),
    onSaveSettings: vi.fn(),
  };
}

describe("ProjectEditor", () => {
  it("appends manually entered non-empty lines", async () => {
    const user = userEvent.setup();
    const editorProps = props();
    render(<ProjectEditor {...editorProps} />);

    await user.type(screen.getByLabelText("Manual dialogue"), "one\n\ntwo");
    await user.click(screen.getByRole("button", { name: "Append lines" }));

    expect(editorProps.onAppendLines).toHaveBeenCalledWith(["one", "two"]);
  });

  it("starts missing-cell generation", async () => {
    const user = userEvent.setup();
    const editorProps = props();
    editorProps.project = {
      ...project,
      lines: [{ id: "line-1", text: "hello", order_index: 0 }],
      references: [{ id: "ref-1", label: "toru", source_filename: "toru.wav", copied_path: "references/toru.wav", duration_sec: 1 }],
      cells: [{ id: "cell-1", line_id: "line-1", reference_id: "ref-1", status: "idle", error_message: null, current_result: null, selected_for_export: false }],
      export_playlist: [],
    };
    render(<ProjectEditor {...editorProps} />);

    await user.click(screen.getByRole("button", { name: "Generate missing" }));

    expect(editorProps.onGenerate).toHaveBeenCalledWith(true);
  });
});
