"""
Merge Newcastle North and Newcastle South into the one Newcastle DED in the NI DED files of the
1920s (deds-ni-1926: NorthernIrelandDEDs1926.fgb; ded-1930-04-01: NI_DEDs_1930.fgb) and their LODs.

The files had 702 features against the census's 701 DEDs (681 in the counties plus 15 Belfast and
5 Londonderry wards; 1926 Topographical Index p. vi, General Report p. xviii). Every county matches
the census count except Down, 147 against 146 (1926 County of Down, Part I). The extra one is
Newcastle: the census lists Newcastle Urban District as a single DED ("12. Newcastle D.E.D.") made up
of a North Ward and a South Ward, the one urban DED divided into two wards (General Report p. xviii;
Topographical Index p. vi), but the files drew the two wards as two DEDs.

Reads the published files (pass --src-dir for a folder holding them; NI_DEDs_1930.fgb is not kept in
the repo) and writes the merged files over data/maps/electoral-divisions/<same name> and the /test
pipeline's source cache (render/source-cache/vector-intake/<map id>.fgb). Field types are kept by
filtering with ogr2ogr and appending the merged feature into the same schema, and every other feature
keeps its row (see merge()). Idempotent: a file that has no Newcastle North/South is copied unchanged.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import MultiPolygon, mapping, shape
from shapely.ops import transform, unary_union

ROOT = Path(__file__).resolve().parent.parent.parent.parent
ED = ROOT / 'data' / 'maps' / 'electoral-divisions'
CACHE = ROOT / 'render' / 'source-cache' / 'vector-intake'
FILES = {  # file -> map id whose source-cache copy the /test pipeline tiles
    'NorthernIrelandDEDs1926.fgb': 'deds-ni-1926',
    'NI_DEDs_1930.fgb': 'ded-1930-04-01',
    'NorthernIrelandDEDs1926-lod0.fgb': None,
    'NorthernIrelandDEDs1926-lod1.fgb': None,
    'NI_DEDs_1930-lod0.fgb': None,
    'NI_DEDs_1930-lod1.fgb': None,
}
PARTS = ('NEWCASTLE NORTH', 'NEWCASTLE SOUTH')
MERGED = {'ED_NAME': 'NEWCASTLE', 'CSO_ID': '38012', 'CSO_P_NAME': 'Newcastle'}
TO_IG = Transformer.from_crs(4326, 29903, always_xy=True)


def ogr(*args: str) -> None:
    subprocess.run(['ogr2ogr', *args], check=True, capture_output=True)


def features(path: Path) -> tuple[str, list[dict]]:
    info = subprocess.run(['ogrinfo', '-so', '-al', str(path)], check=True, capture_output=True, text=True).stdout
    layer = next(line.split(': ', 1)[1] for line in info.splitlines() if line.startswith('Layer name: '))
    out = subprocess.run(['ogr2ogr', '-f', 'GeoJSON', '/vsistdout/', str(path)], check=True, capture_output=True)
    return layer, json.loads(out.stdout.decode('utf-8'))['features']


def merge(src: Path, dst: Path) -> str:
    layer, feats = features(src)
    parts = [f for f in feats if f['properties'].get('ED_NAME') in PARTS and f['properties'].get('COUNTY') == 'DOWN']
    if not parts:
        if src.resolve() != dst.resolve():
            shutil.copyfile(src, dst)
        return f'{dst.name}: no Newcastle North/South ({len(feats)} features), unchanged'
    if len(parts) != 2:
        raise SystemExit(f'{src.name}: expected 2 Newcastle parts, found {len(parts)}')
    geoms = [shape(f['geometry']).buffer(0) for f in parts]
    union = unary_union(geoms)
    if union.geom_type == 'Polygon':
        union = MultiPolygon([union])
    props = dict(next(f for f in parts if f['properties']['ED_NAME'] == PARTS[0])['properties'])
    props.update(MERGED)
    areas = [transform(lambda x, y, z=None: TO_IG.transform(x, y), g).area for g in geoms]
    for lo, hi, mean in (('minElev_m', 'maxElev_m', 'meanElev_m'), ('minElev_ft', 'maxElev_ft', 'meanElev_ft')):
        vals = [f['properties'] for f in parts]
        if all(v.get(lo) is not None for v in vals):
            props[lo] = min(v[lo] for v in vals)
            props[hi] = max(v[hi] for v in vals)
            props[mean] = round(sum(v[mean] * a for v, a in zip(vals, areas)) / sum(areas), 1)
    # Keep every other feature's position: the /test tiles number features by their row in the file
    # (civ_fid), and election manifests point at those numbers. The merged DED takes the first part's
    # row, the file's last feature moves into the second part's row, and the file is written in that
    # order without a spatial index (an index would re-sort it along a Hilbert curve).
    fids = sorted(i for i, f in enumerate(feats) if f in parts)
    last = len(feats) - 1
    with tempfile.TemporaryDirectory() as tmp:
        gpkg = Path(tmp) / 'work.gpkg'
        names = "','".join(PARTS)
        ogr('-f', 'GPKG', str(gpkg), str(src), '-nln', 'work', '-preserve_fid',
            '-where', f"NOT (ED_NAME IN ('{names}') AND COUNTY = 'DOWN')")
        one = Path(tmp) / 'one.geojson'
        one.write_text(json.dumps({'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'id': fids[0], 'properties': props, 'geometry': mapping(union)}]}), encoding='utf-8')
        ogr('-append', '-update', '-preserve_fid', str(gpkg), str(one), '-nln', 'work')
        if last not in fids:
            subprocess.run(['ogrinfo', str(gpkg), '-q', '-sql', f'UPDATE work SET fid = {fids[1]} WHERE fid = {last}'],
                           check=True, capture_output=True)
        if dst.exists():
            dst.unlink()
        lco = 'SPATIAL_INDEX=NO' if not dst.stem.endswith(('-lod0', '-lod1')) else 'SPATIAL_INDEX=YES'
        ogr('-f', 'FlatGeobuf', str(dst), str(gpkg), '-sql', 'SELECT * FROM work ORDER BY fid',
            '-nln', layer, '-lco', lco)
    _, check = features(dst)
    return f'{dst.name}: {len(feats)} -> {len(check)} features (Newcastle North + South -> Newcastle)'


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--src-dir', type=Path, default=ED, help='folder holding the published files')
    args = ap.parse_args()
    for name, map_id in FILES.items():
        src = args.src_dir / name
        if not src.exists():
            src = ED / name
        if not src.exists():
            print(f'{name}: not found, skipped')
            continue
        dst = ED / name
        if src.resolve() == dst.resolve():   # never filter a file in place
            with tempfile.TemporaryDirectory() as tmp:
                copy = Path(tmp) / name
                shutil.copyfile(src, copy)
                print(merge(copy, dst))
        else:
            print(merge(src, dst))
        if map_id:
            shutil.copyfile(dst, CACHE / f'{map_id}.fgb')
    return 0


if __name__ == '__main__':
    sys.exit(main())
