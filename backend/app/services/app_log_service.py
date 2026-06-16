from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from pathlib import Path
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
    def __init__(self, max_entries: int = 500, log_path: Path | None = None) -> None:
        self._entries: deque[AppLogEntry] = deque(maxlen=max_entries)
        self._lock = RLock()
        self._log_path = Path(log_path) if log_path is not None else None
        if self._log_path is not None:
            self._log_path.parent.mkdir(parents=True, exist_ok=True)
            self._log_path.touch(exist_ok=True)

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
            self._append_to_file(entry)
        return entry.model_copy(deep=True)

    def _append_to_file(self, entry: AppLogEntry) -> None:
        if self._log_path is None:
            return
        try:
            context_items = ", ".join(
                f"{key}={value}"
                for key, value in sorted(entry.context.items())
            )
            line = (
                f"{entry.timestamp.isoformat()} "
                f"[{entry.level}] "
                f"{entry.event} "
                f"project_id={entry.project_id or '-'} "
                f"job_id={entry.job_id or '-'} "
                f"{entry.message}"
            )
            if context_items:
                line = f"{line} | {context_items}"
            with self._log_path.open("a", encoding="utf-8") as handle:
                handle.write(f"{line}\n")
        except OSError:
            # Logging should not take down the application path.
            return

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
