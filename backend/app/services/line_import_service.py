from __future__ import annotations

from pathlib import Path

from app.models.project import LineItem, Project


class LineImportService:
    allowed_suffixes = {".txt", ".md", ".csv", ".tsv"}

    def import_file(self, project: Project, filename: str, content: bytes) -> list[LineItem]:
        suffix = Path(filename).suffix.lower()
        if suffix not in self.allowed_suffixes:
            raise ValueError(f"Unsupported line file: {filename}")
        text = self._decode(content)
        return project.append_lines(text.splitlines())

    @staticmethod
    def _decode(content: bytes) -> str:
        for encoding in ("utf-8-sig", "utf-8", "cp932"):
            try:
                return content.decode(encoding)
            except UnicodeDecodeError:
                continue
        raise ValueError("Could not decode line file as UTF-8 or CP932")
