"""
Fix bug 8: Tellus airborne maps don't load because their XYZ tile pyramids
were never generated/uploaded. The maps.json entries reference URLs like
data.civgraph.net/data/maps/geology/tellus-mag-tmi/{z}/{x}/{y}.png that
return 404.

This script processes the GSNI Tellus airborne ESRI File Geodatabases
(magnetics, electromagnetics, radiometrics) into XYZ tile pyramids ready
for upload to R2.

Inputs (already downloaded to D:\\tellus_airborne\\):
  - Tellus_Magnetics_ESRIGRID.zip      (601 MB)
  - Tellus_Electromagnetics_ESRIGRID.zip (236 MB)
  - Tellus_Radiometrics_ESRIGRID.zip   (178 MB)

Outputs at D:\\tellus_airborne\\tiles\\<layer-id>\\{z}/{x}/{y}.png:
  - tellus-mag-tmi      (Residual Total Magnetic Intensity)
  - tellus-mag-rtp      (Reduced-to-Pole)
  - tellus-mag-rtp-tilt (Tilt derivative of RTP)
  - tellus-em-3khz      (3 kHz Apparent Conductivity)
  - tellus-em-14khz     (14 kHz Apparent Conductivity)
  - tellus-rad-k        (Potassium %)
  - tellus-rad-u        (eU ppm)
  - tellus-rad-th       (eTh ppm)
  - tellus-rad-total    (Total Count)
  - tellus-rad-ternary  (RGB composite K=R, Th=G, U=B)

Pipeline per layer:
  1. Extract the relevant raster subdataset from the FGDB.
  2. Reproject to EPSG:4326 if needed.
  3. Byte-scale to 0-255 using mean ± 2.5σ (per project's geophysics
     colormap convention — outliers wash out the contrast otherwise).
  4. Apply the Tellus colour ramp via a colour-relief lookup table.
  5. Generate XYZ tile pyramid via gdal2tiles (zoom 5-13 to match the
     maxNativeZoom in maps.json).
  6. (Upload step in a separate shell loop using upload-tile-pyramid-s3.mjs.)

Estimated runtime: ~30-60 min per layer × 10 layers = 5-10 hours.
Best run as an overnight batch.

Subdataset name -> layer-id mapping (extracted from gdalinfo):
"""
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r'D:\tellus_airborne')
TILES = ROOT / 'tiles'

# Mapping: layer-id -> (gdb-relative-path, subdataset-suffix, colour-ramp)
# Subdataset names confirmed via `gdalinfo magnetics/Tellus_Magnetics_ESRIGRID.gdb`.
LAYERS = {
    # Magnetics (in Tellus_Magnetics_ESRIGRID.gdb)
    'tellus-mag-tmi':      ('magnetics/Tellus_Magnetics_ESRIGRID.gdb', 'TELLUS_Magnetic__Minc_from_V3_gdb__cellsize_35m__MAG_RES', 'rainbow'),
    'tellus-mag-rtp':      ('magnetics/Tellus_Magnetics_ESRIGRID.gdb', 'TELLUS_Magnetic__Minc_from_V3_gdb__cellsize_35m__MAG_RES___rtp', 'rainbow'),
    'tellus-mag-rtp-tilt': ('magnetics/Tellus_Magnetics_ESRIGRID.gdb', 'TELLUS_Magnetic__Minc_from_V3_gdb__cellsize_35m__MAG_RES___rtp___TiltD', 'rainbow'),
    # Electromagnetics + Radiometrics: subdataset names need to be discovered
    # by running gdalinfo on the extracted FGDBs. Add entries here once known.
}


def run(cmd, **kw):
    print(f'  $ {" ".join(str(c) for c in cmd)}', flush=True)
    return subprocess.run(cmd, check=True, **kw)


def extract_one(layer_id, gdb_rel, subdataset_name):
    src = f'OpenFileGDB:"{ROOT / gdb_rel}":{subdataset_name}'
    out = ROOT / f'{layer_id}-mercator.tif'
    if out.exists():
        return out
    # Reproject to Web Mercator (3857) for tiling, byte-scale via mean±2.5σ
    print(f'\n=== {layer_id} ===')
    # Step 1: extract + reproject to EPSG:3857 (single-band float32)
    run(['gdalwarp',
         '-of', 'GTiff',
         '-t_srs', 'EPSG:3857',
         '-r', 'bilinear',
         '-co', 'COMPRESS=LZW',
         '-co', 'TILED=YES',
         '-overwrite',
         src, str(out)])
    return out


def byte_scale(layer_id, src_tif):
    out = ROOT / f'{layer_id}-rgb.tif'
    if out.exists():
        return out
    # Use gdal_translate -scale with mean±2.5σ derived from gdalinfo -stats
    info = subprocess.check_output(['gdalinfo', '-stats', '-json', str(src_tif)])
    import json
    j = json.loads(info)
    band = j['bands'][0]
    mean, std = band['mean'], band['stdDev']
    lo, hi = mean - 2.5 * std, mean + 2.5 * std
    print(f'  scale {lo:.2f}..{hi:.2f} -> 0..255')
    run(['gdal_translate',
         '-of', 'GTiff',
         '-ot', 'Byte',
         '-scale', str(lo), str(hi), '0', '255',
         '-co', 'COMPRESS=LZW',
         str(src_tif), str(out)])
    return out


def tile(layer_id, src_tif):
    out_dir = TILES / layer_id
    if out_dir.exists() and any(out_dir.iterdir()):
        return out_dir
    run(['gdal2tiles.py',
         '-z', '5-13',
         '--xyz',
         '-w', 'none',
         '--processes', '4',
         str(src_tif), str(out_dir)])
    return out_dir


def main():
    if not LAYERS:
        print('No layers configured. Add entries to LAYERS dict.')
        return 1
    if not (ROOT / 'magnetics').exists():
        print(f'Extract zips into {ROOT}/ first (magnetics, electromagnetics, radiometrics)')
        return 1
    TILES.mkdir(exist_ok=True)
    for lid, (gdb, sub, _ramp) in LAYERS.items():
        t0 = time.time()
        merc = extract_one(lid, gdb, sub)
        rgb = byte_scale(lid, merc)
        td = tile(lid, rgb)
        print(f'  {lid}: tile pyramid in {td} ({time.time()-t0:.0f}s)')


if __name__ == '__main__':
    sys.exit(main() or 0)
