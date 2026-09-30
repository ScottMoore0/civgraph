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


def mosaic(entry, template, decode=None):
    """Fetch a layer's tiles over its bounds and paste them into one image; returns
    (array, extent). `decode` turns each tile image into the array cell values."""
    size = int(entry.get('tileSize') or 256)
    hi = int(entry.get('maxNativeZoom') or entry.get('maxzoom') or 12)
    lo = min(int(entry.get('minzoom') or 0), hi)
    z = pick_zoom(entry['bounds'], lo, hi, 16)
    tiles = tiles_for(entry['bounds'], z)
    xs, ys = sorted({t[0] for t in tiles}), sorted({t[1] for t in tiles})
    urls = {(x, y): template.replace('{z}', str(z)).replace('{x}', str(x)).replace('{y}', str(y)) for x, y in tiles}
    out = None
    with ThreadPoolExecutor(8) as pool:
        for (x, y), im in zip(urls, pool.map(fetch_image, urls.values())):
            if im is None:
                continue
            cell = np.asarray(im.resize((size, size)))
            cell = decode(cell) if decode else cell
            if out is None:
                out = np.zeros((len(ys) * size, len(xs) * size) + cell.shape[2:], dtype=cell.dtype)
                if decode:
                    out[:] = np.nan
            out[(y - ys[0]) * size:(y - ys[0] + 1) * size, (x - xs[0]) * size:(x - xs[0] + 1) * size] = cell
    if out is None:
        return None
    minx, miny, _, _ = tile_bounds(xs[0], ys[-1], z)
    _, _, maxx, maxy = tile_bounds(xs[-1], ys[0], z)
    return out, (minx, miny, maxx, maxy), z


def terrain(entry, grey):
    """A hillshade of a terrain (Terrarium-encoded elevation) layer, as the 3D view shows it."""
    tiles = entry.get('tiles')
    template = tiles[0] if isinstance(tiles, list) else tiles

    def decode(a):
        a = a.astype(np.float64)
        h = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
        # Sea and no-data decode to 0 m; left clear so the relief sits on the land underlay.
        return np.where((a[..., 3] > 0) & (h > 0.5), h, np.nan)
    got = mosaic(entry, template, decode)
    if got is None:
        return None
    h, extent, z = got
    cell = 2 * HALF / (256 * 2 ** z)
    filled = np.where(np.isnan(h), np.nanmin(h) if np.isfinite(h).any() else 0, h)
    dy, dx = np.gradient(filled, cell)
    slope = np.arctan(np.hypot(dx, dy) * 3)          # relief exaggerated to read at 120 px
    aspect = np.arctan2(-dx, dy)
    az, alt = math.radians(315), math.radians(45)
    shade = np.clip(np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect), 0, 1)
    if grey:
        rgb = np.stack([shade] * 3, -1)
    else:
        import matplotlib
        lo, hi = np.nanpercentile(h, [2, 98]) if np.isfinite(h).any() else (0, 1)
        tint = matplotlib.colormaps['terrain'](np.clip((filled - lo) / max(hi - lo, 1), 0, 1) * 0.75 + 0.22)[..., :3]
        rgb = tint * (0.45 + 0.55 * shade[..., None])
    alpha = np.where(np.isnan(h), 0, 1)
    img = (np.dstack([rgb, alpha]) * 255).astype(np.uint8)
    return img, extent


def point_cloud(entry):
    """The points of a 3D Tiles point cloud's root preview, seen from above."""
    from py3dtiles.tileset.content import read_binary_tile_content
    from pyproj import Transformer
    base = entry['tilesetUrl'].split('?')[0].rsplit('/', 1)[0]
    tileset = SESSION.get(entry['tilesetUrl'], timeout=60).json()
    root = tileset['root']
    uri = (root.get('content') or {}).get('uri') or (root.get('content') or {}).get('url')
    import tempfile
    from pathlib import Path
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / os.path.basename(uri)
        path.write_bytes(SESSION.get(f'{base}/{uri}', timeout=120).content)
        tile = read_binary_tile_content(path)
    ft = tile.body.feature_table
    pos = ft.get_feature_position_array() if hasattr(ft, 'get_feature_position_array') else None
    if pos is None:
        pos = np.asarray(ft.body.position).reshape(-1, 3)
    pos = np.asarray(pos, dtype=np.float64).reshape(-1, 3)
    rtc = ft.header.data.get('RTC_CENTER') if hasattr(ft.header, 'data') else None
    if rtc:
        pos = pos + np.asarray(rtc)
    m = np.asarray(root.get('transform') or np.eye(4).flatten()).reshape(4, 4).T
    ecef = (m @ np.c_[pos, np.ones(len(pos))].T).T[:, :3]
    if len(ecef) > 60000:
        ecef = ecef[np.random.default_rng(0).choice(len(ecef), 60000, replace=False)]
    x, y, _ = Transformer.from_crs('EPSG:4978', 'EPSG:3857', always_xy=True).transform(ecef[:, 0], ecef[:, 1], ecef[:, 2])
    return {'polys': [], 'lines': [], 'points': list(zip(x, y))}


