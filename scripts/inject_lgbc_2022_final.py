#!/usr/bin/env python
"""Register the LGBC 2021/22 Final Recommendations LGDs (11) + Wards (462) in maps.json."""
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MAPS_JSON = REPO / "data" / "database" / "maps.json"

ENTRIES = [
    {
        "id": "lgd-2022-final-recommendations",
        "name": "Local Government Districts (2022 Final Recommendations)",
        "slug": "lgd-2022-final-recommendations",
        "category": "local-government",
        "featured": False,
        "provider": ["Local Government Boundary Commission for Northern Ireland",
                     "Land & Property Services"],
        "files": {
            "fgb": "https://data.civgraph.net/data/maps/local-government/lgd-2022-final-recommendations.fgb"
        },
        "style": {"color": "#7B5BA8", "weight": 2, "fillOpacity": 0.10},
        "labelProperty": "LGDNAME",
        "keywords": ["LGD", "local government", "boundary commission",
                     "final recommendations", "2022", "2023", "proposal"],
        "description": "Northern Ireland's 11 Local Government Districts as set out in the Local Government Boundary Commission's Final Recommendations published May 2022. The 11-LGD count is unchanged from the existing 2014 boundaries, but the lines themselves are redrawn. Includes electorate counts per district. These are recommendations from the Commission and may not yet be in legal force — verify current statutory status before using for official purposes.",
        "references": [
            {"label": "LGBC 21/22 Public Consultation app",
             "url": "https://osni-spatialni.hub.arcgis.com/apps/a350095c9c7e49ff8daf78d9f8f80edc/explore",
             "note": "Source — OSNI Spatial NI"},
        ],
        "date": "2022-05-01"
    },
    {
        "id": "wards-2022-final-recommendations",
        "name": "Wards (2022 Final Recommendations)",
        "slug": "wards-2022-final-recommendations",
        "category": "wards",
        "featured": False,
        "provider": ["Local Government Boundary Commission for Northern Ireland",
                     "Land & Property Services"],
        "files": {
            "fgb": "https://data.civgraph.net/data/maps/wards/wards-2022-final-recommendations.fgb"
        },
        "style": {"color": "#5B3B8B", "weight": 1, "fillOpacity": 0.05},
        "labelProperty": "WARDNAME",
        "keywords": ["ward", "boundary commission", "final recommendations",
                     "2022", "2023", "proposal"],
        "description": "Northern Ireland's 462 wards as set out in the LGBC Final Recommendations published May 2022. Same ward count as the existing 2014 boundaries but with substantially redrawn lines. New WardCode scheme. Each ward includes its electorate count and the LGD it sits in. These are recommendations and may not yet be in legal force — verify current statutory status before using for official purposes.",
        "references": [
            {"label": "LGBC 21/22 Public Consultation app",
             "url": "https://osni-spatialni.hub.arcgis.com/apps/a350095c9c7e49ff8daf78d9f8f80edc/explore",
             "note": "Source — OSNI Spatial NI"},
        ],
        "date": "2022-05-01"
    },
]


def main():
    db = json.loads(MAPS_JSON.read_text(encoding="utf-8"))
    maps = db["maps"]
    new_ids = {e["id"] for e in ENTRIES}
    maps[:] = [m for m in maps if m.get("id") not in new_ids]
    # Insert each next to its category siblings
    for e in ENTRIES:
        # find a sibling in same category and insert immediately after it
        idx = next((i for i, m in enumerate(maps) if m.get("category") == e["category"]), len(maps))
        maps.insert(idx, e)
    db["maps"] = maps
    MAPS_JSON.write_text(json.dumps(db, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"  Registered {len(ENTRIES)} entries; total maps {len(maps)}")


if __name__ == "__main__":
    main()
