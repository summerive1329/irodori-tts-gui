from app.models.project import Project


def test_append_lines_preserves_existing_lines_and_creates_cells() -> None:
    project = Project.create("demo")
    project.add_reference(
        label="toru",
        source_filename="toru.wav",
        copied_path="references/ref.wav",
        duration_sec=1.5,
    )
    project.append_lines(["existing"])

    project.append_lines(["new one", "new two"])

    assert [line.text for line in project.lines] == ["existing", "new one", "new two"]
    assert [line.order_index for line in project.lines] == [0, 1, 2]
    assert len(project.cells) == 3


def test_add_reference_creates_cells_for_every_existing_line() -> None:
    project = Project.create("demo")
    project.append_lines(["one", "two"])

    reference = project.add_reference(
        label="lize",
        source_filename="lize.mp3",
        copied_path="references/lize.mp3",
        duration_sec=2.0,
    )

    assert {cell.reference_id for cell in project.cells} == {reference.id}
    assert {cell.line_id for cell in project.cells} == {line.id for line in project.lines}


def test_select_export_cell_is_exclusive_per_line() -> None:
    project = Project.create("demo")
    project.append_lines(["one"])
    first = project.add_reference("toru", "a.wav", "references/a.wav", 1.0)
    second = project.add_reference("lize", "b.wav", "references/b.wav", 1.0)
    line = project.lines[0]
    first_cell = project.find_cell(line.id, first.id)
    second_cell = project.find_cell(line.id, second.id)

    project.select_export_cell(first_cell.id)
    project.select_export_cell(second_cell.id)

    assert first_cell.selected_for_export is False
    assert second_cell.selected_for_export is True


def test_reorder_lines_updates_export_order_and_indexes() -> None:
    project = Project.create("demo")
    project.append_lines(["one", "two", "three"])
    line_ids = [line.id for line in project.lines]

    project.reorder_lines([line_ids[2], line_ids[0], line_ids[1]])

    assert [line.text for line in project.ordered_lines()] == ["three", "one", "two"]
    assert [line.order_index for line in project.ordered_lines()] == [0, 1, 2]
    assert project.export_order == [line_ids[2], line_ids[0], line_ids[1]]

