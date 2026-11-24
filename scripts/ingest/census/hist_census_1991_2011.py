#!/usr/bin/env python3
"""The 1991, 2001 and 2011 censuses on 2021 Data Zones, by area and (with --stock, PRIVATE) by
housing, so that the housing-weighted series runs on one footing from 1926 to 2011.

Units, each keeping its published persons exactly under every method:
  1991  the 566 wards of 1984 (data/census/derived/ward1984-census-1991.csv, total_pop), keyed by
        their 1993 district and name as hist_census_series.py keys them (spelling variants paired
        within the district)
  2001  the 5,022 output areas (oa2001-census-2001.csv, total_pop; OA2001.fgb)
  2011  the 4,537 small areas (census-2011-sa.csv, AllUsualResidents; SA2011.fgb)

There is no official lookup from these units to the 2021 Data Zones: NISRA's lookup tables run
from the 2011 small areas and 2001 output areas to other geographies, none to Data Zones, and the
Data Zones were drawn in 2021 from new building blocks (the road network), not from the postcode
polygons of the output and small areas, so neither nests in the other. The choice is between
area weighting (what the long-run series uses: the areal sa2011_to_dz2021 weights, the 1984 wards
by area) and housing weighting.

  area   a unit's count to the Data Zones by the area of the unit in each.
  stock  (--stock EXTRACT, PRIVATE) by the surviving domestic properties of the right era in each
         piece (hist_census_lib.era_weight, pro-rated to census day 21 Apr 1991, 29 Apr 2001,
         27 Mar 2011), with the survivor-bias guard (more than 20 persons per qualifying property:
         area; 12-20: half and half). Apartments carry no era band: left out by default, as in
         1926-1981; --bandless-weight 1 counts them in 2001 and 2011 (hist_census_stock_test.py
         --years 2001,2011 scores both ways). No towns step: these series are not town-aware (no printed
         town figures are used), and the units are small enough that a town is its own units.

Writes, under --out, crosswalk/checks-<year>-later.csv (area: units placed, unit totals, the area
version against the series' own input); with --stock only private/dz21-census-<year>-stock.csv,
private/weights-<year>-stock.csv (unit x Data Zone), private/stock-flags-<year>.csv and
private/stock-bands.csv (domestic properties per era band as spelt, with each band's weight per
census year: aggregates; nothing per property).
Usage: python scripts/ingest/census/hist_census_1991_2011.py [--years 1991,2001,2011] [--out DIR]
       [--stock EXTRACT] [--open-band-end YEAR] [--bandless-weight W] [--bandless-years 2001,2011]
"""
import argparse
import os
import sys
import warnings
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from hist_census_crosswalk import CRS, MAPS, OUT, load_layer, read_csv, read_domestic, stock_points, write_csv  # noqa: E402
from hist_census_lib import (CENSUS_DAY, OPEN_BAND_END, dissimilarity, era_band_table, norm_key,  # noqa: E402
                             pair_leftovers, stock_apportion)
from hist_census_paths import DERIVED  # noqa: E402

warnings.filterwarnings('ignore')
YEARS = ('1991', '2001', '2011')


def f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def units_1991():
    """(GeoDataFrame unit, persons, geometry; notes) for the 1984 wards with a 1991 figure. A ward
    is keyed '<1993 district>|<name key>' (the district holding its representative point)."""
    import geopandas as gpd
    wards = gpd.read_file('/vsigzip/' + str(MAPS / 'local-government' / 'Wards_1984.fgb.gz')).to_crs(CRS)
    wards['geometry'] = wards.geometry.buffer(0)
    lgd = load_layer('local-government/LGD_1993.fgb')[['LGDNAME', 'geometry']]
    pts = wards.copy()
    pts['geometry'] = wards.geometry.representative_point()
    j = gpd.sjoin(pts, lgd, predicate='within', how='left')
    j = j[~j.index.duplicated(keep='first')]   # a point on a shared district edge joins one district
    keys = [(str(a).upper(), norm_key(n)) for a, n in zip(j['LGDNAME'].values, wards.NAME)]
    pop = {(r['lgd'].upper(), norm_key(r['sas_name'])): float(r['total_pop'])
           for r in read_csv(DERIVED / 'ward1984-census-1991.csv')}
    left = pair_leftovers([k for k in keys if k not in pop], [k for k in pop if k not in set(keys)])
    keys = [left.get(k, k) for k in keys]
    wards['unit'] = [f'{a}|{b}' for a, b in keys]
    wards['persons'] = [pop.get(k) for k in keys]
    missing = int(wards['persons'].isna().sum())
    notes = {'paired by spelling': len(left), 'map wards without a 1991 figure': missing,
             '1991 wards not on the map': len(set(pop) - set(keys))}
    return wards[wards['persons'].notna()][['unit', 'persons', 'geometry']].reset_index(drop=True), notes


