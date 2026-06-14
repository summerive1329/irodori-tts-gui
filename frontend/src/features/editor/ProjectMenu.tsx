import { useState } from "react";

type Props = {
  onDeleteProject: () => void;
};

export function ProjectMenu({ onDeleteProject }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="project-menu">
      <button
        type="button"
        className="button button-quiet"
        aria-label="プロジェクトメニュー"
        onClick={() => setOpen((current) => !current)}
      >
        •••
      </button>
      {open ? (
        <div className="project-menu-panel">
          <button
            type="button"
            className="button button-danger-quiet"
            onClick={() => {
              setOpen(false);
              onDeleteProject();
            }}
          >
            プロジェクトを削除
          </button>
        </div>
      ) : null}
    </div>
  );
}
