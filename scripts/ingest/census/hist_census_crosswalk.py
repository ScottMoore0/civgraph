#!/usr/bin/env python3
"""Put the 1926, 1937, 1951 and 1961 census DED (and county-borough ward) populations on the
2021 Data Zones, three ways, apportioning counts only:

  area   plain areal weighting, as ward1972_to_dz2021_weights.csv was made: a unit's count goes
         to the Data Zones in proportion to the area of the unit that lies in each.
  town   town-aware (dasymetric): the printed population of each town with no legal boundary that
         lies in a rural DED goes to the town's footprint (its 2015 settlement-development-limit
         polygon, cut to the DED), and only the rest of the DED's population is spread by area over
         the rest of the DED.
  stock  (only with --stock, PRIVATE) as 'town', but inside and outside the town footprint the
         population follows the count of surviving domestic properties built by the census year,
         from the valuation list's era bands; area weighting where a unit has none, and a blend
         where persons per surviving property is implausibly high (demolished stock).

Units. Each census DED or ward is matched to a feature of the DED map in force on census day
(1926: the full 1926 map; 1937, 1951, 1961: the partial editions, which hold only the DEDs whose
lines are unchanged from Paddy Matthews's maps). The DEDs the partial edition leaves out are
pooled: the land no matched DED covers (inside the outline of the full 1926 map, so every line is
one of his) is split into holes, each unmatched DED is put in the hole(s) its 1926 namesake or its
district touches, and the DEDs and holes that touch form one pooled unit. No line is drawn.

Reads areas/areas-<year>.csv and areas/religion-<year>.csv (validated rows only) from --out, the
maps from the main checkout's data/maps (gitignored there), and with --stock the valuation extract
in place. Writes crosswalk/units-<year>.csv, crosswalk/weights-<year>.csv, series/dz21-census-
<year>.csv and crosswalk/checks-<year>.csv; with --stock, private/ only.

Usage: python scripts/ingest/census/hist_census_crosswalk.py --years 1926,1937 [--stock EXTRACT]
"""
import argparse
import csv
import json
import os
import re
import sys
import warnings
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from hist_census_lib import (CENSUS_DAY, OPEN_BAND_END, UnionFind, dasymetric_weights, district_kind, era_weight,  # noqa: E402
                             match_units, norm_key, stock_unit_weights, stock_weight)

warnings.filterwarnings('ignore')
from hist_census_paths import MAIN, MAPS, OUT  # noqa: E402,F401  (MAIN, OUT: re-exported to the other drivers)
CRS = 'EPSG:29902'   # Irish Grid, metres
LAYERS = {
    '1926': 'electoral-divisions/NorthernIrelandDEDs1926.fgb',
    '1937': 'electoral-divisions/NI_DEDs_1935-06-26_v2_partial.fgb',   # the edition ded-1936-04-01 uses
    '1951': 'electoral-divisions/NI_DEDs_1950-04-01_v2_partial.fgb',
    '1961': 'electoral-divisions/NI_DEDs_1958-04-01_v2_partial.fgb',
}
FULL_1926 = 'electoral-divisions/NorthernIrelandDEDs1926.fgb'
DZ = 'census-areas/DZ2021.fgb'
SETTLEMENTS = 'physical/Settlements_2015.fgb'


def read_csv(path):
    with open(path, encoding='utf-8') as f:
        return list(csv.DictReader(f))


def write_csv(path, rows, cols):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, cols, extrasaction='ignore')
        w.writeheader()
        w.writerows(rows)


def num(v):
    try:
        return float(v) if v not in (None, '') else None
    except ValueError:
        return None


