#!/usr/bin/env python3
"""Render a thumbnail for every catalogue map that has none, from what the site draws.

    python scripts/render-catalogue-thumbnails.py            # every map without a thumbnail
    python scripts/render-catalogue-thumbnails.py --ids a,b  # just these
    python scripts/render-catalogue-thumbnails.py --dry-run  # list what would be rendered

regen-thumbnails.py draws from a map's own vector file, and so misses what has none: the
open-data layers the site serves only as vector tiles, raster tile layers and georeferenced
images. This takes each map's layers from render/metadata/maps-test-index.json -- the same
registry the map uses -- and reads the geometry from the vector tiles at a low zoom, or the
pixels from the raster tiles or image, then draws it with regen-thumbnails.py's renderer so
every thumbnail shares one style.

"Without a thumbnail" is what the catalogue sees: an id missing from
assets/thumbnails/manifest.json, which build-shared-shell-assets.mjs builds from the folder
less excluded-transparent.json. That list held 161 old transparent-background images; a
map re-rendered here comes off it.
"""
import gzip
import importlib.util
import io
import json
import math
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
os.chdir(ROOT)
spec = importlib.util.spec_from_file_location('regen', os.path.join(ROOT, 'scripts', 'regen-thumbnails.py'))
regen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(regen)

THUMBS = os.path.join(ROOT, 'assets', 'thumbnails')
EXCLUDED = os.path.join(THUMBS, 'excluded-transparent.json')
INDEX = os.path.join(ROOT, 'render', 'metadata', 'maps-test-index.json')
MAPS = os.path.join(ROOT, 'data', 'database', 'maps.json')
UA = {'User-Agent': 'civgraph-thumbnails/1.0 (https://civgraph.net)'}
HALF = 20037508.342789244
SESSION = requests.Session()
SESSION.headers.update(UA)


# ---- tile maths (Web Mercator, the thumbnail projection) ----------------------------------

def tile_xy(lon, lat, z):
    n = 2 ** z
    lat = max(min(lat, 85.0511), -85.0511)
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def tile_bounds(x, y, z):
    size = 2 * HALF / 2 ** z
    return -HALF + x * size, HALF - (y + 1) * size, -HALF + (x + 1) * size, HALF - y * size


def merc(lon, lat):
    return lon * HALF / 180.0, math.log(math.tan((90.0 + lat) * math.pi / 360.0)) * 6378137.0


def tiles_for(bounds, z):
    (south, west), (north, east) = bounds
    x0, y0 = tile_xy(west, north, z)
    x1, y1 = tile_xy(east, south, z)
    return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


def pick_zoom(bounds, lo, hi, most):
    """The deepest zoom at which the layer's extent is `most` tiles or fewer."""
    best = lo
    for z in range(lo, hi + 1):
        if len(tiles_for(bounds, z)) <= most:
            best = z
    return best


# ---- vector tiles -------------------------------------------------------------------------

def pmtiles_reader(url):
    from pmtiles.reader import Reader

    def get_bytes(offset, length):
        r = SESSION.get(url, headers={'Range': f'bytes={offset}-{offset + length - 1}'}, timeout=60)
        r.raise_for_status()
        return r.content
    return Reader(get_bytes)


def on_edge(p, q, e):
    """A segment lying along the tile's own edge is the cut, not the feature's boundary."""
    for axis in (0, 1):
        for v in (0.0, e):
            if abs(p[axis] - v) < 1e-6 and abs(q[axis] - v) < 1e-6:
                return True
    return False


def tile_geoms(data, layer_name, x, y, z, out):
    import mapbox_vector_tile
    from shapely.geometry import box, shape, mapping
    if data[:2] == b'\x1f\x8b':
        data = gzip.decompress(data)
    layers = mapbox_vector_tile.decode(data, default_options={'y_coord_down': True})
    layer = layers.get(layer_name) or (next(iter(layers.values())) if len(layers) == 1 else None)
    if not layer:
        return
    e = float(layer.get('extent', 4096))
    minx, miny, maxx, maxy = tile_bounds(x, y, z)
    sx, sy = (maxx - minx) / e, (maxy - miny) / e
    to_m = lambda c: (minx + c[0] * sx, maxy - c[1] * sy)
    frame = box(0, 0, e, e)
    for feat in layer['features']:
        try:
            geom = shape(feat['geometry']).intersection(frame)
        except Exception:
            continue
        if geom.is_empty:
            continue
        parts = getattr(geom, 'geoms', [geom])
        for g in parts:
            kind = g.geom_type
            if kind == 'Point':
                out['points'].append(to_m((g.x, g.y)))
            elif kind == 'LineString':
                out['lines'].append([to_m(c) for c in g.coords])
            elif kind == 'Polygon':
                # Outlines only, as regen draws polygons, less the segments along the cut.
                for ring in [g.exterior, *g.interiors]:
                    cs = list(ring.coords)
                    run = []
                    for p, q in zip(cs, cs[1:]):
                        if on_edge(p, q, e):
                            if len(run) > 1:
                                out['lines'].append([to_m(c) for c in run])
                            run = []
                            continue
                        if not run:
                            run = [p]
                        run.append(q)
                    if len(run) > 1:
                        out['lines'].append([to_m(c) for c in run])


