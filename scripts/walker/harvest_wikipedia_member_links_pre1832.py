#!/usr/bin/env python3
"""Harvest who each Irish member of 1801-1831 is, as the Wikipedia article his name links to.

    python scripts/walker/harvest_wikipedia_member_links_pre1832.py

The 1801-1831 results come from Walker, who names people but carries no identifiers. The
lists of MPs for the 1802-1831 general elections and the lists of by-elections link each
member to his article, and that article is the key the 1832-1922 candidacies already carry
(stamp_wikipedia_person_ids.py), so a member who sat on either side of 1832 is one person.
Redirects are resolved with the same cache as the constituency boxes. Output:
data/elections/wikipedia-member-links-ireland-1801-1831.json.
"""
import json
import os
import re
import sys
import time
from urllib.parse import unquote

from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harvest_wikipedia_byelection_lists import exact, iso, irish_names  # noqa: E402
from harvest_wikipedia_byelection_lists_pre1832 import PAGES  # noqa: E402
from harvest_wikipedia_constituency_boxes import resolve_redirects  # noqa: E402
from harvest_wikipedia_mp_lists import fetch, is_header, key, known_irish, person, roles_of  # noqa: E402
from wiki_tables import grid  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
CACHE = os.path.join(ROOT, '.cache', 'wikipedia-constituencies')
ELECTIONS = ['1802', '1806', '1807', '1812', '1818', '1820', '1826', '1830', '1831']


def link(cell):
    a = cell.find('a', href=re.compile(r'^\./'))
    if not a or 'redlink=1' in a['href']:
        return None
    return unquote(a['href'][2:].split('?')[0].split('#')[0]).replace('_', ' ')


def main():
    out = []
    irish = known_irish()
    for election in ELECTIONS:
        html, url = fetch(f'List of MPs elected in the {election} United Kingdom general election')
        if not html:
            print('missing', election)
            continue
        for table in BeautifulSoup(html, 'html.parser').find_all('table', class_=re.compile('wikitable')):
            g = grid(table, elements=True)
            roles = roles_of([[(t, h) for t, h, _ in row] for row in g])
            for row in g:
                if len(row) <= max(roles.values()) or is_header([(t, h) for t, h, _ in row]):
                    continue
                cons = re.sub(r'\s*\(.*?\)\s*', ' ', row[roles['cons']][0]).strip()
                if 'country' in roles:
                    if row[roles['country']][0].strip().lower() != 'ireland':
                        continue
                elif key(cons) not in irish:
                    continue
                out.append({'kind': 'general', 'election': int(election), 'constituency': cons,
                            'name': person(row[roles['member']][0]), 'article': link(row[roles['member']][2]),
                            'list': url})
        time.sleep(0.5)
    by_irish = irish_names()
    for title in PAGES:
        html, url = fetch(title)
        for tb in BeautifulSoup(html, 'html.parser').find_all('table', class_=re.compile('wikitable')):
            for row in grid(tb, elements=True):
                if len(row) < 6:
                    continue
                date = iso(row[0][0])
                if not date or date >= '1832-12-08' or re.sub(r' bridge$', '', exact(row[1][0])) not in by_irish:
                    continue
                out.append({'kind': 'by-election', 'date': date, 'constituency': row[1][0],
                            'name': re.sub(r'\s*\[.*?\]', '', row[4][0]).strip(), 'article': link(row[4][2]),
                            'list': url})
        time.sleep(0.5)
    landing = resolve_redirects([r['article'] for r in out if r['article']], CACHE)
    for r in out:
        r['person'] = landing.get(r['article']) if r['article'] else None
    doc = {'schemaVersion': 1,
           'description': ('Irish members 1801-1831 as linked in Wikipedia\'s lists of MPs and of by-elections, with '
                           'the article each name links to (redirects resolved): the person key for the Walker results.'),
           'provenance': {'method': 'scripts/walker/harvest_wikipedia_member_links_pre1832.py',
                          'licence': 'Wikipedia text is CC BY-SA 4.0; names and article titles only.'},
           'counts': {'rows': len(out), 'linked': sum(1 for r in out if r['person'])},
           'records': out}
    with open(os.path.join(ROOT, 'data', 'elections', 'wikipedia-member-links-ireland-1801-1831.json'), 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(json.dumps(doc['counts']))


if __name__ == '__main__':
    main()
