#!/usr/bin/env python3
"""Parse the OCR text of the 1937, 1951 and 1961 county and county-borough reports' area tables
(Table 4: county, districts, DEDs or wards, towns) into one row per area, and check each table
against its own printed totals.

Reads <out>/ocr/<year>/*.txt (hist_census_ocr.py) for the pages in hist-census-pages.json.
Applies <out>/corrections/corrections-<year>.csv (values re-read from the page images) and
writes:
    areas/areas-<year>.csv           one row per area, with its verdict
    validation/checks-<year>.csv     every check
    validation/unparsed-<year>.csv   OCR records with no persons = males + females, for re-reading
Usage: python scripts/ingest/census/hist_census_parse.py --year 1937 [--out DIR]
"""
import argparse
import csv
import json
import os
import re
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from hist_census_lib import check_sum, district_kind, norm_key, to_count  # noqa: E402

from hist_census_paths import OUT  # noqa: E402
AREA_COLS = ['year', 'county', 'area_type', 'ref', 'name_printed', 'name', 'ward', 'district', 'key',
             'persons', 'males', 'females', 'prev_year', 'prev_persons', 'area_acres', 'houses_total',
             'houses_inhabited', 'source', 'table', 'page', 'status', 'note']

# Where the persons column falls among a row's numbers, and the year the 'previous census'
# column holds. 1937: acres, 1926, persons, males, females. 1951 and 1961: acres, roods,
# perches, previous census, persons, males, females.
LAYOUT = {'1937': {'triple_at': (1, 3), 'prev_year': 1926, 'readings': ['', 'b', 'c']},
          '1951': {'triple_at': (1, 6), 'prev_year': 1937},
          '1961': {'triple_at': (1, 6), 'prev_year': 1951, 'wards_unnumbered': True,
                   'readings': ['p', '', 'b', 'c']}}

DIGITISH = {'O': '0', 'o': '0', 'D': '0', 'Q': '0', 'l': '1', 'I': '1', 'i': '1', '|': '1', 'R': '2', 'Z': '2',
            'z': '2', 'B': '8', 'S': '5', '$': '5', 's': '5', 'G': '6', 'b': '6', 'g': '9', 'q': '9', 'A': '4',
            'T': '7', '?': '7', '&': '8', '§': '5'}


def normalise_line(line, join_spaced_thousands=True):
    """Mend the OCR's number shapes: '1, 490' -> '1,490'; '1 ,490' -> '1,490'; a letter that
    stands for a digit inside a number ('R,O57' -> '2,057', '3, 46O' -> '3,460'); a column rule
    glued to a number ('1,234]' -> '1,234 ')."""
    s = line.replace('\u2014', '-').replace('\u2013', '-').replace('\u2019', "'")
    if join_spaced_thousands:
        # the 1951 and 1961 tables are typed with a space after the thousands comma ('1, 490');
        # the 1937 ones are not, and there '974, 496' is two numbers
        s = re.sub(r'(\d)\s*,\s+(\d{3})(?!\d)', r'\1,\2', s)
        s = re.sub(r'(\d)\s+,(\d{3})(?!\d)', r'\1,\2', s)

    def fix(m):
        tok = m.group(0)
        return ''.join(DIGITISH.get(c, c) for c in tok)
    # a token of digits with at most two digit-like letters and at least two real digits
    s = re.sub(r'(?<![A-Za-z])(?=[^\s]*\d[^\s]*\d)[0-9ORBSZDQlIoGg$&§,]{2,9}(?![A-Za-z])', fix, s)
    s = re.sub(r'(?<=\d)[\]\}\)\|;:!\'"/](?=\s|$|\d)', ' ', s)
    s = re.sub(r'(?<=\s)[\[\{\(\|](?=\d)', ' ', s)
    s = re.sub(r'(?<=\d)[fFj%*](?=\s|$)', ' ', s)
    return s


def numbers(line):
    """Counts in a normalised line, in order ('0.98' ratios dropped; '1.234' read as 1234)."""
    out = []
    for m in re.finditer(r'(?<![\w.,])\d{1,3}(?:,\d{3})+(?!\d)(?!,\d)|(?<![\w.,])\d+(?:\.\d+)?(?!\w)(?!,\d)', line):
        tok = m.group(0)
        if re.fullmatch(r'\d+\.\d{1,2}', tok):
            continue
        n = to_count(tok.replace('.', ',')) if re.fullmatch(r'\d{1,3}\.\d{3}', tok) else to_count(tok)
        if n is not None:
            out.append((n, m.start()))
    return out


def variants(n):
    """n itself, then n with a stray first or last digit dropped (a column rule read as '1' or '7'
    next to the number): 10191 -> 1019, 9899 -> 899."""
    s = str(n)
    out = [n]
    if len(s) >= 3:
        out += [int(s[:-1]), int(s[1:])]
    if len(s) >= 2:
        # the 1961 typeface: a '1' read as '4' ('4,135' for 1,135), or a '4' added ('414,904')
        for i, ch in enumerate(s):
            if ch == '4':
                out.append(int(s[:i] + '1' + s[i + 1:]))
    return [v for k, v in enumerate(out) if v not in out[:k]]


