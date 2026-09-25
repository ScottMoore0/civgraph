#!/usr/bin/env python3
"""Harvest the 1802-1880 elections, which Civgraph does not cover at all.

    WALKER_DIR=<scans> TESSERACT_CMD=<tesseract> python scripts/walker/harvest_pre1885.py

Civgraph's earliest Westminster contest is 1885. Walker tabulates every Irish seat back
to the Union, so these twenty-two general elections are new coverage rather than
corrections, and every contest, candidate, party and vote here is absent from Civgraph.

WHY THIS IS MARKED UNVERIFIED AND CANNOT EASILY BE OTHERWISE

Everything checked so far was checked against Civgraph's own figures -- votes it already
held, which is a genuine second source. Here there is no second source: if the OCR
misreads a vote, nothing in this repository contradicts it. The internal checks below
catch the crude failures and nothing else, so these records state what was read, not what
is known to be true. They should not be imported without spot-checking against the page.

The election a page belongs to therefore cannot be settled by matching figures either.
It is taken from the running head, and where that is unreadable the page inherits the
last election seen -- which is why `headConfidence` is recorded per contest.
"""
import argparse
import json
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import (extract_page, extract_unaffiliated_page, page_image,  # noqa: E402
                     words_of, WALKER_DIR, NUM_RE, CONTINUED)

VOLUME = 'walker-ireland-1801-1922.pdf'
HEAD_RE = re.compile(r'GENERAL ELECTION[,.\s]*(1[78]\d{2})', re.I)
BY_RE = re.compile(r'BY-ELECTIONS?[,.\s]*(1[78]\d{2})', re.I)
MIN_ELECTORS, MAX_ELECTORS = 20, 120000
SOURCE = {'title': 'Parliamentary Election Results in Ireland, 1801-1922',
          'editor': 'Brian M. Walker (ed.)', 'publisher': 'Royal Irish Academy',
          'year': 1978}


# Polling months of each United Kingdom general election in Ireland, 1802-1880. A row whose
# date carries no year is a general-election row, and only one general election near the
# page's year was polled in its month -- which recovers the right election where the running
# head is unreadable (about 44% of pages) or has been inherited from the previous page.
GE_MONTHS = {
    1802: {'Jul', 'Aug'}, 1806: {'Oct', 'Nov'}, 1807: {'May', 'Jun'}, 1812: {'Oct', 'Nov'},
    1818: {'Jun', 'Jul'}, 1820: {'Mar', 'Apr'}, 1826: {'Jun', 'Jul'}, 1830: {'Jul', 'Aug'},
    1831: {'Apr', 'May', 'Jun'}, 1832: {'Dec', 'Jan'}, 1835: {'Jan', 'Feb'},
    1837: {'Jul', 'Aug'}, 1841: {'Jun', 'Jul'}, 1847: {'Jul', 'Aug'}, 1852: {'Jul', 'Aug'},
    1857: {'Mar', 'Apr'}, 1859: {'Apr', 'May'}, 1865: {'Jul'}, 1868: {'Nov', 'Dec'},
    1874: {'Jan', 'Feb'}, 1880: {'Mar', 'Apr'},
}


def attribute(row, head_year):
    """(kind, year, how) for one extracted row.

    Walker prints the year on EVERY by-election entry ("1875 Apr. 28") and on no general-
    election entry, so a year in the date column settles the kind and the year outright.
    Without it the row is a general election, placed by its polling month. A spot-check of
    21 contests found 8 filed under the wrong election before this; the vote figures and
    names in those rows were right, only the election was wrong.
    """
    if row.get('dateYear'):
        return 'by-election', row['dateYear'], 'year printed in the date column'
    month = (row.get('date') or '')[:3].title()
    if month and head_year:
        fits = [y for y, months in GE_MONTHS.items() if month in months]
        if fits:
            best = min(fits, key=lambda y: abs(y - head_year))
            return 'general', best, 'general election polled in that month nearest the page'
    return 'general', head_year, 'running head only'


