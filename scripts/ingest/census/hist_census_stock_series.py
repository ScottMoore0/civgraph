#!/usr/bin/env python3
"""PRIVATE: the housing-weighted (valuation-stock) long-run series 1926-2021 and the
discontinuities redone on it. Reads the private stock files that hist_census_crosswalk.py --stock
(1926-1961), hist_census_1971.py --stock (1971, 1981) and hist_census_1991_2011.py --stock (1991,
2001, 2011) wrote, and writes to <out>/private/ only.

  series        persons per Data Zone and per stable area in every census year: the stock
                version where there is one, otherwise the town-aware version (1926-1981) or the
                series' own (1991 1984 wards by area, 2001 and 2011 areal output-area and
                small-area weights; dz21-population-1926-2021.csv); 2021 as published
  discontinuity the 1961 to 1971 and 1981 to 1991 changes on the stock versions, beside the
                town-aware versions: by Data Zone, by stable area and by the areas that hold both
                the 1926-1961 units and the 1972 wards whole; and, for every pair of census years,
                how far the pattern moves (the share of people who would have to move for one
                year's distribution to match the other's: 0 = the same pattern) and the median
                change, so the 1961-1971 step can be set against the others

Run hist_census_series.py first (it writes the stable areas, the combined areas and the
non-private series this reads). Usage: python scripts/ingest/census/hist_census_stock_series.py [--out DIR]
"""
import argparse
import os
import statistics
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from hist_census_crosswalk import OUT, read_csv, write_csv  # noqa: E402
from hist_census_lib import dissimilarity  # noqa: E402

YEARS = ('1926', '1937', '1951', '1961', '1971', '1981', '1991', '2001', '2011', '2021')
STOCKED = ('1926', '1937', '1951', '1961', '1971', '1981', '1991', '2001', '2011')
TOWN_AWARE = ('1926', '1937', '1951', '1961', '1971', '1981')
PER_AREA = ('1951', '1961', '1971', '1981', '1991', '2001')
MIN_BASE = {'dz': 100, 'stable_area': 0, 'combined_area': 0}   # smallest base for a % change


def f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def pct(a, b):
    return round(100 * (b - a) / a, 1) if a else ''


def change_stats(prev, cur, min_base=0):
    """Median absolute % change, shares over 25% and 40% (areas with a base of at least
    min_base), and the dissimilarity of the two distributions, for area -> persons maps."""
    ch = [abs(cur.get(k, 0.0) - v) / v for k, v in prev.items() if v and v >= max(min_base, 1e-9)]
    d = dissimilarity(prev, cur)
    return {'n': len(ch), 'median_abs_change_pct': round(100 * statistics.median(ch), 1) if ch else '',
            'over_25pct': sum(1 for x in ch if x > 0.25), 'over_40pct': sum(1 for x in ch if x > 0.40),
            'dissimilarity_pct': round(100 * d, 2) if d is not None else ''}


