"""
Fix bug 6: WFD / water-quality polygon layers don't load because their LOD
chains are missing on R2 (the runtime fetches -lod0.fgb / -lod1.fgb on the
basis of useLOD: true, gets 404, and fails to render).

For each affected wq-* layer:
  1. Download the main FGB from R2.
  2. Generate -lod0.fgb (~500m simplification) and -lod1.fgb (~50m).
  3. Gzip each variant.
  4. (Upload step is a separate shell loop using upload-large-file.mjs.)

Outputs land in a scratch dir _wq_lods/ at repo root, ready for the upload
step. Idempotent.
"""
import gzip
import io
import shutil
import time
from pathlib import Path

import geopandas as gpd
import requests

ROOT = Path(__file__).resolve().parent.parent
SCRATCH = ROOT / '_wq_lods'

# (slug, fgb url) per layer with useLOD:true and a real fgb on R2
LAYERS = [
    ('surface-water-bodies-status-20151',
     'https://data.civgraph.net/data/maps/water-quality/surface-water-bodies-status-20151.fgb'),
    ('wfd-river-water-bodies-2nd-cycle1',
     'https://data.civgraph.net/data/maps/water-quality/wfd-river-water-bodies-2nd-cycle1.fgb'),
    ('lake-water-bodies1',
     'https://data.civgraph.net/data/maps/water-quality/lake-water-bodies1.fgb'),
    ('northern-ireland-groundwater-bodies2',
     'https://data.civgraph.net/data/maps/water-quality/northern-ireland-groundwater-bodies2.fgb'),
    ('groundwater-drinking-water-protected-areas-dwpas1',
     'https://data.civgraph.net/data/maps/water-quality/groundwater-drinking-water-protected-areas-dwpas1.fgb'),
    ('surface-drinking-water-protected-areas1',
     'https://data.civgraph.net/data/maps/water-quality/surface-drinking-water-protected-areas1.fgb'),
    ('agricultural-critical-risk-areas',
     'https://data.civgraph.net/data/maps/water-quality/agricultural-critical-risk-areas.fgb'),
]

LOD_LEVELS = [
    ('-lod0.fgb', 0.005),   # ~500m
    ('-lod1.fgb', 0.0005),  # ~50m
]


def gzip_file(src: Path):
    dst = src.with_suffix(src.suffix + '.gz')
    with src.open('rb') as f_in, gzip.open(dst, 'wb', compresslevel=9) as f_out:
        shutil.copyfileobj(f_in, f_out)


def main():
    SCRATCH.mkdir(exist_ok=True)
    for slug, url in LAYERS:
        out_main = SCRATCH / f'{slug}.fgb'
        if not out_main.exists():
            print(f'fetching {url} ...')
            t0 = time.time()
            r = requests.get(url)
            r.raise_for_status()
            out_main.write_bytes(r.content)
            print(f'  {len(r.content)/1e6:.1f} MB in {time.time()-t0:.1f}s')
        gdf = gpd.read_file(out_main)
        print(f'  {slug}: {len(gdf)} features')
        for suffix, tol in LOD_LEVELS:
            lod = gdf.copy()
            lod['geometry'] = lod.geometry.simplify(tol, preserve_topology=True)
            out = SCRATCH / f'{slug}{suffix}'
            lod.to_file(out, driver='FlatGeobuf')
            gzip_file(out)
        gzip_file(out_main)
    print(f'done. files in {SCRATCH}/')


if __name__ == '__main__':
    main()