def repair_triple(nums, lo, hi):
    """Like find_triple, but allows one of the three counts to carry one stray digit. Returns
    (i, persons, males, females, which) or None. Only used when find_triple finds nothing; the
    row is marked as repaired and still has to pass the district sums."""
    found = []
    names = ('persons', 'males', 'females')
    for i in range(lo, min(hi, len(nums) - 3) + 1):
        p, m, f = nums[i], nums[i + 1], nums[i + 2]
        for k in range(3):
            for alt in variants((p, m, f)[k])[1:]:
                t = [p, m, f]
                t[k] = alt
                if t[0] > 0 and t[1] > 0 and t[2] > 0 and t[0] == t[1] + t[2]:
                    found.append((i, t[0], t[1], t[2], names[k]))
    if not found:
        # two of the three misread (the 1961 typeface)
        for i in range(lo, min(hi, len(nums) - 3) + 1):
            p, m, f = nums[i], nums[i + 1], nums[i + 2]
            for a, b in ((0, 1), (0, 2), (1, 2)):
                for va in variants((p, m, f)[a])[1:]:
                    for vb in variants((p, m, f)[b])[1:]:
                        t = [p, m, f]
                        t[a], t[b] = va, vb
                        if min(t) > 0 and t[0] == t[1] + t[2] and t[1] > 0.3 * t[0] and t[2] > 0.3 * t[0]:
                            found.append((i, t[0], t[1], t[2], f'{names[a]} and {names[b]}'))
    uniq = {(x[0], x[1], x[2], x[3]) for x in found}
    return found[0] if len(uniq) == 1 else None


def find_triple(nums, lo, hi):
    """Index i (lo <= i <= hi) with nums[i] = nums[i+1] + nums[i+2] (persons, males, females),
    nums[i] > 0, preferring the earliest. None if there is none."""
    for i in range(lo, min(hi, len(nums) - 3) + 1):
        p, m, f = nums[i], nums[i + 1], nums[i + 2]
        if p > 0 and p == m + f and m > 0 and f > 0:
            return i
    return None


def label_of(text):
    s = re.sub(r'[^A-Za-z0-9.,()\'&\- ]', ' ', text)
    return re.sub(r'\s+', ' ', s).strip(' .,-')


def records(lines, join_spaced_thousands=True):
    """Group OCR lines into table rows: a row ends on a line holding at least five counts; the
    text before it since the previous row (a name wrapped over lines) is its label."""
    pending, out = [], []
    for raw in lines:
        line = normalise_line(raw, join_spaced_thousands)
        # 'Newry No. 1 Rural District': the number of a numbered district is part of its name
        nums = [(n, pos) for n, pos in numbers(line) if not re.search(r'\bNo\.?\s*$', line[:pos])]
        # a serial number before the name ('19. Clifton') is part of the label, not a count
        ma = re.search(r'[A-Za-z]{2}', line)
        lead = [n for n, pos in nums if ma and pos < ma.start()] if ma else []
        if lead and len(nums) - len(lead) >= 5:
            nums = nums[len(lead):]
        if len(nums) >= 5:
            first = nums[0][1]
            text = line[:first]
            if lead:
                text = f'{lead[-1]}. ' + line[ma.start():first]
            label = ' '.join(pending + [text])
            out.append({'label': label_of(label), 'nums': [n for n, _ in nums], 'raw': raw.rstrip()})
            pending = []
        else:
            t = label_of(line)
            if re.search(r'(RURAL|URBAN) DISTRICT|BOROUGH', t, re.I) and re.search(r'cont', t, re.I):
                # 'Armagh Rural District - continued' at the head of a page: a heading, not a row
                out.append({'label': re.sub(r'\s*-?\s*cont\w*\.?.*$', '', t, flags=re.I), 'nums': [], 'raw': raw.rstrip(),
                            'heading': True})
                pending = []
                continue
            if t and len(re.sub(r'[^A-Za-z]', '', t)) >= 3:
                pending.append(t)
            if len(pending) > 3:
                pending = pending[-3:]
    return out


TOWN = re.compile(r'\b[TtFf][oO0][wWuU][nN]\b|\bTown\b')


