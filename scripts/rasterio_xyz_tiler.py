"""
Custom XYZ tile pyramid generator built on rasterio + mercantile + PIL.

Used because gdal2tiles.py expects a Python 3.10 install with osgeo bindings,
and `pip install gdal` fails on Windows without Visual Studio dev headers.
Rasterio's pre-built wheels handle our needs without that constraint.

Input: a Web Mercator (EPSG:3857) RGBA GeoTIFF.
Output: {out_dir}/{z}/{x}/{y}.png across the requested zoom range.

Tiles are 256×256, rendered using bilinear resampling. Tiles whose source
window contains only nodata are skipped (results in 404 at runtime which
the Leaflet renderer treats as transparent).
"""
import argparse
import io
import sys
from pathlib import Path

import mercantile
import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds

TILE_SIZE = 256


def render_tile(src, x, y, z):
    bounds = mercantile.xy_bounds(x, y, z)  # west, south, east, north in 3857
    try:
        window = from_bounds(bounds.left, bounds.bottom, bounds.right, bounds.top, src.transform)
    except Exception:
        return None
    if window.width <= 0 or window.height <= 0:
        return None
    data = src.read(
        out_shape=(src.count, TILE_SIZE, TILE_SIZE),
        window=window,
        resampling=Resampling.bilinear,
        boundless=True,
        fill_value=0,
    )
    if src.count == 4:
        rgba = np.transpose(data, (1, 2, 0)).astype(np.uint8)
    elif src.count == 3:
        rgba = np.dstack([np.transpose(data, (1, 2, 0)).astype(np.uint8),
                          np.full((TILE_SIZE, TILE_SIZE), 255, dtype=np.uint8)])
    else:
        return None
    if rgba[..., 3].max() == 0:
        return None
    img = Image.fromarray(rgba, mode='RGBA')
    buf = io.BytesIO()
    img.save(buf, 'PNG', optimize=True)
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src', help='Source EPSG:3857 RGBA GeoTIFF')
    ap.add_argument('out_dir', help='Output tile root')
    ap.add_argument('--minzoom', type=int, default=5)
    ap.add_argument('--maxzoom', type=int, default=13)
    args = ap.parse_args()

    src_path = Path(args.src)
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    with rasterio.open(src_path) as src:
        if src.crs.to_epsg() != 3857:
            print(f'ERROR: src CRS is {src.crs}, expected EPSG:3857', file=sys.stderr)
            return 1
        # Compute geographic bounds for mercantile.tiles()
        west, south, east, north = transform_bounds(src.crs, 'EPSG:4326', *src.bounds, densify_pts=21)
        for z in range(args.minzoom, args.maxzoom + 1):
            tiles = list(mercantile.tiles(west, south, east, north, z))
            written = 0
            for t in tiles:
                png = render_tile(src, t.x, t.y, t.z)
                if png is None:
                    continue
                tdir = out / str(t.z) / str(t.x)
                tdir.mkdir(parents=True, exist_ok=True)
                (tdir / f'{t.y}.png').write_bytes(png)
                written += 1
            print(f'z={z}: {written}/{len(tiles)} tiles')


if __name__ == '__main__':
    sys.exit(main() or 0)