def group(dz_vals, members):
    """area -> persons from Data Zone values, for {area: [dz]}; an area with a Data Zone missing
    the year (None) is left out."""
    out = {}
    for g, ks in members.items():
        v = [dz_vals.get(k) for k in ks]
        if all(x is not None for x in v):
            out[g] = sum(v)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()
    out = args.out
    priv = os.path.join(out, 'private')
    base = {r['DZ2021_cd']: r for r in read_csv(os.path.join(out, 'series', 'dz21-population-1926-2021.csv'))}
    incomplete = defaultdict(set)
    for y in ('1926', '1937', '1951', '1961'):
        pth = os.path.join(out, 'series', f'dz21-census-{y}.csv')
        if os.path.exists(pth):
            incomplete[y] = {r['DZ2021_cd'] for r in read_csv(pth) if r.get('incomplete') == 'yes'}
    # town (non-private) and stock (private) persons per Data Zone and year
    town = {y: {} for y in YEARS}
    stock = {y: {} for y in YEARS}
    cath = {y: {} for y in STOCKED}
    for k, r in base.items():
        for y in YEARS:
            v = f(r.get(f'persons_{y}'))
            town[y][k] = None if k in incomplete[y] else v
    methods = []
    for y in YEARS:
        pth = os.path.join(priv, f'dz21-census-{y}-stock.csv')
        if y in STOCKED and os.path.exists(pth):
            for r in read_csv(pth):
                k = r['DZ2021_cd']
                stock[y][k] = None if k in incomplete[y] else f(r['persons_stock'])
                cath[y][k] = f(r['catholic_stock'])
            methods.append({'year': y, 'method': 'housing-weighted (stock)', 'source': f'private/dz21-census-{y}-stock.csv'})
        else:
            stock[y] = dict(town[y])
            how = 'town-aware' if y in TOWN_AWARE else ('as published' if y == '2021' else 'as crosswalked (hist_census_series.py)')
            methods.append({'year': y, 'method': how, 'source': 'series/dz21-population-1926-2021.csv'})
    write_csv(os.path.join(priv, 'series-stock-methods.csv'), methods, ['year', 'method', 'source'])
    # the long-run Data Zone series
    rows = []
    for k, r in sorted(base.items()):
        row = {'DZ2021_cd': k, 'DZ2021_nm': r['DZ2021_nm'], 'lgd1993': r['lgd1993'], 'stable_area': r['stable_area']}
        for y in YEARS:
            v = stock[y].get(k)
            row[f'persons_{y}'] = round(v, 1) if v is not None else ''
        for y in ('1926', '1937', '1951', '1961'):
            p, c = stock[y].get(k), cath[y].get(k)
            row[f'catholic_pct_{y}'] = round(100 * c / p, 1) if p and c is not None else ''
        row['catholic_bg_pct_2021'] = r.get('catholic_bg_pct_2021', '')
        row['modelled_before_1991'] = 'yes'
        rows.append(row)
    write_csv(os.path.join(priv, 'dz21-population-1926-2021-stock.csv'), rows, list(rows[0].keys()))
    # stable areas and the areas that also hold the 1972 wards whole
    sa_name, sa_members = {}, defaultdict(list)
    for r in read_csv(os.path.join(out, 'analysis', 'stable-areas-dz.csv')):
        sa_members[r['stable_area']].append(r['DZ2021_cd'])
        sa_name[r['stable_area']] = r['stable_area_name']
    ca_members = defaultdict(list)
    pth = os.path.join(out, 'analysis', 'combined-areas-1961-1971-dz.csv')
    if os.path.exists(pth):
        for r in read_csv(pth):
            ca_members[r['area']].append(r['DZ2021_cd'])
    levels = {'dz': {k: [k] for k in base}, 'stable_area': dict(sa_members), 'combined_area': dict(ca_members)}
    by = {(lv, m, y): group(src[y], mem) for lv, mem in levels.items() for m, src in (('town', town), ('stock', stock))
          for y in YEARS}
    # stable-area series (stock) with the town-aware 1961 and 1971 beside it
    srows = []
    for g in sorted(sa_members):
        r = {'stable_area': g, 'name': sa_name[g], 'n_dz': len(sa_members[g])}
        for y in YEARS:
            v = by[('stable_area', 'stock', y)].get(g)
            r[f'persons_{y}'] = round(v) if v is not None else ''
        p0, p1 = r['persons_1926'], r['persons_2021']
        r['change_pct_1926_2021'] = pct(p0, p1) if p0 != '' and p1 != '' else ''
        for y0, y1 in (('1961', '1971'), ('1981', '1991')):
            for m in ('town', 'stock'):
                a, b = by[('stable_area', m, y0)].get(g), by[('stable_area', m, y1)].get(g)
                r[f'change_pct_{y0}_{y1}_{m}'] = pct(a, b) if a is not None and b is not None else ''
        srows.append(r)
    write_csv(os.path.join(priv, 'stable-areas-series-stock.csv'), srows, list(srows[0].keys()))
    # the 1961-1971 discontinuity, per area, at each level
    for lv, fname in (('combined_area', 'discontinuity-1961-1971-stock.csv'), ('dz', 'discontinuity-1961-1971-stock-dz.csv'),
                      ('stable_area', 'discontinuity-1961-1971-stock-stable-areas.csv')):
        drows = []
        for g in sorted(levels[lv]):
            r = {'area': g, 'n_dz': len(levels[lv][g])}
            if lv == 'stable_area':
                r['name'] = sa_name.get(g, '')
            for m in ('town', 'stock'):
                for y in PER_AREA:
                    v = by[(lv, m, y)].get(g)
                    r[f'persons_{y}_{m}'] = round(v, 1) if v is not None else ''
                for a, b in zip(PER_AREA, PER_AREA[1:]):
                    pa, pb = r[f'persons_{a}_{m}'], r[f'persons_{b}_{m}']
                    r[f'change_pct_{a}_{b}_{m}'] = pct(pa, pb) if pa != '' and pb != '' else ''
            drows.append(r)
        if drows:
            write_csv(os.path.join(priv, fname), drows, list(drows[0].keys()))
    # every pair of census years, every level, both methods
    summary = []
    for lv in levels:
        if not levels[lv]:
            continue
        for m in ('town', 'stock'):
            for a, b in zip(YEARS, YEARS[1:]):
                prev, cur = by[(lv, m, a)], by[(lv, m, b)]
                common = set(prev) & set(cur)
                st = change_stats({k: prev[k] for k in common}, {k: cur[k] for k in common}, MIN_BASE[lv])
                summary.append(dict({'level': lv, 'method': m, 'from': a, 'to': b}, **st))
    write_csv(os.path.join(priv, 'discontinuity-summary-stock.csv'), summary,
              ['level', 'method', 'from', 'to', 'n', 'median_abs_change_pct', 'over_25pct', 'over_40pct', 'dissimilarity_pct'])
    for s_ in summary:
        print(s_)
    print('methods:', {m['year']: m['method'] for m in methods})


if __name__ == '__main__':
    main()
