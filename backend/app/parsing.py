"""Deterministic text extraction with stable evidence identities."""

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
import re
from uuid import UUID, uuid5

from pypdf import PdfReader
from docx import Document as DocxDocument
from docx.document import Document as DocxDocumentType
from docx.table import Table
from docx.text.paragraph import Paragraph
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from pptx import Presentation


ID_NAMESPACE = UUID("2b93dcb2-3b62-4c94-a69f-fb27bd82ce5b")
MAX_BLOCK_CHARS = 1800


@dataclass(frozen=True)
class ParsedNode:
    id: str
    title: str
    ordinal: int
    page_start: int | None
    page_end: int | None


@dataclass(frozen=True)
class ParsedBlock:
    id: str
    node_id: str
    ordinal: int
    text: str
    page_number: int | None
    content_hash: str


@dataclass(frozen=True)
class ParseOutcome:
    parser_version: str
    status: str
    error: str | None
    nodes: tuple[ParsedNode, ...]
    blocks: tuple[ParsedBlock, ...]
    stats: dict[str, int]


def stable_id(*parts: object) -> str:
    return str(uuid5(ID_NAMESPACE, ":".join(str(part) for part in parts)))


def split_blocks(text: str) -> list[str]:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return []
    paragraphs = re.split(r"\n\s*\n", normalized)
    blocks: list[str] = []
    for paragraph in paragraphs:
        cleaned = paragraph.strip()
        if not cleaned:
            continue
        while len(cleaned) > MAX_BLOCK_CHARS:
            blocks.append(cleaned[:MAX_BLOCK_CHARS].strip())
            cleaned = cleaned[MAX_BLOCK_CHARS:].strip()
        if cleaned:
            blocks.append(cleaned)
    return blocks


def make_blocks(source_id: str, parser_version: str, node: ParsedNode, text: str) -> tuple[ParsedBlock, ...]:
    results = []
    for ordinal, content in enumerate(split_blocks(text), start=1):
        content_hash = sha256(content.encode("utf-8")).hexdigest()
        block_id = stable_id(source_id, parser_version, node.id, ordinal, content_hash)
        results.append(ParsedBlock(
            id=block_id,
            node_id=node.id,
            ordinal=ordinal,
            text=content,
            page_number=node.page_start,
            content_hash=content_hash,
        ))
    return tuple(results)


def finish_outcome(parser_version: str, nodes: list[ParsedNode], blocks: list[ParsedBlock]) -> ParseOutcome:
    blocks_by_node = {node.id: 0 for node in nodes}
    for block in blocks:
        blocks_by_node[block.node_id] += 1
    empty_nodes = sum(count == 0 for count in blocks_by_node.values())
    return ParseOutcome(
        parser_version=parser_version,
        status="needs_review" if empty_nodes else "ready",
        error=f"{empty_nodes} 个章节或页面未提取到文本，请检查原件" if empty_nodes else None,
        nodes=tuple(nodes),
        blocks=tuple(blocks),
        stats={
            "node_count": len(nodes),
            "block_count": len(blocks),
            "empty_nodes": empty_nodes,
            "character_count": sum(len(block.text) for block in blocks),
        },
    )


def parse_plain_text(source_id: str, path: Path) -> ParseOutcome:
    parser_version = "text-v1"
    text = path.read_text(encoding="utf-8-sig")
    node = ParsedNode(stable_id(source_id, parser_version, "document"), "全文", 1, None, None)
    return finish_outcome(parser_version, [node], list(make_blocks(source_id, parser_version, node, text)))


def parse_markdown(source_id: str, path: Path) -> ParseOutcome:
    parser_version = "markdown-v1"
    text = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    sections: list[tuple[str, list[str]]] = []
    title = "导入内容"
    buffer: list[str] = []

    def flush() -> None:
        nonlocal buffer
        if buffer:
            sections.append((title, buffer))
            buffer = []

    for line in text.split("\n"):
        heading = re.match(r"^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$", line)
        if heading:
            flush()
            title = heading.group(2).strip()
        buffer.append(line)
    flush()
    if not sections:
        sections = [("全文", [text])]

    nodes: list[ParsedNode] = []
    blocks: list[ParsedBlock] = []
    for ordinal, (section_title, lines) in enumerate(sections, start=1):
        node = ParsedNode(stable_id(source_id, parser_version, "section", ordinal), section_title, ordinal, None, None)
        nodes.append(node)
        blocks.extend(make_blocks(source_id, parser_version, node, "\n".join(lines)))
    return finish_outcome(parser_version, nodes, blocks)