def classify(label):
    """(area_type, ref, name) for a row label, or (None, ...) for a townland or noise."""
    # misreads of the heading words ('Paral District', 'Utban', 'Distriot', 'Boroug!')
    s = re.sub(r'\b[PpRrKk][ua]r?a[l1]\b(?=\W+Dist)', 'Rural', label)
    s = re.sub(r'\bU[rt]b[ae]n\b', 'Urban', s)
    s = re.sub(r'\bD\s?i\s?s\s?t\s?r\s?i\s?[co]\s?t\b', 'District', s)
    s = re.sub(r'^\W*A[l1I]\b', 'All', s)
    s = re.sub(r'\bBoroug\w*', 'Borough', s)
    s = re.sub(r'\b(Urban|Rural|Municipal|County)\b(?:\W+\w{1,3}){0,2}\W+(District|Borough)\b', r'\1 \2', s,
               flags=re.I)
    up = s.upper()
    if re.search(r'\bTOTAL OF COUNTY\b|^COUNTY [A-Z]|\bCOUNTY\s*$|COUNTY BOROUGH OF|^ANTRIM COUNTY|^(ARMAGH|DOWN|FERMANAGH|TYRONE|LONDONDERRY) COUNTY', up) and 'DISTRICT' not in up:
        return 'county_total', None, s
    if re.search(r'\bALL\b.*\b(URBAN|MUNICIPAL)', up) or re.match(r'^(ALL )?URBAN DISTRICTS?$', up):
        return 'urban_total', None, 'Urban'
    if re.search(r'\bALL\b.*\bRURAL', up):
        return 'rural_total', None, 'Rural'
    m = re.search(r'([A-Za-z][A-Za-z0-9 .\']+?)\s+(URBAN DISTRICT|RURAL DISTRICT|MUNICIPAL BOROUGH|COUNTY BOROUGH)\b', s, re.I)
    if m and not re.match(r'^\s*\d', s):
        words = m.group(1).split()
        stop = {'ACRES', 'A', 'AD', 'DISTRICTS', 'DISTRICT', 'RURAL', 'URBAN', 'AND', 'MUNICIPAL', 'BOROUGHS',
                'BOROUGH', 'ALL', 'OF', 'COUNTY', 'CONTINUED', 'CONTD', 'TOTAL', 'OS', 'OE', 'EAE', 'EE', 'ES', 'LIES',
                'FAMI', 'HABITED'}
        keep = []
        for w in reversed(words):
            if w.upper().strip('.,') in stop:
                break
            keep.insert(0, w)
            if len(keep) == 3 and not re.match(r'^(no\.?|\d+)$', keep[0], re.I):
                break
        if keep and re.fullmatch(r'\d+', keep[0]) and len(keep) == 1:
            keep = words[-3:]
        nm = re.sub(r'\bNo\.?\s*(\d)', r'No. \1', ' '.join(keep) or m.group(1).strip())
        kind = m.group(2).lower().replace(' ', '_')
        return kind, None, f'{nm.title()} {m.group(2).title()}'
    m = re.match(r'^\D{0,6}?(\d{1,3})\s*[.,]?[\s\-\'"’”]*([A-Za-z].+)$', s)
    if m and re.search(r'[A-Za-z]{3}', m.group(2)):
        rest = m.group(2)
        if TOWN.search(rest) and 'D E D' not in rest.upper().replace('.', ' ') and 'DED' not in rest.upper():
            return 'town', None, rest
        rest = re.sub(r'\bD\.?\s*E\.?\s*D\.?|\bDED\b|\bD E D\b', ' ', rest, flags=re.I)
        return 'ded', int(m.group(1)), re.sub(r'\s+', ' ', rest).strip(' .,')
    if TOWN.search(s):
        return 'town', None, s
    if re.search(r'\bWard\b', s, re.I):
        return 'ward', None, re.sub(r'\bWard\b', '', s, flags=re.I).strip()
    return None, None, s


def page_rows(year, county, report, page, text):
    """The rows of one reading of one page."""
    lay = LAYOUT[year]
    rows = []
    section = None
    for rec in records(text.splitlines(), year != '1937'):
        if re.match(r'^\W{0,3}\(?[a-z]\)\s|^\W{0,3}since\b|.*\bformerly\b|.*\bwas transferred\b|.*\bhas been altered\b'
                    r'|.*\bportion of\b|.*\bpopulation of\b|.*\bExclusive of\b|.*\bExcluding\b', rec['label'], re.I):
            continue   # a footnote
        kind, ref, name = classify(rec['label'])
        if kind in DISTRICT_TYPES:
            section = kind
        elif kind in ('rural_total', 'urban_total', 'county_total'):
            section = None
        if kind is None and lay.get('wards_unnumbered') and section in ('urban_district', 'municipal_borough', 'county_borough') \
                and len(re.sub(r'[^A-Za-z]', '', rec['label'])) >= 3 and not rec.get('heading'):
            # 1961: the wards of a borough or urban district are printed by name alone ('North
            # Ward', then ditto marks)
            kind, name = 'ward', re.sub(r'\bWard\b', '', rec['label'], flags=re.I).strip(' .,"')
        if kind is None:
            continue
        if rec.get('heading'):
            if kind in ('urban_district', 'rural_district', 'municipal_borough', 'county_borough'):
                rows.append({'area_type': 'heading', 'name': name, 'ref': None, 'page': page, 'name_printed': rec['label'],
                             'note': '', 'county': county, 'year': int(year)})
            continue
        nums = rec['nums']
        i = find_triple(nums, *lay['triple_at'])
        repaired = None
        if i is None:
            rep = repair_triple(nums, *lay['triple_at'])
            if rep:
                i = rep[0]
                nums = list(nums)
                nums[i], nums[i + 1], nums[i + 2] = rep[1], rep[2], rep[3]
                repaired = rep[4]
        base = {'year': int(year), 'county': county, 'area_type': kind, 'ref': ref, 'name_printed': rec['label'],
                'name': name, 'source': report, 'table': 'Table 4', 'page': page, 'prev_year': lay['prev_year'],
                'note': f'OCR {repaired} had a stray digit; repaired by persons = males + females' if repaired else '',
                'raw': rec['raw']}
        if i is not None:
            base.update({'persons': nums[i], 'males': nums[i + 1], 'females': nums[i + 2],
                         'prev_persons': nums[i - 1] if i >= 1 else None})
            if year == '1937' and i >= 2:
                base['area_acres'] = nums[i - 2]
            elif i >= 4:
                base['area_acres'] = nums[i - 4]
        else:
            base['status'] = 'unparsed'
        rows.append(base)
    return rows


