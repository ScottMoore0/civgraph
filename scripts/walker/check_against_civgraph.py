#!/usr/bin/env python3
"""Compare Civgraph's election figures against Walker's printed tables.

    WALKER_DIR=/path/to/scans python scripts/walker/check_against_civgraph.py \
        --volume walker-ireland-1801-1922.pdf --pages 146-151 \
        --body house-of-commons-of-the-united-kingdom --date 1885-11-24

Read-only on both sides: this reports, it never edits election data. Findings belong in
data/elections/corrections/ for review, which is the pattern the repository already uses
for source-backed changes.

WHY THE SCREENS BELOW EXIST

An earlier version of this check reported 24 confident electorate "errors". Every one was
an artefact, and each screen here answers one of them:

  * Pairing by the year in the running head was wrong by one election, because the head
    scan reads the facing page's head too. Walker's figure kept turning out to be
    Civgraph's figure for the NEXT election -- Belfast East walker=62,798 civgraph=61,561,
    where Civgraph's own series runs 1950: 61,561, 1951: 62,798. Pages are therefore
    aligned by evidence: scored against every candidate election and paired with the one
    whose figures they reproduce.
  * A row can bleed across a table boundary, so a figure that is the SAME SEAT'S value in
    another election is discarded.
  * A row can bleed into its neighbour on the same page, so a figure that is ANOTHER
    seat's value in the SAME election is discarded -- Walker's "Waterford county" row
    picked up 12,063, which is Waterford CITY's figure two lines away.
  * "Waterford" and "Waterford County" are different seats with different electorates, so
    a qualified name never matches a bare one where both exist.

A screen can only ever discard a finding, never create one.
"""
import argparse
import difflib
import json
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import extract_page  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SRC = os.path.join(ROOT, 'data', 'elections-source', 'data', 'elections')
WALKER_DIR = os.environ.get('WALKER_DIR', '.')

# Civgraph abbreviates the compass point in this period -- "Antrim N", "Armagh Mid" --
# while Walker spells it out.
COMPASS = {'n': 'north', 's': 'south', 'e': 'east', 'w': 'west', 'ne': 'northeast',
           'nw': 'northwest', 'se': 'southeast', 'sw': 'southwest', 'co': 'county'}
QUALIFIED = re.compile(r'(county|city|borough)', re.I)
TITLES = (r'\b(Dr|Mr|Mrs|Miss|Sir|Prof|Major|Capt|Captain|Col|Lt|Rt|Hon|The|Lord|Lady|bt'
          r'|Gen|Revd?|K\.?C\.?|D\.?Litt\.?|M\.?P\.?)\b')


def norm(s):
    s = unicodedata.normalize('NFKD', s or '').replace('’', "'")
    s = ''.join(c for c in s if not unicodedata.combining(c))
    parts = [p for p in re.split(r'[^A-Za-z0-9]+', s.lower()) if p]
    return ''.join(COMPASS.get(p, p) for p in parts)


def surname(name):
    n = re.sub(TITLES, ' ', name or '', flags=re.I)
    n = re.sub(r'[,(].*$', '', n)
    parts = [p for p in re.split(r'\s+', n) if len(p) > 1 and not p.isdigit()]
    return norm(parts[-1]) if parts else ''


def to_int(v):
    s = str(v if v is not None else '').replace(',', '').strip()
    return int(s) if re.fullmatch(r'\d+', s) else None


