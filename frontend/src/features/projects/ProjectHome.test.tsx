import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProjectHome } from "./ProjectHome";

describe("ProjectHome", () => {
  it("creates a project with the entered name", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<ProjectHome projects={[]} busy={false} onCreate={onCreate} onOpen={() => undefined} />);

    await user.type(screen.getByLabelText("プロジェクト名"), "  demo  ");
    await user.click(screen.getByRole("button", { name: "プロジェクトを作成" }));

    expect(onCreate).toHaveBeenCalledWith("demo");
  });
});

