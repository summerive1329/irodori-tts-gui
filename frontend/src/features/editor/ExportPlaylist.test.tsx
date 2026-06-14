import { render, screen } from "@testing-library/react";
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
        busy={false}
        exportUrl={null}
        onRemove={vi.fn()}
        onReorder={vi.fn()}
        onExport={vi.fn()}
        onExportText={vi.fn()}
      />,
    );

    expect(screen.getAllByText("lize / line 1")).toHaveLength(2);
  });
});
