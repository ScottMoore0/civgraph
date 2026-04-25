#!/usr/bin/env python
"""Add DEA name, council name, and DEA-map vintage year to every per-DEA
election JSON under election-viewer-package/data/elections/local-government/.

Vintage rules:
  1973, 1977, 1981       -> DEAs from 1972/3 (post-reform initial set)
  1985, 1989             -> DEAs from 1984/5 (1984 review)
  1993, 1997, 2001, 2005, 2011 -> DEAs from 1992/3 (1993 review)
  2014, 2018-by, 2019, 2023    -> DEAs from 2014 (post-2014 reorg, 462 DEAs across 11 councils)

For pre-2014 dates the council comes from the per-date _council_map.json
already produced by ark_to_election_json.py. For 2014+ the council has to
be derived from the post-2014 DEA name; the existing elections_index.json
holds the council->DEA mapping, so we walk that.
"""
import json
from pathlib import Path
from collections import defaultdict

REPO = Path(__file__).resolve().parent.parent
ELECT_DIR = REPO / "election-viewer-package" / "data" / "elections" / "local-government"
INDEX_PATH = REPO / "election-viewer-package" / "data" / "elections_index.json"

DEA_VINTAGE = {
    "1973-05-30": "1972", "1977-05-18": "1972", "1981-05-20": "1972",
    "1985-05-15": "1984", "1989-05-17": "1984",
    "1993-05-19": "1992", "1997-05-21": "1992", "2001-06-07": "1992",
    "2005-05-05": "1992", "2011-05-05": "1992",
    "2014-05-22": "2014", "2018-10-18": "2014",
    "2019-05-02": "2014", "2023-05-18": "2014",
}

def main():
    # Build a (date, dea_name) -> council lookup from elections_index.json
    idx = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    name_to_council = {}   # (date, dea_name) -> council
    for body in idx.get("bodies", []):
        if body.get("bodyGroup") != "local-government": continue
        council = body["name"]
        for d in body.get("dates", []):
            for dea in d.get("constituencies", []):
                name_to_council[(d["date"], dea)] = council

    total_updated = 0
    total_skipped = 0
    for date_dir in sorted(ELECT_DIR.iterdir()):
        if not date_dir.is_dir(): continue
        date = date_dir.name
        vintage = DEA_VINTAGE.get(date)
        if not vintage:
            print(f"  unknown vintage for {date}, skipping")
            continue

        # Pre-2014 has _council_map.json from ark_to_election_json; use that
        # as the primary source. Fall back to elections_index.json mapping.
        cmap_path = date_dir / "_council_map.json"
        cmap = json.loads(cmap_path.read_text(encoding="utf-8")) if cmap_path.exists() else {}

        for jpath in sorted(date_dir.glob("*.json")):
            if jpath.stem.startswith("_"): continue
            data = json.loads(jpath.read_text(encoding="utf-8"))
            ci = data.get("Constituency", {}).get("countInfo")
            if not ci: continue
            dea_name = ci.get("Constituency_Name", "")
            slug = jpath.stem
            council = (cmap.get(slug, {}) or {}).get("council") \
                      or name_to_council.get((date, dea_name)) \
                      or ""
            ci["Council_Name"] = council
            ci["DEA_Vintage_Year"] = vintage
            jpath.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
            total_updated += 1
            if not council:
                total_skipped += 1
    print(f"Updated {total_updated} DEA JSONs ({total_skipped} without council found)")

if __name__ == "__main__":
    main()
