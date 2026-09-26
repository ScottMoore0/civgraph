#!/usr/bin/env python3
"""Give each 1832-1922 Irish Westminster candidacy the Wikipedia article it links to, as its
source person id.

    python scripts/walker/stamp_wikipedia_person_ids.py [--write]

These contests have no source person ids, so the manifest keys each candidacy by its name
and party. That splits a man whose label changed (Robert Bateson, Tory in 1832 and
Conservative from 1835) and joins a father to a son of the same name and party (Daniel
O'Connell and Daniel O'Connell Jnr, at Dundalk in 1846 and County Carlow in 1841). The
constituency articles' election boxes link each candidate to his own article, redirects
resolved (wikipedia-irish-constituency-boxes-1832-1922.json, `person`), and that article is
who he is. It is stamped as `sourcePersonId: "wikipedia:<title>"` wherever the box candidate
is found again unambiguously: same election, same seat, same surname, and the same votes
where both give them. A candidacy that already has a source id is left alone.

The same pass restores a generational suffix the name lost: a box's "Robert Bateson, Snr."
was imported as "Robert Bateson", and a box that shows "Daniel O'Connell" while linking
"Daniel O'Connell Jnr" takes the article's form.
"""
import collections
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crosscheck_constituency_boxes import surname  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
BOXES = os.path.join(ROOT, 'data', 'elections', 'wikipedia-irish-constituency-boxes-1832-1922.json')
SRC = os.path.join(ROOT, 'data', 'elections-source', 'data', 'elections', 'house-of-commons-of-the-united-kingdom')
LAST = '1922-11-15'
COMPASS = {'n': 'north', 's': 'south', 'e': 'east', 'w': 'west', 'mid': 'mid',
           'ne': 'east north', 'nw': 'north west', 'se': 'east south', 'sw': 'south west'}
DROP = {'county', 'borough', 'city', 'town', 'division', 'of', 'the', 'and', 'constituency', 'uk', 'parliament'}
SUFFIX = {'jnr.': 'Jnr', 'jnr': 'Jnr', 'snr.': 'Snr', 'snr': 'Snr'}


def seat(name):
    n = re.sub(r"[^a-z ]", ' ', (name or '').lower().replace("'", '').replace('&', ' '))
    return ' '.join(sorted(' '.join(COMPASS.get(t, t) for t in n.split() if t not in DROP).split()))


def votes(row):
    v = str(row.get('Total_Votes') or row.get('Candidate_First_Pref_Votes') or '').replace(',', '').strip()
    return int(v) if v.isdigit() else None


def row_name(row):
    """The candidate's name. An unopposed row imported one column to the left carries the
    name in the vote fields and the party in the name (the manifest's
    repairShiftedUnopposedRows puts it back at build time); read it where it is."""
    shifted = str(row.get('Total_Votes') or '').strip()
    if (shifted and re.search(r'[A-Za-z]{2}', shifted) and not re.fullmatch(r'[\d,.\s]+', shifted)
            and str(row.get('Candidate_First_Pref_Votes') or '').strip() == shifted):
        return re.sub(r'\s*\[[^\]]*\]', '', shifted).strip(), True
    return (row.get('candidateName') or '').strip(), False


def load_boxes():
    by_seat = collections.defaultdict(list)
    for b in json.load(open(BOXES, encoding='utf-8'))['records']:
        by_seat[seat(b['constituency'])].append(b)
    return by_seat


def boxes_for(by_seat, keys, date):
    """Boxes that could be this contest: one on its date, an undated one of its year, or a
    general-election box of its year -- those carry the seat's own polling day, which is
    rarely the nominal date the contest is filed under."""
    year = int(date[:4])
    out = []
    for k in keys:
        for b in by_seat.get(k, []):
            if b.get('date') == date or b['year'] == year and (not b.get('date') or b['kind'] == 'general'):
                out.append(b)
    return out


def days_apart(a, b):
    import datetime
    try:
        return abs((datetime.date.fromisoformat(a) - datetime.date.fromisoformat(b)).days)
    except (TypeError, ValueError):
        return 366


def stamp_file(path, date, by_seat, stats, write):
    doc = json.load(open(path, encoding='utf-8'))
    ci = doc.get('Constituency') or {}
    rows = ci.get('countGroup') or []
    if not rows:
        return
    slug = os.path.basename(path)[:-5]
    keys = {seat(slug.replace('-', ' ')), seat((ci.get('countInfo') or {}).get('Constituency_Name'))}
    boxes = boxes_for(by_seat, keys, date)
    if not boxes:
        stats['files without a box'] += 1
        return
    names = {surname(row_name(r)[0]) for r in rows}
    polled = {(surname(row_name(r)[0]), votes(r)) for r in rows if votes(r) is not None}
    # Of several boxes that year (the general and a by-election, January and December 1910,
    # a county and a borough of one name), take the one whose people these are, then the one
    # whose figures these are, then the nearest in date.
    scored = sorted(((len(names & {surname(c['name']) for c in b['candidates']}),
                      len(polled & {(surname(c['name']), c['votes']) for c in b['candidates']}),
                      -days_apart(b.get('date'), date), i) for i, b in enumerate(boxes)), reverse=True)
    if not scored[0][0] or (len(scored) > 1 and scored[1][:3] == scored[0][:3]):
        stats['files with no single matching box'] += 1
        return
    box = boxes[scored[0][3]]
    stats['files matched to a box'] += 1
    dirty = False
    for r in rows:
        if r.get('sourcePersonId') or r.get('ei_candidate_id'):
            stats['rows already carrying a source id'] += 1
            continue
        member, shifted = row_name(r)
        s = surname(member)
        same = [c for c in box['candidates'] if surname(c['name']) == s]
        if len(same) > 1:
            same = [c for c in same if c['votes'] == votes(r)]
        if len(same) != 1:
            stats['rows not found in the box'] += 1
            continue
        c = same[0]
        base = member
        tail = c['name'].split(',', 1)[1].strip().lower() if ',' in c['name'] else ''
        name = base
        if tail in SUFFIX and not base.endswith(SUFFIX[tail]):
            name = f'{base} {SUFFIX[tail]}'
        elif c.get('person') and c['person'] in (f'{base} Jnr', f'{base} Snr'):
            name = c['person']
        if name != base and not shifted:
            r['candidateName'] = name
            stats['names given back a Jnr/Snr'] += 1
            dirty = True
        if not c.get('person'):
            stats['rows whose box name has no article'] += 1
            continue
        spid = 'wikipedia:' + c['person']
        if r.get('sourcePersonId') != spid:
            r['sourcePersonId'] = spid
            dirty = True
        stats['rows stamped'] += 1
    if dirty:
        stats['files changed'] += 1
        if write:
            with open(path, 'w', encoding='utf-8') as fh:
                json.dump(doc, fh, indent=2, ensure_ascii=False)
                fh.write('\n')


def main(write=False):
    by_seat = load_boxes()
    stats = collections.Counter()
    for d in sorted(os.listdir(SRC)):
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', d) or d >= LAST:
            continue
        for path in sorted(glob.glob(os.path.join(SRC, d, '*.json'))):
            stamp_file(path, d, by_seat, stats, write)
    print(json.dumps(dict(stats), indent=1))
    if not write:
        print('dry run; --write to apply')


if __name__ == '__main__':
    main('--write' in sys.argv)
