#!/usr/bin/env python3
"""Harvest the Irish seats from Wikipedia's "List of MPs elected in the ... general election".

    python scripts/walker/harvest_wikipedia_mp_lists.py

One article per United Kingdom general election, 1802-1918, naming every member returned. For
1802-1880 this is the only source in the repository besides Walker, so the members it names
are a second, independent reading of who won each Irish seat -- which the Walker harvest of
those years otherwise lacks entirely.

The articles do not share a layout. Up to the 1880s most carry a Country column and the Irish
rows are simply those marked Ireland; later ones are split into alphabetical tables with no
country, and there an Irish seat is recognised by name against the constituencies Civgraph and
the Walker harvests already know. Tables are read from the rendered HTML (see wiki_tables.py).
Text is CC BY-SA 4.0; only names, parties and seat names are kept, with the article cited.
"""
import argparse
import json
import os
import re
import sys
import time
from collections import defaultdict

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wiki_tables import grid  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
UA = {'User-Agent': 'civgraph-election-research/1.0 (https://civgraph.net)'}
PAUSE = 1.0
ELECTIONS = ['1802', '1806', '1807', '1812', '1818', '1820', '1826', '1830', '1831', '1832', '1835',
             '1837', '1841', '1847', '1852', '1857', '1859', '1865', '1868', '1874', '1880', '1885',
             '1886', '1892', '1895', '1900', '1906', 'January 1910', 'December 1910', '1918']
DROP = {'county', 'city', 'borough', 'of', 'the', 'and', 'town', 'division'}


def key(name):
    """Order-free token key: 'Antrim North' and 'North Antrim' meet; 'County Cork' is 'Cork'."""
    toks = re.sub(r"[^a-z ]", ' ', name.lower().replace("'", '')).split()
    return ' '.join(sorted(t for t in toks if t not in DROP))


def known_irish():
    names = set()
    src = os.path.join(ROOT, 'data', 'elections-source', 'data', 'elections', 'house-of-commons-of-the-united-kingdom')
    for d in os.listdir(src):
        if d >= '1919':
            continue
        for f in os.listdir(os.path.join(src, d)):
            try:
                j = json.load(open(os.path.join(src, d, f), encoding='utf-8'))
                names.add(j['Constituency']['countInfo']['Constituency_Name'])
            except Exception:
                pass
    for rel in ('walker-pre1885-results.json', 'walker-constituency-histories.json'):
        p = os.path.join(ROOT, 'data', 'elections', rel)
        if os.path.exists(p):
            for r in json.load(open(p, encoding='utf-8'))['records']:
                names.add(r['constituency'])
    # Short abbreviations in Civgraph's own file names: "Antrim N" is North Antrim.
    expanded = set()
    for n in names:
        expanded.add(n)
        expanded.add(re.sub(r'\bN\b', 'North', re.sub(r'\bS\b', 'South', re.sub(r'\bE\b', 'East', re.sub(r'\bW\b', 'West', n)))))
    return {key(n) for n in expanded if len(key(n)) >= 4}


def fetch(title):
    url = 'https://en.wikipedia.org/api/rest_v1/page/html/' + requests.utils.quote(title.replace(' ', '_'), safe='')
    for attempt in range(3):
        r = requests.get(url, headers=UA, timeout=60)
        if r.status_code == 200:
            return r.text, url.replace('/api/rest_v1/page/html/', '/wiki/')
        if r.status_code == 404:
            return None, None
        time.sleep(5 * (attempt + 1))
    return None, None


def roles_of(g):
    """{role: column} from any header row naming a constituency; the articles repeat their
    header per alphabetical section, and the earliest ones print none at all, in which case
    the columns run constituency, member, party."""
    for row in g:
        names = [t.lower() for t, _ in row]
        if any('constituency' in n for n in names):
            roles = {}
            for c, n in enumerate(names):
                if 'constituency' in n and 'cons' not in roles:
                    roles['cons'] = c
                elif n in ('country', 'nation') and 'country' not in roles:
                    roles['country'] = c
                elif (n.startswith('member') or n.startswith('mp') or n == 'name') and 'member' not in roles:
                    roles['member'] = c
                elif n.startswith('party') and 'party' not in roles:
                    roles['party'] = c
            if 'member' in roles:
                return roles
    return {'cons': 0, 'member': 1, 'party': 2}


