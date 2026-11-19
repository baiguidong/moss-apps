#!/usr/bin/env python3
"""Small managed-runtime PDF text extractor used as a compatibility fallback."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


def normalize(value: str) -> str:
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    value = re.sub(r"(\u3400-\u9fff)[ \t]+(?=[\u3400-\u9fff])", r"\1", value)
    return value.strip()


def extract(path: Path) -> dict:
    from pypdf import PdfReader

    reader = PdfReader(str(path), strict=False)
    pages = []
    for index, page in enumerate(reader.pages, start=1):
        text = normalize(page.extract_text() or "")
        if text:
            pages.append(f"[Page {index}]\n{text}")
    return {"text": "\n\n".join(pages), "pages": len(reader.pages), "extractedPages": len(pages)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", required=True)
    args = parser.parse_args()
    print(json.dumps(extract(Path(args.path)), ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
