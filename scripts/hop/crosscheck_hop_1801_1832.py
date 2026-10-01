#!/usr/bin/env python3
"""Check the 1801-1832 Irish contests against the History of Parliament.

    python scripts/hop/crosscheck_hop_1801_1832.py

HoP (hop-irish-constituencies.json, from extract_hop_ireland.py) is a third reading of the
contests Civgraph took from Walker (walker-1801-1831-results.json) and checked against
Wikipedia. Each HoP contest is paired with Walker's for the same seat within a month (or
the same year where Walker prints no day), and the members returned and the votes are
compared. Output: data/elections/hop/hop-crosscheck-1801-1832.json, with
  - agrees / differs for every pair (and what differs);
  - HoP contests Walker has none of -- among them the 1810-12 contests on the book page
    missing from the scan;
  - Walker contests HoP has none of.
Nothing is imported here.
"""
import collections
import datetime
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'walker'))
from crosscheck_walker_1801_1831 import keys, fuzzy, plain, same_people  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
D = os.path.join(ROOT, 'data', 'elections')
HOP = os.path.join(D, 'hop', 'hop-irish-constituencies.json')
WALKER = os.path.join(D, 'walker-1801-1831-results.json')
LAST = '1832-12-08'   # the 1832 general election belongs to the next volume

HOP_BOROUGHS = None


def hop_seat(slug):
    s = slug.lower()
    if s == 'dublin-university':
        return ('university', 'dublin')
    if s == 'bandon-bridge':
        return ('borough', 'bandon')
    if s in ('kings-county',):
        return ('county', 'kings')
    if s in ('queens-county', 'queens-co'):
        return ('county', 'queens')
    m = re.match(r'^(?:co|county)-(.+)$', s)
    return ('county', m.group(1)) if m else ('borough', s)


def walker_seat(name):
    n = name.lower().replace("'", '').strip()
    if n == 'dublin university':
        return ('university', 'dublin')
    if n.startswith('kings county'):
        return ('county', 'kings')
    if n.startswith('queens county'):
        return ('county', 'queens')
    if n.endswith(' county'):
        return ('county', n[:-7].strip().replace(' ', '-'))
    stem = re.sub(r' city$', '', n).replace(' ', '-')
    # A bare name with no borough of that name is the county: Roscommon, Tipperary, Westmeath.
    return ('borough', stem) if stem in HOP_BOROUGHS else ('county', stem)


def day(s):
    try:
        return datetime.date.fromisoformat(s)
    except (TypeError, ValueError):
        return None