def parse_pdf(source_id: str, path: Path) -> ParseOutcome:
    parser_version = "pdf-v1"
    reader = PdfReader(path)
    nodes: list[ParsedNode] = []
    blocks: list[ParsedBlock] = []
    for ordinal, page in enumerate(reader.pages, start=1):
        node = ParsedNode(
            stable_id(source_id, parser_version, "page", ordinal),
            f"第 {ordinal} 页",
            ordinal,
            ordinal,
            ordinal,
        )
        nodes.append(node)
        blocks.extend(make_blocks(source_id, parser_version, node, page.extract_text() or ""))
    return finish_outcome(parser_version, nodes, blocks)


def iter_docx_content(document: DocxDocumentType):
    for child in document.element.body.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, document)
        elif isinstance(child, CT_Tbl):
            yield Table(child, document)


def parse_docx(source_id: str, path: Path) -> ParseOutcome:
    parser_version = "docx-v1"
    document = DocxDocument(str(path))
    sections: list[tuple[str, list[str]]] = []
    title = "导入内容"
    buffer: list[str] = []

    def flush() -> None:
        nonlocal buffer
        if buffer:
            sections.append((title, buffer))
            buffer = []

    for item in iter_docx_content(document):
        if isinstance(item, Paragraph):
            text = item.text.strip()
            if not text:
                continue
            style_name = (item.style.name if item.style else "").casefold()
            if style_name.startswith("heading") or style_name.startswith("标题"):
                flush()
                title = text
            buffer.append(text)
        else:
            rows = []
            for row in item.rows:
                cells = [cell.text.strip() for cell in row.cells]
                if any(cells):
                    rows.append("\t".join(cells))
            if rows:
                buffer.append("\n".join(rows))
    flush()
    if not sections:
        sections = [("全文", [])]

    nodes: list[ParsedNode] = []
    blocks: list[ParsedBlock] = []
    for ordinal, (section_title, lines) in enumerate(sections, start=1):
        node = ParsedNode(stable_id(source_id, parser_version, "section", ordinal), section_title, ordinal, None, None)
        nodes.append(node)
        blocks.extend(make_blocks(source_id, parser_version, node, "\n\n".join(lines)))
    return finish_outcome(parser_version, nodes, blocks)


def parse_pptx(source_id: str, path: Path) -> ParseOutcome:
    parser_version = "pptx-v1"
    presentation = Presentation(str(path))
    nodes: list[ParsedNode] = []
    blocks: list[ParsedBlock] = []
    for ordinal, slide in enumerate(presentation.slides, start=1):
        texts: list[str] = []
        for shape in slide.shapes:
            if getattr(shape, "has_text_frame", False) and shape.text.strip():
                texts.append(shape.text.strip())
            if getattr(shape, "has_table", False):
                for row in shape.table.rows:
                    cells = [cell.text.strip() for cell in row.cells]
                    if any(cells):
                        texts.append("\t".join(cells))
        node = ParsedNode(
            stable_id(source_id, parser_version, "slide", ordinal),
            f"第 {ordinal} 页",
            ordinal,
            ordinal,
            ordinal,
        )
        nodes.append(node)
        blocks.extend(make_blocks(source_id, parser_version, node, "\n\n".join(texts)))
    return finish_outcome(parser_version, nodes, blocks)


def parse_image(source_id: str) -> ParseOutcome:
    parser_version = "image-v1"
    node = ParsedNode(stable_id(source_id, parser_version, "page", 1), "第 1 页", 1, 1, 1)
    return finish_outcome(parser_version, [node], [])


def parse_file(source_id: str, path: Path, extension: str) -> ParseOutcome:
    if extension == ".txt":
        return parse_plain_text(source_id, path)
    if extension == ".md":
        return parse_markdown(source_id, path)
    if extension == ".pdf":
        return parse_pdf(source_id, path)
    if extension == ".docx":
        return parse_docx(source_id, path)
    if extension == ".pptx":
        return parse_pptx(source_id, path)
    if extension in {".png", ".jpg", ".jpeg"}:
        return parse_image(source_id)
    raise ValueError(f"{extension} 的内容解析将在后续阶段支持")
