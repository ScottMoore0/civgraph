#!/usr/bin/env python3
"""Fill the holes in the island-wide 3D terrain (ireland-terrain-3d) from Copernicus GLO-30.

    python scripts/terrain/rebuild_island_terrain.py --glo <glo30.vrt> --work <dir> --stage base|deep [--workers N]

The layer's Terrarium elevation tiles (dem/{z}/{x}/{y}.png) and hillshade (hs/...) were built
from a folder of Copernicus GLO-30 tiles that lacked seven one-degree cells -- 52-54 N, 7-9 W:
the midlands, the south-west and the north-west -- and parts of the pyramid came out flat
(0 m) elsewhere too, central Belfast among them, from zoom 12 up. This repairs it in place:

  - a pixel keeps the elevation it has wherever that is above 0.5 m, so every 1 m OSNI LiDAR
    pixel and every good GLO-30 pixel is untouched; only an empty pixel (0 m) where GLO-30
    has land (> 1 m) is filled, from GLO-30 resampled bilinearly into the tile;
  - a tile is rewritten only when at least FILL_MIN of it was filled, so the two models'
    slightly different coastlines do not rewrite every coastal tile;
  - hillshade is the standard one (lit from 315 deg at 45 deg, z-factor 1 -- what the
    existing tiles match), grey and opaque over land, and fills only where the existing
    hillshade is transparent; above zoom 11 it is touched only where a hillshade tile exists.

Stage base does zooms 5-12 across the layer's bounds and records the zoom-12 tiles that
needed filling; stage deep does their descendants at 13-15, and at 16 those that exist.
Existing tiles are read from data.civgraph.net (the R2 key lists, existing-dem.txt and
existing-hs.txt in the work dir, say which exist). Output: <work>/out/{dem,hs}/{z}/{x}/{y}.png,
uploaded with upload-tile-pyramid-s3.mjs to data/maps/physical/ireland-terrain-3d/.
"""
import argparse
import io
import json
import math
import os
import time
import urllib.request
from multiprocessing import Pool

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import from_bounds as window_from_bounds

BOUNDS = (-10.9, 51.2, -5.2, 55.7)          # the layer's own bounds: west, south, east, north
CDN = 'https://data.civgraph.net/data/maps/physical/ireland-terrain-3d'
FILL_MIN = 0.005                            # share of a tile's pixels that must be empty land
WORLD = 20037508.342789244
SIZE = 256

G = {}


def tile_range(z):
    def xy(lon, lat):
        n = 2 ** z
        x = int((lon + 180) / 360 * n)
        y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
        return x, y
    x0, y0 = xy(BOUNDS[0], BOUNDS[3])
    x1, y1 = xy(BOUNDS[2], BOUNDS[1])
    return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


def merc_bounds(z, x, y, pad=0):
    span = 2 * WORLD / 2 ** z
    px = span / SIZE
    return (-WORLD + x * span - pad * px, WORLD - (y + 1) * span - pad * px,
            -WORLD + (x + 1) * span + pad * px, WORLD - y * span + pad * px)


def init(glo, work):
    G['src'] = rasterio.open(glo)
    G['work'] = work
    G['dem_keys'] = set(open(os.path.join(work, 'existing-dem.txt')).read().split())
    G['hs_keys'] = set(open(os.path.join(work, 'existing-hs.txt')).read().split())


def fetch(kind, z, x, y):
    if f'{z}/{x}/{y}.png' not in G[f'{kind}_keys']:
        return None
    for attempt in range(4):
        try:
            req = urllib.request.Request(f'{CDN}/{kind}/{z}/{x}/{y}.png', headers={'User-Agent': 'civgraph-terrain-rebuild'})
            return np.asarray(Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=60).read())).convert('RGBA')).astype(np.float64)
        except Exception:
            time.sleep(2 + attempt * 3)
    raise RuntimeError(f'could not fetch {kind}/{z}/{x}/{y}')


def glo_tile(z, x, y):
    """GLO-30 resampled into the tile, with a one-pixel margin for the hillshade."""
    b = merc_bounds(z, x, y, pad=1)
    w, s, e, n = transform_bounds('EPSG:3857', 'EPSG:4326', *b)
    src = G['src']
    win = window_from_bounds(w - 0.01, s - 0.01, e + 0.01, n + 0.01, src.transform)
    data = src.read(1, window=win, boundless=True, fill_value=0).astype(np.float32)
    out = np.zeros((SIZE + 2, SIZE + 2), np.float32)
    reproject(data, out, src_transform=src.window_transform(win), src_crs=src.crs,
              dst_transform=from_bounds(*b, SIZE + 2, SIZE + 2), dst_crs='EPSG:3857',
              resampling=Resampling.bilinear)
    return np.maximum(out, 0)


def terrarium_decode(rgba):
    return rgba[..., 0] * 256 + rgba[..., 1] + rgba[..., 2] / 256 - 32768