def vector_geoms(entry):
    out = regen._empty_geoms()
    url = entry['tileUrl'].replace('pmtiles://', '')
    reader = pmtiles_reader(url)
    # The archive's own header, not the index, says which zooms hold data: the water-quality
    # layers are indexed to z12 and carry tiles only to z4.
    header = reader.header()
    hi = min(int(header.get('max_zoom', entry.get('maxzoom') or 12)), 10)
    lo = min(int(header.get('min_zoom', entry.get('minzoom') or 0)), hi)
    z = pick_zoom(entry['bounds'], lo, hi, 16)
    while z >= lo:
        for x, y in tiles_for(entry['bounds'], z):
            data = reader.get(z, x, y)
            if data:
                tile_geoms(data, entry.get('sourceLayer'), x, y, z, out)
        if out['polys'] or out['lines'] or out['points']:
            break
        z -= 1
    return out


# ---- rasters ------------------------------------------------------------------------------

def fetch_image(url):
    r = SESSION.get(url, timeout=60)
    if r.status_code != 200 or not r.content:
        return None
    try:
        return Image.open(io.BytesIO(r.content)).convert('RGBA')
    except Exception:
        return None


def raster_tiles(entry):
    tiles = entry.get('tiles')
    template = tiles[0] if isinstance(tiles, list) and tiles else tiles
    if not template:
        return None
    size = int(entry.get('tileSize') or 256)
    hi = int(entry.get('maxNativeZoom') or entry.get('maxzoom') or 12)
    lo = min(int(entry.get('minzoom') or 0), hi)
    z = pick_zoom(entry['bounds'], lo, hi, 16)
    tiles = tiles_for(entry['bounds'], z)
    xs, ys = sorted({t[0] for t in tiles}), sorted({t[1] for t in tiles})
    mosaic = Image.new('RGBA', (len(xs) * size, len(ys) * size), (0, 0, 0, 0))
    urls = {(x, y): template.replace('{z}', str(z)).replace('{x}', str(x)).replace('{y}', str(y)) for x, y in tiles}
    with ThreadPoolExecutor(8) as pool:
        for (x, y), im in zip(urls, pool.map(fetch_image, urls.values())):
            if im is not None:
                mosaic.paste(im.resize((size, size)), ((x - xs[0]) * size, (y - ys[0]) * size))
    if mosaic.getbbox() is None:
        return None
    minx, miny, _, _ = tile_bounds(xs[0], ys[-1], z)
    _, _, maxx, maxy = tile_bounds(xs[-1], ys[0], z)
    return np.asarray(mosaic), (minx, miny, maxx, maxy)


def raster_image(entry):
    im = fetch_image(entry['imageUrl'])
    if im is None:
        return None
    im.thumbnail((1024, 1024))
    (south, west), (north, east) = entry['bounds']
    minx, miny = merc(west, south)
    maxx, maxy = merc(east, north)
    return np.asarray(im), (minx, miny, maxx, maxy)


# ---- which maps ---------------------------------------------------------------------------

def catalogue_rows(maps):
    """Every row the catalogue can show, as (thumbnail id, map config)."""
    has_data = lambda m: (m.get('files') or m.get('variants') or m.get('members') or m.get('chunked'))
    for m in maps:
        if m.get('hidden') or not has_data(m):
            continue
        yield m.get('cloneOf') or m['id'], m
        for v in m.get('variants') or []:
            if not v.get('hidden'):
                yield v.get('cloneOf') or v['id'], {**m, **v, 'style': v.get('style') or m.get('style')}


def entries_for(tid, config, layers):
    ids = {tid, config['id']} | {v['id'] for v in config.get('variants') or []}
    found = [e for e in layers if e.get('sourceMapId') in ids]
    if not found:   # a group drawn as one layer per part: eds-roi-1936 as its provinces
        found = [e for e in layers if str(e.get('sourceMapId') or '').startswith(tid + '-')]
    return found


