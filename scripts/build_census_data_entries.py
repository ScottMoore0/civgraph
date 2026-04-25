#!/usr/bin/env python
"""Extract NISRA Census 2021 XLSX sheets into clean CSVs for the data-entry runtime.

NISRA's Main Statistics XLSXs follow a consistent pattern: each sheet has
~5 metadata rows at the top (table name, population, geographic level,
source, blurb), then a header row whose first three columns are
'Geography', 'Geography code', and the actual statistic, then data rows.
Many sheets contain *two* sub-tables stacked vertically: an "(a) count"
sub-table on top and a "(b) area percentage" sub-table below, separated
by a blank row and a section label. Both sub-tables use an identical
column layout but the percentage table stores values as fractions in
[0,1].

Usage: build_census_data_entries.py — runs the manifest below.
"""
import csv
from pathlib import Path
from openpyxl import load_workbook

REPO = Path(__file__).resolve().parent.parent
SRC_DIR = REPO / "data" / "census" / "2021"
OUT_DIR = REPO / "data" / "census" / "derived"
OUT_DIR.mkdir(parents=True, exist_ok=True)

PHASE1 = SRC_DIR / "census-2021-main-statistics-for-northern-ireland-phase-1-all-tables (2)"


def _kv_count(in_name, out_name):
    return {"section": "count", "in": in_name, "out": out_name}

def _kv_pct(in_name, out_name):
    return {"section": "percent", "in": in_name, "out": out_name}

# Manifest entries are dicts:
#   {xlsx, sheet, csv, values: [{section, in, out}, ...]}
# `section` is "count" (first sub-table) or "percent" (second sub-table).
# Sheets that do not have a paired percent sub-table simply omit those rows.
MANIFEST = []

def _add(xlsx, csv_name, values, sheets):
    for sh in sheets:
        # Filenames stay flat: ms-XX-{geog}.csv
        geog_slug = sh.lower()
        out = csv_name.replace("{geog}", geog_slug)
        MANIFEST.append({
            "xlsx": xlsx, "sheet": sh, "csv": out, "values": values,
        })

# === Tier 1 (single-value, no percentages) =================================
_add("census-2021-ms-a01.xlsx", "ms-a01-{geog}.csv",
     [_kv_count("All usual residents", "AllUsualResidents")],
     ["DZ", "SDZ", "Settlement", "Ward", "DEA"])  # LGD has legacy header, leave alone

_add("census-2021-ms-a14.xlsx", "ms-a14-{geog}.csv",
     [_kv_count("Population density (number of usual residents per hectare)", "PopulationDensity")],
     ["DZ", "SDZ", "DEA", "LGD"])

_add("census-2021-ms-e01.xlsx", "ms-e01-{geog}.csv",
     [_kv_count("All households", "AllHouseholds")],
     ["DZ", "SDZ", "Settlement", "Ward", "DEA", "LGD"])

_add("census-2021-ms-e02.xlsx", "ms-e02-{geog}.csv",
     [_kv_count("Average household size\n[note 1]", "AverageHouseholdSize")],
     ["DZ", "SDZ", "Settlement", "Ward", "DEA", "LGD"])

# === Tier 2 (count + percent, paired sub-tables) ===========================

# MS-A07 — Sex
_add("census-2021-ms-a07.xlsx", "ms-a07-female-{geog}.csv",
     [_kv_count("All usual residents", "Total"),
      _kv_count("Female", "Female"),
      _kv_pct("Female", "Female_pct")],
     ["Settlement", "Ward", "LGD"])

# MS-A16 — Country of birth (basic). Headline metric: % born in NI.
# NISRA nests the geography column as "Europe: \nUnited Kingdom:\n Northern Ireland".
_NI_BORN = "Europe: \nUnited Kingdom:\n Northern Ireland"
_add("census-2021-ms-a16.xlsx", "ms-a16-born-in-ni-{geog}.csv",
     [_kv_count("All usual residents", "Total"),
      _kv_count(_NI_BORN, "BornInNI"),
      _kv_pct(_NI_BORN, "BornInNI_pct")],
     ["Settlement", "Ward", "LGD"])

# MS-B05 — Knowledge of Irish. Headline: % with some Irish (any ability).
_add("census-2021-ms-b05.xlsx", "ms-b05-irish-{geog}.csv",
     [_kv_count("All usual residents aged 3 and over", "Total"),
      _kv_count("Some ability in Irish", "SomeIrish"),
      _kv_pct("Some ability in Irish", "SomeIrish_pct")],
     ["Settlement", "Ward", "LGD"])

# MS-B08 — Knowledge of Ulster-Scots
_add("census-2021-ms-b08.xlsx", "ms-b08-ulster-scots-{geog}.csv",
     [_kv_count("All usual residents aged 3 and over", "Total"),
      _kv_count("Some ability in Ulster-Scots", "SomeUlsterScots"),
      _kv_pct("Some ability in Ulster-Scots", "SomeUlsterScots_pct")],
     ["Settlement", "Ward", "LGD"])

