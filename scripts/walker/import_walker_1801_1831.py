#!/usr/bin/env python3
"""Import the 1801-1831 Irish Westminster results read from Walker's pages.

    python scripts/walker/import_walker_1801_1831.py [--write]

Walker is the source (walker-1801-1831-results.json, read off the printed page) and
Wikipedia the check (walker-1801-1831-crosscheck.json). A contest is imported when its
members agree with Wikipedia's list of MPs or list of by-elections, or when DECISIONS below
records, after reading both, that they are the same men under another name or style. The
rest are held and reported in walker-1801-1831-import-report.json.

Each member returned is given the Wikipedia article his listed name links to as
sourcePersonId (wikipedia-member-links-ireland-1801-1831.json), the key the 1832-1922
candidacies carry, so a member who sat either side of 1832 is one person. Defeated
candidates have no such link and are keyed by name. No party is printed before 1832.
"""
import collections
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crosscheck_constituency_boxes import exact, surname  # noqa: E402
from crosscheck_walker_1801_1831 import keys, fuzzy, member, plain, seat_keys  # noqa: E402
from import_wikipedia_boxes import BODY, SRC, WALKER, slug  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
D = os.path.join(ROOT, 'data', 'elections')
# The first polling day of each general election, from Wikipedia's article on it (the
# same convention as the 1832-1880 dates in import_wikipedia_boxes.py).
GE_DATES = {1802: '1802-07-05', 1806: '1806-10-29', 1807: '1807-05-04', 1812: '1812-10-05', 1818: '1818-06-17',
            1820: '1820-03-06', 1826: '1826-06-07', 1830: '1830-07-29', 1831: '1831-04-28'}

# Contests the check could not settle by itself, decided after reading both sources. Key:
# (kind, year, Walker's constituency). 'import' = same men, the list names them otherwise.
DECISIONS = {
    ('general', 1802, 'Mayo county'): ('import', 'Henry Augustus Dillon is the list\'s Henry Dillon-Lee'),
    ('general', 1812, 'Cork county'): ('import', 'Hon. Richard Hare is the list\'s Viscount Ennismore, his later style'),
    ('general', 1818, 'Cork county'): ('import', 'Hon. Richard Hare is the list\'s Viscount Ennismore, his later style'),
    ('general', 1818, 'Donegal county'): ('import', 'Mountcharles and Mount Charles are one title'),
    ('general', 1820, 'Donegal county'): ('import', 'the list names only the Earl of Mount Charles; Walker gives Hart as well'),
    ('general', 1826, 'Donegal county'): ('import', 'Mountcharles and Mount Charles are one title'),
    ('general', 1830, 'Donegal county'): ('import', 'Mountcharles and Mount Charles are one title'),
    ('general', 1818, 'Wicklow county'): ('import', 'William Hayes Parnell is the list\'s William Parnell-Hayes'),
    ('general', 1820, 'Wicklow county'): ('import', 'William Hayes Parnell is the list\'s William Parnell-Hayes'),
    ('general', 1818, 'Carlow'): ('import', 'Charles Harvey is the list\'s Charles Harvey-Saville-Onley'),
    ('general', 1826, 'Mallow'): ('import', 'Charles Denham Orlando Jephson is the list\'s Sir Denham Jephson-Norreys'),
    ('general', 1830, 'Mallow'): ('import', 'Charles Denham Orlando Jephson is the list\'s Sir Denham Jephson-Norreys'),
    ('general', 1831, 'Mallow'): ('import', 'Charles Denham Orlando Jephson is the list\'s Sir Denham Jephson-Norreys'),
    ('general', 1830, 'Clare county'): ('import', 'The O\'Gorman Mahon is the list\'s James Patrick Mahon'),
    ('general', 1831, 'Dublin city'): ('import', 'the list names the same two members'),
    ('general', 1820, "Queen's County"): ('import', 'the list names one member; Walker gives Parnell as the second'),
    ('general', 1831, 'Kildare county'): ('import', 'Walker prints "Hart"; the member is Sir Josiah William Hort, 2nd Bt, '
                                                    'as the list has him'),
    ('by-election', 1801, 'Kerry county'): ('import', 'the knight of Kerry is the list\'s Maurice FitzGerald'),
    ('by-election', 1827, 'Kerry county'): ('import', 'the knight of Kerry is the list\'s Maurice FitzGerald'),
    ('by-election', 1830, 'Kerry county'): ('import', 'the knight of Kerry is the list\'s Maurice FitzGerald'),
    ('by-election', 1817, 'Wicklow county'): ('import', 'William Hayes Parnell is the list\'s William Parnell Hayes'),
    ('by-election', 1825, 'Donegal county'): ('import', 'Mountcharles and Mount Charles are one title'),
}
NAME_FIXES = {('general', 1831, 'Kildare county', 'Sir Josiah William Hart, bt'): 'Sir Josiah William Hort, bt'}


