import { useState } from "react";

import type { ProjectSummary } from "../../types";

type Props = {
  projects: ProjectSummary[];
  busy: boolean;
  onCreate: (name: string) => void;
  onOpen: (projectId: string) => void;
};

export function ProjectHome({ projects, busy, onCreate, onOpen }: Props) {
  const [name, setName] = useState("");

  return (
    <main className="project-home">
      <section className="home-intro">
        <span className="eyebrow">IRODORI STUDIO / LOCAL</span>
        <h1>Compare voices and polish each line.</h1>
        <p>Review each generated take by reference voice, then build the final export in the order you want.</p>
      </section>

      <section className="project-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">NEW SESSION</span>
            <h2>Create a New Project</h2>
          </div>
          <span className="section-index">01</span>
        </div>
        <form
          className="create-project-form"
          onSubmit={(event) => {
            event.preventDefault();
            const cleanName = name.trim();
            if (cleanName) onCreate(cleanName);
          }}
        >
          <label>
            Project name
            <input value={name} disabled={busy} onChange={(event) => setName(event.target.value)} placeholder="Voice Scene 01" />
          </label>
          <button className="button button-primary" type="submit" disabled={busy || !name.trim()}>Create Project</button>
        </form>

        <div className="project-list-heading">
          <span className="eyebrow">RECENT PROJECTS</span>
          <span>{projects.length}</span>
        </div>
        <div className="project-list">
          {projects.map((project, index) => (
            <button className="project-card" type="button" key={project.id} onClick={() => onOpen(project.id)}>
              <span className="project-card-index">{String(index + 1).padStart(2, "0")}</span>
              <strong>{project.name}</strong>
              <small>{new Date(project.updated_at).toLocaleString()}</small>
              <span className="project-card-arrow">↗</span>
            </button>
          ))}
          {projects.length === 0 && <p className="project-list-empty">No saved projects yet.</p>}
        </div>
      </section>
    </main>
  );
}

