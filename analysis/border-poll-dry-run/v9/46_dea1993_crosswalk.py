#!/usr/bin/env python3
"""v9 phase 46 — DZ2021 -> pre-2014 DEA crosswalk, and the name matcher.

All thirteen NI local elections (1973-2023) are in the repo with full count detail.
Only three were ever used. The obstacle to the other ten is geography: 2014 was a
wholesale redrawing (26 councils -> 11, ~101 DEAs -> 80), not a revision, so pre-2014
results cannot be name-matched onto modern DEAs.

OSNI publishes largescale DEA boundaries for 1993 (101 features -- matching the
2011 election's 101 areas) and 2012 (80, the modern set). This builds:

    DZ2021 centroid  ->  DEA1993 polygon      (spatial, exact)
    election area name  ->  DEA1993 name      (normalised, council-disambiguated)

Once both hold, the phase-32 notional machinery can express any pre-2014 local
contest on the modern 80 DEAs.

The name matcher has to handle four families of mismatch, all observed in the data:
    LG11-NAM-CROTLIEVE   -> CROTLIEVE          (2014-era code prefix in older files)
    ANTRIM NORTHWEST     -> ANTRIM NORTH WEST  (compound direction spacing)
    GLENS / ORCHARD      -> THE GLENS / THE ORCHARD   (dropped leading article)
    LOUGH / PENINSULA    -> LARNE LOUGH / ARDS PENINSULA  (council context needed)
"""
import os, sys, json, re, collections
import numpy as np
import pandas as pd
import geopandas as gpd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')
# All four DEA vintages are published on the Civgraph R2 bucket; the sourceMapId in
# each election file says which vintage that contest was fought on:
#   deas-1972 -> 1973/1977/1981   deas-1984 -> 1985/1989
#   deas-1993 -> 1993..2011       deas-2012 -> 2014..2023
R2 = 'https://data.civgraph.net/data/maps/local-government/DEAs_{}.fgb'
VINTAGE_OF = {'1973': '1972', '1977': '1972', '1981': '1972',
              '1985': '1984', '1989': '1984',
              '1993': '1993', '1997': '1993', '2001': '1993',
              '2005': '1993', '2011': '1993'}
GEO = os.path.join(HERE, '_geo')
DZFGB = os.path.join(HERE, 'lps', 'DZ2021.fgb')

LOCAL = ['1973-05-30', '1977-05-18', '1981-05-20', '1985-05-15', '1989-05-17',
         '1993-05-19', '1997-05-21', '2001-06-07', '2005-05-05', '2011-05-05']
DIRECTIONS = [('NORTHWEST', 'NORTH WEST'), ('NORTHEAST', 'NORTH EAST'),
              ('SOUTHWEST', 'SOUTH WEST'), ('SOUTHEAST', 'SOUTH EAST')]