def census_units(out, year):
    """Validated DEDs and wards, their towns, and a Catholic count per DED where religion is
    printed only for the district (the district's share applied to the DED: flagged)."""
    rows = read_csv(os.path.join(out, 'areas', f'areas-{year}.csv'))
    rel = read_csv(os.path.join(out, 'areas', f'religion-{year}.csv'))
    rel_by = {}
    for r in rel:
        if r.get('status') != 'ok' or not r.get('persons'):
            continue
        kind = r['area_type']
        nm = re.sub(r'\s+Ward$', '', r['name'] or '')
        rel_by[(r['county'], norm_key(nm), kind)] = r
    units, towns, excluded = [], [], []
    current_ded = {}
    for r in rows:
        t = r['area_type']
        if t in ('ded', 'ward'):
            ok = r['status'] == 'ok' and num(r['persons']) is not None
            if not ok:
                excluded.append(r)
            uid = f"{r['county']}|{r['district']}|{r.get('ref') or ''}|{r['name']}"
            u = {'id': uid, 'county': r['county'], 'name': r['name'], 'district': r['district'], 'ward': r.get('ward', ''),
                 'persons': num(r['persons']) if ok else None, 'males': num(r['males']) if ok else None,
                 'females': num(r['females']) if ok else None, 'ref': r.get('ref'), 'validated': ok}
            # religion: the ward's own (county boroughs), else the district's share
            dk = district_kind(r['district'])
            own = None
            mderry = re.match(r'londonderry\W*no\W*(?:\d\W*)?urban\W+(.+)$', r['name'] or '', re.I)
            if mderry and not r.get('ward'):
                r = dict(r, ward=mderry.group(1))   # 1937: 'Londonderry No. 1 Urban D.E.D. or North Ward'
            if dk == 'county_borough' or r['county'] == 'Belfast County Borough' or mderry:
                own = rel_by.get((r['county'], norm_key(r.get('ward') or r['name']), 'ward'))
                if own is None:
                    # an OCR'd ward name ('PoTTriINGER', 'Fats'): the closest ward of the borough
                    import difflib
                    cands = [(difflib.SequenceMatcher(None, norm_key(r.get('ward') or r['name']), k).ratio(), v)
                             for (c, k, kind), v in rel_by.items() if c == r['county'] and kind == 'ward']
                    cands.sort(key=lambda x: -x[0])
                    if cands and cands[0][0] >= 0.6:
                        own = cands[0][1]
            d = next((v for (c, k, kind), v in rel_by.items() if c == r['county'] and kind == dk
                      and k == norm_key(r['district'])), None)
            if d is None:
                # a spelling difference between the two tables ('Clougher' and 'Clogher')
                import difflib
                cands = sorted(((difflib.SequenceMatcher(None, k, norm_key(r['district'])).ratio(), v)
                                for (c, k, kind), v in rel_by.items() if c == r['county'] and kind == dk),
                               key=lambda x: -x[0])
                d = cands[0][1] if cands and cands[0][0] >= 0.85 else None
            u['district_catholic_share'] = num(d['catholic']) / num(d['persons']) if d and num(d['persons']) else None
            if own and ok:
                u['catholic'], u['catholic_basis'] = num(own['catholic']), 'ward'
            elif ok and u['district_catholic_share'] is not None:
                u['catholic'] = u['persons'] * u['district_catholic_share']
                u['catholic_basis'] = 'district share'
            units.append(u)
            current_ded[(r['county'], r['district'], r.get('ref') or '')] = uid
            current_ded['last'] = uid
        elif t in ('town', 'town_part') and num(r['persons']) and num(r['males']) is not None \
                and min(num(r['males']), num(r['females']) or 0) >= 0.3 * num(r['persons']) and r['status'] != 'fail':
            # 1926: the town row names its DED's serial; later years: the DED row above it. A
            # town row is checked only by its sexes, so one whose sexes are implausibly unequal
            # (an OCR repair gone wrong) is not used.
            key = (r['county'], r['district'], r.get('ref') or '')
            towns.append({'name': r['name'], 'county': r['county'], 'persons': num(r['persons']),
                          'unit': current_ded.get(key) if r.get('ref') else current_ded.get('last')})
    # district totals, usable where a district's DEDs do not all validate: a district's printed
    # total counts as validated when its county's districts add to the county total (a county
    # borough is its own county)
    # 1937: the towns are in their own table (Table 5), which does not name their DEDs: a town
    # goes to the 1937 DED of the same name as the DED its 1926 namesake lay in (1926 Table 3),
    # else to a DED of its own name; a town found in neither stays spread by area (listed).
    tpath = os.path.join(out, 'areas', f'towns-{year}.csv')
    if not towns and os.path.exists(tpath):
        import difflib
        ded26 = {}
        rows26 = read_csv(os.path.join(out, 'areas', 'areas-1926.csv'))
        dn = {(r['county'], r['district'], r['ref']): r['name'] for r in rows26 if r['area_type'] in ('ded', 'ward')}
        for r in rows26:
            if r['area_type'] in ('town', 'town_part'):
                ded26.setdefault((r['county'], norm_key(r['name'])), dn.get((r['county'], r['district'], r['ref'])))
        by_county = defaultdict(list)
        for u in units:
            by_county[u['county']].append(u)

        def find_unit(county, name):
            k = norm_key(name)
            best = max(((difflib.SequenceMatcher(None, k, norm_key(u['name'])).ratio(), u['id']) for u in by_county[county]),
                       default=(0, None))
            return best[1] if best[0] >= 0.85 else None
        for t in read_csv(tpath):
            if not num(t['persons']) or min(num(t['males']), num(t['females'])) < 0.3 * num(t['persons']):
                continue
            d26 = ded26.get((t['county'], norm_key(t['name'])))
            uid = (find_unit(t['county'], d26) if d26 else None) or find_unit(t['county'], t['name'])
            if uid:
                towns.append({'name': t['name'], 'county': t['county'], 'persons': num(t['persons']), 'unit': uid})
    # A county borough whose wards the area table did not yield (1961 Belfast: wards printed by
    # name alone, no serials) takes them from the religion table, where each ward's persons,
    # males, females and denominations were checked against the borough total.
    have = {u['county'] for u in units if district_kind(u['district']) == 'county_borough'}
    keys = defaultdict(set)
    for u in units:
        keys[u['county']].add(norm_key(u['name']))
    for r in rel:
        wk = norm_key(re.sub(r'\s+Ward$', '', r['name'] or ''))
        if any(k.endswith(wk) for k in keys[r['county']]):
            continue   # the area table has this ward (under some label)
        if r['area_type'] == 'ward' and r.get('status') == 'ok' and r['county'] not in have and num(r['persons']):
            cb = 'Belfast County Borough' if r['county'].startswith('Belfast') else 'Londonderry County Borough'
            nm = re.sub(r'\s+Ward$', '', r['name'])
            units.append({'id': f"{r['county']}|{cb}||{nm}", 'county': r['county'], 'name': nm, 'district': cb, 'ward': nm,
                          'persons': num(r['persons']), 'males': num(r['males']), 'females': num(r['females']),
                          'ref': None, 'validated': True, 'catholic': num(r['catholic']), 'catholic_basis': 'ward',
                          'district_catholic_share': None, 'source': 'religion table'})
    # The religion tables print every district's persons, males and females again, and there
    # every district and category was checked against the county total: those are the district
    # totals used. Keyed by the district's key (norm_key + kind).
    rchecks = read_csv(os.path.join(out, 'validation', f'religion-checks-{year}.csv')) \
        if os.path.exists(os.path.join(out, 'validation', f'religion-checks-{year}.csv')) else []
    bad_c = {c['area'] for c in rchecks if c['check'] == 'religion_areas_to_total' and c['status'] != 'ok'}
    dist = {}
    for r in rel:
        if r.get('status') == 'ok' and r['area_type'] in ('urban_district', 'rural_district', 'municipal_borough',
                                                           'county_borough') and num(r['persons']):
            dist[dkey(r['name'])] = {'persons': num(r['persons']), 'males': num(r['males']),
                                     'females': num(r['females']), 'validated': r['county'] not in bad_c,
                                     'catholic': num(r['catholic']), 'name': r['name']}
    for r in rows:   # 1926: the county tables' own district rows (validated against the county)
        if r['area_type'] in ('urban_district', 'rural_district', 'municipal_borough', 'county_borough') \
                and num(r['persons']) and dkey(r['name']) not in dist and year == '1926' and r['status'] == 'ok':
            dist[dkey(r['name'])] = {'persons': num(r['persons']), 'males': num(r['males']),
                                     'females': num(r['females']), 'validated': True, 'catholic': None, 'name': r['name']}
    return units, towns, excluded, dist


