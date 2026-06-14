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
        <h1>声を比べて、<br />一行ずつ仕上げる。</h1>
        <p>参照音声ごとの生成結果を見渡し、納得できるテイクだけを自由な順番で組み立てるローカル音声制作環境。</p>
      </section>

      <section className="project-panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">NEW SESSION</span>
            <h2>新しいプロジェクト</h2>
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
            プロジェクト名
            <input value={name} disabled={busy} onChange={(event) => setName(event.target.value)} placeholder="ボイスシーン 01" />
          </label>
          <button className="button button-primary" type="submit" disabled={busy || !name.trim()}>プロジェクトを作成</button>
        </form>

        <div className="project-list-heading">
          <span className="eyebrow">最近のプロジェクト</span>
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
          {projects.length === 0 && <p className="project-list-empty">保存済みプロジェクトはまだありません。</p>}
        </div>
      </section>
    </main>
  );
}

