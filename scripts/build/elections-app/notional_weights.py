"""Notional-results weights for the Civgraph Elections app (Phase 4).

For a pair of boundary layers (old -> new), the share of each OLD area that falls in each NEW
area, two ways:
  areal       by land area (Irish Transverse Mercator, EPSG:2157);
  population  by 2021 usual residents, each 2021 Data Zone counted whole in the old and new area
              that hold its representative point (DZ2021 geometry from the census-areas chunks,
              populations from data/census/explorer-dz-series.json).
Notional votes in a new area = sum over old areas of weight(old -> new) x votes(old).

Written to site/apps/elections/notional/<old>__<new>.json (small, committed: open boundary data
and census counts only). Inputs are the gitignored boundary and census files of a full checkout (--repo, or CIVGRAPH_DATA_ROOT; default this checkout).

  python scripts/build/elections-app/notional_weights.py [--repo PATH] [--pair pc-2008:pc-2023]
"""
import argparse
import gzip
import io
import json
import os
import sys

import geopandas as gpd
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
WORKTREE = os.path.abspath(os.path.join(HERE, '..', '..', '..'))

# old layer -> new layer, with the property that names an area and the map layer ids the app uses.
PAIRS = {
    'pc-2008:pc-2023': {
        'old': {'file': 'pc-2008', 'name': 'PC_NAME', 'layer': 'pc-2008-vector', 'layers': ['pc-2008-vector', 'assembly-areas-2008-alias'], 'label': 'Constituencies of 2008 (Westminster from 2010, Assembly from 2011)'},
        'new': {'file': 'pc-2023', 'name': 'PC_NAME', 'layer': 'pc-2023-vector', 'layers': ['pc-2023-vector', 'assembly-areas-2023-alias'], 'label': 'Constituencies of 2023 (Westminster from 2024; the next Assembly election)'},
        'sources': ['Parliamentary Constituencies (Northern Ireland) Order 2008 (S.I. 2008/1486)', 'Parliamentary Constituencies Order 2023 (S.I. 2023/1230)'],
    },
}


def read_layer(repo, file):
    g = gpd.read_file(os.path.join(repo, 'render', 'source-cache', 'vector-intake', f'{file}.fgb'))
    if g.crs is None:
        g = g.set_crs(4326)
    return g


def read_data_zones(repo):
    folder = os.path.join(repo, 'data', 'maps', 'census-areas', 'chunks')
    parts = []
    for f in sorted(os.listdir(folder)):
        if f.startswith('dz-2021_') and f.endswith('.fgb.gz') and '_z' not in f:
            with gzip.open(os.path.join(folder, f)) as fh:
                parts.append(gpd.read_file(io.BytesIO(fh.read())))
    dz = gpd.GeoDataFrame(pd.concat(parts, ignore_index=True)).drop_duplicates('DZ2021_cd')
    if dz.crs is None:
        dz = dz.set_crs(4326)
    with open(os.path.join(repo, 'data', 'census', 'explorer-dz-series.json'), encoding='utf-8') as fh:
        series = json.load(fh)
    idx = [s['id'] for s in series['series']].index('population')
    years = series['series'][idx]['years']
    col = 3 + idx
    pop = {}
    rows = series['rows'].items() if isinstance(series['rows'], dict) else series['rows']
    for code, row in rows:
        values = row[col]
        pop[code] = values[years.index(2021)] if values and len(values) == len(years) else None
    dz['pop'] = dz['DZ2021_cd'].map(pop)
    return dz


def weights(old, new, old_name, new_name, dz):
    o = old.to_crs(2157)[[old_name, 'geometry']].rename(columns={old_name: 'old'})
    n = new.to_crs(2157)[[new_name, 'geometry']].rename(columns={new_name: 'new'})
    o['old'] = o['old'].str.strip()
    n['new'] = n['new'].str.strip()
    inter = gpd.overlay(o, n, how='intersection', keep_geom_type=True)
    inter['a'] = inter.geometry.area
    tot = inter.groupby('old')['a'].transform('sum')
    inter['w'] = inter['a'] / tot
    areal = [[r.old, r.new, round(float(r.w), 5)] for r in inter.itertuples() if r.w >= 0.0005]
    pts = dz.to_crs(2157).copy()
    pts['geometry'] = pts.geometry.representative_point()
    pts = pts[pts['pop'].notna()]
    j = gpd.sjoin(pts, o, how='inner', predicate='within').drop(columns=['index_right'])
    j = gpd.sjoin(j, n, how='inner', predicate='within')
    g = j.groupby(['old', 'new'])['pop'].sum().reset_index()
    g['w'] = g['pop'] / g.groupby('old')['pop'].transform('sum')
    population = [[r.old, r.new, round(float(r.w), 5)] for r in g.itertuples() if r.w >= 0.0005]
    return areal, population, int(pts['pop'].sum()), int(j['pop'].sum())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', default=os.environ.get('CIVGRAPH_DATA_ROOT', WORKTREE),
                    help='the checkout holding the gitignored boundary and census inputs (read only); a worktree passes the main checkout')
    ap.add_argument('--pair', action='append', help='old:new (default: every pair)')
    ap.add_argument('--out', default=os.path.join(WORKTREE, 'site', 'apps', 'elections', 'notional'))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    dz = read_data_zones(a.repo)
    for key in a.pair or PAIRS:
        p = PAIRS[key]
        old = read_layer(a.repo, p['old']['file'])
        new = read_layer(a.repo, p['new']['file'])
        areal, population, pop_all, pop_used = weights(old, new, p['old']['name'], p['new']['name'], dz)
        doc = {
            'schemaVersion': 1,
            'old': {k: v for k, v in p['old'].items() if k != 'file'} | {'id': p['old']['file'], 'areas': sorted(old[p['old']['name']].str.strip().unique().tolist())},
            'new': {k: v for k, v in p['new'].items() if k != 'file'} | {'id': p['new']['file'], 'areas': sorted(new[p['new']['name']].str.strip().unique().tolist())},
            'methods': {
                'areal': 'share of the old area\'s land area (EPSG:2157) inside each new area',
                'population': f'share of the old area\'s 2021 usual residents inside each new area, each Data Zone (2021) counted whole where its representative point falls; {pop_used:,} of {pop_all:,} residents placed',
            },
            'sources': p['sources'] + ['NISRA Census 2021, usual residents by Data Zone (via the Civgraph census explorer series)', 'NISRA Data Zones 2021 boundaries'],
            'weights': {'areal': areal, 'population': population},
        }
        out = os.path.join(a.out, f"{p['old']['file']}__{p['new']['file']}.json")
        with open(out, 'w', encoding='utf-8', newline='\n') as fh:
            json.dump(doc, fh, ensure_ascii=False, indent=1)
            fh.write('\n')
        print(f'{out}: {len(areal)} areal and {len(population)} population weights')


if __name__ == '__main__':
    sys.exit(main())