def render_one(tid, config, entries, land):
    out = os.path.join(THUMBS, tid + '.png')
    rasters = [e for e in entries if e.get('sourceType') in ('raster', 'image')]
    if rasters:
        e = rasters[0]
        got = raster_image(e) if e['sourceType'] == 'image' else raster_tiles(e)
        if got is None:
            return 'raster unreadable'
        return 'ok' if regen.render_thumbnail(config, land, out, raster=got) else 'empty'
    geoms = regen._empty_geoms()
    for e in entries:
        if e.get('sourceType') == 'pmtiles' and e.get('tileUrl'):
            regen._merge_geoms(geoms, vector_geoms(e))
    if not (geoms['polys'] or geoms['lines'] or geoms['points']):
        return 'no geometry in tiles'
    return 'ok' if regen.render_thumbnail(config, land, out, geoms=geoms) else 'empty'


_LAND = None


def _init_worker():
    global _LAND
    import matplotlib
    matplotlib.use('Agg')
    _LAND = regen.reproject_geojson_to_thumbnail_srs(regen.LAND_GEOJSON)['polys']


def _render_job(tid, config, entries):
    if not entries:
        return 'no layer to draw from'
    try:
        return render_one(tid, config, entries, _LAND)
    except Exception as exc:
        return f'failed: {exc}'


def main():
    maps = json.load(open(MAPS, encoding='utf-8'))['maps']
    layers = json.load(open(INDEX, encoding='utf-8'))['layers']
    listed = set(json.load(open(os.path.join(THUMBS, 'manifest.json'), encoding='utf-8')))
    excluded = json.load(open(EXCLUDED, encoding='utf-8')) if os.path.exists(EXCLUDED) else []
    only = set(sys.argv[sys.argv.index('--ids') + 1].split(',')) if '--ids' in sys.argv else None
    todo, seen = [], set()
    for tid, config in catalogue_rows(maps):
        if tid in seen or (only is not None and tid not in only) or (only is None and tid in listed):
            continue
        seen.add(tid)
        todo.append((tid, config, entries_for(tid, config, layers)))
    print(f'{len(todo)} thumbnail(s) to render; {sum(1 for t in todo if not t[2])} with no layer to draw from')
    if '--dry-run' in sys.argv:
        for tid, _, es in todo:
            print(f'  {tid}: {", ".join(sorted({e["sourceType"] for e in es})) or "NO LAYER"}')
        return
    # --fresh-hours N: a thumbnail written in the last N hours is already done (a resumed
    # run), and still counts as re-rendered when the exclusion list is updated below.
    results = {}
    if '--fresh-hours' in sys.argv:
        import time
        cutoff = time.time() - float(sys.argv[sys.argv.index('--fresh-hours') + 1]) * 3600
        for tid, _, _ in todo:
            p = os.path.join(THUMBS, tid + '.webp')
            if os.path.exists(p) and os.path.getmtime(p) > cutoff:
                results[tid] = 'ok'
        print(f'{len(results)} already rendered in this window')
    pending = [t for t in todo if t[0] not in results]
    # Each map is mostly waiting on tile requests, so they run side by side.
    from concurrent.futures import ProcessPoolExecutor, as_completed
    workers = int(sys.argv[sys.argv.index('--workers') + 1]) if '--workers' in sys.argv else 6
    with ProcessPoolExecutor(workers, initializer=_init_worker) as pool:
        futures = {pool.submit(_render_job, tid, config, es): tid for tid, config, es in pending}
        for i, fut in enumerate(as_completed(futures), 1):
            tid = futures[fut]
            try:
                results[tid] = fut.result()
            except Exception as exc:
                results[tid] = f'failed: {exc}'
            print(f'  [{i}/{len(pending)}] {tid}: {results[tid]}', flush=True)
    done = {t for t, r in results.items() if r == 'ok'}
    if excluded:
        kept = [x for x in excluded if x not in done]
        if len(kept) != len(excluded):
            json.dump(kept, open(EXCLUDED, 'w', encoding='utf-8'), indent=2)
            print(f'excluded-transparent.json: {len(excluded) - len(kept)} re-rendered and released')
    failed = {t: r for t, r in results.items() if r != 'ok'}
    print(f'\nrendered {len(done)}, not rendered {len(failed)}')
    for t, r in failed.items():
        print(f'  {t}: {r}')


if __name__ == '__main__':
    main()
