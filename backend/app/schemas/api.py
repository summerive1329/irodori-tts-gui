from __future__ import annotations

from pydantic import BaseModel, Field


class CreateProjectRequest(BaseModel):
    name: str


class UpdateProjectRequest(BaseModel):
    name: str | None = None
    checkpoint: str | None = None
    model_device: str | None = None
    model_precision: str | None = None
    codec_device: str | None = None
    codec_precision: str | None = None
    num_steps: int | None = Field(default=None, ge=1, le=200)
    cfg_scale_text: float | None = Field(default=None, ge=0)
    cfg_scale_speaker: float | None = Field(default=None, ge=0)


class AppendLinesRequest(BaseModel):
    texts: list[str]


class UpdateLineRequest(BaseModel):
    text: str


class ReorderLinesRequest(BaseModel):
    line_ids: list[str]


class InsertLineRequest(BaseModel):
    index: int = Field(ge=0)
    text: str


class GenerateAllRequest(BaseModel):
    only_missing: bool = True


class RegenerateCellRequest(BaseModel):
    seed: int | None = None


class RegenerateCellsRequest(BaseModel):
    cell_ids: list[str]
    seed: int | None = None


class PlaylistAppendRequest(BaseModel):
    cell_id: str


class PlaylistReorderRequest(BaseModel):
    playlist_item_ids: list[str]


class ExportResponse(BaseModel):
    media_url: str