def census(entry, layers):
    """A choropleth of a census data entry: its geography's shapes coloured by the value,
    on the entry's own ramp and domain."""
    import csv
    import matplotlib
    from PIL import ImageDraw
    geo = next((e for e in layers if e.get('sourceMapId') == entry['geography'] and e.get('tileUrl')), None)
    if geo is None:
        return None
    rows = list(csv.DictReader(open(os.path.join(ROOT, entry['csv']), encoding='utf-8-sig')))

    def number(v):
        try:
            return float(str(v).replace(',', ''))
        except ValueError:
            return None
    reader = pmtiles_reader(geo['tileUrl'])
    header = reader.header()
    hi = min(int(header.get('max_zoom', 12)), 10)
    z = pick_zoom(geo['bounds'], min(int(header.get('min_zoom', 0)), hi), hi, 16)
    import mapbox_vector_tile
    from shapely.geometry import box, shape
    feats = []
    for x, y in tiles_for(geo['bounds'], z):
        data = reader.get(z, x, y)
        if not data:
            continue
        if data[:2] == b'\x1f\x8b':
            data = gzip.decompress(data)
        layer = next(iter(mapbox_vector_tile.decode(data, default_options={'y_coord_down': True}).values()), None)
        if not layer:
            continue
        e = float(layer.get('extent', 4096))
        minx, _, _, maxy = tile_bounds(x, y, z)
        s = (2 * HALF / 2 ** z) / e
        for f in layer['features']:
            try:
                g = shape(f['geometry']).intersection(box(0, 0, e, e))
            except Exception:   # an invalid ring in the tiles (sa-2011): repair, then clip
                from shapely.validation import make_valid
                g = make_valid(shape(f['geometry'])).intersection(box(0, 0, e, e))
            for part in getattr(g, 'geoms', [g]):
                if part.geom_type == 'Polygon' and not part.is_empty:
                    ring = [(minx + px * s, maxy - py * s) for px, py in part.exterior.coords]
                    feats.append((f.get('properties') or {}, ring))
    if not feats:
        return None
    # The join: `joinKey` names the tiles' property, but the CSV may call the same code
    # something else (settlements: Code in the tiles, GeographyCode in the CSV). Take the
    # CSV column and tile property that match on the most shapes.
    keys = {k for props, _ in feats for k in props}
    cols = [c for c in (rows[0].keys() if rows else []) if c != entry['valueColumn']]
    best, key, values = -1, None, {}
    for col in cols:
        codes = {str(r[col]).strip(): number(r.get(entry['valueColumn'])) for r in rows}
        for k in keys:
            hits = sum(1 for props, _ in feats if str(props.get(k, '')).strip() in codes)
            if hits > best:
                best, key, values = hits, k, {c: v for c, v in codes.items() if v is not None}
    if not values:
        return None
    lo, hi = (entry.get('domain') or [min(values.values()), max(values.values())])[:2]
    cmap = matplotlib.colormaps.get(entry.get('ramp') or 'viridis', matplotlib.colormaps['viridis'])
    xs = [p[0] for _, ring in feats for p in ring]
    ys = [p[1] for _, ring in feats for p in ring]
    extent = (min(xs), min(ys), max(xs), max(ys))
    size = 900
    sx = size / max(extent[2] - extent[0], 1)
    sy = size / max(extent[3] - extent[1], 1)
    s = min(sx, sy)
    w, h = max(1, int((extent[2] - extent[0]) * s)), max(1, int((extent[3] - extent[1]) * s))
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for props, ring in feats:
        v = values.get(str(props.get(key, '')).strip())
        if v is None:
            continue   # a shape the census does not report on (527 settlements, 223 with data)
        else:
            if entry.get('logarithmic') and v > 0 and lo > 0:
                t = (math.log(v) - math.log(lo)) / max(math.log(hi) - math.log(lo), 1e-9)
            else:
                t = (v - lo) / max(hi - lo, 1e-9)
            colour = tuple(int(c * 255) for c in cmap(min(max(t, 0), 1)))
        pts = [((px - extent[0]) * s, (extent[3] - py) * s) for px, py in ring]
        draw.polygon(pts, fill=colour)
        # A settlement is a few pixels across at the scale of Northern Ireland; below that
        # it is drawn as a dot big enough to carry its colour into a 60 px thumbnail.
        bx = [p[0] for p in pts]
        by = [p[1] for p in pts]
        if max(bx) - min(bx) < 14 and max(by) - min(by) < 14:
            cx, cy = sum(bx) / len(bx), sum(by) / len(by)
            draw.ellipse((cx - 9, cy - 9, cx + 9, cy + 9), fill=colour)
    extent = (extent[0], extent[3] - h / s, extent[0] + w / s, extent[3])
    return np.asarray(img), extent


