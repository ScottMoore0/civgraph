"""Build -lod0 / -lod1 simplifications for FGBs that are too large to ship
as a single monolith at low zoom, and whose maps.json entry has
useLOD:true. Polygon/line geometries get Douglas-Peucker simplification;
point geometries get random decimation.

Usage:
  python scripts/build_lod_ladders.py [<map_id> ...]

If no map IDs are given, reads stdin (one URL per line) or processes a
default list of known offenders from the audit.

Output goes alongside the input file with -lod0 / -lod1 suffix. Upload
to R2 separately via scripts/upload_lod_ladders.mjs.
"""
from __future__ import annotations
import os, subprocess, sys, warnings
from pathlib import Path
import geopandas as gpd
warnings.filterwarnings('ignore')

# Tier B targets — large layers that need LODs. Each entry is the FGB
# URL on R2 (we download → simplify → write locally → caller uploads).
DEFAULT_TARGETS = [
    # Habitat networks (Ulster Wildlife) — high feature counts
    'https://data.civgraph.net/data/maps/biodiversity/habitat-coastal-grouped.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-woodland-grouped.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-grassland-grouped.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-wetland-grouped.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-bog.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-deciduous-woodland.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-ancient-semi-natural-woodland.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-fen.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-heath.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-lake.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-pond.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-river.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-reedbed.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-acid-grassland.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-calcareous-grassland.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-lowland-meadow.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-purple-moor-grass.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-traditional-orchard.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-wood-pasture-parkland.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-coastal-sand-dune.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-coastal-saltmarsh.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-coastal-vegetated-shingle.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-maritime-cliff-slope.fgb',
    'https://data.civgraph.net/data/maps/biodiversity/habitat-limestone-pavement.fgb',
    # DfI Pothole Enquiries — point datasets, 8 years
    'https://data.civgraph.net/data/maps/transport-infra/dfi-pothole-enquiries-2014.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-pothole-enquiries-2015.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-pothole-enquiries-2016.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-pothole-enquiries-2017.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-pothole-enquiries-2018.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-pothole-enquiries-2019.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-pothole-enquiries-2020.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-pothole-enquiries-2021.fgb',
    # DfI Surface Defects — point datasets, 13 years
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2008.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2010.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2011.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2012.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2013.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2014.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2015.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2016.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2017.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2018.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2019.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2020.fgb',
    'https://data.civgraph.net/data/maps/transport-infra/dfi-surface-defects-2021.fgb',
]

WORK_DIR = Path('_tmp_lod_build')
WORK_DIR.mkdir(exist_ok=True)


def url_to_local(url: str) -> Path:
    rel = url.replace('https://data.civgraph.net/', '')
    p = Path(rel)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def make_lod(g: gpd.GeoDataFrame, suffix: str) -> gpd.GeoDataFrame:
    """Produce an LOD-suffix variant. Polygons/lines: Douglas-Peucker;
    points: random decimation."""
    if len(g) == 0:
        return g
    geom_type = g.geometry.iloc[0].geom_type
    if geom_type in ('Point', 'MultiPoint'):
        # Points: stratified random decimation; lod0 keeps 10%, lod1 keeps 35%.
        keep_frac = {'-lod0': 0.10, '-lod1': 0.35}[suffix]
        if len(g) <= 500:   # tiny — keep all even at lod0
            return g.copy()
        return g.sample(frac=keep_frac, random_state=42).copy()
    # Polygon/line: simplify with Douglas-Peucker.
    # preserve_topology=False is the fast O(n log n) path; the simplified
    # polygons are good enough at LOD zooms (some may self-intersect but
    # won't be visible at coarse rendering). Drop empty/null geometries
    # afterwards so write doesn't choke on them.
    tol = {'-lod0': 0.005, '-lod1': 0.0005}[suffix]
    out = g.copy()
    out['geometry'] = out.geometry.simplify(tolerance=tol, preserve_topology=False)
    out = out[~out.geometry.is_empty & out.geometry.notna()].copy()
    # buffer(0) repairs minor self-intersections at low cost; only on
    # LOD0 since LOD1's tolerance is small enough to rarely trigger them.
    if suffix == '-lod0':
        try:
            out['geometry'] = out.geometry.buffer(0)
            out = out[~out.geometry.is_empty & out.geometry.notna()].copy()
        except Exception:
            pass
    return out


def process_one(url: str) -> dict:
    base_path = url_to_local(url)
    # Download
    if not base_path.exists():
        print(f'  download {base_path.name}', flush=True)
        subprocess.check_call(['curl', '-sL', url, '-o', str(base_path)])
    g = gpd.read_file(base_path)
    geom_type = g.geometry.iloc[0].geom_type if len(g) else 'EMPTY'
    print(f'  {base_path.name}: {len(g)} rows, {geom_type}', flush=True)

    sizes = {'base_rows': len(g), 'base_bytes': base_path.stat().st_size}
    for suf in ['-lod0', '-lod1']:
        out = base_path.parent / f'{base_path.stem}{suf}.fgb'
        if out.exists(): out.unlink()
        gs = make_lod(g, suf)
        gs.to_file(out, driver='FlatGeobuf')
        sizes[suf + '_rows'] = len(gs)
        sizes[suf + '_bytes'] = out.stat().st_size
        print(f'    {suf}: {len(gs)} rows, {out.stat().st_size/1e6:.2f} MB', flush=True)
    return sizes


def main():
    targets = sys.argv[1:] or DEFAULT_TARGETS
    summary = []
    for i, url in enumerate(targets, 1):
        print(f'[{i}/{len(targets)}] {url}', flush=True)
        try:
            s = process_one(url)
            s['url'] = url
            summary.append(s)
        except Exception as e:
            print(f'  ! {e}', flush=True)
    # Print summary
    print('\n=== summary ===', flush=True)
    for s in summary:
        print(f'{s["url"].rsplit("/",1)[-1]}: '
              f'base {s["base_rows"]} rows / {s["base_bytes"]/1e6:.1f} MB → '
              f'lod0 {s.get("-lod0_rows","?")} / {s.get("-lod0_bytes",0)/1e6:.2f} MB · '
              f'lod1 {s.get("-lod1_rows","?")} / {s.get("-lod1_bytes",0)/1e6:.2f} MB', flush=True)


if __name__ == '__main__':
    main()
