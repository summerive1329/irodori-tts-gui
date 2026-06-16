import { useEffect, useState } from "react";

import type { AppLogEntry, GenerationJob, Project } from "../../types";
import { CellDetailPane } from "./CellDetailPane";
import { ExportPlaylist } from "./ExportPlaylist";
import { GenerationConsole } from "./GenerationConsole";
import { LineDropzone } from "./LineDropzone";
import { LineMatrix } from "./LineMatrix";
import { PendingDeleteToast } from "./PendingDeleteToast";
import { ProjectMenu } from "./ProjectMenu";
import { ReferenceSidebar } from "./ReferenceSidebar";
import { useDialogueColumnWidth } from "./useDialogueColumnWidth";
import { usePendingLineDeletion } from "./usePendingLineDeletion";

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
  selectionMode: boolean;
  selectedCellId: string | null;
  selectedCellIds: string[];
  projectLogs: AppLogEntry[];
  exportUrl: string | null;
  onBack: () => void;
  onDeleteProject: () => void;
  onSelectCell: (cellId: string) => void;
  onToggleCellSelection: (cellId: string) => void;
  onEnterSelectionMode: () => void;
  onCancelSelectionMode: () => void;
  onImportFiles: (files: File[]) => void;
  onAppendLines: (texts: string[]) => void;
  onAddReference: (label: string, file: File) => void;
  onDeleteReference: (referenceId: string) => void;
  onEditLine: (lineId: string, text: string) => void;
  onInsertLine: (index: number, text: string) => void;
  onDeleteLine: (lineId: string) => void;
  onClearLines: () => void;
  onReorder: (lineIds: string[]) => void;
  onGenerate: (onlyMissing: boolean) => void;
  onRegenerateSelected: (cellIds: string[], seed: number | null) => void;
  onRegenerate: (cellId: string, seed: number | null) => void;
  onMarkCellPlayed?: (cellId: string) => void;
  onAppendToPlaylist: (cellId: string) => void;
  onAppendReferenceColumn: (referenceId: string) => void;
  onRemovePlaylistItem: (playlistItemId: string) => void;
  onReorderPlaylist: (playlistItemIds: string[]) => void;
  onClearPlaylist: () => void;
  onExport: () => void;
  onExportText: () => void;
  onSaveSettings: (settings: ProjectSettings) => void;
};

