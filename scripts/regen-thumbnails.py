"""
Regenerate map thumbnails with a light grey landmass background
(Ireland, Britain, Isle of Man, etc.) for geographic context.

Usage:
    python scripts/regen-thumbnails.py [--map-id MAP_ID]

Without --map-id, regenerates ALL thumbnails.
"""
import json, os, sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MplPolygon
from matplotlib.collections import PatchCollection, LineCollection
import numpy as np

THUMB_DIR = 'assets/thumbnails'
MAPS_JSON = 'data/database/maps.json'
LAND_GEOJSON = 'british_isles_land.geojson'
MAX_SIZE = 120  # max dimension in pixels
DPI = 72
LAND_COLOR = '#d4d4d4'
LAND_EDGE = '#bfbfbf'
BG_COLOR = '#ffffff'
PADDING = 0.08  # 8% padding around features

TARGET_SRS = 'EPSG:29902'  # Irish Grid — equal-area, no distortion over Ireland/NI

EMPTY_GEOMS = {'polys': [], 'lines': [], 'points': []}

def _empty_geoms():
    return {'polys': [], 'lines': [], 'points': []}

def _coord_xy(c):
    """Force a coord (which may have z/m) to a 2-tuple."""
    return (c[0], c[1])

def _ring_xy(ring):
    return [_coord_xy(c) for c in ring]

def _poly_xy(poly):
    return [_ring_xy(r) for r in poly]

def _line_xy(line):
    return [_coord_xy(c) for c in line]

def load_geojson_geometries(path):
    """Load polygons, lines, and points from a GeoJSON file.
    Returns dict with keys 'polys' (list of ring-lists), 'lines' (list of
    coordinate sequences), and 'points' (list of [x, y]).
    Z/M coordinates are dropped to 2D."""
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    g = _empty_geoms()
    for feat in data.get('features', []):
        geom = feat.get('geometry') or {}
        gtype = geom.get('type', '')
        coords = geom.get('coordinates')
        if not coords:
            continue
        if gtype == 'Polygon':
            g['polys'].append(_poly_xy(coords))
        elif gtype == 'MultiPolygon':
            for poly in coords:
                g['polys'].append(_poly_xy(poly))
        elif gtype == 'LineString':
            g['lines'].append(_line_xy(coords))
        elif gtype == 'MultiLineString':
            for line in coords:
                g['lines'].append(_line_xy(line))
        elif gtype == 'Point':
            g['points'].append(_coord_xy(coords))
        elif gtype == 'MultiPoint':
            for pt in coords:
                g['points'].append(_coord_xy(pt))
    return g

def _ogr2ogr_to_geojson(src_path):
    """Convert src_path to GeoJSON in Irish Grid, trying SRS fallbacks for
    FGBs that lack embedded SRS. Returns geometries dict or None."""
    import subprocess, tempfile
    attempts = [
        ['-t_srs', TARGET_SRS],                          # source has SRS metadata
        ['-s_srs', 'EPSG:4326', '-t_srs', TARGET_SRS],   # assume WGS84 source
        ['-s_srs', TARGET_SRS, '-t_srs', TARGET_SRS],    # already Irish Grid
        ['-s_srs', 'EPSG:29903', '-t_srs', TARGET_SRS],  # NI Irish Grid (TM65 variant)
        ['-s_srs', 'EPSG:2157', '-t_srs', TARGET_SRS],   # ITM
    ]
    for args in attempts:
        tmp = tempfile.mktemp(suffix='.geojson')
        try:
            r = subprocess.run(['ogr2ogr', '-f', 'GeoJSON', '-skipfailures',
                                *args, tmp, src_path],
                               capture_output=True, timeout=180)
            if r.returncode == 0 and os.path.exists(tmp) and os.path.getsize(tmp) > 200:
                geoms = load_geojson_geometries(tmp)
                if geoms['polys'] or geoms['lines'] or geoms['points']:
                    return geoms
        except Exception:
            pass
        finally:
            if os.path.exists(tmp):
                try: os.remove(tmp)
                except: pass
    return None

def load_fgb_geometries(path):
    """Load geometries from an FGB via ogr2ogr → temp GeoJSON in Irish Grid."""
    g = _ogr2ogr_to_geojson(path)
    return g if g is not None else _empty_geoms()

def reproject_geojson_to_irish_grid(src_path):
    """Reproject a GeoJSON file to Irish Grid via ogr2ogr."""
    g = _ogr2ogr_to_geojson(src_path)
    return g if g is not None else _empty_geoms()

def _merge_geoms(into, other):
    into['polys'].extend(other['polys'])
    into['lines'].extend(other['lines'])
    into['points'].extend(other['points'])

CACHE_DIR = '_tmp_thumb_cache'

