#!/usr/bin/env python3
"""Harvest the 1802-1880 general elections, which Civgraph does not cover at all.

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
from extract import (extract_page, page_image, words_of, WALKER_DIR,  # noqa: E402
                     NUM_RE)

VOLUME = 'walker-ireland-1801-1922.pdf'
HEAD_RE = re.compile(r'GENERAL ELECTION[,.\s]*(1[78]\d{2})', re.I)
BY_RE = re.compile(r'BY-ELECTIONS?[,.\s]*(1[78]\d{2})', re.I)
MIN_ELECTORS, MAX_ELECTORS = 20, 120000
SOURCE = {'title': 'Parliamentary Election Results in Ireland, 1801-1922',
          'editor': 'Brian M. Walker (ed.)', 'publisher': 'Royal Irish Academy',
          'year': 1978}


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
        except Exception:
            skipped['pages that could not be read'] += 1
            continue
        if not rows:
            skipped['pages yielding no rows'] += 1
            continue
        kind, year = current
        for r in rows:
            if not r['constituency'] or len(r['candidate']) < 3:
                continue
            e = r['electorate']
            if e is not None and not (MIN_ELECTORS <= e <= MAX_ELECTORS):
                e = None                       # implausible: drop the figure, keep the row
            key = (year, kind, r['constituency'])
            c = contests.setdefault(key, {
                'year': year, 'kind': kind, 'constituency': r['constituency'],
                'electorate': e, 'date': r['date'], 'page': idx,
                'headConfidence': confidence, 'candidates': []})
            if c['electorate'] is None and e is not None:
                c['electorate'] = e
            if not any(x['name'] == r['candidate'] and x['votes'] == r['votes']
                       for x in c['candidates']):
                c['candidates'].append({'name': r['candidate'], 'party': r['party'],
                                        'votes': r['votes']})
        for note in meta.get('notes', []):
            key = (year, kind, note.get('constituency'))
            if key in contests:
                contests[key].setdefault('notes', []).append(note['text'])

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
