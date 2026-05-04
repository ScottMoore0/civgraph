"""LOD ladder (-lod0, -lod1) for the composed 1980 all-Ireland ED FGB."""
from pathlib import Path
import geopandas as gpd

OUT_DIR = Path('data/maps/electoral-divisions')
LOD_LEVELS = [('-lod0', 0.005), ('-lod1', 0.0005)]
base = OUT_DIR / 'EDs_AllIreland_1980.fgb'

print(f'Loading {base.name} ...', flush=True)
g = gpd.read_file(base)
for suffix, tol in LOD_LEVELS:
    out = OUT_DIR / f'EDs_AllIreland_1980{suffix}.fgb'
    print(f'  -> {out.name} (tol {tol}) ...', flush=True)
    g_simp = g.copy()
    g_simp['geometry'] = g_simp.geometry.simplify(tolerance=tol, preserve_topology=True)
    g_simp.to_file(out, driver='FlatGeobuf')
print('Done.')
