from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


CellDisplayStatus = Literal["not_generated", "generating", "unplayed", "played", "error"]


class CellResult(BaseModel):
    audio_path: str
    sample_rate: int
    generated_at: datetime = Field(default_factory=_now)
    seed: int | None = None
    duration_sec: float


class ReferenceItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    label: str
    source_filename: str
    copied_path: str
    duration_sec: float


class LineItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    text: str
    order_index: int


class ExportPlaylistItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    cell_id: str
    line_id: str
    reference_id: str
    label: str
    created_at: datetime = Field(default_factory=_now)


class GenerationProgress(BaseModel):
    running_job_count: int = 0
    running_job_kinds: list[str] = Field(default_factory=list)
    has_running_jobs: bool = False


class Cell(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    line_id: str
    reference_id: str
    status: Literal["idle", "queued", "generating", "ready", "error"] = "idle"
    error_message: str | None = None
    current_result: CellResult | None = None
    playback_state: Literal["unplayed", "played"] = "unplayed"
    display_status: CellDisplayStatus = "not_generated"

    def refresh_display_status(self) -> None:
        if self.status == "error":
            self.display_status = "error"
        elif self.status in {"queued", "generating"}:
            self.display_status = "generating"
        elif self.current_result is None:
            self.display_status = "not_generated"
        elif self.playback_state == "played":
            self.display_status = "played"
        else:
            self.display_status = "unplayed"


class ProjectSummary(BaseModel):
    id: str
    name: str
    updated_at: datetime


class Project(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
    checkpoint: str = "Aratako/Irodori-TTS-500M-v3"
    model_device: str = "cuda"
    model_precision: str = "fp32"
    codec_device: str = "cuda"
    codec_precision: str = "fp32"
    num_steps: int = 40
    cfg_scale_text: float = 3.0
    cfg_scale_speaker: float = 5.0
    references: list[ReferenceItem] = Field(default_factory=list)
    lines: list[LineItem] = Field(default_factory=list)
    cells: list[Cell] = Field(default_factory=list)
    export_playlist: list[ExportPlaylistItem] = Field(default_factory=list)

    @classmethod
    def create(cls, name: str) -> Project:
        clean_name = name.strip()
        if not clean_name:
            raise ValueError("Project name is required")
        return cls(name=clean_name)

    def touch(self) -> None:
        self.updated_at = _now()

    def ordered_lines(self) -> list[LineItem]:
        return sorted(self.lines, key=lambda line: line.order_index)

    def append_lines(self, texts: list[str]) -> list[LineItem]:
        next_index = max((line.order_index for line in self.lines), default=-1) + 1
        added: list[LineItem] = []
        for raw_text in texts:
            text = raw_text.strip()
            if not text:
                continue
            line = LineItem(text=text, order_index=next_index)
            self.lines.append(line)
            added.append(line)
            next_index += 1
            for reference in self.references:
                self.cells.append(Cell(line_id=line.id, reference_id=reference.id))
        if added:
            self.touch()
        return added

    def insert_line(self, index: int, text: str) -> LineItem:
        clean_text = text.strip()
        if not clean_text:
            raise ValueError("Line text is required")
        if index < 0 or index > len(self.lines):
            raise ValueError("Line index is out of range")
        for line in self.lines:
            if line.order_index >= index:
                line.order_index += 1
        inserted = LineItem(text=clean_text, order_index=index)
        self.lines.append(inserted)
        for reference in self.references:
            self.cells.append(Cell(line_id=inserted.id, reference_id=reference.id))
        self._reindex_lines()
        self.touch()
        return inserted

    def add_reference(
        self,
        label: str,
        source_filename: str,
        copied_path: str,
        duration_sec: float,
    ) -> ReferenceItem:
        clean_label = label.strip()
        if not clean_label:
            raise ValueError("Reference label is required")
        reference = ReferenceItem(
            label=clean_label,
            source_filename=source_filename,
            copied_path=copied_path,
            duration_sec=duration_sec,
        )
        self.references.append(reference)
        for line in self.lines:
            self.cells.append(Cell(line_id=line.id, reference_id=reference.id))
        self.touch()
        return reference

    def find_cell(self, line_id: str, reference_id: str) -> Cell:
        for cell in self.cells:
            if cell.line_id == line_id and cell.reference_id == reference_id:
                return cell
        raise KeyError(f"Cell not found for line={line_id} reference={reference_id}")

    def get_cell(self, cell_id: str) -> Cell:
        for cell in self.cells:
            if cell.id == cell_id:
                return cell
        raise KeyError(f"Cell not found: {cell_id}")

    def append_playlist_item(self, cell_id: str) -> ExportPlaylistItem:
        cell = self.get_cell(cell_id)
        if cell.current_result is None:
            raise ValueError("Only generated cells can be added to the export playlist")
        line = next(item for item in self.lines if item.id == cell.line_id)
        reference = next(item for item in self.references if item.id == cell.reference_id)
        playlist_item = ExportPlaylistItem(
            cell_id=cell.id,
            line_id=line.id,
            reference_id=reference.id,
            label=f"{reference.label} / {line.text[:24]}",
        )
        self.export_playlist.append(playlist_item)
        self.touch()
        return playlist_item

    def remove_playlist_item(self, playlist_item_id: str) -> None:
        if not any(item.id == playlist_item_id for item in self.export_playlist):
            raise KeyError(f"Playlist item not found: {playlist_item_id}")
        self.export_playlist = [
            item for item in self.export_playlist if item.id != playlist_item_id
        ]
        self.touch()

    def reorder_playlist(self, ordered_item_ids: list[str]) -> None:
        current_ids = {item.id for item in self.export_playlist}
        if len(ordered_item_ids) != len(current_ids) or set(ordered_item_ids) != current_ids:
            raise ValueError("Playlist order must contain every item exactly once")
        by_id = {item.id: item for item in self.export_playlist}
        self.export_playlist = [by_id[item_id] for item_id in ordered_item_ids]
        self.touch()

    def update_line(self, line_id: str, text: str) -> LineItem:
        clean_text = text.strip()
        if not clean_text:
            raise ValueError("Line text is required")
        line = next((item for item in self.lines if item.id == line_id), None)
        if line is None:
            raise KeyError(f"Line not found: {line_id}")
        if line.text != clean_text:
            line.text = clean_text
            affected_cell_ids = {
                cell.id for cell in self.cells if cell.line_id == line_id
            }
            for cell in self.cells:
                if cell.line_id == line_id:
                    cell.status = "idle"
                    cell.error_message = None
                    cell.current_result = None
            self.export_playlist = [
                item for item in self.export_playlist if item.cell_id not in affected_cell_ids
            ]
            self.touch()
        return line

    def remove_line(self, line_id: str) -> None:
        if not any(line.id == line_id for line in self.lines):
            raise KeyError(f"Line not found: {line_id}")
        removed_cell_ids = {cell.id for cell in self.cells if cell.line_id == line_id}
        self.lines = [line for line in self.lines if line.id != line_id]
        self.cells = [cell for cell in self.cells if cell.line_id != line_id]
        self.export_playlist = [
            item for item in self.export_playlist if item.cell_id not in removed_cell_ids
        ]
        self._reindex_lines()
        self.touch()

    def remove_reference(self, reference_id: str) -> ReferenceItem:
        reference = next(
            (item for item in self.references if item.id == reference_id),
            None,
        )
        if reference is None:
            raise KeyError(f"Reference not found: {reference_id}")
        removed_cell_ids = {
            cell.id for cell in self.cells if cell.reference_id == reference_id
        }
        self.references = [item for item in self.references if item.id != reference_id]
        self.cells = [cell for cell in self.cells if cell.reference_id != reference_id]
        self.export_playlist = [
            item for item in self.export_playlist if item.cell_id not in removed_cell_ids
        ]
        self.touch()
        return reference

    def reorder_lines(self, ordered_line_ids: list[str]) -> None:
        current_ids = {line.id for line in self.lines}
        if len(ordered_line_ids) != len(current_ids) or set(ordered_line_ids) != current_ids:
            raise ValueError("Line order must contain every line exactly once")
        by_id = {line.id: line for line in self.lines}
        for index, line_id in enumerate(ordered_line_ids):
            by_id[line_id].order_index = index
        self.touch()

    def _reindex_lines(self) -> None:
        for index, line in enumerate(self.ordered_lines()):
            line.order_index = index
