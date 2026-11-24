#!/usr/bin/env python3
"""1926 Census of Northern Ireland: area tables from NISRA's data-table workbooks of the 1926
county, county borough and general reports (the 2026 centenary release; OGL), checked against the
tables' own printed totals.

Inputs (read only): the *-data-tables.xlsx files in --src (default: the HIST_CENSUS_1926_SRC
folder). Outputs, in --out (default: hist_census_paths.OUT):
    areas/areas-1926.csv        one row per area: county, district, DED or ward, town, with persons,
                                males, females, 1911 population, acres and houses
    areas/religion-1926.csv     Table 18: religion by county district and county-borough ward
    validation/checks-1926.csv  every check, with its verdict
Usage: python scripts/ingest/census/hist_census_1926.py [--src DIR] [--out DIR]
"""
import argparse
import csv
import glob
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hist_census_lib import (acres, check_sexes, check_sum, district_kind, norm_key, parse_int,  # noqa: E402
                             split_ded_label, strip_notes)

from hist_census_paths import OUT, SRC_1926 as SRC  # noqa: E402
NI_TOTAL = 1256561

AREA_COLS = ['year', 'county', 'area_type', 'ref', 'name_printed', 'name', 'ward', 'district', 'key',
             'persons', 'males', 'females', 'prev_year', 'prev_persons', 'area_acres', 'houses_total',
             'houses_inhabited', 'source', 'table', 'page', 'status', 'note']
REL_COLS = ['year', 'county', 'area_type', 'name_printed', 'name', 'key', 'persons', 'males', 'females',
            'catholic', 'presbyterian', 'church_of_ireland', 'methodist', 'other_not_stated',
            'source', 'table', 'page', 'status', 'note']
COUNTY_OF_FILE = {'antrim': 'Antrim', 'armagh': 'Armagh', 'down': 'Down', 'fermanagh': 'Fermanagh',
                  'tyrone': 'Tyrone', 'londonderry': 'Londonderry', 'belfast': 'Belfast County Borough'}


def load(path):
    import openpyxl
    return openpyxl.load_workbook(path, read_only=True, data_only=True)


def values(r, start):
    """Columns from `start`: area A R P, 1911, persons, males, females, houses 1911, houses total,
    inhabited."""
    g = lambda i: r[start + i] if start + i < len(r) else None  # noqa: E731
    return {'area_acres': acres(g(0), g(1), g(2)), 'prev_persons': parse_int(g(3)), 'persons': parse_int(g(4)),
            'males': parse_int(g(5)), 'females': parse_int(g(6)), 'houses_total': parse_int(g(8)),
            'houses_inhabited': parse_int(g(9))}


def is_ded_total(cell):
    return bool(cell) and bool(re.match(r'^\s*total\s+\d+\s*(?:[.,]\s*|\s+)[A-Za-z]', str(cell), re.I))


def county_table3(path, county):
    """Table 3 of a county (or Londonderry county-and-borough) report."""
    rows = list(load(path)['Table 3'].iter_rows(values_only=True))
    src = os.path.basename(path)
    out, current_cb = [], None
    for r in rows[6:]:
        a, b, c, d = (str(x).strip() if x is not None else '' for x in r[:4])
        if not a:
            continue
        rec = None
        if a.upper().startswith('TOTAL') and a == b:
            name = strip_notes(re.sub(r'^total\s+', '', a, flags=re.I))
            up = name.upper()
            if up.startswith('OF COUNTY'):
                rec = {'area_type': 'county_total' if 'BOROUGH' not in up or 'COUNTY AND' in up else 'county_borough',
                       'name': county if 'BOROUGH' not in up or 'COUNTY AND' in up else 'Londonderry County Borough'}
                if 'COUNTY AND' in up:
                    rec['area_type'] = 'county_and_cb_total'
                if up == 'OF COUNTY BOROUGH':
                    continue   # the same figures as 'TOTAL Londonderry County Borough'
            elif up in ('URBAN DISTRICTS', 'RURAL DISTRICTS'):
                rec = {'area_type': 'urban_total' if up.startswith('URBAN') else 'rural_total', 'name': name.title()}
            else:
                rec = {'area_type': district_kind(name) or 'district', 'name': name}
            rec.update({'name_printed': a, 'district': ''})
            rec.update(values(r, 4))
        else:
            label = next((x for x in (b, c, d) if is_ded_total(x)), None)
            if label:
                ref, name, ward = split_ded_label(label)
                dist = strip_notes(a)
                rec = {'area_type': 'ward' if district_kind(dist) == 'county_borough' else 'ded', 'ref': ref,
                       'name': name, 'ward': ward or '', 'name_printed': label, 'district': dist}
                rec.update(values(r, 4))
            elif d and re.search(r'\bTown\b(?!land)', d) and not d.upper().startswith('TOTAL'):
                ref, ded, _ = split_ded_label(b)
                nm = strip_notes(d)
                part = bool(re.search(r'part of', nm, re.I))
                nm = re.sub(r',?\s*part( of)?\s*\(?$', '', re.sub(r'\bTown\b', '', nm)).strip(' ,')
                rec = {'area_type': 'town_part' if part else 'town', 'ref': ref, 'name': nm, 'name_printed': d,
                       'district': strip_notes(a), 'note': f'in DED {ref}. {ded}'}
                rec.update(values(r, 4))
                rec['area_acres'] = None
        if rec:
            rec.update({'year': 1926, 'county': county, 'source': src, 'table': 'Table 3', 'page': ''})
            out.append(rec)
    return out


