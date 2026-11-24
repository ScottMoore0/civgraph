#!/usr/bin/env python3
"""The long-run series and the 'greatest change since 1926' analysis, from the Data Zone files of
hist_census_crosswalk.py and the existing 1971-2021 Data Zone files.

  stable areas   the smallest groups of 2021 Data Zones that each hold whole historic units in
                 every census year 1926-1961 (a Data Zone nests in a unit when >= 95% of its area
                 lies in it); changes are ranked on these and on the 1993 districts, never on
                 single Data Zones, whose 1926-1961 values are modelled
  series         persons per Data Zone 1926, 1937, 1951, 1961 (modelled, town-aware), 1971, 1981
                 (1972 wards, town-aware where hist_census_1971.py has run), 1991 (1984 wards by
                 area), 2001 (output areas), 2011 (small areas), 2021 (census); Catholic share
                 where printed
  checks         the 1961 series against the 1971 one by stable area (discontinuities); ten towns
                 printed in 1926 against what each method puts in the town's footprint; how far
                 the area and town-aware series differ

Writes series/ and analysis/ under --out. Usage: python scripts/ingest/census/hist_census_series.py
"""
import argparse
import csv
import re
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from hist_census_crosswalk import MAIN, OUT, read_csv, write_csv  # noqa: E402
from hist_census_lib import stable_areas  # noqa: E402

DERIVED = MAIN / 'data' / 'census' / 'derived'
HIST = ['1926', '1937', '1951', '1961']
LATER = ('1971', '1981', '1991', '2001', '2011', '2021')


def f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def dz_1991():
    """1991 persons per Data Zone: each 1984 ward's 1991 count (ward1984-census-1991.csv) spread
    by area, as the 1972 wards' counts are. Wards are keyed by their 1993 district (the district
    holding the ward's representative point) and name; the few spelt differently in the two
    files are paired within their district (hist_census_1991_2011.units_1991)."""
    import geopandas as gpd
    from hist_census_crosswalk import load_layer
    from hist_census_1991_2011 import units_1991
    wards, notes = units_1991()
    wards['wid'] = range(len(wards))
    dz = load_layer('census-areas/DZ2021.fgb')[['DZ2021_cd', 'geometry']]
    pc = gpd.overlay(wards[['wid', 'persons', 'geometry']], dz, how='intersection', keep_geom_type=True)
    pc['a'] = pc.geometry.area
    tot = pc.groupby('wid').a.transform('sum')
    pc['p'] = pc['persons'] * pc['a'] / tot
    out = pc.groupby('DZ2021_cd').p.sum().to_dict()
    print('1991: wards', len(wards), notes, 'persons on Data Zones', round(sum(out.values())))
    return out


def dz_2011():
    """2011 persons per Data Zone from the small areas (census-2011-sa.csv) by
    sa2011_to_dz2021_weights.csv, each small area's weights scaled to add to 1 (a few lose a
    sliver offshore), so every small area is placed whole."""
    pop = {r['SA2011']: f(r['AllUsualResidents']) or 0.0 for r in read_csv(DERIVED / 'census-2011-sa.csv')}
    w = defaultdict(dict)
    for r in read_csv(DERIVED / 'sa2011_to_dz2021_weights.csv'):
        w[r['SA2011']][r['DZ2021_cd']] = w[r['SA2011']].get(r['DZ2021_cd'], 0.0) + float(r['weight'])
    out = defaultdict(float)
    for sa, by in w.items():
        t = sum(by.values())
        for d, v in by.items():
            out[d] += pop.get(sa, 0.0) * v / t if t else 0.0
    return dict(out)


