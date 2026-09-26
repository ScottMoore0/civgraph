#!/usr/bin/env python3
"""Pair each Irish by-election on Wikipedia's lists (1832-1922) with its constituency election
box, and check it: the box's winner against the list's, and the box's votes against Walker.

    python scripts/walker/crosscheck_byelection_boxes.py

The list supplies the date (four in ten boxes lack one) and an independently compiled winner;
Walker's transcriptions (walker-pre1885-results.json for 1832-1884, walker-byelections-1885-1922.json
after) supply figures. Status per by-election:
  agrees       box winner = list winner, and every vote compared with Walker agrees
  winner-only  box winner = list winner; Walker has no comparable figure
  votes-differ box winner = list winner, but a figure differs from Walker's OCR (review)
  held         no box, or the box's winner is not the list's
"""
import collections
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crosscheck_constituency_boxes import surname, exact, seat_key  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
D = os.path.join(ROOT, 'data', 'elections')


def main():
    lists = json.load(open(os.path.join(D, 'wikipedia-uk-byelection-lists-ireland.json'), encoding='utf-8'))['records']
    boxes = [b for b in json.load(open(os.path.join(D, 'wikipedia-irish-constituency-boxes-1832-1922.json'), encoding='utf-8'))['records']
             if b['kind'] == 'by-election']
    pre = [w for w in json.load(open(os.path.join(D, 'walker-pre1885-results.json'), encoding='utf-8'))['records']
           if w['kind'] == 'by-election']
    post = json.load(open(os.path.join(D, 'walker-byelections-1885-1922.json'), encoding='utf-8'))['records']

    by_seat = collections.defaultdict(list)
    for b in boxes:
        by_seat[exact(b['constituency'])].append(b)
    walker = collections.defaultdict(list)
    for w in pre + post:
        k, cls = seat_key(w['constituency'])
        walker[(w['year'], k)].append(w)

    def stems(name):
        e = exact(name)
        s = re.sub(r'^county |\b(city|borough|town)$', '', e).strip()
        return dict.fromkeys([e, s, 'county ' + s, s + ' city', s + ' borough', s + ' town'])

    used, out, tally = set(), [], collections.Counter()
    for row in lists:
        year = int(row['date'][:4])
        cands = [b for n in stems(row['constituency']) for b in by_seat.get(n, []) if id(b) not in used]
        exact_date = [b for b in cands if b['date'] == row['date']]
        undated = [b for b in cands if not b['date'] and b['year'] == year]
        if not exact_date and len(undated) > 1:
            # Two by-elections in one seat in one year, neither box dated: the winner decides.
            undated = [b for b in undated if any(surname(c['name']) == surname(row['winner']) for c in b['candidates'])]
        box = exact_date[0] if exact_date else (undated[0] if len(undated) == 1 else None)
        rec = {'date': row['date'], 'constituency': row['constituency'], 'winnerOnList': row['winner'],
               'outgoing': row['outgoing'], 'cause': row['cause'], 'list': row['list']}
        if not box:
            rec['status'] = 'held'
            rec['why'] = 'no election box found' if not undated else 'several undated boxes that year'
            tally['held: no box'] += 1
            out.append(rec)
            continue
        used.add(id(box))
        rec['article'] = box['url']
        polled = [c for c in box['candidates'] if c['votes'] is not None]
        winner = max(polled, key=lambda c: c['votes']) if polled else box['candidates'][0]
        rec['winnerInBox'] = winner['name']
        if surname(winner['name']) != surname(row['winner']):
            rec['status'] = 'held'
            rec['why'] = 'box winner differs from the list'
            tally['held: winner differs'] += 1
            out.append(rec)
            continue
        k, cls = seat_key(row['constituency'])
        ws = walker.get((year, k), [])
        compared, diffs = 0, []
        for w in ws:
            wv = {surname(c['name']): c.get('votes') for c in w['candidates'] if c.get('votes')}
            for c in polled:
                s = surname(c['name'])
                if s in wv:
                    compared += 1
                    if wv[s] != c['votes']:
                        diffs.append({'name': c['name'], 'wikipedia': c['votes'], 'walker': wv[s], 'page': w['page']})
        rec['walker'] = {'compared': compared, 'differences': diffs}
        rec['status'] = 'votes-differ' if diffs else ('agrees' if compared else 'winner-only')
        tally[rec['status']] += 1
        out.append(rec)
    tally['boxes not on any list'] = sum(1 for b in boxes if id(b) not in used)
    with open(os.path.join(D, 'wikipedia-byelection-crosscheck-1832-1922.json'), 'w', encoding='utf-8') as fh:
        json.dump({'schemaVersion': 1, 'counts': dict(tally), 'records': out}, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(json.dumps(dict(tally)))


if __name__ == '__main__':
    main()