def _cached_download(url, timeout=600):
    """Download URL into CACHE_DIR (idempotent). Returns local path or None."""
    import subprocess, hashlib
    os.makedirs(CACHE_DIR, exist_ok=True)
    name = hashlib.sha1(url.encode('utf-8')).hexdigest()[:16] + '_' + os.path.basename(url).split('?')[0]
    dst = os.path.join(CACHE_DIR, name)
    if os.path.exists(dst) and os.path.getsize(dst) > 100:
        return dst
    try:
        subprocess.run(['curl', '-fsSL', '-o', dst, url], check=True,
                       capture_output=True, timeout=timeout)
        if os.path.exists(dst) and os.path.getsize(dst) > 100:
            return dst
    except Exception:
        if os.path.exists(dst):
            try: os.remove(dst)
            except: pass
    return None

def _load_one_source(files):
    """Try GeoJSON/FGB local or remote for a single files dict."""
    geojson = files.get('geojson', '')
    if geojson and not geojson.startswith('http') and os.path.exists(geojson):
        return reproject_geojson_to_irish_grid(geojson)
    fgb = files.get('fgb', '')
    if fgb and not fgb.startswith('http') and os.path.exists(fgb):
        return load_fgb_geometries(fgb)
    # Prefer FGB over remote GeoJSON because FGB is significantly smaller
    if fgb and fgb.startswith('http'):
        cached = _cached_download(fgb)
        if cached:
            return load_fgb_geometries(cached)
    if geojson and geojson.startswith('http'):
        cached = _cached_download(geojson)
        if cached:
            return reproject_geojson_to_irish_grid(cached)
    return _empty_geoms()

def load_map_geometries(map_config):
    """Load geometries for a map (handles isGroup variants by aggregation)."""
    g = _load_one_source(map_config.get('files', {}) or {})
    has_any = g['polys'] or g['lines'] or g['points']
    if has_any:
        return g
    # Fall back to variants (covers isGroup parents)
    out = _empty_geoms()
    for v in map_config.get('variants', []) or []:
        _merge_geoms(out, _load_one_source(v.get('files', {}) or {}))
    return out

def polys_to_patches(polys, **kwargs):
    """Convert polygon coordinate lists to matplotlib patches."""
    patches = []
    for poly_rings in polys:
        if not poly_rings:
            continue
        exterior = np.array(poly_rings[0])
        if len(exterior) < 3:
            continue
        patches.append(MplPolygon(exterior, closed=True, **kwargs))
    return patches

def lines_to_segments(lines):
    """Convert line coordinate lists to numpy arrays for LineCollection."""
    out = []
    for line in lines:
        if line and len(line) >= 2:
            out.append(np.asarray(line))
    return out

def compute_bounds(geoms):
    """Compute bounding box from a {polys, lines, points} dict, or a
    bare list of polygons (back-compat with land polys)."""
    if isinstance(geoms, list):
        geoms = {'polys': geoms, 'lines': [], 'points': []}
    all_x, all_y = [], []
    for poly_rings in geoms.get('polys', []):
        if not poly_rings:
            continue
        for coord in poly_rings[0]:
            all_x.append(coord[0]); all_y.append(coord[1])
    for line in geoms.get('lines', []):
        for coord in line:
            all_x.append(coord[0]); all_y.append(coord[1])
    for pt in geoms.get('points', []):
        all_x.append(pt[0]); all_y.append(pt[1])
    if not all_x:
        return None
    return (min(all_x), min(all_y), max(all_x), max(all_y))

