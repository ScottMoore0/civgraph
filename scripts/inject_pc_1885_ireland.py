#!/usr/bin/env python
"""Register PC_1885_Ireland.fgb (101 features, all-Ireland) in maps.json."""
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MAPS_JSON = REPO / "data" / "database" / "maps.json"

ENTRY = {
    "id": "pc-1885-ireland",
    "name": "Parliamentary Constituencies 1885 (Ireland — all-island)",
    "slug": "pc-1885-ireland",
    "category": "parliamentary",
    "featured": True,
    "provider": ["Parlconst.org"],
    "files": {
        "fgb": "https://data.civgraph.net/data/maps/parliamentary/PC_1885_Ireland.fgb"
    },
    "style": {"color": "#5B7AA8", "weight": 2},
    "labelProperty": "C1885",
    "keywords": ["constituency", "westminster", "parliament", "1885",
                 "pre-partition", "all-ireland", "ireland"],
    "description": "All-Ireland Westminster parliamentary constituencies after the 1885 Redistribution of Seats Act. 101 territorial constituencies covering the whole island, in use 1885–1918.",
    "date": 1885,
    "useLOD": True,
}


def main():
    db = json.loads(MAPS_JSON.read_text(encoding="utf-8"))
    maps_list = db["maps"]
    if any(m["id"] == ENTRY["id"] for m in maps_list):
        maps_list = [m for m in maps_list if m["id"] != ENTRY["id"]]
    # Insert next to pc-1884
    idx = next((i for i, m in enumerate(maps_list) if m["id"] == "pc-1884"), len(maps_list))
    maps_list.insert(idx + 1, ENTRY)
    db["maps"] = maps_list
    MAPS_JSON.write_text(json.dumps(db, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Registered {ENTRY['id']}; total maps now {len(db['maps'])}")


if __name__ == "__main__":
    main()