def dkey(name):
    """A district's key: name and kind ('Tanderagee' and 'Tandragee' differ only in spelling)."""
    s = str(name or '').replace('Tanderagee', 'Tandragee')
    return norm_key(s) + '|' + (district_kind(s) or '')


def load_layer(rel, crs=CRS):
    import geopandas as gpd
    g = gpd.read_file(MAPS / rel).to_crs(crs)
    g['geometry'] = g.geometry.buffer(0)
    g = g.reset_index(drop=True)
    g['fid'] = [f'f{i}' for i in range(len(g))]
    return g


def build_units(year, units, layer, full, aliases):
    """Matched units (census DED = layer feature) and pooled units (holes)."""
    import geopandas as gpd
    from shapely.ops import unary_union
    census = [{'id': u['id'], 'county': u['county'], 'name': u['name'], 'district': u['district'],
               'ward': u.get('ward', '')} for u in units]
    lay = [{'id': f, 'county': c, 'name': n} for f, c, n in zip(layer.fid, layer.COUNTY, layer.ED_NAME)]
    if 'AdministrativeArea' in layer.columns:
        # the map's district, where the census has a district of that name (the 1958 map keeps
        # some names the 1961 census no longer uses), restricts the fuzzy matches
        cdk = {dkey(u['district']) for u in units}
        for f, a in zip(lay, layer.AdministrativeArea):
            if dkey(a) in cdk:
                f['district'] = a
    m, un_c, un_l = match_units(census, lay, aliases)
    if 'AdministrativeArea' in layer.columns and un_c and un_l:
        # OCR'd names ('SeacaalL', 'Klrklnrlola'): within one district of the map, the closest
        # remaining name (ratio >= 0.6), best pairs first, one to one
        import difflib
        adm = dict(zip(layer.fid, layer.AdministrativeArea))
        lname = dict(zip(layer.fid, layer.ED_NAME))
        cby = {c['id']: c for c in census}
        pairs = []
        for cid in un_c:
            c = cby[cid]
            for fid in un_l:
                if dkey(adm.get(fid)) != dkey(c['district']):
                    continue
                r = difflib.SequenceMatcher(None, norm_key(c['name']), norm_key(lname[fid])).ratio()
                if r >= 0.6:
                    pairs.append((r, cid, fid))
        used = set()
        for r, cid, fid in sorted(pairs, reverse=True):
            if cid in m or fid in used:
                continue
            m[cid] = (fid, f'fuzzy in district {r:.2f}')
            used.add(fid)
        un_c = [c for c in un_c if c not in m]
        un_l = [f for f in un_l if f not in used]
    geom = dict(zip(layer.fid, layer.geometry))
    by_id = {u['id']: u for u in units}
    out = []
    for cid, (fid, how) in m.items():
        admin = layer.AdministrativeArea[layer.fid == fid].iloc[0] if 'AdministrativeArea' in layer.columns else None
        out.append({'unit': cid, 'kind': 'matched', 'how': how, 'members': [cid], 'geometry': geom[fid],
                    'layer_name': layer.ED_NAME[layer.fid == fid].iloc[0], 'admin': admin})
    pools = []
    if un_c or un_l:
        outline = unary_union(list(full.geometry))
        covered = unary_union([geom[fid] for fid, _ in m.values()])
        holes = outline.difference(covered)
        # the holes cut along the 1926 map's own DED lines, so that a pool is no larger than
        # the old DEDs its members replaced
        parts = []
        for hp in [p for p in getattr(holes, 'geoms', [holes]) if p.area > 5000]:   # > 0.5 ha
            for og in full.geometry[full.geometry.intersects(hp)]:
                piece = hp.intersection(og)
                if piece.area > 5000:
                    parts.append(piece)
        uf = UnionFind()
        claims = defaultdict(set)   # piece -> the DEDs whose 1926 namesake it lies in
        full_by = defaultdict(list)
        for c, n, gm in zip(full.COUNTY, full.ED_NAME, full.geometry):
            full_by[(str(c).split()[0].upper(), norm_key(n))].append(gm)
        dist_geom = defaultdict(list)
        for cid, (fid, _) in m.items():
            dist_geom[(by_id[cid]['county'], by_id[cid]['district'])].append(geom[fid])
        for cid in un_c:
            u = by_id[cid]
            ck = u['county'].split()[0].upper()
            olds = list(full_by.get((ck, norm_key(u['name'])), []))
            if ck == 'BELFAST':   # Belfast's wards lie in Antrim and Down on the 1926 map
                for c2 in ('ANTRIM', 'DOWN'):
                    olds += full_by.get((c2, norm_key(u.get('ward') or u['name'])), [])
            first = (u['district'] or '').split()[0:1]
            if first and u['name'].lower().startswith(first[0].lower() + ' '):
                # 'Larne Central' in Larne Urban District is 'CENTRAL' on the 1926 map
                olds += full_by.get((ck, norm_key(u['name'][len(first[0]):])), [])
            if first:
                # and 'North' in Ballycastle Urban District is 'BALLYCASTLE NORTH'
                olds += full_by.get((ck, norm_key(f"{first[0]} {u['name']}")), [])
            hit = False
            for og in olds:
                for i, p in enumerate(parts):
                    if p.intersection(og).area > 0.1 * min(og.area, p.area):
                        uf.union(('c', cid), ('h', i))
                        claims[i].add(cid)
                        hit = True
            if not hit:
                # a DED with no 1926 namesake: the piece of hole that shares most boundary with
                # the placed DEDs of its own district
                dg = dist_geom.get((u['county'], u['district']))
                if dg:
                    du = unary_union(dg).buffer(5)
                    best = max(((p.intersection(du).area, i) for i, p in enumerate(parts) if p.intersects(du)), default=None)
                    if best:
                        uf.union(('c', cid), ('h', best[1]))
                        hit = True
            if not hit:
                uf.find(('c', cid))
        for fid in un_l:
            for i, p in enumerate(parts):
                if p.intersection(geom[fid]).area > 0.5 * geom[fid].area:
                    uf.find(('h', i))
        # holes with no census DED join the pool they share most boundary with
        comp = defaultdict(list)
        for i in range(len(parts)):
            uf.find(('h', i))
        for node in list(uf.parent):
            comp[uf.find(node)].append(node)
        has_ded = {r for r, ns in comp.items() if any(n[0] == 'c' for n in ns)}
        for root, ns in list(comp.items()):
            if root in has_ded:
                continue
            gm = unary_union([parts[n[1]] for n in ns if n[0] == 'h'])
            best, blen = None, 0.0
            for r2 in has_ded:
                g2 = unary_union([parts[n[1]] for n in comp[r2] if n[0] == 'h'])
                if g2.is_empty:
                    continue
                L = gm.buffer(2).intersection(g2.buffer(2)).area
                if L > blen:
                    best, blen = r2, L
            if best is not None:
                uf.union(ns[0], comp[best][0])
        comp = defaultdict(list)
        for node in list(uf.parent):
            comp[uf.find(node)].append(node)
        for k, (root, ns) in enumerate(sorted(comp.items(), key=lambda kv: str(kv[0]))):
            members = sorted(n[1] for n in ns if n[0] == 'c')
            hs = [parts[n[1]] for n in ns if n[0] == 'h']
            if not members:
                pools.append({'unit': f'{year}:empty:{k}', 'kind': 'empty hole', 'how': '', 'members': [],
                              'geometry': unary_union(hs) if hs else None, 'layer_name': ''})
                continue
            if not hs:
                pools.append({'unit': f'{year}:nogeom:{k}', 'kind': 'no geometry', 'how': '', 'members': members,
                              'geometry': None, 'layer_name': ''})
                continue
            hidx = [n[1] for n in ns if n[0] == 'h']
            own = defaultdict(list)
            for i in hidx:
                if len(claims[i]) == 1:
                    own[next(iter(claims[i]))].append(i)
            solo = [c for c in members if own.get(c)]
            if len(members) > 1 and solo:
                # a DED lying in pieces that only its own 1926 namesake covers takes those pieces
                # as its unit; the DEDs left (no namesake, or a namesake shared) keep the shared
                # pieces as a smaller pool; pieces nobody claims go to the unit they share most
                # boundary with
                geoms = {c: [parts[i] for i in own[c]] for c in solo}
                rest = [c for c in members if c not in solo]
                rest_parts = [parts[i] for i in hidx if len(claims[i]) > 1]
                if rest:
                    geoms[tuple(rest)] = rest_parts
                for i in hidx:
                    if not claims[i]:
                        tgt = max(geoms, key=lambda c: parts[i].buffer(2).intersection(unary_union(geoms[c]).buffer(2)).area
                                  if geoms[c] else -1)
                        geoms[tgt].append(parts[i])
                if rest and not geoms[tuple(rest)]:
                    # the DEDs left have no land of their own: they join the largest unit here
                    big = max(solo, key=lambda c: unary_union(geoms[c]).area)
                    geoms[(big,) + tuple(rest)] = geoms.pop(big)
                    del geoms[tuple(rest)]
                for key, gs in geoms.items():
                    mem = list(key) if isinstance(key, tuple) else [key]
                    pools.append({'unit': f'{year}:split:{k}:{mem[0]}', 'kind': 'hole piece of its 1926 namesake' if len(mem) == 1 else 'pool',
                                  'how': 'holes cut by the 1926 lines', 'members': mem,
                                  'geometry': unary_union(gs), 'layer_name': ''})
                continue
            pools.append({'unit': f'{year}:pool:{k}', 'kind': 'pool', 'how': 'holes', 'members': members,
                          'geometry': unary_union(hs), 'layer_name': ''})
    return out + pools, m, un_c, un_l


