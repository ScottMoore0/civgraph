#!/usr/bin/env python
import json
import sys
from pathlib import Path

from pypdf import PdfReader


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: extract-pdf-text.py <pdf-path>", file=sys.stderr)
        return 2

    pdf_path = Path(sys.argv[1])
    reader = PdfReader(str(pdf_path))
    pages = []
    for index, page in enumerate(reader.pages, start=1):
        pages.append({
            "page": index,
            "text": page.extract_text() or "",
        })

    print(json.dumps({
        "path": str(pdf_path),
        "pages": pages,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
