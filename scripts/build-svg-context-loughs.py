"""Build assets/map/context-loughs.json: the major loughs the "Download SVG" export
(app/src/map-image-export.js) cuts out of every feature and out of the grey neighbouring land,
as Wikipedia's locator maps do (e.g. Commons File:FermanaghSouthTyrone2024Constituency.svg
shows Lough Neagh, Lough Erne and Strangford Lough as water). Boundary data such as OSNI's
constituencies shares the loughs among the areas, so without this they are filled.

Sources (all redistributable):
  * Inland loughs in Northern Ireland: DAERA Lake Water Bodies (OpenDataNI, Open Government
    Licence v3.0), data/maps/water-quality/lake-water-bodies1.fgb.
  * Inland loughs in the Republic: Tailte Eireann Lakes & Reservoirs, National 250k Map of
    Ireland (CC BY 4.0), the tailte-lakes-reservoirs layer
    (https://data.civgraph.net/data/maps/tailte/lakes_reservoirs.fgb).
  * Sea loughs (Strangford, Carlingford, Foyle): the water inside a hand-drawn region closed
    across the lough's mouth, cut from Civgraph's island outlines
    (data/maps/physical/NorthernIreland-lod1.fgb, OSNI, OGL v3.0, and
    RepublicOfIreland-lod1.fgb, Tailte Eireann, CC BY 4.0).

Each lough has "rings" (polygons, the area cut out) and "shore" (lines drawn along the cut
edge). An inland lough's shore is its rings; a sea lough's leaves out the line across its mouth,
which is open sea.

Coordinates are WGS84 degrees quantised to 1e-4 and delta-encoded as in context-land.json.

Usage:
  python scripts/build-svg-context-loughs.py <path/to/tailte/lakes_reservoirs.fgb>
"""
import json
import os
import subprocess
import sys
import tempfile

from shapely.geometry import shape, Polygon, MultiPolygon, LineString, MultiLineString
from shapely.ops import unary_union, linemerge

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'map', 'context-loughs.json')
Q = 10000
TOL = 0.0006
MIN_ISLAND = 4e-6   # holes (islands) smaller than this, in square degrees, are dropped

# Northern Ireland WFD lake water bodies: name in the layer -> lough.
NI_LOUGHS = {
    'Lough Neagh': 'Lough Neagh',
    'Lough Beg': 'Lough Beg',
    'Lower Lough Erne Devenish': 'Lower Lough Erne',
    'Lower Lough Erne Kesh': 'Lower Lough Erne',
    'Upper Lough Erne': 'Upper Lough Erne',
    'Lough Melvin': 'Lough Melvin',
}
# Tailte Eireann 250k lakes of 10 km2 or more (Lough Melvin comes from the NI layer, which
# covers the whole lough). Lough Derg is the Shannon one, the largest of that name.
ROI_LOUGHS = ['Lough Corrib', 'Lough Derg', 'Lough Ree', 'Lough Mask', 'Lough Conn', 'Lough Allen',
              'Lough Leane', 'Poullaphuca Reservoir', 'Lough Sheelin', 'Lough Carra', 'Lough Gill',
              'Lough Arrow', 'Lough Gara', 'Lough Ennell', 'Lough Currane', 'Lough Owel']
# Sea loughs: a region whose edges run over land except one closing line across the mouth
# (and, for Foyle and Carlingford, one across the river at the lough's head).
SEA_LOUGHS = {
    'Strangford Lough': [(-5.557, 54.371), (-5.60, 54.352), (-5.70, 54.30), (-5.86, 54.30), (-5.86, 54.64),
                         (-5.48, 54.64), (-5.48, 54.40), (-5.545, 54.381)],
    'Carlingford Lough': [(-6.062, 54.022), (-6.02, 54.06), (-6.12, 54.12), (-6.29, 54.125),
                          (-6.36, 54.08), (-6.27, 54.02), (-6.16, 54.005), (-6.128, 54.034)],
    'Lough Foyle': [(-6.958, 55.192), (-6.90, 55.12), (-6.92, 55.02), (-7.20, 54.99), (-7.28, 55.04),
                    (-7.36, 55.12), (-7.14, 55.24), (-6.99, 55.207)],
}


def read_features(path):
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, 'out.geojson')
        subprocess.run(['ogr2ogr', '-f', 'GeoJSON', out, path], check=True, capture_output=True)
        with open(out, encoding='utf-8') as fh:
            return json.load(fh)['features']


def polygons(geom):
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    return [g for g in getattr(geom, 'geoms', []) if isinstance(g, Polygon)]


