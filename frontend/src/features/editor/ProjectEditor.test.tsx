import type { ComponentProps } from "react";
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

function props(): ComponentProps<typeof ProjectEditor> {
  return {
    project,
    busy: false,
    job: null,
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
    onInsertLine: vi.fn(),
    onDeleteLine: vi.fn(),
    onReorder: vi.fn(),
    onGenerate: vi.fn(),
    onRegenerate: vi.fn(),
    onAppendToPlaylist: vi.fn(),
    onAppendReferenceColumn: vi.fn(),
    onRemovePlaylistItem: vi.fn(),
    onReorderPlaylist: vi.fn(),
    onExport: vi.fn(),
    onExportText: vi.fn(),
    onSaveSettings: vi.fn(),
  };
}

describe("ProjectEditor", () => {
  it("appends manually entered non-empty lines", async () => {
    const user = userEvent.setup();
    const editorProps = props();
    render(<ProjectEditor {...editorProps} />);

    await user.type(screen.getByLabelText("まとめて追加するセリフ"), "one\n\ntwo");
    await user.click(screen.getByRole("button", { name: "末尾に追加" }));

    expect(editorProps.onAppendLines).toHaveBeenCalledWith(["one", "two"]);
  });

  it("starts missing-cell generation", async () => {
    const user = userEvent.setup();
    const editorProps = props();
    editorProps.project = {
      ...project,
      lines: [{ id: "line-1", text: "hello", order_index: 0 }],
      references: [{ id: "ref-1", label: "toru", source_filename: "toru.wav", copied_path: "references/toru.wav", duration_sec: 1 }],
      cells: [{ id: "cell-1", line_id: "line-1", reference_id: "ref-1", status: "idle", error_message: null, current_result: null }],
      export_playlist: [],
    };
    render(<ProjectEditor {...editorProps} />);

    await user.click(screen.getByRole("button", { name: "未生成を実行" }));

    expect(editorProps.onGenerate).toHaveBeenCalledWith(true);
  });

  it("starts full generation from the console", async () => {
    const user = userEvent.setup();
    const editorProps = props();
    editorProps.project = {
      ...project,
      lines: [{ id: "line-1", text: "hello", order_index: 0 }],
      references: [{ id: "ref-1", label: "toru", source_filename: "toru.wav", copied_path: "references/toru.wav", duration_sec: 1 }],
      cells: [{ id: "cell-1", line_id: "line-1", reference_id: "ref-1", status: "idle", error_message: null, current_result: null }],
      export_playlist: [],
    };
    render(<ProjectEditor {...editorProps} />);

    await user.click(screen.getByRole("button", { name: "全セルを実行" }));

    expect(editorProps.onGenerate).toHaveBeenCalledWith(false);
  });

  it("keeps other regenerate buttons disabled during a running regeneration job", () => {
    const editorProps = props();
    editorProps.busy = true;
    editorProps.job = {
      id: "job-1",
      project_id: "project-1",
      kind: "regenerate_cell",
      status: "running",
      total_cells: 1,
      completed_cells: 0,
      target_cell_ids: ["cell-1"],
      active_cell_id: "cell-1",
      error_message: null,
      created_at: "2026-06-14T00:00:00Z",
      updated_at: "2026-06-14T00:00:00Z",
    };
    editorProps.project = {
      ...project,
      lines: [{ id: "line-1", text: "hello", order_index: 0 }],
      references: [
        { id: "ref-1", label: "toru", source_filename: "toru.wav", copied_path: "references/toru.wav", duration_sec: 1 },
        { id: "ref-2", label: "lize", source_filename: "lize.wav", copied_path: "references/lize.wav", duration_sec: 1 },
      ],
      cells: [
        { id: "cell-1", line_id: "line-1", reference_id: "ref-1", status: "ready", error_message: null, current_result: null },
        { id: "cell-2", line_id: "line-1", reference_id: "ref-2", status: "ready", error_message: null, current_result: null },
      ],
      export_playlist: [],
    };
    render(<ProjectEditor {...editorProps} />);

    expect(screen.getByRole("button", { name: "再生成: toru / hello" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "再生成: lize / hello" })).toBeDisabled();
  });

  it("inserts a line at the requested position", async () => {
    const user = userEvent.setup();
    const editorProps = props();
    editorProps.project = {
      ...project,
      lines: [{ id: "line-1", text: "hello", order_index: 0 }],
    };
    render(<ProjectEditor {...editorProps} />);

    await user.click(screen.getByRole("button", { name: /1行目の後に追加/ }));
    await user.type(screen.getByLabelText("追加するセリフ"), "new line");
    await user.click(screen.getByRole("button", { name: "挿入" }));

    expect(editorProps.onInsertLine).toHaveBeenCalledWith(1, "new line");
  });
});