def coarsen(urows, by_id, dist, year, admin_geom=None):
    """Only validated counts may reach the Data Zones. Each unit belongs to a district: the
    district the DED map gives its feature (when that names a district of the census), else the
    district the census table prints it under. A district keeps its DED units when every DED in
    it validated and they add up to the district's total in the religion table (a second
    printing, itself checked against the county); otherwise its units (and every unit sharing a
    DED with them) become one unit carrying the district's printed total. A district with no
    validated total leaves its units without a count (listed as failures)."""
    from shapely.ops import unary_union

    def unit_district(u):
        a = u.get('admin')
        if a and dkey(a) in dist:
            return dkey(a)
        ks = {dkey(by_id[m]['district']) for m in u['members']}
        return sorted(ks)[0] if ks else None

    ud = {u['unit']: unit_district(u) for u in urows}
    # a district is bad when one of its DEDs (as the census prints them under it) did not
    # validate, or they do not add up to its total
    mem_by_d = defaultdict(list)
    for cid, c in by_id.items():
        mem_by_d[dkey(c['district'])].append(c)
    bad = set()
    for dk, mem in mem_by_d.items():
        tot = dist.get(dk)
        if any(not m['validated'] for m in mem) or (tot and sum(m['persons'] or 0 for m in mem) != tot['persons']):
            bad.add(dk)
    # a DED the map could not place (no feature, no hole) joins the largest placed unit of its
    # own district: the pair carries both validated counts over the placed unit's land
    placed = [u for u in urows if u['geometry'] is not None]
    for u in [u for u in urows if u['geometry'] is None]:
        dks = {dkey(by_id[m]['district']) for m in u['members']}
        host = max((p for p in placed if {dkey(by_id[m]['district']) for m in p['members']} & dks),
                   key=lambda p: p['geometry'].area, default=None)
        if host is None:
            for dk in dks:
                bad.add(dk)
            continue
        host['members'] = host['members'] + u['members']
        host['kind'] = 'matched + unplaced DED' if host['kind'] == 'matched' else host['kind']
        host['how'] = (host.get('how') or '') + '; with ' + ', '.join(by_id[m]['name'] for m in u['members'])
        urows = [x for x in urows if x is not u]
    # the districts a unit touches: its own members' and the map's
    # (the census's own district labels: every district's DEDs have been checked to add to its
    # total, so the map's district names are not needed to catch mislabelled DEDs)
    u_ds = {u['unit']: {dkey(by_id[m]['district']) for m in u['members']} for u in urows}
    notes = []
    if not bad:
        return urows, notes
    uf = UnionFind()
    for u in urows:
        uf.find(('u', u['unit']))
        for dk in u_ds[u['unit']] & bad:
            uf.union(('d', dk), ('u', u['unit']))
    groups = defaultdict(list)
    for u in urows:
        groups[uf.find(('u', u['unit']))].append(u)
    out = []
    for root, us in groups.items():
        if len(us) == 1 and not (u_ds[us[0]['unit']] & bad):
            out.extend(us)
            continue
        dks = sorted({dk for u in us for dk in u_ds[u['unit']] if dk})
        tot = {'persons': 0.0, 'males': 0.0, 'females': 0.0, 'catholic': 0.0}
        okk = True
        for dk in dks:
            d = dist.get(dk)
            if dk in bad:
                if not d or not d['validated']:
                    okk = False
                    continue
                for v in ('persons', 'males', 'females', 'catholic'):
                    tot[v] = tot[v] + d[v] if (tot[v] is not None and d.get(v) is not None) else None
            else:
                for u in us:
                    for m in u['members']:
                        if dkey(by_id[m]['district']) == dk:
                            for v in ('persons', 'males', 'females', 'catholic'):
                                x = by_id[m].get(v)
                                tot[v] = tot[v] + x if (x is not None and tot[v] is not None) else None
        geoms = [u['geometry'] for u in us if u['geometry'] is not None]
        if not geoms and admin_geom:
            # no DED of the group could be placed: the map's own features of its districts
            geoms = [admin_geom[dk] for dk in dks if dk in admin_geom]
        if not geoms and admin_geom and '__towns__' in admin_geom:
            # an urban district the partial map leaves out: its town's DEDs on the 1926 map,
            # less the land of the DEDs placed this year
            for dk in dks:
                nm = (dist.get(dk) or {}).get('name', '')
                if district_kind(nm) in ('urban_district', 'municipal_borough'):
                    town = re.sub(r'\s+(Urban District|Municipal Borough)$', '', nm).upper()
                    g = admin_geom['__towns__'](town)
                    if g is not None and not g.is_empty:
                        geoms.append(g)
        names = [dist[dk]['name'] if dk in dist else dk for dk in dks]
        out.append({'unit': f'{year}:district:{len(out)}', 'kind': 'district (DEDs not all validated)', 'how': 'coarsened',
                    'members': sorted({m for u in us for m in u['members']}), 'geometry': unary_union(geoms) if geoms else None,
                    'layer_name': ' + '.join(names), 'override': tot if okk else None})
        notes.append({'year': year, 'check': 'coarsened_to_district', 'area': ' + '.join(names),
                      'status': 'note' if okk else 'fail', 'diff': len(out[-1]['members'])})
    return out, notes


