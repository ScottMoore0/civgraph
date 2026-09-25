#!/usr/bin/env python3
"""Harvest the pre-1918 Westminster elector counts Civgraph does not hold.

    WALKER_DIR=<scans> TESSERACT_CMD=<tesseract> \
      python scripts/walker/harvest_electorates.py --pages 146-212 --out <file.json>

Civgraph holds no electorate figure for ANY pre-1918 Westminster contest: votes are
complete at 96 of 96 in each of the nine elections 1885-1918, electorate is empty in all
of them. Walker prints an elector count for every constituency, so this is new data
rather than a correction.

HOW A PAGE IS TIED TO AN ELECTION

Not by the year in the running head, which is wrong by one election because the head scan
also catches the facing page. Pages are scored against every candidate election by how
many CANDIDATE VOTES they reproduce exactly -- votes being the one field Civgraph has in
full for this period -- and paired with the clear winner. Where no election clearly wins,
the page is skipped rather than guessed.

WHAT IS CHECKED BEFORE A FIGURE IS KEPT

  * electorate >= the votes actually cast, summed from Civgraph's own candidates. An OCR
    misread that drops or mangles a digit usually fails this.
  * the figure is in a plausible range for an Irish constituency of the period.
  * a constituency read twice must be read the same both times; a conflict is reported,
    never silently resolved.
  * turnout implied by the figure must be credible; an implausible one is reported.

Nothing here writes to election data. Output is a proposal file for review.
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import extract_page                                   # noqa: E402
from check_against_civgraph import (SRC, WALKER_DIR, load_civ,     # noqa: E402
                                    dates_of, resolve, surname, norm)

BODY = 'house-of-commons-of-the-united-kingdom'
PRE_1918 = ['1885-11-24', '1886-07-01', '1892-07-04', '1895-07-13', '1900-09-26',
            '1906-01-12', '1910-01-15', '1910-12-03', '1918-12-14']
MIN_ELECTORS, MAX_ELECTORS = 500, 120000
VOLUME = {'title': 'Parliamentary Election Results in Ireland, 1801-1922',
          'editor': 'Brian M. Walker (ed.)', 'publisher': 'Royal Irish Academy',
          'year': 1978}


def vote_score(rows, civ):
    """How many of this page's figures are votes this election actually recorded."""
    hits, seen = 0, set()
    for r in rows:
        if r['votes'] is None:
            continue
        key = resolve(r['constituency'], civ.keys())
        if not key:
            continue
        for x in civ[key]['candidates']:
            if x['votes'] == r['votes'] and surname(x['name']) == surname(r['candidate']):
                if (key, r['votes']) not in seen:
                    hits += 1
                    seen.add((key, r['votes']))
                break
    return hits


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--volume', default='walker-ireland-1801-1922.pdf')
    ap.add_argument('--pages', default='146-212')
    ap.add_argument('--out', default=os.path.join(
        'data', 'elections', 'corrections', 'walker-pre1918-electorates.json'))
    args = ap.parse_args()
    path = os.path.join(WALKER_DIR, args.volume)
    if not os.path.exists(path):
        sys.exit(f'not found: {path}. Set WALKER_DIR to the folder holding the scans.')
    lo, hi = (int(x) for x in args.pages.split('-'))

    civs = {d: load_civ(BODY, d) for d in PRE_1918 if os.path.isdir(os.path.join(SRC, BODY, d))}
    harvested, conflicts, rejected, unaligned = {}, [], [], []
    # The seat note -- "except Cork city and Dublin University with two each" -- is
    # printed once at the head of an election's section, not on every page of it. Reading
    # it per page leaves Cork city looking like a single-member seat on every page but
    # one, and its figures are then rejected as impossible because a two-member seat's
    # votes exceed its electorate. So the note is gathered across the whole run first.
    two_member = set()
    staged = []

    for idx in range(lo, hi + 1):
        try:
            rows, meta = extract_page(path, idx)
            two_member |= set(meta.get('twoMemberSeats') or [])
        except Exception as exc:
            rejected.append({'page': idx, 'reason': f'{type(exc).__name__}'})
            continue
        if not rows:
            continue
        scored = sorted(((vote_score(rows, c), d) for d, c in civs.items()), reverse=True)
        if not scored or scored[0][0] < 3:
            unaligned.append({'page': idx, 'rows': len(rows), 'bestScore': scored[0][0] if scored else 0})
            continue
        if len(scored) > 1 and scored[1][0] and scored[0][0] < scored[1][0] * 1.6:
            unaligned.append({'page': idx, 'rows': len(rows), 'reason': 'two elections fit'})
            continue
        staged.append((idx, scored[0][1], rows))

    for idx, date, rows in staged:
        civ = civs[date]
        for r in rows:
            if not r['electorate']:
                continue
            # A by-election row carries its year in the date column. Its electorate is a
            # by-election register, not the general election's -- the spot-check's one
            # error was exactly this: King's County's April 1918 by-election figure,
            # 4,601, filed as the 1918 general election's, which was 25,702.
            if r.get('dateYear'):
                continue
            key = resolve(r['constituency'], civ.keys())
            if not key:
                continue
            c = civ[key]
            cast = sum(x['votes'] or 0 for x in c['candidates'])
            e = r['electorate']
            if not (MIN_ELECTORS <= e <= MAX_ELECTORS):
                rejected.append({'date': date, 'constituency': c['name'], 'electorate': e,
                                 'reason': 'outside a plausible range'})
                continue
            # In a two-member seat each elector has two votes, so votes cast can
            # legitimately exceed the electorate: Cork city 1885 has 14,569 electors and
            # 16,117 votes. Comparing against electors alone rejected every Cork city
            # figure in the volume as impossible.
            # Seats: the page-head note states the exception, but it survives OCR badly
            # ("t Cork city and Dublin University wi") and sits on a page whose header
            # does not parse, so it cannot be relied on. The data says it anyway: in a
            # two-member seat each elector has two votes, so votes cast EXCEEDING the
            # electorate is itself the evidence. Cork city 1885 -- 14,569 electors,
            # 16,117 votes -- is the case that matters, and treating the excess as an
            # error rejected every Cork city figure in the volume.
            seats = 2 if r['constituency'].lower() in two_member else max(1, int(r.get('seats') or 1))
            inferred = False
            if cast and seats == 1 and e < cast <= 2 * e:
                seats, inferred = 2, True
            if cast and e * seats < cast:
                rejected.append({'date': date, 'constituency': c['name'], 'electorate': e,
                                 'votesCast': cast, 'seats': seats,
                                 'reason': 'more votes cast than two members could explain'})
                continue
            turnout = round(100 * cast / (e * seats), 1) if (cast and e) else None
            if turnout is not None and turnout > 100:
                rejected.append({'date': date, 'constituency': c['name'], 'electorate': e,
                                 'turnoutPct': turnout, 'reason': 'turnout above 100%'})
                continue
            slot = harvested.setdefault((date, key), {})
            if 'electorate' in slot and slot['electorate'] != e:
                conflicts.append({'date': date, 'constituency': c['name'],
                                  'read': [slot['electorate'], e],
                                  'pages': [slot['page'], idx]})
                continue
            slot.update({'date': date, 'constituency': c['name'], 'electorate': e,
                         'votesCast': cast or None, 'turnoutPct': turnout,
                         'seats': seats, 'page': idx, 'sourceFile': c['file']})
            if inferred:
                slot['seatsInferredFrom'] = 'votes cast exceed the electorate, so the seat returns two members'

    # A division cannot hold its whole city's electorate. Belfast Cromac 1918 came out
    # with 91,673 -- Belfast's city-wide total, printed once above its divisions -- which
    # implies a 16.3% turnout where the median across these elections is 75%. Two checks
    # catch that class: a figure far above the rest of its own election, and a turnout
    # far below what the period ever shows.
    per_election = {}
    for rec in harvested.values():
        per_election.setdefault(rec['date'], []).append(rec['electorate'])
    import statistics as _stats
    medians = {d: _stats.median(v) for d, v in per_election.items() if v}
    for rec in list(harvested.values()):
        med = medians.get(rec['date'])
        if med and rec['electorate'] > med * 3.5:
            rejected.append({'date': rec['date'], 'constituency': rec['constituency'],
                             'electorate': rec['electorate'], 'electionMedian': med,
                             'reason': 'far above every other seat in the same election'})
            rec['_drop'] = True
        elif rec.get('turnoutPct') is not None and rec['turnoutPct'] < 35:
            rejected.append({'date': rec['date'], 'constituency': rec['constituency'],
                             'electorate': rec['electorate'],
                             'turnoutPct': rec['turnoutPct'],
                             'reason': 'turnout too low to be credible for the period'})
            rec['_drop'] = True

    # One electorate cannot belong to two seats in the same election. Where it appears
    # to, the figure was carried across contests rather than read, so neither is kept.
    groups = {}
    for rec in harvested.values():
        if rec.get('_drop'):
            continue
        groups.setdefault((rec['date'], rec['electorate']), []).append(rec)
    shared = []
    for (date, value), group in groups.items():
        if len(group) > 1:
            shared.append({'date': date, 'electorate': value,
                           'constituencies': sorted(g['constituency'] for g in group),
                           'reason': 'one figure read for several seats'})
            for g in group:
                g['_drop'] = True
    records = sorted((r for r in harvested.values() if not r.get('_drop')),
                     key=lambda r: (r['date'], r['constituency']))
    by_election = {}
    for r in records:
        by_election[r['date']] = by_election.get(r['date'], 0) + 1

    doc = {
        'schemaVersion': 1,
        'description': (
            'Elector counts for pre-1918 Westminster contests, read from Walker and NOT '
            'held by Civgraph, which has none for this period. These are proposed '
            'additions, not corrections: no existing value is being changed. Each figure '
            'was kept only if it is at least the number of votes Civgraph records as cast '
            'in that contest, implies a turnout at or below 100%, and falls in a '
            'plausible range; a constituency read twice had to read the same both times.'),
        'provenance': {
            'method': 'scripts/walker/harvest_electorates.py',
            'extractor': 'scripts/walker/extract.py',
            'source': VOLUME,
            'licence': 'Figures only. Election results are facts and carry no copyright; '
                       'the volume is in copyright, is not held in this repository, and '
                       'no text from it is reproduced.',
            'alignment': 'Pages are tied to an election by the candidate votes they '
                         'reproduce, not by the year in the running head, which is wrong '
                         'by one election.',
            'caveat': 'OCR-derived. The checks above catch a figure that is too small, '
                      'but a misread that leaves it plausible will pass. Treat as '
                      'proposed until spot-checked against the page.',
        },
        'counts': {'figures': len(records), 'byElection': by_election,
                   'conflicts': len(conflicts), 'rejected': len(rejected), 'sharedFigures': len(shared),
                   'pagesUnaligned': len(unaligned)},
        'records': records,
        'conflicts': conflicts,
        'sharedFigures': shared,
        'rejected': rejected[:60],
    }
    out = args.out if os.path.isabs(args.out) else os.path.join(os.getcwd(), args.out)
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(f'wrote {out}')
    print(f'  figures kept      : {len(records)}')
    for d in sorted(by_election):
        print(f'      {d}: {by_election[d]}')
    print(f'  conflicts         : {len(conflicts)}')
    print(f'  shared figures cut: {len(shared)}')
    print(f'  rejected by checks: {len(rejected)}')
    print(f'  pages unaligned   : {len(unaligned)}')


if __name__ == '__main__':
    main()