def render_thumbnail(map_config, land_polys, out_path):
    """Render a single thumbnail on a square canvas. Handles polygons,
    lines, and points; if a layer contains a mix, all are drawn."""
    geoms = load_map_geometries(map_config)
    if not (geoms['polys'] or geoms['lines'] or geoms['points']):
        return False

    bounds = compute_bounds(geoms)
    if not bounds:
        return False

    minx, miny, maxx, maxy = bounds
    dx = maxx - minx
    dy = maxy - miny
    # Point datasets clustered at one location → enforce a minimum extent
    # so the canvas isn't degenerate.
    if dx < 1e-6 and dy < 1e-6:
        # Pure single-point or coincident points — pad ±5km in Irish Grid metres
        minx -= 5000; maxx += 5000; miny -= 5000; maxy += 5000
        dx, dy = maxx - minx, maxy - miny
    elif dx < 1e-6 or dy < 1e-6:
        pad = max(dx, dy) * 0.5 + 1000
        minx -= pad; maxx += pad; miny -= pad; maxy += pad
        dx, dy = maxx - minx, maxy - miny

    # Add padding
    px, py = dx * PADDING, dy * PADDING
    minx -= px; maxx += px; miny -= py; maxy += py
    dx = maxx - minx
    dy = maxy - miny

    # Expand the shorter axis to make the viewport square in geographic coords
    if dx > dy:
        diff = dx - dy
        miny -= diff / 2
        maxy += diff / 2
    else:
        diff = dy - dx
        minx -= diff / 2
        maxx += diff / 2

    size = MAX_SIZE / DPI
    fig, ax = plt.subplots(1, 1, figsize=(size, size), dpi=DPI)
    ax.set_xlim(minx, maxx)
    ax.set_ylim(miny, maxy)
    ax.set_aspect('equal')
    ax.axis('off')
    fig.patch.set_facecolor('none')
    fig.patch.set_alpha(0)
    ax.set_facecolor('none')

    # Draw land background
    land_patches = polys_to_patches(land_polys)
    if land_patches:
        land_coll = PatchCollection(land_patches, facecolor=LAND_COLOR,
                                     edgecolor=LAND_EDGE, linewidth=0.3, zorder=1)
        ax.add_collection(land_coll)

    # Draw map features
    color = map_config.get('style', {}).get('color', '#3388ff')
    weight = map_config.get('style', {}).get('weight', 2)
    lw = max(0.5, weight * 0.4)

    if geoms['polys']:
        map_patches = polys_to_patches(geoms['polys'])
        if map_patches:
            ax.add_collection(PatchCollection(map_patches, facecolor='none',
                                              edgecolor=color, linewidth=lw, zorder=2))
    if geoms['lines']:
        segs = lines_to_segments(geoms['lines'])
        if segs:
            ax.add_collection(LineCollection(segs, colors=color,
                                             linewidths=lw, zorder=3))
    if geoms['points']:
        pts = np.asarray(geoms['points'])
        # Scale marker size down for dense datasets so big point clouds
        # stay legible at thumbnail resolution. Cap at the typical wf
        # marker size used elsewhere on the site.
        n = len(pts)
        msize = 6.0 if n <= 50 else (3.0 if n <= 1000 else 1.2)
        ax.scatter(pts[:, 0], pts[:, 1], s=msize, c=color,
                   edgecolors='none', alpha=0.85, zorder=4)

    fig.subplots_adjust(left=0, right=1, top=1, bottom=0)
    fig.savefig(out_path, dpi=DPI, transparent=True, bbox_inches='tight', pad_inches=0.02)
    plt.close(fig)
    # Also emit a WebP sibling — ~30-50% smaller than PNG at visually-identical
    # quality for thumbnails this small. HTML uses <picture><source srcset=".webp">
    # with PNG fallback for browsers that don't support WebP (effectively none
    # on the catalogue's target audience as of 2026, but cheap safety net).
    try:
        from PIL import Image
        with Image.open(out_path) as im:
            webp_path = os.path.splitext(out_path)[0] + '.webp'
            im.save(webp_path, 'WEBP', quality=80, method=6)
    except Exception as e:
        print(f'  (webp encode failed: {e})')
    return True

def main():
    filter_id = None
    missing_only = '--missing-only' in sys.argv
    if '--map-id' in sys.argv:
        idx = sys.argv.index('--map-id')
        if idx + 1 < len(sys.argv):
            filter_id = sys.argv[idx + 1]

    id_filter_set = None
    if '--ids' in sys.argv:
        idx = sys.argv.index('--ids')
        if idx + 1 < len(sys.argv):
            id_filter_set = set(sys.argv[idx + 1].split(','))

    with open(MAPS_JSON, 'r', encoding='utf-8') as f:
        data = json.load(f)

    land_geoms = reproject_geojson_to_irish_grid(LAND_GEOJSON)
    land_polys = land_geoms['polys']
    print(f'Loaded {len(land_polys)} land polygons')

    maps = data.get('maps', [])
    os.makedirs(THUMB_DIR, exist_ok=True)
    existing_thumbs = set(os.listdir(THUMB_DIR))

    success = 0
    skipped = 0
    failed = 0

    # Flatten parents + variants so id-filters can target variants too.
    iter_list = []
    for m in maps:
        iter_list.append(m)
        for v in (m.get('variants') or []):
            iter_list.append(v)

    for m in iter_list:
        mid = m['id']
        if filter_id and mid != filter_id:
            continue
        if id_filter_set and mid not in id_filter_set:
            continue
        if m.get('hidden') or m.get('placeholder') or m.get('incomplete'):
            continue

        # Use cloneOf if set
        clone = m.get('cloneOf')
        out_name = f'{clone or mid}.png'
        out_path = os.path.join(THUMB_DIR, out_name)
        if missing_only and out_name in existing_thumbs:
            continue

        print(f'  {mid}... ', end='', flush=True)
        try:
            ok = render_thumbnail(m, land_polys, out_path)
            if ok:
                print('OK')
                success += 1
            else:
                print('skipped (no geometries)')
                skipped += 1
        except Exception as e:
            print(f'FAILED: {e}')
            failed += 1

    print(f'\nDone: {success} rendered, {skipped} skipped, {failed} failed')

if __name__ == '__main__':
    main()