def settlement_footprints(settle, towns, unit_rows, by_member):
    """{unit: [(town name, persons, footprint geometry)]}: each printed town's 2015 settlement
    polygon (matched by name), cut to the unit holding the town's DED."""
    from shapely.ops import unary_union
    names = defaultdict(list)
    for n, g in zip(settle.Name, settle.geometry):
        names[norm_key(n)].append(g)
    geom = {u['unit']: u['geometry'] for u in unit_rows}
    out = defaultdict(list)
    missing = []
    for t in towns:
        unit = by_member.get(t['unit'])
        if not unit or geom.get(unit) is None:
            continue
        # 'Crumlin foun, part of (a)', 'Doagh Toun (f)': the town's name before 'Town'
        base = re.split(r'\s+[TtFf][oO0][wWuU][nNmM]\b|\s+Tovm\b|,?\s+part\b|\s+\(', t['name'])[0].strip(' ,.')
        cands = names.get(norm_key(t['name'])) or names.get(norm_key(base))
        fp = None
        if cands:
            g = unary_union(cands).intersection(geom[unit])
            if not g.is_empty and g.area > 1000:
                fp = g
        if fp is None:
            missing.append(t['name'])
            continue
        out[unit].append((t['name'], t['persons'], fp))
    return out, missing


def read_domestic(src):
    """The domestic properties of the valuation list (src: a private extract, read in place,
    given on the command line), era band only, in Irish Grid. Never written out."""
    import geopandas as gpd
    import pyogrio
    df = pyogrio.read_dataframe(str(src), columns=['SubClass', 'HereditamentType'])
    df = df[df.HereditamentType == 'Domestic']
    return gpd.GeoDataFrame({'SubClass': df.SubClass.fillna('')}, geometry=df.geometry, crs=df.crs or 'EPSG:4326').to_crs(CRS)


