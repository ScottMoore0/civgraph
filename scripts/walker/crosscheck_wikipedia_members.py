#!/usr/bin/env python3
"""Check who the Walker harvest says won each 1802-1880 seat against Wikipedia's MP lists.

    python scripts/walker/crosscheck_wikipedia_members.py

The 1802-1880 harvest has had no second source: a misread name or a contest filed under the
wrong seat was contradicted by nothing. Wikipedia's "List of MPs elected" articles name every
member returned at each general election, independently of Walker, so for each general-
election contest the members Walker's figures return -- the top N by votes, where N is the
number Wikipedia lists for the seat, or everyone named if the return was unopposed -- can be
compared with Wikipedia's, by surname.

Each contest gains `wikipedia`: the members Wikipedia names, the article, and whether they
agree. A contest Wikipedia has no seat for is left unmarked. Nothing is changed but the flag;
where the two disagree either may be wrong, and the page is the arbiter.
"""
import json
import os
import re
import sys
import unicodedata
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harvest_wikipedia_mp_lists import key  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
HARVEST = os.path.join(ROOT, 'data', 'elections', 'walker-pre1885-results.json')
LISTS = os.path.join(ROOT, 'data', 'elections', 'wikipedia-mp-lists-ireland.json')
SUFFIX = {'bt', 'bart', 'jun', 'jr', 'sen', 'qc', 'kc', 'mp', 'rn', 'md', 'lld', 'the'}


TITLES = {'viscount', 'lord', 'earl', 'baron', 'marquess', 'marquis'}


def surnames(name):
    """Tokens that identify a man across both sources: the last two of his name, the last two
    inside any bracket, and the word after a title -- so "Viscount St Lawrence (William Ulick
    Tristram)" meets Walker's "William Ulick Tristram", and "Viscount Castlereagh" meets
    "Castlereagh (Robert Stewart)"."""
    s = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower()
    s = re.split(r' [-–] |\[', s)[0].replace("o'", 'o').replace("'", '')
    inner = ' '.join(re.findall(r'\((.*?)\)?(?:$|\s)', s))
    outer = re.sub(r'\(.*?(\)|$)', ' ', s)
    def toks(t):
        return [w for w in re.split(r'[^a-z]+', t) if len(w) > 2 and w not in SUFFIX]
    out = set(toks(outer)[-2:]) | set(toks(inner)[-2:])
    words = toks(outer)
    for i, w in enumerate(words[:-1]):
        if w in TITLES:
            out.add(words[i + 1])
    return out - TITLES


def seat_class(name):
    return 'county' if re.search(r'\bcounty\b', name, re.I) else 'borough'


def main():
    harvest = json.load(open(HARVEST, encoding='utf-8'))
    lists = json.load(open(LISTS, encoding='utf-8'))
    wiki = defaultdict(list)
    for rec in lists['records']:
        year = int(re.search(r'\d{4}', rec['election']).group(0))
        for seat in rec['seats']:
            wiki[(year, key(seat['constituency']))].append((seat, rec['url']))

    def find(year, name):
        # County Armagh and Armagh city share a base name; where both exist the class decides.
        options = wiki.get((year, key(name)), [])
        if len(options) == 1:
            return options[0]
        same = [o for o in options if seat_class(o[0]['constituency']) == seat_class(name)]
        return same[0] if len(same) == 1 else None

    stats = defaultdict(int)
    by_layout = defaultdict(lambda: [0, 0])
    for c in harvest['records']:
        c.pop('wikipedia', None)
        if c['kind'] != 'general':
            continue
        hit = find(c['year'], c['constituency'])
        if not hit:
            stats['no Wikipedia seat to compare'] += 1
            continue
        seat, url = hit
        n = len(seat['members'])
        cands = c['candidates']
        polled = [x for x in cands if x.get('votes')]
        winners = sorted(polled, key=lambda x: -x['votes'])[:n] if polled else cands[:n]
        want = [surnames(m['name']) for m in seat['members']]
        got = [surnames(x['name']) for x in winners]
        matched = sum(1 for w in want if any(w & g for g in got))
        agrees = matched == n and len(winners) >= n
        c['wikipedia'] = {'members': [m['name'] for m in seat['members']], 'article': url,
                          'agrees': agrees, 'matched': f'{matched} of {n}'}
        stats['agree' if agrees else ('partly agree' if matched else 'disagree')] += 1
        lay = c.get('layout', 'with affiliation column (1832-1880)')
        by_layout[lay][0] += agrees
        by_layout[lay][1] += 1

    harvest['counts']['wikipediaCheck'] = dict(stats)
    harvest.setdefault('provenance', {})['secondSource'] = (
        "Wikipedia's 'List of MPs elected' articles, harvested by scripts/walker/"
        "harvest_wikipedia_mp_lists.py; each general-election contest is marked with whether the "
        "members Walker's figures return match the members Wikipedia names (scripts/walker/"
        "crosscheck_wikipedia_members.py).")
    with open(HARVEST, 'w', encoding='utf-8') as fh:
        json.dump(harvest, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    for k, v in sorted(stats.items()):
        print(f'  {k:32}: {v}')
    for lay, (a, t) in by_layout.items():
        print(f'  {lay:40}: {a}/{t} agree ({100 * a / max(1, t):.0f}%)')


if __name__ == '__main__':
    main()
