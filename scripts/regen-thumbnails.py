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
from matplotlib.collections import PatchCollection
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

def load_geojson_geometries(path):
    """Load polygons from a GeoJSON file. Returns list of (coords_list, is_multi)."""
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    polys = []
    for feat in data.get('features', []):
        geom = feat.get('geometry', {})
        gtype = geom.get('type', '')
        if gtype == 'Polygon':
            polys.append(geom['coordinates'])
        elif gtype == 'MultiPolygon':
            for poly_coords in geom['coordinates']:
                polys.append(poly_coords)
    return polys

def load_fgb_geometries(path):
    """Load polygons from FGB via ogr2ogr → temp GeoJSON, reprojected to Irish Grid."""
    import subprocess, tempfile
    tmp = tempfile.mktemp(suffix='.geojson')
    try:
        subprocess.run(['ogr2ogr', '-f', 'GeoJSON', '-t_srs', TARGET_SRS, tmp, path],
                       check=True, capture_output=True, timeout=60)
        return load_geojson_geometries(tmp)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)

def reproject_geojson_to_irish_grid(src_path):
    """Reproject a GeoJSON file to Irish Grid via ogr2ogr, return reprojected geometries."""
    import subprocess, tempfile
    tmp = tempfile.mktemp(suffix='.geojson')
    try:
        subprocess.run(['ogr2ogr', '-f', 'GeoJSON', '-t_srs', TARGET_SRS, tmp, src_path],
                       check=True, capture_output=True, timeout=60)
        return load_geojson_geometries(tmp)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)

def load_map_geometries(map_config):
    """Load geometries for a map, reprojecting to Irish Grid."""
    files = map_config.get('files', {})
    # Try local GeoJSON (reproject)
    geojson = files.get('geojson', '')
    if geojson and not geojson.startswith('http') and os.path.exists(geojson):
        return reproject_geojson_to_irish_grid(geojson)
    # Try local FGB (load_fgb_geometries already reprojects)
    fgb = files.get('fgb', '')
    if fgb and not fgb.startswith('http') and os.path.exists(fgb):
        return load_fgb_geometries(fgb)
    # Try remote FGB (download)
    if fgb and fgb.startswith('http'):
        import subprocess, tempfile
        tmp = tempfile.mktemp(suffix='.fgb')
        try:
            subprocess.run(['curl', '-sL', '-o', tmp, fgb], check=True,
                           capture_output=True, timeout=120)
            if os.path.getsize(tmp) > 100:
                return load_fgb_geometries(tmp)
        except:
            pass
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
    return []

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

def compute_bounds(polys):
    """Compute bounding box of all polygons."""
    all_x, all_y = [], []
    for poly_rings in polys:
        if not poly_rings:
            continue
        exterior = poly_rings[0]
        for coord in exterior:
            all_x.append(coord[0])
            all_y.append(coord[1])
    if not all_x:
        return None
    return (min(all_x), min(all_y), max(all_x), max(all_y))

def render_thumbnail(map_config, land_polys, out_path):
    """Render a single thumbnail on a square canvas."""
    map_polys = load_map_geometries(map_config)
    if not map_polys:
        return False

    bounds = compute_bounds(map_polys)
    if not bounds:
        return False

    minx, miny, maxx, maxy = bounds
    dx = maxx - minx
    dy = maxy - miny
    if dx < 1e-6 or dy < 1e-6:
        return False

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
    map_patches = polys_to_patches(map_polys)
    if map_patches:
        map_coll = PatchCollection(map_patches, facecolor='none',
                                    edgecolor=color, linewidth=max(0.5, weight * 0.4),
                                    zorder=2)
        ax.add_collection(map_coll)

    fig.subplots_adjust(left=0, right=1, top=1, bottom=0)
    fig.savefig(out_path, dpi=DPI, transparent=True, bbox_inches='tight', pad_inches=0.02)
    plt.close(fig)
    return True

def main():
    filter_id = None
    if '--map-id' in sys.argv:
        idx = sys.argv.index('--map-id')
        if idx + 1 < len(sys.argv):
            filter_id = sys.argv[idx + 1]

    with open(MAPS_JSON, 'r', encoding='utf-8') as f:
        data = json.load(f)

    land_polys = reproject_geojson_to_irish_grid(LAND_GEOJSON)
    print(f'Loaded {len(land_polys)} land polygons')

    maps = data.get('maps', [])
    os.makedirs(THUMB_DIR, exist_ok=True)

    success = 0
    skipped = 0
    failed = 0

    for m in maps:
        mid = m['id']
        if filter_id and mid != filter_id:
            continue
        if m.get('hidden'):
            continue
        if m.get('placeholder'):
            continue

        out_path = os.path.join(THUMB_DIR, f'{mid}.png')
        # Use cloneOf if set
        clone = m.get('cloneOf')
        if clone:
            out_path = os.path.join(THUMB_DIR, f'{clone}.png')

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
