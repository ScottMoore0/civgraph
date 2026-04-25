#!/usr/bin/env python
"""Add the pre-1970 Westminster dates emitted by bk_to_westminster_json.py to
election-viewer-package/data/elections_index.json under
'House of Commons of the United Kingdom'. Idempotent."""
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
HOC_DIR = REPO / "election-viewer-package" / "data" / "elections" / "house-of-commons-of-the-united-kingdom"
INDEX = REPO / "election-viewer-package" / "data" / "elections_index.json"

def main():
    summary = json.loads((HOC_DIR / "_pre1970_index.json").read_text(encoding="utf-8"))
    idx = json.loads(INDEX.read_text(encoding="utf-8"))
    body = next((b for b in idx["bodies"]
                 if b["name"] == "House of Commons of the United Kingdom"), None)
    if body is None:
        raise SystemExit("House of Commons body not found in index")

    new_dates = {e["date"]: e["constituencies"] for e in summary}
    existing_by_date = {d["date"]: d for d in body["dates"]}
    added, updated = 0, 0
    for date, consts in new_dates.items():
        if date in existing_by_date:
            existing_by_date[date]["constituencies"] = consts
            updated += 1
        else:
            body["dates"].append({"date": date, "constituencies": consts})
            added += 1
    # Sort dates descending (matches existing pattern)
    body["dates"].sort(key=lambda d: d["date"], reverse=True)
    INDEX.write_text(json.dumps(idx, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Index updated: {added} dates added, {updated} dates refreshed; total now {len(body['dates'])}")

if __name__ == "__main__":
    main()