def display(name):
    return re.sub(r'\s+', ' ', plain(name)).strip()


def main(write=False):
    walker = json.load(open(os.path.join(D, 'walker-1801-1831-results.json'), encoding='utf-8'))['records']
    checks = json.load(open(os.path.join(D, 'walker-1801-1831-crosscheck.json'), encoding='utf-8'))['records']
    links = json.load(open(os.path.join(D, 'wikipedia-member-links-ireland-1801-1831.json'), encoding='utf-8'))['records']
    check_of = {(c['page'], c['kind'], c['year'], c['constituency'], c['date']): c for c in checks}
    general_links = collections.defaultdict(list)
    bye_links = collections.defaultdict(list)
    for r in links:
        if r['kind'] == 'general':
            general_links[(r['election'], exact(r['constituency']))].append(r)
        else:
            bye_links[(r['date'], exact(r['constituency']))].append(r)

    report, held, files = collections.Counter(), [], []
    for w in walker:
        c = check_of[(w['page'], w['kind'], w['electionYear'], w['constituency'], w['date'])]
        decision = DECISIONS.get((w['kind'], w['electionYear'], w['constituency']))
        ok = c['status'] in ('agrees', 'agrees after petition') or (decision and decision[0] == 'import')
        date = GE_DATES.get(w['electionYear']) if w['kind'] == 'general' else w['date']
        if not ok or not date:
            held.append({'kind': w['kind'], 'year': w['electionYear'], 'date': w['date'], 'constituency': w['constituency'],
                         'why': 'no date printed' if ok else c['status'], 'page': w['page']})
            report[f"{w['kind']} held"] += 1
            continue
        # Who each member is: the article his name links to on the list that confirmed him.
        # The list seat the check matched; failing that, the one seat the name can only mean.
        seat_names = [exact(c['listSeat'])] if c.get('listSeat') else seat_keys(w['constituency'])[0]
        if w['kind'] == 'general':
            listed = [r for k in seat_names for r in general_links.get((w['electionYear'], k), [])]
        else:
            listed = [r for k in seat_names for r in bye_links.get((c.get('listDate') or w['date'], k), [])]
        if len({r['constituency'] for r in listed}) > 1:
            listed = []
        rows = []
        for i, cand in enumerate(w['candidates']):
            name = NAME_FIXES.get((w['kind'], w['electionYear'], w['constituency'], cand['name']), cand['name'])
            person, full = None, display(name)
            if cand.get('returned') or name in (w.get('seatedOnPetition') or []):
                hit = [r for r in listed if keys(r['name']) & keys(name)] or \
                      [r for r in listed if fuzzy(keys(r['name']), keys(name))]
                if len(hit) == 1:
                    person = hit[0]['person']
                    # "Rowley re-elected": Walker prints the surname only; the list has the name.
                    if len(full.split()) == 1:
                        full = member(hit[0]['name'])
            votes = cand.get('votes')
            # A peer's family name is in brackets: "Viscount Castlereagh (Robert Stewart)".
            inner = re.findall(r'[(]([^)]*)[)]', full)
            parts = (inner[-1] if inner else re.sub(r',.*$', '', full)).split()
            rows.append({
                'Candidate_First_Pref_Votes': f'{votes:,}' if votes is not None else '',
                'Candidate_Id': '', 'Constituency_Number': '', 'Count_Number': '1',
                'Firstname': ' '.join(parts[:-1]), 'Occurred_On_Count': '', 'Party_Colour': '#888888', 'Party_Name': '',
                'Status': 'Elected' if cand.get('returned') else 'Not elected',
                'Surname': parts[-1] if parts else '', 'Total_Votes': f'{votes:,}' if votes is not None else '',
                'Transfers': '0.00', 'candidateName': full, 'id': i,
                **({'unopposed': True} if votes is None else {}),
                **({'sourcePersonId': 'wikipedia:' + person} if person else {}),
            })
        seat = c.get('listSeat') or w['constituency']
        summary = ('read from Walker\'s printed page; '
                   + ('members agree with Wikipedia\'s list of MPs' if w['kind'] == 'general'
                      else 'winner agrees with Wikipedia\'s list of by-elections')
                   + (' (after petition)' if c['status'] == 'agrees after petition' else '')
                   + (f'; {decision[1]}' if decision else ''))
        doc = {'Constituency': {'countInfo': {
            'Constituency_Name': seat, 'Constituency_Number': '', 'Number_Of_Seats': str(w.get('seats') or 1),
            'Spoiled': '', 'Total_Electorate': '', 'Total_Poll': '', 'Valid_Poll': ''}, 'countGroup': rows},
            'kind': w['kind'],
            'sources': [dict(WALKER), {'title': 'List of MPs elected in the United Kingdom general election'
                                       if w['kind'] == 'general' else 'List of United Kingdom by-elections',
                                       'publisher': 'Wikipedia', 'url': (listed[0]['list'] if listed else None)}],
            'checked': summary}
        if w.get('dateAsPrinted') and w['kind'] == 'general':
            doc['pollDate'] = w['date']
        if w.get('outcomeFacts'):
            doc['note'] = w['outcomeFacts']
        elif not any(x.get('votes') is not None for x in w['candidates']):
            doc['note'] = 'Returned unopposed.'
        files.append((date, seat, doc))
        report[f"{w['kind']} imported"] += 1
        report['members given a Wikipedia person'] += sum(1 for r in rows if r.get('sourcePersonId'))

    seen, unique = set(), []
    for date, seat, doc in files:
        k = (date, slug(seat))
        if k in seen:
            report['duplicate seat-date dropped'] += 1
            continue
        seen.add(k)
        unique.append((date, seat, doc))
    # Files before 1832 are this script's own; --overwrite rewrites them. Nothing later is touched.
    existing = {(d, f[:-5]) for d in os.listdir(SRC) if os.path.isdir(os.path.join(SRC, d))
                and not ('--overwrite' in sys.argv and d < '1832')
                for f in os.listdir(os.path.join(SRC, d)) if f.endswith('.json')}
    report['would overwrite an existing file'] = sum(1 for d, s, _ in unique if (d, slug(s)) in existing)
    json.dump({'schemaVersion': 1, 'counts': dict(report), 'held': held},
              open(os.path.join(D, 'walker-1801-1831-import-report.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    print(json.dumps(dict(report), indent=1))
    if not write:
        print('dry run; --write to apply')
        return
    by_date = collections.defaultdict(set)
    for date, seat, doc in unique:
        if (date, slug(seat)) in existing:
            continue
        os.makedirs(os.path.join(SRC, date), exist_ok=True)
        with open(os.path.join(SRC, date, slug(seat) + '.json'), 'w', encoding='utf-8') as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
            fh.write('\n')
        by_date[date].add(seat)
    ipath = os.path.join(ROOT, 'data', 'elections-source', 'data', 'elections_index.json')
    raw = open(ipath, encoding='utf-8').read()
    index = json.loads(raw)
    body = next(x for x in index['bodies'] if x['slug'] == BODY)
    for date, seats in by_date.items():
        e = next((x for x in body['dates'] if x['date'] == date), None)
        if e is None:
            body['dates'].append({'date': date, 'constituencies': sorted(seats)})
        else:
            e['constituencies'] = sorted(set(e['constituencies']) | seats)
    body['dates'].sort(key=lambda x: x['date'], reverse=True)
    indent = len(re.search(r'\n( +)"bodies"', raw).group(1))
    open(ipath, 'w', encoding='utf-8').write(json.dumps(index, indent=indent, ensure_ascii=False) + ('\n' if raw.endswith('\n') else ''))
    print(f'wrote {sum(len(v) for v in by_date.values())} files over {len(by_date)} dates')


if __name__ == '__main__':
    main('--write' in sys.argv)
