import { useRef, useState } from "react";

type Props = {
  busy: boolean;
  onFilesSelected: (files: File[]) => void;
};

const acceptedExtensions = ".txt,.md,.csv,.tsv";

export function LineDropzone({ busy, onFilesSelected }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function submit(files: FileList | File[]) {
    const selected = Array.from(files);
    if (selected.length > 0) {
      onFilesSelected(selected);
    }
  }

  return (
    <div
      className={`line-dropzone${dragging ? " is-dragging" : ""}`}
      data-testid="line-dropzone"
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!busy) submit(event.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept={acceptedExtensions}
        multiple
        disabled={busy}
        aria-label="Import dialogue files"
        onChange={(event) => {
          if (event.target.files) submit(event.target.files);
          event.target.value = "";
        }}
      />
      <div>
        <span className="eyebrow">SCRIPT INTAKE</span>
        <strong>Drop text files here</strong>
        <small>Each non-empty line is appended to the end.</small>
      </div>
      <button type="button" className="button button-quiet" disabled={busy} onClick={() => inputRef.current?.click()}>
        Choose files
      </button>
    </div>
  );
}

