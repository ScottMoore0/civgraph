#!/usr/bin/env python
"""Inject Ulster Wildlife habitat-network maps into data/database/maps.json.

Idempotent — replaces any existing entries with matching ids.
"""
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MAPS_JSON = REPO / "data" / "database" / "maps.json"

# Same datasets as fetch script. (slug, title, package_id, abbrev_for_zip).
DATASETS = [
    ("habitat-bog", "Bog", "846c30d0-2d1d-441e-99dc-43c4741e77f6"),
    ("habitat-deciduous-woodland", "Deciduous Woodland", "b15b4d96-9513-43b6-a310-a23c5c7fff37"),
    ("habitat-fen", "Fen", "a62e37f4-9a17-4854-a2ac-cc7b5b433648"),
    ("habitat-heath", "Heath", "11cae57f-ed15-4a0d-82b4-86871060a6f3"),
    ("habitat-lake", "Lake", "c389bfb5-65af-4457-b3f7-b5d1f2c7a29a"),
    ("habitat-acid-grassland", "Acid Grassland", "f4cdfd0e-f655-444d-a5fb-f052a04c6737"),
    ("habitat-calcareous-grassland", "Calcareous Grassland", "ddc941ea-51ce-4bb5-be8c-1daabca0a9b1"),
    ("habitat-coastal-sand-dune", "Coastal Sand Dune", "10a948a6-05d5-498b-853a-430086da439a"),
    ("habitat-coastal-saltmarsh", "Coastal Saltmarsh", "05953343-682e-4ae7-87c3-801a092f0587"),
    ("habitat-coastal-vegetated-shingle", "Coastal Vegetated Shingle", "bc57fe1b-d5f1-4f1a-af96-494618f3b53b"),
    ("habitat-ancient-semi-natural-woodland", "Ancient Semi-Natural Woodland", "0602c59a-2e65-40e7-88cf-4335afed4e09"),
    ("habitat-lowland-meadow", "Lowland Meadow", "c3d5eef0-5ddc-4ba4-a278-b292b1e00b65"),
    ("habitat-limestone-pavement", "Limestone Pavement", "371e68d4-530a-4d1c-b867-44a3ef320411"),
    ("habitat-maritime-cliff-slope", "Maritime Cliff and Slope", "2b89ad59-e650-4eca-b974-19dda42a8572"),
    ("habitat-pond", "Pond", "4773a29d-b525-4e50-acae-b4ffa4047279"),
    ("habitat-reedbed", "Reedbed", "2aad7ca5-4619-4519-ab64-4ecfff858e72"),
    ("habitat-river", "River", "bde1d3a6-9276-442d-89e7-8a064af48898"),
    ("habitat-traditional-orchard", "Traditional Orchard", "c4f05bd7-5dd5-4504-b6d7-23940957c3cd"),
    ("habitat-wood-pasture-parkland", "Wood Pasture and Parkland", "89653a85-4d13-4cc7-a643-1fb6e7cad0fa"),
    ("habitat-purple-moor-grass", "Purple Moor Grass and Rush Pasture", "7bd34e15-1fd7-4b7d-acd3-f2cfefbc15c6"),
    ("habitat-coastal-grouped", "Coastal Habitat Networks (grouped)", "db9a4622-7b79-4bbe-94b6-ff54c9fafd2f"),
    ("habitat-woodland-grouped", "Woodland Habitat Networks (grouped)", "8cc0d885-994c-432c-af8e-44ff55b4761d"),
    ("habitat-grassland-grouped", "Grassland Habitat Networks (grouped)", "f311e7ab-085e-491a-bda2-939e039541d2"),
    ("habitat-wetland-grouped", "Wetland Habitat Networks (grouped)", "8e581af0-a6bb-43b6-b2d9-1f4d5ed96013"),
]

