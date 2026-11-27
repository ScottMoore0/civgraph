#!/usr/bin/env python3
"""Religion tables of the 1937, 1951 and 1961 county and county-borough reports (county districts;
county-borough wards), from the OCR of hist_census_ocr.py, each row reconciled against its own
sexes and total, the areas against the county (or county borough) total.

Reads the pages listed as REL in hist-census-pages.json, and the categories printed that year
('religion_categories'). Applies <out>/corrections/religion-corrections-<year>.csv (rows re-read
from the page images: all the row's counts, space separated, in printed order). Writes
areas/religion-<year>.csv and validation/religion-checks-<year>.csv.
Usage: python scripts/ingest/census/hist_census_religion.py --year 1937 [--out DIR]
"""
import argparse
import csv
import difflib
import json
import os
import re
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from hist_census_lib import check_sum, district_kind, norm_key  # noqa: E402
from hist_census_parse import OUT, records, similar, variants  # noqa: E402


def fix_triple(p, m, f):
    """(p, m, f) with p = m + f, allowing one of the three one stray digit; None if impossible."""
    if p == m + f:
        return p, m, f
    found = []
    for k in range(3):
        for alt in variants((p, m, f)[k])[1:]:
            t = [p, m, f]
            t[k] = alt
            if t[0] == t[1] + t[2]:
                found.append(tuple(t))
    return found[0] if len(found) == 1 else None


def solve_one_cell(seg, ncat):
    """A row read with one wrong count is fixed by its two checks: the group (total or category)
    whose persons != males + females, and the column (persons, males or females) whose categories
    do not add to the total, cross at the wrong cell. Returns the mended groups or None."""
    g = [list(seg[3 * k:3 * k + 3]) for k in range(ncat + 1)]
    rg = [x[0] - x[1] - x[2] for x in g]
    rc = [sum(x[c] for x in g[1:]) - g[0][c] for c in range(3)]
    bad_g = [i for i, r in enumerate(rg) if r]
    bad_c = [c for c, r in enumerate(rc) if r]
    if len(bad_g) != 1 or len(bad_c) != 1:
        return None
    i, c = bad_g[0], bad_c[0]
    fix = -rc[c] if i > 0 else rc[c]
    g[i][c] += fix
    if g[i][c] < 0 or g[i][0] != g[i][1] + g[i][2]:
        return None
    if any(sum(x[cc] for x in g[1:]) != g[0][cc] for cc in range(3)):
        return None
    return [tuple(x) for x in g]


def religion_record(nums, ncat):
    """[(persons, males, females)] for the total and each of ncat categories, every sex adding
    up and the categories adding to the total in persons, males and females; one misread count
    is mended from those checks (solve_one_cell). None if the row will not reconcile."""
    need = 3 * (ncat + 1)
    for start in range(0, 3):
        seg = nums[start:start + need]
        if len(seg) < need:
            break
        trip = [fix_triple(*seg[3 * k:3 * k + 3]) for k in range(ncat + 1)]
        if not any(t is None for t in trip) and all(sum(t[c] for t in trip[1:]) == trip[0][c] for c in range(3)):
            return trip
        solved = solve_one_cell(seg, ncat)
        if solved:
            return solved
    return None


HAS_TOTAL = {'value': True}


def religion_row(nums, ncat):
    """religion_record, or for a table that prints no total columns (1951: the categories only)
    the categories with the total their sum. Each category's sexes must add up; the areas are
    then checked against the county row."""
    if HAS_TOTAL['value']:
        return religion_record(nums, ncat)
    for start in range(0, 3):
        seg = nums[start:start + 3 * ncat]
        if len(seg) < 3 * ncat:
            break
        trip = [fix_triple(*seg[3 * k:3 * k + 3]) for k in range(ncat)]
        if any(t is None for t in trip):
            continue
        return [tuple(sum(t[c] for t in trip) for c in range(3))] + trip
    return None


def match_name(label, names):
    best, score = None, 0.0
    k = norm_key(label)
    for n in names:
        nk = norm_key(n)
        sc = difflib.SequenceMatcher(None, k[-len(nk) - 4:], nk).ratio()
        if sc > score:
            best, score = n, sc
    return best, score


