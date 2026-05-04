"""
Compose all-Ireland District Electoral Divisions / Wards FGBs for 1971,
1977, and 1983 from per-province snapshots in
G:\\.shortcut-targets-by-id\\1j4OLdXiFQNherSNFjkYEeGLL0kJ_2Vfn\\Irish Digitised Boundaries\\EDs.

Recipes (per the readme files in that folder):
- 1971 = Connacht 1919 + Leinster 1971 + Munster 1971 + Ulster 1921
- 1977 = Connacht 1919 + Leinster 1977 + Munster 1971 + Ulster 1921
- 1983 = Connacht 1919 + Leinster 1977 + Munster 1983 + Ulster 1921

Output keeps only the five attributes common to every input province FGB:
ENGLISH, GAEILGE, CONTAE, COUNTY, PROVINCE.

Outputs to data/maps/electoral-divisions/ for upload to R2.
"""
from pathlib import Path
import geopandas as gpd
import pandas as pd

SRC = Path(r'G:\.shortcut-targets-by-id\1j4OLdXiFQNherSNFjkYEeGLL0kJ_2Vfn\Irish Digitised Boundaries\EDs')
ON_SITE = SRC / 'Files already on the site'
OUT_DIR = Path('data/maps/electoral-divisions')
OUT_DIR.mkdir(parents=True, exist_ok=True)

KEEP = ['ENGLISH', 'GAEILGE', 'CONTAE', 'COUNTY', 'PROVINCE']

CONN = ON_SITE / 'Wards_DEDs_Connacht_1919.fgb'
ULST = ON_SITE / 'Wards_DEDs_Ulster_1921.fgb'
LEIN_71 = SRC / 'Wards_DEDs_Leinster_1971.fgb'
LEIN_77 = ON_SITE / 'Wards_DEDs_Leinster_1977.fgb'
MUNS_71 = SRC / 'Wards_DEDs_Munster_1971.fgb'
MUNS_83 = ON_SITE / 'Wards_DEDs_Munster_1983.fgb'

RECIPES = {
    1971: [CONN, LEIN_71, MUNS_71, ULST],
    1977: [CONN, LEIN_77, MUNS_71, ULST],
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
    print(f'-> {out} ({len(merged)} features)', flush=True)
    merged.to_file(out, driver='FlatGeobuf')

print('Done.')