def main():
    global HOP_BOROUGHS
    hop = json.load(open(HOP, encoding='utf-8'))['constituencies']
    walker = json.load(open(WALKER, encoding='utf-8'))['records']
    HOP_BOROUGHS = {hop_seat(c['slug'])[1] for c in hop if hop_seat(c['slug'])[0] == 'borough'}

    hop_contests = []
    for c in hop:
        for e in c['elections']:
            if not e['date'] or e['date'][:4] < '1801' or e['date'] >= LAST:
                continue
            hop_contests.append({'seat': hop_seat(c['slug']), 'constituency': c['name'], 'url': c['url'],
                                 'volume': c['volume'], **e})
    # The two volumes overlap on the 1820 general election and its sequels: keep the later
    # volume's reading of a contest both print.
    seen, unique = set(), []
    for h in sorted(hop_contests, key=lambda h: h['volume'], reverse=True):
        k = (h['seat'], h['date'])
        if k not in seen:
            seen.add(k)
            unique.append(h)

    by_seat = collections.defaultdict(list)
    for w in walker:
        by_seat[walker_seat(w['constituency'])].append(w)

    used, out, tally = set(), [], collections.Counter()
    for h in sorted(unique, key=lambda h: (h['seat'], h['date'])):
        hd = day(h['date']) or day(h['date'] + '-01') if len(h['date']) == 7 else day(h['date'])
        best = None
        for i, w in enumerate(by_seat.get(h['seat'], [])):
            # Kinds must agree, except on the same day: HoP prints some 1801 polls upright.
            if id(w) in used or ((w['kind'] == 'by-election') != h['byElection'] and w['date'] != h['date']):
                continue
            wd = day(w['date'])
            if wd and hd:
                gap = abs((wd - hd).days)
            elif str(w['electionYear']) == h['date'][:4]:
                gap = 0
            else:
                continue
            if gap <= 31 and (best is None or gap < best[0]):
                best = (gap, w)
        rec = {'seat': '/'.join(h['seat']), 'constituency': h['constituency'], 'hopUrl': h['url'],
               'hopVolume': h['volume'], 'date': h['date'], 'byElection': h['byElection'],
               'hop': [{'name': c['name'], 'designation': c['designation'], 'returned': c['returned'],
                        'votes': c['votes'], 'note': c['note'], 'member': c['member']} for c in h['candidates']],
               'hopNotes': h.get('outcomes') or []}
        if not best:
            rec['status'] = 'not in Walker'
            tally['HoP contest not in Walker'] += 1
            out.append(rec)
            continue
        gap, w = best
        used.add(id(w))
        rec['walker'] = {'page': w['page'], 'constituency': w['constituency'], 'date': w['date'],
                         'candidates': w['candidates']}
        # A peer's title is part of how he is named ("JOHN WILLIAM PONSONBY, Visct. Duncannon"
        # is Walker's "Viscount Duncannon"), so it is matched with the name.
        named = lambda c: c['name'] + (f" ({c['designation']})" if c.get('designation') else '')
        h_ret = [named(c) for c in h['candidates'] if c['returned']]
        w_ret = [plain(c['name']) for c in w['candidates'] if c.get('returned')]
        returned_ok = same_people(w_ret, h_ret) if w_ret and h_ret else (not w_ret and not h_ret)
        # After petition: HoP's seated member in place of the one unseated, against Walker's.
        h_after = list(h_ret)
        for pt in h.get('petitions') or []:
            drop = next((x for x in h_after if pt['unseated'] and keys(pt['unseated']) & keys(x)), None)
            if drop:
                h_after.remove(drop)
            h_after.append(pt['seated'])
        w_after = [n for n in w_ret if n not in (w.get('unseatedOnPetition') or [])] + list(w.get('seatedOnPetition') or [])
        petition_ok = bool(h.get('petitions')) and (same_people(w_ret, h_ret) or same_people(w_after, h_after)
                                                     or same_people(w_ret, h_after))
        vote_diffs = []
        for hc in h['candidates']:
            if not hc['votes']:
                continue
            wc = next((c for c in w['candidates'] if c.get('votes') is not None and
                       (keys(plain(c['name'])) & keys(hc['name']) or fuzzy(keys(plain(c['name'])), keys(hc['name'])))), None)
            if wc and wc['votes'] != hc['votes'][-1] and wc['votes'] not in hc['votes']:
                vote_diffs.append({'name': hc['name'], 'hop': hc['votes'], 'walker': wc['votes']})
        rec['dateGapDays'] = gap
        rec['petitions'] = h.get('petitions') or []
        rec['outcomes'] = h.get('outcomes') or []
        ok = returned_ok or petition_ok
        rec['status'] = ('agrees' if ok and not vote_diffs else 'votes differ' if ok else 'members differ')
        rec['voteDifferences'] = vote_diffs
        tally[rec['status']] += 1
        out.append(rec)
    walker_only = [{'constituency': w['constituency'], 'kind': w['kind'], 'year': w['electionYear'], 'date': w['date'],
                    'page': w['page']} for ws in by_seat.values() for w in ws if id(w) not in used]
    tally['Walker contest not in HoP'] = len(walker_only)
    doc = {'schemaVersion': 1, 'counts': dict(tally), 'records': out, 'walkerOnly': walker_only}
    with open(os.path.join(D, 'hop', 'hop-crosscheck-1801-1832.json'), 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(json.dumps(dict(tally), indent=1))


if __name__ == '__main__':
    main()
