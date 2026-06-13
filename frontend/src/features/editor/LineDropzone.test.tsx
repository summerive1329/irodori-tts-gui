import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LineDropzone } from "./LineDropzone";

describe("LineDropzone", () => {
  it("forwards every dropped text file", () => {
    const onFilesSelected = vi.fn();
    const files = [
      new File(["one\ntwo"], "lines.txt", { type: "text/plain" }),
      new File(["three"], "more.md", { type: "text/markdown" }),
    ];
    render(<LineDropzone busy={false} onFilesSelected={onFilesSelected} />);

    fireEvent.drop(screen.getByTestId("line-dropzone"), {
      dataTransfer: { files },
    });

    expect(onFilesSelected).toHaveBeenCalledWith(files);
  });
});