# ---- which maps ---------------------------------------------------------------------------

def catalogue_rows(maps, layers):
    """Every row the catalogue can show, as (thumbnail id, map config): the maps, including
    those drawn only from a registered layer (the hill lists carry no files); the 3D terrain
    and point-cloud layers, registered but absent from maps.json; and the census data
    entries. Placeholders -- maps not yet digitised -- have nothing to draw."""
    drawn = {e.get('sourceMapId') for e in layers}
    has_data = lambda m: (m.get('files') or m.get('variants') or m.get('members') or m.get('chunked')
                          or m['id'] in drawn)
    known = set()
    for m in maps:
        known.add(m['id'])
        known.update(v['id'] for v in m.get('variants') or [])
        if m.get('hidden') or m.get('placeholder') or not has_data(m):
            continue
        yield m.get('cloneOf') or m['id'], m
        for v in m.get('variants') or []:
            if not v.get('hidden'):
                yield v.get('cloneOf') or v['id'], {**m, **v, 'style': v.get('style') or m.get('style')}
    for e in layers:
        sid = e.get('sourceMapId') or e.get('id')
        if e.get('sourceType') in ('raster-dem', 'point-cloud') and sid not in known:
            yield sid, {'id': sid, 'name': e.get('name', sid), 'category': e.get('category', ''),
                        'style': e.get('style') or {}}
    entries = json.load(open(os.path.join(ROOT, 'data', 'database', 'data-entries.json'), encoding='utf-8'))
    for d in entries.get('dataEntries', []):
        yield d['id'], {**d, 'isDataEntry': True}


def entries_for(tid, config, layers):
    ids = {tid, config['id']} | {v['id'] for v in config.get('variants') or []}
    found = [e for e in layers if e.get('sourceMapId') in ids]
    if not found:   # a group drawn as one layer per part: eds-roi-1936 as its provinces
        found = [e for e in layers if str(e.get('sourceMapId') or '').startswith(tid + '-')]
    return found


def render_one(tid, config, entries, land):
    out = os.path.join(THUMBS, tid + '.png')
    if config.get('isDataEntry'):
        got = census(config, _LAYERS)
        return ('ok' if regen.render_thumbnail(config, land, out, raster=got) else 'empty') if got else 'census shapes unreadable'
    dem = [e for e in entries if e.get('sourceType') == 'raster-dem']
    if dem:
        got = terrain(dem[0], grey=tid.endswith('-grey'))
        if not got:
            return 'terrain unreadable'
        # A catchment is framed on itself with no underlay; the island-wide layer keeps the
        # land beneath it, which is where its missing midland tiles would otherwise show.
        local = (got[1][2] - got[1][0]) < 150000
        return 'ok' if regen.render_thumbnail(config, land, out, raster=got, tight=local, land=not local) else 'empty'
    cloud = [e for e in entries if e.get('sourceType') == 'point-cloud']
    if cloud:
        return 'ok' if regen.render_thumbnail(config, land, out, geoms=point_cloud(cloud[0]), tight=True) else 'empty'
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
_LAYERS = None


def _init_worker():
    global _LAND, _LAYERS
    import matplotlib
    matplotlib.use('Agg')
    _LAND = regen.reproject_geojson_to_thumbnail_srs(regen.LAND_GEOJSON)['polys']
    _LAYERS = json.load(open(INDEX, encoding='utf-8'))['layers']


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
    for tid, config in catalogue_rows(maps, layers):
        if tid in seen or (only is not None and tid not in only) or (only is None and tid in listed):
            continue
        seen.add(tid)
        todo.append((tid, config, [{'sourceType': 'census'}] if config.get('isDataEntry') else entries_for(tid, config, layers)))
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
