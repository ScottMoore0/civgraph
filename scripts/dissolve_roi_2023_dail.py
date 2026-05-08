"""Dissolve ROIConstituencies2023.fgb so each Dáil constituency is a single
MultiPolygon. Source has 1061 features for 43 constituencies (each island
in a multi-polygon constituency is its own row), which causes the election
viewer to render one set of TD circles per polygon. Dissolved output gives
exactly one row per ENG_NAME_VALUE.
"""
from pathlib import Path
import gzip, os, tempfile, urllib.request
import geopandas as gpd

ROOT = Path('data/maps/parliamentary')
URL = 'https://data.civgraph.net/data/maps/parliamentary/ROIConstituencies2023.fgb'
LOCAL = ROOT / 'ROIConstituencies2023.fgb'

def download():
    LOCAL.parent.mkdir(parents=True, exist_ok=True)
    if LOCAL.exists() and LOCAL.stat().st_size > 0:
        return
    print(f'downloading {URL} -> {LOCAL}', flush=True)
    import subprocess
    subprocess.check_call(['curl', '-s', URL, '-o', str(LOCAL)])

def main():
    download()
    g = gpd.read_file(LOCAL)
    print(f'loaded {len(g)} features in {g.crs}', flush=True)

    # Group by ENG_NAME_VALUE; keep the first value for non-geometry columns
    # (constituency-level attributes). Geometry is unioned with .union_all().
    name_col = 'ENG_NAME_VALUE'
    if name_col not in g.columns:
        raise SystemExit(f'expected column {name_col} not present')

    # GeoPandas dissolve will keep the first occurrence of each non-geometry
    # column from rows that share the dissolve key — exactly what we want
    # since constituency-level fields (BDY_ID, GLE_NAME_VALUE, etc.) are
    # constant per constituency.
    diss = g.dissolve(by=name_col, as_index=False)
    print(f'dissolved -> {len(diss)} rows', flush=True)

    # Re-order columns to match original (dissolve places dissolve key first)
    diss = diss[[c for c in g.columns]]

    base = ROOT / 'ROIConstituencies2023.fgb'
    if base.exists(): base.unlink()
    diss.to_file(base, driver='FlatGeobuf')

    for suf, tol in [('-lod0', 0.005), ('-lod1', 0.0005)]:
        out = ROOT / f'ROIConstituencies2023{suf}.fgb'
        if out.exists(): out.unlink()
        gs = diss.copy()
        gs['geometry'] = gs.geometry.simplify(tolerance=tol, preserve_topology=True)
        gs.to_file(out, driver='FlatGeobuf')
    print('done', flush=True)

if __name__ == '__main__':
    main()
