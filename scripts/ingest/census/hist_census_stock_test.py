#!/usr/bin/env python3
"""Test the weighting methods where the answer is known: add small units up to a larger unit,
spread the larger unit's total back over its small units, and compare with the true figures.

  1991  the 1991 population of the 566 wards of 1984, added to their 26 districts:
        area         by ward area
        stock        by the count of domestic properties on the valuation list built before 1991
                     (era bands Pre 1919, Inter-War, 1946-1965, 1966-1990; apartments carry no band)
        town         town-aware: the population of each 2015 settlement footprint (the true 1991
                     population of the wards whose centre lies inside it, standing in for a census's
                     printed town figure) goes to the footprint, the rest by area
        town+stock   as town, but inside and outside the footprints by the stock count
  2001  the 5,022 output areas added to their 582 wards of 1992 (the first six characters of the
        output-area code); 2011 the 4,537 small areas added to their 890 super output areas:
        area         by area
        stock        by era-weighted stock on census day (hist_census_lib.stock_weight), with the
                     survivor-bias guard, as hist_census_1991_2011.py places them
        stock+apts   the same, counting domestic properties with no era band (apartments) as 1

The valuation extract is read in place and only per-unit counts are kept in memory; the results
(error statistics) are written to <out>/private/ only: stock-test-1991.csv, stock-test-<year>.csv.
Usage: python scripts/ingest/census/hist_census_stock_test.py --extract EXTRACT [--years 1991,2001,2011] [--out DIR]
"""
import argparse
import csv
import os
import statistics
import sys
import warnings
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from hist_census_crosswalk import CRS, MAIN, MAPS, OUT, load_layer, read_domestic, stock_points  # noqa: E402
from hist_census_lib import norm_key, stock_apportion  # noqa: E402

warnings.filterwarnings('ignore')


def errors(est, true):
    ape = [abs(est[k] - true[k]) / true[k] for k in true if true[k] > 0]
    ae = [abs(est[k] - true[k]) for k in true]
    tot = sum(true.values())
    return {'wards': len(true), 'median_ape_pct': round(100 * statistics.median(ape), 1),
            'mean_ape_pct': round(100 * statistics.mean(ape), 1),
            'share_within_20pct': round(100 * sum(1 for x in ape if x <= 0.2) / len(ape), 1),
            'share_over_50pct': round(100 * sum(1 for x in ape if x > 0.5) / len(ape), 1),
            'misallocated_pct': round(100 * 0.5 * sum(ae) / tot, 1)}