def stock_points(dom, year, open_end=OPEN_BAND_END, bandless=0.0):
    """Aggregable stock weights per point (never written out): each domestic property weighted by
    the share of its era band built by the census day (hist_census_lib.era_weight: Pre 1919 1;
    Inter-War years before census day / 27; 1946-1965 the same over 20; 1966-1990 over 25).
    Apartments carry no era band and are left out unless bandless > 0."""
    import geopandas as gpd
    cday = CENSUS_DAY[year]
    wmap = {sc: stock_weight(sc, cday, open_end, bandless) for sc in dom.SubClass.unique()}
    w = dom.SubClass.map(wmap)
    keep = w > 0
    return gpd.GeoDataFrame({'w': w[keep].values}, geometry=dom.geometry[keep].values, crs=dom.crs)


def main():
    import geopandas as gpd
    import pandas as pd
    ap = argparse.ArgumentParser()
    ap.add_argument('--years', default='1926,1937,1951,1961')
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--stock', metavar='EXTRACT', help='also the private valuation-stock series, from this extract (read in place)')
    args = ap.parse_args()
    out = args.out
    dz = load_layer(DZ)[['DZ2021_cd', 'DZ2021_nm', 'geometry']]
    full = load_layer(FULL_1926)
    settle = load_layer(SETTLEMENTS)
    dom = read_domestic(args.stock) if args.stock else None
    for year in args.years.split(','):
        units, towns, excluded, dist = census_units(out, year)
        layer = load_layer(LAYERS[year])
        aliases = {}
        apath = os.path.join(out, 'crosswalk', f'aliases-{year}.csv')
        if os.path.exists(apath):
            lay_ix = {(str(c).split()[0].upper(), n): f for f, c, n in zip(layer.fid, layer.COUNTY, layer.ED_NAME)}
            for a in read_csv(apath):
                f = lay_ix.get((a['layer_county'].upper(), a['layer_name']))
                if f:
                    aliases[a['census_id']] = f
        urows, m, un_c, un_l = build_units(year, units, layer, full, aliases)
        by_id = {u['id']: u for u in units}
        checks = []
        admin_geom = {}
        if 'AdministrativeArea' in layer.columns:
            from shapely.ops import unary_union
            for a, sub in layer.groupby('AdministrativeArea'):
                admin_geom[dkey(a)] = unary_union(list(sub.geometry))
        if admin_geom:
            covered = unary_union([u['geometry'] for u in urows if u['kind'] == 'matched' and u['geometry'] is not None])

            def town_geom(town, covered=covered):
                fs = [g for n, g in zip(full.ED_NAME, full.geometry)
                      if str(n).upper().startswith(town + ' ') and 'RURAL' not in str(n).upper() or str(n).upper() == town + ' URBAN']
                return unary_union(fs).difference(covered) if fs else None
            admin_geom['__towns__'] = town_geom
        urows, coarse_notes = coarsen(urows, by_id, dist, year, admin_geom)
        checks += coarse_notes
        by_member = {mm: u['unit'] for u in urows for mm in u['members']}
        unit_out = []
        for u in urows:
            mem = [by_id[x] for x in u['members']]
            if 'override' in u:
                for v in ('persons', 'males', 'females', 'catholic'):
                    u[v] = (u['override'] or {}).get(v)
                u['catholic_basis'] = 'district share' if u.get('catholic') is not None else ''
            else:
                for v in ('persons', 'males', 'females', 'catholic'):
                    vals = [x.get(v) for x in mem]
                    u[v] = sum(vals) if vals and all(x is not None for x in vals) else None
                u['catholic_basis'] = ';'.join(sorted({x.get('catholic_basis', '') for x in mem}))
            unit_out.append({'year': year, 'unit': u['unit'], 'kind': u['kind'], 'how': u['how'],
                             'layer_name': u['layer_name'], 'members': ' + '.join(x['name'] for x in mem),
                             'n_members': len(mem), 'persons': u['persons'], 'males': u['males'],
                             'females': u['females'], 'catholic': round(u['catholic'], 1) if u['catholic'] is not None else '',
                             'catholic_basis': u['catholic_basis'],
                             'area_ha': round(u['geometry'].area / 1e4, 1) if u['geometry'] is not None else ''})
        geo = gpd.GeoDataFrame([{'unit': u['unit'], 'geometry': u['geometry']} for u in urows if u['geometry'] is not None],
                               crs=CRS)
        pieces = gpd.overlay(geo, dz, how='intersection', keep_geom_type=True)
        pieces['area'] = pieces.geometry.area
        pieces = pieces[pieces.area > 1].reset_index(drop=True)
        fps, missing_towns = settlement_footprints(settle, towns, urows, by_member)
        # footprint area of each piece
        fp_rows = [{'unit': un, 'town': nm, 'geometry': g} for un, lst in fps.items() for nm, _, g in lst]
        fp_area = defaultdict(float)
        if fp_rows:
            fpg = gpd.GeoDataFrame(fp_rows, crs=CRS)
            for un, sub in fpg.groupby('unit'):
                from shapely.ops import unary_union
                ug = unary_union(list(sub.geometry))
                pc = pieces[pieces.unit == un]
                for idx, g in zip(pc.index, pc.geometry):
                    a = g.intersection(ug).area
                    if a > 0:
                        fp_area[idx] = a
        stock = None
        if args.stock:
            pts = stock_points(dom, year)
            j = gpd.sjoin(pts, pieces[['geometry']], predicate='within', how='inner')
            stock = j.groupby('index_right').w.sum().to_dict()
            # in or out of a town footprint
            if fp_rows:
                fpg_all = gpd.GeoDataFrame(fp_rows, crs=CRS)
                jin = gpd.sjoin(pts, fpg_all[['geometry']], predicate='within', how='inner')
                inside_idx = set(jin.index)
                j_in = j[j.index.isin(inside_idx)]
                stock_in = j_in.groupby('index_right').w.sum().to_dict()
            else:
                stock_in = {}
            del pts, j
        unit_info = {u['unit']: u for u in urows}
        weights = []
        dz_tot = defaultdict(lambda: defaultdict(float))
        stock_flags = []
        incomplete = set()
        for un, sub in pieces.groupby('unit'):
            u = unit_info[un]
            P = u['persons'] or 0.0
            if u['persons'] is None and u['members']:
                # a unit with no validated count: its Data Zones are incomplete for this year
                incomplete.update(sub['DZ2021_cd'])
            area_by = dict(zip(sub.index, sub.area))
            tot_a = sum(area_by.values())
            w_area = {i: P * a / tot_a for i, a in area_by.items()}
            town_total = sum(p for _, p, _ in fps.get(un, []))
            w_town = None
            if town_total:
                w_town = dasymetric_weights(area_by, {i: fp_area.get(i, 0.0) for i in area_by}, town_total, P)
            w_town = w_town or w_area
            w_stock = None
            if stock is not None:
                s_all = {i: stock.get(i, 0.0) for i in area_by}
                s_in = {i: stock_in.get(i, 0.0) for i in area_by}
                w_stock, mode, ratio, rem, so = stock_unit_weights(area_by, fp_area, s_all, s_in, town_total, P)
                if mode != 'stock':
                    stock_flags.append({'year': year, 'unit': un, 'members': unit_out[[x['unit'] for x in unit_out].index(un)]['members'],
                                        'persons_outside_towns': round(rem), 'qualifying_stock': round(so, 1),
                                        'persons_per_property': round(ratio, 1) if ratio else '', 'used': mode})
            for i in area_by:
                d = sub.at[i, 'DZ2021_cd']
                share = area_by[i] / tot_a
                row = {'year': year, 'unit': un, 'DZ2021_cd': d, 'area_m2': round(area_by[i], 1),
                       'share_of_unit': round(share, 6), 'town_area_m2': round(fp_area.get(i, 0.0), 1),
                       'persons_area': round(w_area[i], 3), 'persons_town': round(w_town[i], 3)}
                weights.append(row)
                for v in ('persons', 'males', 'females', 'catholic'):
                    if u.get(v) is not None and P:
                        dz_tot[d][f'{v}_area'] += u[v] * w_area[i] / P
                        dz_tot[d][f'{v}_town'] += u[v] * w_town[i] / P
                        if w_stock is not None:
                            dz_tot[d][f'{v}_stock'] += u[v] * w_stock[i] / P
                if w_stock is not None:
                    row['persons_stock'] = round(w_stock[i], 3)
            # exactness: every method gives the unit back its own count
            for meth, w in (('area', w_area), ('town', w_town), ('stock', w_stock)):
                if w is None:
                    continue
                diff = sum(w.values()) - P
                checks.append({'year': year, 'check': f'unit_total_{meth}', 'area': un,
                               'status': 'ok' if abs(diff) < 1e-6 * max(1, P) else 'fail', 'diff': round(diff, 9)})
        # outputs
        dzn = dict(zip(dz.DZ2021_cd, dz.DZ2021_nm))
        series = []
        for d in sorted(dzn):
            t = dz_tot.get(d, {})
            r = {'DZ2021_cd': d, 'DZ2021_nm': dzn[d], 'year': year}
            for meth in ('area', 'town'):
                for v in ('persons', 'males', 'females', 'catholic'):
                    r[f'{v}_{meth}'] = round(t.get(f'{v}_{meth}', 0.0), 2)
                p = t.get(f'persons_{meth}', 0.0)
                r[f'catholic_pct_{meth}'] = round(100 * t.get(f'catholic_{meth}', 0.0) / p, 2) if p > 0 else ''
            r['modelled'] = 'yes'
            r['incomplete'] = 'yes' if d in incomplete else ''
            series.append(r)
        cols = ['DZ2021_cd', 'DZ2021_nm', 'year'] + [f'{v}_{m}' for m in ('area', 'town')
                                                     for v in ('persons', 'males', 'females', 'catholic', 'catholic_pct')] + ['modelled', 'incomplete']
        write_csv(os.path.join(out, 'series', f'dz21-census-{year}.csv'), series, cols)
        write_csv(os.path.join(out, 'crosswalk', f'weights-{year}.csv'), weights,
                  ['year', 'unit', 'DZ2021_cd', 'area_m2', 'share_of_unit', 'town_area_m2', 'persons_area', 'persons_town'])
        write_csv(os.path.join(out, 'crosswalk', f'units-{year}.csv'), unit_out, list(unit_out[0].keys()))
        mrows = [{'year': year, 'census_id': c, 'layer_feature': layer.ED_NAME[layer.fid == f].iloc[0], 'how': h}
                 for c, (f, h) in m.items()]
        mrows += [{'year': year, 'census_id': c, 'layer_feature': '', 'how': 'unmatched: pooled'} for c in un_c]
        mrows += [{'year': year, 'census_id': '', 'layer_feature': layer.ED_NAME[layer.fid == f].iloc[0],
                   'how': 'layer feature with no census DED: its area pooled'} for f in un_l]
        write_csv(os.path.join(out, 'crosswalk', f'matches-{year}.csv'), mrows, ['year', 'census_id', 'layer_feature', 'how'])
        tot = sum(u['persons'] or 0 for u in urows)   # validated counts that reached a unit
        got = sum(r['persons_area'] for r in series)
        checks.append({'year': year, 'check': 'ni_total_area', 'area': 'NI', 'status': 'ok' if abs(got - tot) < 1 else 'fail',
                       'diff': round(got - tot, 3)})
        checks += [{'year': year, 'check': 'town_without_footprint', 'area': t, 'status': 'note', 'diff': ''} for t in missing_towns]
        checks += [{'year': year, 'check': 'excluded_unvalidated', 'area': f"{r['county']}|{r['name']}", 'status': 'note',
                    'diff': ''} for r in excluded]
        write_csv(os.path.join(out, 'crosswalk', f'checks-{year}.csv'), checks, ['year', 'check', 'area', 'status', 'diff'])
        if stock is not None:
            priv = os.path.join(out, 'private')
            srows = []
            for d in sorted(dzn):
                t = dz_tot.get(d, {})
                p = t.get('persons_stock', 0.0)
                srows.append({'DZ2021_cd': d, 'year': year, 'persons_stock': round(p, 2),
                              'males_stock': round(t.get('males_stock', 0.0), 2),
                              'females_stock': round(t.get('females_stock', 0.0), 2),
                              'catholic_stock': round(t.get('catholic_stock', 0.0), 2),
                              'catholic_pct_stock': round(100 * t.get('catholic_stock', 0.0) / p, 2) if p > 0 else ''})
            write_csv(os.path.join(priv, f'dz21-census-{year}-stock.csv'), srows, list(srows[0].keys()))
            write_csv(os.path.join(priv, f'weights-{year}-stock.csv'),
                      [{k: r[k] for k in ('year', 'unit', 'DZ2021_cd', 'persons_stock')} for r in weights if 'persons_stock' in r],
                      ['year', 'unit', 'DZ2021_cd', 'persons_stock'])
            write_csv(os.path.join(priv, f'stock-flags-{year}.csv'), stock_flags,
                      ['year', 'unit', 'members', 'persons_outside_towns', 'qualifying_stock', 'persons_per_property', 'used'])
        kinds = defaultdict(int)
        for u in urows:
            kinds[u['kind']] += 1
        print(year, 'census units', len(units), 'excluded', len(excluded), 'matched', len(m), 'unmatched census', len(un_c),
              'unmatched layer', len(un_l), dict(kinds), 'towns with footprint',
              sum(len(v) for v in fps.values()), 'without', len(missing_towns),
              'NI', tot, 'on DZs', round(got), 'unit checks failing', sum(1 for c in checks if c['status'] == 'fail'))


if __name__ == '__main__':
    main()
