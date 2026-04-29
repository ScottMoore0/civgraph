"""
Generate LOD0 / LOD1 simplified FGBs for the ROI Local Authorities vintages.

LOD-0 ({name}-lod0.fgb): tolerance 0.005° (~500m) for zoom 0-8
LOD-1 ({name}-lod1.fgb): tolerance 0.0005° (~50m) for zoom 8-12
LOD-2: original FGB file (no simplification)

Also writes .fgb.gz alongside each .fgb so the runtime's pre-compressed path works.
"""
import gzip
import shutil
import time
from pathlib import Path

import geopandas as gpd

ROOT = Path(__file__).resolve().parent.parent
LA_DIR = ROOT / 'data' / 'maps' / 'local-government'

YEARS = ['1966', '1977', '1980', '1985', '1986', '1994', '2002', '2008', '2014']

LOD_LEVELS = [
    ('-lod0.fgb', 0.005),   # ~500m
    ('-lod1.fgb', 0.0005),  # ~50m
]


def gzip_file(src: Path):
    dst = src.with_suffix(src.suffix + '.gz')
    with src.open('rb') as f_in, gzip.open(dst, 'wb', compresslevel=9) as f_out:
        shutil.copyfileobj(f_in, f_out)


def main():
    for y in YEARS:
        base = LA_DIR / f'ROI_Local_Authorities_{y}.fgb'
        if not base.exists():
            print(f'SKIP missing: {base}')
            continue
        t0 = time.time()
        gdf = gpd.read_file(base)
        for suffix, tol in LOD_LEVELS:
            simp = gdf.copy()
            simp['geometry'] = simp.geometry.simplify(tol, preserve_topology=True)
            out = base.with_name(base.stem + suffix)
            simp.to_file(out, driver='FlatGeobuf')
            gzip_file(out)
        gzip_file(base)
        print(f'  {y}: full {base.stat().st_size//1024} KB, lod0 {(base.with_name(base.stem+chr(45)+chr(108)+"od0.fgb")).stat().st_size//1024} KB, '
              f'lod1 {(base.with_name(base.stem+"-lod1.fgb")).stat().st_size//1024} KB '
              f'in {time.time()-t0:.1f}s')


if __name__ == '__main__':
    main()
