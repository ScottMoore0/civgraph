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
        # Diverging palette: blue (Protestant convention) ↔ green (Catholic).
        # Fixed [0, 100] domain so 50% always maps to the neutral midpoint.
        "ramp": "protestant-catholic",
        "domains": {
            "lgd":        [0, 100],
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
        "ramp": "protestant-catholic",
        "domains": {
            "lgd":        [0, 100],
            "ward":       [0, 100],
            "settlement": [0, 100],
        },
    },

    # === Tier 2b ============================================================
    {
        "slug":     "limiting-condition",
        "headline": "Day-to-day activities limited",
        "name":     "Day-to-day activities limited (Census 2021, by {label})",
        "csv_prefix": "ms-d02-limiting-condition",
        "pct_col":  "LimitingCondition_pct",
        "table_columns": ["Geography", "Total", "LimitingCondition", "LimitingCondition_pct"],
        "source_table": "MS-D02 (Long-term health problem or disability)",
        "ramp": "viridis",
        "domains": {
            "lgd":        [20, 28],
            "ward":       [12, 35],
            "settlement": [13, 33],
        },
    },
    {
        "slug":     "unpaid-care",
        "headline": "Provides unpaid care",
        "name":     "Provides unpaid care (Census 2021, by {label})",
        "csv_prefix": "ms-d17-unpaid-care",
        "pct_col":  "ProvidesUnpaidCare_pct",
        "table_columns": ["Geography", "Total", "ProvidesUnpaidCare", "ProvidesUnpaidCare_pct"],
        "source_table": "MS-D17 (Provision of unpaid care)",
        "ramp": "viridis",
        "domains": {
            "lgd":        [11, 14],
            "ward":       [8, 16],
            "settlement": [8, 16],
        },
    },
    {
        "slug":     "no-car",
        "headline": "Households with no car or van",
        "name":     "Households with no car or van (Census 2021, by {label})",
        "csv_prefix": "ms-e10-no-car",
        "pct_col":  "NoCar_pct",
        "table_columns": ["Geography", "Total", "NoCar", "NoCar_pct"],
        "source_table": "MS-E10 (Car or van availability)",
        "ramp": "viridis",
        "domains": {
            "lgd":        [12, 35],
            "ward":       [3, 50],
            "settlement": [3, 30],
        },
    },
    {
        "slug":     "owner-occupied",
        "headline": "Owner-occupied households",
        "name":     "Owner-occupied households (Census 2021, by {label})",
        "csv_prefix": "ms-e15-owner-occupied",
        "pct_col":  "OwnerOccupied_pct",
        "table_columns": ["Geography", "Total", "OwnerOccupied", "OwnerOccupied_pct"],
        "source_table": "MS-E15 (Tenure — households)",
        "ramp": "viridis",
        "domains": {
            "lgd":        [50, 75],
            "ward":       [25, 90],
            "settlement": [40, 90],
        },
    },
    {
        "slug":     "social-rented",
        "headline": "Social-rented households",
        "name":     "Social-rented households (Census 2021, by {label})",
        "csv_prefix": "ms-e15-social-rented",
        "pct_col":  "SocialRented_pct",
        "table_columns": ["Geography", "Total", "SocialRented", "SocialRented_pct"],
        "source_table": "MS-E15 (Tenure — households)",
        "ramp": "viridis",
        "domains": {
            "lgd":        [9, 27],
            "ward":       [0, 50],
            "settlement": [0, 30],
        },
    },
    {
        "slug":     "private-rented",
        "headline": "Private-rented households",
        "name":     "Private-rented households (Census 2021, by {label})",
        "csv_prefix": "ms-e15-private-rented",
        "pct_col":  "PrivateRented_pct",
        "table_columns": ["Geography", "Total", "PrivateRented", "PrivateRented_pct"],
        "source_table": "MS-E15 (Tenure — households)",
        "ramp": "viridis",
        "domains": {
            "lgd":        [10, 22],
            "ward":       [5, 40],
            "settlement": [5, 35],
        },
    },
    {
        "slug":     "no-quals",
        "headline": "No qualifications",
        "name":     "No qualifications (Census 2021, by {label})",
        "csv_prefix": "ms-g01-no-quals",
        "pct_col":  "NoQuals_pct",
        "table_columns": ["Geography", "Total", "NoQuals", "NoQuals_pct"],
        "source_table": "MS-G01 (Highest level of qualifications)",
        "ramp": "viridis",
        "domains": {
            "lgd":        [17, 30],
            "ward":       [10, 40],
            "settlement": [10, 40],
        },
    },
    {
        "slug":     "level-4-plus",
        "headline": "Level 4+ qualifications",
        "name":     "Level 4+ qualifications (Census 2021, by {label})",
        "csv_prefix": "ms-g01-level-4-plus",
        "pct_col":  "Level4Plus_pct",
        "table_columns": ["Geography", "Total", "Level4Plus", "Level4Plus_pct"],
        "source_table": "MS-G01 (Highest level of qualifications)",
        "ramp": "viridis",
        "domains": {
            "lgd":        [28, 40],
            "ward":       [15, 55],
            "settlement": [15, 50],
        },
    },
    {
        "slug":     "unemployed",
        "headline": "Unemployed",
        "name":     "Unemployed (Census 2021, by {label})",
        "csv_prefix": "ms-h02-unemployed",
        "pct_col":  "Unemployed_pct",
        "table_columns": ["Geography", "Total", "Unemployed", "Unemployed_pct"],
        "source_table": "MS-H02 (Economic activity by sex)",
        "ramp": "viridis",
        "domains": {
            "lgd":        [1.5, 3.5],
            "ward":       [1, 5],
            "settlement": [1, 4],
        },
    },
    {
        "slug":     "work-from-home",
        "headline": "Work mainly at or from home",
        "name":     "Work mainly at or from home (Census 2021, by {label})",
        "csv_prefix": "ms-i01-work-from-home",
        "pct_col":  "WorkFromHome_pct",
        "table_columns": ["Geography", "Total", "WorkFromHome", "WorkFromHome_pct"],
        "source_table": "MS-I01 (Method of travel to work)",
        "ramp": "viridis",
        "domains": {
            "lgd":        [15, 25],
            "ward":       [10, 30],
            "settlement": [9, 28],
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
