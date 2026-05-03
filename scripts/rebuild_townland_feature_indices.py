"""
Rebuild the three townland feature-indices with a `name` column added so
the search system can surface townland features by name.

Inputs (R2 source FGBs):
    data/maps/townlands/OSNI_Townlands.fgb   (NI source — 'TownlandName')
    data/maps/townlands/OSI_Townlands.fgb    (ROI source — 'ENG_NAME_VALUE')

Outputs (data/maps/townlands/):
    ni-townlands-feature-index.json
    roi-townlands-feature-index.json
    all-ireland-townlands-feature-index.json

Each is the same compact array-of-arrays format as before, with the
columns header extended to:
    [minX, minY, maxX, maxY, diag, chunk, name]

Chunk-id assignment:
    - per-region indices use 'col_row' (matches ni-townlands-chunks.json /
      roi-townlands-chunks.json which key chunks the same way)
    - all-ireland index uses 'ni_col_row' / 'roi_col_row' (matches
      all-ireland-townlands-chunks.json which prefixes per-region cells)

Exclusions: features with empty / whitespace-only names are dropped, on
the basis that they're slivers, water bodies or other non-townland
artefacts that we never want to surface in search. The OSNI and OSI
townland datasets don't carry rivers / uninhabited highlands as
separate features, so no further filtering is needed.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import geopandas as gpd

ROOT = Path(__file__).resolve().parent.parent
TLDIR = ROOT / 'data' / 'maps' / 'townlands'

NI_FGB = TLDIR / 'OSNI_Townlands.fgb'
ROI_FGB = TLDIR / 'OSI_Townlands.fgb'

NI_INDEX_OUT = TLDIR / 'ni-townlands-feature-index.json'
ROI_INDEX_OUT = TLDIR / 'roi-townlands-feature-index.json'
ALL_INDEX_OUT = TLDIR / 'all-ireland-townlands-feature-index.json'

NI_CHUNKS = TLDIR / 'ni-townlands-chunks.json'
ROI_CHUNKS = TLDIR / 'roi-townlands-chunks.json'

COLUMNS = ['minX', 'minY', 'maxX', 'maxY', 'diag', 'chunk', 'name']


def normalise_name(value) -> str:
    if value is None:
        return ''
    s = str(value).strip()
    return s


def pick_name_column(df: gpd.GeoDataFrame, candidates):
    for c in candidates:
        if c in df.columns:
            return c
    raise SystemExit(f'No name column found; tried {candidates}; have {list(df.columns)}')


def round4(v):
    return round(float(v), 4)


def build_per_region(fgb_path: Path, chunks_meta_path: Path,
                    name_candidates: list[str], region_label: str):
    """Read source FGB, emit list of [minX, minY, maxX, maxY, diag, chunk, name]
    using the grid metadata from the existing chunks-index."""
    print(f'  Loading {fgb_path.name} ({region_label})...')
    gdf = gpd.read_file(fgb_path)
    print(f'    {len(gdf)} features')

    name_col = pick_name_column(gdf, name_candidates)
    print(f'    name column: {name_col}')

    chunks_meta = json.loads(chunks_meta_path.read_text(encoding='utf-8'))
    grid_cols, grid_rows = chunks_meta['grid']
    cell = chunks_meta['cellSize']
    o_min_x, o_min_y, _, _ = chunks_meta['bbox']
    print(f'    grid: {grid_cols}×{grid_rows}, cellSize {cell}, '
          f'origin ({o_min_x:.4f}, {o_min_y:.4f})')

    rows = []
    skipped_empty_name = 0
    skipped_no_geom = 0
    # We iterate via reset_index so positional index matches FGB order.
    for _, feat in gdf.iterrows():
        geom = feat.geometry
        if geom is None or geom.is_empty:
            skipped_no_geom += 1
            continue
        name = normalise_name(feat[name_col])
        if not name:
            skipped_empty_name += 1
            continue
        min_x, min_y, max_x, max_y = geom.bounds
        diag = math.hypot(max_x - min_x, max_y - min_y)
        c = geom.centroid
        col = max(0, min(grid_cols - 1, int((c.x - o_min_x) / cell)))
        rw = max(0, min(grid_rows - 1, int((c.y - o_min_y) / cell)))
        rows.append([
            round4(min_x), round4(min_y), round4(max_x), round4(max_y),
            round4(diag),
            f'{col}_{rw}',
            name,
        ])
    print(f'    kept {len(rows)} features '
          f'(skipped {skipped_empty_name} empty-name, {skipped_no_geom} no-geom)')
    return rows


def write_index(out_path: Path, mapId: str, rows: list[list]):
    payload = {
        'mapId': mapId,
        'totalFeatures': len(rows),
        'columns': COLUMNS,
        'features': rows,
    }
    out_path.write_text(json.dumps(payload), encoding='utf-8')
    print(f'  wrote {out_path.relative_to(ROOT)} ({len(rows)} feats, '
          f'{out_path.stat().st_size / 1024:.1f} KB)')


def main():
    if not NI_FGB.exists() or not ROI_FGB.exists():
        raise SystemExit(f'Source FGBs missing: {NI_FGB} or {ROI_FGB}')

    print('Building NI feature-index...')
    ni_rows = build_per_region(
        NI_FGB, NI_CHUNKS,
        name_candidates=['TownlandName', 'TownlandNa', 'NAME', 'Name'],
        region_label='NI',
    )
    write_index(NI_INDEX_OUT, 'ni-townlands', ni_rows)

    print('\nBuilding ROI feature-index...')
    roi_rows = build_per_region(
        ROI_FGB, ROI_CHUNKS,
        name_candidates=['ENG_NAME_VALUE', 'Name'],
        region_label='ROI',
    )
    write_index(ROI_INDEX_OUT, 'roi-townlands', roi_rows)

    print('\nBuilding all-Ireland feature-index (prefixed chunk ids)...')
    all_rows = []
    for r in ni_rows:
        all_rows.append([r[0], r[1], r[2], r[3], r[4], f'ni_{r[5]}', r[6]])
    for r in roi_rows:
        all_rows.append([r[0], r[1], r[2], r[3], r[4], f'roi_{r[5]}', r[6]])
    write_index(ALL_INDEX_OUT, 'all-ireland-townlands', all_rows)

    print('\nDone.')


if __name__ == '__main__':
    main()
