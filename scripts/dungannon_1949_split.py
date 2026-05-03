"""
Apply the 01 April 1949 Dungannon UD/RD boundary change across the NI
admin-areas datasets.

Inputs:
  - C:/Users/scomo/Documents/Dungannon new.fgb          (post-1949 UD geometry)
  - data/maps/local-government/LGDs_04-07-1966.fgb      (currently holds the
                                                         pre-1949 UD+RD by
                                                         mistake — used here
                                                         as the "OLD" source)
  - data/maps/local-government/NI_Admin_Areas_<vintage>.fgb (snapshot files
                                                         that lack Dungannon
                                                         features altogether)

Outputs (data/maps/local-government/):
  - LGDs_04-07-1966.fgb            UD+RD replaced with post-1949 versions
  - NI_Admin_Areas_1921-1936.fgb   pre-1949 UD+RD added
  - NI_Admin_Areas_1937-1948.fgb   NEW file: 1937-1963 snapshot + pre-1949 UD+RD
  - NI_Admin_Areas_1949-1963.fgb   NEW file: 1937-1963 snapshot + post-1949 UD+RD
  - NI_Admin_Areas_1964.fgb        post-1949 UD+RD added
  - NI_Admin_Areas_1965-1968.fgb   post-1949 UD+RD added
  - NI_Admin_Areas_1969.fgb        post-1949 UD+RD added

The "1937-1963" file is split because that single FGB is currently shared by
both pre- and post-1949 partial-vintage entries in maps.json.

Geometry derivation:
    transferred = NEW_UD ∖ OLD_UD     (area that moved from RD to UD in 1949)
    NEW_RD      = OLD_RD ∖ transferred
    sanity:     NEW_UD ∪ NEW_RD ≈ OLD_UD ∪ OLD_RD
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import geopandas as gpd
from shapely import make_valid
from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
LG = ROOT / 'data' / 'maps' / 'local-government'
TMP = Path('C:/Users/scomo/AppData/Local/Temp/admin')
NEW_UD_PATH = Path('C:/Users/scomo/Documents/Dungannon new.fgb')

PRE_1949_SNAPSHOTS = ['NI_Admin_Areas_1921-1936.fgb']
POST_1949_SNAPSHOTS = [
    'NI_Admin_Areas_1964.fgb',
    'NI_Admin_Areas_1965-1968.fgb',
    'NI_Admin_Areas_1969.fgb',
]
SPLIT_SOURCE = 'NI_Admin_Areas_1937-1963.fgb'  # split into 1937-1948 and 1949-1963
DEDICATED_1966 = 'LGDs_04-07-1966.fgb'

CRS_WGS84 = 'EPSG:4326'


def heal(geom):
    """Force validity, clean tiny artefacts."""
    g = make_valid(geom)
    if g.is_empty:
        return g
    return g.buffer(0)


def to_multipolygon(geom):
    if geom.geom_type == 'Polygon':
        return MultiPolygon([geom])
    if geom.geom_type == 'MultiPolygon':
        return geom
    # GeometryCollection of polygons – keep only polygonal parts
    parts = [g for g in geom.geoms if g.geom_type in ('Polygon', 'MultiPolygon')]
    out = []
    for g in parts:
        if g.geom_type == 'Polygon':
            out.append(g)
        else:
            out.extend(list(g.geoms))
    return MultiPolygon(out)


def load_old_dungannon():
    """Pull old (pre-1949) UD and RD geometries from the 1966 map (which
    erroneously holds the pre-1949 shapes)."""
    src = TMP / DEDICATED_1966
    df = gpd.read_file(src)
    if df.crs is None:
        df = df.set_crs(CRS_WGS84)
    elif df.crs.to_string() != CRS_WGS84:
        df = df.to_crs(CRS_WGS84)
    ud = df[(df['Unit'] == 'Dungannon') & (df['Type'] == 'Urban District')]
    rd = df[(df['Unit'] == 'Dungannon') & (df['Type'] == 'Rural District')]
    if len(ud) != 1 or len(rd) != 1:
        sys.exit(f'Expected exactly one UD and one RD; got UD={len(ud)} RD={len(rd)}')
    return df, ud.iloc[0], rd.iloc[0]


def load_new_ud_geom():
    df = gpd.read_file(NEW_UD_PATH)
    if df.crs is None:
        df = df.set_crs(CRS_WGS84)
    elif df.crs.to_string() != CRS_WGS84:
        df = df.to_crs(CRS_WGS84)
    if len(df) != 1:
        sys.exit(f'Expected one feature in new UD source; got {len(df)}')
    return heal(df.geometry.iloc[0])


def derive_new_rd(old_ud_geom, old_rd_geom, new_ud_geom):
    old_ud = heal(old_ud_geom)
    old_rd = heal(old_rd_geom)
    new_ud = heal(new_ud_geom)
    transferred = new_ud.difference(old_ud)
    new_rd = old_rd.difference(transferred)
    new_rd = heal(new_rd)
    # sanity
    union_old = unary_union([old_ud, old_rd])
    union_new = unary_union([new_ud, new_rd])
    sym = union_new.symmetric_difference(union_old)
    sym_area = sym.area  # WGS84 degrees² – just used for ratio
    union_area = union_old.area
    ratio = sym_area / union_area if union_area else 0
    print(f'  combined-Dungannon area drift: {ratio*100:.4f}%')
    if ratio > 0.005:
        print('  WARNING: union of old UD+RD differs from union of new UD+RD by >0.5%')
    return to_multipolygon(new_rd), to_multipolygon(transferred)


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------

def make_dungannon_rows_for_1966_schema(template_ud, template_rd, new_ud_geom, new_rd_geom):
    """Return a list of two rows matching the 1966 schema (CountyName, Unit,
    Type, FullName, elevation fields)."""
    out = []
    for templ, geom in [(template_ud, new_ud_geom), (template_rd, new_rd_geom)]:
        row = {col: templ[col] for col in templ.index if col != 'geometry'}
        row['geometry'] = to_multipolygon(geom)
        out.append(row)
    return out


def make_dungannon_rows_for_admin_schema(new_ud_geom, new_rd_geom):
    """Snapshot files use a single AdministrativeArea field."""
    return [
        {'AdministrativeArea': 'Dungannon Urban District',
         'geometry': to_multipolygon(new_ud_geom)},
        {'AdministrativeArea': 'Dungannon Rural District',
         'geometry': to_multipolygon(new_rd_geom)},
    ]


def write_fgb(gdf: gpd.GeoDataFrame, out_path: Path):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        out_path.unlink()
    # FlatGeobuf writer is provided via pyogrio when available, else fiona
    gdf.to_file(out_path, driver='FlatGeobuf')
    print(f'  wrote {out_path.relative_to(ROOT)} ({len(gdf)} feats)')


def update_1966(old_df, ud_template, rd_template, new_ud_geom, new_rd_geom):
    """Drop the old UD+RD rows from the 1966 file, add the new ones, write."""
    keep = old_df[~((old_df['Unit'] == 'Dungannon') &
                    (old_df['Type'].isin(['Urban District', 'Rural District'])))]
    new_rows = make_dungannon_rows_for_1966_schema(ud_template, rd_template,
                                                    new_ud_geom, new_rd_geom)
    new_df = gpd.GeoDataFrame(new_rows, geometry='geometry', crs=CRS_WGS84)
    out = gpd.GeoDataFrame(
        list(keep.to_dict('records')) + list(new_df.to_dict('records')),
        geometry='geometry', crs=CRS_WGS84,
    )
    write_fgb(out, LG / DEDICATED_1966)


def add_to_snapshot(snap_filename: str, ud_geom, rd_geom, *, source_filename=None,
                    out_filename: str | None = None):
    """Add Dungannon UD+RD to a snapshot using its existing schema. If
    source_filename is given, read from that file instead of snap_filename
    (used for the 1937-1948 / 1949-1963 split where the source is
    NI_Admin_Areas_1937-1963.fgb)."""
    src = TMP / (source_filename or snap_filename)
    df = gpd.read_file(src)
    if df.crs is None:
        df = df.set_crs(CRS_WGS84)
    elif df.crs.to_string() != CRS_WGS84:
        df = df.to_crs(CRS_WGS84)
    cols = list(df.columns)
    if 'AdministrativeArea' not in cols:
        sys.exit(f'{snap_filename}: missing AdministrativeArea column ({cols})')
    new_rows = make_dungannon_rows_for_admin_schema(ud_geom, rd_geom)
    # Pad missing columns
    for r in new_rows:
        for c in cols:
            r.setdefault(c, None)
    out = gpd.GeoDataFrame(
        list(df.to_dict('records')) + new_rows,
        geometry='geometry', crs=CRS_WGS84,
    )
    write_fgb(out, LG / (out_filename or snap_filename))


def build_lods(fgb_path: Path):
    """Re-derive -lod0 and -lod1 simplifications. Tolerances chosen to match
    the existing LGD pipeline (rough order-of-magnitude)."""
    df = gpd.read_file(fgb_path)
    if df.crs is None:
        df = df.set_crs(CRS_WGS84)
    for tol_deg, suffix in [(0.0008, '-lod0'), (0.0002, '-lod1')]:
        out = df.copy()
        out['geometry'] = out['geometry'].apply(
            lambda g: g.simplify(tol_deg, preserve_topology=True))
        out_path = fgb_path.with_name(fgb_path.stem + suffix + '.fgb')
        write_fgb(out, out_path)


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

def main():
    if not NEW_UD_PATH.exists():
        sys.exit(f'Missing {NEW_UD_PATH}')
    LG.mkdir(parents=True, exist_ok=True)

    print('1. Loading old Dungannon UD/RD from 1966 map')
    df_1966, ud_template, rd_template = load_old_dungannon()
    old_ud_geom = ud_template.geometry
    old_rd_geom = rd_template.geometry
    print(f'   OLD UD area: {old_ud_geom.area:.6f} deg^2')
    print(f'   OLD RD area: {old_rd_geom.area:.6f} deg^2')

    print('2. Loading NEW Dungannon UD geometry from user file')
    new_ud_geom = load_new_ud_geom()
    print(f'   NEW UD area: {new_ud_geom.area:.6f} deg^2')

    print('3. Deriving NEW Dungannon RD geometry')
    new_rd_geom, transferred = derive_new_rd(old_ud_geom, old_rd_geom, new_ud_geom)
    print(f'   NEW RD area:    {new_rd_geom.area:.6f} deg^2')
    print(f'   Transferred:    {transferred.area:.6f} deg^2 (UD increase)')

    print('4. Updating 1966 map (replace UD+RD)')
    update_1966(df_1966, ud_template, rd_template, new_ud_geom, new_rd_geom)

    print('5. Adding OLD Dungannon to pre-1949 snapshots')
    for snap in PRE_1949_SNAPSHOTS:
        add_to_snapshot(snap, old_ud_geom, old_rd_geom)

    print('6. Splitting 1937-1963 snapshot into 1937-1948 (OLD) and 1949-1963 (NEW)')
    add_to_snapshot('NI_Admin_Areas_1937-1948.fgb', old_ud_geom, old_rd_geom,
                    source_filename=SPLIT_SOURCE,
                    out_filename='NI_Admin_Areas_1937-1948.fgb')
    add_to_snapshot('NI_Admin_Areas_1949-1963.fgb', new_ud_geom, new_rd_geom,
                    source_filename=SPLIT_SOURCE,
                    out_filename='NI_Admin_Areas_1949-1963.fgb')

    print('7. Adding NEW Dungannon to post-1949 snapshots (1964, 1965-1968, 1969)')
    for snap in POST_1949_SNAPSHOTS:
        add_to_snapshot(snap, new_ud_geom, new_rd_geom)

    print('8. Rebuilding LOD variants for 1966 map')
    build_lods(LG / DEDICATED_1966)

    print('Done.')


if __name__ == '__main__':
    main()
