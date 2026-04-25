#!/usr/bin/env python
"""Extract one sheet from a NISRA Census 2021 XLSX into a clean CSV
suitable for the data-entry runtime joiner.

NISRA's Main Statistics XLSXs follow a consistent pattern: each sheet has
~5 metadata rows at the top (table name, population, geographic level,
source, blurb), then a header row whose first three columns are
'Geography', 'Geography code', and the actual statistic, then data rows.

Usage: build_census_data_entries.py — runs the manifest below.
"""
import csv
import re
import unicodedata
from pathlib import Path
from openpyxl import load_workbook

REPO = Path(__file__).resolve().parent.parent
SRC_DIR = REPO / "data" / "census" / "2021"
OUT_DIR = REPO / "data" / "census" / "derived"
OUT_DIR.mkdir(parents=True, exist_ok=True)

PHASE1 = SRC_DIR / "census-2021-main-statistics-for-northern-ireland-phase-1-all-tables (2)"

# (xlsx_filename, sheet, csv_out, value_in, value_out)
MANIFEST = [
    # MS-A01 — Usual resident population, all geographies
    ("census-2021-ms-a01.xlsx", "DZ",         "ms-a01-dz.csv",         "All usual residents", "AllUsualResidents"),
    ("census-2021-ms-a01.xlsx", "SDZ",        "ms-a01-sdz.csv",        "All usual residents", "AllUsualResidents"),
    ("census-2021-ms-a01.xlsx", "Settlement", "ms-a01-settlement.csv", "All usual residents", "AllUsualResidents"),
    ("census-2021-ms-a01.xlsx", "Ward",       "ms-a01-ward.csv",       "All usual residents", "AllUsualResidents"),
    ("census-2021-ms-a01.xlsx", "DEA",        "ms-a01-dea.csv",        "All usual residents", "AllUsualResidents"),
    # LGD already exists; NI is a single value, fine to skip in the manifest.
]

def extract_sheet(xlsx_path: Path, sheet: str, out_csv: Path,
                  value_in: str, value_out: str):
    wb = load_workbook(xlsx_path, data_only=True, read_only=True)
    if sheet not in wb.sheetnames:
        print(f"  ! {sheet} not in {xlsx_path.name}; available: {wb.sheetnames}")
        return 0
    ws = wb[sheet]
    rows = list(ws.iter_rows(values_only=True))

    # Find the header row: first row whose first cell is exactly 'Geography'
    header_idx = next((i for i, r in enumerate(rows)
                       if r and r[0] and str(r[0]).strip().lower() == "geography"), None)
    if header_idx is None:
        print(f"  ! no header row in {xlsx_path.name}/{sheet}")
        return 0

    header = [str(c).strip() if c is not None else "" for c in rows[header_idx]]
    name_col = header.index("Geography")
    code_col = next((i for i, h in enumerate(header)
                     if h.strip().lower() in ("geography code", "geography_code")), None)
    val_col = next((i for i, h in enumerate(header) if h == value_in), None)
    if code_col is None or val_col is None:
        print(f"  ! header missing required columns in {sheet}: have {header}")
        return 0

    data_rows = []
    for r in rows[header_idx + 1:]:
        if not r: continue
        name = r[name_col]
        if name is None or str(name).startswith(("Geographic", "Note", "Source")):
            continue
        code = r[code_col]
        val = r[val_col]
        if name is None or code is None: continue
        data_rows.append([
            str(name).strip(),
            str(code).strip(),
            "" if val is None else str(val).strip()
        ])

    out_csv.parent.mkdir(parents=True, exist_ok=True)
    with out_csv.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Geography", "GeographyCode", value_out])
        w.writerows(data_rows)
    return len(data_rows)

def main():
    for fn, sheet, out_name, val_in, val_out in MANIFEST:
        src = PHASE1 / fn
        out = OUT_DIR / out_name
        if not src.exists():
            print(f"  ! source missing: {src}")
            continue
        n = extract_sheet(src, sheet, out, val_in, val_out)
        print(f"  {fn} [{sheet}] -> {out.name}  ({n} rows)")

if __name__ == "__main__":
    main()
