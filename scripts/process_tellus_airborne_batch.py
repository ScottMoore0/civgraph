"""
Batch-process Tellus airborne grids into XYZ tile pyramids.

For each (layer-id, source FGDB, subdataset name):
  1. gdalwarp into EPSG:3857 GeoTIFF.
  2. Compute mean ± 2.5σ via gdalinfo -stats; gdaldem color-relief with rainbow ramp.
  3. Run scripts/rasterio_xyz_tiler.py to produce {z}/{x}/{y}.png tree.
Output goes to D:/tellus_airborne/tiles/<layer-id>/.

Caller follows up with upload-tile-pyramid-s3.mjs to push to R2.

Note: colour ramp is a generic spectral rainbow (low → blue, high → red). For
publishable cartography we'd want to match GSNI's Tellus reference palettes;
that's a follow-up.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r'D:\tellus_airborne')
TILES = ROOT / 'tiles'

SCRIPT = Path(__file__).resolve().parent / 'rasterio_xyz_tiler.py'

# (layer-id, gdb path under ROOT, subdataset name)
LAYERS = [
    # tellus-mag-tmi already done; included for re-runnability via skip check
    ('tellus-mag-tmi',      'magnetics/Tellus_Magnetics_ESRIGRID.gdb',
     'TELLUS_Magnetic__Minc_from_V3_gdb__cellsize_35m__MAG_RES'),
    ('tellus-mag-rtp',      'magnetics/Tellus_Magnetics_ESRIGRID.gdb',
     'TELLUS_Magnetic__Minc_from_V3_gdb__cellsize_35m__MAG_RES___rtp'),
    ('tellus-mag-rtp-tilt', 'magnetics/Tellus_Magnetics_ESRIGRID.gdb',
     'TELLUS_Magnetic__Minc_from_V3_gdb__cellsize_35m__MAG_RES___rtp___TiltD'),
    ('tellus-em-3khz',      'em/Tellus_Electromagnetics_ESRIGRID.gdb',
     'TELLUS_Electromagnetic__Minc_from_V3_gdb__cellsize_35m__3KHz_Acon_FLT'),
    ('tellus-em-14khz',     'em/Tellus_Electromagnetics_ESRIGRID.gdb',
     'TELLUS_Electromagnetic__Minc_from_V3_gdb__cellsize_35m__14KHz_Acon_FLT'),
    ('tellus-rad-k',        'rad/Tellus_Radiometrics_ESRIGRID.gdb',
     'TELLUS_Radiometric__Minc_from_V3_gdb__cellsize_35m__D_KAL_1'),
    ('tellus-rad-u',        'rad/Tellus_Radiometrics_ESRIGRID.gdb',
     'TELLUS_Radiometric__Minc_from_V3_gdb__cellsize_35m__D_URA_1'),
    ('tellus-rad-th',       'rad/Tellus_Radiometrics_ESRIGRID.gdb',
     'TELLUS_Radiometric__Minc_from_V3_gdb__cellsize_35m__D_THO_1'),
    ('tellus-rad-total',    'rad/Tellus_Radiometrics_ESRIGRID.gdb',
     'TELLUS_Radiometric__Minc_from_V3_gdb__cellsize_35m__D_TOT_CPS'),
]


def run(*cmd, **kw):
    print(f'  $ {" ".join(str(c) for c in cmd)}', flush=True)
    subprocess.run(cmd, check=True, **kw)


def make_color_relief(lo, hi, out_path):
    # 5-stop spectral rainbow (blue → cyan → green → yellow → red), transparent for nodata.
    a = lo
    b = lo + 0.25 * (hi - lo)
    c = (lo + hi) / 2
    d = lo + 0.75 * (hi - lo)
    e = hi
    out_path.write_text(
        f'{a:.4f} 30 60 200 255\n'
        f'{b:.4f} 50 180 240 255\n'
        f'{c:.4f} 50 240 50 255\n'
        f'{d:.4f} 240 240 50 255\n'
        f'{e:.4f} 240 50 30 255\n'
        'nv 0 0 0 0\n'
    )


def process_layer(layer_id, gdb_rel, subdataset):
    merc = ROOT / f'{layer_id}-merc.tif'
    rgba = ROOT / f'{layer_id}-rgba.tif'
    tiles_dir = TILES / layer_id

    if tiles_dir.exists() and any(tiles_dir.iterdir()):
        print(f'\n=== {layer_id}: tiles already exist, skip ===')
        return

    print(f'\n=== {layer_id} ===')
    t0 = time.time()
    if not merc.exists():
        src = f'OpenFileGDB:"{ROOT / gdb_rel}":{subdataset}'
        run('gdalwarp', '-of', 'GTiff', '-t_srs', 'EPSG:3857',
            '-r', 'bilinear', '-co', 'COMPRESS=LZW', '-co', 'TILED=YES',
            '-overwrite', src, str(merc))
    if not rgba.exists():
        info = subprocess.check_output(['gdalinfo', '-stats', '-json', str(merc)])
        band = json.loads(info)['bands'][0]
        mean, std = band['mean'], band['stdDev']
        lo, hi = mean - 2.5 * std, mean + 2.5 * std
        print(f'  scale [{lo:.2f}..{hi:.2f}]  mean={mean:.2f} std={std:.2f}')
        ramp = ROOT / f'{layer_id}-ramp.txt'
        make_color_relief(lo, hi, ramp)
        run('gdaldem', 'color-relief', str(merc), str(ramp), str(rgba),
            '-alpha', '-of', 'GTiff', '-co', 'COMPRESS=LZW', '-co', 'TILED=YES')
    tiles_dir.mkdir(parents=True, exist_ok=True)
    run(r'C:\Users\scomo\AppData\Local\Programs\Python\Python310\python.exe',
        str(SCRIPT), str(rgba), str(tiles_dir),
        '--minzoom', '5', '--maxzoom', '13')
    print(f'  done in {time.time()-t0:.0f}s')


def main():
    TILES.mkdir(exist_ok=True)
    for lid, gdb, sub in LAYERS:
        try:
            process_layer(lid, gdb, sub)
        except subprocess.CalledProcessError as e:
            print(f'  FAILED: {lid} ({e})')


if __name__ == '__main__':
    sys.exit(main() or 0)
