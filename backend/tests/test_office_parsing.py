from pathlib import Path

from docx import Document
from pptx import Presentation
from pptx.util import Inches

from app.parsing import parse_docx, parse_pptx


def test_docx_preserves_headings_paragraphs_and_tables(tmp_path: Path) -> None:
    path = tmp_path / "lesson.docx"
    document = Document()
    document.add_heading("进程同步", level=1)
    document.add_paragraph("PV 操作必须成对分析。")
    table = document.add_table(rows=1, cols=2)
    table.cell(0, 0).text = "信号量"
    table.cell(0, 1).text = "初值"
    document.save(path)

    outcome = parse_docx("docx-source", path)
    assert outcome.status == "ready"
    assert outcome.nodes[0].title == "进程同步"
    block_texts = [block.text for block in outcome.blocks]
    assert any("PV 操作必须成对分析。" in text for text in block_texts)
    assert "信号量\t初值" in block_texts[-1]
    assert outcome.blocks[0].page_number is None


def test_empty_docx_needs_review(tmp_path: Path) -> None:
    path = tmp_path / "blank.docx"
    Document().save(path)
    outcome = parse_docx("blank-docx", path)
    assert outcome.status == "needs_review"
    assert outcome.stats["empty_nodes"] == 1


def test_pptx_uses_slide_numbers_and_exposes_blank_slide(tmp_path: Path) -> None:
    path = tmp_path / "lesson.pptx"
    presentation = Presentation()
    first = presentation.slides.add_slide(presentation.slide_layouts[6])
    first.shapes.add_textbox(Inches(1), Inches(1), Inches(5), Inches(1)).text = "地址转换"
    presentation.slides.add_slide(presentation.slide_layouts[6])
    presentation.save(path)

    outcome = parse_pptx("pptx-source", path)
    assert outcome.status == "needs_review"
    assert len(outcome.nodes) == 2
    assert outcome.blocks[0].page_number == 1
    assert outcome.blocks[0].text == "地址转换"
    assert outcome.stats["empty_nodes"] == 1
