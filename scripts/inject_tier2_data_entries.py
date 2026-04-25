#!/usr/bin/env python
"""Inject Tier-2 census data entries into maps.json.

Tier 2 entries colour by a percentage but expose the underlying count and
total in the same data entry — one entry per metric per geography, not
two. The data-entry runtime renders both the choropleth (driven by the
percent column) and the table panel (showing all columns).
"""
import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MAPS_JSON = REPO / "data" / "database" / "maps.json"
SOURCE_URL = "https://www.nisra.gov.uk/publications/census-2021-main-statistics-for-northern-ireland-phase-1"

GEOGS = {
    "lgd":        {"geography": "lgd-2012",         "joinKey": "LGDCode",     "csvKeyColumn": "GeographyCode", "label": "LGD"},
    "ward":       {"geography": "wards-2012",       "joinKey": "WardCode",    "csvKeyColumn": "GeographyCode", "label": "Ward 2014"},
    "settlement": {"geography": "settlements-2015", "joinKey": "Code",        "csvKeyColumn": "GeographyCode", "label": "Settlement"},
}

# Each metric: csv_prefix, slug fragment, headline, pct column, underlying
# count + total columns (in the order shown in the panel), per-geog domain.
METRICS = [
    {
        "slug":     "female-share",
        "headline": "Female population share",
        "name":     "Female population share (Census 2021, by {label})",
        "csv_prefix": "ms-a07-female",
        "pct_col":  "Female_pct",
        "table_columns": ["Geography", "Total", "Female", "Female_pct"],
        "source_table": "MS-A07 (Sex)",
        "ramp": "viridis",
        "domains": {
            "lgd":        [48.5, 51.5],
            "ward":       [48.0, 53.0],
            "settlement": [48.5, 53.5],
        },
    },
    {
        "slug":     "born-in-ni",
        "headline": "Born in Northern Ireland",
        "name":     "Born in Northern Ireland (Census 2021, by {label})",
        "csv_prefix": "ms-a16-born-in-ni",
        "pct_col":  "BornInNI_pct",
        "table_columns": ["Geography", "Total", "BornInNI", "BornInNI_pct"],
        "source_table": "MS-A16 (Country of birth — basic)",
        "ramp": "viridis",
        "domains": {
            "lgd":        [80, 92],
            "ward":       [70, 95],
            "settlement": [70, 95],
        },
    },
    {
        "slug":     "irish-knowledge",
        "headline": "Some ability in Irish",
        "name":     "Some ability in Irish (Census 2021, by {label})",
        "csv_prefix": "ms-b05-irish",
        "pct_col":  "SomeIrish_pct",
        "table_columns": ["Geography", "Total", "SomeIrish", "SomeIrish_pct"],
        "source_table": "MS-B05 (Knowledge of Irish)",
        "ramp": "viridis",
        "domains": {
            "lgd":        [3, 22],
            "ward":       [2, 30],
            "settlement": [2, 30],
        },
    },
    {
        "slug":     "ulster-scots-knowledge",
        "headline": "Some ability in Ulster-Scots",
        "name":     "Some ability in Ulster-Scots (Census 2021, by {label})",
        "csv_prefix": "ms-b08-ulster-scots",
        "pct_col":  "SomeUlsterScots_pct",
        "table_columns": ["Geography", "Total", "SomeUlsterScots", "SomeUlsterScots_pct"],
        "source_table": "MS-B08 (Knowledge of Ulster-Scots)",
        "ramp": "viridis",
        "domains": {
            "lgd":        [6, 22],
            "ward":       [2, 28],
            "settlement": [2, 32],
        },
    },
    {
        "slug":     "religion-catholic",
        "headline": "Religion: Catholic",
        "name":     "Religion: Catholic (Census 2021, by {label})",
        "csv_prefix": "ms-b19-catholic",
        "pct_col":  "Catholic_pct",
        "table_columns": ["Geography", "Total", "Catholic", "Catholic_pct"],
        "source_table": "MS-B19 (Religion)",
        "ramp": "viridis",
        "domains": {
            "lgd":        [10, 70],
            "ward":       [0, 100],
            "settlement": [0, 100],
        },
    },
    {
        "slug":     "catholic-background",
        "headline": "Catholic community background",
        "name":     "Catholic community background (Census 2021, by {label})",
        "csv_prefix": "ms-b23-catholic-background",
        "pct_col":  "CatholicBackground_pct",
        "table_columns": ["Geography", "Total", "CatholicBackground", "CatholicBackground_pct"],
        "source_table": "MS-B23 (Religion or religion brought up in)",
        "ramp": "viridis",
        "domains": {
            "lgd":        [12, 72],
            "ward":       [0, 100],
            "settlement": [0, 100],
        },
    },
]


def make_entry(metric, geog_id, geog_meta):
    entry_id = f"data-2021-{metric['slug']}-{geog_id}"
    desc = (
        f"{metric['headline']} ({geog_meta['label']}) from the 2021 NI Census, "
        f"recorded by NISRA. Each polygon is shaded by the percentage on a {metric['ramp']} colour ramp; "
        f"the table panel that opens at the bottom right shows the underlying count and population denominator."
    )
    return {
        "id": entry_id,
        "type": "data-entry",
        "name": metric["name"].format(label=geog_meta["label"]),
        "slug": entry_id,
        "category": "data-population",
        "description": desc,
        "geography": geog_meta["geography"],
        "csv": f"data/census/derived/{metric['csv_prefix']}-{geog_id}.csv",
        "joinKey": geog_meta["joinKey"],
        "csvKeyColumn": geog_meta["csvKeyColumn"],
        "valueColumn": metric["pct_col"],
        "ramp": metric["ramp"],
        "domain": metric["domains"][geog_id],
        "logarithmic": False,
        "tableColumns": metric["table_columns"],
        "keywords": [
            "census", "2021", "nisra", "data",
            metric["slug"].replace("-", " "),
            geog_meta["label"].lower(),
        ],
        "source": {
            "title": f"NISRA Census 2021, Main Statistics Phase 1, {metric['source_table']}",
            "url": SOURCE_URL,
        },
    }


def main():
    db = json.loads(MAPS_JSON.read_text(encoding="utf-8"))
    entries = db.setdefault("dataEntries", [])

    new_entries = []
    for metric in METRICS:
        for geog_id in metric["domains"]:
            new_entries.append(make_entry(metric, geog_id, GEOGS[geog_id]))

    new_ids = {e["id"] for e in new_entries}
    existing = [e for e in entries if e["id"] not in new_ids]
    db["dataEntries"] = existing + new_entries
    MAPS_JSON.write_text(json.dumps(db, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Injected {len(new_entries)} entries; total now {len(db['dataEntries'])}")
    for e in new_entries:
        print(f"  {e['id']}")

if __name__ == "__main__":
    main()
