#!/usr/bin/env python3
"""Attach Wikidata and UK Parliament ids to the registered non-candidate persons.

data/elections/persons/non-candidate-persons.json names people Civgraph holds no candidacy
for (Northern Ireland Office ministers, civil servants, party officers). This finds each one's
Wikidata item and adds `wikidata:Q..` and, where Wikidata gives it, `ukparliament:<id>` (P10428,
the id the repo already uses) to `officialPersonIds`, with born and died.

An item is taken only when it is the ONE search hit for the name that is a human whose
positions held (P39) include an office the person's tenures are in: a post with "Northern
Ireland" in its name for the Northern Ireland Office, Home Secretary for the Home Office, and
so on. Anything else is left without an id and reported. Wikidata is CC0.

  python scripts/ingest/facts/link_noncandidates_wikidata.py [--write]
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
# Wikimedia requests carry the site's User-Agent (the owner's decision of 13 Nov 2026), through
# scripts/ingest/wikimedia_headers.py; no other host gets one.
_WM = __import__('runpy').run_path(str(__import__('pathlib').Path(__file__).resolve().parents[1] / 'wikimedia_headers.py'))
wikimedia_headers = _WM['wikimedia_headers']

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
PATH = os.path.join(REPO, 'data', 'elections', 'persons', 'non-candidate-persons.json')

# What a position label must mention for each office the person is registered for.
EXPECT = [
    (r'^(secretary-of-state-ni|nio-)', r'northern ireland'),
    (r'^uk-home-secretary', r'home secretary|secretary of state for the home department'),
    (r'^head-ni-civil-service', r'civil service|permanent secretary|northern ireland'),
    (r'^ni-minister-of-state|^ni-', r'northern ireland|senate of northern ireland|parliament of northern ireland'),
    (r'^ie-minister', r'minister for|seanad|senator'),
    (r'^eec-commissioner', r'commission'),
]


def get(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=wikimedia_headers(url)), timeout=60) as r:
                return json.loads(r.read())
        except Exception:
            time.sleep(3 * (attempt + 1))
    return None


def search(name):
    q = urllib.parse.urlencode({'action': 'wbsearchentities', 'search': name, 'language': 'en', 'type': 'item', 'limit': 12, 'format': 'json'})
    d = get(f'https://www.wikidata.org/w/api.php?{q}') or {}
    return [h['id'] for h in d.get('search', [])]


def describe(qids):
    values = ' '.join(f'wd:{q}' for q in qids)
    sparql = f'''SELECT ?item ?posLabel ?born ?died ?ukp WHERE {{
      VALUES ?item {{ {values} }}
      ?item wdt:P31 wd:Q5 .
      OPTIONAL {{ ?item wdt:P39 ?pos . ?pos rdfs:label ?posLabel . FILTER(LANG(?posLabel) = "en") }}
      OPTIONAL {{ ?item wdt:P569 ?born }} OPTIONAL {{ ?item wdt:P570 ?died }}
      OPTIONAL {{ ?item wdt:P10428 ?ukp }}
    }}'''
    d = get('https://query.wikidata.org/sparql?' + urllib.parse.urlencode({'query': sparql, 'format': 'json'})) or {}
    out = {}
    for b in d.get('results', {}).get('bindings', []):
        q = b['item']['value'].rsplit('/', 1)[-1]
        o = out.setdefault(q, {'positions': set(), 'born': None, 'died': None, 'ukp': set()})
        if b.get('posLabel'):
            o['positions'].add(b['posLabel']['value'])
        if b.get('born'):
            o['born'] = b['born']['value'][:10]
        if b.get('died'):
            o['died'] = b['died']['value'][:10]
        if b.get('ukp'):
            o['ukp'].add(b['ukp']['value'])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    args = ap.parse_args()
    doc = json.load(open(PATH, encoding='utf-8'))
    linked, left = 0, []
    for p in doc['persons']:
        if any(o.startswith('wikidata:') for o in p.get('officialPersonIds') or []):
            continue
        qids = search(p['displayName'])
        time.sleep(1)
        if not qids:
            left.append((p['personId'], p['displayName'], 'no Wikidata search hit'))
            continue
        info = describe(qids)
        time.sleep(1)
        pats = [exp for pat, exp in EXPECT if any(re.search(pat, b) for b in p['basis'])]
        fits = [q for q, o in info.items() if any(re.search(x, pos, re.I) for x in pats for pos in o['positions'])]
        if len(fits) != 1:
            left.append((p['personId'], p['displayName'], f'{len(fits)} fitting items among {len(info)} humans'))
            continue
        q = fits[0]
        o = info[q]
        ids = set(p.get('officialPersonIds') or []) | {f'wikidata:{q}'}
        if len(o['ukp']) == 1:
            ids.add(f'ukparliament:{next(iter(o["ukp"]))}')
        p['officialPersonIds'] = sorted(ids)
        if o['born']:
            p['born'] = o['born']
        if o['died']:
            p['died'] = o['died']
        p['lifeSource'] = 'Wikidata'
        linked += 1
        print(f"  {p['personId']} {p['displayName']} -> {q} {sorted(o['ukp'])} ({o['born']}-{o['died']})")
    print(f'linked {linked}; left {len(left)}')
    for row in left:
        print('  left:', *row)
    if args.write:
        with open(PATH, 'w', encoding='utf-8', newline='\n') as fh:
            json.dump(doc, fh, ensure_ascii=False, indent=1)
            fh.write('\n')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
