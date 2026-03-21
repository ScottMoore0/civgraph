#!/usr/bin/env python
"""Clean OCR text from NI Parliamentary Debates (HathiTrust).

Pass 1: Automated fixes for predictable OCR errors.
- Rejoin words broken by hyphen + line break
- Remove standalone number lines (page/column headers)
- Remove zero-width spaces
- Normalise bullet/middle-dot OCR artefacts
- Strip trailing whitespace
- Collapse excessive blank lines
"""

import os
import re
import sys
from pathlib import Path


def clean_text(text: str) -> str:
    """Apply all automated OCR corrections to a page of text."""
    if len(text) < 10:
        return text

    # 1. Remove zero-width spaces
    text = text.replace("\u200b", "")

    # 2. Rejoin words broken by hyphen at line end
    # e.g. "Parlia-\nment" -> "Parliament"
    # But preserve intentional hyphens (e.g. "well-\nknown" should become "well-known")
    # Strategy: rejoin if next line starts with lowercase
    text = re.sub(r"(\w)-\n(\s*)([a-z])", lambda m: m.group(1) + m.group(3), text)

    # 3. Remove standalone number lines (page/column headers/footers)
    # Lines that are just 1-4 digits, possibly with spaces
    text = re.sub(r"^\s*\d{1,4}\s*$", "", text, flags=re.MULTILINE)

    # 4. Replace middle dot (·) OCR artefacts with nothing or period
    # Context: often appears as noise between words
    text = text.replace("\u00b7", ".")

    # 5. Replace bullet (•) OCR artefacts
    # These are often misread periods or colons
    # Keep if at start of line (may be intentional list marker)
    text = re.sub(r"(?<!^)\u2022", ".", text, flags=re.MULTILINE)

    # 6. Normalise dashes: horizontal bar (U+2015) to em dash
    text = text.replace("\u2015", "\u2014")

    # 7. Strip trailing whitespace from each line
    text = re.sub(r" +$", "", text, flags=re.MULTILINE)

    # 8. Collapse 3+ consecutive blank lines to 2
    text = re.sub(r"\n{4,}", "\n\n\n", text)

    # 9. Remove leading/trailing whitespace from entire text
    text = text.strip()

    return text


def process_directory(base_dir: str, dry_run: bool = False):
    """Process all .txt files under base_dir."""
    txt_files = []
    for root, dirs, files in os.walk(base_dir):
        for f in files:
            if f.endswith(".txt"):
                txt_files.append(os.path.join(root, f))

    print(f"Processing {len(txt_files)} text files...")

    stats = {
        "files_processed": 0,
        "files_modified": 0,
        "files_skipped": 0,
        "hyphens_rejoined": 0,
        "header_lines_removed": 0,
        "zero_width_removed": 0,
        "chars_before": 0,
        "chars_after": 0,
    }

    for path in txt_files:
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                original = fh.read()
        except Exception:
            stats["files_skipped"] += 1
            continue

        stats["files_processed"] += 1
        stats["chars_before"] += len(original)

        if len(original) < 10:
            stats["files_skipped"] += 1
            stats["chars_after"] += len(original)
            continue

        # Count specific fixes for stats
        stats["hyphens_rejoined"] += len(re.findall(r"(\w)-\n\s*([a-z])", original))
        stats["header_lines_removed"] += len(re.findall(r"^\s*\d{1,4}\s*$", original, re.MULTILINE))
        stats["zero_width_removed"] += original.count("\u200b")

        cleaned = clean_text(original)
        stats["chars_after"] += len(cleaned)

        if cleaned != original:
            stats["files_modified"] += 1
            if not dry_run:
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(cleaned)

    return stats


if __name__ == "__main__":
    base = sys.argv[1] if len(sys.argv) > 1 else "."
    dry_run = "--dry-run" in sys.argv

    if dry_run:
        print("DRY RUN — no files will be modified")

    stats = process_directory(base, dry_run=dry_run)

    print(f"\nResults:")
    print(f"  Files processed:     {stats['files_processed']:,}")
    print(f"  Files modified:      {stats['files_modified']:,}")
    print(f"  Files skipped:       {stats['files_skipped']:,}")
    print(f"  Hyphens rejoined:    {stats['hyphens_rejoined']:,}")
    print(f"  Header lines removed:{stats['header_lines_removed']:,}")
    print(f"  Zero-width removed:  {stats['zero_width_removed']:,}")
    print(f"  Chars before:        {stats['chars_before']:,}")
    print(f"  Chars after:         {stats['chars_after']:,}")
    print(f"  Chars saved:         {stats['chars_before'] - stats['chars_after']:,}")
