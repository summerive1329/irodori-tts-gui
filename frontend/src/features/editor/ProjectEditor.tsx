import { useEffect, useState } from "react";

import type { GenerationJob, Project } from "../../types";
import { CellDetailPane } from "./CellDetailPane";
import { ExportPlaylist } from "./ExportPlaylist";
import { GenerationConsole } from "./GenerationConsole";
import { LineDropzone } from "./LineDropzone";
import { LineMatrix } from "./LineMatrix";
import { ReferenceSidebar } from "./ReferenceSidebar";

type ProjectSettings = Pick<
  Project,
  | "name"
  | "checkpoint"
  | "model_device"
  | "model_precision"
  | "codec_device"
  | "codec_precision"
  | "num_steps"
  | "cfg_scale_text"
  | "cfg_scale_speaker"
>;

type Props = {
  project: Project;
  busy: boolean;
  job: GenerationJob | null;
  selectedCellId: string | null;
  exportUrl: string | null;
  onBack: () => void;
  onDeleteProject: () => void;
  onSelectCell: (cellId: string) => void;
  onImportFiles: (files: File[]) => void;
  onAppendLines: (texts: string[]) => void;
  onAddReference: (label: string, file: File) => void;
  onDeleteReference: (referenceId: string) => void;
  onEditLine: (lineId: string, text: string) => void;
  onDeleteLine: (lineId: string) => void;
  onReorder: (lineIds: string[]) => void;
  onGenerate: (onlyMissing: boolean) => void;
  onRegenerate: (cellId: string, seed: number | null) => void;
  onAppendToPlaylist: (cellId: string) => void;
  onAppendReferenceColumn: (referenceId: string) => void;
  onRemovePlaylistItem: (playlistItemId: string) => void;
  onReorderPlaylist: (playlistItemIds: string[]) => void;
  onExport: () => void;
  onExportText: () => void;
  onSaveSettings: (settings: ProjectSettings) => void;
};

