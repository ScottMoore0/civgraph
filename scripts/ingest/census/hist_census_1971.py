#!/usr/bin/env python3
"""The 1971 and 1981 censuses on 2021 Data Zones, made as the 1926-1961 ones are (hist_census_
crosswalk.py), so that the series runs like with like from 1926 to 1981.

Units are the 1972 wards (the wards of the 1973 districts), each with its printed 1971 and 1981
persons, males and females (data/census/derived/ward1972-pop-1981.csv). Every ward keeps its own
counts exactly under every method; only where inside the ward its people go differs.

  area   by the area of the ward in each Data Zone.
  town   towns first: the printed population of each town without a legal boundary goes into the
         town's 2015 settlement footprint, the rest of the ward by area. 1971: the town rows of the
         county reports' Table 4 (<out>/areas/towns-1971.csv; whole towns, printed or rebuilt from
         their printed parts). 1981: the Summary Report's Table 4A (<out>/areas/towns-1981.csv,
         hist_census_1981_towns.py), towns of 1,000 or more defined by grid squares, less those
         that had a legal boundary in 1971 (boroughs and urban districts), so that both years
         treat the same kind of town. A town over several wards is shared among the wards of its
         own district by the footprint's area in each.
  stock  (only with --stock EXTRACT, PRIVATE) as 'town', but by surviving domestic properties of
         the right era (hist_census_lib.era_weight; census day 25 Apr 1971 and 5 Apr 1981): a
         town is shared among its wards, and placed inside its footprint, by the qualifying stock
         there; the rest of each ward goes outside the footprints by stock, with the survivor-bias
         guard (more than 20 persons per qualifying property: area; 12-20: half and half).

Writes series/dz21-census-<year>-town.csv, crosswalk/weights-<year>-town.csv and crosswalk/
checks-<year>-town.csv under --out; with --stock, private/dz21-census-<year>-stock.csv,
private/weights-<year>-stock.csv and private/stock-flags-<year>.csv only (aggregates per ward and
Data Zone; nothing per property).
Usage: python scripts/ingest/census/hist_census_1971.py [--years 1971,1981] [--out DIR] [--stock EXTRACT]
"""
import argparse
import os
import re
import sys
import warnings
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from hist_census_crosswalk import (CRS, MAIN, MAPS, OUT, load_layer, read_csv, read_domestic,  # noqa: E402
                                   stock_points, write_csv)
from hist_census_lib import (dasymetric_weights, match_settlement, norm_key, settlement_index,  # noqa: E402
                             share_town, stock_unit_weights)

warnings.filterwarnings('ignore')
LEGAL = re.compile(r'\s+(Urban District|Municipal Borough|County Borough)$')


def wards_1972():
    """The 1972 wards keyed W72_ID ('<district-slug>--<ward-slug>'), as build_ward1972_pop_layer.py
    keys them."""
    import geopandas as gpd
    import build_ward1972_pop_layer as w72
    # the .fgb files are gitignored: read the main checkout's
    w72.WARD_FULL = '/vsigzip/' + str(MAPS / 'local-government' / 'Wards_1972.fgb.gz')
    w72.LGD_FULL = '/vsigzip/' + str(MAPS / 'local-government' / 'LGD_1972.fgb.gz')
    w = gpd.read_file('/vsigzip/' + str(MAPS / 'local-government' / 'Wards_1972.fgb.gz')).to_crs(CRS)
    j = w72.districts_of_wards()
    key = {r.Area_SqKM: f'{w72.slug(r.DIST)}--{w72.slug(r.NAME)}' for r in j.itertuples()}
    w['W72_ID'] = w['Area_SqKM'].map(key)
    w['geometry'] = w.geometry.buffer(0)
    return w[['W72_ID', 'geometry']]


def load_towns(out, year):
    """([{name, persons, district slug or '', county}], [names left out, why])."""
    from build_ward1972_pop_layer import slug
    rows71 = read_csv(os.path.join(out, 'areas', 'towns-1971.csv'))
    if year == '1971':
        towns = [{'name': t['name'], 'persons': float(t['persons']), 'county': t['county'],
                  'district': t['W72_ID'].split('--')[0] if t['W72_ID'] else ''}
                 for t in rows71
                 if t['persons'] and (t['status'] == 'town_ok' or t['status'].startswith('town_whole'))]
        return towns, []
    legal = {norm_key(LEGAL.sub('', t['name'])) for t in rows71 if t['status'] == 'urban_area'}
    towns, left = [], []
    for t in read_csv(os.path.join(out, 'areas', f'towns-{year}.csv')):
        if t['status'] != 'ok':
            left.append((t['name'], 'row fails its check'))
        elif norm_key(t['name']) in legal:
            left.append((t['name'], 'a borough or urban district in 1971'))
        else:
            towns.append({'name': t['name'], 'persons': float(t['persons']), 'county': '', 'district': slug(t['district'])})
    return towns, left


