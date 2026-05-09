"""Generic spatial chunker — produces a {mapId}-chunks.json index plus
per-cell FGB files under chunks/.

Output is wired to the map-controller chunked-loading path (set
chunked:true on the map in maps.json after upload).

Usage:
  python scripts/build_chunks_generic.py <map_id>

Reads the layer's FGB from data/maps/<dir>/<basename>.fgb (must already
be local — typically downloaded by build_lod_ladders.py). Writes:
  data/maps/<dir>/<basename>-chunks.json
  data/maps/<dir>/chunks/<basename>_<r>_<c>.fgb
"""
from __future__ import annotations
import json, math, subprocess, sys, time
from pathlib import Path
import warnings
warnings.filterwarnings('ignore')

# NI bbox (covers all NI-only datasets with a small pad)
NI_BBOX = (-8.30, 54.00, -5.30, 55.50)
# Ireland bbox
IE_BBOX = (-10.75, 51.40, -5.40, 55.50)
CELL_DEG = 0.25  # ~28 km cells at NI latitude


def feature_count(p: Path) -> int:
    try:
        out = subprocess.check_output(
            ['ogrinfo', '-al', '-so', str(p)],
            stderr=subprocess.DEVNULL,
        ).decode('utf-8', errors='replace')
        for ln in out.splitlines():
            if ln.startswith('Feature Count:'):
                return int(ln.split(':')[1].strip())
    except subprocess.CalledProcessError:
        pass
    return 0


def chunk_one(map_id: str, fgb_path: Path, bbox: tuple, cell_deg: float = CELL_DEG):
    lon0_all, lat0_all, lon1_all, lat1_all = bbox
    n_cols = math.ceil((lon1_all - lon0_all) / cell_deg)
    n_rows = math.ceil((lat1_all - lat0_all) / cell_deg)
    print(f'  grid {n_rows} rows x {n_cols} cols ({n_rows*n_cols} cells, {cell_deg} deg)', flush=True)

    chunks_dir = fgb_path.parent / 'chunks'
    chunks_dir.mkdir(exist_ok=True)
    rel_dir = '/'.join(fgb_path.parent.relative_to('data').parts)
    chunks = []
    total = 0
    t0 = time.time()
    base = fgb_path.stem
    for r in range(n_rows):
        for c in range(n_cols):
            lon0 = lon0_all + c * cell_deg
            lon1 = lon0 + cell_deg
            lat0 = lat0_all + r * cell_deg
            lat1 = lat0 + cell_deg
            chunk_file = chunks_dir / f'{base}_{r}_{c}.fgb'
            if chunk_file.exists():
                chunk_file.unlink()
            cmd = [
                'ogr2ogr', '-f', 'FlatGeobuf', '-overwrite',
                '-spat', str(lon0), str(lat0), str(lon1), str(lat1),
                str(chunk_file), str(fgb_path),
            ]
            try:
                subprocess.run(cmd, check=True, stderr=subprocess.DEVNULL,
                               stdout=subprocess.DEVNULL)
            except subprocess.CalledProcessError:
                continue
            fc = feature_count(chunk_file)
            if not fc:
                chunk_file.unlink(missing_ok=True)
                continue
            chunks.append({
                'id': f'{r}_{c}',
                'bbox': [lon0, lat0, lon1, lat1],
                'file': f'data/{rel_dir}/chunks/{chunk_file.name}',
                'count': fc,
            })
            total += fc
    elapsed = time.time() - t0
    print(f'  wrote {len(chunks)} non-empty chunks, {total:,} features in {elapsed:.1f}s', flush=True)

    index = {
        'mapId': map_id,
        'grid': [n_rows, n_cols],
        'cellSize': cell_deg,
        'bbox': list(bbox),
        'totalFeatures': total,
        'chunks': chunks,
    }
    index_path = fgb_path.parent / f'{base}-chunks.json'
    index_path.write_text(json.dumps(index, indent=2), encoding='utf-8')
    print(f'  wrote {index_path}', flush=True)
    return index_path


# Map ID -> (relative path under data/maps, all-Ireland or NI-only)
TARGETS = [
    # (map_id, rel_path_no_ext, scope)
    ('habitat-woodland-grouped',          'biodiversity/habitat-woodland-grouped',          'NI'),
    ('habitat-wetland-grouped',           'biodiversity/habitat-wetland-grouped',           'NI'),
    ('habitat-grassland-grouped',         'biodiversity/habitat-grassland-grouped',         'NI'),
    ('habitat-coastal-grouped',           'biodiversity/habitat-coastal-grouped',           'NI'),
    ('habitat-deciduous-woodland',        'biodiversity/habitat-deciduous-woodland',        'NI'),
    ('habitat-river',                     'biodiversity/habitat-river',                     'NI'),
    ('dfi-surface-defects-2008',          'transport-infra/dfi-surface-defects-2008',       'NI'),
    ('dfi-surface-defects-2010',          'transport-infra/dfi-surface-defects-2010',       'NI'),
    ('dfi-surface-defects-2011',          'transport-infra/dfi-surface-defects-2011',       'NI'),
    ('dfi-surface-defects-2012',          'transport-infra/dfi-surface-defects-2012',       'NI'),
    ('dfi-surface-defects-2013',          'transport-infra/dfi-surface-defects-2013',       'NI'),
    ('dfi-surface-defects-2014',          'transport-infra/dfi-surface-defects-2014',       'NI'),
    ('dfi-surface-defects-2015',          'transport-infra/dfi-surface-defects-2015',       'NI'),
    ('dfi-surface-defects-2016',          'transport-infra/dfi-surface-defects-2016',       'NI'),
    ('dfi-surface-defects-2017',          'transport-infra/dfi-surface-defects-2017',       'NI'),
    ('dfi-surface-defects-2018',          'transport-infra/dfi-surface-defects-2018',       'NI'),
    ('dfi-surface-defects-2019',          'transport-infra/dfi-surface-defects-2019',       'NI'),
    ('dfi-surface-defects-2020',          'transport-infra/dfi-surface-defects-2020',       'NI'),
    ('dfi-surface-defects-2021',          'transport-infra/dfi-surface-defects-2021',       'NI'),
    ('transport-carriageway-defects-2021','transport/carriageway-footway-defects-2021',     'NI'),
    ('env-noise-major-roads-lden',        'environment/noise-major-roads-lden-r3',          'NI'),
]


def main():
    if len(sys.argv) > 1:
        wanted = set(sys.argv[1:])
        targets = [t for t in TARGETS if t[0] in wanted]
    else:
        targets = TARGETS
    for i, (map_id, rel, scope) in enumerate(targets, 1):
        fgb_path = Path(f'data/maps/{rel}.fgb')
        if not fgb_path.exists():
            print(f'[{i}/{len(targets)}] {map_id}: SKIP — {fgb_path} not present locally', flush=True)
            continue
        print(f'[{i}/{len(targets)}] {map_id}: {fgb_path.stat().st_size/1e6:.1f} MB', flush=True)
        bbox = NI_BBOX if scope == 'NI' else IE_BBOX
        try:
            chunk_one(map_id, fgb_path, bbox)
        except Exception as e:
            print(f'  ! {e}', flush=True)


if __name__ == '__main__':
    main()
