import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CellItem, LineItem, ReferenceItem } from "../../types";
import { LineMatrix } from "./LineMatrix";

const lines: LineItem[] = [{ id: "line-1", text: "hello", order_index: 0 }];
const references: ReferenceItem[] = [
  { id: "ref-1", label: "toru", source_filename: "a.wav", copied_path: "references/a.wav", duration_sec: 1 },
  { id: "ref-2", label: "lize", source_filename: "b.wav", copied_path: "references/b.wav", duration_sec: 1 },
];
const cells: CellItem[] = references.map((reference, index) => ({
  id: `cell-${index + 1}`,
  line_id: "line-1",
  reference_id: reference.id,
  status: "ready",
  display_status: "unplayed",
  error_message: null,
  current_result: {
    audio_path: `cells/${index}.wav`,
    sample_rate: 24000,
    generated_at: "2026-06-14T00:00:00Z",
    seed: index,
    duration_sec: 1,
  },
}));

function matrixProps() {
  return {
    projectId: "project-1",
    lines,
    references,
    cells,
    busy: false,
    autoPlay: false,
    selectedCellId: null,
    onSelectCell: vi.fn(),
    onRegenerate: vi.fn(),
    onMarkCellPlayed: vi.fn(),
    onAppendToPlaylist: vi.fn(),
    onAppendReferenceColumn: vi.fn(),
    onEditLine: vi.fn(),
    onInsertLine: vi.fn(),
    onReorder: vi.fn(),
  };
}