def units_small(year):
    """(GeoDataFrame unit, persons, geometry; notes) for the 2001 output areas or 2011 small areas."""
    if year == '2001':
        layer, code, csv_name, col = 'census-areas/OA2001.fgb', 'OA_CODE', 'oa2001-census-2001.csv', 'total_pop'
    else:
        layer, code, csv_name, col = 'census-areas/SA2011.fgb', 'SA2011', 'census-2011-sa.csv', 'AllUsualResidents'
    g = load_layer(layer)[[code, 'geometry']]
    g['geometry'] = g.geometry.buffer(0)
    pop = {r[code]: f(r[col]) for r in read_csv(DERIVED / csv_name)}
    g['unit'] = g[code]
    g['persons'] = g[code].map(pop)
    notes = {'map units without a figure': int(g['persons'].isna().sum()), 'figures not on the map': len(set(pop) - set(g[code]))}
    return g[g['persons'].notna()][['unit', 'persons', 'geometry']].reset_index(drop=True), notes


def load_units(year):
    return units_1991() if year == '1991' else units_small(year)


def series_input(year):
    """The long-run series' own Data Zone figures for the year (hist_census_series.py), to set the
    area version beside: 2001 the areal output-area weights (dz21-census-2001.csv), 2011 the
    areal small-area weights; 1991 is made here exactly as the series makes it."""
    if year == '2001':
        return {r['DZ2021_cd']: f(r['total_pop']) or 0.0 for r in read_csv(DERIVED / 'dz21-census-2001.csv')}
    if year == '2011':
        from hist_census_series import dz_2011
        return dz_2011()
    return None


