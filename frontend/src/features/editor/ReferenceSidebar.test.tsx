import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ReferenceSidebar } from "./ReferenceSidebar";

describe("ReferenceSidebar", () => {
  it("uploads multiple audio files using each file stem as its label", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const files = [
      new File(["a"], "toru.wav", { type: "audio/wav" }),
      new File(["b"], "lize.mp3", { type: "audio/mpeg" }),
    ];
    render(<ReferenceSidebar projectId="project-1" references={[]} busy={false} onAdd={onAdd} onDelete={() => undefined} />);

    await user.upload(screen.getByLabelText("Add reference audio"), files);

    expect(onAdd).toHaveBeenNthCalledWith(1, "toru", files[0]);
    expect(onAdd).toHaveBeenNthCalledWith(2, "lize", files[1]);
  });
});