def page_head(pdf, idx):
    """(kind, year) from the running head, or (None, None)."""
    im = page_image(pdf, idx)
    words, (pw, ph) = words_of(im)
    head = ' '.join(w['text'] for w in words if w['cy'] <= ph * 0.12)
    m = HEAD_RE.search(head)
    if m:
        return 'general', int(m.group(1))
    m = BY_RE.search(head)
    if m:
        return 'by-election', int(m.group(1))
    return None, None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--pages', default='20-145')
    ap.add_argument('--out', default=os.path.join(
        'data', 'elections', 'walker-pre1885-results.json'))
    args = ap.parse_args()
    pdf = os.path.join(WALKER_DIR, VOLUME)
    if not os.path.exists(pdf):
        sys.exit(f'not found: {pdf}. Set WALKER_DIR to the folder holding the scans.')
    lo, hi = (int(x) for x in args.pages.split('-'))

    contests, skipped = {}, defaultdict(int)
    current, confidence = (None, None), 'none'
    last_constituency = None
    for idx in range(lo, hi + 1):
        kind, year = page_head(pdf, idx)
        if year:
            current, confidence = (kind, year), 'read from this page'
        elif current[1]:
            confidence = 'inherited from an earlier page'
        else:
            skipped['pages before any identifiable election'] += 1
            continue
        try:
            rows, meta = extract_page(pdf, idx)
            if not rows:
                # 1802-1831: no electorate and no affiliation column (see extract.py).
                rows, meta = extract_unaffiliated_page(pdf, idx)
        except Exception:
            skipped['pages that could not be read'] += 1
            continue
        if not rows:
            skipped['pages yielding no rows'] += 1
            continue
        for r in rows:
            if r['constituency'] == CONTINUED:
                r['constituency'] = last_constituency
        rows = [r for r in rows if r['constituency']]
        if rows:
            last_constituency = rows[-1]['constituency']
        head_year = current[1]
        for r in rows:
            if not r['constituency'] or len(r['candidate']) < 3:
                continue
            kind, year, how = attribute(r, head_year)
            if not year or year > 1884:
                continue
            e = r['electorate']
            if e is not None and not (MIN_ELECTORS <= e <= MAX_ELECTORS):
                e = None                       # implausible: drop the figure, keep the row
            key = (year, kind, r['constituency'], r['date'] if kind == 'by-election' else None)
            c = contests.setdefault(key, {
                'year': year, 'kind': kind, 'constituency': r['constituency'],
                'electorate': e, 'date': r['date'], 'page': idx,
                'headConfidence': confidence, 'electionFrom': how,
                **({'layout': 'no affiliation column (pre-1832)'} if meta.get('layout') == 'unaffiliated' else {}),
                'candidates': []})
            if c['electorate'] is None and e is not None:
                c['electorate'] = e
            if not any(x['name'] == r['candidate'] and x['votes'] == r['votes']
                       for x in c['candidates']):
                cand = {'name': r['candidate'], 'party': r['party'], 'votes': r['votes']}
                if r.get('aliases'):
                    cand['aliases'] = r['aliases']
                if r.get('suspectMerged'):
                    cand['suspectMerged'] = True
                c['candidates'].append(cand)
        for note in meta.get('notes', []):
            for key, c in contests.items():
                if c['constituency'] == note.get('constituency') and c['page'] == idx:
                    c.setdefault('notes', []).append(note['text'])
                    break

    # The gutter side of a page misreads a seat's first letter: "publin city", "pungannon",
    # "cermanagh county". A name read only once or twice is corrected where capitalising it or
    # swapping that letter gives a name the harvest reads at least three times elsewhere.
    freq = defaultdict(int)
    for c in contests.values():
        freq[c['constituency']] += 1
    known = {n for n, k in freq.items() if k >= 3}
    fixed = {}
    for name, k in freq.items():
        if name in known:
            continue
        options = [name[:1].upper() + name[1:]] + [ch + name[1:] for ch in 'DPFCBGTLKS']
        hit = next((o for o in options if o in known), None)
        if hit:
            fixed[name] = hit
    if fixed:
        merged = {}
        for c in contests.values():
            if c['constituency'] in fixed:
                c['constituency'] = fixed[c['constituency']]
                c['constituencyReadAs'] = 'corrected from an OCR misreading of the first letter'
            key = (c['year'], c['kind'], c['constituency'], c['date'] if c['kind'] == 'by-election' else None)
            if key in merged:
                merged[key]['candidates'] += [x for x in c['candidates'] if x not in merged[key]['candidates']]
            else:
                merged[key] = c
        contests = merged
    print(f'  first-letter fixes: {len(fixed)}')

    records = sorted(contests.values(), key=lambda c: (c['year'], c['kind'], c['constituency']))
    by_year = defaultdict(int)
    for c in records:
        by_year[f"{c['year']} {c['kind']}"] += 1
    doc = {
        'schemaVersion': 1,
        'description': (
            'Irish parliamentary election results 1802-1880, read from Walker. Civgraph '
            'holds nothing before 1885, so this is new coverage, not corrections. '
            'UNVERIFIED: unlike the post-1885 work, there is no second source to check '
            'these against -- if the OCR misread a figure, nothing here contradicts it. '
            'Treat as a transcription to be spot-checked, not as established data.'),
        'provenance': {
            'method': 'scripts/walker/harvest_pre1885.py',
            'source': SOURCE,
            'licence': 'Figures only. Election results are facts and carry no copyright; '
                       'the volume is in copyright, is not in this repository, and no '
                       'text from it is reproduced beyond short factual notes recording '
                       'why a seat changed hands.',
            'electionIdentification': 'From the running head; where unreadable the page '
                                      'inherits the last election seen, recorded per '
                                      'contest as headConfidence.',
        },
        'counts': {'contests': len(records),
                   'candidates': sum(len(c['candidates']) for c in records),
                   'withElectorate': sum(1 for c in records if c['electorate']),
                   'byElection': dict(sorted(by_year.items())),
                   'skipped': dict(skipped)},
        'records': records,
    }
    out = args.out if os.path.isabs(args.out) else os.path.join(os.getcwd(), args.out)
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(f'wrote {out}')
    print(f"  contests        : {len(records)}")
    print(f"  candidates      : {doc['counts']['candidates']}")
    print(f"  with electorate : {doc['counts']['withElectorate']}")
    print(f"  elections seen  : {len(by_year)}")
    for k, v in skipped.items():
        print(f'  skipped: {k}: {v}')


if __name__ == '__main__':
    main()
