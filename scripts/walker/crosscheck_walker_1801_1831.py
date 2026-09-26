#!/usr/bin/env python3
"""Check the 1801-1831 results read from Walker's pages against Wikipedia.

    python scripts/walker/crosscheck_walker_1801_1831.py [--from <transcription dir>]

Before 1832 Wikipedia's constituency articles have no election boxes, so Walker is the
source and Wikipedia the check (the reverse of 1832-1880). The results were read off the
printed page, not the OCR: data/elections/walker-1801-1831-results.json holds them, figures
and facts only, with the page each came from. `--from` rebuilds that file from the
page-by-page transcription files. The checks:
  - general elections: the members returned agree with Wikipedia's list of MPs for that
    election (either as first returned or as seated on petition);
  - by-elections: a by-election in Wikipedia's lists for that seat within 60 days, with the
    same winner.
Output: data/elections/walker-1801-1831-crosscheck.json. Nothing is imported here.
"""
import collections
import datetime
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crosscheck_constituency_boxes import exact, surname  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
D = os.path.join(ROOT, 'data', 'elections')
RESULTS = os.path.join(D, 'walker-1801-1831-results.json')
GENERAL = {1802, 1806, 1807, 1812, 1818, 1820, 1826, 1830, 1831}


def seat_keys(name):
    """The names a seat may go by: Walker's "Wicklow county" is Wikipedia's "County Wicklow"
    or plain "Wicklow"; "Cork city" is "Cork City" or "Cork"."""
    n = exact(name)
    stem = re.sub(r'^county |\b(county|city|borough|town)$', '', n).strip()
    kind = 'county' if re.search(r'\bcounty\b', n) else 'borough'
    keys = [n, stem, 'county ' + stem, stem + ' county', stem + ' city', stem + ' borough', stem + ' town',
            stem + ' bridge']   # Walker's "Bandon" is the lists' "Bandon Bridge"
    return list(dict.fromkeys(keys)), kind


GENERIC = {'hon', 'rt', 'sir', 'bt', 'bart', 'viscount', 'lord', 'earl', 'baron', 'marquess', 'of', 'the', 'knight',
           'col', 'lt', 'gen', 'maj', 'capt', 'dr', 'jnr', 'snr', 'jun', 'sen', 'mp', 'right', 'honourable'}


def tokens(name):
    """Every part of a name, the bracketed family name of a peer included: "Viscount
    Castlereagh (Robert Stewart)" is {castlereagh, robert, stewart}. Particles are joined to
    what follows, so "La Touche" is "latouche"."""
    n = exact(re.sub(r'[()]', ' ', member(name)))
    n = re.sub(r'\b(la|le|de|du|mac|mc|o) (?=[a-z])', r'\1', n)
    return {t for t in n.split() if len(t) > 1 and t not in GENERIC}


def near(a, b):
    """The same name spelt two ways (Magennis/Magenis, Westerna/Westenra, Taylor/Taylour)."""
    if a == b:
        return True
    if min(len(a), len(b)) < 5 or abs(len(a) - len(b)) > 2:
        return False
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1] <= 2


def fuzzy(ta, tb):
    return {t for t in ta if any(near(t, u) for u in tb)}


def keys(name):
    """What identifies a member: his surname, the family name in a peer's brackets, and the
    word after his title. "Viscount Castlereagh (Robert Stewart)" and the list's "Viscount
    Castlereagh Robert Stewart" both give castlereagh and stewart."""
    m = member(name)
    out = {surname(m)}
    inner = re.findall(r'[(]([^)]*)[)]', m)
    if inner:
        out.add(surname(inner[-1]))
    t = re.search(r'\b(?:viscount|earl|marquess|baron|knight)\s+(?:of\s+)?([A-Za-z-]+)', m, re.I)
    if t:
        out.add(t.group(1).lower().replace('-', ''))
    return {re.sub(r'[^a-z]', '', k) for k in out if k}