# Per-habitat fill colour. Pulled from a conventional habitat palette
# (greens for woodland, blues for water, purples for wetland, browns for
# moor/peat, oranges for coastal). Used as the default polygon fill; the
# zone classification is layered on top via the colorMap below.
FILL = {
    "habitat-bog":                              "#7E5A4F",
    "habitat-deciduous-woodland":               "#3F8D45",
    "habitat-fen":                              "#7CA89A",
    "habitat-heath":                            "#8C6F47",
    "habitat-lake":                             "#3B8DBD",
    "habitat-acid-grassland":                   "#B8C277",
    "habitat-calcareous-grassland":             "#D4D278",
    "habitat-coastal-sand-dune":                "#E8D697",
    "habitat-coastal-saltmarsh":                "#88A07A",
    "habitat-coastal-vegetated-shingle":        "#D5C3A1",
    "habitat-ancient-semi-natural-woodland":    "#1F5E2C",
    "habitat-lowland-meadow":                   "#9DC07F",
    "habitat-limestone-pavement":               "#A6A39B",
    "habitat-maritime-cliff-slope":             "#9E6E54",
    "habitat-pond":                             "#5DA4D8",
    "habitat-reedbed":                          "#807A52",
    "habitat-river":                            "#4F89AE",
    "habitat-traditional-orchard":              "#A3C266",
    "habitat-wood-pasture-parkland":            "#5A8E45",
    "habitat-purple-moor-grass":                "#7E5C8A",
    "habitat-coastal-grouped":                  "#C6A876",
    "habitat-woodland-grouped":                 "#3F8D45",
    "habitat-grassland-grouped":                "#A8B85C",
    "habitat-wetland-grouped":                  "#7CA89A",
}

# Habitat-network 'Class' attribute palette (consistent across all 24 datasets).
# Conservation zone semantics: core habitat is the most saturated; expansion
# zones get muted variants of the core colour.
ZONE_PALETTE = {
    "Associated Habitats":          "#666666",  # neutral grey for adjacent supporting habitat
    "Fragmentation Action Zone":    "#D4894C",  # warm orange — degraded / needs reconnection
    "Network Enhancement Zone 1":   "#E8C85C",  # yellow — buffered around core
    "Network Enhancement Zone 2":   "#C8A442",  # darker yellow
    "Network Expansion Zone":       "#9CCB7C",  # pale green — opportunity for new habitat
    "Existing Habitat":             "#2E7D32",  # deep green — core / current habitat
}


def make_entry(slug, title, pkg_id, fill_colour):
    full_title = f"Habitat Network — {title}"
    return {
        "id": slug,
        "name": full_title,
        "slug": slug,
        "category": "biodiversity",
        "provider": ["Ulster Wildlife"],
        "description": (
            f"Spatial extent of {title.lower()} habitat across Northern Ireland, classified into "
            "Existing Habitat, Associated Habitats, Network Enhancement Zones, Fragmentation Action "
            "Zones and Network Expansion Zones. Part of the Nature Recovery NI habitat-network "
            "mapping project published by Ulster Wildlife on Open Data NI."
        ),
        "files": {
            "fgb": f"https://data.civgraph.net/data/maps/biodiversity/{slug}.fgb"
        },
        "style": {
            "color": "#3a3a3a",
            "weight": 0.2,
            "fillColor": fill_colour,
            "fillOpacity": 0.6
        },
        "colorMap": {
            "property": "Class",
            "palette": ZONE_PALETTE,
            "default": fill_colour
        },
        "labelProperty": "Class",
        "useLOD": True,
        "keywords": [
            "habitat", "biodiversity", "nature recovery", "ulster wildlife",
            "habitat network", title.lower(),
        ],
        "references": [
            {
                "label": f"Open Data NI — {full_title.replace('Habitat Network — ', '')} Habitat Network",
                "url": f"https://admin.opendatani.gov.uk/dataset/{pkg_id}",
                "note": ""
            }
        ]
    }


def main():
    db = json.loads(MAPS_JSON.read_text(encoding="utf-8"))
    maps_list = db.setdefault("maps", [])
    cats = db.setdefault("categories", [])

    # Ensure 'biodiversity' category exists.
    if not any(c.get("id") == "biodiversity" for c in cats):
        # Insert near the 'environment' category for grouping.
        env_idx = next((i for i, c in enumerate(cats) if c.get("id") == "environment"), len(cats))
        cats.insert(env_idx + 1, {
            "id": "biodiversity",
            "name": "Biodiversity & Habitats",
            "group": "Physical Geography",
            "description": (
                "Habitat-network and biodiversity overlay datasets — primarily Ulster Wildlife's "
                "Nature Recovery NI mapping of where each habitat type currently exists, what's "
                "associated, and where expansion or restoration would have most ecological benefit."
            )
        })
        print("Added 'biodiversity' category")

    new_entries = [make_entry(slug, title, pkg, FILL[slug]) for slug, title, pkg in DATASETS]
    new_ids = {e["id"] for e in new_entries}
    existing = [m for m in maps_list if m.get("id") not in new_ids]
    db["maps"] = existing + new_entries

    MAPS_JSON.write_text(json.dumps(db, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Injected {len(new_entries)} habitat-network maps; total maps now {len(db['maps'])}")


if __name__ == "__main__":
    main()
