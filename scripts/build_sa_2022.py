"""
Convert the downloaded CSO Small Areas 2022 ungeneralised GeoJSON
(EPSG:2157, Irish Transverse Mercator) to a WGS84 FGB plus -lod0/-lod1
simplifications, ready for upload to R2.
"""
from pathlib import Path
import geopandas as gpd

SRC = Path('_tmp_sa_2022/sa_2022.geojson')
OUT_DIR = Path('data/maps/local-government')
OUT_DIR.mkdir(parents=True, exist_ok=True)

print(f'Loading {SRC} ...', flush=True)
g = gpd.read_file(SRC)
print(f'  {len(g)} features in {g.crs}', flush=True)

# Reproject to WGS84 to match the rest of civgraph's serving CRS.
if str(g.crs).upper() != 'EPSG:4326':
    print('  reprojecting -> EPSG:4326', flush=True)
    g = g.to_crs('EPSG:4326')

# Drop columns that are huge / redundant (Shape__Area / Shape__Length /
# any *_Area / *_Length fields auto-added by ArcGIS) — keep the rest
# verbatim so labels and joins still work.
drop = [c for c in g.columns
        if c != 'geometry'
        and (c.lower().endswith('shape__area') or c.lower().endswith('shape__length')
             or c.lower().endswith('shape_area') or c.lower().endswith('shape_length'))]
if drop:
    print(f'  dropping {drop}', flush=True)
    g = g.drop(columns=drop)

print(f'  attrs: {[c for c in g.columns if c != "geometry"]}', flush=True)

base = OUT_DIR / 'ROI_Small_Areas_2022.fgb'
print(f'Writing {base} ...', flush=True)
g.to_file(base, driver='FlatGeobuf')

for suffix, tol in [('-lod0', 0.005), ('-lod1', 0.0005)]:
    out = OUT_DIR / f'ROI_Small_Areas_2022{suffix}.fgb'
    print(f'  -> {out.name} (tol {tol}) ...', flush=True)
    g_simp = g.copy()
    g_simp['geometry'] = g_simp.geometry.simplify(tolerance=tol, preserve_topology=True)
    g_simp.to_file(out, driver='FlatGeobuf')

print('Done.')
