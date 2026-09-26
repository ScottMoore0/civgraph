#!/usr/bin/env python3
"""Check the Wikipedia constituency election boxes against Walker and the lists of MPs.

    python scripts/walker/crosscheck_constituency_boxes.py

For each 1832-1880 general-election box:
  - the list of MPs for that election names who was returned for the seat (and so how many
    members it returned); the box's winners must agree;
  - Walker's transcription (walker-pre1885-results.json) gives votes for contested seats;
    every candidate both sources read must have the same figure.
A contest is `agrees` when the winners agree and no compared vote differs; `winners-only`
when the winners agree but Walker has no figures to compare; otherwise it is held, with
what differed. Nothing is imported here.
"""
import collections
import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harvest_wikipedia_mp_lists import key  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
BOXES = os.path.join(ROOT, 'data', 'elections', 'wikipedia-irish-constituency-boxes-1832-1922.json')
WALKER = os.path.join(ROOT, 'data', 'elections', 'walker-pre1885-results.json')
LISTS = os.path.join(ROOT, 'data', 'elections', 'wikipedia-mp-lists-ireland.json')
SUFFIX = {'bt', 'bart', 'jun', 'jr', 'sen', 'snr', 'jnr', 'ii', 'iii', 'iv', 'qc', 'kc', 'mp', 'the', 'viscount', 'lord', 'earl', 'baron',
          'sir', 'hon', 'col', 'capt', 'major', 'general', 'rt', 'dr'}


def seat_key(name):
    """Seat name, and whether it is the county or the borough of that name."""
    n = name.lower()
    cls = 'county' if re.search(r'\bcounty\b', n) else 'borough'
    return key(re.sub(r'\b(county|borough|city|town)\b', ' ', name)), cls


def surname(name):
    # "Sir Richard Nagle, 2nd Baronet", "Robert Bateson, Snr.": what follows the comma is not the name.
    s = (name or '').split(',')[0]
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'\(.*?\)', ' ', s).replace("o'", 'o').replace("'", '')
    toks = [t for t in re.split(r'[^a-z]+', s) if len(t) > 1 and t not in SUFFIX]
    return toks[-1] if toks else ''


def exact(name):
    n = unicodedata.normalize('NFKD', re.sub(r'\s*\(.*?\)\s*', ' ', name or '')).encode('ascii', 'ignore').decode().lower()
    return ' '.join(re.sub(r'[^a-z ]', ' ', n.replace("'", '')).split())


def index(records, name_of, year_of):
    out = collections.defaultdict(list)
    for r in records:
        out[(year_of(r),) + seat_key(name_of(r))].append(r)
    return out


def pick(options, cls):
    if len(options) == 1:
        return options[0]
    same = [o for o in options if o[1] == cls]
    return same[0] if len(same) == 1 else None


