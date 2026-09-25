#!/usr/bin/env python3
"""Harvest the 1885-1922 by-election tables of Walker's 1801-1922 volume.

    WALKER_DIR=<scans> TESSERACT_CMD=<tesseract> python scripts/walker/harvest_byelections.py

Civgraph holds the general elections of 1885-1918 but not one by-election between them, and
the electorate harvest deliberately drops by-election rows (a by-election register is not the
general election's). Walker prints every by-election with its year in the date column --
"1887 Jul. 12" -- which is how a by-election row is told from a general-election row, and the
reason for the vacancy in italics under the seat's name.

Like the 1802-1880 harvest this has no second source inside the repository: a misread figure
is not contradicted by anything here. Records state what was read. UNVERIFIED.
"""
import argparse
import difflib
import json
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import extract_page, WALKER_DIR  # noqa: E402

VOLUME = 'walker-ireland-1801-1922.pdf'
SOURCE = {'title': 'Parliamentary Election Results in Ireland, 1801-1922',
          'editor': 'Brian M. Walker (ed.)', 'publisher': 'Royal Irish Academy', 'year': 1978}


MONTH_TOKEN = re.compile(r'^(Jan|Feb|Mar|Apr|May|June?|July?|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\d*$', re.I)
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))


def known_seats():
    """Constituency names Civgraph holds for 1885-1918, with its abbreviations spelled out."""
    names = set()
    src = os.path.join(ROOT, 'data', 'elections-source', 'data', 'elections', 'house-of-commons-of-the-united-kingdom')
    for d in os.listdir(src):
        if d >= '1919':
            continue
        for f in os.listdir(os.path.join(src, d)):
            try:
                n = json.load(open(os.path.join(src, d, f), encoding='utf-8'))['Constituency']['countInfo']['Constituency_Name']
            except Exception:
                continue
            for a, b in (('NE', 'North-East'), ('NW', 'North-West'), ('SE', 'South-East'), ('SW', 'South-West'),
                         ('N', 'North'), ('S', 'South'), ('E', 'East'), ('W', 'West')):
                n = re.sub(rf'\b{a}\b', b, n)
            names.add(n)
    return sorted(names)


def compass(name):
    """A matched name may not change a compass word the page printed: South-east is not North-East."""
    return {t for t in name.replace('-', ' ').split() if t in ('north', 'south', 'east', 'west', 'mid')}


def tidy(records):
    """Two misreadings the spot-check found, corrected without re-reading the page: the date
    column bleeding into the name ("Mar.4 John McKean"), and a garbled seat name ("Kerry
    Sour") that is one close match away from a constituency Civgraph already holds."""
    seats = known_seats()
    fixed = 0
    for r in records:
        for c in r['candidates']:
            words = c['name'].split()
            while words and (MONTH_TOKEN.match(words[0]) or re.match(r'^\d{1,2}$', words[0])):
                words.pop(0)
            c['name'] = ' '.join(words)
        name = r['constituency'].replace('-', ' ').replace('’', "'")
        norm = {n.replace('-', ' ').lower(): n for n in seats}
        if name.lower() in norm:
            r['constituency'] = norm[name.lower()]
        elif r['constituency'] not in seats:
            # Close, and the same first word: "Kerry Sour" is Kerry South, but "Belfast ee"
            # could be East or West and is left as read.
            hit = [h for h in difflib.get_close_matches(name.lower(), list(norm), n=2, cutoff=0.8)
                   if h.split()[0] == name.lower().split()[0]
                   and compass(name.lower()) <= compass(h)]
            if len(hit) == 1:
                hit = [norm[hit[0]]]
            else:
                hit = []
            if hit:
                r['constituencyReadAs'] = r['constituency']
                r['constituency'] = hit[0]
                fixed += 1
    return fixed


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--pages', default='146-212')
    ap.add_argument('--out', default=os.path.join('data', 'elections', 'walker-byelections-1885-1922.json'))
    args = ap.parse_args()
    pdf = os.path.join(WALKER_DIR, VOLUME)
    if not os.path.exists(pdf):
        sys.exit(f'not found: {pdf}. Set WALKER_DIR to the folder holding the scans.')
    lo, hi = (int(x) for x in args.pages.split('-'))

    contests, skipped = {}, defaultdict(int)
    for idx in range(lo, hi + 1):
        try:
            rows, meta = extract_page(pdf, idx)
        except Exception:
            skipped['pages that could not be read'] += 1
            continue
        by = [r for r in rows if r.get('dateYear') and 1885 <= r['dateYear'] <= 1922]
        if not by:
            continue
        for r in by:
            if not r['constituency'] or len(r['candidate']) < 3:
                continue
            key = (r['dateYear'], r['date'], r['constituency'])
            c = contests.setdefault(key, {
                'year': r['dateYear'], 'date': r['date'], 'constituency': r['constituency'],
                'electorate': r['electorate'], 'page': idx, 'candidates': []})
            if c['electorate'] is None and r['electorate'] is not None:
                c['electorate'] = r['electorate']
            cand = {'name': r['candidate'], 'party': r['party'], 'votes': r['votes']}
            if r.get('suspectMerged'):
                cand['suspectMerged'] = True
            if cand not in c['candidates']:
                c['candidates'].append(cand)
        for note in meta.get('notes', []):
            for c in contests.values():
                if c['constituency'] == note.get('constituency') and c['page'] == idx:
                    c.setdefault('notes', []).append(note['text'])
                    break

    records = sorted(contests.values(), key=lambda c: (c['year'], c['constituency']))
    print(f'  seat names matched to a known constituency: {tidy(records)}')
    by_year = defaultdict(int)
    for c in records:
        by_year[c['year']] += 1
    doc = {
        'schemaVersion': 1,
        'description': (
            'By-elections in Irish constituencies, 1885-1922, read from Walker. Civgraph holds '
            'the general elections of the period but none of its by-elections, so this is new '
            'coverage. UNVERIFIED: there is no second source here to check it against; treat it '
            'as a transcription to be spot-checked, not as established data. A contest with no '
            'votes was an unopposed return.'),
        'provenance': {
            'method': 'scripts/walker/harvest_byelections.py',
            'extractor': 'scripts/walker/extract.py',
            'source': SOURCE,
            'licence': 'Figures only. Election results are facts and carry no copyright; the '
                       'volume is in copyright, is not in this repository, and no text from it is '
                       'reproduced beyond short factual notes recording why a seat fell vacant.',
        },
        'counts': {'contests': len(records),
                   'candidates': sum(len(c['candidates']) for c in records),
                   'contested': sum(1 for c in records if any(x['votes'] for x in c['candidates'])),
                   'withElectorate': sum(1 for c in records if c['electorate']),
                   'byYear': dict(sorted(by_year.items())),
                   'skipped': dict(skipped)},
        'records': records,
    }
    out = args.out if os.path.isabs(args.out) else os.path.join(os.getcwd(), args.out)
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(f'wrote {out}')
    for k in ('contests', 'candidates', 'contested', 'withElectorate'):
        print(f'  {k}: {doc["counts"][k]}')


if __name__ == '__main__':
    main()
