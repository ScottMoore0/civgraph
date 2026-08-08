#!/usr/bin/env python3
"""Give the 1972 ward layer a unique join key, and emit the 1981 population CSV against it.

WHY A NEW KEY. The published Wards_1972 layer has no unique identifier, and this is not a
stylistic complaint -- it makes a correct join impossible:

    NAME       511 distinct across 526 features. 27 features sit in a duplicated-name
               group: CENTRAL appears 5 times, and CRANFIELD, DONAGHMORE, DROMORE, COURT,
               CRUMLIN, UNIVERSITY, VICTORIA, TOWN PARKS, STRAND, WEST, EAST twice each.
    OBJECTID   312 distinct of 526, and some are NaN. Unusable.
    Area_SqKM  unique, but it is a float. The data-entry loader joins with
               String(props[joinKey]) === String(row[csvKey]), so this would rest on
               JS and Python formatting the same double identically. Rejected.

The loader takes a single property, so a composite (district, ward) join is not available
either. Hence W72_ID, written onto the layer: '<district-slug>--<ward-slug>'.

WHY ONE SCRIPT DOES BOTH JOBS. The key is derived from a spatial join, so it exists
nowhere until computed. If the layer were stamped by one script and the CSV emitted by
another, the two derivations could drift and the join would fail silently -- the loader's
recolourFeature() simply returns on a miss, so a broken join looks like an unpopulated
map, not an error. Both outputs are therefore produced here, in one pass, from one
mapping.

WHY THE LOD FILES DO NOT NEED RE-SIMPLIFYING. Area_SqKM is an attribute, so simplification
carries it through untouched: it is unique in all three files (526/526/500) and every LOD
value is present in the full layer. So the key is computed once on the full layer and
propagated by exact Area_SqKM match. The published geometry is not recomputed or touched.

wards-1972 has useLOD, so the client shows lod0/lod1 when zoomed out. All three files
must carry the key or the choropleth would go blank at low zoom. Note lod0 holds 500
features, not 526 -- simplification drops the smallest polygons, which is exactly the
trap that earlier produced a confident and wholly wrong claim that the layer was missing
26 wards. 26 wards therefore go uncoloured at the coarsest zoom, and that is a property
of the published LOD file, not of this data.

OUTPUT IS STAGED, NOT PUBLISHED. The augmented layers are written to a staging directory;
the originals are left alone. Replacing the published files is an R2 upload, which is a
separate, approval-gated step.

Outputs:
    data/census/derived/ward1972-pop-1981.csv          (tracked)
    data/maps/local-government/staged-w72id/*.fgb      (gitignored; staged for upload)
"""
import os, re, csv, gzip, shutil, difflib, collections, warnings

warnings.filterwarnings('ignore')
import geopandas as gpd
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
# The .fgb files are gitignored (.gitignore: data/maps/**/*.fgb), so they exist only in
# the main checkout, never in a worktree.
SRC = str(Path(__file__).resolve().parents[2] / 'data/maps/local-government')
STAGE = os.path.join(REPO, 'data', 'maps', 'local-government', 'staged-w72id')
XWALK = os.path.join(REPO, 'data', 'census', 'derived', 'ward1972-crosswalk.csv')
OUTCSV = os.path.join(REPO, 'data', 'census', 'derived', 'ward1972-pop-1981.csv')

WARD_FULL = '/vsigzip/' + SRC + '/Wards_1972.fgb.gz'
LGD_FULL = '/vsigzip/' + SRC + '/LGD_1972.fgb.gz'
LODS = ['Wards_1972-lod1.fgb', 'Wards_1972-lod0.fgb']

POP = ['pop_1971_persons', 'pop_1971_males', 'pop_1971_females',
       'pop_1981_persons', 'pop_1981_males', 'pop_1981_females']
# Published NI totals. Nothing here is fitted to them; they are an end-to-end check.
CTRL = {'pop_1971_persons': 1536065, 'pop_1981_persons': 1490228}


def slug(s):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', str(s).lower())).strip('-')


def norm(s):
    return re.sub(r'[^a-z]', '', str(s).lower())


def districts_of_wards():
    """Attach each ward its 1972 district by point-in-polygon, in Irish Grid metres.

    representative_point(), not centroid: a concave or crescent ward can put its centroid
    outside itself, which would land the point in a neighbouring district.
    """
    w = gpd.read_file(WARD_FULL).to_crs(29902)
    d = gpd.read_file(LGD_FULL).to_crs(29902)
    dn = [c for c in d.columns if c.upper() in ('NAME', 'LGDNAME')][0]
    d = d[[dn, 'geometry']].rename(columns={dn: 'DIST'})
    p = w[['NAME', 'Area_SqKM', 'geometry']].copy()
    p['geometry'] = w.representative_point()
    j = gpd.sjoin(p, d, how='left', predicate='within')
    j = j[~j.index.duplicated(keep='first')]
    if j['DIST'].isna().any():
        raise SystemExit(f"  {int(j['DIST'].isna().sum())} wards fell outside every district")
    return j


