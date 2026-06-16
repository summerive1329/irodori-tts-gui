from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from threading import RLock
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


LogLevel = Literal["info", "warning", "error"]
LogContextValue = str | int | float | bool | None


def _now() -> datetime:
    return datetime.now(timezone.utc)


class AppLogEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    timestamp: datetime = Field(default_factory=_now)
    level: LogLevel
    event: str
    project_id: str | None = None
    job_id: str | None = None
    message: str
    context: dict[str, LogContextValue] = Field(default_factory=dict)


class AppLogService:
    def __init__(self, max_entries: int = 500) -> None:
        self._entries: deque[AppLogEntry] = deque(maxlen=max_entries)
        self._lock = RLock()

    def log(
        self,
        level: LogLevel,
        event: str,
        *,
        project_id: str | None = None,
        job_id: str | None = None,
        message: str,
        context: dict[str, LogContextValue] | None = None,
    ) -> AppLogEntry:
        entry = AppLogEntry(
            level=level,
            event=event,
            project_id=project_id,
            job_id=job_id,
            message=message,
            context=context or {},
        )
        with self._lock:
            self._entries.append(entry)
        return entry.model_copy(deep=True)

    def log_info(
        self,
        event: str,
        *,
        project_id: str | None = None,
        job_id: str | None = None,
        message: str,
        context: dict[str, LogContextValue] | None = None,
    ) -> AppLogEntry:
        return self.log(
            "info",
            event,
            project_id=project_id,
            job_id=job_id,
            message=message,
            context=context,
        )

    def log_warning(
        self,
        event: str,
        *,
        project_id: str | None = None,
        job_id: str | None = None,
        message: str,
        context: dict[str, LogContextValue] | None = None,
    ) -> AppLogEntry:
        return self.log(
            "warning",
            event,
            project_id=project_id,
            job_id=job_id,
            message=message,
            context=context,
        )

    def log_error(
        self,
        event: str,
        *,
        project_id: str | None = None,
        job_id: str | None = None,
        message: str,
        context: dict[str, LogContextValue] | None = None,
    ) -> AppLogEntry:
        return self.log(
            "error",
            event,
            project_id=project_id,
            job_id=job_id,
            message=message,
            context=context,
        )

    def list_entries(
        self,
        *,
        project_id: str | None = None,
        limit: int = 100,
    ) -> list[AppLogEntry]:
        with self._lock:
            entries = list(self._entries)
        if project_id is not None:
            entries = [entry for entry in entries if entry.project_id == project_id]
        return [entry.model_copy(deep=True) for entry in entries[-limit:]][::-1]