def terrarium_encode(h):
    v = np.clip(h, 0, None) + 32768
    r = np.floor(v / 256)
    g = np.floor(v) - r * 256
    b = np.floor((v - np.floor(v)) * 256)
    return np.dstack([r, g, b]).astype(np.uint8)


def hillshade(h, z, y):
    """Standard Horn hillshade, 315 deg / 45 deg, z-factor 1, on a (SIZE+2)^2 array."""
    n = 2 ** z
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 0.5) / n))))
    res = 2 * WORLD / n / SIZE * math.cos(math.radians(lat))
    a, b, c = h[:-2, :-2], h[:-2, 1:-1], h[:-2, 2:]
    d, f = h[1:-1, :-2], h[1:-1, 2:]
    g, hh, i = h[2:, :-2], h[2:, 1:-1], h[2:, 2:]
    dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * res)
    dzdy = ((g + 2 * hh + i) - (a + 2 * b + c)) / (8 * res)
    slope = np.arctan(np.hypot(dzdx, dzdy))
    aspect = np.arctan2(dzdy, -dzdx)
    zen, az = math.radians(45), math.radians(360 - 315 + 90)
    return np.clip(255 * (math.cos(zen) * np.cos(slope) + math.sin(zen) * np.sin(slope) * np.cos(az - aspect)), 1, 255)


def write(kind, z, x, y, arr, mode):
    path = os.path.join(G['work'], 'out', kind, str(z), str(x), f'{y}.png')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(arr, mode).save(path, optimize=False)


def do_tile(task):
    z, x, y = task
    new = glo_tile(z, x, y)
    old = fetch('dem', z, x, y)
    centre = new[1:-1, 1:-1]
    if old is None:
        h_old = np.zeros((SIZE, SIZE))
    else:
        h_old = terrarium_decode(old)
    filled = (h_old <= 0.5) & (centre > 1.0)
    share = float(filled.mean())
    if share < FILL_MIN:
        return (z, x, y, share, False)
    merged = np.where(filled, centre, h_old)
    write('dem', z, x, y, terrarium_encode(merged), 'RGB')
    # Hillshade: above zoom 11 only where the layer already has a hillshade tile.
    if z <= 11 or f'{z}/{x}/{y}.png' in G['hs_keys']:
        buf = new.copy()
        buf[1:-1, 1:-1] = merged
        shade = hillshade(buf, z, y)
        land = merged > 0.5
        hs_old = fetch('hs', z, x, y)
        grey = np.where(land, shade, 0)
        alpha = np.where(land, 255, 0)
        if hs_old is not None:
            # The old hillshade beside a hole was lit against a 0 m cliff: within two pixels
            # of anything filled it is recomputed, so no bright seam marks the join.
            near = filled.copy()
            for _ in range(2):
                near = near | np.roll(near, 1, 0) | np.roll(near, -1, 0) | np.roll(near, 1, 1) | np.roll(near, -1, 1)
            keep = (hs_old[..., 3] > 0) & ~near
            grey = np.where(keep, hs_old[..., 0], grey)
            alpha = np.where(keep, hs_old[..., 3], alpha)
        rgba = np.dstack([grey, grey, grey, alpha]).astype(np.uint8)
        write('hs', z, x, y, rgba, 'RGBA')
    return (z, x, y, share, True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--glo', required=True)
    ap.add_argument('--work', required=True)
    ap.add_argument('--stage', choices=['base', 'deep'], required=True)
    ap.add_argument('--workers', type=int, default=8)
    args = ap.parse_args()
    flagged_path = os.path.join(args.work, 'flagged-z12.json')
    if args.stage == 'base':
        tasks = [(z, x, y) for z in range(5, 13) for x, y in tile_range(z)]
    else:
        flagged = json.load(open(flagged_path))
        dem_keys = set(open(os.path.join(args.work, 'existing-dem.txt')).read().split())
        tasks = []
        for x12, y12 in flagged:
            for z in (13, 14, 15, 16):
                k = 2 ** (z - 12)
                for dx in range(k):
                    for dy in range(k):
                        x, y = x12 * k + dx, y12 * k + dy
                        if z < 16 or f'{z}/{x}/{y}.png' in dem_keys:
                            tasks.append((z, x, y))
    print(f'{args.stage}: {len(tasks)} tiles', flush=True)
    done, written, flag12 = 0, 0, []
    start = time.time()
    with Pool(args.workers, initializer=init, initargs=(args.glo, args.work)) as pool:
        for z, x, y, share, wrote in pool.imap_unordered(do_tile, tasks, chunksize=8):
            done += 1
            written += wrote
            if wrote and z == 12:
                flag12.append((x, y))
            if done % 2000 == 0:
                print(f'  {done}/{len(tasks)} done, {written} written, {time.time() - start:.0f}s', flush=True)
    if args.stage == 'base':
        json.dump(sorted(flag12), open(flagged_path, 'w'))
    print(f'{args.stage} finished: {written} of {len(tasks)} tiles rewritten'
          + (f'; {len(flag12)} zoom-12 tiles flagged for the deep stage' if args.stage == 'base' else ''), flush=True)


if __name__ == '__main__':
    main()
