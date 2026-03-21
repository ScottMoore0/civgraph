#!/usr/bin/env python
"""Validate and relabel local-election SPN files by poll-date year.

This targets the modern `2019_local_*` and `2023_local_*` directories where
some council archive URLs serve the same underlying document for both years.
The script extracts text where possible, detects the poll year, and moves files
to the matching year directory when the current directory year is wrong.
"""

from __future__ import annotations

import json
import re
import shutil
from collections import Counter
from pathlib import Path
from zipfile import ZipFile

try:
    from PyPDF2 import PdfReader
except Exception:  # pragma: no cover
    PdfReader = None


BASE = Path("C:/Users/scomo/boundaries-website")
SPN_BASE = BASE / "_tmp_eoni_spn"
REPORT_PATH = BASE / "_tmp_spn_year_validation.json"
TARGET_DIR_PATTERN = re.compile(r"^(2019|2023)_local_")


def extract_pdf_text(path: Path) -> str:
    if PdfReader is None:
        return ""
    try:
        reader = PdfReader(str(path))
        return "\n".join((page.extract_text() or "") for page in reader.pages[:3])
    except Exception:
        return ""


def extract_docx_text(path: Path) -> str:
    try:
        with ZipFile(path) as zf:
            data = zf.read("word/document.xml").decode("utf-8", errors="replace")
    except Exception:
        return ""
    return re.sub(r"<[^>]+>", " ", data)


def extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return extract_pdf_text(path)
    if suffix == ".docx":
        return extract_docx_text(path)
    return ""


def detect_year(text: str) -> int | None:
    normalized = re.sub(r"\s+", " ", text)
    patterns = [
        r"Date of Poll\s+\w+\s+(\d{1,2}\s+\w+\s+(20\d{2}))",
        r"poll will be held on\s+\w+\s+(\d{1,2}\s+\w+\s+(20\d{2}))",
        r"(\d{1,2}\s+\w+\s+(2019|2023))",
        r"(2019|2023)\s+Local Council Elections",
    ]
    for pattern in patterns:
        match = re.search(pattern, normalized, re.IGNORECASE)
        if not match:
            continue
        for group in reversed(match.groups()):
            if group and re.fullmatch(r"20\d{2}", group):
                return int(group)
    return None


def move_to_year_dir(path: Path, target_year: int) -> Path:
    current_dir = path.parent
    target_dir = current_dir.parent / current_dir.name.replace(current_dir.name[:4], str(target_year), 1)
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / path.name
    if target_path.exists():
        stem = path.stem
        suffix = path.suffix
        counter = 2
        while True:
            candidate = target_dir / f"{stem}__dupe{counter}{suffix}"
            if not candidate.exists():
                target_path = candidate
                break
            counter += 1
    shutil.move(str(path), str(target_path))
    return target_path


def main():
    report: list[dict] = []
    year_counts = Counter()
    moved = 0

    for directory in sorted(SPN_BASE.iterdir()):
        if not directory.is_dir() or not TARGET_DIR_PATTERN.match(directory.name):
            continue
        expected_year = int(directory.name[:4])
        for path in sorted(directory.iterdir()):
            if not path.is_file() or path.suffix.lower() not in {".pdf", ".docx"}:
                continue
            text = extract_text(path)
            detected_year = detect_year(text) if text else None
            record = {
                "file": str(path.relative_to(BASE)),
                "expected_year": expected_year,
                "detected_year": detected_year,
                "text_length": len(text),
                "action": "none",
            }
            if detected_year is not None:
                year_counts[detected_year] += 1
                if detected_year != expected_year:
                    new_path = move_to_year_dir(path, detected_year)
                    moved += 1
                    record["action"] = "moved"
                    record["moved_to"] = str(new_path.relative_to(BASE))
            report.append(record)

    payload = {
        "scanned_files": len(report),
        "moved_files": moved,
        "detected_year_counts": dict(sorted(year_counts.items())),
        "files": report,
    }
    REPORT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