def cb_table3(path, cb):
    """Table 3 of a county-borough report: wards (D.E.D.s) of Belfast."""
    rows = list(load(path)['Table 3'].iter_rows(values_only=True))
    out = []
    for r in rows[6:]:
        a = str(r[0]).strip() if r[0] else ''
        if not a:
            continue
        if a.upper().startswith('TOTAL OF COUNTY BOROUGH'):
            rec = {'area_type': 'county_borough', 'name': cb, 'name_printed': a, 'district': ''}
        elif re.match(r'^\d+\s*\.', a):
            ref, name, _ = split_ded_label(a)
            rec = {'area_type': 'ward', 'ref': ref, 'name': name.title(), 'name_printed': a, 'district': cb}
        else:
            continue
        rec.update(values(r, 2))
        rec.update({'year': 1926, 'county': cb, 'source': os.path.basename(path), 'table': 'Table 3', 'page': ''})
        out.append(rec)
    return out


def table4_refs(path):
    """Table 4 (DEDs by poor law union and dispensary district): ref -> persons, males, females,
    for the cross-table check."""
    wb = load(path)
    if 'Table 4' not in wb.sheetnames:
        return {}
    out = {}
    for r in list(wb['Table 4'].iter_rows(values_only=True))[6:]:
        ref = parse_int(r[3]) if len(r) > 3 else None
        lab = str(r[2] or '')
        if ref is None or lab.upper().startswith('TOTAL'):
            continue
        out.setdefault(ref, []).append({'name': lab, 'persons': parse_int(r[8]), 'males': parse_int(r[9]),
                                        'females': parse_int(r[10]), 'prev_persons': parse_int(r[7])})
    return out


def religion(path, county):
    wb = load(path)
    if 'Table 18' not in wb.sheetnames:
        return []
    out = []
    for r in list(wb['Table 18'].iter_rows(values_only=True))[6:]:
        a = str(r[0]).strip() if r[0] else ''
        if a.lower().startswith('analysis'):
            break
        if not a:
            continue
        nums = [parse_int(x) for x in r[1:19]]
        if nums[0] is None:
            continue
        name = strip_notes(re.sub(r'^total of\s+', '', a, flags=re.I))
        if a.lower().startswith('total of'):
            kind = 'county_borough' if 'borough' in a.lower() and 'county and' not in a.lower() else 'county_total'
            if 'county and' in a.lower():
                kind = 'county_and_cb_total'
            name = county if kind == 'county_total' else name
        elif a.lower().endswith('ward'):
            kind = 'ward'
            name = re.sub(r'\s*ward$', '', name, flags=re.I)
        else:
            kind = district_kind(name) or 'district'
        out.append({'year': 1926, 'county': county, 'area_type': kind, 'name_printed': a, 'name': name,
                    'persons': nums[0], 'males': nums[1], 'females': nums[2], 'catholic': nums[3],
                    'presbyterian': nums[6], 'church_of_ireland': nums[9], 'methodist': nums[12],
                    'other_not_stated': nums[15], '_sex': nums, 'source': os.path.basename(path),
                    'table': 'Table 18', 'page': ''})
    return out


