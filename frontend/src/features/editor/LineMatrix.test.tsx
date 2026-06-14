import { render, screen } from "@testing-library/react";
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
  error_message: null,
  current_result: {
    audio_path: `cells/${index}.wav`,
    sample_rate: 24000,
    generated_at: "2026-06-14T00:00:00Z",
    seed: index,
    duration_sec: 1,
  },
}));

describe("LineMatrix", () => {
  it("regenerates only the chosen line and reference cell", async () => {
    const user = userEvent.setup();
    const onRegenerate = vi.fn();
    render(
      <LineMatrix
        projectId="project-1"
        lines={lines}
        references={references}
        cells={cells}
        selectedCellId={null}
        onSelectCell={() => undefined}
        onRegenerate={onRegenerate}
        onAppendToPlaylist={() => undefined}
        onAppendReferenceColumn={() => undefined}
        onEditLine={() => undefined}
        onReorder={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Regenerate toru / hello" }));

    expect(onRegenerate).toHaveBeenCalledOnce();
    expect(onRegenerate).toHaveBeenCalledWith("cell-1");
  });

  it("adds one exact cell to the export playlist", async () => {
    const user = userEvent.setup();
    const onAppendToPlaylist = vi.fn();
    render(
      <LineMatrix
        projectId="project-1"
        lines={lines}
        references={references}
        cells={cells}
        selectedCellId={null}
        onSelectCell={() => undefined}
        onRegenerate={() => undefined}
        onAppendToPlaylist={onAppendToPlaylist}
        onAppendReferenceColumn={() => undefined}
        onEditLine={() => undefined}
        onReorder={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "リストに追加: lize / hello" }));

    expect(onAppendToPlaylist).toHaveBeenCalledWith("cell-2");
  });

  it("adds a whole reference column from the header", async () => {
    const user = userEvent.setup();
    const onAppendReferenceColumn = vi.fn();
    render(
      <LineMatrix
        projectId="project-1"
        lines={lines}
        references={references}
        cells={cells}
        selectedCellId={null}
        onSelectCell={() => undefined}
        onRegenerate={() => undefined}
        onAppendToPlaylist={() => undefined}
        onAppendReferenceColumn={onAppendReferenceColumn}
        onEditLine={() => undefined}
        onReorder={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "toruを上から追加" }));

    expect(onAppendReferenceColumn).toHaveBeenCalledWith("ref-1");
  });
});