def same_people(walker_names, list_names):
    """True when Walker's members and the list's pair off one to one on a surname or title,
    allowing a spelling variant."""
    a = [keys(n) for n in walker_names]
    b = [keys(n) for n in list_names]
    if len(a) != len(b):
        return False
    left = list(range(len(a)))
    for tb in b:
        exact_hit = [i for i in left if a[i] & tb]
        hit = exact_hit or [i for i in left if fuzzy(a[i], tb)]
        if not hit:
            return False
        left.remove(hit[0])
    return True


def overlap(walker_names, list_names):
    a = set().union(*[tokens(n) for n in walker_names]) if walker_names else set()
    return sum(1 for n in list_names if fuzzy(keys(n), a | set().union(*[keys(w) for w in walker_names])))


def plain(name):
    return re.sub(r'\s+re-?elected\b.*$', '', name or '', flags=re.I).strip()


def member(name):
    # "William Handcock – resigned Replaced by ...", "Mathew Pennefather [ mpnotes 6 ]"
    return re.sub(r'\s*\[[^\]]*\]', '', re.split(r'\s+[–-]\s+', name or '')[0]).strip()


def build_results(src):
    pages = []
    for f in sorted(glob.glob(os.path.join(src, 'pages-*.json'))):
        pages += json.load(open(f, encoding='utf-8'))['pages']
    records, seen, dup = [], {}, []
    for p in sorted(pages, key=lambda p: p['page']):
        for c in p['contests']:
            k = (c['kind'], c['electionYear'], exact(c['constituency']), c.get('date'))
            rec = {'page': p['page'], **{x: c.get(x) for x in (
                'kind', 'electionYear', 'date', 'dateAsPrinted', 'constituency', 'seats', 'unopposed',
                'candidates', 'outcomeFacts', 'seatedOnPetition', 'unseatedOnPetition', 'uncertain')}}
            if k in seen:
                # The scan holds one book page twice (1820, Clare to Galway). Two independent
                # readings of it are a check on the reading itself.
                a = seen[k]
                same = [(x['name'], x['votes']) for x in a['candidates']] == [(x['name'], x['votes']) for x in c['candidates']]
                dup.append({'constituency': c['constituency'], 'year': c['electionYear'], 'pages': [a['page'], p['page']],
                            'readingsAgree': same})
                continue
            seen[k] = rec
            records.append(rec)
    doc = {'schemaVersion': 1,
           'description': ('Irish parliamentary election results 1801-1831, read from the printed pages of Walker '
                           '(figures and facts only). The source for 1801-1831, checked against Wikipedia.'),
           'provenance': {'source': {'title': 'Parliamentary Election Results in Ireland, 1801-1922',
                                     'editor': 'Brian M. Walker (ed.)', 'publisher': 'Royal Irish Academy', 'year': 1978},
                          'method': 'each page read from the scan (not OCR); page = 0-based index into the private scan',
                          'licence': 'Figures only. Election results are facts and carry no copyright; the volume is in '
                                     'copyright and is not reproduced.',
                          'gaps': 'Book page 20 is missing from the scan: the end of the 1807-12 by-elections (after '
                                  '3 March 1810) and the first two seats of the 1812 general election.'},
           'duplicateReadings': dup,
           'counts': dict(collections.Counter(f"{r['kind']} {r['electionYear']}" for r in records)),
           'records': records}
    with open(RESULTS, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(f'{len(records)} contests; {len(dup)} read twice, {sum(1 for d in dup if d["readingsAgree"])} alike')


def days(a, b):
    try:
        return abs((datetime.date.fromisoformat(a) - datetime.date.fromisoformat(b)).days)
    except (TypeError, ValueError):
        return None


def main():
    if '--from' in sys.argv:
        build_results(sys.argv[sys.argv.index('--from') + 1])
    walker = json.load(open(RESULTS, encoding='utf-8'))['records']
    lists = json.load(open(os.path.join(D, 'wikipedia-mp-lists-ireland.json'), encoding='utf-8'))['records']
    byes = json.load(open(os.path.join(D, 'wikipedia-uk-byelection-lists-ireland-1801-1831.json'), encoding='utf-8'))['records']
    mp = collections.defaultdict(dict)
    for rec in lists:
        y = int(re.search(r'\d{4}', rec['election']).group(0))
        if y in GENERAL:
            for s in rec['seats']:
                mp[y][exact(s['constituency'])] = s
    by_seat = collections.defaultdict(list)
    for r in byes:
        by_seat[exact(r['constituency'])].append(r)

    tally, out = collections.Counter(), []
    used = set()
    for w in walker:
        keys, kind = seat_keys(w['constituency'])
        cands = w['candidates']
        polled = [c for c in cands if c.get('votes') is not None]
        returned = {surname(c['name']) for c in cands if c.get('returned')}
        petition = (returned - {surname(n) for n in (w.get('unseatedOnPetition') or [])}) | \
            {surname(n) for n in (w.get('seatedOnPetition') or [])}
        rec = {'page': w['page'], 'kind': w['kind'], 'year': w['electionYear'], 'date': w['date'],
               'constituency': w['constituency'], 'polled': bool(polled)}
        if w['kind'] == 'general':
            # Of the seats the name could be, the one that shares the most people.
            options = [mp[w['electionYear']][k] for k in keys if k in mp[w['electionYear']]]
            allnames = [c['name'] for c in cands]
            # A one-member borough is not the two-member county of the same name: prefer the
            # seat with Walker's number of members, then the one that shares most people.
            scored = sorted((((len(o['members']) == (w.get('seats') or 1)), overlap(allnames, [m['name'] for m in o['members']]), -i, o)
                             for i, o in enumerate(options)), key=lambda x: x[:3], reverse=True)
            # A seat sharing nobody with Walker's contest is a failed match, not a disagreement.
            seat = scored[0][3] if scored and scored[0][1] else None
            if not seat:
                rec['status'] = 'no seat on the list of MPs'
            else:
                listed = [member(m['name']) for m in seat['members']]
                first = [c['name'] for c in cands if c.get('returned')]
                after = [c['name'] for c in cands if surname(c['name']) in petition] +                     [n for n in (w.get('seatedOnPetition') or []) if n not in [c['name'] for c in cands]]
                rec['listMembers'] = listed
                rec['listSeat'] = seat['constituency']
                rec['status'] = ('agrees' if same_people(first, listed) else
                                 'agrees after petition' if same_people(after, listed) else 'differs')
        else:
            # Walker prints a re-election as "Rowley re-elected": the surname is the name.
            first = [plain(c['name']) for c in cands if c.get('returned')]
            after = [plain(c['name']) for c in cands if surname(plain(c['name'])) in petition] + \
                list(w.get('seatedOnPetition') or [])
            near = []
            for k in keys:
                for r in by_seat.get(k, []):
                    d = days(r['date'], w['date']) if w['date'] else (0 if r['date'][:4] == str(w['electionYear']) else None)
                    if d is None or d > 400 or (r['date'], r['constituency'], r['winner']) in used:
                        continue
                    if same_people(first[:1], [r['winner']]) or same_people(after[:1], [r['winner']]):
                        near.append((d, r))
            near.sort(key=lambda x: x[0])
            if not near:
                rec['status'] = 'not on the list of by-elections'
            else:
                d, r = near[0]
                used.add((r['date'], r['constituency'], r['winner']))
                rec['listDate'], rec['listWinner'], rec['listSeat'] = r['date'], r['winner'], r['constituency']
                agree = 'agrees' if same_people(first[:1], [r['winner']]) else 'agrees after petition'
                # A year apart on the same seat and winner is a misprint in one of the two.
                rec['status'] = agree if d <= 60 else agree + ', dates differ'
        tally[f"{w['kind']}: {rec['status']}"] += 1
        out.append(rec)
    missing = [r for r in byes if (r['date'], r['constituency'], r['winner']) not in used and r['date'] < '1832']
    tally['list by-elections Walker lacks'] = len(missing)
    doc = {'schemaVersion': 1, 'counts': dict(tally), 'records': out,
           'listByElectionsNotFound': [{k: r[k] for k in ('date', 'constituency', 'winner', 'cause')} for r in missing]}
    with open(os.path.join(D, 'walker-1801-1831-crosscheck.json'), 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(json.dumps(dict(tally), indent=1))


if __name__ == '__main__':
    main()
