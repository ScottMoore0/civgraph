#!/usr/bin/env python
"""Add Parliament of Northern Ireland (Stormont) as a body in elections_index.json
using the summary written by scrape_stormont_wikipedia.py. Idempotent."""
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SUMMARY = REPO / "election-viewer-package" / "data" / "elections" / "parliament-of-northern-ireland" / "_index.json"
INDEX = REPO / "election-viewer-package" / "data" / "elections_index.json"

def main():
    summary = json.loads(SUMMARY.read_text(encoding="utf-8"))
    idx = json.loads(INDEX.read_text(encoding="utf-8"))
    body_name = "Parliament of Northern Ireland"
    body = next((b for b in idx["bodies"] if b["name"] == body_name), None)
    if body is None:
        body = {"name": body_name, "slug": "parliament-of-northern-ireland", "dates": []}
        # Insert before local-government bodies for consistent ordering
        first_lg = next((i for i, b in enumerate(idx["bodies"]) if b.get("bodyGroup") == "local-government"), len(idx["bodies"]))
        idx["bodies"].insert(first_lg, body)
        print("Created new body 'Parliament of Northern Ireland'")
    by_date = {d["date"]: d for d in body["dates"]}
    added, updated = 0, 0
    for entry in summary:
        date, consts = entry["date"], entry["constituencies"]
        if not consts: continue
        if date in by_date:
            by_date[date]["constituencies"] = consts
            updated += 1
        else:
            body["dates"].append({"date": date, "constituencies": consts})
            added += 1
    body["dates"].sort(key=lambda d: d["date"], reverse=True)
    INDEX.write_text(json.dumps(idx, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Stormont dates: {added} added, {updated} updated; total {len(body['dates'])}")

if __name__ == "__main__":
    main()
