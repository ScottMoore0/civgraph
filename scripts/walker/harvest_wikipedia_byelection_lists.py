#!/usr/bin/env python3
"""Harvest the Irish rows of Wikipedia's "List of United Kingdom by-elections", 1832-1922.

    python scripts/walker/harvest_wikipedia_byelection_lists.py

Seven list articles give every by-election with its date, the member whose seat fell vacant, the
winner and the cause. For Irish seats they supply the exact date that about four in ten
constituency election boxes lack, and a second reading of who won. Irish seats are recognised by
name against the constituency articles and lists of MPs already harvested.
"""
import json
import os
import re
import sys
import unicodedata

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wiki_tables import grid  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
UA = {'User-Agent': 'civgraph-election-research/1.0 (https://civgraph.net)'}
PAGES = ['List of United Kingdom by-elections (1832–1847)', 'List of United Kingdom by-elections (1847–1857)',
         'List of United Kingdom by-elections (1857–1868)', 'List of United Kingdom by-elections (1868–1885)',
         'List of United Kingdom by-elections (1885–1900)', 'List of United Kingdom by-elections (1900–1918)',
         'List of United Kingdom by-elections (1918–1931)']
MONTHS = {m: i + 1 for i, m in enumerate(['january', 'february', 'march', 'april', 'may', 'june', 'july',
                                          'august', 'september', 'october', 'november', 'december'])}


def exact(name):
    n = unicodedata.normalize('NFKD', re.sub(r'\s*[\(\[].*?[\)\]]\s*', ' ', name or '')).encode('ascii', 'ignore').decode().lower()
    return ' '.join(re.sub(r'[^a-z ]', ' ', n.replace("'", '')).split())


def iso(text):
    m = re.search(r'(\d{1,2}) ([A-Za-z]+) (1[89]\d{2})', text or '')
    if not m or m.group(2).lower() not in MONTHS:
        return None
    return f'{int(m.group(3)):04d}-{MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}'


def irish_names():
    names = set()
    boxes = json.load(open(os.path.join(ROOT, 'data', 'elections', 'wikipedia-irish-constituency-boxes-1832-1922.json'), encoding='utf-8'))
    names |= {exact(b['constituency']) for b in boxes['records']}
    lists = json.load(open(os.path.join(ROOT, 'data', 'elections', 'wikipedia-mp-lists-ireland.json'), encoding='utf-8'))
    names |= {exact(s['constituency']) for r in lists['records'] for s in r['seats']}
    return {n for n in names if n}


def main():
    irish = irish_names()
    out = []
    for title in PAGES:
        r = requests.get('https://en.wikipedia.org/api/rest_v1/page/html/' + requests.utils.quote(title.replace(' ', '_'), safe=''),
                         headers=UA, timeout=60)
        url = 'https://en.wikipedia.org/wiki/' + title.replace(' ', '_')
        for tb in BeautifulSoup(r.text, 'html.parser').find_all('table', class_=re.compile('wikitable')):
            for row in grid(tb):
                cells = [re.sub(r'\s*\[.*?\]', '', t).strip() for t, _ in row]
                if len(cells) < 9:
                    continue
                # Some rows lead with the Parliament ("14th Parliament"); the rest start at the seat.
                if re.match(r'^\d+(st|nd|rd|th) Parliament', cells[0]):
                    cells = cells[1:]
                seat, date = cells[0], iso(cells[1])
                if not date or not ('1832' <= date[:4] <= '1922') or exact(seat) not in irish:
                    continue
                out.append({'constituency': seat, 'date': date, 'outgoing': cells[2], 'outgoingParty': cells[4],
                            'winner': cells[5], 'winnerParty': cells[7], 'cause': cells[8] if len(cells) > 8 else None,
                            'list': url})
        time_sleep = 0.5
    seen, uniq = set(), []
    for r in out:
        k = (r['date'], exact(r['constituency']), r['winner'])
        if k not in seen:
            seen.add(k)
            uniq.append(r)
    doc = {'schemaVersion': 1,
           'description': ("Irish by-elections 1832-1922 from Wikipedia's lists of UK by-elections: date, outgoing member, "
                           'winner, cause. Used to date the constituency election boxes and check who won.'),
           'provenance': {'method': 'scripts/walker/harvest_wikipedia_byelection_lists.py',
                          'licence': 'Wikipedia text is CC BY-SA 4.0; names, dates and parties only.'},
           'counts': {'byElections': len(uniq)}, 'records': sorted(uniq, key=lambda r: r['date'])}
    with open(os.path.join(ROOT, 'data', 'elections', 'wikipedia-uk-byelection-lists-ireland.json'), 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(json.dumps(doc['counts']))


if __name__ == '__main__':
    main()