def row_key(r):
    if r['area_type'] == 'ded' and r.get('ref'):
        return ('ded', r['ref'])
    return (r['area_type'], norm_key(r['name']))


def good(r):
    return r.get('persons') is not None or r['area_type'] == 'heading'


def clean_ocr_name(name):
    """An OCR'd area name without the debris read with it: tokens holding digits (other than a
    'No. 1'), stray one- and two-letter tokens, ditto marks and 'or Ward'."""
    s = re.sub(r'\bor\s+Ward\b|\bWard\b', ' ', name or '', flags=re.I)
    toks = s.replace(',', ' ').split()
    out = []
    for i, t in enumerate(toks):
        if re.search(r'\d', t) and not (i > 0 and re.match(r'^no\.?$', toks[i - 1], re.I)):
            continue
        if len(t.strip('.\'-')) <= 2 and not re.match(r'^(no\.?|st\.?)$', t, re.I):
            continue
        out.append(t.strip('.,-_'))
    return ' '.join(x for x in out if x)


def similar(a, b):
    import difflib
    return difflib.SequenceMatcher(None, norm_key(a), norm_key(b)).ratio()


def merge_readings(main, alts):
    """The main reading's rows (serials and district names already reconciled), with a row the
    main reading could not parse, or parsed only by repairing a digit, taken from another reading
    of the same row: the same DED serial with a similar name, or the same district. A DED only
    another reading found is added when its serial is missing from the main reading, its name is
    not already there, and the DED before it is."""
    out = [dict(r) for r in main]
    for idx, r in enumerate(out):
        if r['area_type'] == 'heading':
            continue
        cands = []
        for alt in alts:
            for a in alt:
                if not good(a) or a['area_type'] != r['area_type'] or a['area_type'] == 'heading':
                    continue
                if r['area_type'] == 'ded':
                    if a.get('ref') == r.get('ref') and (similar(a['name'], r['name']) >= 0.5 or len(norm_key(r['name'])) < 4):
                        cands.append(a)
                elif similar(a['name'], r['name']) >= 0.85:
                    cands.append(a)
        # every distinct reading of the row's counts, for reconcile_by_district
        vals = ([(r['persons'], r['males'], r['females'])] if good(r) and r.get('persons') is not None else []) + \
            [(a['persons'], a['males'], a['females']) for a in cands if a.get('persons') is not None]
        out[idx]['readings'] = list(dict.fromkeys(vals))
        if good(r) and not r['note']:
            continue
        cands.sort(key=lambda a: bool(a['note']))
        if cands and (not good(r) or not cands[0]['note']):
            keep = {k: r[k] for k in ('name_printed', 'name', 'ref', 'area_type', 'page', 'readings')}
            out[idx] = dict(cands[0], **keep)
            out[idx]['note'] = (cands[0]['note'] + '; ' if cands[0]['note'] else '') + 'from a second reading of the page'
            out[idx].pop('status', None)
    main_refs = {r.get('ref') for r in out if r['area_type'] == 'ded'}
    main_names = [r['name'] for r in out if r['area_type'] == 'ded']
    for alt in alts:
        for a in alt:
            if a['area_type'] != 'ded' or not good(a) or a.get('ref') in main_refs or a.get('ref') is None:
                continue
            if any(similar(a['name'], n) >= 0.75 for n in main_names):
                continue
            pos = next((i for i, r in enumerate(out) if r['area_type'] == 'ded' and r.get('ref') == a['ref'] - 1), None)
            if pos is None:
                continue
            out.insert(pos + 1, dict(a, note=(a['note'] + '; ' if a['note'] else '') + 'only in a second reading of the page'))
            main_refs.add(a['ref'])
            main_names.append(a['name'])
    return out


