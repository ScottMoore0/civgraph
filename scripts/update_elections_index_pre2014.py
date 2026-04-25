#!/usr/bin/env python
"""Update election-viewer-package/data/elections_index.json with bodies
for the pre-2014 26-district NI local-government councils, covering the
ARK-derived election dates 1973-2011.

Each body is a council; each date entry lists the DEAs (constituencies)
in that council for that election.
"""
import json
import re
from pathlib import Path
from collections import defaultdict

REPO = Path(__file__).resolve().parent.parent
INDEX_PATH = REPO / "election-viewer-package" / "data" / "elections_index.json"
ELECT_DIR  = REPO / "election-viewer-package" / "data" / "elections" / "local-government"

DATES = ["1973-05-30", "1977-05-18", "1981-05-20", "1985-05-15", "1989-05-17",
         "1993-05-19", "1997-05-21", "2001-06-07", "2005-05-05", "2011-05-05"]

# DEA-name first-token -> pre-2014 council
COUNCIL_FROM_PREFIX = {
    "antrim": "Antrim",         "ards": "Ards",            "armagh": "Armagh",
    "ballymena": "Ballymena",   "ballymoney": "Ballymoney","banbridge": "Banbridge",
    "belfast": "Belfast",       "carrickfergus": "Carrickfergus","castlereagh": "Castlereagh",
    "coleraine": "Coleraine",   "cookstown": "Cookstown",  "craigavon": "Craigavon",
    "derry": "Derry",           "down": "Down",            "dungannon": "Dungannon",
    "fermanagh": "Fermanagh",   "larne": "Larne",          "limavady": "Limavady",
    "lisburn": "Lisburn",       "magherafelt": "Magherafelt","moyle": "Moyle",
    "newry": "Newry and Mourne", "newtownabbey": "Newtownabbey","north": "North Down",
    "omagh": "Omagh",           "strabane": "Strabane",
}

def main():
    idx = json.loads(INDEX_PATH.read_text(encoding="utf-8"))

    # council → date → [DEA names]
    bodies = defaultdict(lambda: defaultdict(list))

    for date in DATES:
        d = ELECT_DIR / date
        if not d.exists(): continue
        for jpath in sorted(d.glob("*.json")):
            if jpath.stem.startswith("_"): continue
            data = json.loads(jpath.read_text(encoding="utf-8"))
            dea = data.get("Constituency", {}).get("countInfo", {}).get("Constituency_Name", "").strip()
            if not dea: continue
            slug = jpath.stem
            # First word of slug → council
            first = slug.split("-", 1)[0]
            council = None
            if first in COUNCIL_FROM_PREFIX:
                council = COUNCIL_FROM_PREFIX[first]
            elif slug.startswith("north-down"):
                council = "North Down"
            elif slug.startswith("newry"):
                council = "Newry and Mourne"
            else:
                # Fall back: try first two-word match
                two = "-".join(slug.split("-", 2)[:2])
                council = COUNCIL_FROM_PREFIX.get(two, "Pre-2014 (uncategorised)")
            bodies[council][date].append(dea)

    # Drop any prior "Pre-2014 NI Local Government" entry then re-add.
    pre_name = "Pre-2014 NI Local Government"
    new_bodies_list = [b for b in idx.get("bodies", []) if b.get("name") != pre_name]

    # Single body containing every pre-2014 DEA per election. Per-council
    # subdivision is a separate piece of work that needs an era-dependent
    # DEA→council lookup; the data files themselves carry the DEA names
    # which are sufficient to render results.
    all_dates = []
    for date in DATES:
        all_deas = sorted(set(d for council in bodies for d in bodies[council].get(date, [])))
        if all_deas:
            all_dates.append({"date": date, "constituencies": all_deas})
    new_bodies_list.append({
        "name": pre_name,
        "slug": "local-government",
        "bodyGroup": "local-government",
        "dates": all_dates
    })

    idx["bodies"] = new_bodies_list
    INDEX_PATH.write_text(json.dumps(idx, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"updated {INDEX_PATH}")
    print(f"pre-2014 councils registered: {len(bodies)}")
    for c in sorted(bodies):
        n_dates = sum(1 for d in DATES if d in bodies[c])
        n_deas = sum(len(bodies[c][d]) for d in bodies[c])
        print(f"  {c}: {n_dates} elections, {n_deas} total DEA entries")

if __name__ == "__main__":
    main()
