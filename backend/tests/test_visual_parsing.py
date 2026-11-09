from io import BytesIO
from types import SimpleNamespace

from PIL import Image
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen.canvas import Canvas

from app.parsing import ParseOutcome, ParsedNode
from app.visual_parsing import _pdf_page_images, transcribe_visual_source


def test_full_page_render_preserves_vectors_rotation_and_page_selection(tmp_path):
    path = tmp_path / "vector.pdf"
    canvas = Canvas(str(path), pagesize=(200, 300))
    canvas.setFillColorRGB(0, 0, 0)
    canvas.rect(20, 30, 100, 200, fill=1, stroke=0)
    canvas.showPage()
    canvas.drawString(20, 30, "Readable text: do not transcribe this page")
    canvas.save()
    writer = PdfWriter(clone_from=path)
    writer.pages[0].rotate(90)
    writer.write(path)
    assert not PdfReader(path).pages[0].images
    pages, issues = _pdf_page_images(path, {1})
    assert not issues and set(pages) == {1}
    assert len(pages[1]) == 1 and "完整页面" in pages[1][0].label
    with Image.open(BytesIO(pages[1][0].data)) as image:
        assert image.width > image.height
        assert image.getextrema()[0][0] < 20


def test_render_failure_keeps_page_issue_instead_of_partial_image(tmp_path):
    pages, issues = _pdf_page_images(tmp_path / "missing.pdf", {3})
    assert not pages and "渲染失败" in issues[0]
    assert _pdf_page_images(tmp_path / "missing.pdf", set()) == ({}, [])


def test_unrenderable_page_keeps_review_state_without_model_call(tmp_path):
    outcome = ParseOutcome("pdf-v2", "needs_review", "损坏字符", (
        ParsedNode("page", "第 1 页", 1, 1, 1),
    ), (), {"damaged_text_pages": 1})
    # An object without generate_json also asserts no model call is attempted.
    result = transcribe_visual_source(None, SimpleNamespace(extension=".pdf"),
                                     tmp_path / "missing.pdf", outcome, object())
    assert result.status == "needs_review" and not result.blocks
    assert result.nodes == outcome.nodes and result.stats["damaged_text_pages"] == 1
    assert "损坏字符" in result.error and "渲染失败" in result.error