def merge_to_fit(sa, out, tol):
    """Grow the stable areas until each holds its 1926 units to within tol: a group receives,
    from the units it shares with its neighbours, about what it gives them. The worst-fitting
    group is merged with the neighbour it exchanges most population with, until every group's
    modelled 1926 population is within tol of the total of the units whose largest part it
    holds."""
    from hist_census_lib import UnionFind
    w = read_csv(os.path.join(out, 'crosswalk', 'weights-1926.csv'))
    uf = UnionFind()
    for g in set(sa.values()):
        uf.find(g)
    while True:
        acc = defaultdict(lambda: defaultdict(float))
        for r in w:
            acc[r['unit']][uf.find(sa.get(r['DZ2021_cd']))] += float(r['persons_town'])
        got, assigned, exch = defaultdict(float), defaultdict(float), defaultdict(float)
        for un, by_g in acc.items():
            g0 = max(by_g, key=by_g.get)
            tot = sum(by_g.values())
            assigned[g0] += tot
            for g, v in by_g.items():
                got[g] += v
                if g != g0 and v > 0:
                    exch[(g0, g)] += v
                    exch[(g, g0)] += v
        worst, wv = None, tol
        for g in got:
            a = assigned.get(g, 0.0)
            m = abs(got[g] - a) / a if a else (1.0 if got[g] > 0 else 0.0)
            if m > wv:
                worst, wv = g, m
        if worst is None:
            break
        nb = [(v, g2) for (g1, g2), v in exch.items() if g1 == worst]
        if not nb:
            break
        uf.union(worst, max(nb)[1])
    return {k: uf.find(g) for k, g in sa.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--nest', type=float, default=0.0,
                    help='a Data Zone joins the unit holding most of its area (0), or every unit holding '
                         'more than 1 - nest of it when none holds nest (strict nesting, e.g. 0.95)')
    ap.add_argument('--tolerance', type=float, default=0.05, help='largest misfit of a stable area (1926)')
    ap.add_argument('--stable-years', default='1926,1937',
                    help='years whose units the stable areas must hold whole (1951 is incomplete)')
    args = ap.parse_args()
    out = args.out
    years = [y for y in HIST if os.path.exists(os.path.join(out, 'series', f'dz21-census-{y}.csv'))]
    dz = {}
    for y in years:
        for r in read_csv(os.path.join(out, 'series', f'dz21-census-{y}.csv')):
            d = dz.setdefault(r['DZ2021_cd'], {'name': r['DZ2021_nm']})
            for m in ('area', 'town'):
                d[f'p{y}_{m}'] = f(r[f'persons_{m}']) if r.get('incomplete') != 'yes' else None
                d[f'c{y}_{m}'] = f(r[f'catholic_{m}']) if r.get('incomplete') != 'yes' else None
    w72 = defaultdict(lambda: [0.0, 0.0])
    for r in read_csv(DERIVED / 'ward1972_to_dz2021_weights.csv'):
        w72[r['DZ2021_cd']][0] += f(r['pop_1971_apportioned']) or 0
        w72[r['DZ2021_cd']][1] += f(r['pop_1981_apportioned']) or 0
    p01 = {r['DZ2021_cd']: f(r['total_pop']) for r in read_csv(DERIVED / 'dz21-census-2001.csv')}
    p21 = {r['GeographyCode']: f(r['AllUsualResidents']) for r in read_csv(DERIVED / 'ms-a01-dz.csv')}
    c21 = {r['DZ21']: f(r['catholic_bg_pct']) for r in read_csv(DERIVED / 'dz21-community-2021.csv')}
    lgd = {r['DZ2021_cd']: r['lgd1993'] for r in read_csv(DERIVED / 'dz2021_to_lgd1993.csv')}
    town = {}
    for y in ('1971', '1981'):
        pth = os.path.join(out, 'series', f'dz21-census-{y}-town.csv')
        if os.path.exists(pth):
            # the town-aware series (hist_census_1971.py): like with like against 1926-1961
            town[y] = {r['DZ2021_cd']: f(r[f'persons_{y}_town']) for r in read_csv(pth)}
    p91, p11 = dz_1991(), dz_2011()
    for k, d in dz.items():
        d['p1971'], d['p1981'] = w72[k]
        d['p1971_area'], d['p1981_area'] = d['p1971'], d['p1981']
        for y, t in town.items():
            d[f'p{y}'] = t.get(k, 0.0)
        d['p1991'], d['p2011'] = p91.get(k, 0.0), p11.get(k, 0.0)
        d['p2001'], d['p2021'], d['cbg2021'] = p01.get(k), p21.get(k), c21.get(k)
        d['lgd1993'] = lgd.get(k, '')

    # stable areas from each year's unit shares of every Data Zone's area
    dz_units = {}
    unit_names = {}
    empty = set()
    for y in years:
        for r in read_csv(os.path.join(out, 'crosswalk', f'units-{y}.csv')):
            if not r['persons']:
                empty.add((y, r['unit']))
    for y in [y for y in years if y in args.stable_years.split(',')]:
        shares = defaultdict(dict)
        for r in read_csv(os.path.join(out, 'crosswalk', f'weights-{y}.csv')):
            if (y, r['unit']) in empty:
                continue   # land with no validated count (a hole, a failed unit): no constraint
            shares[r['DZ2021_cd']][r['unit']] = shares[r['DZ2021_cd']].get(r['unit'], 0) + float(r['area_m2'])
        for k, s in shares.items():
            t = sum(s.values())
            shares[k] = {u: a / t for u, a in s.items()}
        dz_units[y] = dict(shares)
        for r in read_csv(os.path.join(out, 'crosswalk', f'units-{y}.csv')):
            unit_names[(y, r['unit'])] = (r['members'] or r['layer_name'], f(r['persons']) or 0)
    sa = stable_areas(dz_units, args.nest)
    sa = merge_to_fit(sa, out, args.tolerance)
    groups = defaultdict(list)
    for k, g in sa.items():
        groups[g].append(k)
    # a readable name: the 1926 units (DEDs, wards) whose land makes up the group, largest first
    gname = {}
    for g, ks in groups.items():
        us = defaultdict(float)
        for k in ks:
            for u, s in dz_units.get('1926', {}).get(k, {}).items():
                us[u] += s
        top = sorted(us, key=lambda u: -unit_names.get(('1926', u), ('', 0))[1])
        nm = [unit_names.get(('1926', u), (u, 0))[0].title() for u in top[:3]]
        gname[g] = ' / '.join(nm) + (' and others' if len(top) > 3 else '')
    # how well each group holds its historic units: the units whose largest part lies in the
    # group, against what the group's Data Zones received from all units (1926, town-aware)
    fit = {}
    if '1926' in years:
        unit_group = {}
        acc = defaultdict(lambda: defaultdict(float))
        for r in read_csv(os.path.join(out, 'crosswalk', 'weights-1926.csv')):
            acc[r['unit']][sa.get(r['DZ2021_cd'])] += float(r['persons_town'])
        assigned = defaultdict(float)
        for un, by_g in acc.items():
            g = max(by_g, key=by_g.get)
            assigned[g] += sum(by_g.values())
        for g, ks in groups.items():
            got = sum(dz[k].get('p1926_town') or 0 for k in ks if k in dz)
            fit[g] = round(got / assigned[g], 3) if assigned.get(g) else ''
    rows_sa = []
    for g, ks in sorted(groups.items()):
        r = {'stable_area': g, 'name': gname[g], 'n_dz': len(ks), 'lgd1993': ';'.join(sorted({dz[k]['lgd1993'] for k in ks if k in dz})),
             'fit_1926': fit.get(g, '')}
        for y in years:
            gone = any(dz[k].get(f'p{y}_town') is None for k in ks if k in dz)   # incomplete that year
            for m in ('area', 'town'):
                r[f'persons_{y}_{m}'] = '' if gone else round(sum(dz[k].get(f'p{y}_{m}') or 0 for k in ks if k in dz))
            cat = sum(dz[k].get(f'c{y}_town') or 0 for k in ks if k in dz)
            r[f'catholic_pct_{y}'] = round(100 * cat / r[f'persons_{y}_town'], 1) if r[f'persons_{y}_town'] else ''
        for y in LATER:
            r[f'persons_{y}'] = round(sum(dz[k].get(f'p{y}') or 0 for k in ks if k in dz))
        cb = [(dz[k]['cbg2021'], dz[k]['p2021']) for k in ks if k in dz and dz[k]['cbg2021'] is not None and dz[k]['p2021']]
        r['catholic_bg_pct_2021'] = round(sum(a * b for a, b in cb) / sum(b for _, b in cb), 1) if cb else ''
        rows_sa.append(r)
    for r in rows_sa:
        p0, p1 = r.get('persons_1926_town'), r['persons_2021']
        r['change_1926_2021'] = p1 - p0 if p0 is not None else ''
        r['change_pct_1926_2021'] = round(100 * (p1 - p0) / p0, 1) if p0 else ''
        if r.get('catholic_pct_1926') != '' and r['catholic_bg_pct_2021'] != '':
            r['catholic_shift_pts'] = round(r['catholic_bg_pct_2021'] - r['catholic_pct_1926'], 1)
        if r.get('persons_1961_town') and r['persons_1971']:
            r['change_pct_1961_1971'] = round(100 * (r['persons_1971'] - r['persons_1961_town']) / r['persons_1961_town'], 1)
    cols = list(rows_sa[0].keys())
    for c in ('change_1926_2021', 'change_pct_1926_2021', 'catholic_shift_pts', 'change_pct_1961_1971'):
        if c not in cols:
            cols.append(c)
    os.makedirs(os.path.join(out, 'analysis'), exist_ok=True)
    write_csv(os.path.join(out, 'analysis', 'stable-areas-series.csv'), rows_sa, cols)
    write_csv(os.path.join(out, 'analysis', 'stable-areas-dz.csv'),
              [{'DZ2021_cd': k, 'DZ2021_nm': dz.get(k, {}).get('name', ''), 'stable_area': g, 'stable_area_name': gname[g]}
               for k, g in sorted(sa.items())], ['DZ2021_cd', 'DZ2021_nm', 'stable_area', 'stable_area_name'])
    # 1993 districts
    lg = defaultdict(lambda: defaultdict(float))
    for k, d in dz.items():
        L = lg[d['lgd1993']]
        for y in years:
            L[f'persons_{y}'] += d.get(f'p{y}_town') or 0
            L[f'catholic_{y}'] += d.get(f'c{y}_town') or 0
        for y in LATER:
            L[f'persons_{y}'] += d.get(f'p{y}') or 0
        if d['cbg2021'] is not None and d['p2021']:
            L['cbg_w'] += d['cbg2021'] * d['p2021']
            L['cbg_p'] += d['p2021']
    rows_l = []
    for name, L in sorted(lg.items()):
        r = {'lgd1993': name}
        for y in years + list(LATER):
            r[f'persons_{y}'] = round(L[f'persons_{y}'])
        for y in years:
            r[f'catholic_pct_{y}'] = round(100 * L[f'catholic_{y}'] / L[f'persons_{y}'], 1) if L[f'persons_{y}'] else ''
        r['catholic_bg_pct_2021'] = round(L['cbg_w'] / L['cbg_p'], 1) if L['cbg_p'] else ''
        r['change_1926_2021'] = r['persons_2021'] - r['persons_1926']
        r['change_pct_1926_2021'] = round(100 * r['change_1926_2021'] / r['persons_1926'], 1) if r['persons_1926'] else ''
        r['catholic_shift_pts'] = round(r['catholic_bg_pct_2021'] - r['catholic_pct_1926'], 1) \
            if r['catholic_bg_pct_2021'] != '' and r['catholic_pct_1926'] != '' else ''
        rows_l.append(r)
    write_csv(os.path.join(out, 'analysis', 'lgd1993-series.csv'), rows_l, list(rows_l[0].keys()))
    # long-run Data Zone series (modelled before 1971)
    rows_dz = []
    for k, d in sorted(dz.items()):
        r = {'DZ2021_cd': k, 'DZ2021_nm': d['name'], 'lgd1993': d['lgd1993'], 'stable_area': sa.get(k, '')}
        for y in years:
            r[f'persons_{y}'] = round(d.get(f'p{y}_town') or 0, 1)
        for y in LATER:
            r[f'persons_{y}'] = round(d.get(f'p{y}') or 0, 1)
        for y in years:
            p = d.get(f'p{y}_town')
            r[f'catholic_pct_{y}'] = round(100 * d[f'c{y}_town'] / p, 1) if p and d.get(f'c{y}_town') is not None else ''
        r['catholic_bg_pct_2021'] = d['cbg2021'] if d['cbg2021'] is not None else ''
        r['modelled_before_1971'] = 'yes'
        rows_dz.append(r)
    write_csv(os.path.join(out, 'series', 'dz21-population-1926-2021.csv'), rows_dz, list(rows_dz[0].keys()))
    # how much the two methods differ
    diffs = []
    for y in years:
        tot = sum(d.get(f'p{y}_area') or 0 for d in dz.values())
        moved = 0.5 * sum(abs((d.get(f'p{y}_area') or 0) - (d.get(f'p{y}_town') or 0)) for d in dz.values())
        sa_moved = 0.5 * sum(abs(r[f'persons_{y}_area'] - r[f'persons_{y}_town']) for r in rows_sa if r[f'persons_{y}_area'] != '')
        diffs.append({'year': y, 'persons': round(tot), 'placed_differently_dz': round(moved),
                      'placed_differently_dz_pct': round(100 * moved / tot, 2) if tot else '',
                      'placed_differently_stable_areas': round(sa_moved),
                      'placed_differently_stable_areas_pct': round(100 * sa_moved / tot, 2) if tot else ''})
    write_csv(os.path.join(out, 'analysis', 'method-difference.csv'), diffs, list(diffs[0].keys()))
    # spot check, 1926: what each method puts inside the footprints of the printed towns of a DED
    if '1926' in years:
        units26 = {r['unit']: r for r in read_csv(os.path.join(out, 'crosswalk', 'units-1926.csv'))}
        acc = defaultdict(lambda: [0.0, 0.0, 0.0, 0.0])
        for r in read_csv(os.path.join(out, 'crosswalk', 'weights-1926.csv')):
            a = acc[r['unit']]
            a[0] += float(r['area_m2'])
            a[1] += float(r['town_area_m2'])
            a[2] += float(r['persons_area']) * (float(r['town_area_m2']) / float(r['area_m2']) if float(r['area_m2']) else 0)
            a[3] += float(r['persons_town']) * (float(r['town_area_m2']) / float(r['area_m2']) if float(r['area_m2']) else 0)
        towns26 = defaultdict(list)
        for r in read_csv(os.path.join(out, 'areas', 'areas-1926.csv')):
            if r['area_type'] in ('town', 'town_part') and r['persons']:
                towns26[(r['county'], r['district'], r['ref'])].append((r['name'], float(r['persons'])))
        spot = []
        for un, a in acc.items():
            if a[1] <= 0 or un not in units26:
                continue
            u = units26[un]
            c, dname, ref, _ = (un.split('|') + ['', '', '', ''])[:4]
            tl = towns26.get((c, dname, ref), [])
            if len(tl) != 1:
                continue
            spot.append({'ded': u['members'], 'town': tl[0][0], 'town_printed_1926': round(tl[0][1]),
                         'ded_persons_1926': u['persons'], 'footprint_share_of_ded_area_pct': round(100 * a[1] / a[0], 1),
                         'area_method_in_footprint': round(a[2]), 'town_method_in_footprint': round(a[3])})
        spot.sort(key=lambda r: -r['town_printed_1926'])
        if spot:
            write_csv(os.path.join(out, 'analysis', 'town-spot-check-1926.csv'), spot[:10], list(spot[0].keys()))
    # the old districts (counties, county boroughs, urban and rural districts and their wards)
    # 1926-1966 as printed: the religion tables' validated totals, and 1966's district table (no
    # religion question in 1966). A district keeps its name across years; boundary changes between
    # censuses are in each report's notes.
    from hist_census_crosswalk import dkey
    dserie = {}
    for y in years:
        pth = os.path.join(out, 'areas', f'religion-{y}.csv')
        if not os.path.exists(pth):
            continue
        for r in read_csv(pth):
            if r['status'] != 'ok' or not r['persons'] or r['area_type'] == 'county_total':
                continue
            nm = r['name'] if r['area_type'] != 'ward' else f"{r['county']}: {r['name']}"
            e = dserie.setdefault((r['county'], dkey(nm)), {'county': r['county'], 'name': nm, 'type': r['area_type']})
            e[f'persons_{y}'] = int(float(r['persons']))
            e[f'catholic_pct_{y}'] = round(100 * float(r['catholic']) / float(r['persons']), 1)
    p66 = os.path.join(out, 'areas', 'districts-1966.csv')
    if os.path.exists(p66):
        ren = {'South Down Rural District': 'Kilkeel Rural District', 'Lisburn Municipal Borough': 'Lisburn Urban District'}
        for r in read_csv(p66):
            if r['area_type'] in ('county_total',) or not r['persons']:
                continue
            nm = ren.get(r['name'], r['name'])
            if r['area_type'] == 'ward':
                nm = f"{r['county']}: {re.sub(r'\s+Ward$', '', r['name'])}"
            key = next((k for k in dserie if k[1] == dkey(nm) and (k[0] == r['county'] or r['area_type'] in ('county_borough', 'ward'))), None)
            e = dserie.setdefault(key or (r['county'], dkey(nm)), {'county': r['county'], 'name': nm, 'type': r['area_type']})
            e['persons_1966'] = int(float(r['persons']))
            if nm != r['name']:
                e['note'] = f"1966 name: {r['name']}"
    if dserie:
        cols = ['county', 'name', 'type'] + [c for y in years + ['1966'] for c in (f'persons_{y}', f'catholic_pct_{y}') if not (y == '1966' and c.startswith('catholic'))] + ['note']
        write_csv(os.path.join(out, 'analysis', 'districts-1926-1966.csv'), sorted(dserie.values(), key=lambda e: (e['county'], e['name'])), cols)
    # the 1961-1971 comparison again on areas that also hold the 1972 wards whole: if the jumps
    # shrink there, they came from where the two crosswalks put people inside such areas
    sh72 = defaultdict(dict)
    for r in read_csv(DERIVED / 'ward1972_to_dz2021_weights.csv'):
        sh72[r['DZ2021_cd']][r['W72_ID']] = sh72[r['DZ2021_cd']].get(r['W72_ID'], 0) + (f(r['share_of_dz']) or 0)
    du2 = dict(dz_units)
    du2['1971'] = dict(sh72)
    sa2 = merge_to_fit(stable_areas(du2, args.nest), out, args.tolerance)
    g2 = defaultdict(list)
    for k, g in sa2.items():
        g2[g].append(k)
    disc = []
    for g, ks in sorted(g2.items()):
        p61 = sum(dz[k].get('p1961_town') or 0 for k in ks if k in dz)
        p61a = sum(dz[k].get('p1961_area') or 0 for k in ks if k in dz)
        p71 = sum(dz[k].get('p1971') or 0 for k in ks if k in dz)
        p51 = sum(dz[k].get('p1951_town') or 0 for k in ks if k in dz)
        disc.append({'area': g, 'name': gname.get(sa.get(g), ''), 'n_dz': len(ks),
                     'lgd1993': ';'.join(sorted({dz[k]['lgd1993'] for k in ks if k in dz})),
                     'persons_1951': round(p51), 'persons_1961': round(p61), 'persons_1961_area': round(p61a),
                     'persons_1971': round(p71),
                     'change_pct_1951_1961': round(100 * (p61 - p51) / p51, 1) if p51 else '',
                     'change_pct_1961_1971': round(100 * (p71 - p61) / p61, 1) if p61 else ''})
    if disc:
        write_csv(os.path.join(out, 'analysis', 'discontinuity-1961-1971.csv'), disc, list(disc[0].keys()))
        # which Data Zones make up each of these areas (hist_census_stock_series.py redoes the
        # comparison on the housing-weighted series)
        write_csv(os.path.join(out, 'analysis', 'combined-areas-1961-1971-dz.csv'),
                  [{'DZ2021_cd': k, 'area': g} for k, g in sorted(sa2.items())], ['DZ2021_cd', 'area'])
        import statistics
        v = [abs(r['change_pct_1961_1971']) for r in disc if r['change_pct_1961_1971'] != '']
        print('areas holding 1926-61 units and 1972 wards:', len(disc), 'median |1961-71| %', round(statistics.median(v), 1),
              'over 25%', sum(1 for x in v if x > 25), 'over 40%', sum(1 for x in v if x > 40))
    print('stable areas', len(groups), 'of', len(sa), 'Data Zones;', 'districts', len(rows_l))
    for d in diffs:
        print(d)


if __name__ == '__main__':
    main()
