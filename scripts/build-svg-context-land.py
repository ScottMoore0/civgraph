"""Build assets/map/context-land.json: the grey neighbouring land drawn under a map's
features in the "Download SVG" export (app/src/map-image-export.js).

Sources (all redistributable):
  * Island of Ireland: Civgraph's own outlines, data/maps/physical/NorthernIreland-lod1.fgb
    (OSNI, Open Government Licence v3.0) and RepublicOfIreland-lod1.fgb (Tailte Eireann,
    CC BY 4.0), unioned into one island polygon plus the land border as a line, so the grey
    island has no seam and the border is drawn once.
  * Great Britain, the Isle of Man, the Channel Islands, France, Belgium and the Faroes:
    Natural Earth 10m admin-0 map units v5.1.1 (public domain), clipped to the British Isles.

Coordinates are WGS84 degrees quantised to 1e-4 (about 7-11 m) and delta-encoded:
each ring/line is a flat list [x0, y0, dx1, dy1, ...] of integers.

Usage (Natural Earth zip unpacked anywhere, e.g. on E:):
  python scripts/build-svg-context-land.py <path/to/ne_10m_admin_0_map_units.shp>
"""
import json
import os
import subprocess
import sys
import tempfile

from shapely.geometry import shape, box, MultiPolygon, Polygon, LineString, MultiLineString
from shapely.ops import unary_union, linemerge

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'map', 'context-land.json')
Q = 10000
CLIP = box(-16.0, 47.0, 5.0, 63.0)
IRELAND_TOL = 0.0006
NE_TOL = 0.004
NE_UNITS = {
    'ENG': 'Great Britain', 'SCT': 'Great Britain', 'WLS': 'Great Britain',
    'IMN': 'Isle of Man', 'JEY': 'Jersey', 'GGY': 'Guernsey',
    'FXX': 'France', 'BFR': 'Belgium', 'BWR': 'Belgium', 'NLD': 'Netherlands', 'FRO': 'Faroe Islands',
}


def read_features(path, sql=None):
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, 'out.geojson')
        cmd = ['ogr2ogr', '-f', 'GeoJSON', out, path]
        if sql:
            cmd += ['-dialect', 'SQLite', '-sql', sql]
        subprocess.run(cmd, check=True, capture_output=True)
        with open(out, encoding='utf-8') as fh:
            return json.load(fh)['features']


def polygons(geom):
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return [g for g in getattr(geom, 'geoms', []) if isinstance(g, Polygon)]


def encode(coords):
    out = []
    px = py = 0
    first = True
    for x, y in coords:
        qx, qy = round(x * Q), round(y * Q)
        if first:
            out += [qx, qy]
            first = False
        else:
            if qx == px and qy == py:
                continue
            out += [qx - px, qy - py]
        px, py = qx, qy
    return out


def encode_polygon_geom(geom, min_area):
    rings = []
    for poly in polygons(geom):
        if poly.area < min_area:
            continue
        poly_rings = [encode(poly.exterior.coords)]
        for hole in poly.interiors:
            if Polygon(hole).area >= min_area:
                poly_rings.append(encode(hole.coords))
        rings.append(poly_rings)
    return rings


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    ne_path = sys.argv[1]
    physical = os.path.join(ROOT, 'data', 'maps', 'physical')
    ni = unary_union([shape(f['geometry']) for f in read_features(os.path.join(physical, 'NorthernIreland-lod1.fgb'))]).buffer(0)
    roi = unary_union([shape(f['geometry']) for f in read_features(os.path.join(physical, 'RepublicOfIreland-lod1.fgb'))]).buffer(0)
    # Close the hairline slivers along the shared border before simplifying.
    island = unary_union([ni.buffer(0.0003), roi.buffer(0.0003)]).buffer(-0.0003).simplify(IRELAND_TOL, preserve_topology=True)
    border = ni.boundary.intersection(roi.buffer(0.0015))
    if isinstance(border, (MultiLineString, LineString)):
        border = linemerge(border)
    border = border.simplify(IRELAND_TOL)
    border_lines = [g for g in (border.geoms if hasattr(border, 'geoms') else [border]) if isinstance(g, LineString) and g.length > 0.01]

    units = {}
    for f in read_features(ne_path):
        code = f['properties'].get('GU_A3')
        if code not in NE_UNITS:
            continue
        geom = shape(f['geometry']).intersection(CLIP)
        if geom.is_empty:
            continue
        units.setdefault(NE_UNITS[code], []).append(geom)

    features = [{'name': 'Ireland', 'kind': 'land', 'source': 'civgraph', 'rings': encode_polygon_geom(island, 2e-6)}]
    for name in sorted(units):
        geom = unary_union(units[name]).simplify(NE_TOL, preserve_topology=True)
        features.append({'name': name, 'kind': 'land', 'source': 'naturalearth', 'rings': encode_polygon_geom(geom, 4e-6)})
    features.append({'name': 'Northern Ireland - Republic of Ireland border', 'kind': 'border', 'source': 'civgraph',
                     'lines': [encode(line.coords) for line in border_lines]})

    doc = {
        'version': 1,
        'quantisation': Q,
        'encoding': 'Each ring or line is [x0, y0, dx1, dy1, ...]: integer degrees x 1e4, WGS84, deltas after the first point.',
        'credits': [
            'Island of Ireland: Civgraph outlines from OSNI (Open Government Licence v3.0) and Tailte Eireann (CC BY 4.0)',
            'Great Britain, Isle of Man and the Continent: Natural Earth 10m admin-0 map units v5.1.1 (public domain)',
        ],
        'features': features,
    }
    with open(OUT, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(doc, fh, separators=(',', ':'))
        fh.write('\n')
    pts = sum(len(r) // 2 for f in features for poly in f.get('rings', []) for r in poly) + sum(len(l) // 2 for f in features for l in f.get('lines', []))
    print(f'{OUT}: {os.path.getsize(OUT):,} bytes, {pts:,} points, {len(features)} features')


if __name__ == '__main__':
    main()
