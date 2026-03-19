#!/usr/bin/env python
"""Extract all candidate full names from the ARK election spreadsheets.

Produces a JSON mapping of (normalised_short_name, constituency, date) -> full_name
for use in PersonID deduplication.
"""

import json
import os
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

import xlrd


def norm(name):
    if not name: return ""
    nfkd = unicodedata.normalize("NFKD", name)
    stripped = "".join(c for c in nfkd if not unicodedata.combining(c))
    lowered = stripped.lower()
    lowered = re.sub(r"[^a-z0-9 '\-]", " ", lowered)
    return re.sub(r"\s+", " ", lowered).strip()


def normalize_space(v):
    return re.sub(r"\s+", " ", str(v or "")).strip()


def parse_ark_candidate_name(raw: str) -> tuple[str, str]:
    """Parse 'Surname, Firstname Middle' -> (display_name, full_name)."""
    raw = normalize_space(raw)
    if not raw:
        return ("", "")
    if "," in raw:
        last, rest = raw.split(",", 1)
        last = last.strip()
        first_full = rest.strip()
        display = f"{first_full} {last}"
        return (display, display)
    return (raw, raw)


def infer_date_from_path(path: Path) -> str:
    """Infer election date from file path."""
    # The directory name is the year
    parts = str(path).replace("\\", "/").split("/")
    for part in reversed(parts):
        m = re.match(r"^(19\d{2}|20\d{2})$", part)
        if m:
            return m.group(1)
        # Try 1974f, 1974o patterns
        m = re.match(r"^(19\d{2}|20\d{2})[a-z]$", part)
        if m:
            return m.group(1)
    return ""


def infer_body_from_path(path: Path) -> str:
    s = str(path).replace("\\", "/").lower()
    if "/wster/" in s: return "westminster"
    if "/asby/" in s: return "assembly"
    if "/lgov/" in s: return "local_government"
    if "/euro/" in s: return "european"
    if "/conv/" in s: return "convention"
    if "/1996/" in s: return "forum"
    return "unknown"


def infer_constituency_from_path(path: Path) -> str:
    stem = path.stem
    # Strip prefixes like ws10-, as11-, lg05-BT-, eu04-, cc75-
    cleaned = re.sub(r"^[a-z]{2}\d{2}-", "", stem)
    cleaned = re.sub(r"^[A-Z]{2,3}-", "", cleaned)
    return cleaned.replace("-", " ").strip()


def extract_candidates_from_xls(path: Path) -> list[dict]:
    """Extract candidate names from an ARK .xls file."""
    candidates = []
    try:
        wb = xlrd.open_workbook(str(path))
    except Exception:
        return candidates

    sh = wb.sheet_by_index(0)
    year = infer_date_from_path(path)
    body = infer_body_from_path(path)
    constituency = infer_constituency_from_path(path)

    # Find the candidate rows — look for rows with a number in column 1
    # and a name in column 2 (format: "Surname, Firstname")
    for r in range(sh.nrows):
        try:
            number = sh.cell_value(r, 1) if sh.ncols > 1 else None
            name_raw = str(sh.cell_value(r, 2)).strip() if sh.ncols > 2 else ""
            desc = str(sh.cell_value(r, 3)).strip() if sh.ncols > 3 else ""
        except Exception:
            continue

        # Skip non-candidate rows
        if not name_raw or not isinstance(number, float):
            continue
        if "non-transferable" in name_raw.lower() or "total" in name_raw.lower():
            continue

        display_name, full_name = parse_ark_candidate_name(name_raw)
        if not display_name:
            continue

        candidates.append({
            "full_name": full_name,
            "display_name": display_name,
            "party": desc,
            "year": year,
            "body": body,
            "constituency": constituency,
            "source_file": str(path),
        })

    return candidates


def main():
    ark_dir = Path("_tmp_ark_xls/xls")
    print(f"Scanning {ark_dir}...")

    all_candidates = []
    file_count = 0
    for xls_path in sorted(ark_dir.rglob("*.xls")):
        candidates = extract_candidates_from_xls(xls_path)
        all_candidates.extend(candidates)
        file_count += 1

    print(f"Processed {file_count} files, found {len(all_candidates)} candidate records")

    # Build lookup: norm(short_name) -> set of full names seen
    name_lookup: dict[str, set[str]] = defaultdict(set)
    # Also build: norm(full_name) -> full_name (for display)
    full_name_display: dict[str, str] = {}

    for c in all_candidates:
        full = c["full_name"]
        if not full:
            continue

        # The "short name" is what our workbook has (usually "Firstname Lastname")
        # The ARK full name may have middle names
        parts = full.split()
        if len(parts) >= 2:
            # Short name = first + last
            short = f"{parts[0]} {parts[-1]}"
            n = norm(short)
            name_lookup[n].add(full)
            full_name_display[norm(full)] = full

            # Also index by full normalised name
            nf = norm(full)
            name_lookup[nf].add(full)

    # Save the full candidate list and lookup
    Path("_tmp_ark_candidates.json").write_text(
        json.dumps(all_candidates, indent=1, ensure_ascii=False), encoding="utf-8")

    # Convert sets to lists for JSON
    lookup_json = {k: sorted(v) for k, v in name_lookup.items() if len(v) >= 1}
    Path("_tmp_ark_name_lookup.json").write_text(
        json.dumps(lookup_json, indent=1, ensure_ascii=False), encoding="utf-8")

    # Stats
    print(f"\nName lookup entries: {len(lookup_json)}")
    multi = {k: v for k, v in lookup_json.items() if len(v) > 1}
    print(f"Names with multiple full forms: {len(multi)}")

    # Show examples of disambiguating names
    print("\nExamples of names with multiple full forms (useful for disambiguation):")
    for k in sorted(multi.keys())[:20]:
        print(f"  '{k}': {multi[k]}")

    # Specifically check Mark Durkan
    print("\nMark Durkan entries:")
    for k, v in lookup_json.items():
        if "durkan" in k and "mark" in k:
            print(f"  '{k}': {v}")


if __name__ == "__main__":
    main()
