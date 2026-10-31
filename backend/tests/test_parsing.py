from pathlib import Path

from reportlab.pdfgen.canvas import Canvas

from app.parsing import parse_file, parse_markdown, parse_plain_text, stable_id


def test_markdown_builds_sections_and_stable_blocks(tmp_path: Path) -> None:
    source = tmp_path / "notes.md"
    source.write_text("# 第一章\n\nPV 操作用于同步。\n\n## 第二节\n\n信号量初值很重要。", encoding="utf-8")
    first = parse_markdown("source-1", source)
    second = parse_markdown("source-1", source)

    assert first.status == "ready"
    assert [node.title for node in first.nodes] == ["第一章", "第二节"]
    assert len(first.blocks) == 4
    assert first.blocks[0].text.startswith("# 第一章")
    assert [block.id for block in first.blocks] == [block.id for block in second.blocks]
    assert first.stats["character_count"] > 20


def test_plain_text_preserves_all_paragraphs(tmp_path: Path) -> None:
    source = tmp_path / "notes.txt"
    source.write_text("第一段\n\n第二段\n\n第三段", encoding="utf-8")
    outcome = parse_plain_text("source-2", source)
    assert outcome.status == "ready"
    assert len(outcome.blocks) == 3
    assert outcome.nodes[0].page_start is None


def test_whitespace_only_text_needs_review(tmp_path: Path) -> None:
    source = tmp_path / "blank.txt"
    source.write_text(" \n\n ", encoding="utf-8")
    outcome = parse_plain_text("source-3", source)
    assert outcome.status == "needs_review"
    assert outcome.stats["empty_nodes"] == 1


def test_pdf_uses_page_numbers_and_exposes_blank_pages(tmp_path: Path) -> None:
    source = tmp_path / "paper.pdf"
    canvas = Canvas(str(source))
    canvas.drawString(72, 720, "Operating systems evidence")
    canvas.showPage()
    canvas.showPage()
    canvas.save()

    outcome = parse_file("source-4", source, ".pdf")
    assert outcome.status == "needs_review"
    assert len(outcome.nodes) == 2
    assert outcome.nodes[0].page_start == 1
    assert outcome.blocks[0].page_number == 1
    assert "Operating systems evidence" in outcome.blocks[0].text
    assert outcome.stats["empty_nodes"] == 1


def test_ids_change_with_source_identity() -> None:
    assert stable_id("a", "node") != stable_id("b", "node")
