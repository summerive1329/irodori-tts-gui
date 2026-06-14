import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExportPlaylist } from "./ExportPlaylist";

describe("ExportPlaylist", () => {
  it("shows duplicate cell entries as separate playlist items", () => {
    render(
      <ExportPlaylist
        items={[
          {
            id: "item-a",
            cell_id: "cell-1",
            line_id: "line-1",
            reference_id: "ref-1",
            label: "lize / line 1",
            created_at: "2026-06-14T00:00:00Z",
          },
          {
            id: "item-b",
            cell_id: "cell-1",
            line_id: "line-1",
            reference_id: "ref-1",
            label: "lize / line 1",
            created_at: "2026-06-14T00:00:01Z",
          },
        ]}
        durationByCellId={{ "cell-1": 1 }}
        busy={false}
        exportUrl={null}
        onRemove={vi.fn()}
        onReorder={vi.fn()}
        onExport={vi.fn()}
        onExportText={vi.fn()}
      />,
    );

    expect(screen.getAllByText("lize / line 1")).toHaveLength(2);
    expect(screen.getByText(/合計 2\.0 秒/)).toBeInTheDocument();
  });

  it("reorders playlist items by dragging to a distant slot", () => {
    const onReorder = vi.fn();
    render(
      <ExportPlaylist
        items={[
          { id: "a", cell_id: "cell-a", line_id: "line-a", reference_id: "ref", label: "first", created_at: "2026-06-14T00:00:00Z" },
          { id: "b", cell_id: "cell-b", line_id: "line-b", reference_id: "ref", label: "second", created_at: "2026-06-14T00:00:01Z" },
        ]}
        durationByCellId={{ "cell-a": 1, "cell-b": 2 }}
        busy={false}
        exportUrl={null}
        onRemove={vi.fn()}
        onReorder={onReorder}
        onExport={vi.fn()}
        onExportText={vi.fn()}
      />,
    );

    fireEvent.dragStart(screen.getByRole("button", { name: "並べ替え: first" }));
    fireEvent.dragOver(screen.getByLabelText("書き出し位置 2"));
    fireEvent.drop(screen.getByLabelText("書き出し位置 2"));

    expect(onReorder).toHaveBeenCalledWith(["b", "a"]);
  });
});
