import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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

function props(): ComponentProps<typeof ProjectEditor> {
  return {
    project,
    busy: false,
    job: null,
    selectionMode: false,
    selectedCellId: null,
    selectedCellIds: [],
    projectLogs: [],
    exportUrl: null,
    onBack: vi.fn(),
    onDeleteProject: vi.fn(),
    onSelectCell: vi.fn(),
    onToggleCellSelection: vi.fn(),
    onEnterSelectionMode: vi.fn(),
    onCancelSelectionMode: vi.fn(),
    onImportFiles: vi.fn(),
    onAppendLines: vi.fn(),
    onAddReference: vi.fn(),
    onDeleteReference: vi.fn(),
    onEditLine: vi.fn(),
    onInsertLine: vi.fn(),
    onDeleteLine: vi.fn(),
    onClearLines: vi.fn(),
    onReorder: vi.fn(),
    onGenerate: vi.fn(),
    onRegenerateSelected: vi.fn(),
    onRegenerate: vi.fn(),
    onAppendToPlaylist: vi.fn(),
    onAppendReferenceColumn: vi.fn(),
    onRemovePlaylistItem: vi.fn(),
    onReorderPlaylist: vi.fn(),
    onClearPlaylist: vi.fn(),
    onExport: vi.fn(),
    onExportText: vi.fn(),
    onSaveSettings: vi.fn(),
  };
}