def lines(geom):
    if geom.is_empty:
        return []
    if isinstance(geom, LineString):
        return [geom]
    if isinstance(geom, MultiLineString):
        merged = linemerge(geom)
        return [merged] if isinstance(merged, LineString) else list(merged.geoms)
    return [g for g in getattr(geom, 'geoms', []) if isinstance(g, LineString)]


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


def clean(geom):
    """Drop small islands, then simplify: the cut is for locator maps."""
    parts = []
    for poly in polygons(geom.buffer(0)):
        holes = [h for h in poly.interiors if Polygon(h).area >= MIN_ISLAND]
        parts.append(Polygon(poly.exterior, holes))
    return unary_union(parts).simplify(TOL, preserve_topology=True)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    tailte_path = sys.argv[1]
    loughs = []

    groups = {}
    for f in read_features(os.path.join(ROOT, 'data', 'maps', 'water-quality', 'lake-water-bodies1.fgb')):
        name = NI_LOUGHS.get((f['properties'].get('namespace') or '').strip())
        if name:
            groups.setdefault(name, []).append(shape(f['geometry']))
    tailte = {}
    for f in read_features(tailte_path):
        name = (f['properties'].get('NAMN1') or '').strip()
        if name in ROI_LOUGHS:
            geom = shape(f['geometry'])
            if name not in tailte or geom.area > tailte[name].area:
                tailte[name] = geom
    missing = [n for n in list(NI_LOUGHS.values()) + ROI_LOUGHS if n not in groups and n not in tailte]
    if missing:
        sys.exit(f'Missing loughs: {missing}')
    for name in sorted(groups):
        loughs.append({'name': name, 'kind': 'inland', 'geom': clean(unary_union(groups[name]))})
    for name in sorted(tailte):
        loughs.append({'name': name, 'kind': 'inland', 'geom': clean(tailte[name])})

    physical = os.path.join(ROOT, 'data', 'maps', 'physical')
    land = unary_union([shape(f['geometry']) for f in read_features(os.path.join(physical, 'NorthernIreland-lod1.fgb'))]
                       + [shape(f['geometry']) for f in read_features(os.path.join(physical, 'RepublicOfIreland-lod1.fgb'))]).buffer(0)
    for name, ring in SEA_LOUGHS.items():
        region = Polygon(ring)
        water = polygons(region.difference(land))
        if not water:
            sys.exit(f'{name}: no water inside its region')
        water.sort(key=lambda p: p.area, reverse=True)
        geom = clean(water[0])
        # The shore is the cut edge less the region's own edges, which cross only water.
        shore = geom.boundary.difference(region.exterior.buffer(0.0003))
        loughs.append({'name': name, 'kind': 'sea', 'geom': geom,
                       'shore': [l for l in lines(shore) if l.length > 0.002]})

    features = []
    for lough in loughs:
        rings = []
        for poly in polygons(lough['geom']):
            # Rings left with fewer than four points once quantised are dropped.
            outer = encode(poly.exterior.coords)
            if len(outer) >= 8:
                rings.append([outer] + [r for r in (encode(h.coords) for h in poly.interiors) if len(r) >= 8])
        feature = {'name': lough['name'], 'kind': lough['kind'], 'rings': rings}
        if 'shore' in lough:
            feature['shore'] = [encode(l.coords) for l in lough['shore']]
        features.append(feature)

    doc = {
        'version': 1,
        'quantisation': Q,
        'encoding': 'Each ring or line is [x0, y0, dx1, dy1, ...]: integer degrees x 1e4, WGS84, deltas after the first point. '
                    'rings: the area cut out; shore: the lines drawn along the cut (the rings when absent).',
        'credits': [
            'Loughs in Northern Ireland: DAERA Lake Water Bodies, OpenDataNI (Open Government Licence v3.0)',
            'Loughs in the Republic of Ireland: Tailte Éireann Lakes & Reservoirs, National 250k Map of Ireland (CC BY 4.0)',
            'Strangford, Carlingford and Foyle: cut from the island outlines (OSNI, Open Government Licence v3.0; Tailte Éireann, CC BY 4.0)',
        ],
        'features': features,
    }
    with open(OUT, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(doc, fh, separators=(',', ':'))
        fh.write('\n')
    pts = sum(len(r) // 2 for f in features for poly in f['rings'] for r in poly) + sum(len(l) // 2 for f in features for l in f.get('shore', []))
    print(f'{OUT}: {os.path.getsize(OUT):,} bytes, {pts:,} points, {len(features)} loughs')
    for lough in loughs:
        print(f"  {lough['name']}: {lough['geom'].area * 1e4:.1f} x1e-4 deg2, {len(polygons(lough['geom']))} part(s)")


if __name__ == '__main__':
    main()
