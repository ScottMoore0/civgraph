#!/usr/bin/env python
"""Register the EONI Polling Stations layer (607 stations across NI) in maps.json."""
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MAPS_JSON = REPO / "data" / "database" / "maps.json"

NEW_CATEGORY = {
    "id": "polling",
    "name": "Polling & Voting",
    "group": "Political Geography",
    "description": "Polling station locations and electoral-administration geography for Northern Ireland.",
}

ENTRY = {
    "id": "eoni-polling-stations",
    "name": "EONI Polling Stations",
    "slug": "eoni-polling-stations",
    "category": "polling",
    "featured": False,
    "provider": ["Electoral Office for Northern Ireland", "Land & Property Services"],
    "files": {
        "fgb": "https://data.civgraph.net/data/maps/polling/eoni-polling-stations.fgb"
    },
    "style": {
        "color": "#205493",
        "weight": 1,
        "fillColor": "#3F7CC0",
        "fillOpacity": 0.85,
        "radius": 5
    },
    "labelProperty": "BUILDING_NAME",
    "keywords": ["polling", "voting", "election", "polling station", "EONI", "voter"],
    "description": "All 607 polling stations used by the Electoral Office for Northern Ireland (EONI). Each station's record includes the building name, full address, postcode, the count of properties assigned to it, and the number of ballot boxes. Sourced via the EONI Polling Stations and Properties ArcGIS service published on the OSNI Spatial NI Hub.",
    "references": [
        {"label": "EONI Polling Stations app (interactive)",
         "url": "https://osni-spatialni.hub.arcgis.com/apps/d37660935b1645a696f50ac086bc0eff/explore",
         "note": "Source — OSNI Spatial NI"},
    ],
    "date": "2026-04-27"
}


def main():
    db = json.loads(MAPS_JSON.read_text(encoding="utf-8"))
    cats = db.setdefault("categories", [])
    if not any(c.get("id") == NEW_CATEGORY["id"] for c in cats):
        # Insert near the parliamentary-proposals one
        idx = next((i for i, c in enumerate(cats) if c.get("id") == "parliamentary-proposals"), len(cats))
        cats.insert(idx + 1, NEW_CATEGORY)
        print(f"  + added category {NEW_CATEGORY['id']}")
    maps = db["maps"]
    maps[:] = [m for m in maps if m.get("id") != ENTRY["id"]]
    maps.append(ENTRY)
    db["maps"] = maps
    MAPS_JSON.write_text(json.dumps(db, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"  Registered {ENTRY['id']}; total maps {len(maps)}")


if __name__ == "__main__":
    main()