def parse_table4(year, county, report, pages, out, canonical=None, chk=None, pinned_lead=None):
    """pinned_lead: the reading the corrections file was written against (hist-census-pages.json
    'lead'), so that a new reading cannot re-order the rows under the corrections."""
    """All readings of a county's Table 4 pages, each reconciled (district names, DED serials),
    then merged."""
    stem = os.path.splitext(report)[0]
    order = LAYOUT[year].get('readings', ['', 'b', 'c', 'p'])
    readings = {k: [] for k in order}
    for page in pages:
        for name in readings:
            txt = os.path.join(out, 'ocr', year, f'{stem}-p{page:03d}' + (f'.{name}' if name else '') + '.txt')
            if os.path.exists(txt):
                with open(txt, encoding='utf-8') as f:
                    readings[name].extend(page_rows(year, county, report, page, f.read()))
    notes = {}
    for name, rows in readings.items():
        notes[name] = (reconcile_districts(rows, canonical), smooth_serials(rows))
    # each reading in turn leads (its rows and their order), the others fill its gaps; the county
    # takes the merge with the most DEDs in districts whose DEDs add up to the printed district
    best = None
    pinned = (pinned_lead,) if pinned_lead is not None and readings.get(pinned_lead) else None
    for lead in pinned or [k for k in order if readings[k]]:
        rows = merge_readings(readings[lead], [readings[k] for k in order if k != lead])
        reconcile_by_district(rows)
        sc = validated_deds(rows)
        if best is None or sc > best[0]:
            best = (sc, lead, rows)
    if best is None:
        return [], []
    _, lead, rows = best
    if chk:
        chk('lead_reading', county, 'reading', 'note', None, lead or 'tesseract 300 dpi')
        for n in notes[lead][0]:
            chk('district_names', county, 'name', 'note', None, n)
        if notes[lead][1]:
            chk('ded_serials_smoothed', county, 'ref', 'note', notes[lead][1], 'serials taken from their neighbours')
    return rows, [r for r in rows if not good(r)]


def reconcile_by_district(rows, cap=200000):
    """Where a district's DEDs do not add up, choose among the readings of each DED row the
    combination whose persons, males and females add to the district's printed figures. Applied
    only when every such combination agrees on each row's values (a unique answer); the rows so
    settled are noted. Returns the number of rows changed."""
    import itertools
    rows_d = [dict(r) for r in rows]
    assign_districts(rows_d)
    changed = 0
    for d in [r for r in rows_d if r['area_type'] in DISTRICT_TYPES and r.get('persons') is not None]:
        kids = [i for i, k in enumerate(rows_d) if k.get('district') == d['name'] and k['area_type'] in ('ded', 'ward')]
        if not kids:
            continue
        cur = [rows[i].get('persons') for i in kids]
        if all(c is not None for c in cur) and sum(cur) == d['persons']:
            continue
        opts = []
        for i in kids:
            o = rows[i].get('readings') or []
            if rows[i].get('persons') is not None and (rows[i]['persons'], rows[i]['males'], rows[i]['females']) not in o:
                o = [(rows[i]['persons'], rows[i]['males'], rows[i]['females'])] + o
            opts.append(o)
        if any(not o for o in opts):
            continue
        n = 1
        for o in opts:
            n *= len(o)
        if n > cap or n == 1:
            continue
        target = (d['persons'], d.get('males'), d.get('females'))
        sols = [combo for combo in itertools.product(*opts)
                if sum(c[0] for c in combo) == target[0]
                and (target[1] is None or sum(c[1] for c in combo) == target[1])
                and (target[2] is None or sum(c[2] for c in combo) == target[2])]
        if not sols:
            continue
        for j, i in enumerate(kids):
            vals = {s[j] for s in sols}
            if len(vals) == 1:
                v = vals.pop()
                if (rows[i].get('persons'), rows[i].get('males'), rows[i].get('females')) != v:
                    rows[i]['persons'], rows[i]['males'], rows[i]['females'] = v
                    rows[i]['note'] = (rows[i].get('note', '') + '; ' if rows[i].get('note') else '') + \
                        'the reading whose counts add to the district total'
                    rows[i].pop('status', None)
                    changed += 1
    return changed


def validated_deds(rows):
    """How many DED and ward rows lie in districts whose rows add up to the district's persons."""
    rows = [dict(r) for r in rows]
    assign_districts(rows)
    n = 0
    for d in rows:
        if d['area_type'] in DISTRICT_TYPES and d.get('persons') is not None:
            kids = [k for k in rows if k.get('district') == d['name'] and k['area_type'] in ('ded', 'ward')]
            if kids and all(k.get('persons') is not None for k in kids) and sum(k['persons'] for k in kids) == d['persons']:
                n += len(kids)
    return n


DISTRICT_TYPES = ('urban_district', 'rural_district', 'municipal_borough', 'county_borough')


