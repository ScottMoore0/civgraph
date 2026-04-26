#!/usr/bin/env python
"""Inject 1971 Leinster + Munster Wards/DEDs map entries into maps.json,
and attach the 12 Dublin electoral-history scans as references on the
existing dublin-electoral-counties-1985 entry.
"""
import json
import urllib.parse
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MAPS_JSON = REPO / "data" / "database" / "maps.json"

R2_BASE = "https://data.civgraph.net"

# 1971 ED entries (matching the 1986/1977/1919 templates)
NEW_1971 = [
    {
        "province": "Leinster",
        "id": "eds-leinster-1971",
        "name": "Leinster District Electoral Divisions/Wards 1971",
        "color": "#256D36",
        "fgb": "Wards_DEDs_Leinster_1971.fgb",
    },
    {
        "province": "Munster",
        "id": "eds-munster-1971",
        "name": "Munster District Electoral Divisions/Wards 1971",
        "color": "#A33C3C",
        "fgb": "Wards_DEDs_Munster_1971.fgb",
    },
]

# 12 documents to attach as references on dublin-electoral-counties-1985
DOC_BASE = "data/documents/dublin-electoral-history"
DOCS = [
    # Fingal Library & Archives — DCC dev plan scans
    ("1991 DCC Draft Dev Plan - Map 23 Part 1.jpg",
     "1991 DCC Draft Development Plan — Map 23 Part 1 (Fingal Library & Archives)"),
    ("1991 DCC Draft Dev Plan - Map 23 Part 2.jpg",
     "1991 DCC Draft Development Plan — Map 23 Part 2 (Fingal Library & Archives)"),
    ("1991 DCC Draft Dev Plan - Map 25 Part 1.jpg",
     "1991 DCC Draft Development Plan — Map 25 Part 1 (Fingal Library & Archives)"),
    ("1991 DCC Draft Dev Plan - Map 25 part 2.jpg",
     "1991 DCC Draft Development Plan — Map 25 Part 2 (Fingal Library & Archives)"),
    ("1993 DCC Dev Plan - Map 23 Part 1.jpg",
     "1993 DCC Adopted Development Plan — Map 23 Part 1 (Fingal Library & Archives)"),
    ("1993 DCC Dev Plan - Map 23 Part 2.jpg",
     "1993 DCC Adopted Development Plan — Map 23 Part 2 (Fingal Library & Archives)"),
    ("1993 DCC Dev Plan - Map 25 Part 1.jpg",
     "1993 DCC Adopted Development Plan — Map 25 Part 1 (Fingal Library & Archives)"),
    ("1993 DCC Dev Plan - Map 25 Part 2.jpg",
     "1993 DCC Adopted Development Plan — Map 25 Part 2 (Fingal Library & Archives)"),
    # 1992 Local Government in Dublin reorganisation report
    ("Map No. 11.pdf",
     "Local Government in Dublin: A New Beginning — Reorganisation Report (July 1992) — Map 11"),
    ("Map No. 12.pdf",
     "Local Government in Dublin: A New Beginning — Reorganisation Report (July 1992) — Map 12"),
    ("Page 66.pdf",
     "Local Government in Dublin: A New Beginning — Reorganisation Report (July 1992) — Page 66"),
    ("Page 67.pdf",
     "Local Government in Dublin: A New Beginning — Reorganisation Report (July 1992) — Page 67"),
]


def encode_path(path: str) -> str:
    return "/".join(urllib.parse.quote(p, safe="") for p in path.split("/"))


def make_1971_entry(spec: dict) -> dict:
    fgb_path = f"data/maps/electoral-divisions/Electoral Divisions 1986-2019/{spec['fgb']}"
    return {
        "id": spec["id"],
        "name": spec["name"],
        "slug": spec["id"],
        "category": "electoral-divisions",
        "hidden": True,
        "featured": False,
        "provider": ["Phelim Birch"],
        "files": {
            "fgb": f"{R2_BASE}/{fgb_path}",
        },
        "style": {
            "color": spec["color"],
            "weight": 2,
        },
        "keywords": [spec["province"].lower(), "ED", "1971"],
        "labelProperty": "ENGLISH",
        "date": 1971,
    }


def main():
    db = json.loads(MAPS_JSON.read_text(encoding="utf-8"))
    maps_list = db["maps"]

    # Add 1971 entries (replace if already present)
    new_ids = {s["id"] for s in NEW_1971}
    maps_list = [m for m in maps_list if m["id"] not in new_ids]
    new_entries = [make_1971_entry(s) for s in NEW_1971]
    # Insert next to existing eds-*-1977 / 1986 entries: just append at the end of the
    # block by finding any eds-*-1986 index
    insert_at = max(
        (i for i, m in enumerate(maps_list) if m.get("id", "").startswith("eds-") and "1977" in m.get("id", "")),
        default=len(maps_list),
    )
    maps_list = maps_list[: insert_at + 1] + new_entries + maps_list[insert_at + 1 :]
    db["maps"] = maps_list
    print(f"Added {len(new_entries)} new ED entries: {[e['id'] for e in new_entries]}")

    # Attach references on dublin-electoral-counties-1985
    target = next(m for m in maps_list if m["id"] == "dublin-electoral-counties-1985")
    refs = target.setdefault("references", [])
    existing_urls = {r.get("url") for r in refs if isinstance(r, dict)}
    added = 0
    for fname, label in DOCS:
        rel = f"{DOC_BASE}/{fname}"
        url = f"{R2_BASE}/{encode_path(rel)}"
        if url in existing_urls:
            continue
        refs.append({"label": label, "url": url, "note": ""})
        added += 1
    print(f"Added {added} document references to dublin-electoral-counties-1985 "
          f"(now {len(refs)} total)")

    MAPS_JSON.write_text(json.dumps(db, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {MAPS_JSON} ({MAPS_JSON.stat().st_size/1e6:.2f} MB)")
    print(f"Total maps now: {len(db['maps'])}")


if __name__ == "__main__":
    main()
