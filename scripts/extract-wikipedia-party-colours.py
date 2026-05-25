import io
import json
import time
import urllib.request
from pathlib import Path

import pandas as pd


MODULE_SUFFIXES = ["1", *[chr(code) for code in range(ord("A"), ord("Z") + 1)]]
EXPECTED_COLUMNS = [
    "Political party name",
    "color",
    "abbrev",
    "shortname",
    "Is color valid?",
    "Contrast normal text",
    "Contrast unvisited link",
    "Contrast visited link",
]
USER_AGENT = "Mozilla/5.0 (compatible; CivgraphDataExtraction/1.0)"
OUT_DIR = Path("tasks")
CSV_PATH = OUT_DIR / "wikipedia_political_party_colours.csv"
REQUESTED_COLUMNS_CSV_PATH = OUT_DIR / "wikipedia_political_party_colours_requested_columns.csv"
XLSX_PATH = OUT_DIR / "wikipedia_political_party_colours.xlsx"
META_PATH = OUT_DIR / "wikipedia_political_party_colours_metadata.json"


def fetch_html(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def extract_table(suffix: str) -> tuple[pd.DataFrame, str]:
    url = f"https://en.wikipedia.org/wiki/Module:Political_party/{suffix}"
    html = fetch_html(url)
    tables = pd.read_html(io.BytesIO(html))
    for table in tables:
        columns = [str(column) for column in table.columns]
        if columns == EXPECTED_COLUMNS:
            frame = table.copy()
            frame.insert(0, "source_url", url)
            frame.insert(1, "module", suffix)
            return frame, url
    raise RuntimeError(f"Expected political party table not found for /{suffix}")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    frames = []
    pages = []
    errors = []

    for suffix in MODULE_SUFFIXES:
        try:
            frame, url = extract_table(suffix)
            frames.append(frame)
            pages.append({"module": suffix, "url": url, "rows": int(len(frame))})
            print(f"/{suffix}: {len(frame)} rows")
        except Exception as exc:
            errors.append({"module": suffix, "error": str(exc)})
            print(f"/{suffix}: ERROR {exc}")
        time.sleep(0.2)

    if errors:
        raise SystemExit(json.dumps({"errors": errors}, indent=2, ensure_ascii=False))

    combined = pd.concat(frames, ignore_index=True)
    combined = combined.fillna("")
    combined.to_csv(CSV_PATH, index=False, encoding="utf-8-sig")
    combined[EXPECTED_COLUMNS].to_csv(REQUESTED_COLUMNS_CSV_PATH, index=False, encoding="utf-8-sig")
    combined.to_excel(XLSX_PATH, index=False)
    blank_name_rows = combined["Political party name"].astype(str).str.strip().eq("")

    metadata = {
        "source": "English Wikipedia Module:Political_party subpages",
        "source_pages": pages,
        "requested_pages": len(MODULE_SUFFIXES),
        "rows": int(len(combined)),
        "columns": list(combined.columns),
        "blank_is_color_valid_cells": int((combined["Is color valid?"] == "").sum()),
        "nonblank_is_color_valid_cells": int((combined["Is color valid?"] != "").sum()),
        "duplicate_party_names": int(combined["Political party name"].duplicated().sum()),
        "blank_party_name_rows": int(blank_name_rows.sum()),
        "output_csv": str(CSV_PATH),
        "output_requested_columns_csv": str(REQUESTED_COLUMNS_CSV_PATH),
        "output_xlsx": str(XLSX_PATH),
    }
    META_PATH.write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(metadata, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