def is_header(row):
    texts = [t for t, _ in row if t]
    return (all(th for _, th in row) or not texts or len(set(texts)) == 1 and len(texts[0]) <= 2
            or any(t.lower() == 'constituency' for t in texts))


def person(name):
    """'Pirie, Duncan' is Duncan Pirie; trailing footnotes and titles in brackets go."""
    name = re.sub(r'\s*\(.*?\)\s*$', '', name).strip(' †*‡')
    m = re.match(r'^([^,]+),\s*(.+)$', name)
    if m and not re.search(r'\b(bt|Bt|Bart|jun|KC|QC)\b', m.group(2)):
        name = f'{m.group(2)} {m.group(1)}'
    return name.strip()


def harvest(election, irish):
    title = f'List of MPs elected in the {election} United Kingdom general election'
    html, url = fetch(title)
    if not html:
        return None
    soup = BeautifulSoup(html, 'html.parser')
    seats = defaultdict(list)
    by_country = False
    for table in soup.find_all('table', class_=re.compile('wikitable')):
        g = grid(table)
        roles = roles_of(g)
        for row in g:
            if len(row) <= max(roles.values()) or is_header(row):
                continue
            # "Galway Borough (two members)": the bracket is about the seat, not its name.
            cons = re.sub(r'\s*\(.*?\)\s*', ' ', row[roles['cons']][0]).strip()
            if not cons:
                continue
            if 'country' in roles:
                by_country = True
                if row[roles['country']][0].strip().lower() != 'ireland':
                    continue
            elif key(cons) not in irish:
                continue
            cons = re.sub(r'\s*\(.*?\)\s*$', '', cons).strip()
            member = person(row[roles['member']][0])
            party = row[roles['party']][0] if 'party' in roles else None
            if member and {'name': member, 'party': party} not in seats[cons]:
                seats[cons].append({'name': member, 'party': party})
    return {'election': election, 'title': title, 'url': url,
            'irishRowsBy': 'Country column' if by_country else 'constituency name',
            'seats': [{'constituency': c, 'members': m} for c, m in sorted(seats.items())]}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--out', default=os.path.join('data', 'elections', 'wikipedia-mp-lists-ireland.json'))
    args = ap.parse_args()
    irish = known_irish()
    records, missing = [], []
    for e in ELECTIONS:
        rec = harvest(e, irish)
        time.sleep(PAUSE)
        if not rec:
            missing.append(e)
            continue
        records.append(rec)
        print(f"{e:>14}: {len(rec['seats']):>3} Irish seats ({rec['irishRowsBy']})")
    doc = {
        'schemaVersion': 1,
        'description': ('Members returned for Irish seats at each United Kingdom general election '
                        '1802-1918, from Wikipedia\'s "List of MPs elected" articles: an independent '
                        'second reading of who won each seat, against which the Walker harvests can '
                        'be checked.'),
        'provenance': {'method': 'scripts/walker/harvest_wikipedia_mp_lists.py',
                       'licence': 'Wikipedia text is CC BY-SA 4.0; only names, parties and seat names '
                                  'are kept, each record citing its article.'},
        'counts': {'articles': len(records), 'missing': missing,
                   'seats': sum(len(r['seats']) for r in records),
                   'members': sum(len(s['members']) for r in records for s in r['seats'])},
        'records': records,
    }
    out = args.out if os.path.isabs(args.out) else os.path.join(ROOT, args.out)
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(f'wrote {out}: {doc["counts"]}')


if __name__ == '__main__':
    main()
