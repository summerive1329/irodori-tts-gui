import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProjectHome } from "./ProjectHome";

describe("ProjectHome", () => {
  it("shows the home screen copy in English", () => {
    render(<ProjectHome projects={[]} busy={false} onCreate={() => undefined} onOpen={() => undefined} />);

    expect(screen.getByRole("heading", { name: "Create a New Project" })).toBeInTheDocument();
    expect(screen.getByText("Compare voices and polish each line.")).toBeInTheDocument();
  });

  it("creates a project with the entered name", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<ProjectHome projects={[]} busy={false} onCreate={onCreate} onOpen={() => undefined} />);

    await user.type(screen.getByLabelText("Project name"), "  demo  ");
    await user.click(screen.getByRole("button", { name: "Create Project" }));

    expect(onCreate).toHaveBeenCalledWith("demo");
  });
});

