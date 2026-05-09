"""
Compose all-Ireland District Electoral Divisions / Wards FGBs for 1971,
1977, 1980, and 1983 from per-province snapshots collected in the
collaborator's "Irish Digitised Boundaries" Drive folder.

Recipes (per the readme files in that folder):
- 1971 = Connacht 1919 + Leinster 1971 + Munster 1971 + Ulster 1921
- 1977 = Connacht 1919 + Leinster 1977 + Munster 1971 + Ulster 1921
- 1980 = Connacht 1919 + Leinster 1977 + Munster 1980 + Ulster 1921
        (Waterford extension changed Munster boundary in 1980 only)
- 1983 = Connacht 1919 + Leinster 1977 + Munster 1983 + Ulster 1921

SRC defaults to the local zip-extract directory used during ingest; if
the Drive folder is mounted at G:/ point SRC at the EDs subfolder
instead. The 2026-05-09 zip drop renamed Connacht_1919 and Ulster_1921
to drop the "Wards_" prefix; we accept either filename.

Output keeps only the five attributes common to every input province FGB:
ENGLISH, GAEILGE, CONTAE, COUNTY, PROVINCE.

Outputs to data/maps/electoral-divisions/ for upload to R2.
"""
from pathlib import Path
import geopandas as gpd
import pandas as pd

SRC = Path('_tmp_zip_extract')   # zip-extract layout; flat dir, all FGBs side-by-side
OUT_DIR = Path('data/maps/electoral-divisions')
OUT_DIR.mkdir(parents=True, exist_ok=True)

KEEP = ['ENGLISH', 'GAEILGE', 'CONTAE', 'COUNTY', 'PROVINCE']


def _first_existing(*candidates: Path) -> Path:
    for c in candidates:
        if c.exists(): return c
    raise SystemExit(f'none of these files exists: {[str(c) for c in candidates]}')


CONN = _first_existing(SRC / 'DEDs_Connacht_1919.fgb', SRC / 'Wards_DEDs_Connacht_1919.fgb')
ULST = _first_existing(SRC / 'DEDs_Ulster_1921.fgb', SRC / 'Wards_DEDs_Ulster_1921.fgb')
LEIN_71 = SRC / 'Wards_DEDs_Leinster_1971.fgb'
LEIN_77 = SRC / 'Wards_DEDs_Leinster_1977.fgb'
MUNS_71 = SRC / 'Wards_DEDs_Munster_1971.fgb'
MUNS_80 = SRC / 'Wards_DEDs_Munster_1980.fgb'
MUNS_83 = SRC / 'Wards_DEDs_Munster_1983.fgb'

RECIPES = {
    1971: [CONN, LEIN_71, MUNS_71, ULST],
    1977: [CONN, LEIN_77, MUNS_71, ULST],
    1980: [CONN, LEIN_77, MUNS_80, ULST],
    1983: [CONN, LEIN_77, MUNS_83, ULST],
}


def normalise(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    for col in KEEP:
        if col not in gdf.columns:
            gdf[col] = ''
    return gdf[KEEP + ['geometry']].copy()


for year, parts in RECIPES.items():
    pieces = []
    for p in parts:
        print(f'  loading {p.name} ...', flush=True)
        g = gpd.read_file(p)
        g = normalise(g)
        pieces.append(g)
    merged = pd.concat(pieces, ignore_index=True)
    merged = gpd.GeoDataFrame(merged, geometry='geometry', crs='EPSG:4326')
    out = OUT_DIR / f'EDs_AllIreland_{year}.fgb'
    if out.exists(): out.unlink()
    print(f'-> {out} ({len(merged)} features)', flush=True)
    merged.to_file(out, driver='FlatGeobuf')

    for suf, tol in [('-lod0', 0.005), ('-lod1', 0.0005)]:
        lod_out = OUT_DIR / f'EDs_AllIreland_{year}{suf}.fgb'
        if lod_out.exists(): lod_out.unlink()
        gs = merged.copy()
        gs['geometry'] = gs.geometry.simplify(tolerance=tol, preserve_topology=True)
        gs.to_file(lod_out, driver='FlatGeobuf')
        print(f'  -> {lod_out.name}', flush=True)

print('Done.')