def reconcile_districts(rows, canonical):
    """Name each district row from the report's own list of districts (printed in this order:
    boroughs and urban districts, then rural districts, each alphabetical). A garbled name takes
    the closest listed name, or failing that the one its neighbours leave; a district row that
    repeats an earlier one (a page's 'continued' line read together with the next DED) becomes a
    DED row with no serial yet. Returns notes for the checks file."""
    import difflib
    notes = []
    if not canonical:
        return notes
    keys = [norm_key(c) + '|' + (district_kind(c) or '') for c in canonical]
    drows = [r for r in rows if r['area_type'] in DISTRICT_TYPES or r['area_type'] == 'heading']
    assigned = {}
    for idx, r in enumerate(drows):
        k = norm_key(r['name'])
        best, score = None, 0.0
        for ci, c in enumerate(canonical):
            sc = difflib.SequenceMatcher(None, k, norm_key(c)).ratio()
            if (district_kind(c) or '') == (r['area_type'] if r['area_type'] != 'heading' else district_kind(r['name'])):
                sc += 0.15
            if sc > score:
                best, score = ci, sc
        assigned[idx] = best if score >= 0.75 else None
    # positional fill for garbled names: the only listed district between its neighbours
    for idx in range(len(drows)):
        if assigned[idx] is None:
            prev = max([assigned[j] for j in range(idx) if assigned[j] is not None], default=-1)
            nxt = min([assigned[j] for j in range(idx + 1, len(drows)) if assigned[j] is not None], default=len(canonical))
            if nxt - prev == 2:
                assigned[idx] = prev + 1
                notes.append(f"'{drows[idx]['name']}' read as {canonical[prev + 1]} (position)")
    seen = set()
    for idx, r in enumerate(drows):
        ci = assigned[idx]
        if ci is None:
            notes.append(f"unmatched district row '{r['name']}' p.{r['page']}")
            continue
        if r['area_type'] != 'heading' and ci in seen:
            # a repeat: the continued heading glued to a DED row
            r['area_type'], r['ref'] = 'ded', None
            r['note'] = (r.get('note', '') + '; ' if r.get('note') else '') + 'DED row read together with a continued heading'
            notes.append(f"repeat of {canonical[ci]} p.{r['page']} taken as a DED row")
            continue
        r['name'] = canonical[ci]
        if r['area_type'] != 'heading':
            r['area_type'] = district_kind(canonical[ci]) or r['area_type']
            seen.add(ci)
    return notes


def smooth_serials(rows):
    """DED serial numbers run 1, 2, 3 ... down a county's table. A serial is kept while it lies
    between its neighbours' (a gap of up to five allows for rows the OCR lost); one that breaks
    the order (a misread digit, '84' for 64; junk read into it, '276' for 76; none at all) is
    replaced by the one its neighbours leave when they are two apart, and otherwise dropped
    (None) so that the row is matched by name only."""
    deds = [r for r in rows if r['area_type'] == 'ded']
    fixed = 0
    for i, r in enumerate(deds):
        prev = next((deds[j]['ref'] for j in range(i - 1, -1, -1) if deds[j].get('ref') is not None), 0)
        nxt = next((deds[j]['ref'] for j in range(i + 1, len(deds)) if deds[j].get('ref') is not None), None)
        ref = r.get('ref')
        if ref is not None and prev < ref <= prev + 6 and (nxt is None or ref < nxt):
            continue
        if (nxt is not None and nxt - prev == 2) or (nxt is None and ref is None):
            want = prev + 1
            r['note'] = (r.get('note', '') + '; ' if r.get('note') else '') + f"serial read {ref}, taken as {want}"
            r['ref'] = want
            fixed += 1
        else:
            r['note'] = (r.get('note', '') + '; ' if r.get('note') else '') + f'serial {ref} out of order'
    return fixed