def main():
    import geopandas as gpd
    from shapely.ops import unary_union
    ap = argparse.ArgumentParser()
    ap.add_argument('--years', default='1971,1981')
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--stock', metavar='EXTRACT', help='also the private valuation-stock series, from this extract (read in place)')
    args = ap.parse_args()
    out = args.out
    pop = {}
    for r in read_csv(MAIN / 'data' / 'census' / 'derived' / 'ward1972-pop-1981.csv'):
        pop[r['W72_ID']] = {y: {v: float(r[f'pop_{y}_{v}']) for v in ('persons', 'males', 'females')} for y in ('1971', '1981')}
    wards = wards_1972()
    wards = wards[wards.W72_ID.isin(pop)]
    wgeom = dict(zip(wards.W72_ID, wards.geometry))
    dz = load_layer('census-areas/DZ2021.fgb')[['DZ2021_cd', 'DZ2021_nm', 'geometry']]
    names = dict(zip(dz.DZ2021_cd, dz.DZ2021_nm))
    pieces = gpd.overlay(wards, dz, how='intersection', keep_geom_type=True)
    pieces['area'] = pieces.geometry.area
    pieces = pieces[pieces.area > 1].reset_index(drop=True)
    settle = load_layer('physical/Settlements_2015.fgb')[['Name', 'geometry']]
    sgeom = defaultdict(list)
    for n, g in zip(settle.Name, settle.geometry):
        sgeom[n].append(g)
    sidx = settlement_index(list(sgeom))
    dom = read_domestic(args.stock) if args.stock else None
    for year in args.years.split(','):
        towns, left = load_towns(out, year)
        # each town's footprint in each ward of its district: [(town index, ward, geometry)]
        tw, missing = [], []
        for ti, t in enumerate(towns):
            sn = match_settlement(sidx, t['name'], t['district'], t['county'])
            if not sn:
                missing.append(t['name'])
                continue
            fp = unary_union([g for n in sn for g in sgeom[n]])
            got = [(ti, wid, wg.intersection(fp)) for wid, wg in wgeom.items()
                   if (not t['district'] or wid.startswith(t['district'] + '--')) and wg.intersects(fp)]
            got = [x for x in got if x[2].area > 1000]
            if not got:
                missing.append(t['name'])
            tw += got
        # town-aware: shared among the wards by footprint area
        fp_town = defaultdict(list)
        by_town = defaultdict(list)
        for ti, wid, g in tw:
            by_town[ti].append((wid, g))
        for ti, lst in by_town.items():
            for wid, p in share_town(towns[ti]['persons'], {}, {wid: g.area for wid, g in lst}).items():
                fp_town[wid].append((p, next(g for w, g in lst if w == wid)))
        # stock: shared by the qualifying stock inside the footprint, and inside each ward
        fp_stock, s_piece, s_piece_in = None, {}, {}
        if dom is not None:
            pts = stock_points(dom, year)
            tg = gpd.GeoDataFrame([{'k': k, 'geometry': g} for k, (_, _, g) in enumerate(tw)], crs=CRS) if tw else None
            st = gpd.sjoin(pts, tg, predicate='within', how='inner').groupby('k').w.sum().to_dict() if tw else {}
            fp_stock = defaultdict(list)
            for ti in by_town:
                ks = [k for k, x in enumerate(tw) if x[0] == ti]
                sh = share_town(towns[ti]['persons'], {tw[k][1]: st.get(k, 0.0) for k in ks}, {tw[k][1]: tw[k][2].area for k in ks})
                for k in ks:
                    if sh.get(tw[k][1]):
                        fp_stock[tw[k][1]].append((sh[tw[k][1]], tw[k][2]))
            j = gpd.sjoin(pts, pieces[['geometry']], predicate='within', how='inner')
            s_piece = j.groupby('index_right').w.sum().to_dict()
            fpw = [{'W72_ID': wid, 'geometry': unary_union([g for _, g in lst])} for wid, lst in fp_stock.items()]
            if fpw:
                inside = set(gpd.sjoin(pts, gpd.GeoDataFrame(fpw, crs=CRS), predicate='within', how='inner').index)
                s_piece_in = j[j.index.isin(inside)].groupby('index_right').w.sum().to_dict()
            del pts, j
        weights, wstock, flags, checks = [], [], [], []
        dz_tot = defaultdict(lambda: defaultdict(float))
        exact = {'area': True, 'town': True, 'stock': True}
        for wid, sub in pieces.groupby('W72_ID'):
            c = pop[wid][year]
            P = c['persons']
            area_by = dict(zip(sub.index, sub.area))
            tot = sum(area_by.values())
            w_area = {i: P * a / tot for i, a in area_by.items()}

            def fp_areas(lst):
                fp = unary_union([g for _, g in lst])
                return {i: g.intersection(fp).area for i, g in zip(sub.index, sub.geometry)}
            lst = fp_town.get(wid, [])
            w_town = dasymetric_weights(area_by, fp_areas(lst), min(sum(p for p, _ in lst), P), P) if lst else None
            w_town = w_town or w_area
            w_stock = None
            if dom is not None:
                lst = fp_stock.get(wid, [])
                fpa = fp_areas(lst) if lst else {}
                tt = sum(p for p, _ in lst)
                w_stock, mode, ratio, rem, so = stock_unit_weights(
                    area_by, fpa, {i: s_piece.get(i, 0.0) for i in area_by}, {i: s_piece_in.get(i, 0.0) for i in area_by}, tt, P)
                if mode != 'stock':
                    flags.append({'year': year, 'unit': wid, 'members': wid, 'persons_outside_towns': round(rem),
                                  'qualifying_stock': round(so, 1), 'persons_per_property': round(ratio, 1) if ratio else '',
                                  'used': mode})
            for meth, w in (('area', w_area), ('town', w_town), ('stock', w_stock)):
                if w is not None and abs(sum(w.values()) - P) > 1e-6 * max(P, 1):
                    exact[meth] = False
                    checks.append({'year': year, 'check': f'unit_total_{meth}', 'area': wid, 'status': 'fail',
                                   'diff': round(sum(w.values()) - P, 6)})
            for i in area_by:
                d = sub.at[i, 'DZ2021_cd']
                for meth, w in (('area', w_area), ('town', w_town), ('stock', w_stock)):
                    if w is None:
                        continue
                    for v in ('persons', 'males', 'females'):
                        dz_tot[d][f'{v}_{meth}'] += c[v] * w[i] / P if P else 0.0
                weights.append({'W72_ID': wid, 'DZ2021_cd': d, 'area_m2': round(area_by[i], 1),
                                'persons_area': round(w_area[i], 3), 'persons_town': round(w_town[i], 3)})
                if w_stock is not None:
                    wstock.append({'year': year, 'unit': wid, 'DZ2021_cd': d, 'persons_stock': round(w_stock[i], 3)})
        y = year
        rows = [{'DZ2021_cd': d, 'DZ2021_nm': names[d], f'persons_{y}_area': round(t['persons_area'], 2),
                 f'persons_{y}_town': round(t['persons_town'], 2), f'males_{y}_town': round(t['males_town'], 2),
                 f'females_{y}_town': round(t['females_town'], 2)} for d, t in sorted(dz_tot.items())]
        write_csv(os.path.join(out, 'series', f'dz21-census-{y}-town.csv'), rows, list(rows[0].keys()))
        write_csv(os.path.join(out, 'crosswalk', f'weights-{y}-town.csv'), weights, list(weights[0].keys()))
        checks += [{'year': y, 'check': 'town_without_footprint', 'area': n, 'status': 'note', 'diff': ''} for n in missing]
        checks += [{'year': y, 'check': 'town_left_out', 'area': f'{n}: {why}', 'status': 'note', 'diff': ''} for n, why in left]
        write_csv(os.path.join(out, 'crosswalk', f'checks-{y}-town.csv'), checks, ['year', 'check', 'area', 'status', 'diff'])
        moved = 0.5 * sum(abs(t['persons_area'] - t['persons_town']) for t in dz_tot.values())
        print(y, 'wards', len(set(pieces.W72_ID)), 'of', len(pop), 'towns', len(towns), 'placed', len(by_town),
              'without footprint', len(missing), 'left out', len(left),
              'persons', round(sum(t['persons_town'] for t in dz_tot.values())), 'of', round(sum(p[y]['persons'] for p in pop.values())),
              'unit totals exact', exact if dom is not None else {k: exact[k] for k in ('area', 'town')},
              'moved by town-awareness', round(moved))
        if dom is not None:
            priv = os.path.join(out, 'private')
            srows = [{'DZ2021_cd': d, 'year': y, 'persons_stock': round(t['persons_stock'], 2),
                      'males_stock': round(t['males_stock'], 2), 'females_stock': round(t['females_stock'], 2),
                      'catholic_stock': '', 'catholic_pct_stock': ''} for d, t in sorted(dz_tot.items())]
            write_csv(os.path.join(priv, f'dz21-census-{y}-stock.csv'), srows, list(srows[0].keys()))
            write_csv(os.path.join(priv, f'weights-{y}-stock.csv'), wstock, ['year', 'unit', 'DZ2021_cd', 'persons_stock'])
            write_csv(os.path.join(priv, f'stock-flags-{y}.csv'), flags,
                      ['year', 'unit', 'members', 'persons_outside_towns', 'qualifying_stock', 'persons_per_property', 'used'])
            moved_s = 0.5 * sum(abs(t['persons_town'] - t['persons_stock']) for t in dz_tot.values())
            print(y, 'stock: wards flagged', len(flags), {m: sum(1 for f in flags if f['used'] == m) for m in {f['used'] for f in flags}},
                  'moved against town-aware', round(moved_s))


if __name__ == '__main__':
    main()
