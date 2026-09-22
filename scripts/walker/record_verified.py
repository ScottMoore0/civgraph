#!/usr/bin/env python3
"""Record which contests have actually been checked against Walker, and agreed.

    WALKER_DIR=<scans> TESSERACT_CMD=<tesseract> python scripts/walker/record_verified.py

Every Walker citation is written `checked: false`, which is right by default: the volume
covers the contest, but its figures have not been read against ours. For several hundred
contests they HAVE been, and that is worth recording -- an unverified citation and a
citation whose figures were compared and matched are different claims.

A contest is listed here only when at least one figure was compared and every compared
figure agreed. A contest with any disagreement is left out, even where the disagreement
is a known OCR artefact, because the point of the list is that it can be relied on.

Output is committed so the provenance build can use it without the scans, which are not
in this repository.
"""
import argparse
import json
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import extract_page                                   # noqa: E402
from check_against_civgraph import (WALKER_DIR, load_civ, resolve,  # noqa: E402
                                    surname, best_election)

V1 = 'walker-ireland-1801-1922.pdf'
V2 = 'walker-ireland-1918-1992.pdf'
HOC = 'house-of-commons-of-the-united-kingdom'

# volume, page range, body. The election is identified from the figures themselves.
SWEEPS = [
    (V1, 146, 212, HOC),
    (V2, 11, 20, 'dail-eireann'),
    (V2, 21, 48, HOC),
    (V2, 49, 104, 'parliament-of-northern-ireland'),
    (V2, 105, 130, 'dail-eireann'),
]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--out', default=os.path.join(
        'data', 'elections', 'walker-verified-contests.json'))
    args = ap.parse_args()

    verified, rejected = {}, defaultdict(int)
    for volume, lo, hi, body in SWEEPS:
        path = os.path.join(WALKER_DIR, volume)
        if not os.path.exists(path):
            sys.exit(f'not found: {path}. Set WALKER_DIR to the folder holding the scans.')
        for idx in range(lo, hi + 1):
            try:
                rows, _ = extract_page(path, idx)
            except Exception:
                continue
            if len(rows) < 3:
                continue
            date = best_election(rows, body)
            if not date:
                continue
            civ = load_civ(body, date)
            per = defaultdict(lambda: {'agree': 0, 'differ': 0})
            for r in rows:
                key = resolve(r['constituency'], civ.keys())
                if not key:
                    continue
                c = civ[key]
                if r['electorate'] and c['electorate']:
                    per[key]['agree' if r['electorate'] == c['electorate'] else 'differ'] += 1
                if r['votes'] is None:
                    continue
                by = defaultdict(list)
                for x in c['candidates']:
                    by[surname(x['name'])].append(x)
                group = by.get(surname(r['candidate'])) or []
                if len(group) != 1:
                    continue
                if group[0]['votes'] is None:
                    continue
                per[key]['agree' if group[0]['votes'] == r['votes'] else 'differ'] += 1
            for key, tally in per.items():
                if tally['agree'] and not tally['differ']:
                    rec = verified.setdefault(civ[key]['file'], {
                        'file': civ[key]['file'], 'body': body, 'date': date,
                        'constituency': civ[key]['name'], 'figuresAgreed': 0,
                        'volume': volume})
                    rec['figuresAgreed'] += tally['agree']
                elif tally['differ']:
                    rejected['contests with a disagreement'] += 1

    records = sorted(verified.values(), key=lambda r: (r['date'], r['constituency']))
    by_election = defaultdict(int)
    for r in records:
        by_election[f"{r['body']}__{r['date']}"] += 1
    doc = {
        'schemaVersion': 1,
        'description': (
            'Contests whose figures have been read from B. M. Walker\'s printed tables '
            'and agreed with Civgraph. Used by scripts/build-election-provenance.mjs to '
            'mark those citations checked rather than merely cited. A contest appears '
            'only if at least one figure was compared and every compared figure matched; '
            'any disagreement excludes it, so the list can be relied on.'),
        'provenance': {
            'method': 'scripts/walker/record_verified.py',
            'note': 'The volumes are in copyright and are not in this repository. Only '
                    'the fact of agreement is recorded here, never a figure from them.',
        },
        'counts': {'contests': len(records),
                   'figuresAgreed': sum(r['figuresAgreed'] for r in records),
                   'byElection': dict(sorted(by_election.items()))},
        'records': records,
    }
    out = args.out if os.path.isabs(args.out) else os.path.join(os.getcwd(), args.out)
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(f'wrote {out}')
    print(f"  contests verified : {len(records)}")
    print(f"  figures agreed    : {doc['counts']['figuresAgreed']}")
    for k, v in sorted(by_election.items()):
        print(f'      {k}: {v}')
    for k, v in rejected.items():
        print(f'  {k}: {v}')


if __name__ == '__main__':
    main()
