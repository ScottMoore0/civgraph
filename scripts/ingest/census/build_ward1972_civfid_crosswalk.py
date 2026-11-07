#!/usr/bin/env python3
"""Map each 1972 ward's W72_ID to the civ_fid its vector tiles carry.

The 1971/1981 ward population CSV (data/census/derived/ward1972-pop-1981.csv) is keyed by
W72_ID ('<district-slug>--<ward-slug>'), which build_ward1972_pop_layer.py derives from a
spatial join because the published Wards_1972 layer has no unique code (see that script).
W72_ID was staged onto the FlatGeobuf files but never published, so the wards-1972 vector
tiles do not carry it. They carry civ_fid, the source row number build-test-pmtiles injects
and the layer's promoteId.

The MapLibre data-entry loader therefore joins this CSV through a crosswalk: W72_ID ->
civ_fid. This script derives W72_ID exactly as build_ward1972_pop_layer.py does (district
by representative point, Irish Grid), carries it onto the tile build's own source file by
the unique Area_SqKM attribute, and writes the row number as civ_fid.

Checks, all fatal: every tile-source row gets a key, keys are unique, and every W72_ID in
the population CSV is present.

    python scripts/ingest/census/build_ward1972_civfid_crosswalk.py [--root <main checkout>]

Inputs (gitignored, main checkout only):
    data/maps/local-government/Wards_1972.fgb.gz, LGD_1972.fgb.gz
    render/source-cache/vector-intake/wards-1972.fgb   (the tile build's source)
    data/census/derived/ward1972-pop-1981.csv
Output (tracked):
    data/database/census-join-crosswalks/wards-1972.json
"""
import argparse, csv, json, os, re, warnings
from pathlib import Path

warnings.filterwarnings('ignore')
import geopandas as gpd

REPO = Path(__file__).resolve().parents[3]


def slug(s):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', str(s).lower())).strip('-')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=str(REPO), help='checkout holding the gitignored inputs')
    args = ap.parse_args()
    root = Path(args.root)
    src = root / 'data/maps/local-government'

    w = gpd.read_file('/vsigzip/' + str(src / 'Wards_1972.fgb.gz')).to_crs(29902)
    d = gpd.read_file('/vsigzip/' + str(src / 'LGD_1972.fgb.gz')).to_crs(29902)
    dn = [c for c in d.columns if c.upper() in ('NAME', 'LGDNAME')][0]
    d = d[[dn, 'geometry']].rename(columns={dn: 'DIST'})
    p = w[['NAME', 'Area_SqKM', 'geometry']].copy()
    p['geometry'] = w.representative_point()
    j = gpd.sjoin(p, d, how='left', predicate='within')
    j = j[~j.index.duplicated(keep='first')]
    by_area = {}
    for r in j.itertuples():
        by_area[r.Area_SqKM] = f'{slug(r.DIST)}--{slug(r.NAME)}'

    tiles_src = gpd.read_file(root / 'render/source-cache/vector-intake/wards-1972.fgb')
    out = {}
    for civ_fid, area in enumerate(tiles_src['Area_SqKM']):
        key = by_area.get(area)
        if key is None:
            raise SystemExit(f'  row {civ_fid}: Area_SqKM {area!r} has no W72_ID')
        if key in out:
            raise SystemExit(f'  W72_ID collision: {key}')
        out[key] = civ_fid

    csv_keys = [r['W72_ID'] for r in csv.DictReader(open(root / 'data/census/derived/ward1972-pop-1981.csv', encoding='utf-8'))]
    missing = [k for k in csv_keys if k not in out]
    if missing:
        raise SystemExit(f'  {len(missing)} CSV keys absent, e.g. {missing[:5]}')

    dest = REPO / 'data/database/census-join-crosswalks/wards-1972.json'
    dest.parent.mkdir(parents=True, exist_ok=True)
    doc = {
        'description': 'W72_ID (ward1972-pop-1981.csv) -> civ_fid (wards-1972 vector tiles). '
                       'Built by scripts/ingest/census/build_ward1972_civfid_crosswalk.py.',
        'csvKey': 'W72_ID',
        'tileKey': 'civ_fid',
        'map': dict(sorted(out.items())),
    }
    dest.write_text(json.dumps(doc, indent=1) + '\n', encoding='utf-8')
    print(f'  {len(out)} wards; all {len(csv_keys)} CSV keys present; wrote {dest}')


if __name__ == '__main__':
    main()
