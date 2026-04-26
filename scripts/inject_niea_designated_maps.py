#!/usr/bin/env python
"""Inject NIEA Natural Environment designated-sites maps into maps.json."""
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MAPS_JSON = REPO / "data" / "database" / "maps.json"

# (slug, full_title, package_id_from_odni, label_property, fill_colour, description)
DATASETS = [
    ("designated-aonb",   "Areas of Outstanding Natural Beauty (AONB)",
     "areas-of-outstanding-natural-beauty",
     "NAME", "#7BAA66",
     "Eight Areas of Outstanding Natural Beauty designated under Article 14 of the Nature Conservation and Amenity Lands (Northern Ireland) Order 1985 for landscape protection. Includes the Mournes, Antrim Coast & Glens, Causeway Coast, Ring of Gullion, Sperrins, Strangford Lough, Erne Lakeland and Lagan Valley AONBs."),
    ("designated-assi",   "Areas of Special Scientific Interest (ASSI)",
     "areas-of-special-scientific-interest",
     "NAME", "#E8A33E",
     "Areas of Special Scientific Interest provide statutory protection under the Nature Conservation and Amenity Lands (NI) Order 1985 for the best examples of NI's flora, fauna, geological or physiographical features. The 394 ASSIs are NI's principal site-based wildlife protection mechanism."),
    ("designated-nnr",    "National Nature Reserves (NNR)",
     "national-nature-reserves",
     "NAME", "#3F8D45",
     "Statutory nature reserves declared under the Nature Conservation and Amenity Lands (NI) Order 1985 for areas of importance for flora, fauna, geological or other special features. The 50 NNRs are managed primarily for conservation, with the highest level of legal site protection in NI."),
    ("designated-ramsar", "Ramsar Wetland Sites",
     "ramsar-sites",
     "NAME", "#3B8DBD",
     "Wetlands of international importance designated under the 1971 Ramsar Convention on Wetlands. The 20 NI Ramsar sites cover loughs, estuaries and bogs of internationally significant ecological character."),
    ("designated-sac",    "Special Areas of Conservation (SAC)",
     "special-areas-of-conservation",
     "NAME", "#5B7AA8",
     "SACs are habitats and species given the greatest protection under the EU Habitats Directive (transposed into UK law via the Conservation Regulations). 58 sites in NI form part of the Natura 2000 network — the highest level of habitat protection in European law."),
    ("designated-spa",    "Special Protection Areas (SPA)",
     "special-protection-areas",
     "NAME", "#A6C572",
     "Designated under the EU Birds Directive for vulnerable, migratory and other significant bird species. 16 SPAs in NI form part of the Natura 2000 network. Many overlap with Ramsar / SAC / ASSI designations."),
    ("designated-whs",    "World Heritage Site",
     "world-heritage-site",
     "Name_WHS", "#9D6B3F",
     "Northern Ireland's sole UNESCO World Heritage Site: the Giant's Causeway and Causeway Coast. Inscribed in 1986 under criteria (vii) and (viii) for its outstanding geological and natural features — the famous columnar basalt formations and associated coastal landscape."),
    ("designated-lca",    "Landscape Character Areas (LCA)",
     "landscape-character-areas",
     "LCA_NAME", "#C9B07A",
     "The Northern Ireland Landscape Character Assessment (NIEA, 2000) subdivides the countryside into 130 Landscape Character Areas based on local geology, landform, land use, settlement and ecology. LCAs underpin landscape policy and planning decisions."),
]


def make_entry(slug, title, odni_slug, label_prop, fill_colour, description):
    return {
        "id": slug,
        "name": title,
        "slug": slug,
        "category": "designated-sites",
        "provider": ["DAERA", "Northern Ireland Environment Agency"],
        "description": description,
        "files": {
            "fgb": f"https://data.civgraph.net/data/maps/designated-sites/{slug}.fgb"
        },
        "style": {
            "color": "#3a3a3a",
            "weight": 0.6,
            "fillColor": fill_colour,
            "fillOpacity": 0.55
        },
        "labelProperty": label_prop,
        "useLOD": False,
        "keywords": [
            "designated", "protected", "conservation",
            "niea", "daera", "natural environment",
            title.lower(),
        ],
        "references": [
            {
                "label": f"Open Data NI — {title}",
                "url": f"https://admin.opendatani.gov.uk/dataset/{odni_slug}",
                "note": ""
            }
        ]
    }


def main():
    db = json.loads(MAPS_JSON.read_text(encoding="utf-8"))
    maps_list = db.setdefault("maps", [])
    cats = db.setdefault("categories", [])

    if not any(c.get("id") == "designated-sites" for c in cats):
        bio_idx = next((i for i, c in enumerate(cats) if c.get("id") == "biodiversity"), len(cats))
        cats.insert(bio_idx + 1, {
            "id": "designated-sites",
            "name": "Designated & Protected Sites",
            "group": "Physical Geography",
            "description": (
                "NIEA-designated protected areas: AONBs, ASSIs, NNRs, Ramsar sites, "
                "SACs, SPAs, World Heritage Site, plus Landscape Character Areas. "
                "Statutory and international designations covering biodiversity, "
                "landscape and heritage protection across Northern Ireland."
            )
        })
        print("Added 'designated-sites' category")

    new_entries = [make_entry(*args) for args in DATASETS]
    new_ids = {e["id"] for e in new_entries}
    existing = [m for m in maps_list if m.get("id") not in new_ids]
    db["maps"] = existing + new_entries

    MAPS_JSON.write_text(json.dumps(db, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Injected {len(new_entries)} NIEA designated-sites maps; total maps now {len(db['maps'])}")


if __name__ == "__main__":
    main()
