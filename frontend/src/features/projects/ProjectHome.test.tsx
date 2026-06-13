import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProjectHome } from "./ProjectHome";

describe("ProjectHome", () => {
  it("creates a project with the entered name", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<ProjectHome projects={[]} busy={false} onCreate={onCreate} onOpen={() => undefined} />);

    await user.type(screen.getByLabelText("Project name"), "  demo  ");
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(onCreate).toHaveBeenCalledWith("demo");
  });
});

