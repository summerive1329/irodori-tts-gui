import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PendingDeleteToast } from "./PendingDeleteToast";

describe("PendingDeleteToast", () => {
  it("renders a shrinking undo ring while deletion is pending", () => {
    vi.useFakeTimers();
    const deadlineAt = Date.now() + 5000;

    render(
      <PendingDeleteToast
        pending={{
          line: { id: "line-1", text: "hello", order_index: 0 },
          expiresAt: deadlineAt,
        }}
        onUndo={vi.fn()}
      />,
    );

    expect(screen.getByTestId("pending-delete-ring")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.getByTestId("pending-delete-ring")).toHaveAttribute("data-progress", "0.5");
    vi.useRealTimers();
  });
});