export function ProjectEditor({
  project,
  busy,
  job,
  selectionMode,
  selectedCellId,
  selectedCellIds,
  projectLogs,
  exportUrl,
  onBack,
  onDeleteProject,
  onSelectCell,
  onToggleCellSelection,
  onEnterSelectionMode,
  onCancelSelectionMode,
  onImportFiles,
  onAppendLines,
  onAddReference,
  onDeleteReference,
  onEditLine,
  onInsertLine,
  onDeleteLine,
  onClearLines,
  onReorder,
  onGenerate,
  onRegenerateSelected,
  onRegenerate,
  onMarkCellPlayed,
  onAppendToPlaylist,
  onAppendReferenceColumn,
  onRemovePlaylistItem,
  onReorderPlaylist,
  onClearPlaylist,
  onExport,
  onExportText,
  onSaveSettings,
}: Props) {
  const [manualText, setManualText] = useState("");
  const [autoPlay, setAutoPlay] = useState(false);
  const [settings, setSettings] = useState<ProjectSettings>(() => settingsFrom(project));
  const { pending, requestDelete, undoDelete } = usePendingLineDeletion(onDeleteLine);
  const { width, commitWidth } = useDialogueColumnWidth();

  useEffect(() => setSettings(settingsFrom(project)), [project]);

  const selectedCell = project.cells.find((cell) => cell.id === selectedCellId) ?? null;
  const selectedLine = selectedCell ? project.lines.find((line) => line.id === selectedCell.line_id) ?? null : null;
  const selectedReference = selectedCell ? project.references.find((reference) => reference.id === selectedCell.reference_id) ?? null : null;
  const canGenerate = project.lines.length > 0 && project.references.length > 0;
  const allowRegenerateWhileBusy = busy;
  const hiddenLineIds = new Set(pending ? [pending.line.id] : []);
  const selectedRegeneratableCellIds = project.cells
    .filter((cell) => selectedCellIds.includes(cell.id))
    .filter((cell) => cell.display_status !== "generating" && cell.display_status !== "queued")
    .map((cell) => cell.id);
  const durationByCellId = Object.fromEntries(
    project.cells.map((cell) => [cell.id, cell.current_result?.duration_sec ?? 0]),
  );

  return (
    <div className="studio-shell">
      <header className="studio-header">
        <button type="button" className="brand-button" onClick={onBack}>
          <span className="brand-mark">彩</span>
          <span><strong>Irodori Studio</strong><small>Local voice workspace</small></span>
        </button>
        <input
          className="project-title-input"
          aria-label="プロジェクト名"
          value={settings.name}
          onChange={(event) => setSettings({ ...settings, name: event.target.value })}
          onBlur={() => settings.name.trim() && onSaveSettings({ ...settings, name: settings.name.trim() })}
        />
        <div className="header-actions">
          <details className="settings-menu">
            <summary className="button button-quiet">設定</summary>
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
              <button type="submit" className="button button-primary">設定を保存</button>
            </form>
          </details>
          <ProjectMenu onDeleteProject={onDeleteProject} />
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
                まとめて追加するセリフ
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
                末尾に追加
              </button>
            </details>
            <button
              type="button"
              className="button button-quiet"
              disabled={busy || project.lines.length === 0}
              onClick={() => {
                if (window.confirm("セリフを全て削除しますか？")) onClearLines();
              }}
            >
              セリフを全消し
            </button>
          </div>

          <GenerationConsole
            job={job}
            generationProgress={project.generation_progress}
            busy={busy}
            canGenerate={canGenerate}
            autoPlay={autoPlay}
            selectionMode={selectionMode}
            selectedRegeneratableCount={selectedRegeneratableCellIds.length}
            onGenerateMissing={() => onGenerate(true)}
            onGenerateAll={() => onGenerate(false)}
            onEnterSelectionMode={onEnterSelectionMode}
            onCancelSelectionMode={onCancelSelectionMode}
            onRegenerateSelected={() => onRegenerateSelected(selectedRegeneratableCellIds, null)}
            onToggleAutoPlay={setAutoPlay}
          />

          <LineMatrix
            projectId={project.id}
            lines={project.lines}
            references={project.references}
            cells={project.cells}
            busy={busy}
            dialogueColumnWidth={width}
            autoPlay={autoPlay}
            selectionMode={selectionMode}
            hiddenLineIds={hiddenLineIds}
            selectedCellId={selectedCellId}
            selectedCellIds={selectedCellIds}
            onSelectCell={onSelectCell}
            onToggleCellSelection={onToggleCellSelection}
            allowRegenerateWhileBusy={allowRegenerateWhileBusy}
            onRegenerate={(cellId) => onRegenerate(cellId, null)}
            onMarkCellPlayed={onMarkCellPlayed}
            onAppendToPlaylist={onAppendToPlaylist}
            onAppendReferenceColumn={onAppendReferenceColumn}
            onEditLine={onEditLine}
            onInsertLine={onInsertLine}
            onDeleteLine={(lineId) => {
              const line = project.lines.find((item) => item.id === lineId);
              if (line) requestDelete(line);
            }}
            onReorder={onReorder}
            onResizeDialogueColumn={commitWidth}
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
            durationByCellId={durationByCellId}
            busy={busy}
            exportUrl={exportUrl}
            onRemove={onRemovePlaylistItem}
            onReorder={onReorderPlaylist}
            onClear={onClearPlaylist}
            onExport={onExport}
            onExportText={onExportText}
          />
          <section className="project-log-panel">
            <header className="playlist-header">
              <div>
                <span className="eyebrow">TRACE LOG</span>
                <h2>ログ</h2>
              </div>
            </header>
            {projectLogs.length === 0 ? (
              <p className="playlist-empty">ログはまだありません。</p>
            ) : (
              <div className="playlist-list">
                {projectLogs.map((entry) => (
                  <article key={entry.id} className="playlist-item">
                    <span className={`log-source-pill source-${entry.source}`}>{entry.source}</span>
                    <div className="playlist-item-copy">
                      <strong>{entry.event}</strong>
                      <p>{entry.message}</p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
      <PendingDeleteToast pending={pending} onUndo={undoDelete} />
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
