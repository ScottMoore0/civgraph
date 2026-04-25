#!/usr/bin/env python
"""Update election-viewer-package/data/elections_index.json with per-council
bodies for the pre-2014 26-district NI local-government councils, using
the {slug -> council} lookup emitted by ark_to_election_json.py.

For each pre-2014 election date directory, read _council_map.json,
group DEAs by council, and add a body per council with each election it
contested. Replaces any prior pre-2014 council bodies on each run.
"""
import json
from pathlib import Path
from collections import defaultdict

REPO = Path(__file__).resolve().parent.parent
INDEX_PATH = REPO / "election-viewer-package" / "data" / "elections_index.json"
ELECT_DIR  = REPO / "election-viewer-package" / "data" / "elections" / "local-government"

DATES = ["1973-05-30", "1977-05-18", "1981-05-20", "1985-05-15", "1989-05-17",
         "1993-05-19", "1997-05-21", "2001-06-07", "2005-05-05", "2011-05-05"]

def main():
    idx = json.loads(INDEX_PATH.read_text(encoding="utf-8"))

    # council -> date -> [DEA names]
    bodies_by_council = defaultdict(lambda: defaultdict(list))
    uncategorised = defaultdict(list)
    total = 0

    for date in DATES:
        d = ELECT_DIR / date
        cmap_path = d / "_council_map.json"
        if not cmap_path.exists():
            continue
        cmap = json.loads(cmap_path.read_text(encoding="utf-8"))
        # Walk JSON files, look up council from cmap
        for jpath in sorted(d.glob("*.json")):
            if jpath.stem.startswith("_"): continue
            slug = jpath.stem
            data = json.loads(jpath.read_text(encoding="utf-8"))
            dea = data.get("Constituency", {}).get("countInfo", {}).get("Constituency_Name", "").strip()
            if not dea: continue
            entry = cmap.get(slug)
            if entry and entry.get("council"):
                bodies_by_council[entry["council"]][date].append(dea)
            else:
                uncategorised[date].append(dea)
            total += 1

    # Drop any prior pre-2014 council entries (we own the {councilName, slug:'local-government', bodyGroup:'local-government'} bodies that don't match the post-2014 set).
    POST_2014_COUNCILS = {
        "Antrim and Newtownabbey","Ards and North Down","Armagh, Banbridge and Craigavon",
        "Belfast","Causeway Coast and Glens","Derry and Strabane","Fermanagh and Omagh",
        "Lisburn and Castlereagh","Mid and East Antrim","Mid Ulster","Newry, Mourne and Down"
    }
    new_bodies = []
    for b in idx.get("bodies", []):
        # Keep non-local-government bodies and post-2014 LGs
        if b.get("bodyGroup") != "local-government":
            new_bodies.append(b); continue
        if b.get("name") in POST_2014_COUNCILS:
            new_bodies.append(b); continue
        # Drop everything else (prior runs of this script)

    for council in sorted(bodies_by_council.keys()):
        dates = []
        for date in DATES:
            if date in bodies_by_council[council]:
                deas = sorted(set(bodies_by_council[council][date]))
                dates.append({"date": date, "constituencies": deas})
        new_bodies.append({
            "name": council,
            "slug": "local-government",
            "bodyGroup": "local-government",
            "dates": dates
        })

    if uncategorised:
        unc_dates = []
        for date in DATES:
            if date in uncategorised and uncategorised[date]:
                unc_dates.append({"date": date, "constituencies": sorted(set(uncategorised[date]))})
        if unc_dates:
            new_bodies.append({
                "name": "Pre-2014 (unmapped)",
                "slug": "local-government",
                "bodyGroup": "local-government",
                "dates": unc_dates
            })

    idx["bodies"] = new_bodies
    INDEX_PATH.write_text(json.dumps(idx, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Total DEAs across pre-2014 elections: {total}")
    print(f"Pre-2014 councils registered: {len(bodies_by_council)}")
    for c in sorted(bodies_by_council):
        n_dates = sum(1 for d in DATES if d in bodies_by_council[c])
        n_deas  = sum(len(set(bodies_by_council[c][d])) for d in DATES if d in bodies_by_council[c])
        print(f"  {c}: {n_dates} elections, {n_deas} DEA-elections")
    if uncategorised:
        u_total = sum(len(v) for v in uncategorised.values())
        print(f"Unmapped: {u_total} DEA-elections (filename pattern didn't yield a council code)")

if __name__ == "__main__":
    main()
