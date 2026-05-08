"""Reproject FSU Catchment Boundaries — Gauged 2025 from EPSG:29902 (TM65
Irish Grid) to EPSG:4326. The earlier ingestion assumed EPSG:2157 (ITM)
which is a different projection — the result landed in the Atlantic.

Source shapefile is in 'TM65_Irish_Grid' (EPSG:29902). Reproject directly.
Map config labels by 'Stn_No' but the SHP column is 'STATION_NU'; rename
on output so the existing labelProperty keeps working.
"""
from pathlib import Path
import geopandas as gpd

SRC = Path('_tmp_fsu/2025 FSU Gauged Catchment Boundaries/2025 FSU Gauged Catchment Boundaries.shp')
OUT_DIR = Path('data/maps/environment')
OUT_DIR.mkdir(parents=True, exist_ok=True)

g = gpd.read_file(SRC)
print(f'loaded {len(g)} features in {g.crs}')
print(f'  bounds (source): {g.total_bounds}')

# Force the correct source CRS in case the .prj parsing was lossy
if g.crs is None:
    g = g.set_crs('EPSG:29902')
g = g.to_crs('EPSG:4326')
print(f'  bounds (4326): {g.total_bounds}')

# Rename STATION_NU -> Stn_No so the existing labelProperty matches
if 'STATION_NU' in g.columns and 'Stn_No' not in g.columns:
    g = g.rename(columns={'STATION_NU': 'Stn_No'})

base = OUT_DIR / 'opw-fsu-catchments-gauged.fgb'
if base.exists(): base.unlink()
g.to_file(base, driver='FlatGeobuf')
print(f'wrote {base}')