def main():
    import geopandas as gpd
    ap = argparse.ArgumentParser()
    ap.add_argument('--years', default=','.join(YEARS))
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--stock', metavar='EXTRACT', help='also the private valuation-stock series, from this extract (read in place)')
    ap.add_argument('--open-band-end', type=float, default=OPEN_BAND_END,
                    help='the year an open-ended era band (Post 2005, 2006 onwards) is taken to end (default %(default)s)')
    ap.add_argument('--bandless-weight', type=float, default=0.0,
                    help='weight of a domestic property with no era band (apartments) in the years of --bandless-years '
                         '(default 0: left out, as in 1926-1981)')
    ap.add_argument('--bandless-years', default='2001,2011', help='the years --bandless-weight applies to')
    args = ap.parse_args()
    out = args.out
    years = [y for y in args.years.split(',') if y]
    dz = load_layer('census-areas/DZ2021.fgb')[['DZ2021_cd', 'DZ2021_nm', 'geometry']]
    names = dict(zip(dz.DZ2021_cd, dz.DZ2021_nm))
    dom = read_domestic(args.stock) if args.stock else None
    priv = os.path.join(out, 'private')
    if dom is not None:
        bands = era_band_table(dom.SubClass.value_counts().to_dict(), {y: CENSUS_DAY[y] for y in CENSUS_DAY}, args.open_band_end)
        write_csv(os.path.join(priv, 'stock-bands.csv'), bands, list(bands[0].keys()))
        unknown = [(b['band'], b['properties']) for b in bands if b['kind'] == 'none']
        print('era bands:', [(b['band'], b['kind'], b['properties']) for b in bands])
        if unknown:
            print('NOTE: domestic properties in bands not recognised (counted 0):', unknown)
    for year in years:
        units, notes = load_units(year)
        totals = dict(zip(units.unit, units.persons))
        pieces = gpd.overlay(units[['unit', 'geometry']], dz, how='intersection', keep_geom_type=True)
        pieces['area'] = pieces.geometry.area
        pieces = pieces[pieces.area > 1].reset_index(drop=True)
        stock = {}
        if dom is not None:
            bl = args.bandless_weight if year in args.bandless_years.split(',') else 0.0
            pts = stock_points(dom, year, args.open_band_end, bl)
            j = gpd.sjoin(pts, pieces[['geometry']], predicate='within', how='inner')
            stock = j.groupby('index_right').w.sum().to_dict()
            del pts, j
        res = stock_apportion([(i, u, a, stock.get(i, 0.0)) for i, u, a in zip(pieces.index, pieces.unit, pieces.area)], totals)
        dzc = dict(zip(pieces.index, pieces.DZ2021_cd))
        by_dz = {m: defaultdict(float) for m in ('area', 'stock')}
        for m in by_dz:
            for i, v in res[m].items():
                by_dz[m][dzc[i]] += v
        checks = []
        per_unit = {m: defaultdict(float) for m in ('area', 'stock')}
        for m in per_unit:
            for i, v in res[m].items():
                per_unit[m][pieces.at[i, 'unit']] += v
        for m in ('area',) + (('stock',) if dom is not None else ()):
            bad = [u for u, P in totals.items() if u not in res['lost'] and abs(per_unit[m][u] - P) > 1e-6 * max(P, 1)]
            checks.append({'year': year, 'check': f'unit_total_{m}', 'area': f'{len(totals) - len(res["lost"]) - len(bad)} exact',
                           'status': 'ok' if not bad else 'fail', 'diff': len(bad)})
        checks += [{'year': year, 'check': 'unit_not_on_data_zones', 'area': u, 'status': 'note', 'diff': totals[u]} for u in res['lost']]
        checks += [{'year': year, 'check': k, 'area': '', 'status': 'note', 'diff': v} for k, v in notes.items()]
        ref = series_input(year)
        if ref is not None:
            d = dissimilarity(ref, dict(by_dz['area']))
            checks.append({'year': year, 'check': 'area_vs_series_input_dissimilarity_pct', 'area': '', 'status': 'note',
                           'diff': round(100 * d, 3) if d is not None else ''})
        write_csv(os.path.join(out, 'crosswalk', f'checks-{year}-later.csv'), checks, ['year', 'check', 'area', 'status', 'diff'])
        tot = sum(totals.values())
        print(year, 'units', len(totals), 'persons', round(tot), 'on Data Zones', round(sum(by_dz['area'].values())),
              'units not on Data Zones', len(res['lost']), notes,
              'unit totals exact', {c['check']: c['status'] for c in checks if c['check'].startswith('unit_total')},
              'area vs series input', next((c['diff'] for c in checks if c['check'].startswith('area_vs')), ''))
        if dom is None:
            continue
        srows = [{'DZ2021_cd': d, 'year': year, 'persons_stock': round(by_dz['stock'].get(d, 0.0), 2), 'males_stock': '',
                  'females_stock': '', 'catholic_stock': '', 'catholic_pct_stock': ''} for d in sorted(names)]
        write_csv(os.path.join(priv, f'dz21-census-{year}-stock.csv'), srows, list(srows[0].keys()))
        wrows = [{'year': year, 'unit': pieces.at[i, 'unit'], 'DZ2021_cd': dzc[i], 'persons_stock': round(v, 3)}
                 for i, v in res['stock'].items()]
        write_csv(os.path.join(priv, f'weights-{year}-stock.csv'), wrows, ['year', 'unit', 'DZ2021_cd', 'persons_stock'])
        frows = [{'year': year, 'unit': fl['unit'], 'members': fl['unit'], 'persons_outside_towns': round(fl['persons']),
                  'qualifying_stock': round(fl['qualifying_stock'], 1),
                  'persons_per_property': round(fl['persons_per_property'], 1) if fl['persons_per_property'] else '',
                  'used': fl['used']} for fl in res['flags']]
        write_csv(os.path.join(priv, f'stock-flags-{year}.csv'), frows,
                  ['year', 'unit', 'members', 'persons_outside_towns', 'qualifying_stock', 'persons_per_property', 'used'])
        modes = defaultdict(int)
        for fl in res['flags']:
            modes[fl['used'].split(' ')[0] if 'no qualifying' not in fl['used'] else 'no stock'] += 1
        moved = 0.5 * sum(abs(by_dz['stock'].get(d, 0.0) - by_dz['area'].get(d, 0.0)) for d in names)
        moved_ref = 0.5 * sum(abs(by_dz['stock'].get(d, 0.0) - (ref or {}).get(d, 0.0)) for d in names) if ref else ''
        print(year, 'stock: units flagged', len(res['flags']), 'of', len(totals), dict(modes), 'persons', round(sum(by_dz['stock'].values())),
              'moved against area', round(moved), 'moved against the series input', round(moved_ref) if ref else '(same as area)')


if __name__ == '__main__':
    main()
