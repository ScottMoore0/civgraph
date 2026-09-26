#!/usr/bin/env python3
"""Harvest Gallagher's Irish Elections 1922-44 into Civgraph.

    python scripts/walker/harvest_gallagher.py <path to the PDF> [--write-byelections]

Gallagher is the standard compilation of the 1922-44 Dail results: no official record of a
general election before 1948 exists, and he rebuilt every count from the provincial press,
cross-checking paper against paper. His book is published free by TCD's Department of
Political Science, so it can be linked; it is still in copyright, and nothing is taken from
it but figures.

Writes:
  data/elections/corrections/gallagher-dail-electorates.json
      Gallagher's electorate and valid poll for every 1922-44 general-election contest,
      against what the site shows. Where the site has no electorate the record is `fill`,
      and the manifest overlay supplies it; where the two agree, `agrees`; where they
      differ, `differs`, left for a tiebreak (see crosscheck in the record).
  data/elections/gallagher-byelections-1923-44.json
      every by-election in full: candidates, first preferences, counts, the cause.
  with --write-byelections, a Civgraph source file per by-election under
      data/elections-source/data/elections/dail-eireann/<date>/, in the Dail schema, and the
      dates in elections_index.json.
"""
import argparse
import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gallagher  # noqa: E402
import pymupdf  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SOURCE = {
    'title': 'Irish Elections 1922-44: Results and Analysis', 'author': 'Michael Gallagher',
    'publisher': 'PSAI Press', 'year': 1993,
    'url': 'https://www.tcd.ie/Political_Science/about/people/michael_gallagher/IrishElections1922to1944WithCovers.pdf',
    'archiveUrl': 'https://web.archive.org/web/20241115172124/https://www.tcd.ie/Political_Science/about/people/michael_gallagher/IrishElections1922to1944WithCovers.pdf',
}
GE_DATES = {(1922, None): '1922-06-16', (1923, None): '1923-08-27', (1927, 'June'): '1927-06-09',
            (1927, 'Sept'): '1927-09-15', (1932, None): '1932-02-16', (1933, None): '1933-01-24',
            (1937, None): '1937-07-01', (1938, None): '1938-06-17', (1943, None): '1943-06-22',
            (1944, None): '1944-05-30'}
# Gallagher's party headings, in the labels the 1922-44 Dail files already use.
PARTIES = {'Republicans': 'Republican', 'Labour': 'Irish Labour', 'Cumann na nGaedheal': 'Cumann na nGaedheal',
           'Fianna Fáil': 'Fianna Fáil', 'Fine Gael': 'Fine Gael', 'Farmers': 'Farmers',
           'Clann na Talmhan': 'Clann na Talmhan', 'National League': 'National League',
           'Independents': 'Independent', 'Independent': 'Independent', 'Ind': 'Independent',
           'Sinn Féin': 'Sinn Féin', 'Irish Workers League': "Irish Worker League"}


# Where Gallagher and the site differ, the tiebreak is Walker (1992), read from the scans.
DECISIONS = {
    ('1927-06-09', 'Dublin South'): ('gallagher', 'Walker gives 79,639, as Gallagher does; the site had 81,136.'),
    ('1927-09-15', 'Kildare'): ('gallagher', 'Walker gives 34,815, as Gallagher does; the site had 38,815, one digit different.'),
    ('1927-09-15', 'Leitrim Sligo'): ('gallagher', 'Walker gives 72,640, as Gallagher does; the site had 72,573.'),
    ('1927-09-15', 'Longford Westmeath'): ('gallagher', 'Walker gives 56,079, as Gallagher does; the site had 56,059.'),
    ('1927-09-15', 'Dublin County'): ('gallagher', "Gallagher gives 110,840 for both 1927 elections, which shared a register, "
                                     "and the site gives 110,840 for June; Walker prints 100,840, one digit from "
                                     "Gallagher, and his quota (8,023) matches Gallagher's. The site had 113,260."),
    ('1922-06-16', 'Limerick City and East'): ('gallagher', "No third source: Walker prints no electorate for the 1922 "
                                               "seats returned unopposed. Gallagher agrees with the site on 75 of 81 "
                                               "electorates, and Walker sided with him in every other dispute. The site "
                                               "had 46,911, one digit from Gallagher's 46,991."),
}