def main():
    boxes = json.load(open(BOXES, encoding='utf-8'))['records']
    walker = json.load(open(WALKER, encoding='utf-8'))['records']
    lists = json.load(open(LISTS, encoding='utf-8'))['records']

    wk = collections.defaultdict(list)
    for w in walker:
        if w['kind'] == 'general':
            k, cls = seat_key(w['constituency'])
            wk[(w['year'], k)].append((w, cls))
    mp = {}
    for rec in lists:
        y = int(re.search(r'\d{4}', rec['election']).group(0))
        for s in rec['seats']:
            mp[(y, exact(s['constituency']))] = s
    # A plain article title ("Armagh") is the county when a separate "Armagh City" article
    # exists, the borough when a "County Armagh" one does; otherwise Walker decides.
    titles = {exact(b['constituency']) for b in boxes}

    tally = collections.Counter()
    out = []
    for b in boxes:
        if b['kind'] != 'general' or not (1832 <= b['year'] <= 1880):
            continue
        k, cls = seat_key(b['constituency'])
        base = exact(b['constituency'])
        if not re.search(r'\b(county|city|borough|town|university)\b', base):
            if any(t in titles for t in (base + ' city', base + ' borough', base + ' town')):
                cls = 'county'
            elif 'county ' + base in titles:
                cls = 'borough'
            else:
                have = {c for _, c in wk.get((b['year'], k), [])}
                cls = next(iter(have)) if len(have) == 1 else cls
        rec = {'year': b['year'], 'constituency': b['constituency'], 'article': b['url'], 'seatType': cls}
        # The articles and the lists of MPs do not name seats alike ("Armagh" is the county in
        # one and the city in the other). Of the seats the name could mean, take the one that
        # shares the most people with the box.
        stem = re.sub(r'^county |\b(city|borough|town)$', '', base).strip()
        options = [mp[(b['year'], n)] for n in dict.fromkeys(
            [base, stem, 'county ' + stem, stem + ' city', stem + ' borough', stem + ' town'])
            if (b['year'], n) in mp]
        box_names = {surname(c['name']) for c in b['candidates']}
        scored = sorted(((len(box_names & {surname(x['name']) for x in o['members']}), i, o)
                         for i, o in enumerate(options)), reverse=True)
        m = scored[0][2] if scored and scored[0][0] > 0 else None
        members = [x['name'] for x in m['members']] if m else None
        seats = len(members) if members else (b['seats'] or 1)
        polled = [c for c in b['candidates'] if c['votes'] is not None]
        winners = sorted(polled, key=lambda c: -c['votes'])[:seats] if polled else b['candidates'][:seats]
        rec['seats'] = seats
        rec['winners'] = [c['name'] for c in winners]
        # The Walker harvest files part of 1865 under a phantom "1866" general election
        # (the running head misread); for 1865 both are the same contest.
        wopts = wk.get((b['year'], k), []) + (wk.get((1866, k), []) if b['year'] == 1865 else [])
        w = pick(wopts, cls)
        if members is None and w:
            # 1865's list of MPs on Wikipedia is incomplete: Walker's return is the check.
            wc = w[0]['candidates']
            wpolled = [c for c in wc if c.get('votes')]
            wwin = sorted(wpolled, key=lambda c: -c['votes'])[:seats] if wpolled else wc[:seats]
            want, got = sorted(surname(c['name']) for c in wwin), sorted(surname(c['name']) for c in winners)
            rec['walkerWinnersAgree'] = want == got
            rec['mpListAgrees'] = want == got
            tally['winners checked against Walker (no MP list)'] += 1
        elif members is None:
            rec['mpList'] = 'no seat found'
            tally['no MP-list seat'] += 1
        else:
            want = sorted(surname(x) for x in members)
            got = sorted(surname(c['name']) for c in winners)
            rec['mpListAgrees'] = want == got
            tally['winners agree with MP list' if want == got else 'winners differ from MP list'] += 1
        diffs, compared = [], 0
        if w:
            wv = {surname(c['name']): c.get('votes') for c in w[0]['candidates'] if c.get('votes')}
            for c in polled:
                s = surname(c['name'])
                if s in wv:
                    compared += 1
                    if wv[s] != c['votes']:
                        diffs.append({'name': c['name'], 'wikipedia': c['votes'], 'walker': wv[s]})
        rec['walker'] = {'compared': compared, 'differences': diffs} if w else None
        if rec.get('mpListAgrees') and not diffs:
            rec['status'] = 'agrees' if compared else 'winners-only'
        else:
            rec['status'] = 'held'
        tally[rec['status']] += 1
        tally['votes compared'] += compared
        tally['votes differing'] += len(diffs)
        out.append(rec)
    path = os.path.join(ROOT, 'data', 'elections', 'wikipedia-boxes-crosscheck-1832-1880.json')
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump({'schemaVersion': 1, 'counts': dict(tally), 'records': out}, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(json.dumps(dict(tally)))


if __name__ == '__main__':
    main()
