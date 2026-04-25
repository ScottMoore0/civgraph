#!/usr/bin/env python
"""Inject Tier-1 census data entries (MS-A14, MS-E01, MS-E02) into maps.json.

Idempotent — removes any existing entries with the same id before inserting,
so the script can be re-run safely after manual edits.
"""
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MAPS_JSON = REPO / "data" / "database" / "maps.json"

# Geography → join configuration (same as MS-A01 entries)
GEOGS = {
    "lgd":        {"geography": "lgd-2012",        "joinKey": "LGDCode",     "csvKeyColumn": "GeographyCode", "label": "LGD"},
    "dea":        {"geography": "deas-2012",       "joinKey": "FinalR_DEA",  "csvKeyColumn": "Geography",     "label": "DEA"},
    "ward":       {"geography": "wards-2012",      "joinKey": "WardCode",    "csvKeyColumn": "GeographyCode", "label": "Ward 2014"},
    "settlement": {"geography": "settlements-2015","joinKey": "Code",        "csvKeyColumn": "GeographyCode", "label": "Settlement"},
    "sdz":        {"geography": "sdz-2021",        "joinKey": "SDZ2021_cd",  "csvKeyColumn": "GeographyCode", "label": "Super Data Zone"},
    "dz":         {"geography": "dz-2021",         "joinKey": "DZ2021_cd",   "csvKeyColumn": "GeographyCode", "label": "Data Zone"},
}

# Per-(table, geography) domains — picked from p5/p95 of the extracted CSV,
# rounded for legend readability. Log scale used where the spread is wide.
TABLES = {
    "ms-a14": {
        "topic_slug": "population-density",
        "headline":   "Population density",
        "name":       "Population density (Census 2021, by {label})",
        "valueColumn":"PopulationDensity",
        "tableTitle": "Population density (residents per hectare)",
        "valueLabel": "PopulationDensity",
        "ramp":       "viridis",
        "source_table": "MS-A14 (Population density)",
        "domains": {
            "lgd": {"domain": [0.4, 30],   "log": True},
            "dea": {"domain": [0.3, 35],   "log": True},
            "sdz": {"domain": [0.3, 70],   "log": True},
            "dz":  {"domain": [0.3, 90],   "log": True},
        },
    },
    "ms-e01": {
        "topic_slug": "households",
        "headline":   "Households",
        "name":       "Total households (Census 2021, by {label})",
        "valueColumn":"AllHouseholds",
        "tableTitle": "Total households",
        "valueLabel": "AllHouseholds",
        "ramp":       "viridis",
        "source_table": "MS-E01 (Households)",
        "domains": {
            "lgd":        {"domain": [45000, 150000], "log": False},
            "dea":        {"domain": [6000, 15000],   "log": False},
            "ward":       {"domain": [1100, 2500],    "log": False},
            "settlement": {"domain": [200, 12000],    "log": True},
            "sdz":        {"domain": [600, 1250],     "log": False},
            "dz":         {"domain": [130, 290],      "log": False},
        },
    },
    "ms-e02": {
        "topic_slug": "household-size",
        "headline":   "Average household size",
        "name":       "Average household size (Census 2021, by {label})",
        "valueColumn":"AverageHouseholdSize",
        "tableTitle": "Average household size (persons per household)",
        "valueLabel": "AverageHouseholdSize",
        "ramp":       "viridis",
        "source_table": "MS-E02 (Household size)",
        "domains": {
            "lgd":        {"domain": [2.25, 2.75], "log": False},
            "dea":        {"domain": [2.20, 2.85], "log": False},
            "ward":       {"domain": [2.05, 2.95], "log": False},
            "settlement": {"domain": [2.15, 2.90], "log": False},
            "sdz":        {"domain": [1.95, 2.95], "log": False},
            "dz":         {"domain": [1.80, 3.10], "log": False},
        },
    },
}

SOURCE_URL = "https://www.nisra.gov.uk/publications/census-2021-main-statistics-for-northern-ireland-phase-1"

def make_entry(table_id, geog_id, table_meta, geog_meta, dom):
    topic = table_meta["topic_slug"]
    entry_id = f"data-2021-{topic}-{geog_id}"
    desc = (
        f"{table_meta['headline']} ({geog_meta['label']}) from the 2021 NI Census, "
        f"recorded by NISRA. Each polygon is shaded on a {table_meta['ramp']} colour ramp; "
        f"full numeric breakdown shown in the table panel that opens at the bottom right "
        f"when the entry is loaded."
    )
    entry = {
        "id": entry_id,
        "type": "data-entry",
        "name": table_meta["name"].format(label=geog_meta["label"]),
        "slug": entry_id,
        "category": "data-population",
        "description": desc,
        "geography": geog_meta["geography"],
        "csv": f"data/census/derived/{table_id}-{geog_id}.csv",
        "joinKey": geog_meta["joinKey"],
        "csvKeyColumn": geog_meta["csvKeyColumn"],
        "valueColumn": table_meta["valueColumn"],
        "ramp": table_meta["ramp"],
        "domain": dom["domain"],
        "logarithmic": dom["log"],
        "tableColumns": ["Geography", table_meta["valueColumn"]],
        "keywords": [
            "census", "2021", "nisra", "data",
            topic.replace("-", " "),
            geog_meta["label"].lower(),
        ],
        "source": {
            "title": f"NISRA Census 2021, Main Statistics Phase 1, {table_meta['source_table']}",
            "url": SOURCE_URL,
        },
    }
    return entry

def main():
    db = json.loads(MAPS_JSON.read_text(encoding="utf-8"))
    entries = db.setdefault("dataEntries", [])

    new_entries = []
    for table_id, table_meta in TABLES.items():
        for geog_id, dom in table_meta["domains"].items():
            new_entries.append(make_entry(table_id, geog_id, table_meta, GEOGS[geog_id], dom))

    new_ids = {e["id"] for e in new_entries}
    existing = [e for e in entries if e["id"] not in new_ids]

    db["dataEntries"] = existing + new_entries
    MAPS_JSON.write_text(json.dumps(db, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Injected {len(new_entries)} entries; total now {len(db['dataEntries'])}")
    for e in new_entries:
        print(f"  {e['id']}")

if __name__ == "__main__":
    main()