def assign_districts(rows):
    """Each DED, ward and town belongs to the district row above it."""
    current = ''
    for r in rows:
        if r['area_type'] in ('urban_district', 'rural_district', 'municipal_borough', 'county_borough', 'heading'):
            current = r['name']
            r['district'] = ''
        elif r['area_type'] in ('ded', 'ward', 'town'):
            r['district'] = current
        else:
            r['district'] = ''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--year', required=True)
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()
    year, out = args.year, args.out
    with open(os.path.join(HERE, 'hist-census-pages.json'), encoding='utf-8') as f:
        cfg = json.load(f)[year]
    allrows, unparsed, checks = [], [], []

    def chk(level, area, variable, status, diff, detail=''):
        checks.append({'year': year, 'check': level, 'area': area, 'variable': variable, 'status': status,
                       'diff': '' if diff is None else diff, 'detail': detail})

    corrections = []
    cpath = os.path.join(out, 'corrections', f'corrections-{year}.csv')
    if os.path.exists(cpath):
        with open(cpath, encoding='utf-8') as f:
            corrections = list(csv.DictReader(f))

    for report, spec in cfg['reports'].items():
        county = spec['county']
        rows, un = parse_table4(year, county, report, spec['tables'].get('T4', []), out, spec.get('districts'), chk,
                                spec.get('lead'))
        # corrections: by report page and printed label fragment, or added rows
        for c in (c for c in corrections if c['report'] == report):
            if c.get('action') == 'add':
                if not c.get('after_match'):
                    pos = -1   # an empty after_match: the start of the report's table
                else:
                    pos = next((i for i in range(len(rows) - 1, -1, -1)
                                if c['after_match'].lower() in (rows[i].get('name_printed') or '').lower()), None)
                if pos is None:
                    print(f'correction: no row to add after: {c}', file=sys.stderr)
                    continue
                rows.insert(pos + 1, {
                    'year': int(year), 'county': county, 'area_type': c['area_type'], 'ref': int(c['ref']) if c['ref'] else None,
                    'name_printed': c['name'], 'name': c['name'], 'source': report, 'table': 'Table 4',
                    'page': int(c['page']), 'prev_year': LAYOUT[year]['prev_year'], 'persons': int(c['persons']),
                    'males': int(c['males']), 'females': int(c['females']),
                    'prev_persons': int(c['prev_persons']) if c.get('prev_persons') else None,
                    'note': f"read from page image p.{c['page']}: {c['evidence']}"})
                continue
            # 'West#2': the second row on the page whose label holds 'West' (labels repeat, e.g.
            # the West wards of Omagh and Strabane on one page)
            mtext, _, nth = c['match'].partition('#')
            hit = [r for r in rows if str(r['page']) == c['page'] and mtext.lower() in (r['name_printed'] or '').lower()]
            if nth.isdigit() and len(hit) >= int(nth):
                hit = [hit[int(nth) - 1]]
            if len(hit) != 1:
                print(f'correction matches {len(hit)} rows: {c}', file=sys.stderr)
                continue
            r = hit[0]
            if c.get('action') == 'drop':
                rows.remove(r)
                continue
            for v in ('persons', 'males', 'females', 'prev_persons', 'ref'):
                if c.get(v) == 'none':
                    r[v] = None   # the page prints a dash: no figure
                elif c.get(v):
                    r[v] = int(c[v])
            for v in ('area_type', 'name'):
                if c.get(v):
                    r[v] = c[v]
            r['status'] = ''
            r['note'] = f"read from page image p.{c['page']}: {c['evidence']}"
        assign_districts(rows)
        if LAYOUT[year].get('wards_unnumbered'):
            # 1961: an urban district or borough with no wards is printed as one row, which is
            # then its own unit (a DED of the same name on the map)
            for i in range(len(rows) - 1, -1, -1):
                d = rows[i]
                if d['area_type'] in ('urban_district', 'municipal_borough') and d.get('persons') is not None \
                        and not any(k.get('district') == d['name'] and k['area_type'] in ('ded', 'ward') for k in rows):
                    nm = re.sub(r'\s+(Urban District|Municipal Borough)$', '', d['name'])
                    rows.insert(i + 1, dict(d, area_type='ded', ref=None, name=f'{nm} Urban', name_printed=d['name_printed'],
                                            district=d['name'], note='district printed without DEDs or wards: its own unit'))
        allrows.extend(r for r in rows if r['area_type'] != 'heading')

    for r in allrows:
        if r['area_type'] in ('ded', 'ward', 'town') and not r.get('note', '').startswith('read from page image'):
            r['name'] = clean_ocr_name(r['name'])
        r['key'] = norm_key(r['name'])
        if r.get('persons') is not None:
            st, d = check_sum([r['males'], r['females']], r['persons'])
            r['_checks'] = [st]
        else:
            r['_checks'] = ['fail']
            chk('unparsed', f"{r['county']}|{r['name_printed']}", 'persons', 'fail', None, f"p.{r['page']}: {r.get('raw', '')[:120]}")

    by_county = defaultdict(list)
    for r in allrows:
        by_county[r['county']].append(r)
    for county, rows in by_county.items():
        dists = [r for r in rows if r['area_type'] in ('urban_district', 'rural_district', 'municipal_borough', 'county_borough')]
        deds = [r for r in rows if r['area_type'] in ('ded', 'ward')]
        for d in dists:
            kids = [k for k in deds if k['district'] == d['name']]
            for v in ('persons', 'males', 'females', 'prev_persons'):
                st, diff = check_sum([k.get(v) for k in kids], d.get(v))
                if not kids:
                    st, diff = 'fail', None   # a district with no DED rows: rows lost
                chk('deds_to_district', f"{county}|{d['name']}", v, st, diff, f'{len(kids)} DEDs/wards')
                if v != 'prev_persons':
                    d['_checks'].append(st)
                    for k in kids:
                        k['_checks'].append(st)
        tot = next((r for r in rows if r['area_type'] == 'county_total'), None)
        # the administrative county's total leaves out its county borough (Londonderry)
        cdists = [d for d in dists if d['area_type'] != 'county_borough'] if county != 'Belfast County Borough' else dists
        if tot and cdists:
            for v in ('persons', 'males', 'females', 'prev_persons'):
                st, diff = check_sum([d.get(v) for d in cdists], tot.get(v))
                chk('districts_to_county', county, v, st, diff, f'{len(cdists)} districts')
                if v != 'prev_persons':
                    tot['_checks'].append(st)
        for sub, kinds in (('urban_total', ('urban_district', 'municipal_borough')), ('rural_total', ('rural_district',))):
            s = next((r for r in rows if r['area_type'] == sub), None)
            if s:
                for v in ('persons', 'males', 'females'):
                    st, diff = check_sum([d.get(v) for d in dists if d['area_type'] in kinds], s.get(v))
                    chk('districts_to_urban_rural_total', f'{county}|{sub}', v, st, diff)
                    s['_checks'].append(st)
        refs = sorted(r['ref'] for r in deds if r.get('ref'))
        if refs:
            missing = sorted(set(range(1, max(refs) + 1)) - set(refs))
            dup = [k for k, n in Counter(refs).items() if n > 1]
            chk('ded_serials', county, 'ref', 'ok' if not missing and not dup else 'fail', len(missing),
                f'max {max(refs)}; missing {missing[:30]}; duplicated {dup[:10]}')

    # all DEDs and wards against the Northern Ireland total (explorer-bundle.json, the reports)
    ni = cfg.get('ni_total')
    if ni:
        st, diff = check_sum([r.get('persons') for r in allrows if r['area_type'] in ('ded', 'ward')], ni)
        chk('deds_to_ni', 'Northern Ireland', 'persons', st, diff, 'all DEDs and county-borough wards')

    for r in allrows:
        sts = r.pop('_checks')
        r['status'] = 'fail' if 'fail' in sts else ('ok' if 'ok' in sts else 'na')
    os.makedirs(os.path.join(out, 'areas'), exist_ok=True)
    os.makedirs(os.path.join(out, 'validation'), exist_ok=True)
    with open(os.path.join(out, 'areas', f'areas-{year}.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, AREA_COLS, extrasaction='ignore')
        w.writeheader()
        w.writerows(allrows)
    with open(os.path.join(out, 'validation', f'checks-{year}.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, ['year', 'check', 'area', 'variable', 'status', 'diff', 'detail'])
        w.writeheader()
        w.writerows(checks)
    c = Counter((x['check'], x['status']) for x in checks)
    for k in sorted(c):
        print(f'{k[0]:32} {k[1]:5} {c[k]}')
    t = Counter((a['area_type'], a['status']) for a in allrows)
    for k in sorted(t):
        print(f'areas {k[0]:22} {k[1]:8} {t[k]}')


def parse_towns(year, out):
    """The towns table (1937 Table 5: Towns Improvement Act towns and towns of 50 or more houses
    with no legal boundary): name, previous census, persons, males, females per town, from the
    readings that give persons = males + females. Writes areas/towns-<year>.csv."""
    with open(os.path.join(HERE, 'hist-census-pages.json'), encoding='utf-8') as f:
        cfg = json.load(f)[year]
    rows = []
    for report, spec in cfg['reports'].items():
        stem = os.path.splitext(report)[0]
        for page in spec['tables'].get('T5', []):
            seen = {}
            for name in ('', 'b', 'c', 'p'):
                txt = os.path.join(out, 'ocr', year, f'{stem}-p{page:03d}' + (f'.{name}' if name else '') + '.txt')
                if not os.path.exists(txt):
                    continue
                with open(txt, encoding='utf-8') as fh:
                    lines = fh.read().splitlines()
                # the page goes on with Table 6 (dispensary districts): stop there
                cut = next((i for i, ln in enumerate(lines) if i > 3 and re.search(r'TABLE\s*[6-9]', ln)), len(lines))
                lines = lines[:cut]
                for rec in records(lines, year != '1937'):
                    label = re.sub(r'\(\w\)|\bT\b|[.\s]+$', '', rec['label']).strip(' .,-')
                    label = re.sub(r'^.*\b(lies|Females|Persons)\b\s*', '', label)
                    if not re.match(r'^[A-Z][a-z]', label) or re.search(r'Table|Towns|Popul|DEFIN', label):
                        continue
                    nums = rec['nums']
                    i = find_triple(nums, 0, 2)
                    if i is None:
                        continue
                    key = norm_key(clean_ocr_name(label))
                    if not key or any(similar(key, k) >= 0.75 for k in seen):
                        continue   # the same town in another reading
                    seen[key] = True
                    rows.append({'year': int(year), 'county': spec['county'], 'name': clean_ocr_name(label),
                                 'persons': nums[i], 'males': nums[i + 1], 'females': nums[i + 2],
                                 'prev_persons': nums[i - 1] if i >= 1 else '', 'source': report, 'table': 'Table 5',
                                 'page': page, 'reading': name or 'tesseract 300 dpi'})
    with open(os.path.join(out, 'areas', f'towns-{year}.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, ['year', 'county', 'name', 'persons', 'males', 'females', 'prev_persons', 'source',
                               'table', 'page', 'reading'])
        w.writeheader()
        w.writerows(rows)
    print('towns', len(rows), Counter(r['county'] for r in rows))


if __name__ == '__main__':
    if '--towns' in sys.argv:
        sys.argv.remove('--towns')
        ap = argparse.ArgumentParser()
        ap.add_argument('--year', required=True)
        ap.add_argument('--out', default=OUT)
        a = ap.parse_args()
        parse_towns(a.year, a.out)
    else:
        main()