def test_1991(dom, out):
    """The 1991 test, as first written (stock: a plain count of the bands built before 1991)."""
    import geopandas as gpd
    wards = gpd.read_file('/vsigzip/' + str(MAPS / 'local-government' / 'Wards_1984.fgb.gz')).to_crs(CRS)
    wards['geometry'] = wards.geometry.buffer(0)
    lgd = load_layer('local-government/LGD_1993.fgb')[['LGDNAME', 'geometry']]
    pts = wards.copy()
    pts['geometry'] = wards.geometry.representative_point()
    j = gpd.sjoin(pts, lgd, predicate='within', how='left')
    j = j[~j.index.duplicated(keep='first')]  # a point on a shared edge of two districts: keep one
    wards['lgd'] = j['LGDNAME'].str.upper().values
    pop = {}
    with open(MAIN / 'data' / 'census' / 'derived' / 'ward1984-census-1991.csv', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            pop[(r['lgd'].upper(), norm_key(r['sas_name']))] = float(r['total_pop'])
    wards['key'] = [(l, norm_key(n)) for l, n in zip(wards.lgd, wards.NAME)]
    wards['pop'] = [pop.get(k) for k in wards.key]
    missing = int(wards['pop'].isna().sum())
    wards = wards[wards['pop'].notna()].reset_index(drop=True)
    wards['wid'] = range(len(wards))
    wards['area'] = wards.geometry.area
    # valuation stock built before 1991, counted per ward (in memory only)
    p = dom[dom.SubClass.str.match(r'^(Pre[ -]1919|Inter-War|1946-1965|1966-1990)')][['geometry']]
    settle = load_layer('physical/Settlements_2015.fgb')[['Name', 'geometry']]
    js = gpd.sjoin(p, wards[['wid', 'geometry']], predicate='within', how='inner')
    stock = js.groupby('wid').size().to_dict()
    jin = gpd.sjoin(p, settle[['geometry']], predicate='within', how='inner')
    inside = set(jin.index)
    stock_in = js[js.index.isin(inside)].groupby('wid').size().to_dict()
    del p, js, jin
    # each ward's area inside a settlement footprint, and which wards' centres lie in one
    from shapely.ops import unary_union
    su = unary_union(list(settle.geometry))
    wards['fp_area'] = [g.intersection(su).area for g in wards.geometry]
    cen_in = {w for w, g in zip(wards.wid, wards.geometry.representative_point()) if su.contains(g)}
    true = dict(zip(wards.wid, wards['pop']))
    est = {m: {} for m in ('area', 'stock', 'town', 'town+stock')}
    for name, sub in wards.groupby('lgd'):
        P = sub['pop'].sum()
        ids = list(sub.wid)
        A = dict(zip(sub.wid, sub.area))
        S = {w: stock.get(w, 0) for w in ids}
        Sin = {w: stock_in.get(w, 0) for w in ids}
        FA = dict(zip(sub.wid, sub.fp_area))
        T = sum(true[w] for w in ids if w in cen_in)     # the 'printed town total'
        for w in ids:
            est['area'][w] = P * A[w] / sum(A.values())
            est['stock'][w] = P * S[w] / sum(S.values()) if sum(S.values()) else est['area'][w]
        rem = P - T
        oa = {w: A[w] - FA[w] for w in ids}
        so = {w: S[w] - Sin[w] for w in ids}
        for w in ids:
            t_part = T * FA[w] / sum(FA.values()) if sum(FA.values()) else 0
            est['town'][w] = t_part + (rem * oa[w] / sum(oa.values()) if sum(oa.values()) else 0)
            ts = T * Sin[w] / sum(Sin.values()) if sum(Sin.values()) else t_part
            rs = rem * so[w] / sum(so.values()) if sum(so.values()) else (rem * oa[w] / sum(oa.values()) if sum(oa.values()) else 0)
            est['town+stock'][w] = ts + rs
    res = []
    for m, e in est.items():
        res.append(dict({'method': m}, **errors(e, true)))
    write_result(out, '1991', res)
    print('wards without a 1991 figure', missing)


def write_result(out, year, res):
    priv = os.path.join(out, 'private')
    os.makedirs(priv, exist_ok=True)
    with open(os.path.join(priv, f'stock-test-{year}.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, list(res[0].keys()))
        w.writeheader()
        w.writerows(res)
    for r in res:
        print(year, r)


def small_units(year):
    """(GeoDataFrame unit, parent, persons, geometry) for the 2001 output areas (parent: the 1992
    ward, the code's first six characters) or the 2011 small areas (parent: the super output area)."""
    from hist_census_1991_2011 import units_small
    g, _ = units_small(year)
    if year == '2001':
        g['parent'] = g.unit.str[:6]
    else:
        import pyogrio
        soa = pyogrio.read_dataframe(str(MAPS / 'census-areas' / 'SA2011.fgb'), columns=['SA2011', 'SOA2011'], read_geometry=False)
        g['parent'] = g.unit.map(dict(zip(soa.SA2011, soa.SOA2011)))
    return g[g.parent.notna()].reset_index(drop=True)


def test_small(dom, out, year):
    """Spread each parent's total over its small units by area and by stock (stock_apportion, the
    guard included); compare with the true small-unit figures."""
    import geopandas as gpd
    g = small_units(year)
    g['area'] = g.geometry.area
    true = dict(zip(g.unit, g.persons))
    parent_tot = g.groupby('parent').persons.sum().to_dict()
    res = []
    for label, bandless in (('stock', 0.0), ('stock+apts', 1.0)):
        pts = stock_points(dom, year, bandless=bandless)
        j = gpd.sjoin(pts, g[['geometry']], predicate='within', how='inner')
        st = j.groupby('index_right').w.sum().to_dict()
        del pts, j
        r = stock_apportion([(u, p, a, st.get(i, 0.0)) for i, (u, p, a) in enumerate(zip(g.unit, g.parent, g.area))], parent_tot)
        if label == 'stock':
            res.append(dict({'method': 'area', 'units': len(true), 'parents': len(parent_tot)}, **errors(r['area'], true),
                            parents_flagged=''))
        res.append(dict({'method': label, 'units': len(true), 'parents': len(parent_tot)}, **errors(r['stock'], true),
                        parents_flagged=len(r['flags'])))
    write_result(out, year, res)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--extract', required=True, help='the private valuation extract, read in place')
    ap.add_argument('--years', default='1991', help='1991 (wards in districts), 2001 (output areas in wards), 2011 (small areas in super output areas)')
    args = ap.parse_args()
    dom = read_domestic(args.extract)
    for year in args.years.split(','):
        if year == '1991':
            test_1991(dom, args.out)
        else:
            test_small(dom, args.out, year)


if __name__ == '__main__':
    main()
