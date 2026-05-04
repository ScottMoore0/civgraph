"""
Compose all-Ireland District Electoral Divisions/Wards FGB for 1980.

Recipe (per the readme):
  1980 = Connacht 1919 + Leinster 1977 + Munster 1980 + Ulster 1921

Note: Munster 1980 is in _tmp_eds_1980/ (recently delivered), not in the
shared Drive folder where the other province FGBs live.
"""
from pathlib import Path
import geopandas as gpd
import pandas as pd

SRC_SHARED = Path(r'G:\.shortcut-targets-by-id\1j4OLdXiFQNherSNFjkYEeGLL0kJ_2Vfn\Irish Digitised Boundaries\EDs\Files already on the site')
SRC_LOCAL_1980 = Path('_tmp_eds_1980')
OUT_DIR = Path('data/maps/electoral-divisions')
OUT_DIR.mkdir(parents=True, exist_ok=True)

KEEP = ['ENGLISH', 'GAEILGE', 'CONTAE', 'COUNTY', 'PROVINCE']

PARTS_1980 = [
    SRC_SHARED / 'Wards_DEDs_Connacht_1919.fgb',
    SRC_SHARED / 'Wards_DEDs_Leinster_1977.fgb',
    SRC_LOCAL_1980 / 'Wards_DEDs_Munster_1980.fgb',
    SRC_SHARED / 'Wards_DEDs_Ulster_1921.fgb',
]


def normalise(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    for col in KEEP:
        if col not in gdf.columns:
            gdf[col] = ''
    return gdf[KEEP + ['geometry']].copy()


pieces = []
for p in PARTS_1980:
    print(f'  loading {p.name} ...', flush=True)
    g = gpd.read_file(p)
    g = normalise(g)
    pieces.append(g)
merged = pd.concat(pieces, ignore_index=True)
merged = gpd.GeoDataFrame(merged, geometry='geometry', crs='EPSG:4326')
out = OUT_DIR / 'EDs_AllIreland_1980.fgb'
print(f'-> {out} ({len(merged)} features)', flush=True)
merged.to_file(out, driver='FlatGeobuf')
print('Done.')