describe("LineMatrix", () => {
  it("renders a corner cell before the first reference header", () => {
    render(<LineMatrix {...matrixProps()} />);

    const headers = screen.getAllByTestId("matrix-header-cell");

    expect(headers[0]).toHaveTextContent("DIALOGUE");
    expect(headers[1]).toHaveTextContent("toru");
  });

  it("regenerates only the chosen line and reference cell", async () => {
    const user = userEvent.setup();
    const props = matrixProps();
    render(<LineMatrix {...props} />);

    await user.click(screen.getByRole("button", { name: "再生成: toru / hello" }));

    expect(props.onRegenerate).toHaveBeenCalledOnce();
    expect(props.onRegenerate).toHaveBeenCalledWith("cell-1");
  });

  it("adds one exact cell to the export playlist", async () => {
    const user = userEvent.setup();
    const props = matrixProps();
    render(<LineMatrix {...props} />);

    await user.click(screen.getByRole("button", { name: "リストに追加: lize / hello" }));

    expect(props.onAppendToPlaylist).toHaveBeenCalledWith("cell-2");
  });

  it("adds a whole reference column from the header", async () => {
    const user = userEvent.setup();
    const props = matrixProps();
    render(<LineMatrix {...props} />);

    await user.click(screen.getByRole("button", { name: "toruを上から追加" }));

    expect(props.onAppendReferenceColumn).toHaveBeenCalledWith("ref-1");
  });

  it("keeps an older take playable while the cell is generating", () => {
    const props = matrixProps();
    props.cells = [{ ...cells[0], status: "generating", display_status: "generating" }, cells[1]];

    const { container } = render(<LineMatrix {...props} />);

    expect(screen.getByText("生成中")).toBeInTheDocument();
    expect(container.querySelector('audio[src*="cells/0.wav"]')).toBeInTheDocument();
  });

  it("renders playback controls with the dedicated larger-audio class", () => {
    render(<LineMatrix {...matrixProps()} />);

    expect(screen.getByLabelText("音声: toru / hello")).toHaveClass("result-audio");
  });

  it("renders queued cells separately from the actively generating cell", () => {
    const props = matrixProps();
    props.cells = [
      { ...cells[0], status: "generating", display_status: "generating" },
      { ...cells[1], status: "queued", display_status: "queued" },
    ];
    render(<LineMatrix {...props} />);

    expect(screen.getByText("生成中")).toBeInTheDocument();
    expect(screen.getByText("待機中")).toBeInTheDocument();
  });

  it("reports playback and follows backend display status after rerender", () => {
    const props = matrixProps();
    const { rerender } = render(<LineMatrix {...props} />);

    const audio = screen.getByLabelText("音声: toru / hello");
    fireEvent.play(audio);

    expect(props.onMarkCellPlayed).toHaveBeenCalledWith("cell-1");

    rerender(
      <LineMatrix
        {...props}
        cells={[{ ...cells[0], display_status: "played" }, cells[1]]}
      />,
    );
    expect(screen.getByLabelText("音声: toru / hello").closest("article")).toHaveClass("is-played");

    rerender(
      <LineMatrix
        {...props}
        cells={[{ ...cells[0], display_status: "unplayed" }, cells[1]]}
      />,
    );
    expect(screen.getByLabelText("音声: toru / hello").closest("article")).not.toHaveClass("is-played");
  });

  it("auto-plays only the next cell in the same reference", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const twoLines: LineItem[] = [
      { id: "line-1", text: "one", order_index: 0 },
      { id: "line-2", text: "two", order_index: 1 },
    ];
    const sameReferenceCells: CellItem[] = twoLines.map((line, index) => ({
      ...cells[0],
      id: `same-ref-${index}`,
      line_id: line.id,
      current_result: { ...cells[0].current_result!, audio_path: `cells/same-${index}.wav` },
    }));
    const props = matrixProps();
    props.lines = twoLines;
    props.references = [references[0]];
    props.cells = sameReferenceCells;
    props.autoPlay = true;
    render(<LineMatrix {...props} />);

    fireEvent.ended(screen.getByLabelText("音声: toru / one"));

    expect(play).toHaveBeenCalledOnce();
  });

  it("drags a line to a distant insertion slot", () => {
    const props = matrixProps();
    props.lines = [
      { id: "line-1", text: "one", order_index: 0 },
      { id: "line-2", text: "two", order_index: 1 },
      { id: "line-3", text: "three", order_index: 2 },
    ];
    props.references = [];
    props.cells = [];
    render(<LineMatrix {...props} />);

    fireEvent.dragStart(screen.getByRole("button", { name: "並べ替え: one" }));
    fireEvent.dragOver(screen.getByLabelText("3番目へ移動"));
    fireEvent.drop(screen.getByLabelText("3番目へ移動"));

    expect(props.onReorder).toHaveBeenCalledWith(["line-2", "line-3", "line-1"]);
  });

  it("supports dragging the second row to the top slot", () => {
    const props = matrixProps();
    props.lines = [
      { id: "line-1", text: "one", order_index: 0 },
      { id: "line-2", text: "two", order_index: 1 },
      { id: "line-3", text: "three", order_index: 2 },
    ];
    props.references = [];
    props.cells = [];
    render(<LineMatrix {...props} />);

    fireEvent.dragStart(screen.getByRole("button", { name: "並べ替え: two" }));
    fireEvent.dragEnter(screen.getByLabelText("先頭へ移動"));
    fireEvent.drop(screen.getByLabelText("先頭へ移動"));

    expect(props.onReorder).toHaveBeenCalledWith(["line-2", "line-1", "line-3"]);
  });

  it("keeps playback available but disables project mutations while busy", () => {
    const props = matrixProps();
    props.busy = true;
    render(<LineMatrix {...props} />);

    expect(screen.getByLabelText("音声: toru / hello")).toBeEnabled();
    expect(screen.getByRole("button", { name: "再生成: toru / hello" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "リストに追加: toru / hello" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "toruを上から追加" })).toBeDisabled();
  });

  it("keeps regenerate available while the project is busy", async () => {
    const user = userEvent.setup();
    const props = matrixProps();
    props.busy = true;
    render(<LineMatrix {...props} allowRegenerateWhileBusy />);

    await user.click(screen.getByRole("button", { name: "再生成: toru / hello" }));

    expect(props.onRegenerate).toHaveBeenCalledWith("cell-1");
  });

  it("renders backend display status in the top-left slot and removes the lower playback label", () => {
    const props = matrixProps();
    props.cells = [
      { ...cells[0], status: "idle", display_status: "not_generated", current_result: null },
      { ...cells[1], display_status: "unplayed" },
    ];
    render(<LineMatrix {...props} />);

    expect(screen.getByText("未生成")).toBeInTheDocument();
    expect(screen.getAllByText("未再生")).toHaveLength(1);
    expect(screen.queryByText("再生済み")).not.toBeInTheDocument();
  });

  it("keeps the highlighted background only for unplayed cells", () => {
    const props = matrixProps();
    props.cells = [
      { ...cells[0], status: "idle", display_status: "not_generated", current_result: null },
      { ...cells[1], display_status: "unplayed" },
    ];
    render(<LineMatrix {...props} />);

    expect(screen.getByText("未生成").closest("article")).not.toHaveClass("is-unplayed");
    expect(screen.getByText("未再生").closest("article")).toHaveClass("is-unplayed");
  });
});