function projectWithLines(...texts: string[]): Project {
  return {
    ...project,
    lines: texts.map((text, index) => ({
      id: `line-${index + 1}`,
      text,
      order_index: index,
    })),
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
      cells: [{ id: "cell-1", line_id: "line-1", reference_id: "ref-1", status: "idle", display_status: "not_generated", error_message: null, current_result: null }],
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
      cells: [{ id: "cell-1", line_id: "line-1", reference_id: "ref-1", status: "idle", display_status: "not_generated", error_message: null, current_result: null }],
      export_playlist: [],
    };
    render(<ProjectEditor {...editorProps} />);

    await user.click(screen.getByRole("button", { name: "全セルを実行" }));

    expect(editorProps.onGenerate).toHaveBeenCalledWith(false);
  });

  it("starts bulk regeneration for the selected cells", async () => {
    const user = userEvent.setup();
    const editorProps = props();
    editorProps.selectionMode = true;
    editorProps.selectedCellIds = ["cell-1", "cell-2"];
    editorProps.project = {
      ...project,
      lines: [{ id: "line-1", text: "hello", order_index: 0 }],
      references: [
        { id: "ref-1", label: "toru", source_filename: "toru.wav", copied_path: "references/toru.wav", duration_sec: 1 },
        { id: "ref-2", label: "lize", source_filename: "lize.wav", copied_path: "references/lize.wav", duration_sec: 1 },
      ],
      cells: [
        { id: "cell-1", line_id: "line-1", reference_id: "ref-1", status: "ready", display_status: "unplayed", error_message: null, current_result: null },
        { id: "cell-2", line_id: "line-1", reference_id: "ref-2", status: "ready", display_status: "unplayed", error_message: null, current_result: null },
      ],
      export_playlist: [],
    };
    render(<ProjectEditor {...editorProps} />);

    await user.click(screen.getByRole("button", { name: "選択セルを再生成 (2)" }));

    expect(editorProps.onRegenerateSelected).toHaveBeenCalledWith(["cell-1", "cell-2"], null);
  });

  it("enters selection mode before allowing bulk regeneration", async () => {
    const user = userEvent.setup();
    const editorProps = props();
    editorProps.project = {
      ...project,
      lines: [{ id: "line-1", text: "hello", order_index: 0 }],
      references: [{ id: "ref-1", label: "toru", source_filename: "toru.wav", copied_path: "references/toru.wav", duration_sec: 1 }],
      cells: [{ id: "cell-1", line_id: "line-1", reference_id: "ref-1", status: "ready", display_status: "unplayed", error_message: null, current_result: null }],
      export_playlist: [],
    };
    render(<ProjectEditor {...editorProps} />);

    await user.click(screen.getByRole("button", { name: "複数選択で再生成" }));

    expect(editorProps.onEnterSelectionMode).toHaveBeenCalledOnce();
  });

  it("keeps regenerate available during a running regeneration job", () => {
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
      generation_progress: {
        running_job_count: 1,
        running_job_kinds: ["regenerate_cell"],
        has_running_jobs: true,
        active_jobs: [
          {
            job_id: "job-1",
            kind: "regenerate_cell",
            cell_id: "cell-1",
            line_index: 1,
            reference_label: "toru",
            status: "generating",
          },
        ],
      },
      lines: [{ id: "line-1", text: "hello", order_index: 0 }],
      references: [
        { id: "ref-1", label: "toru", source_filename: "toru.wav", copied_path: "references/toru.wav", duration_sec: 1 },
        { id: "ref-2", label: "lize", source_filename: "lize.wav", copied_path: "references/lize.wav", duration_sec: 1 },
      ],
      cells: [
        { id: "cell-1", line_id: "line-1", reference_id: "ref-1", status: "idle", display_status: "not_generated", error_message: null, current_result: null },
        { id: "cell-2", line_id: "line-1", reference_id: "ref-2", status: "idle", display_status: "not_generated", error_message: null, current_result: null },
      ],
      export_playlist: [],
    };
    render(<ProjectEditor {...editorProps} />);

    expect(screen.getByRole("button", { name: "再生成: toru / hello" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "再生成: lize / hello" })).toBeEnabled();
  });

  it("shows active job details alongside the running job count", () => {
    const editorProps = props();
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
      generation_progress: {
        running_job_count: 2,
        running_job_kinds: ["generate_all", "regenerate_cell"],
        has_running_jobs: true,
        active_jobs: [
          {
            job_id: "job-1",
            kind: "generate_all",
            cell_id: "cell-1",
            line_index: 1,
            reference_label: "toru",
            status: "generating",
          },
          {
            job_id: "job-2",
            kind: "regenerate_cell",
            cell_id: "cell-2",
            line_index: 3,
            reference_label: "lize",
            status: "queued",
          },
        ],
      },
      lines: [{ id: "line-1", text: "hello", order_index: 0 }],
      references: [{ id: "ref-1", label: "toru", source_filename: "toru.wav", copied_path: "references/toru.wav", duration_sec: 1 }],
      cells: [{ id: "cell-1", line_id: "line-1", reference_id: "ref-1", status: "ready", display_status: "unplayed", error_message: null, current_result: null }],
      export_playlist: [],
    };

    render(<ProjectEditor {...editorProps} />);

    expect(screen.getByText("生成中 2件")).toBeInTheDocument();
    expect(screen.getByText("実行中: 1行目 / toru")).toBeInTheDocument();
    expect(screen.getByText("待機中: 3行目 / lize")).toBeInTheDocument();
  });

  it("renders recent project logs", () => {
    const editorProps = props();
    editorProps.projectLogs = [
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
    ];

    render(<ProjectEditor {...editorProps} />);

    expect(screen.getByText("job_rejected")).toBeInTheDocument();
    expect(screen.getByText("One or more selected cells are already regenerating")).toBeInTheDocument();
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

  it("lets the user undo a line deletion before the API call is sent", async () => {
    vi.useFakeTimers();
    const editorProps = props();
    editorProps.project = projectWithLines("hello", "world");
    render(<ProjectEditor {...editorProps} />);

    fireEvent.click(screen.getByRole("button", { name: "削除: hello" }));
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeInTheDocument();
    expect(editorProps.onDeleteLine).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    vi.runAllTimers();

    expect(editorProps.onDeleteLine).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("persists the dialogue column width after resize", () => {
    window.localStorage.clear();
    const editorProps = props();
    editorProps.project = projectWithLines("hello", "world");
    render(<ProjectEditor {...editorProps} />);

    fireEvent.pointerDown(screen.getByRole("separator", { name: "セリフ列の幅を変更" }), { clientX: 440 });
    fireEvent.pointerMove(window, { clientX: 520 });
    fireEvent.pointerUp(window);

    expect(window.localStorage.getItem("irodori.dialogueColumnWidth")).toBe("520");
  });

  it("moves project deletion behind the project menu", async () => {
    const user = userEvent.setup();
    const editorProps = props();
    render(<ProjectEditor {...editorProps} />);

    expect(screen.queryByRole("button", { name: "プロジェクト削除" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "プロジェクトメニュー" }));
    await user.click(screen.getByRole("button", { name: "プロジェクトを削除" }));

    expect(editorProps.onDeleteProject).toHaveBeenCalled();
  });

  it("clears all lines after confirmation", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const editorProps = props();
    editorProps.project = projectWithLines("hello", "world");
    render(<ProjectEditor {...editorProps} />);

    await user.click(screen.getByRole("button", { name: "セリフを全消し" }));

    expect(editorProps.onClearLines).toHaveBeenCalledOnce();
  });
});