def parse_religion(year, county, report, pages, out, cats, names):
    stem = os.path.splitext(report)[0]
    res = []
    for page in pages:
        readings = []
        for name in (['p', '', 'b', 'c'] if year == '1961' else ['', 'b', 'c', 'p']):
            txt = os.path.join(out, 'ocr', year, f'{stem}-p{page:03d}' + (f'.{name}' if name else '') + '.txt')
            if os.path.exists(txt):
                with open(txt, encoding='utf-8') as f:
                    readings.append(records(f.read().splitlines(), year != '1937'))
        if not readings:
            continue
        section = None
        for rec in readings[0]:
            label = rec['label']
            if re.search(r'analysis', label, re.I) or len(rec['nums']) < 3 * (len(cats) + HAS_TOTAL['value']) - 2:
                continue
            trip = religion_row(rec['nums'], len(cats))
            src = ''
            if trip is None:
                # the same row in another reading: the k-th row there with a similar label, where
                # this is the k-th such row here (Larne urban and Larne rural are both 'Larne')
                k = sum(1 for r0 in readings[0][:readings[0].index(rec)] if similar(r0['label'], label) >= 0.8)
                for alt in readings[1:]:
                    sims = [a for a in alt if similar(a['label'], label) >= 0.6]
                    if len(sims) > k:
                        t = religion_row(sims[k]['nums'], len(cats))
                        if t:
                            trip, src = t, 'from a second reading of the page'
                            break
            up = label.upper()
            if re.search(r'RURAL\s+DIST|RUVAL|RURAL DIST|\bR\.\s?D\b', up):
                section = 'rural'
            elif re.search(r'URBAN\s+DIST|MUNICIPAL|\bU\.\s?D\b|\bM\.\s?B\b', up):
                section = 'urban'
            elif re.search(r'WARDS?|WARPS', up):
                section = 'ward'
            short = re.sub(r'.*(Districts?|Borough|Wards?|Warps)\.?', '', label, flags=re.I).strip(' .,') or label
            short = re.sub(r'(U\.?D|R\.?D|M\.?B)\.?$', '', short).strip(' .,')
            if section == 'rural':
                cands = [n for n in names if district_kind(n) == 'rural_district']
            elif section == 'urban':
                cands = [n for n in names if district_kind(n) in ('urban_district', 'municipal_borough')]
            else:
                cands = [n for n in names if not district_kind(n)] or names
            cands = cands or names
            best, score = match_name(short, [re.sub(r'\s+(Urban District|Rural District|Municipal Borough|County Borough|Ward)$', '', n) for n in cands])
            if best is not None:
                best = next(n for n in cands if n.startswith(best))
            cname = county.split()[0].upper()
            if re.search(cname + r'\s*[CG][O0]', up) or (re.search(r'COUNTY|CO\.?\s*$|BOROUGH\s*$', up) and not re.search(r'MUNICIPAL', up) and section is None):
                best, kind, score = f'{county} (total)', 'county_total', 1.0
            elif re.search(r'CO(UNTY)?\.?\s*BOROUGH|GO\s*BOROUGH', up) and county == 'Londonderry':
                best, kind, score = 'Londonderry County Borough', 'county_borough', 1.0
                section = 'ward'
            else:
                kind = district_kind(best or '') or 'ward'
            row = {'year': int(year), 'county': county, 'area_type': kind, 'name_printed': label,
                   'name': best if score >= 0.6 else '', 'source': report, 'table': 'religion', 'page': page,
                   'note': src}
            if trip:
                row.update({'persons': trip[0][0], 'males': trip[0][1], 'females': trip[0][2], 'status': 'ok'})
                for c, t in zip(cats, trip[1:]):
                    row[c], row[c + '_m'], row[c + '_f'] = t
            else:
                row['status'] = 'unparsed'
                row['note'] = 'OCR: ' + rec['raw'][:160]
            res.append(row)
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--year', required=True)
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()
    year, out = args.year, args.out
    with open(os.path.join(HERE, 'hist-census-pages.json'), encoding='utf-8') as f:
        cfg = json.load(f)[year]
    cats = cfg['religion_categories']
    HAS_TOTAL['value'] = cfg.get('religion_has_total', True)
    corrections = []
    cpath = os.path.join(out, 'corrections', f'religion-corrections-{year}.csv')
    if os.path.exists(cpath):
        with open(cpath, encoding='utf-8') as f:
            corrections = list(csv.DictReader(f))
    rows = []
    for report, spec in cfg['reports'].items():
        names = list(spec.get('districts', [])) + list(spec.get('wards', []))
        r = parse_religion(year, spec['county'], report, spec['tables'].get('REL', []), out, cats, names)
        for c in (c for c in corrections if c['report'] == report):
            if c.get('action') == 'add':
                # a row no reading yields (1951 Tyrone's county row), read from the page image
                trip = religion_row([int(v) for v in c['values'].split()], len(cats))
                if not trip:
                    print(f'religion correction does not reconcile: {c}', file=sys.stderr)
                    continue
                x = {'year': int(year), 'county': spec['county'], 'name_printed': c['name'], 'name': c['name'],
                     'area_type': district_kind(c['name']) or ('county_total' if '(total)' in c['name'] else 'ward'),
                     'source': report, 'table': 'religion', 'page': int(c['page']), 'status': 'ok',
                     'note': f"read from page image p.{c['page']}",
                     'persons': trip[0][0], 'males': trip[0][1], 'females': trip[0][2]}
                for cn, t in zip(cats, trip[1:]):
                    x[cn], x[cn + '_m'], x[cn + '_f'] = t
                r.insert(0, x)
                continue
            if c.get('action') == 'drop':
                r = [x for x in r if not (c['match'].lower() in x['name_printed'].lower() and str(x['page']) == c['page'])]
                continue
            hit = [x for x in r if c['match'].lower() in x['name_printed'].lower() and str(x['page']) == c['page']]
            if c.get('action') in ('first', 'second') and len(hit) >= 2:
                hit = [hit[0 if c['action'] == 'first' else 1]]
            if len(hit) != 1:
                print(f'religion correction matches {len(hit)}: {c}', file=sys.stderr)
                continue
            x = hit[0]
            if c.get('name'):
                x['name'] = c['name']
                x['area_type'] = district_kind(c['name']) or ('county_total' if '(total)' in c['name'] else 'ward')
            if c.get('values'):
                trip = religion_row([int(v) for v in c['values'].split()], len(cats))
                if not trip:
                    print(f'religion correction does not reconcile: {c}', file=sys.stderr)
                    continue
                x.update({'persons': trip[0][0], 'males': trip[0][1], 'females': trip[0][2], 'status': 'ok',
                          'note': f"read from page image p.{c['page']}"})
                for cn, t in zip(cats, trip[1:]):
                    x[cn], x[cn + '_m'], x[cn + '_f'] = t
        if spec['county'] == 'Londonderry':
            # 'Londonderry Co. and Co. Borough', 'Londonderry Co.', then 'Londonderry Co. Borough'
            # and its wards, in that order
            tots = [x for x in r if x['area_type'] in ('county_total', 'county_borough')]
            for x, (kind, nm) in zip(tots, [('county_and_cb_total', 'Londonderry County and County Borough'),
                                             ('county_total', 'Londonderry (total)'),
                                             ('county_borough', 'Londonderry County Borough')]):
                x['area_type'], x['name'] = kind, nm
            if len(tots) == 3:
                after = r[r.index(tots[2]) + 1:]
                wards = spec.get('wards', [])
                for x in after:
                    best, sc = match_name(x['name_printed'], [w.replace(' Ward', '') for w in wards])
                    if best:
                        x['area_type'], x['name'] = 'ward', best + ' Ward'
        rows.extend(r)

    checks = []
    by_c = defaultdict(list)
    for r in rows:
        by_c[r['county']].append(r)
    for county, rr in by_c.items():
        tots = [r for r in rr if r['area_type'] == 'county_total' and r['status'] == 'ok']
        for r in rr:
            if r['status'] == 'ok' and not r['name']:
                checks.append({'year': year, 'check': 'religion_name', 'area': county, 'variable': 'name',
                               'status': 'fail', 'diff': '', 'detail': r['name_printed']})
        if not tots:
            continue
        tot = tots[0]
        parts = [r for r in rr if r['area_type'] != 'county_total' and r['status'] == 'ok' and r['name']]
        if county == 'Londonderry':   # the county total excludes the county borough and its wards
            parts = [p for p in parts if p['area_type'] in ('urban_district', 'rural_district', 'municipal_borough')]
        for v in ['persons'] + cats:
            st, diff = check_sum([p.get(v) for p in parts], tot.get(v))
            checks.append({'year': year, 'check': 'religion_areas_to_total', 'area': county, 'variable': v,
                           'status': st, 'diff': '' if diff is None else diff, 'detail': f'{len(parts)} areas'})
            if st != 'ok':
                tot['status'] = 'fail'
    cols = ['year', 'county', 'area_type', 'name_printed', 'name', 'persons', 'males', 'females'] + \
           [x for c in cats for x in (c, c + '_m', c + '_f')] + ['source', 'table', 'page', 'status', 'note']
    os.makedirs(os.path.join(out, 'areas'), exist_ok=True)
    with open(os.path.join(out, 'areas', f'religion-{year}.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, cols, extrasaction='ignore')
        w.writeheader()
        w.writerows(rows)
    with open(os.path.join(out, 'validation', f'religion-checks-{year}.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, ['year', 'check', 'area', 'variable', 'status', 'diff', 'detail'])
        w.writeheader()
        w.writerows(checks)
    print('religion rows', dict(Counter(r['status'] for r in rows)), 'checks',
          dict(Counter((c['check'], c['status']) for c in checks)))


if __name__ == '__main__':
    main()
