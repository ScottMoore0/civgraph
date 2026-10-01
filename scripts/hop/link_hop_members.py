#!/usr/bin/env python3
"""Link the History of Parliament's Irish members to Civgraph's people.

    python scripts/hop/link_hop_members.py

Each member in hop-irish-members.json (from extract_hop_ireland.py) is matched to the
Civgraph person who held his seats:
  1. through Wikidata, whose History of Parliament ID (P1614, wikidata-hop-ids.json) names
     the same page and whose English Wikipedia article is the key Civgraph's 1801-1922
     candidacies carry ("wikipedia:<title>");
  2. failing that, by the seat itself: a Civgraph person returned for that constituency
     within the member's dates, with the same surname, and the only one who was.
A link is keyed on the person's Wikipedia key where he has one, since person ids move when
the registry is rebuilt; otherwise on the person id, and this is re-run after a rebuild.
Output: data/elections/hop/hop-person-links.json, read by build-browse-indexes.mjs.
"""
import collections
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'walker'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crosscheck_walker_1801_1831 import keys, fuzzy  # noqa: E402
from crosscheck_hop_1801_1832 import hop_seat  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
HOP = os.path.join(ROOT, 'data', 'elections', 'hop')
META = os.path.join(ROOT, 'render', 'metadata', 'elections-test2')
REGISTRY = os.path.join(ROOT, 'data', 'elections', 'persons', 'person_registry.json')


def civgraph_seat(name):
    n = re.sub(r"[^a-z' ]", ' ', name.lower()).replace("'", '').strip()
    n = re.sub(r'\s+', ' ', n)
    if n in ('dublin university', 'university of dublin'):
        return ('university', 'dublin')
    if n.startswith('kings county'):
        return ('county', 'kings')
    if n.startswith('queens county'):
        return ('county', 'queens')
    m = re.match(r'^county (.+)$', n) or re.match(r'^(.+) county$', n)
    if m:
        return ('county', m.group(1).replace(' ', '-'))
    stem = re.sub(r' (city|borough|town)$', '', n).replace(' ', '-')
    return ('borough', 'bandon' if stem == 'bandon-bridge' else stem)


def main():
    members = json.load(open(os.path.join(HOP, 'hop-irish-members.json'), encoding='utf-8'))['members']
    wd = {('/volume/' + r['hop']).lower(): r for r in json.load(open(os.path.join(HOP, 'wikidata-hop-ids.json'), encoding='utf-8'))['records']}
    registry = json.load(open(REGISTRY, encoding='utf-8'))['entities']
    wiki_keys = {s for e in registry for s in (e.get('sourcePersonIds') or []) if s.startswith('wikipedia:')}
    entity_of = {}
    for e in registry:
        for s in e.get('sourcePersonIds') or []:
            entity_of[s] = e
    by_pid = {e['personId']: e for e in registry}

    # Civgraph's returned members, 1801-1832, by seat: (date, name, personId).
    returned = collections.defaultdict(list)
    for f in glob.glob(os.path.join(META, 'house-of-commons-of-the-united-kingdom__18[0-3]*.json')):
        d = json.load(open(f, encoding='utf-8'))
        date = str(d.get('date') or '')
        if not ('1801' <= date[:4] <= '1832'):
            continue
        for r in d.get('results') or []:
            for c in r.get('candidates') or []:
                if c.get('elected') or c.get('status') == 'Elected':
                    returned[civgraph_seat(r.get('constituency') or '')].append((date, c.get('name') or '', c.get('personId')))

    links, tally = [], collections.Counter()
    for m in members:
        rec = {'hop': m['path'], 'url': m['url'], 'volume': m['volume'], 'heading': m['heading'],
               'born': m['born'], 'died': m['died']}
        w = wd.get(m['path'].lower())
        if w:
            rec['wikidata'] = w['wikidata']
        key = 'wikipedia:' + w['enwiki'] if w and w.get('enwiki') else None
        if key and key in wiki_keys:
            ent = entity_of[key]
            rec.update({'personKey': key, 'personId': ent['personId'], 'method': 'wikidata'})
            tally['linked through Wikidata'] += 1
            links.append(rec)
            continue
        # By seat: who Civgraph has returned for the member's seats within his dates.
        surname_keys = keys(re.sub(r'\(.*$', '', m['heading']).split(',')[0])
        found = set()
        for s in m['seats']:
            seat = hop_seat(s['constituency'].rstrip('/').rsplit('/', 1)[-1])
            lo, hi = (s['from'] or '0000')[:4], (s['to'] or '9999')[:4]
            for date, name, pid in returned.get(seat, []):
                if lo <= date[:4] <= hi and pid and (surname_keys & keys(name) or fuzzy(surname_keys, keys(name))):
                    found.add(pid)
        if len(found) == 1:
            pid = found.pop()
            ent = by_pid.get(pid) or {}
            wk = next((s for s in ent.get('sourcePersonIds') or [] if s.startswith('wikipedia:')), None)
            rec.update({'personKey': wk or f'person:{pid}', 'personId': pid, 'method': 'seat and surname'})
            tally['linked by seat and surname'] += 1
            links.append(rec)
        else:
            tally['not linked: ' + ('several people' if found else 'no Civgraph member found')] += 1
            rec['candidates'] = sorted(found)
            links.append({**rec, 'personKey': None, 'method': None})
    # Several HoP pages can describe one person (both volumes); they all attach to him.
    doc = {'schemaVersion': 1, 'source': 'History of Parliament Online; links via Wikidata P1614',
           'counts': dict(tally), 'links': links}
    with open(os.path.join(HOP, 'hop-person-links.json'), 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    people = {l['personKey'] for l in links if l['personKey']}
    print(json.dumps({**dict(tally), 'Civgraph people linked': len(people)}, indent=1))


if __name__ == '__main__':
    main()
