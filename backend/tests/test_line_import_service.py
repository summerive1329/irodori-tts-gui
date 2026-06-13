import pytest

from app.models.project import Project
from app.services.line_import_service import LineImportService


def test_import_appends_non_empty_lines_without_replacing_existing() -> None:
    project = Project.create("demo")
    project.append_lines(["existing"])
    service = LineImportService()

    added = service.import_file(project, "lines.txt", "new one\n\n new two \n".encode())

    assert [line.text for line in added] == ["new one", "new two"]
    assert [line.text for line in project.ordered_lines()] == [
        "existing",
        "new one",
        "new two",
    ]


def test_import_decodes_utf8_bom_without_leaking_bom() -> None:
    project = Project.create("demo")
    service = LineImportService()

    service.import_file(project, "lines.txt", "first\nsecond".encode("utf-8-sig"))

    assert [line.text for line in project.lines] == ["first", "second"]


def test_import_decodes_cp932() -> None:
    project = Project.create("demo")
    service = LineImportService()

    service.import_file(project, "lines.txt", "こんにちは\nまたね".encode("cp932"))

    assert [line.text for line in project.lines] == ["こんにちは", "またね"]


def test_import_rejects_unsupported_extension() -> None:
    project = Project.create("demo")
    service = LineImportService()

    with pytest.raises(ValueError, match="Unsupported line file"):
        service.import_file(project, "lines.exe", b"hello")
