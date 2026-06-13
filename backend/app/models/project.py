from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


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


class Cell(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    line_id: str
    reference_id: str
    status: Literal["idle", "generating", "ready", "error"] = "idle"
    error_message: str | None = None
    current_result: CellResult | None = None
    selected_for_export: bool = False


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
    export_order: list[str] = Field(default_factory=list)

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
            self.export_order.append(line.id)
            added.append(line)
            next_index += 1
            for reference in self.references:
                self.cells.append(Cell(line_id=line.id, reference_id=reference.id))
        if added:
            self.touch()
        return added

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

    def select_export_cell(self, cell_id: str) -> None:
        target = self.get_cell(cell_id)
        for cell in self.cells:
            if cell.line_id == target.line_id:
                cell.selected_for_export = cell.id == target.id
        self.touch()

    def reorder_lines(self, ordered_line_ids: list[str]) -> None:
        current_ids = {line.id for line in self.lines}
        if len(ordered_line_ids) != len(current_ids) or set(ordered_line_ids) != current_ids:
            raise ValueError("Line order must contain every line exactly once")
        by_id = {line.id: line for line in self.lines}
        for index, line_id in enumerate(ordered_line_ids):
            by_id[line_id].order_index = index
        self.export_order = list(ordered_line_ids)
        self.touch()