def load_civ(body, date):
    """Civgraph's contests for one election. Two schemas live side by side: Westminster
    and Northern Ireland files use Constituency.countInfo/countGroup, the Dail files a
    flat meta/candidates shape. Reading only the first returns no candidates for every
    Dail election, which silently compares nothing."""
    d = os.path.join(SRC, body, date)
    if not os.path.isdir(d):
        return {}
    out = {}
    for f in sorted(os.listdir(d)):
        if not f.endswith('.json') or f.startswith('_'):
            continue
        try:
            doc = json.load(open(os.path.join(d, f), encoding='utf-8'))
        except Exception:
            continue
        if isinstance(doc.get('candidates'), list):
            meta = doc.get('meta') or {}
            rec = {'name': doc.get('constituency') or f[:-5].replace('-', ' '),
                   'electorate': to_int(meta.get('electorate')),
                   'validPoll': to_int(meta.get('valid_poll') or meta.get('total_poll')),
                   'candidates': [{'name': g.get('name'), 'votes': to_int(g.get('first_pref'))}
                                  for g in doc['candidates']],
                   'file': f'data/elections-source/data/elections/{body}/{date}/{f}'}
        else:
            c = doc.get('Constituency') or doc
            info = c.get('countInfo') or {}
            rec = {'name': info.get('Constituency_Name') or f[:-5].replace('-', ' '),
                   'electorate': to_int(info.get('Total_Electorate')),
                   'validPoll': to_int(info.get('Valid_Poll')),
                   'candidates': [{'name': g.get('candidateName') or ' '.join(
                       x for x in [g.get('Firstname'), g.get('Surname')] if x),
                       'votes': to_int(g.get('Candidate_First_Pref_Votes'))}
                       for g in (c.get('countGroup') or [])],
                   'file': f'data/elections-source/data/elections/{body}/{date}/{f}'}
        # An electorate Civgraph now takes FROM Walker cannot be checked against Walker:
        # agreement would be circular, and the raw file's figure is no longer the one shown.
        if rec['file'] in walker_supplied_electorates():
            rec['electorate'] = None
        out[norm(rec['name'])] = rec
    return out


_SUPPLIED = None


def walker_supplied_electorates():
    """Source files whose electorate the manifest overlay replaces with Walker's figure."""
    global _SUPPLIED
    if _SUPPLIED is None:
        _SUPPLIED = set()
        corr = os.path.join(ROOT, 'data', 'elections', 'corrections')
        review = os.path.join(corr, 'walker-electorate-review.json')
        if os.path.exists(review):
            _SUPPLIED |= {r['sourceFile'] for r in json.load(open(review, encoding='utf-8'))['records']
                          if r.get('status') == 'applied' and r.get('field') == 'electorate'}
        pre = os.path.join(corr, 'walker-pre1918-electorates.json')
        if os.path.exists(pre):
            _SUPPLIED |= {r['sourceFile'] for r in json.load(open(pre, encoding='utf-8'))['records']}
    return _SUPPLIED


def dates_of(body):
    d = os.path.join(SRC, body)
    return sorted(x for x in os.listdir(d) if re.match(r'^\d{4}-\d{2}-\d{2}', x)) \
        if os.path.isdir(d) else []


def resolve(name, keys):
    k = norm(name)
    if k in keys:
        return k
    if QUALIFIED.search(name or ''):
        bare = norm(QUALIFIED.sub('', name))
        variants = [c for c in keys if c == bare or c.startswith(bare)]
        return bare if (bare in keys and len(variants) == 1) else None
    if len(k) < 4:
        return None
    bare_exists = k in keys
    hits = [c for c in keys if (c.endswith(k) or c.startswith(k))
            and not (bare_exists and QUALIFIED.search(c))]
    if len(hits) == 1:
        return hits[0]
    if hits:
        return None
    close = difflib.get_close_matches(k, list(keys), n=2, cutoff=0.82)
    if not close:
        return None
    best = difflib.SequenceMatcher(None, k, close[0]).ratio()
    if len(close) > 1 and best - difflib.SequenceMatcher(None, k, close[1]).ratio() < 0.06:
        return None
    return close[0]


def score(rows, civ):
    hits, seen = 0, set()
    for r in rows:
        key = resolve(r['constituency'], civ.keys())
        if not key:
            continue
        c = civ[key]
        if r['electorate'] and c['electorate'] == r['electorate'] and ('e', key) not in seen:
            hits += 2
            seen.add(('e', key))
        if r['votes'] is not None:
            for x in c['candidates']:
                if x['votes'] == r['votes'] and surname(x['name']) == surname(r['candidate']):
                    if ('v', key, r['votes']) not in seen:
                        hits += 1
                        seen.add(('v', key, r['votes']))
                    break
    return hits


