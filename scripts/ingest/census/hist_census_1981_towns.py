#!/usr/bin/env python3
"""The 1981 census's town figures: Summary Report Table 4A, 'Population, Dwellings and Private
Households: Towns with 1,000 or more Population within Local Government Districts' (pages 11-12
of the Summary Report; pages 61-62 of the owner's combined 1981 PDF, holdings register section 3).

After the 1973 reorganisation no town had a legal boundary; for 1981 the Registrar General
defined each town of 1,000 or more people from Irish Grid squares (Summary Report, explanatory
notes). The table prints no totals, so each row is checked against itself: males + females =
persons. Only the three population columns are taken (the dwelling and household columns are not
needed, and the text layer places some of their figures badly).

The rows are read from the PDF's text layer: words are put on printed lines by their height and
in columns by the column rules (midway between the column headings). Writes
<out>/areas/towns-1981.csv (one row per town, with district, page and status).
Usage: python scripts/ingest/census/hist_census_1981_towns.py [--pdf PDF] [--out DIR]
"""
import argparse
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

PDF_NAME = '1981-census-all-combined.pdf'   # in the report folder (hist_census_paths.REPORTS)
PAGES = (61, 62)   # 1-based, in the combined PDF
HEADINGS = ('Persons', 'Males', 'Females', 'Occupier', 'Vacant', 'Number', 'Population', 'Rooms')
# the text layer's misreadings of names, each checked against the page image
NAME_FIXES = {'Newry and bourne': 'Newry and Mourne', 'Anna long': 'Annalong', 'Clouqhreagh': 'Cloughreagh',
              'Kilkee!': 'Kilkeel', 'Lame': 'Larne'}
COLS = ('persons', 'males', 'females', 'occupier_absent', 'vacant', 'households', 'household_population', 'rooms')


def column_bounds(centres):
    """Column rules midway between the column headings' centres (left to right)."""
    return [(a + b) / 2 for a, b in zip(centres, centres[1:])]


def table_lines(words, name_max_x, bounds, y_tol=3.0, join_gap=2.5):
    """Printed lines of a table from PDF words (x0, y0, x1, y1, text): the words left of
    name_max_x make the line's name (with its indent, x0); the others go to the line whose name
    is nearest in height (within y_tol); touching words (gap under join_gap) are one printed
    figure, placed in the column its centre falls in (bounds: the column rules). Returns [{'name', 'x0', 'y', 'cells': [str per column]}] top to bottom."""
    names = []
    for w in sorted(words, key=lambda w: (round((w[1] + w[3]) / 2, 1), w[0])):
        if w[0] >= name_max_x:
            continue
        y = (w[1] + w[3]) / 2
        if names and abs(names[-1]['y'] - y) <= 1.5:
            names[-1]['name'] += ' ' + w[4]
            names[-1]['x0'] = min(names[-1]['x0'], w[0])
        else:
            names.append({'name': w[4], 'x0': w[0], 'y': y, 'parts': []})
    for w in words:
        if w[0] < name_max_x or not names:
            continue
        y = (w[1] + w[3]) / 2
        line = min(names, key=lambda n: abs(n['y'] - y))
        if abs(line['y'] - y) > y_tol:
            continue
        line['parts'].append([w[0], w[2], w[4]])
    out = []
    for n in names:
        n['name'] = NAME_FIXES.get(n['name'].strip(), n['name'].strip())
        # the pieces of one printed figure ('1', ',708') touch: join them before placing
        merged = []
        for p in sorted(n['parts']):
            if merged and p[0] - merged[-1][1] < join_gap:
                merged[-1][1], merged[-1][2] = p[1], merged[-1][2] + p[2]
            else:
                merged.append(list(p))
        cells = [''] * (len(bounds) + 1)
        for x0, x1, t in merged:
            cells[sum(1 for b in bounds if (x0 + x1) / 2 > b)] += t
        out.append({'name': n['name'], 'x0': n['x0'], 'y': n['y'], 'cells': cells})
    return out


def cell_count(s):
    """A printed count from a cell's text ('1 ,708', 'I,708', '-'): None for a dash or blank."""
    s = re.sub(r'(?<![A-Za-z])[Il|](?![A-Za-z])', '1', s.replace(' ', ''))
    s = s.strip(';:')
    if s in ('', '-', '–', '—'):
        return None
    d = re.sub(r'[,.](?=\d{3}$)|[,.](?=\d{3}[,.])', '', s)   # '8.245': a comma read as a point
    return int(d) if re.fullmatch(r'\d+', d) else None


def town_rows(lines, page, indent_gap=4.0):
    """Towns under their district headings: a heading is a line with no figures; a town is an
    indented line with figures."""
    out, district = [], ''
    for ln in lines:
        vals = [cell_count(c) for c in ln['cells']]
        if not any(c.strip() for c in ln['cells']):
            if ln['name'] and ln['name'] not in ('Towns', 'Towns r'):
                district = ln['name']
            continue
        r = {'year': 1981, 'district': district, 'name': ln['name'], 'page': page}
        r.update(dict(zip(COLS, vals)))
        checks = []
        if None in (r['persons'], r['males'], r['females']):
            checks.append('unreadable')
        elif r['males'] + r['females'] != r['persons']:
            checks.append(f"sexes {r['males'] + r['females'] - r['persons']:+d}")
        r['status'] = 'ok' if not checks else 'fail: ' + '; '.join(checks)
        out.append(r)
    return out


def main():
    import pymupdf
    from hist_census_crosswalk import OUT, write_csv
    ap = argparse.ArgumentParser()
    from hist_census_paths import REPORTS
    ap.add_argument('--pdf', default=os.path.join(REPORTS, PDF_NAME))
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()
    doc = pymupdf.open(args.pdf)
    rows = []
    for p in PAGES:
        words = [tuple(w[:5]) for w in doc[p - 1].get_text('words')]
        top = [w for w in words if w[4] in HEADINGS and w[1] > 100]
        heads = {}
        for w in sorted(top, key=lambda w: w[1], reverse=True):   # the lower 'Population' is the column's
            heads.setdefault(w[4], (w[0] + w[2]) / 2)
        centres = sorted(heads[h] for h in HEADINGS)
        y0 = max(w[3] for w in top)
        body = [w for w in words if w[1] > y0 + 2 and not re.fullmatch(r'\d+', w[4]) or (w[1] > y0 + 2 and w[0] > 150)]
        body = [w for w in body if w[1] < 760]    # the page number and marginal notes below the table
        rows += town_rows(table_lines(body, 150, column_bounds(centres)), p)
    src = f'1981 Census Summary Report, Table 4A ({os.path.basename(args.pdf)} pp. {PAGES[0]}-{PAGES[-1]})'
    for r in rows:
        r['source'] = src
    write_csv(os.path.join(args.out, 'areas', 'towns-1981.csv'), rows,
              ['year', 'district', 'name', 'persons', 'males', 'females', 'page', 'status', 'source'])
    bad = [r for r in rows if r['status'] != 'ok']
    print('towns', len(rows), 'districts', len({r['district'] for r in rows}), 'persons', sum(r['persons'] or 0 for r in rows),
          'failing', len(bad))
    for r in bad:
        print('  ', r['district'], r['name'], r['persons'], r['males'], r['females'], r['status'])


if __name__ == '__main__':
    main()