# Valid polls that differ from Gallagher and are kept, with the reason.
VALID_KEPT = {
    ('1923-08-27', 'Longford Westmeath'): (
        "Kept at 34,845, the first-count figures the newspapers reported. Gallagher gives 35,408, the valid "
        "poll later reports and the Department of Local Government's record give, but says his candidate "
        "figures are those reports scaled up to it, not a count."),
    ('1927-06-09', 'Mayo South'): (
        "Kept at 34,162. Gallagher has 2,884 for Fitzgerald-Kenney where Walker and ElectionsIreland have 2,886."),
}


def key(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower().replace('-', ' ')
    s = (s.replace('laois', 'leix').replace('laoighis', 'leix').replace('univeristy', 'university')
         .replace('borough', '').replace(' city', '').replace(' and ', ' '))
    return ' '.join(sorted(re.sub(r'[^a-z ]', ' ', s).split()))


def slug(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def electorates(doc):
    ge = gallagher.general_elections(doc)
    meta = os.path.join(ROOT, 'render', 'metadata', 'elections-test2')
    built = {}
    records, unmatched = [], []
    for g in ge:
        date = GE_DATES[(g['year'], g['month'])]
        if date not in built:
            doc2 = json.load(open(os.path.join(meta, f'dail-eireann__{date}.json'), encoding='utf-8'))
            built[date] = {key(r['constituency']): r for r in doc2['results']}
        r = built[date].get(key(g['constituency']))
        if not r:
            unmatched.append((date, g['constituency']))
            continue
        site = r.get('electorate')
        status = 'fill' if not site else ('agrees' if site == g['electorate'] else 'differs')
        records.append({'date': date, 'constituency': r['constituency'], 'sourceFile': r.get('sourceFile'),
                        'gallagher': {'electorate': g['electorate'], 'validVotes': g.get('validVotes'),
                                      'quota': g.get('quota'), 'seats': g.get('seats'), 'page': g['page']},
                        'site': {'electorate': site, 'validVotes': r.get('validPoll')},
                        'status': status})
    return records, unmatched


def seats_of(b):
    v, q = b.get('validVotes'), b.get('quota')
    if v and q:
        return max(1, round(v / q) - 1)
    return 1


def finish_byelection(b):
    """Party labels from the notes, seat count from the quota, and who was elected."""
    others = {}
    for note in b.get('notes', []):
        for part in re.split(r';', re.sub(r'^Others?:\s*', '', note)):
            if '—' in part:
                surname, label = part.split('—', 1)
                others[surname.strip().lower()] = label.strip(' .')
    b['seats'] = seats_of(b)
    q = b.get('quota') or 10 ** 9
    for c in b['candidates']:
        heading = c.pop('party')
        surname = c['name'].split()[-1].lower() if c['name'] else ''
        c['party'] = others.get(surname) if heading in ('Others', 'Other') and surname in others else \
            PARTIES.get(heading, 'Independent' if heading in ('Others', 'Other') else heading)
        c['partyAsPrinted'] = heading
    # Elected: reached the quota at some count, or among the last standing when the seats
    # were filled without it. A single seat is simply the candidate with the last and
    # largest total.
    if b['candidates'] and all(c.get('unopposed') for c in b['candidates']):
        for c in b['candidates']:
            c['elected'] = True
        return b
    reached = [c for c in b['candidates'] if c['counts'] and max(c['counts']) >= q]
    rest = sorted((c for c in b['candidates'] if c not in reached),
                  key=lambda c: (len(c['counts']), c['counts'][-1] if c['counts'] else 0), reverse=True)
    winners = (reached + rest)[:b['seats']]
    for c in b['candidates']:
        c['elected'] = c in winners
    return b


def summary_counts(c, b):
    """[first preferences, quota share, count elected or eliminated, order of election]."""
    if c.get('unopposed'):
        return []
    fp, q = c['firstPreferences'] or 0, b.get('quota')
    event = len(c['counts']) or 1
    winners = sorted((x for x in b['candidates'] if x['elected']),
                     key=lambda x: (len(x['counts']), -(x['counts'][-1] if x['counts'] else 0)))
    order = winners.index(c) + 1 if c in winners else 0
    return [fp, round(fp / q, 2) if q else 0, event, order]


def write_count_sidecar(b, slug_name):
    """The count-by-count totals, for a by-election that went beyond the first count, in the
    form the manifest reads Dail counts from (the Wikipedia count sidecars). The source is
    named as Gallagher: nothing here came from Wikipedia."""
    n = max((len(c['counts']) for c in b['candidates']), default=0)
    if n < 2:
        return None
    d = os.path.join(ROOT, 'data', 'elections', 'dail-wikipedia-counts', b['date'])
    os.makedirs(d, exist_ok=True)
    winners = [c for c in b['candidates'] if c['elected']]
    doc = {
        'schemaVersion': 1, 'source': 'Gallagher 1993',
        'pageTitle': SOURCE['title'], 'pageUrl': SOURCE['url'],
        'sectionTitle': f"By-election no. {b['number']}, p. {b['page']}",
        'electionDate': b['date'], 'constituency': b['constituency'], 'numCounts': n,
        'importedAt': '2026-09-26',
        'candidates': [{
            'id': str(i + 1), 'name': c.get('nameAdopted') or c['name'], 'party': c['party'],
            'percentage': c.get('firstPreferencePct'),
            'counts': c['counts'] + [None] * (n - len(c['counts'])),
            'electedAt': len(c['counts']) if c in winners else None,
            'lastCount': len(c['counts']),
            'status': 'Elected' if c in winners else ('Not elected' if len(c['counts']) == n else 'Excluded'),
        } for i, c in enumerate(b['candidates'])],
    }
    path = os.path.join(d, slug_name + '.json')
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    return path


def write_byelection_files(byes):
    base = os.path.join(ROOT, 'data', 'elections-source', 'data', 'elections', 'dail-eireann')
    written = []
    for b in byes:
        d = os.path.join(base, b['date'])
        os.makedirs(d, exist_ok=True)
        name = b['constituency']
        doc = {
            'meta': {k: v for k, v in {'electorate': b.get('electorate'), 'valid_poll': b.get('validVotes'),
                                       'turnoutPct': b.get('turnout'), 'seats': b['seats'],
                                       'quota': b.get('quota')}.items() if v is not None},
            'constituency': name, 'year': int(b['date'][:4]), 'kind': 'by-election',
            # The Dail files' `counts` is ElectionsIreland's summary, not the count: first
            # preferences, share of the quota, the count at which the candidate was elected
            # or eliminated, and the order of election. Given running totals instead, the
            # domain read a final total of 24,491 as "elected on count 24,491" and built
            # 24,491 count stages. The count itself goes in a sidecar (below).
            'candidates': [{k: v for k, v in {
                'name': c.get('nameAdopted') or c['name'], 'party': c['party'], 'first_pref': c['firstPreferences'],
                'counts': summary_counts(c, b), 'status': 'Elected' if c['elected'] else '',
                'ei_candidate_id': c.get('eiCandidateId'),
                'nameAsPrintedByGallagher': c['name'] if c.get('nameAdopted') else None,
                'nameInDispute': c.get('nameInDispute')}.items() if v is not None}
                for c in b['candidates']],
            'cause': b.get('cause'),
            'sources': [dict(SOURCE, locator=f"By-election no. {b['number']}, p. {b['page']}")],
        }
        ei = (b.get('crosscheck') or {}).get('electionsIreland')
        if ei:
            doc['source_url'] = ei['url']
        if b.get('crosscheck'):
            doc['crosscheck'] = b['crosscheck']
        if b.get('decision'):
            doc['decision'] = b['decision']
        path = os.path.join(d, slug(name) + '.json')
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(doc, fh, indent=1, ensure_ascii=False)
            fh.write('\n')
        write_count_sidecar(b, slug(name))
        idx = os.path.join(d, '_index.json')
        entries = json.load(open(idx, encoding='utf-8')) if os.path.exists(idx) else []
        entries = [e for e in entries if e.get('name') != name] + [
            {'name': name, 'cons_id': None, 'candidates': len(doc['candidates']), 'seats': b['seats']}]
        with open(idx, 'w', encoding='utf-8') as fh:
            json.dump(entries, fh, indent=2, ensure_ascii=False)
            fh.write('\n')
        written.append((b['date'], name))
    # The election index lists each date and its constituencies.
    ipath = os.path.join(ROOT, 'data', 'elections-source', 'data', 'elections_index.json')
    raw = open(ipath, encoding='utf-8').read()
    index = json.loads(raw)
    body = next(x for x in index['bodies'] if x['slug'] == 'dail-eireann')
    by_date = {}
    for date, name in written:
        by_date.setdefault(date, set()).add(name)
    for date, names in by_date.items():
        entry = next((x for x in body['dates'] if x['date'] == date), None)
        if entry is None:
            body['dates'].append({'date': date, 'constituencies': sorted(names)})
        else:
            entry['constituencies'] = sorted(set(entry['constituencies']) | names)
    body['dates'].sort(key=lambda x: x['date'], reverse=True)
    indent = len(re.search(r'\n( +)"bodies"', raw).group(1))
    with open(ipath, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(index, indent=indent, ensure_ascii=False) + ('\n' if raw.endswith('\n') else ''))
    return written


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('pdf')
    ap.add_argument('--write-byelections', action='store_true')
    args = ap.parse_args()
    doc = pymupdf.open(args.pdf)

    records, unmatched = electorates(doc)
    prev = os.path.join(ROOT, 'data', 'elections', 'corrections', 'gallagher-dail-electorates.json')
    decided, before = {}, {}
    if os.path.exists(prev):
        for r in json.load(open(prev, encoding='utf-8'))['records']:
            before[(r['date'], r['constituency'])] = r
            if r.get('decision'):
                decided[(r['date'], r['constituency'])] = {k: r[k] for k in ('decision', 'crosscheck', 'reason') if k in r}
    for r in records:
        r.update(decided.get((r['date'], r['constituency']), {}))
        # Once the overlay has supplied or replaced an electorate, the built site shows
        # Gallagher's figure and a re-run would read `agrees`. What the site showed before
        # the overlay is kept, so the record still says the figure came from Gallagher.
        old = before.get((r['date'], r['constituency']))
        if old and old['status'] in ('fill', 'differs'):
            r['status'] = old['status']
            r['site']['electorate'] = old['site']['electorate']
        d = DECISIONS.get((r['date'], r['constituency']))
        if d:
            r['decision'], r['reason'] = d
        if (r['date'], r['constituency']) in VALID_KEPT:
            r['validPollKept'] = VALID_KEPT[(r['date'], r['constituency'])]
    counts = {s: sum(1 for r in records if r['status'] == s) for s in ('fill', 'agrees', 'differs')}
    out = {
        'schemaVersion': 1,
        'description': ('Electorates and valid polls of every 1922-44 Dail general-election contest from '
                        'Gallagher, against what Civgraph shows. `fill`: Civgraph had no electorate and the '
                        'manifest overlay supplies Gallagher\'s. `agrees`: the same figure. `differs`: settled '
                        'per record by `decision` after a tiebreak against Walker (1992).'),
        'provenance': {'method': 'scripts/walker/harvest_gallagher.py', 'source': SOURCE,
                       'licence': 'Figures only; the book is in copyright and is not held in this repository.'},
        'counts': {**counts, 'unmatched': len(unmatched)},
        'records': records,
    }
    with open(prev, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(f'general-election contests: {len(records)} {counts}; unmatched {unmatched}')

    byes = [finish_byelection(b) for b in gallagher.by_elections(doc)]
    bpath = os.path.join(ROOT, 'data', 'elections', 'gallagher-byelections-1923-44.json')
    with open(bpath, 'w', encoding='utf-8') as fh:
        json.dump({'schemaVersion': 1,
                   'description': 'Every Dail by-election from the 1923 to the 1944 general election, from Gallagher.',
                   'provenance': {'method': 'scripts/walker/harvest_gallagher.py', 'source': SOURCE},
                   'counts': {'byElections': len(byes), 'candidates': sum(len(b['candidates']) for b in byes)},
                   'records': byes}, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(f'by-elections: {len(byes)}')
    if args.write_byelections:
        written = write_byelection_files(byes)
        print(f'wrote {len(written)} by-election files')


if __name__ == '__main__':
    main()
