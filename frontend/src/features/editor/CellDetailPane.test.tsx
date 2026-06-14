import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CellItem, LineItem, ReferenceItem } from "../../types";
import { CellDetailPane } from "./CellDetailPane";

describe("CellDetailPane", () => {
  it("regenerates the selected cell with an optional seed", async () => {
    const user = userEvent.setup();
    const onRegenerate = vi.fn();
    const cell: CellItem = {
      id: "cell-1",
      line_id: "line-1",
      reference_id: "ref-1",
      status: "ready",
      error_message: null,
      current_result: null,
    };
    const line: LineItem = { id: "line-1", text: "hello", order_index: 0 };
    const reference: ReferenceItem = { id: "ref-1", label: "toru", source_filename: "toru.wav", copied_path: "references/toru.wav", duration_sec: 1 };
    render(
      <CellDetailPane
        projectId="project-1"
        cell={cell}
        line={line}
        reference={reference}
        busy={false}
        onRegenerate={onRegenerate}
      />,
    );

    await user.type(screen.getByLabelText("シード"), "42");
    await user.click(screen.getByRole("button", { name: "選択セルを再生成" }));

    expect(onRegenerate).toHaveBeenCalledWith("cell-1", 42);
  });
});
