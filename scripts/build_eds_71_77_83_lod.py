"""
Generate -lod0 (~500 m / tol 0.005°) and -lod1 (~50 m / tol 0.0005°)
simplifications for the three composed all-Ireland ED FGBs.
"""
from pathlib import Path
import geopandas as gpd

OUT_DIR = Path('data/maps/electoral-divisions')
LOD_LEVELS = [
    ('-lod0', 0.005),
    ('-lod1', 0.0005),
]

YEARS = [1971, 1977, 1983]

for year in YEARS:
    base = OUT_DIR / f'EDs_AllIreland_{year}.fgb'
    if not base.exists():
        print(f'  missing {base}')
        continue
    print(f'Loading {base.name} ...', flush=True)
    g = gpd.read_file(base)
    for suffix, tol in LOD_LEVELS:
        out = OUT_DIR / f'EDs_AllIreland_{year}{suffix}.fgb'
        print(f'  -> {out.name} (tol {tol}°) ...', flush=True)
        g_simp = g.copy()
        g_simp['geometry'] = g_simp.geometry.simplify(tolerance=tol, preserve_topology=True)
        g_simp.to_file(out, driver='FlatGeobuf')
print('Done.')