def main():
    j = districts_of_wards()

    # --- the key. Unique by construction only if (district, ward) is unique; assert it.
    keys, by_area = {}, {}
    for r in j.itertuples():
        k = f'{slug(r.DIST)}--{slug(r.NAME)}'
        if k in keys:
            raise SystemExit(f'  W72_ID collision: {k}')
        keys[k] = {'district': r.DIST, 'ward': r.NAME}
        by_area[r.Area_SqKM] = k
    print(f'  layer: {len(keys)} wards, {len({v["district"] for v in keys.values()})} districts')

    # --- census district names are the scanner's; the layer's are canonical. Map them.
    xw = list(csv.DictReader(open(XWALK, encoding='utf-8')))
    ldist = sorted({v['district'] for v in keys.values()})
    dmap = {}
    for c in sorted({r['district'] for r in xw}):
        m = difflib.get_close_matches(norm(c), [norm(x) for x in ldist], n=1, cutoff=0.6)
        dmap[c] = next((x for x in ldist if norm(x) == m[0]), None) if m else None
    if [c for c, v in dmap.items() if v is None]:
        raise SystemExit(f'  unmapped census districts: {[c for c, v in dmap.items() if v is None]}')

    # --- join the population on (layer district, canonical ward name)
    rows, miss = [], []
    for r in xw:
        k = f"{slug(dmap[r['district']])}--{slug(r['ward_1972'])}"
        if k not in keys:
            miss.append((r['district'], r['ward_1972'], k))
            continue
        rows.append({'W72_ID': k, 'Geography': keys[k]['ward'],
                     'District': keys[k]['district'], 'CensusWard': r['census_ward'],
                     **{c: int(r[c]) for c in POP}})
    if miss:
        for m in miss[:10]:
            print(f'    UNJOINED {m[0]:16} {m[1]:24} -> {m[2]}')
        raise SystemExit(f'  {len(miss)} census rows did not join')
    if len(rows) != len(keys):
        raise SystemExit(f'  joined {len(rows)} of {len(keys)} layer wards')

    # 1971 -> 1981 change, as a percentage. Emitted here so the map colours by a column
    # rather than the loader having to compute one.
    for r in rows:
        a, b = r['pop_1971_persons'], r['pop_1981_persons']
        r['pop_change_pct'] = round((b - a) / a * 100, 1) if a else ''

    for col, want in CTRL.items():
        got = sum(r[col] for r in rows)
        flag = 'OK' if got == want else f'MISMATCH (want {want:,})'
        print(f'  {col:20} {got:>10,}  {flag}')
        if got != want:
            raise SystemExit('  checksum failed')

    os.makedirs(os.path.dirname(OUTCSV), exist_ok=True)
    with open(OUTCSV, 'w', encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(sorted(rows, key=lambda r: r['W72_ID']))
    print(f'  wrote {OUTCSV}  ({len(rows)} rows)')

    # --- stamp the key onto the layers. Geometry is read and rewritten untouched.
    os.makedirs(STAGE, exist_ok=True)
    for src, name in [(WARD_FULL, 'Wards_1972.fgb')] + \
                     [(SRC + '/' + f, f) for f in LODS]:
        g = gpd.read_file(src)
        g['W72_ID'] = g['Area_SqKM'].map(by_area)
        n_null = int(g['W72_ID'].isna().sum())
        if n_null:
            raise SystemExit(f'  {name}: {n_null} features got no key')
        if not g['W72_ID'].is_unique:
            raise SystemExit(f'  {name}: W72_ID not unique')
        out = os.path.join(STAGE, name)
        g.to_file(out, driver='FlatGeobuf')
        with open(out, 'rb') as a, gzip.open(out + '.gz', 'wb') as b:
            shutil.copyfileobj(a, b)
        dropped = len(keys) - len(g)
        note = f'  ({dropped} smallest polygons absent from this LOD)' if dropped else ''
        print(f'  stamped {name:22} {len(g):4} features{note}')

    print(f'\n  staged in {STAGE}')
    print('  NOT uploaded. Publishing these layers to R2 is a separate, approval-gated step.')


if __name__ == '__main__':
    main()