def norm(s):
    s = str(s).upper().strip()
    s = re.sub(r'^LG\d+-[A-Z]+-', '', s)      # 2014-era code prefix
    s = re.sub(r'\s+CORRECTED$', '', s)       # "Antrim Area C corrected"
    s = s.replace('-', ' ').replace('&', 'AND')
    s = re.sub(r'[^A-Z ]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def variants(name, council):
    """Candidate spellings for one election-area name, best first."""
    n = norm(name)
    c = norm(council) if council else ''
    out = [n]
    for a, b in DIRECTIONS:
        if a in n:
            out.append(n.replace(a, b))
        if b in n:
            out.append(n.replace(b, a))
    out += ['THE ' + n]
    # historic council-name aliases seen between the election files and the
    # boundary sets: Derry/Londonderry, and Newry vs Newry and Mourne
    for a, b in [('DERRY', 'LONDONDERRY'), ('LONDONDERRY', 'DERRY'),
                 ('NEWRY', 'NEWRY AND MOURNE')]:
        if n.startswith(a + ' '):
            out.append(b + n[len(a):])
    if n.startswith('THE '):
        out.append(n[4:])
    if c:
        out += [f'{c} {n}', n.replace(c, '').strip()]
        # first word of the council, e.g. LARNE from "LARNE BOROUGH"
        c0 = c.split()[0]
        out += [f'{c0} {n}', n.replace(c0, '').strip()]
    seen, uniq = set(), []
    for v in out:
        v = re.sub(r'\s+', ' ', v).strip()
        if v and v not in seen:
            seen.add(v)
            uniq.append(v)
    return uniq


def name_col(g):
    """The DEA name column differs by vintage: NAME in 1972, DEA in 1984/1993."""
    for c in ['NAME', 'DEA', 'FinalR_DEA']:
        if c in g.columns and g[c].astype(str).str.contains('[A-Za-z]').any():
            return c
    raise SystemExit(f"no name column in {list(g.columns)}")


def fetch(vintage):
    os.makedirs(GEO, exist_ok=True)
    path = os.path.join(GEO, f'DEAs_{vintage}.fgb')
    if not os.path.exists(path) or os.path.getsize(path) < 1000:
        import subprocess
        subprocess.run(['curl', '-fsSL', '--max-time', '300',
                        R2.format(vintage), '-o', path], check=True)
    return path


def build_crosswalk(vintage='1993'):
    dea = gpd.read_file(fetch(vintage))
    col = name_col(dea)
    dea = dea[[col, 'geometry']].rename(columns={col: 'DEA'})
    dea['key'] = dea.DEA.map(norm)
    dz = gpd.read_file(DZFGB)[['DZ2021_cd', 'geometry']]
    if dea.crs != dz.crs:
        dea = dea.to_crs(dz.crs)
    cent = dz.copy()
    cent['geometry'] = dz.geometry.representative_point()
    j = gpd.sjoin(cent, dea, how='left', predicate='within')
    j = j[~j.index.duplicated(keep='first')]
    miss = j.key.isna().sum()
    print(f"  DZ2021 -> DEA1993 by centroid: {len(j)-miss}/{len(j)} ({miss} unmatched)")
    if miss:
        un = j[j.key.isna()]
        snap = gpd.sjoin_nearest(cent.loc[un.index].to_crs(29902),
                                 dea.to_crs(29902), how='left')
        snap = snap[~snap.index.duplicated(keep='first')]
        j.loc[un.index, 'key'] = snap.key
        print(f"  after nearest-snap: {j.key.isna().sum()} unmatched")
    mapping = dict(zip(j.DZ2021_cd, j.key))
    json.dump(mapping, open(os.path.join(HERE, f'dz_dea{vintage}.json'), 'w'),
              ensure_ascii=False, indent=1)
    print(f"  distinct DEA1993 areas covered: {len(set(mapping.values()))}")
    return set(dea.key)


def main():
    print("=" * 74)
    print("DZ2021 -> pre-2014 DEA crosswalks (all vintages)")
    bkeys = {}
    for v in ['1972', '1984', '1993']:
        print(f"\n  vintage {v}:")
        bkeys[v] = build_crosswalk(v)

    print("\n  name matching, election area -> its OWN vintage's boundaries:")
    print(f"  {'contest':10} {'vint':>5} {'areas':>6} {'matched':>8} {'rate':>7}  unmatched")
    report = []
    for date in LOCAL:
        p = os.path.join(META, f'local-government-local-government-districts__{date}.json')
        if not os.path.exists(p):
            continue
        d = json.load(open(p, encoding='utf-8'))
        vint = VINTAGE_OF[date[:4]]
        keys = bkeys[vint]
        matched, unmatched, amap = 0, [], {}
        for r in d['results']:
            hit = None
            for v in variants(r['constituency'], r.get('localBody')):
                if v in keys:
                    hit = v
                    break
            if hit:
                matched += 1
                amap[r['constituency']] = hit
            else:
                unmatched.append(r['constituency'])
        n = len(d['results'])
        report.append({'contest': date[:4], 'vintage': vint, 'areas': n,
                       'matched': matched, 'rate': 100.0 * matched / n})
        print(f"  {date[:4]:10} {vint:>5} {n:6} {matched:8} {100*matched/n:6.1f}%  "
              f"{unmatched[:3] if unmatched else ''}")
        json.dump(amap, open(os.path.join(HERE, f'dea_map_{date[:4]}.json'), 'w'),
                  ensure_ascii=False)
    pd.DataFrame(report).to_csv(os.path.join(HERE, 'dea1993_match_report.csv'),
                                index=False)
    print("\n  wrote dz_dea1993.json and per-contest dea_map_<year>.json")


if __name__ == '__main__':
    main()
