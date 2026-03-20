"""Batch convert Gazette PDFs to Markdown text files using PyMuPDF."""
import fitz
import os
import sys
from pathlib import Path

BASE = Path(r"C:/Users/scomo/boundaries-website")
SRC = BASE / "_tmp_gazette"
DST = BASE / "_tmp_gazette_markdown"

SUBDIRS = [
    "belfast_spn",
    "belfast_spn_extra",
    "london_spn",
    "belfast_expenses",
    "belfast_polling_stations",
]

total = 0
errors = 0

for subdir in SUBDIRS:
    src_dir = SRC / subdir
    dst_dir = DST / subdir
    dst_dir.mkdir(parents=True, exist_ok=True)

    pdfs = sorted(src_dir.glob("*.pdf"))
    print(f"{subdir}: {len(pdfs)} PDFs")

    for pdf_path in pdfs:
        md_path = dst_dir / (pdf_path.stem + ".md")
        try:
            doc = fitz.open(str(pdf_path))
            page_count = len(doc)
            pages_text = []
            for page in doc:
                pages_text.append(page.get_text())
            doc.close()

            with open(md_path, "w", encoding="utf-8") as f:
                f.write(f"# {pdf_path.name}\n\n")
                f.write(f"- **Source**: `{subdir}/{pdf_path.name}`\n")
                f.write(f"- **Pages**: {page_count}\n\n---\n\n")
                for i, text in enumerate(pages_text, 1):
                    if page_count > 1:
                        f.write(f"## Page {i}\n\n")
                    f.write(text.strip() + "\n\n")
            total += 1
        except Exception as e:
            errors += 1
            print(f"  ERROR {pdf_path.name}: {e}")

print(f"\nDone: {total} converted, {errors} errors")