def best_election(rows, body, margin=1.6):
    scored = []
    for dt in dates_of(body):
        civ = load_civ(body, dt)
        if len(civ) >= 3:
            scored.append((score(rows, civ), dt))
    scored.sort(reverse=True)
    if not scored or scored[0][0] < 4:
        return None
    if len(scored) > 1 and scored[1][0] and scored[0][0] < scored[1][0] * margin:
        return None
    return scored[0][1]


def elsewhere(body, date, key, value):
    for other in dates_of(body):
        if other == date:
            continue
        c = load_civ(body, other).get(key)
        if c and c['electorate'] == value:
            return other
    return None


def check(volume, first, last, body, date=None):
    path = os.path.join(WALKER_DIR, volume)
    rows = []
    for idx in range(first, last + 1):
        try:
            rows += extract_page(path, idx)[0]
        except Exception:
            continue
    if date is None:
        date = best_election(rows, body)
        if date is None:
            return {'error': 'pages could not be aligned to any election'}
    civ = load_civ(body, date)
    walker = {}
    for r in rows:
        key = resolve(r['constituency'], civ.keys())
        if not key:
            continue
        w = walker.setdefault(key, {'electorate': None, 'cands': []})
        if r['electorate'] and not w['electorate']:
            w['electorate'] = r['electorate']
        w['cands'].append(r)

    findings, agree = [], {'electorate': 0, 'votes': 0}
    for key, w in walker.items():
        c = civ[key]
        if w['electorate'] and c['electorate']:
            if w['electorate'] == c['electorate']:
                agree['electorate'] += 1
            elif any(o is not c and o['electorate'] == w['electorate'] for o in civ.values()):
                pass                                    # another seat, same election
            elif elsewhere(body, date, key, w['electorate']):
                pass                                    # same seat, another election
            else:
                findings.append({'field': 'electorate', 'body': body, 'date': date,
                                 'constituency': c['name'], 'walker': w['electorate'],
                                 'civgraph': c['electorate'], 'sourceFile': c['file']})
        by_sur = {}
        for x in c['candidates']:
            by_sur.setdefault(surname(x['name']), []).append(x)
        total = sum(x['votes'] or 0 for x in c['candidates'])
        vp = c['validPoll'] or (total or None)
        for wc in w['cands']:
            g = by_sur.get(surname(wc['candidate'])) or []
            hit = g[0] if len(g) == 1 else (
                next((x for x in g if x['votes'] == wc['votes']), None)
                if wc['votes'] is not None else None)
            if not hit or wc['votes'] is None or hit['votes'] is None:
                continue
            if wc['votes'] == hit['votes']:
                agree['votes'] += 1
                continue
            # Civgraph's candidates should sum to its own stated valid poll. If putting
            # Walker's figure in breaks that sum, the Walker figure is a bad OCR read
            # rather than a disagreement.
            if vp and total == vp and total - hit['votes'] + wc['votes'] != vp:
                continue
            findings.append({'field': 'votes', 'body': body, 'date': date,
                             'constituency': c['name'], 'candidate': hit['name'],
                             'walker': wc['votes'], 'civgraph': hit['votes'],
                             'sourceFile': c['file']})
    return {'date': date, 'matched': len(walker), 'contests': len(civ),
            'agree': agree, 'findings': findings}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--volume', required=True)
    ap.add_argument('--pages', required=True, help='page index range, e.g. 146-151')
    ap.add_argument('--body', required=True)
    ap.add_argument('--date', help='Civgraph election date; inferred from the figures if omitted')
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()
    lo, hi = (int(x) for x in args.pages.split('-'))
    res = check(args.volume, lo, hi, args.body, args.date)
    if args.json:
        print(json.dumps(res, indent=1))
        return
    if 'error' in res:
        sys.exit(res['error'])
    print(f"{args.body} {res['date']}: matched {res['matched']} of {res['contests']} contests")
    print(f"  agree: {res['agree']['electorate']} electorate, {res['agree']['votes']} votes")
    print(f"  findings surviving every screen: {len(res['findings'])}")
    for f in res['findings']:
        who = f" / {f['candidate']}" if f.get('candidate') else ''
        print(f"    {f['field']:10} {f['constituency']}{who}: "
              f"walker={f['walker']} civgraph={f['civgraph']}")


if __name__ == '__main__':
    main()
