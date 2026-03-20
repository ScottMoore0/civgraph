"""
Extract text from all NI Census PDFs using PyMuPDF (fitz).
Saves each PDF as a markdown file with page markers.
"""

import fitz  # PyMuPDF
import os
import re
import time

BASE_DIR = r"C:\Users\scomo\boundaries-website"
OUTPUT_DIR = os.path.join(BASE_DIR, "data", "census")

# PDF filename -> output markdown filename
PDF_MAP = {
    "1926-census-combined-part-1.pdf": "census-1926-part-1.md",
    "1926-census-combined-part-2.pdf": "census-1926-part-2.md",
    "1937-census-part-1.pdf": "census-1937-part-1.md",
    "1937-census-part-2.pdf": "census-1937-part-2.md",
    "1951-census-part-1.pdf": "census-1951-part-1.md",
    "1951-census-part-2.pdf": "census-1951-part-2.md",
    "1961-census-part-1.pdf": "census-1961-part-1.md",
    "1961-census-part-2.pdf": "census-1961-part-2.md",
    "1966-census-all-combined.pdf": "census-1966.md",
    "1971-census-all-combined.pdf": "census-1971.md",
    "1981-census-all-combined.pdf": "census-1981.md",
}


def clean_text(text):
    """Clean extracted text: normalize whitespace, preserve structure."""
    # Replace multiple blank lines with double newline
    text = re.sub(r'\n{4,}', '\n\n\n', text)
    # Remove trailing whitespace on each line
    lines = [line.rstrip() for line in text.split('\n')]
    return '\n'.join(lines)


def looks_like_table_row(line):
    """Heuristic: line has multiple number groups separated by spaces -> table row."""
    # At least 3 number groups in a line
    nums = re.findall(r'\d[\d,]+', line)
    return len(nums) >= 3


def format_page_text(text):
    """Try to identify tabular sections and format them."""
    lines = text.split('\n')
    output = []
    in_table = False
    table_start = False

    for line in lines:
        stripped = line.strip()
        if not stripped:
            if in_table:
                in_table = False
                output.append('')  # end table block
            output.append('')
            continue

        if looks_like_table_row(stripped):
            if not in_table:
                in_table = True
                # Add a blank line before table for readability
                if output and output[-1] != '':
                    output.append('')
            # Keep line as-is (monospace in markdown via context)
            output.append('    ' + line)  # indent for code-like display
        else:
            if in_table:
                in_table = False
            output.append(line)

    return '\n'.join(output)


def extract_pdf(pdf_path, output_path):
    """Extract all text from a PDF and write to markdown."""
    start = time.time()
    pdf_name = os.path.basename(pdf_path)
    print(f"Processing: {pdf_name}")

    doc = fitz.open(pdf_path)
    page_count = len(doc)
    print(f"  Pages: {page_count}")

    with open(output_path, 'w', encoding='utf-8') as f:
        # Header
        f.write(f"# {pdf_name}\n\n")
        f.write(f"Total pages: {page_count}\n\n---\n\n")

        for i, page in enumerate(doc):
            page_num = i + 1
            text = page.get_text()

            if text.strip():
                cleaned = clean_text(text)
                formatted = format_page_text(cleaned)
                f.write(f"## Page {page_num}\n\n")
                f.write(formatted)
                f.write('\n\n---\n\n')
            else:
                f.write(f"## Page {page_num}\n\n")
                f.write('*(blank or image-only page)*\n\n---\n\n')

            if page_num % 100 == 0:
                print(f"  ...page {page_num}/{page_count}")

    doc.close()
    elapsed = time.time() - start
    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"  Done: {output_path} ({size_mb:.1f} MB, {elapsed:.1f}s)")
    return page_count


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    total_pages = 0
    total_start = time.time()

    for pdf_name, md_name in PDF_MAP.items():
        pdf_path = os.path.join(BASE_DIR, pdf_name)
        output_path = os.path.join(OUTPUT_DIR, md_name)

        if not os.path.exists(pdf_path):
            print(f"MISSING: {pdf_path}")
            continue

        pages = extract_pdf(pdf_path, output_path)
        total_pages += pages

    total_elapsed = time.time() - total_start
    print(f"\nAll done! {total_pages} pages extracted in {total_elapsed:.1f}s")


if __name__ == "__main__":
    main()
