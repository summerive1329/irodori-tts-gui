import { useRef } from "react";

import type { ReferenceItem } from "../../types";

type Props = {
  projectId: string;
  references: ReferenceItem[];
  busy: boolean;
  onAdd: (label: string, file: File) => void;
  onDelete: (referenceId: string) => void;
};

export function ReferenceSidebar({ projectId, references, busy, onAdd, onDelete }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(files: FileList) {
    for (const file of Array.from(files)) {
      const label = file.name.replace(/\.[^.]+$/, "");
      onAdd(label, file);
    }
  }

  return (
    <aside className="reference-sidebar">
      <div className="section-heading compact">
        <div>
          <span className="eyebrow">VOICE BANK</span>
          <h2>参照音声</h2>
        </div>
        <span className="section-index">{String(references.length).padStart(2, "0")}</span>
      </div>
      <input
        ref={inputRef}
        className="visually-hidden"
        aria-label="参照音声を追加"
        type="file"
        accept=".wav,.mp3,.flac,.ogg,audio/*"
        multiple
        disabled={busy}
        onChange={(event) => {
          if (event.target.files) submit(event.target.files);
          event.target.value = "";
        }}
      />
      <button type="button" className="reference-add" disabled={busy} onClick={() => inputRef.current?.click()}>
        <span>＋</span>
        参照音声を追加
      </button>

      <div className="reference-list">
        {references.map((reference, index) => (
          <article className="reference-card" key={reference.id}>
            <div className="reference-number">V{String(index + 1).padStart(2, "0")}</div>
            <div className="reference-meta">
              <strong>{reference.label}</strong>
              <small>{reference.source_filename}</small>
              <span>{reference.duration_sec.toFixed(1)} sec</span>
            </div>
            <audio controls preload="none" src={`/media/projects/${projectId}/${reference.copied_path}`} />
            <button type="button" className="icon-button" aria-label={`参照音声を削除: ${reference.label}`} disabled={busy} onClick={() => onDelete(reference.id)}>×</button>
          </article>
        ))}
      </div>
    </aside>
  );
}