export function ProjectEditor({
  project,
  busy,
  job,
  selectedCellId,
  exportUrl,
  onBack,
  onDeleteProject,
  onSelectCell,
  onImportFiles,
  onAppendLines,
  onAddReference,
  onDeleteReference,
  onEditLine,
  onDeleteLine,
  onReorder,
  onGenerate,
  onRegenerate,
  onAppendToPlaylist,
  onAppendReferenceColumn,
  onRemovePlaylistItem,
  onReorderPlaylist,
  onExport,
  onExportText,
  onSaveSettings,
}: Props) {
  const [manualText, setManualText] = useState("");
  const [autoPlay, setAutoPlay] = useState(false);
  const [settings, setSettings] = useState<ProjectSettings>(() => settingsFrom(project));

  useEffect(() => setSettings(settingsFrom(project)), [project]);

  const selectedCell = project.cells.find((cell) => cell.id === selectedCellId) ?? null;
  const selectedLine = selectedCell ? project.lines.find((line) => line.id === selectedCell.line_id) ?? null : null;
  const selectedReference = selectedCell ? project.references.find((reference) => reference.id === selectedCell.reference_id) ?? null : null;
  const canGenerate = project.lines.length > 0 && project.references.length > 0;

  return (
    <div className="studio-shell">
      <header className="studio-header">
        <button type="button" className="brand-button" onClick={onBack}>
          <span className="brand-mark">彩</span>
          <span><strong>Irodori Studio</strong><small>Local voice workspace</small></span>
        </button>
        <input
          className="project-title-input"
          aria-label="Current project name"
          value={settings.name}
          onChange={(event) => setSettings({ ...settings, name: event.target.value })}
          onBlur={() => settings.name.trim() && onSaveSettings({ ...settings, name: settings.name.trim() })}
        />
        <div className="header-actions">
          <details className="settings-menu">
            <summary className="button button-quiet">Settings</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onSaveSettings(settings);
                (event.currentTarget.parentElement as HTMLDetailsElement).open = false;
              }}
            >
              <label>Checkpoint<input value={settings.checkpoint} onChange={(event) => setSettings({ ...settings, checkpoint: event.target.value })} /></label>
              <div className="settings-grid">
                <label>Model device<input value={settings.model_device} onChange={(event) => setSettings({ ...settings, model_device: event.target.value })} /></label>
                <label>Codec device<input value={settings.codec_device} onChange={(event) => setSettings({ ...settings, codec_device: event.target.value })} /></label>
                <label>Steps<input type="number" min="1" max="200" value={settings.num_steps} onChange={(event) => setSettings({ ...settings, num_steps: Number(event.target.value) })} /></label>
                <label>Text CFG<input type="number" step="0.1" min="0" value={settings.cfg_scale_text} onChange={(event) => setSettings({ ...settings, cfg_scale_text: Number(event.target.value) })} /></label>
                <label>Speaker CFG<input type="number" step="0.1" min="0" value={settings.cfg_scale_speaker} onChange={(event) => setSettings({ ...settings, cfg_scale_speaker: Number(event.target.value) })} /></label>
              </div>
              <button type="submit" className="button button-primary">Save settings</button>
            </form>
          </details>
          <button type="button" className="button button-danger-quiet" onClick={onDeleteProject}>Delete project</button>
        </div>
      </header>

      <div className="studio-main">
        <ReferenceSidebar projectId={project.id} references={project.references} busy={busy} onAdd={onAddReference} onDelete={onDeleteReference} />

        <main className="editor-main">
          <div className="editor-toolbar">
            <LineDropzone busy={busy} onFilesSelected={onImportFiles} />
            <details className="manual-entry">
              <summary>セリフを貼り付け</summary>
              <label>
                Manual dialogue
                <textarea value={manualText} placeholder="1行につき1セリフ" onChange={(event) => setManualText(event.target.value)} />
              </label>
              <button
                className="button button-primary"
                type="button"
                disabled={busy || !manualText.trim()}
                onClick={() => {
                  const texts = manualText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
                  if (texts.length) onAppendLines(texts);
                  setManualText("");
                }}
              >
                Append lines
              </button>
            </details>
          </div>

          <GenerationConsole
            job={job}
            busy={busy}
            canGenerate={canGenerate}
            autoPlay={autoPlay}
            onGenerateMissing={() => onGenerate(true)}
            onGenerateAll={() => onGenerate(false)}
            onToggleAutoPlay={setAutoPlay}
          />

          <LineMatrix
            projectId={project.id}
            lines={project.lines}
            references={project.references}
            cells={project.cells}
            selectedCellId={selectedCellId}
            onSelectCell={onSelectCell}
            onRegenerate={(cellId) => onRegenerate(cellId, null)}
            onAppendToPlaylist={onAppendToPlaylist}
            onAppendReferenceColumn={onAppendReferenceColumn}
            onEditLine={onEditLine}
            onDeleteLine={onDeleteLine}
            onReorder={onReorder}
          />
        </main>

        <div className="right-rail">
          <CellDetailPane
            projectId={project.id}
            cell={selectedCell}
            line={selectedLine}
            reference={selectedReference}
            busy={busy}
            onRegenerate={onRegenerate}
          />
          <ExportPlaylist
            items={project.export_playlist}
            busy={busy}
            exportUrl={exportUrl}
            onRemove={onRemovePlaylistItem}
            onReorder={onReorderPlaylist}
            onExport={onExport}
            onExportText={onExportText}
          />
        </div>
      </div>
    </div>
  );
}

function settingsFrom(project: Project): ProjectSettings {
  return {
    name: project.name,
    checkpoint: project.checkpoint,
    model_device: project.model_device,
    model_precision: project.model_precision,
    codec_device: project.codec_device,
    codec_precision: project.codec_precision,
    num_steps: project.num_steps,
    cfg_scale_text: project.cfg_scale_text,
    cfg_scale_speaker: project.cfg_scale_speaker,
  };
}
