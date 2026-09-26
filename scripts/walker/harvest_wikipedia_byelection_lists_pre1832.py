#!/usr/bin/env python3
"""Harvest the Irish rows of Wikipedia's lists of UK by-elections, 1801-1831.

    python scripts/walker/harvest_wikipedia_byelection_lists_pre1832.py

The second source for the 1801-1831 by-elections, which are read from Walker's pages. These
lists are laid out differently from the later ones (date, seat, contested or unopposed,
former incumbent, winner, cause), so they have their own harvester. Output:
data/elections/wikipedia-uk-byelection-lists-ireland-1801-1831.json.
"""
import json
import os
import re
import sys
import time

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harvest_wikipedia_byelection_lists import UA, exact, iso, irish_names  # noqa: E402
from wiki_tables import grid  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
PAGES = ['List of United Kingdom by-elections (1801–1806)', 'List of United Kingdom by-elections (1806–1818)',
         'List of United Kingdom by-elections (1818–1832)']


def main():
    irish = irish_names()
    out = []
    for title in PAGES:
        r = requests.get('https://en.wikipedia.org/api/rest_v1/page/html/' + requests.utils.quote(title.replace(' ', '_'), safe=''),
                         headers=UA, timeout=60)
        r.raise_for_status()
        url = 'https://en.wikipedia.org/wiki/' + title.replace(' ', '_')
        for tb in BeautifulSoup(r.text, 'html.parser').find_all('table', class_=re.compile('wikitable')):
            for row in grid(tb):
                cells = [re.sub(r'\s*\[.*?\]', '', t).strip() for t, _ in row]
                if len(cells) < 6:
                    continue
                date = iso(cells[0])
                if not date or date >= '1832-12-08' or re.sub(r' bridge$', '', exact(cells[1])) not in irish:
                    continue
                out.append({'constituency': cells[1], 'date': date, 'contested': cells[2].startswith('c'),
                            'outgoing': cells[3], 'winner': cells[4], 'cause': cells[5] or None, 'list': url})
        time.sleep(0.5)
    doc = {'schemaVersion': 1,
           'description': ("Irish by-elections 1801-1831 from Wikipedia's lists of UK by-elections: date, outgoing "
                           'member, winner, cause. The check on the by-elections read from Walker.'),
           'provenance': {'method': 'scripts/walker/harvest_wikipedia_byelection_lists_pre1832.py',
                          'licence': 'Wikipedia text is CC BY-SA 4.0; names, dates and causes only.'},
           'counts': {'byElections': len(out)}, 'records': sorted(out, key=lambda r: r['date'])}
    with open(os.path.join(ROOT, 'data', 'elections', 'wikipedia-uk-byelection-lists-ireland-1801-1831.json'), 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(json.dumps(doc['counts']))


if __name__ == '__main__':
    main()