# MS-B19 — Religion. Headline: % Catholic (single denomination).
_add("census-2021-ms-b19.xlsx", "ms-b19-catholic-{geog}.csv",
     [_kv_count("All usual residents", "Total"),
      _kv_count("Catholic \n[note 2]", "Catholic"),
      _kv_pct("Catholic \n[note 2]", "Catholic_pct")],
     ["Settlement", "Ward", "LGD"])

# MS-B23 — Religion or religion brought up in. Headline: % Catholic background.
_add("census-2021-ms-b23.xlsx", "ms-b23-catholic-background-{geog}.csv",
     [_kv_count("All usual residents", "Total"),
      _kv_count("Catholic \n[note 2]", "CatholicBackground"),
      _kv_pct("Catholic \n[note 2]", "CatholicBackground_pct")],
     ["Settlement", "Ward", "LGD"])


# ============================================================================
# Extraction
# ============================================================================

def _norm(s):
    """Normalise a header for lenient matching."""
    return " ".join(str(s).split()).strip().lower()

def _find_col(header, target):
    """Find target in header; tolerant to whitespace/newline differences."""
    if target in header:
        return header.index(target)
    nt = _norm(target)
    for j, h in enumerate(header):
        if _norm(h) == nt:
            return j
    return None

def _find_subsections(rows):
    """Locate stacked 'Geography'-headed sub-tables. Returns list of
    (section_name, header_row_idx, header_list, end_row_idx).
    Sub-tables are named 'count' (first) and 'percent' (second) by convention.
    """
    headers = []
    for i, r in enumerate(rows):
        if r and r[0] is not None and str(r[0]).strip().lower() == "geography":
            headers.append(i)
    if not headers:
        return []
    section_names = ["count", "percent", "section3", "section4"]
    out = []
    for k, idx in enumerate(headers):
        end = headers[k + 1] if k + 1 < len(headers) else len(rows)
        hdr = [str(c).strip() if c is not None else "" for c in rows[idx]]
        out.append((section_names[k] if k < len(section_names) else f"section{k+1}",
                    idx, hdr, end))
    return out

def extract_sheet(xlsx_path: Path, sheet: str, out_csv: Path, values: list):
    wb = load_workbook(xlsx_path, data_only=True, read_only=True)
    if sheet not in wb.sheetnames:
        print(f"  ! {sheet} not in {xlsx_path.name}; available: {wb.sheetnames}")
        return 0
    ws = wb[sheet]
    rows = list(ws.iter_rows(values_only=True))

    sections = _find_subsections(rows)
    if not sections:
        print(f"  ! no header row in {xlsx_path.name}/{sheet}")
        return 0
    by_name = {s[0]: s for s in sections}

    # accum: code -> {"Geography": ..., "GeographyCode": ..., **value_outs}
    accum = {}
    code_order = []  # preserve count-section order for stable CSV output

    for vs in values:
        section, in_name, out_name = vs["section"], vs["in"], vs["out"]
        if section not in by_name:
            print(f"  ! sheet {sheet} has no '{section}' sub-table; "
                  f"have {[s[0] for s in sections]} — skipping {out_name}")
            continue
        _, hdr_idx, hdr, end_idx = by_name[section]
        col = _find_col(hdr, in_name)
        if col is None:
            print(f"  ! sheet {sheet} {section}: no column '{in_name}'; have {hdr}")
            continue

        for r in rows[hdr_idx + 1:end_idx]:
            if not r: continue
            name = r[0]
            if name is None: continue
            sname = str(name).strip()
            if sname.lower() == "geography": break
            if sname.startswith(("Geographic", "Note", "Source", "MS-")): continue
            code = r[1]
            if code is None: continue
            scode = str(code).strip()
            entry = accum.get(scode)
            if entry is None:
                entry = {"Geography": sname, "GeographyCode": scode}
                accum[scode] = entry
                if section == "count":
                    code_order.append(scode)
            v = r[col]
            if v is None:
                entry[out_name] = ""
            elif section == "percent":
                try:
                    entry[out_name] = f"{float(v) * 100:.2f}"
                except (TypeError, ValueError):
                    entry[out_name] = str(v).strip()
            else:
                entry[out_name] = str(v).strip()

    # Write CSV
    if not code_order:
        # Some entries lacked any 'count' section — fall back to insertion order.
        code_order = list(accum.keys())

    out_cols = ["Geography", "GeographyCode"] + [v["out"] for v in values]
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    with out_csv.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(out_cols)
        for code in code_order:
            row = accum[code]
            w.writerow([row.get(c, "") for c in out_cols])
    return len(code_order)

def main():
    for spec in MANIFEST:
        src = PHASE1 / spec["xlsx"]
        out = OUT_DIR / spec["csv"]
        if not src.exists():
            print(f"  ! source missing: {src}")
            continue
        n = extract_sheet(src, spec["sheet"], out, spec["values"])
        print(f"  {spec['xlsx']} [{spec['sheet']}] -> {out.name}  ({n} rows)")

if __name__ == "__main__":
    main()