def general(path):
    """General report: Table 3 (counties, county boroughs, urban and rural districts, wards of
    county boroughs) and Table VI (1911 and 1926 for each county district)."""
    wb = load(path)
    t3 = []
    county = None
    for r in list(wb['Table 3'].iter_rows(values_only=True))[6:]:
        a, b = (str(x).strip() if x else '' for x in r[:2])
        if not b:
            continue
        if a and a not in ('County Boroughs and Urban Districts', 'Rural Districts'):
            county = strip_notes(a)
        v = values(r, 2)
        t3.append({'county': county, 'label': b, 'name': strip_notes(re.sub(r'^total\s+', '', b, flags=re.I)), **v})
    t6 = {}
    for r in list(wb['Table VI'].iter_rows(values_only=True))[6:]:
        if r[0] and parse_int(r[2]) is not None:
            t6[norm_key(r[0]) + '|' + (district_kind(r[0]) or '')] = (parse_int(r[1]), parse_int(r[2]), str(r[0]))
    return t3, t6


def dkey(name):
    """A county district's key: its name and kind ('Ballycastle' urban and rural differ)."""
    return norm_key(name) + '|' + (district_kind(name) or '')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=SRC)
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()
    os.makedirs(os.path.join(args.out, 'areas'), exist_ok=True)
    os.makedirs(os.path.join(args.out, 'validation'), exist_ok=True)

    areas, rel, checks = [], [], []

    def chk(level, area, variable, status, diff, detail):
        checks.append({'year': 1926, 'check': level, 'area': area, 'variable': variable, 'status': status,
                       'diff': '' if diff is None else diff, 'detail': detail})

    files = sorted(glob.glob(os.path.join(args.src, '*-data-tables.xlsx')))
    t4_by_county = {}
    for path in files:
        base = os.path.basename(path)
        if 'general' in base:
            continue
        county = next(v for k, v in COUNTY_OF_FILE.items() if k in base)
        recs = cb_table3(path, county) if 'belfast' in base else county_table3(path, county)
        # cross-table: Table 4 repeats every DED with its Table 3 serial number
        if 'belfast' not in base:
            t4_by_county[county] = table4_refs(path)
        areas.extend(recs)
        rel.extend(religion(path, county))

    # corrections read from the printed pages (corrections/corrections-1926.csv)
    cpath = os.path.join(args.out, 'corrections', 'corrections-1926.csv')
    if os.path.exists(cpath):
        with open(cpath, encoding='utf-8') as f:
            for c in csv.DictReader(f):
                hit = [a for a in areas if a['county'] == c['county'] and a['area_type'] == c['area_type']
                       and str(a.get('ref') or '') == c['ref'] and norm_key(a['name']) == norm_key(c['name'])]
                if len(hit) != 1 or str(hit[0].get(c['variable'])) != c['old']:
                    raise SystemExit(f'correction does not apply cleanly: {c}')
                hit[0][c['variable']] = int(c['new'])
                hit[0]['note'] = (hit[0].get('note', '') + f"; {c['variable']} corrected {c['old']}->{c['new']} from PDF p.{c['pdf_page']}").strip('; ')

    # cross-table (informational: Table 3 is the one checked against its own totals): Table 4
    # repeats every DED under its poor law union and dispensary district, with its Table 3 number
    for rec in areas:
        t4 = t4_by_county.get(rec['county'], {})
        if rec['area_type'] in ('ded', 'ward') and rec.get('ref') in t4:
            rows4 = t4[rec['ref']]
            for v in ('persons', 'males', 'females'):
                st, diff = check_sum([sum(x[v] or 0 for x in rows4)], rec.get(v))
                chk('table3_vs_table4', f"{rec['county']}|{rec['ref']}. {rec['name']}", v, st, diff,
                    f"Table 4 rows {len(rows4)}")

    # sex checks
    for a in areas:
        st, diff = check_sexes(a.get('persons'), a.get('males'), a.get('females'))
        a['_sex'] = st
        chk('males_plus_females', f"{a['county']}|{a['area_type']}|{a['name']}", 'persons', st, diff, a['table'])

    # DEDs (and wards) to their county district; districts to county; urban/rural subtotals
    by_county = {}
    for a in areas:
        by_county.setdefault(a['county'], []).append(a)
    for county, recs in by_county.items():
        dists = [r for r in recs if r['area_type'] in ('urban_district', 'rural_district', 'county_borough',
                                                        'municipal_borough', 'district')]
        deds = [r for r in recs if r['area_type'] in ('ded', 'ward')]
        for d in dists:
            kids = [x for x in deds if dkey(x['district']) == dkey(d['name'])
                    or (county == 'Belfast County Borough')]
            for v in ('persons', 'males', 'females', 'prev_persons', 'area_acres', 'houses_total'):
                tol = 1 if v == 'area_acres' else 0
                st, diff = check_sum([k.get(v) for k in kids], d.get(v), tol)
                if v == 'area_acres' and diff is not None:
                    diff = round(diff, 3)
                chk('deds_to_district', f"{county}|{d['name']}", v, st, diff, f'{len(kids)} DEDs')
                if v in ('persons', 'males', 'females'):
                    d.setdefault('_sum', []).append(st)
                    for k in kids:
                        k.setdefault('_sum', []).append(st)
        tot = next((r for r in recs if r['area_type'] in ('county_total', 'county_borough')
                    and county != 'Londonderry' or r['area_type'] == 'county_total'), None)
        if county == 'Londonderry':
            tot = next((r for r in recs if r['area_type'] == 'county_and_cb_total'), None)
        if tot and county != 'Belfast County Borough':
            for v in ('persons', 'males', 'females', 'prev_persons'):
                st, diff = check_sum([d.get(v) for d in dists], tot.get(v))
                chk('districts_to_county', county, v, st, diff, f'{len(dists)} districts')
                tot.setdefault('_sum', []).append(st)
        for sub, kind in (('urban_total', ('urban_district', 'municipal_borough')), ('rural_total', ('rural_district',))):
            s = next((r for r in recs if r['area_type'] == sub), None)
            if s:
                st, diff = check_sum([d.get('persons') for d in dists if d['area_type'] in kind], s.get('persons'))
                chk('districts_to_urban_rural_total', f'{county}|{sub}', 'persons', st, diff, '')
        # towns: a town (or the part of a town) inside a DED cannot exceed the DED
        for t in (r for r in recs if r['area_type'] in ('town', 'town_part')):
            ded = next((x for x in deds if x.get('ref') == t.get('ref') and dkey(x['district']) == dkey(t['district'])), None)
            if ded and t.get('persons') is not None:
                st = 'ok' if t['persons'] <= (ded.get('persons') or 0) else 'fail'
                chk('town_within_ded', f"{county}|{t['name']}", 'persons', st, (t['persons'] - (ded.get('persons') or 0)) if st == 'fail' else 0, f"DED {t.get('ref')}")
                t.setdefault('_sum', []).append(st)

    # counties to NI
    county_rows = [r for r in areas if (r['area_type'] == 'county_total' and r['county'] != 'Londonderry')
                   or (r['area_type'] == 'county_and_cb_total') or (r['area_type'] == 'county_borough' and r['county'] == 'Belfast County Borough')]
    st, diff = check_sum([r['persons'] for r in county_rows], NI_TOTAL)
    chk('counties_to_ni', 'Northern Ireland', 'persons', st, diff, f'{len(county_rows)} counties/CBs vs explorer-bundle total')

    # the general report's Table 3 and Table VI against the county reports
    gpath = next((f for f in files if 'general' in os.path.basename(f)), None)
    if gpath:
        t3, t6 = general(gpath)
        ni = next((r for r in t3 if r['label'].upper() == 'TOTAL NORTHERN IRELAND'), None)
        if ni:
            st, diff = check_sum([ni['persons']], NI_TOTAL)
            chk('general_t3_ni', 'Northern Ireland', 'persons', st, diff, 'General report Table 3')
        dist_index = {}
        for a in areas:
            if a['area_type'] in ('urban_district', 'rural_district', 'county_borough', 'ward', 'municipal_borough'):
                if a['area_type'] == 'ward' and a['county'] not in ('Belfast County Borough',) and 'Londonderry County Borough' not in a['district']:
                    continue
                dist_index.setdefault(norm_key(a['name']) + '|' + a['area_type'], []).append(a)
        for g in t3:
            kind = district_kind(g['name']) or ('ward' if g['name'].lower().endswith('ward') else None)
            if not kind:
                continue
            nm = re.sub(r'\s*ward$', '', g['name'], flags=re.I)
            hits = dist_index.get(norm_key(nm) + '|' + kind, [])
            if len(hits) > 1:
                hits = [h for h in hits if norm_key(h['county']) in norm_key(g['county'] or '') or norm_key(g['county'] or '') in norm_key(h['county'])] or hits
            if not hits:
                chk('general_t3_vs_county', f"{g['county']}|{g['name']}", 'persons', 'na', None, 'no county-report row')
                continue
            for v in ('persons', 'males', 'females', 'prev_persons'):
                st, diff = check_sum([hits[0].get(v)], g.get(v))
                chk('general_t3_vs_county', f"{g['county']}|{g['name']}", v, st, diff, 'General report Table 3')
        for key, (p11, p26, label) in t6.items():
            hits = dist_index.get(key, [])
            if hits:
                st, diff = check_sum([hits[0].get('persons')], p26)
                chk('general_tVI_1926', label, 'persons', st, diff, 'General report Table VI')
                st, diff = check_sum([hits[0].get('prev_persons')], p11)
                chk('general_tVI_1911', label, 'prev_persons', st, diff, 'General report Table VI (1911 reprint)')

    # religion: components add to the total, the sexes add, and the persons agree with Table 3
    for r in rel:
        n = r.pop('_sex')
        comps = [n[3], n[6], n[9], n[12], n[15]]
        st1, d1 = check_sum(comps, r['persons'])
        st2, d2 = check_sum([n[4], n[7], n[10], n[13], n[16]], r['males'])
        st3, d3 = check_sum([n[5], n[8], n[11], n[14], n[17]], r['females'])
        st4, d4 = check_sexes(r['persons'], r['males'], r['females'])
        sts = [st1, st2, st3, st4]
        for i in range(5):
            s, d = check_sum([n[3 + 3 * i + 1], n[3 + 3 * i + 2]], n[3 + 3 * i])
            sts.append(s)
        match = [a for a in areas if a['county'] == r['county'] and norm_key(a['name']) == norm_key(r['name'])
                 and a['area_type'] == r['area_type']]
        if match:
            s5, d5 = check_sum([match[0]['persons']], r['persons'])
            sts.append(s5)
            chk('religion_vs_table3', f"{r['county']}|{r['name']}", 'persons', s5, d5, '')
        else:
            chk('religion_vs_table3', f"{r['county']}|{r['name']}", 'persons', 'na', None, 'no Table 3 row')
        chk('religion_components', f"{r['county']}|{r['name']}", 'all', 'fail' if 'fail' in sts else 'ok',
            d1, f'components {st1}, males {st2}, females {st3}, sexes {st4}')
        r['status'] = 'fail' if 'fail' in sts else 'ok'
        r['key'] = norm_key(r['name'])

    for county in {r['county'] for r in rel}:
        rr = [r for r in rel if r['county'] == county]
        tot = next((r for r in rr if r['area_type'] in ('county_total',)), None) or next((r for r in rr if r['area_type'] == 'county_borough'), None)
        parts = [r for r in rr if r['area_type'] in ('urban_district', 'rural_district', 'municipal_borough', 'district')]
        if tot is None or not parts:
            parts = [r for r in rr if r['area_type'] == 'ward']
        if tot and parts:
            for v in ('persons', 'catholic', 'presbyterian', 'church_of_ireland', 'methodist', 'other_not_stated'):
                st, diff = check_sum([p[v] for p in parts], tot[v])
                chk('religion_districts_to_county', f'{county}|{tot["name"]}', v, st, diff, f'{len(parts)} areas')
                if st == 'fail':
                    tot['status'] = 'fail'
        cb = next((r for r in rr if r['area_type'] == 'county_borough' and county == 'Londonderry'), None)
        if cb:
            wards = [r for r in rr if r['area_type'] == 'ward']
            for v in ('persons', 'catholic'):
                st, diff = check_sum([p[v] for p in wards], cb[v])
                chk('religion_wards_to_cb', 'Londonderry County Borough', v, st, diff, f'{len(wards)} wards')

    for a in areas:
        sts = [a.pop('_sex', None)] + a.pop('_sum', [])
        a['status'] = 'fail' if 'fail' in sts else ('ok' if 'ok' in sts else 'na')
        a['key'] = norm_key(a['name'])
        a['prev_year'] = 1911

    with open(os.path.join(args.out, 'areas', 'areas-1926.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, AREA_COLS, extrasaction='ignore')
        w.writeheader()
        w.writerows(areas)
    with open(os.path.join(args.out, 'areas', 'religion-1926.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, REL_COLS, extrasaction='ignore')
        w.writeheader()
        w.writerows(rel)
    with open(os.path.join(args.out, 'validation', 'checks-1926.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, ['year', 'check', 'area', 'variable', 'status', 'diff', 'detail'])
        w.writeheader()
        w.writerows(checks)
    from collections import Counter
    c = Counter((x['check'], x['status']) for x in checks)
    for k in sorted(c):
        print(f'{k[0]:32} {k[1]:5} {c[k]}')
    t = Counter((a['area_type'], a['status']) for a in areas)
    for k in sorted(t):
        print(f'areas {k[0]:22} {k[1]:5} {t[k]}')
    print('religion rows', len(rel), Counter(r['status'] for r in rel))


if __name__ == '__main__':
    main()
