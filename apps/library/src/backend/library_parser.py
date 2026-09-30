#!/usr/bin/env python3
"""Moss Library parser worker with a versioned JSON process contract."""

from __future__ import annotations

import argparse
import csv
import importlib.util
import io
import json
import posixpath
import re
import sys
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from xml.etree import ElementTree


TEXT_EXTENSIONS = {
    ".c", ".cc", ".cpp", ".css", ".go", ".h", ".hpp", ".ini",
    ".java", ".js", ".jsx", ".log", ".md", ".markdown", ".mjs",
    ".py", ".rs", ".sh", ".sql", ".toml", ".ts", ".tsx", ".txt",
    ".yaml", ".yml",
}
SCHEMA_VERSION = 1


def normalize_text(value: str) -> str:
    value = value.replace("\x00", " ").replace("\r\n", "\n").replace("\r", "\n")
    value = re.sub(r" +", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def read_text(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in {"script", "style", "noscript"}:
            self.skip_depth += 1
        elif tag in {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript"} and self.skip_depth:
            self.skip_depth -= 1
        elif tag in {"p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.skip_depth:
            self.parts.append(data)


def xml_text(element) -> str:
    return normalize_text(" ".join(text for text in element.itertext() if text))


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def local_attribute(element, name: str) -> str | None:
    return next((value for key, value in element.attrib.items() if local_name(key) == name), None)


def parse_markdown(path: Path) -> tuple[str, list[dict]]:
    lines = read_text(path).replace("\r\n", "\n").replace("\r", "\n").splitlines()
    title = path.stem
    heading_stack: list[str] = []
    current_heading = None
    buffer: list[str] = []
    buffer_start = 1
    in_fence = False
    blocks = []

    def flush(end_line: int) -> None:
        nonlocal buffer
        first = next((index for index, line in enumerate(buffer) if line.strip()), None)
        if first is None:
            buffer = []
            return
        last = len(buffer) - 1
        while last >= first and not buffer[last].strip():
            last -= 1
        content = normalize_text("\n".join(buffer[first:last + 1]))
        if content:
            blocks.append({
                "text": content,
                "page": None,
                "heading": current_heading,
                "startLine": buffer_start + first,
                "endLine": min(end_line, buffer_start + last),
                "locationKind": "line",
            })
        buffer = []

    for line_number, line in enumerate(lines, start=1):
        stripped = line.lstrip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_fence = not in_fence
        heading_match = None if in_fence else re.match(r"^\s*(#{1,6})\s+(.+?)\s*#*\s*$", line)
        if heading_match:
            flush(line_number - 1)
            level = len(heading_match.group(1))
            heading_text = normalize_text(heading_match.group(2))
            heading_stack[level - 1:] = [heading_text]
            current_heading = " > ".join(heading_stack)
            if title == path.stem and level == 1 and heading_text:
                title = heading_text
            buffer_start = line_number + 1
            continue
        if not buffer:
            buffer_start = line_number
        buffer.append(line)
    flush(len(lines))
    if not blocks and current_heading:
        blocks.append({
            "text": current_heading,
            "page": None,
            "heading": current_heading,
            "startLine": 1,
            "endLine": max(1, len(lines)),
            "locationKind": "line",
        })
    return title, blocks


def parse_docx(path: Path) -> list[dict]:
    blocks = []
    heading_stack: list[str] = []
    current_heading = None
    section_parts: list[str] = []
    section_start = 1
    paragraph_index = 0

    def flush() -> None:
        nonlocal section_parts
        content = normalize_text("\n".join(section_parts))
        if content:
            blocks.append({
                "text": content,
                "page": None,
                "heading": current_heading,
                "startLine": section_start,
                "endLine": paragraph_index,
                "locationKind": "paragraph",
            })
        section_parts = []

    with zipfile.ZipFile(path) as archive:
        root = ElementTree.fromstring(archive.read("word/document.xml"))
        for paragraph in root.iter():
            if local_name(paragraph.tag) != "p":
                continue
            text = normalize_text("".join(
                node.text or "" for node in paragraph.iter() if local_name(node.tag) == "t"
            ))
            if not text:
                continue
            style = next((
                local_attribute(node, "val") or ""
                for node in paragraph.iter() if local_name(node.tag) == "pStyle"
            ), "")
            heading_match = re.match(r"^(?:heading|标题)\s*([1-6])$", style, re.IGNORECASE)
            if heading_match or style.lower() in {"title", "标题"}:
                flush()
                paragraph_index += 1
                section_start = paragraph_index
                level = int(heading_match.group(1)) if heading_match else 1
                heading_stack[level - 1:] = [text]
                current_heading = " > ".join(heading_stack)
                section_parts.append(text)
            else:
                paragraph_index += 1
                if not section_parts:
                    section_start = paragraph_index
                section_parts.append(text)
        flush()
    return blocks


def parse_pptx(path: Path) -> list[dict]:
    blocks = []
    with zipfile.ZipFile(path) as archive:
        slide_names = sorted(
            (
                name for name in archive.namelist()
                if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)
            ),
            key=lambda name: int(re.search(r"slide(\d+)\.xml$", name).group(1)),
        )
        for page, name in enumerate(slide_names, start=1):
            root = ElementTree.fromstring(archive.read(name))
            lines = []
            title_candidates = []
            for shape in root.iter():
                if local_name(shape.tag) != "sp":
                    continue
                shape_lines = [
                    normalize_text(node.text or "")
                    for node in shape.iter()
                    if local_name(node.tag) == "t" and normalize_text(node.text or "")
                ]
                lines.extend(shape_lines)
                placeholder_type = next((
                    local_attribute(node, "type") or ""
                    for node in shape.iter() if local_name(node.tag) == "ph"
                ), "")
                if placeholder_type in {"title", "ctrTitle"}:
                    title_candidates.extend(shape_lines)
            if not lines:
                lines = [
                    normalize_text(node.text or "")
                    for node in root.iter()
                    if local_name(node.tag) == "t" and normalize_text(node.text or "")
                ]
            text = normalize_text("\n".join(lines))
            if text:
                title_line = title_candidates[0] if title_candidates else (lines[0] if lines else "")
                heading = title_line if title_line and len(title_line) <= 160 else f"Slide {page}"
                blocks.append({
                    "text": text,
                    "page": page,
                    "heading": heading,
                    "locationKind": "slide",
                })
    return blocks


def spreadsheet_cell_value(cell, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t", "")
    value = next((node.text or "" for node in cell if local_name(node.tag) == "v"), "")
    if cell_type == "s" and value.isdigit():
        index = int(value)
        return shared_strings[index] if index < len(shared_strings) else value
    if cell_type == "inlineStr":
        return xml_text(cell)
    return value


def parse_xlsx(path: Path) -> list[dict]:
    blocks = []
    with zipfile.ZipFile(path) as archive:
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
            shared_strings = [xml_text(node) for node in root if local_name(node.tag) == "si"]

        sheet_paths = sorted((
            name for name in archive.namelist()
            if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name)
        ), key=lambda name: int(re.search(r"sheet(\d+)\.xml$", name).group(1)))
        sheet_entries = []
        if "xl/workbook.xml" in archive.namelist():
            workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
            relationships = {}
            relationships_path = "xl/_rels/workbook.xml.rels"
            if relationships_path in archive.namelist():
                relationships_root = ElementTree.fromstring(archive.read(relationships_path))
                relationships = {
                    local_attribute(node, "Id") or "": local_attribute(node, "Target") or ""
                    for node in relationships_root.iter() if local_name(node.tag) == "Relationship"
                }
            for sheet in workbook.iter():
                if local_name(sheet.tag) != "sheet":
                    continue
                title = local_attribute(sheet, "name") or ""
                relationship_id = local_attribute(sheet, "id") or ""
                target = relationships.get(relationship_id, "")
                if target:
                    target = target.replace("\\", "/").lstrip("/")
                    normalized_target = posixpath.normpath(
                        target if target.startswith("xl/") else posixpath.join("xl", target)
                    )
                    if normalized_target in archive.namelist():
                        sheet_entries.append((normalized_target, title))
            if not sheet_entries:
                sheet_titles = [
                    local_attribute(node, "name") or ""
                    for node in workbook.iter() if local_name(node.tag) == "sheet"
                ]
                sheet_entries = [
                    (name, sheet_titles[index] if index < len(sheet_titles) else "")
                    for index, name in enumerate(sheet_paths)
                ]
        if not sheet_entries:
            sheet_entries = [(name, "") for name in sheet_paths]
        for page, (name, declared_title) in enumerate(sheet_entries, start=1):
            root = ElementTree.fromstring(archive.read(name))
            rows = []
            row_numbers = []
            for row in root.iter():
                if local_name(row.tag) != "row":
                    continue
                values = [
                    spreadsheet_cell_value(cell, shared_strings)
                    for cell in row if local_name(cell.tag) == "c"
                ]
                if any(values):
                    rows.append("\t".join(values))
                    declared_row = local_attribute(row, "r") or ""
                    row_numbers.append(int(declared_row) if declared_row.isdigit() else len(row_numbers) + 1)
            text = normalize_text("\n".join(rows))
            if text:
                heading = declared_title or f"Sheet {page}"
                blocks.append({
                    "text": text,
                    "page": page,
                    "heading": heading,
                    "startLine": row_numbers[0] if row_numbers else None,
                    "endLine": row_numbers[-1] if row_numbers else None,
                    "locationKind": "sheet",
                })
    return blocks


def parse_pdf(path: Path) -> list[dict]:
    try:
        from pypdf import PdfReader  # type: ignore

        return [
            {"text": text, "page": index, "heading": f"Page {index}", "locationKind": "page"}
            for index, page in enumerate(PdfReader(str(path)).pages, start=1)
            if (text := normalize_text(page.extract_text() or ""))
        ]
    except ImportError as error:
        raise RuntimeError("The bundled pypdf dependency is unavailable. Reinstall the knowledge App.") from error


def parse_csv(path: Path) -> list[dict]:
    content = read_text(path)
    rows = []
    for row in csv.reader(io.StringIO(content)):
        rows.append("\t".join(row))
    return [{
        "text": normalize_text("\n".join(rows)),
        "page": None,
        "heading": None,
        "startLine": 1,
        "endLine": max(1, len(rows)),
        "locationKind": "row",
    }]


def parse_document(path: Path) -> dict:
    extension = path.suffix.lower()
    if extension in {".md", ".markdown"}:
        title, blocks = parse_markdown(path)
        parser = "stdlib-markdown"
    elif extension in TEXT_EXTENSIONS:
        content = normalize_text(read_text(path))
        blocks = [{
            "text": content,
            "page": None,
            "heading": None,
            "startLine": 1,
            "endLine": max(1, content.count("\n") + 1),
            "locationKind": "line",
        }]
        parser = "stdlib-text"
    elif extension == ".json":
        raw_content = read_text(path)
        value = json.loads(raw_content)
        blocks = [{
            "text": json.dumps(value, ensure_ascii=False, indent=2),
            "page": None,
            "heading": None,
            "startLine": 1,
            "endLine": max(1, raw_content.count("\n") + 1),
            "locationKind": "line",
        }]
        parser = "stdlib-json"
    elif extension == ".csv":
        blocks = parse_csv(path)
        parser = "stdlib-csv"
    elif extension in {".html", ".htm", ".xml"}:
        extractor = TextExtractor()
        extractor.feed(read_text(path))
        parsed_text = normalize_text("".join(extractor.parts))
        blocks = [{
            "text": parsed_text,
            "page": None,
            "heading": None,
            "startLine": 1,
            "endLine": max(1, parsed_text.count("\n") + 1),
            "locationKind": "line",
        }]
        parser = "stdlib-html"
    elif extension == ".docx":
        blocks = parse_docx(path)
        parser = "stdlib-docx"
    elif extension == ".pptx":
        blocks = parse_pptx(path)
        parser = "stdlib-pptx"
    elif extension == ".xlsx":
        blocks = parse_xlsx(path)
        parser = "stdlib-xlsx"
    elif extension == ".pdf":
        blocks = parse_pdf(path)
        parser = "pdf"
    else:
        raise RuntimeError(f"Unsupported Library document type: {extension or '(none)'}")

    blocks = [block for block in blocks if block.get("text")]
    if not blocks:
        raise RuntimeError("The document parser returned no readable text.")
    if extension not in {".md", ".markdown"}:
        title = path.stem
        if extension == ".docx" and blocks and blocks[0].get("heading"):
            first_heading = str(blocks[0]["heading"]).split(" > ", 1)[0]
            if first_heading and len(first_heading) <= 160:
                title = first_heading
    return {
        "title": title,
        "titleFromContent": title != path.stem,
        "blocks": blocks,
        "parser": parser,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Moss Library parser worker")
    commands = parser.add_subparsers(dest="operation", required=True)
    ingest = commands.add_parser("ingest-resource")
    ingest.add_argument("--path", required=True)
    commands.add_parser("doctor")
    args = parser.parse_args()
    if args.operation == "doctor":
        package_names = ["pypdf"]
        payload = {
            "python": sys.version.split()[0],
            "operations": ["doctor", "ingest-resource"],
            "packages": {
                name: importlib.util.find_spec(name) is not None
                for name in package_names
            },
        }
    else:
        path = Path(args.path).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError("Document does not exist or is not a file.")
        payload = parse_document(path)
    print(json.dumps({
        "schemaVersion": SCHEMA_VERSION,
        "operation": args.operation,
        "ok": True,
        "payload": payload,
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        operation = sys.argv[1] if len(sys.argv) > 1 else "unknown"
        if isinstance(error, FileNotFoundError):
            code = "DOCUMENT_NOT_FOUND"
        elif str(error).startswith("Unsupported Library document type"):
            code = "UNSUPPORTED_TYPE"
        else:
            code = "PARSER_ERROR"
        print(json.dumps({
            "schemaVersion": SCHEMA_VERSION,
            "operation": operation,
            "ok": False,
            "error": {"code": code, "message": str(error)},
        }, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
