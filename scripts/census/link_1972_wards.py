#!/usr/bin/env python3
"""Link the 1981 ward census to the 1972 ward boundaries, by (district, ward).

The census names wards as the scanner read them; the boundary layer holds the canonical
spelling. So the layer repairs the census, not the other way round.

MATCH ON (DISTRICT, WARD), NEVER ON NAME ALONE. Twelve ward names recur across
districts, and unconstrained similarity proposed Belfast's Falls -> Mallusk and
Ardoyne -> Ardboe. Each district is therefore matched against its own wards only, which
is what makes a loose threshold safe: the pool is ~20 names, not 526.

USE THE FULL LAYER, NOT A LEVEL-OF-DETAIL FILE. Wards_1972-lod0.fgb holds 500 features
because simplification drops the smallest polygons -- the inner-city Belfast and
Londonderry wards. That produced a confident and wholly wrong conclusion that the layer
was missing 26 wards and that the loss was concentrated in urban districts. The full
layer has 526, exactly the census count, and every district's ward count agrees.

Four rules, each earned:
  1. exact, on the letters alone
  2. token set, ignoring word order -- the census writes 'Braniel Lower', the layer
     'LOWER BRANIEL'. Same ward, reversed.
  3. similarity within the district, at a threshold that would be reckless globally --
     'WhiiehiJl' -> WHITEHILL scores below 0.78
  4. forced pairing: if a district has exactly one census ward and one boundary ward
     left over, they are each other's only remaining candidate. That is what identifies
     'QXsins', a mangled column caption the parser admitted as a Lisburn ward, whose
     true name cannot be recovered from the scan at all.

Output: data/census/derived/ward1972-crosswalk.csv
"""
import os, re, csv, difflib, collections, warnings
import geopandas as gpd

warnings.filterwarnings('ignore')
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
MAPS = os.path.join(REPO, 'data', 'maps', 'local-government')
CEN = os.path.join(REPO, 'data', 'census', 'derived', 'ward1972-census-1981.csv')
OUT = os.path.join(REPO, 'data', 'census', 'derived', 'ward1972-crosswalk.csv')


def n(s):
    return re.sub(r'[^a-z]', '', str(s).lower())


def toks(s):
    return frozenset(re.findall(r'[a-z]+', str(s).lower()))


def load_geo(wards_fgb, lgd_fgb):
    w = gpd.read_file(wards_fgb).to_crs(29902)
    d = gpd.read_file(lgd_fgb).to_crs(29902)
    dn = [c for c in d.columns if c.upper() in ('NAME', 'LGDNAME')][0]
    d = d[[dn, 'geometry']].rename(columns={dn: 'DIST'})
    p = w[['NAME', 'geometry']].copy()
    p['geometry'] = w.representative_point()      # inside even for concave wards
    j = gpd.sjoin(p, d, how='left', predicate='within')
    j = j[~j.index.duplicated(keep='first')]
    return [{'ward': r.NAME, 'district': r.DIST} for r in j.itertuples()]


def main(wards_fgb, lgd_fgb):
    geo = load_geo(wards_fgb, lgd_fgb)
    cen = list(csv.DictReader(open(CEN, encoding='utf-8')))
    gi = collections.defaultdict(list)
    for g in geo:
        gi[g['district']].append(g['ward'])
    gd = sorted(gi)
    dmap = {}
    for c in sorted({r['district'] for r in cen}):
        m = difflib.get_close_matches(n(c), [n(x) for x in gd], n=1, cutoff=0.6)
        dmap[c] = next((x for x in gd if n(x) == m[0]), None) if m else None

    rows, how = [], collections.Counter()
    by_d = collections.defaultdict(list)
    for r in cen:
        by_d[r['district']].append(r)
    for dc, crs in by_d.items():
        pool = list(gi.get(dmap[dc], []))
        taken, pend = {}, []
        for r in crs:
            hit = next((g for g in pool if n(g) == n(r['ward'])), None)
            if hit is None:
                hit = next((g for g in pool if toks(g) == toks(r['ward'])), None)
                kind = 'token-order' if hit else None
            else:
                kind = 'exact'
            if hit is None:
                pend.append(r)
                continue
            pool.remove(hit); taken[id(r)] = (hit, kind)
        for r in list(pend):
            m = difflib.get_close_matches(n(r['ward']), [n(g) for g in pool],
                                          n=1, cutoff=0.62)
            if not m:
                continue
            hit = next(g for g in pool if n(g) == m[0])
            pool.remove(hit); taken[id(r)] = (hit, 'similar-in-district')
            pend.remove(r)
        if len(pend) == 1 and len(pool) == 1:
            taken[id(pend[0])] = (pool[0], 'forced-last-pair')
            pend, pool = [], []
        for r in crs:
            g, kind = taken.get(id(r), (None, 'UNMATCHED'))
            how[kind] += 1
            rows.append({'district': r['district'], 'census_ward': r['ward'],
                         'ward_1972': g or '', 'match': kind,
                         **{k: r[k] for k in r if k.startswith('pop_')}})
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)
    print(f"  census wards {len(cen)}   boundary wards {len(geo)}")
    for k, v in how.most_common():
        print(f"    {v:4}  {k}")
    for r in rows:
        if r['match'] not in ('exact',):
            print(f"      {r['match']:20} {r['district'][:14]:14} "
                  f"{r['census_ward'][:22]:22} -> {r['ward_1972']}")
    print(f"  wrote {OUT}")


if __name__ == '__main__':
    import sys
    main(sys.argv[1], sys.argv[2])
