"""
Add reconstructed districts to the NI admin-areas partial-vintage editions and
correct the 4 Jul 1966 LGD file.

Read-only inputs:
  - data/maps/local-government/NI_Admin_Areas_*.fgb as published before this
    script (the "source" vintage of each edition, SOURCE_RANGES below)
  - data/maps/local-government/Admin_Areas_01-04-1930.fgb (1 Apr 1930 lines)
  - data/maps/local-government/LGDs_04-07-1966.fgb
  - --inputs: one GeoJSON (EPSG:4326) per district series. Each feature has
    AdministrativeArea, from (ISO date, inclusive), optional to (exclusive),
    instrument, and either a geometry or base1930=true (use the 1930 line,
    looked up by baseName or AdministrativeArea). Outside every interval the
    district is not drawn. Lines are reconstructions from the cited orders and
    Acts on OSNI Largescale Townlands 2013 (OGL v3); not legally definitive.

Outputs (data/maps/local-government/_staged/, gitignored like data/maps/):
  - one FGB per run of consecutive editions with an identical state, named
    after the source file when the run is the source file's whole range, else
    NI_Admin_Areas_<first edition date>_<last edition date>.fgb
  - LGDs_04-07-1966.fgb (+ -lod0, -lod1)
  - editions.json: edition id -> file, canonical edition (cloneOf) for the
    maps.json patch (scripts/ni_admin_areas_maps_json_patch.py)
At publish time each staged file goes to R2 under
data/maps/local-government/<same name> (scripts/ni_admin_areas_upload_r2.mjs).

Rural districts are derived, never drawn:
    RD(t) = [RD(1930) + its towns(1930)] - its towns(t) - every other feature
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from datetime import date
import os
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import mapping, shape
from shapely.ops import transform, unary_union

ROOT = Path(__file__).resolve().parent.parent
LG = ROOT / 'data' / 'maps' / 'local-government'
STAGED = LG / '_staged'
BASE_1930 = LG / 'Admin_Areas_01-04-1930.fgb'
MAPS_JSON = ROOT / 'data' / 'database' / 'maps.json'
MAPS_TEST = ROOT / 'render' / 'metadata' / 'maps-test.json'
# The traced inputs are private working files kept outside the repo; point at them with
# CIVGRAPH_RECONSTRUCTION_INPUTS, or keep them in the default folder under the home directory.
DEFAULT_INPUTS = Path(os.environ.get('CIVGRAPH_RECONSTRUCTION_INPUTS')
                      or Path.home() / 'Documents' / 'civgraph-sources' / 'ni-admin-reconstructions')
ACRE_M2 = 4046.8564224

# Source vintage of each partial edition (as published before this work).
SOURCE_RANGES = [
    ('1921-05-03', '1936-04-01', 'NI_Admin_Areas_1921-1936.fgb'),
    ('1937-04-01', '1948-04-01', 'NI_Admin_Areas_1937-1948.fgb'),
    ('1949-04-01', '1963-09-13', 'NI_Admin_Areas_1949-1963.fgb'),
    ('1964-04-01', '1964-06-02', 'NI_Admin_Areas_1964.fgb'),
    ('1965-04-01', '1968-04-01', 'NI_Admin_Areas_1965-1968.fgb'),
    ('1969-04-01', '1969-04-01', 'NI_Admin_Areas_1969.fgb'),
]
SKIP_EDITIONS = {'admin-areas-1930-04-01', 'admin-areas-1966-07-04'}  # complete files of their own

# Districts with no series file that are drawn on the 1930 line throughout.
BASE_ONLY = {'keady-ud': 'Keady Urban District'}
# Derived rural districts: RD name -> (its towns' 1930 names, their district keys).
RD_GROUPS = {'Armagh Rural District': (['Armagh Urban District', 'Keady Urban District'], ['armagh-ud', 'keady-ud'])}

LGD_1966 = 'LGDs_04-07-1966.fgb'
# 1966 file: district key -> (FullName of the feature to replace, FullName of the RD that takes the difference)
LGD_1966_FIX = {
    'armagh-ud': ('Armagh Urban District', 'Armagh Rural District'),
    'larne-mb': ('Larne Municipal Borough', 'Larne Rural District'),
    'lurgan-ud': ('Lurgan Municipal Borough', 'Lurgan Rural District'),
    'bangor-mb': ('Bangor Municipal Borough', 'North Down Rural District'),
}
# The 1966 file's "Newtownabbey Rural District" is the old Belfast RD extent. Replace it with
# the 1958 urban district and give the rest of Belfast RD to the rural districts it went to
# (whole-townland groups in <inputs>/aux/belfast-rd-transfers-1958.geojson).
NEWTOWNABBEY_1966 = ('newtownabbey-ud', 'Newtownabbey Rural District', 'Newtownabbey Urban District')

TO_IG = Transformer.from_crs(4326, 29903, always_xy=True)
TO_LL = Transformer.from_crs(29903, 4326, always_xy=True)


def ig(g):
    return transform(lambda x, y, z=None: TO_IG.transform(x, y), g).buffer(0)


def ll(g):
    return transform(lambda x, y, z=None: TO_LL.transform(x, y), g)


def read(path: Path) -> list[dict]:
    out = subprocess.run(['ogr2ogr', '-f', 'GeoJSON', '/vsistdout/', str(path)], check=True, capture_output=True)
    return json.loads(out.stdout.decode('utf-8'))['features']


def write(features: list[dict], path: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / 'out.geojson'
        src.write_text(json.dumps({'type': 'FeatureCollection', 'features': features}), encoding='utf-8')
        if path.exists():
            path.unlink()
        subprocess.run(['ogr2ogr', '-f', 'FlatGeobuf', '-nln', path.stem, '-a_srs', 'EPSG:4326',
                        '-nlt', 'MULTIPOLYGON', '-lco', 'SPATIAL_INDEX=YES', str(path), str(src)], check=True)


def load_series(inputs: Path, base: dict) -> dict[str, list]:
    series: dict[str, list] = {}
    for path in sorted(inputs.glob('*.geojson')):
        for f in json.loads(path.read_text(encoding='utf-8'))['features']:
            p = f['properties']
            g = base[p.get('baseName') or p['AdministrativeArea']] if p.get('base1930') else ig(shape(f['geometry']))
            series.setdefault(path.stem, []).append((
                date.fromisoformat(p['from']), date.fromisoformat(p['to']) if p.get('to') else None,
                p['AdministrativeArea'], g, id(g)))
    for key, name in BASE_ONLY.items():
        series[key] = [(date(1900, 1, 1), None, name, base[name], id(base[name]))]
    return series


def state_at(when: date, series) -> dict[str, tuple]:
    out = {}
    for key, rows in series.items():
        hits = [r for r in rows if r[0] <= when and (r[1] is None or when < r[1])]
        if len(hits) > 1:
            raise SystemExit(f'{key}: {len(hits)} lines in force on {when}')
        if hits:
            out[key] = hits[0]
    return out


def source_for(d: str) -> str | None:
    for lo, hi, name in SOURCE_RANGES:
        if lo <= d <= hi:
            return name
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--inputs', type=Path, default=DEFAULT_INPUTS)
    args = ap.parse_args()
    STAGED.mkdir(exist_ok=True)
    base = {f['properties']['AdministrativeArea']: ig(shape(f['geometry'])) for f in read(BASE_1930)}
    series = load_series(args.inputs, base)
    ok = True

    maps = json.loads(MAPS_JSON.read_text(encoding='utf-8'))['maps']
    editions = sorted((m['date'], m['id']) for m in maps
                      if m['id'].startswith('admin-areas-') and m['id'] not in SKIP_EDITIONS)
    # group consecutive editions with the same source and the same state
    groups: list[dict] = []
    for d, eid in editions:
        src = source_for(d)
        if src is None:
            print(f'  ERROR no source vintage for {eid}'); ok = False; continue
        st = state_at(date.fromisoformat(d), series)
        sig = (src, tuple(sorted((k, v[2], v[4]) for k, v in st.items())))
        if groups and groups[-1]['sig'] == sig:
            groups[-1]['editions'].append((d, eid))
        else:
            groups.append({'sig': sig, 'src': src, 'state': st, 'editions': [(d, eid)]})

    tiled = {l.get('sourceMapId') for l in json.loads(MAPS_TEST.read_text(encoding='utf-8'))['layers']
             if str(l.get('id', '')).endswith('-vector-test')}
    plan = {}
    src_editions = {}
    for d, eid in editions:
        src_editions.setdefault(source_for(d), []).append(eid)
    for g in groups:
        eids = [e for _, e in g['editions']]
        name = g['src'] if eids == src_editions[g['src']] else \
            f"NI_Admin_Areas_{g['editions'][0][0]}_{g['editions'][-1][0]}.fgb"
        feats = read(LG / g['src'])
        names = {f['properties']['AdministrativeArea'] for f in feats}
        others = unary_union([ig(shape(f['geometry'])) for f in feats])
        added = {v[2]: v[3] for v in g['state'].values()}
        for rd, (towns1930, keys) in RD_GROUPS.items():
            group30 = unary_union([base[rd]] + [base[t] for t in towns1930])
            here = [g['state'][k][3] for k in keys if k in g['state']]
            added[rd] = group30.difference(unary_union(here)).difference(others).buffer(0)
        clash = names & set(added)
        if clash:
            print(f'  ERROR {name}: source already has {sorted(clash)}'); ok = False
        towns = [n for n in added if n not in RD_GROUPS]
        for n in towns:
            ov = added[n].intersection(others).area
            if ov > 20000:
                print(f'  ERROR {name}: {n} overlaps other features by {ov:.0f} m2'); ok = False
            elif ov > 5:   # reconstruction slivers against the source layer's lines: the source wins
                print(f'  note {name}: {n} clipped by {ov:.0f} m2 where it met other features')
                added[n] = added[n].difference(others).buffer(0)
        for i, a in enumerate(towns):
            for b in towns[i + 1:]:
                if added[a].intersection(added[b]).area > 5:
                    print(f'  ERROR {name}: {a} overlaps {b}'); ok = False
        out = [dict(f, properties={'AdministrativeArea': f['properties']['AdministrativeArea']}) for f in feats]
        out += [{'type': 'Feature', 'properties': {'AdministrativeArea': n}, 'geometry': mapping(ll(added[n]))}
                for n in sorted(added)]
        write(out, STAGED / name)
        # keep an edition that already has its own tile layer as the group's canonical
        canon = next((e for e in eids if e in tiled), eids[0])
        for e in eids:
            plan[e] = {'file': name, 'cloneOf': None if e == canon else canon}
        summary = ', '.join(f'{n} {added[n].area / ACRE_M2:,.0f} ac' for n in sorted(added))
        print(f'{name}: {len(eids)} edition(s) {eids[0]}..{eids[-1]}; +{summary}')

    # ---- 1966 LGD file and its LODs ----
    when = date(1966, 7, 4)
    st = state_at(when, series)
    by = {f['properties']['FullName']: f for f in read(LG / LGD_1966)}
    notes = {}
    for key, (town, rd) in LGD_1966_FIX.items():
        if key not in st:
            print(f'  ERROR 1966: no line for {key}'); ok = False; continue
        new = st[key][3]
        old_t, old_r = ig(shape(by[town]['geometry'])), ig(shape(by[rd]['geometry']))
        rest = unary_union([ig(shape(f['geometry'])) for n, f in by.items() if n not in (town, rd)])
        new = new.difference(rest)
        new_r = unary_union([old_t, old_r]).difference(new).difference(rest).buffer(0)
        notes[town] = f'{old_t.area / ACRE_M2:,.0f} -> {new.area / ACRE_M2:,.0f} ac'
        print(f'{LGD_1966}: {town} {notes[town]}; {rd} {old_r.area / ACRE_M2:,.0f} -> {new_r.area / ACRE_M2:,.0f} ac')
        by[town]['geometry'] = mapping(ll(new))
        by[rd]['geometry'] = mapping(ll(new_r))
    key, old_name, new_name = NEWTOWNABBEY_1966
    if key in st and old_name in by:
        new = st[key][3]
        old = ig(shape(by[old_name]['geometry']))
        groups = {f['properties']['AdministrativeArea']: ig(shape(f['geometry'])) for f in
                  json.loads((args.inputs / 'aux' / 'belfast-rd-transfers-1958.geojson').read_text(encoding='utf-8'))['features']}
        others = unary_union([ig(shape(f['geometry'])) for n, f in by.items() if n != old_name and n not in groups])
        new = new.intersection(old.union(new)).difference(others).buffer(0)
        moved = old.difference(new)
        give = {rd: [moved.intersection(g)] for rd, g in groups.items()}
        rest_m = moved.difference(unary_union(list(groups.values())))
        for part in getattr(rest_m, 'geoms', [rest_m]):   # slivers outside every group: nearest group
            if part.is_empty:
                continue
            give[min(groups, key=lambda rd: part.distance(groups[rd]))].append(part)
        for rd, pieces in give.items():
            if rd not in by:
                print(f'  ERROR 1966: no feature {rd}'); ok = False; continue
            g0 = ig(shape(by[rd]['geometry']))
            g1 = unary_union([g0] + pieces).buffer(0)
            print(f'{LGD_1966}: {rd} {g0.area / ACRE_M2:,.0f} -> {g1.area / ACRE_M2:,.0f} ac (from Belfast RD)')
            by[rd]['geometry'] = mapping(ll(g1))
        f = by.pop(old_name)
        props = dict(f['properties'], FullName=new_name, Type='Urban District', Unit='Newtownabbey')
        by[new_name] = {'type': 'Feature', 'properties': props, 'geometry': mapping(ll(new))}
        print(f'{LGD_1966}: {old_name} {old.area / ACRE_M2:,.0f} ac -> {new_name} {new.area / ACRE_M2:,.0f} ac')
    write(list(by.values()), STAGED / LGD_1966)
    for tol, suffix in [(0.0008, '-lod0'), (0.0002, '-lod1')]:
        lod = [dict(f, geometry=mapping(shape(f['geometry']).simplify(tol, preserve_topology=True)))
               for f in by.values()]
        write(lod, STAGED / LGD_1966.replace('.fgb', f'{suffix}.fgb'))

    (STAGED / 'editions.json').write_text(json.dumps(plan, indent=2) + '\n', encoding='utf-8')
    print(f'wrote {len(plan)} edition rows to {(STAGED / "editions.json").relative_to(ROOT)}')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
