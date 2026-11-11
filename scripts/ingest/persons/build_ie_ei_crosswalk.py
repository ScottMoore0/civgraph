#!/usr/bin/env python3
"""Map IrelandElection.com person ids ("ie:<n>") to ElectionsIreland person ids ("ei:<n>").

The Republic's local elections reach the data from two systems. ElectionsIreland's result
pages give every candidate its candidate.cfm id ("ei:"); the gap-fills taken from the
Department's books and the councils' sheets, and the 1974-1991 councils, carry
IrelandElection.com's person ids ("ie:"). One councillor can therefore hold an id of each
system: Adam Wyse is ei:10134 for Waterford City East in 2014 and 2024 and ie:5948 for the same
seat in 2019, and the person registry made him two people. This pass finds those pairs once,
systematically, and writes data/elections/persons/ie-ei-crosswalk.csv; merge_person_ids.py joins
each pair (class IE-EI-CROSSWALK), under its usual vetoes, so every rebuild keeps them joined.

A pair is written only on this evidence, all of it:
  * the same name (the registry's match key);
  * the same council area (a county with its city; Dublin's four councils one area);
  * consecutive local elections, or the ie row falling between two ei rows;
  * the same electoral area, or its successor: an area that at least two other candidates of
    the same name and party moved into at the next election, or one sharing a town in its name
    (Mullingar-Kilbeggan and Mullingar);
  * the same party (Workers' Party lineage one party; "Non party/Independent" is Independent);
  * or, for a councillor and a Dail or European candidate: the same name and a real party
    (not Independent), a constituency named for the council's county, and no more than five
    years apart;
and none of these:
  * both ids in one election;
  * a namesake (another id, or an id-less row, of that name) in the council area, or in a
    constituency of that county, within one election of the pair;
  * the ie id matching more than one ElectionsIreland id on that evidence;
  * the ie person already joined to a different ElectionsIreland id, or the pair joining two;
  * ElectionsIreland naming relatives for the ei id (ei-candidate-relatives.json), or a Snr,
    Jnr or numeral in either name;
  * an ElectionsIreland id whose career spans more than 30 years (a national match only).

Everything else that shares a name in the same council area, or that the 2024 merge leads
listed, is written to the review file (--review) with the reasons it was held.

The pairs were found on 11 Nov 2026 from the stamped election bundle, before the crosswalk
joined anything. Pairs already in the crosswalk are kept; run with --fresh to rebuild it from
nothing.

Usage:  python scripts/ingest/persons/build_ie_ei_crosswalk.py [--fresh] [--review PATH] [--leads CSV]
"""
import argparse
import collections
import csv
import glob
import json
import os
import re
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
_RP = __import__('runpy').run_path(os.path.join(REPO, 'scripts', 'records', 'paths.py'))
META = _RP['ELECTION_BUNDLE_DIR']
PERS = os.path.join(REPO, 'data', 'elections', 'persons')
OUT = os.path.join(PERS, 'ie-ei-crosswalk.csv')
RELATIVES = os.path.join(PERS, 'ei-candidate-relatives.json')
# keep, drop: the person ids of the first merge of the pair (merge_person_ids.py writes them), so the id it
# retired keeps redirecting after later rebuilds.
FIELDS = ['ie', 'ei', 'name', 'council_area', 'link', 'ie_evidence', 'ei_evidence', 'ie_years', 'ei_years', 'found',
          'keep', 'drop']
NATIONAL = ('dail-eireann', 'ireland-european')
SUFFIX = re.compile(r'\b(jn?r|jun|junior|sn?r|sen|senior|[IVX]{2,})\b', re.I)
NO_PARTY = {'', 'independent', 'non party', 'nonparty'}
# One party under several labels: the Workers' Party lineage (owner, 2 Nov 2026), the Greens' two
# labels, a group's long and short names, "Non party/Independent".
PARTY_SAME = {'non party independent': 'independent', 'sinn fein workers party': 'workers party',
              'sinn fein the workers party': 'workers party', 's f w p': 'workers party',
              'sinn fein official': 'workers party', 'green comhaontas glas': 'green',
              'workers and unemployed action group': 'workers and unemployed action', 'solidarity pbp': 'pbp'}
AREA_WORDS = {'dublin': ('dublin', 'dun', 'laoghaire', 'fingal', 'rathdown'), 'laois': ('laois', 'leix', 'laoighis')}
# Words in an electoral area's name that say nothing about which town it is.
GENERIC = {'city', 'south', 'west', 'east', 'north', 'central', 'inner', 'no', 'on', 'the', 'and', 'rural', 'urban',
           'ward', 'area', 'upper', 'lower', 'mid', 'electoral', 'lea', 'county', 'town', 'suir', 'shannon'}


# Reasons that say the two ids are two people, or that joining them would join two people: the
# pair is rejected. Any other reason leaves it for the owner to decide (held).
REJECT = ('both ids in one election', 'ElectionsIreland names relatives', 'Snr, Jnr or a numeral',
          'the ie person already holds', 'the ie person would join two', 'several ie ids for this')


def matchkey(v):
    t = unicodedata.normalize('NFKD', re.sub(r'\s+', ' ', str(v or '')).strip())
    t = ''.join(c for c in t if not unicodedata.combining(c))
    t = t.lower().replace('’', "'").replace('‘', "'")
    return re.sub(r'\s+', ' ', re.sub(r"[^a-z0-9 ]+", ' ', t)).strip()


def council_area(council):
    """As build_person_registry_v2.council_area: a county with its city, Dublin one area."""
    c = re.sub(r'\s+', ' ', str(council or '')).strip()
    if re.search(r'Fingal|South Dublin|D[uú]n Laoghaire|Dublin', c, re.I):
        return 'dublin'
    c = re.sub(r'\([^)]*\)|\b(North|South) Riding\b', ' ', c)
    c = re.sub(r'\b(City and County|County|City|Borough|Town|Urban District|Corporation)\b.*$', '', c, flags=re.I).strip()
    return matchkey(c)


def party_key(p):
    return PARTY_SAME.get(matchkey(p), matchkey(p))


def scan():
    rows, councils = [], {}

    def council_of(source_file):
        if source_file and source_file not in councils:
            try:
                councils[source_file] = json.load(open(os.path.join(REPO, source_file), encoding='utf-8')).get('council') or ''
            except (OSError, ValueError):
                councils[source_file] = ''
        return councils.get(source_file, '')
    for f in sorted(glob.glob(os.path.join(META, '*.json'))):
        d = json.load(open(f, encoding='utf-8'))
        if d.get('contestType') == 'referendum':
            continue
        body = d.get('bodySlug') or ''
        for r in d.get('results') or []:
            local = body == 'ireland-local'
            council = council_of(r.get('sourceFile')) if local else ''
            for c in r.get('candidates') or []:
                if not (c.get('name') or '').strip():
                    continue
                cons = str(r.get('constituency') or '')
                rows.append({'key': d.get('key'), 'body': body, 'date': str(d.get('date') or ''),
                             'year': int(str(d.get('date') or '0')[:4] or 0), 'cons': cons, 'name': c['name'].strip(),
                             'party': c.get('party') or '', 'src': str(c.get('sourcePersonId') or '').strip(),
                             'pid': str(c.get('personId') or ''), 'nk': matchkey(c['name']),
                             'ar': council_area(council) if local else '', 'lea': matchkey(cons.replace('*', '')).replace(' ', ''),
                             'pt': party_key(c.get('party') or '')})
    return rows


def find_pairs(rows, relatives):
    """Every ie/ei pair that shares a name in one council area (or in a constituency of its
    county), with its evidence and the reasons, if any, it is held."""
    local = [r for r in rows if r['body'] == 'ireland-local']
    dates = sorted({r['date'] for r in local})
    at = {d: i for i, d in enumerate(dates)}
    by_src, by_pid = collections.defaultdict(list), collections.defaultdict(list)
    for r in rows:
        if r['src']:
            by_src[r['src']].append(r)
        if r['pid']:
            by_pid[r['pid']].append(r)
    loc_by, nat_by = collections.defaultdict(list), collections.defaultdict(list)
    for r in local:
        loc_by[(r['ar'], r['nk'])].append(r)
    for r in rows:
        if r['body'] in NATIONAL:
            nat_by[r['nk']].append(r)
    # Which area each area became at the next election, as the candidates who stood again saw it.
    moved = collections.defaultdict(set)
    runs = collections.defaultdict(list)
    for r in local:
        runs[(r['ar'], r['nk'], r['pt'])].append(r)
    for k, rs in runs.items():
        for a in rs:
            for b in rs:
                if at[b['date']] == at[a['date']] + 1 and a['lea'] != b['lea']:
                    moved[(a['ar'], a['date'], a['lea'], b['lea'])].add(k)

    def place_words(r):
        county = set(AREA_WORDS.get(r['ar'], (r['ar'],))) | set(r['ar'].split())
        return {w for w in matchkey(r['cons'].replace('*', '')).split()
                if w not in GENERIC and w not in county and not w.isdigit() and len(w) > 2}

    def area_link(a, b):
        if a['lea'] == b['lea']:
            return 'same-lea'
        x, y = (a, b) if at[a['date']] < at[b['date']] else (b, a)
        if len(moved[(x['ar'], x['date'], x['lea'], y['lea'])] - {(a['ar'], a['nk'], a['pt'])}) >= 2:
            return 'successor-lea'
        return 'shared-place' if place_words(x) & place_words(y) else None

    def in_county(cons, ar):
        c = ' %s ' % matchkey(cons)
        return bool(ar) and any(' %s ' % w in c for w in AREA_WORDS.get(ar, (ar,)))

    def row_text(r):
        return f"{r['date'][:4]} {'' if r['body'] == 'ireland-local' else r['body'] + ' '}{r['cons']} ({r['party'] or 'no party'})"

    pairs = []
    for ie in sorted((s for s in by_src if s.startswith('ie:')), key=lambda s: int(s[3:])):
        mine = [r for r in by_src[ie] if r['body'] == 'ireland-local']
        if not mine:
            continue
        cands = {o['src'] for r in mine for o in loc_by[(r['ar'], r['nk'])] + nat_by[r['nk']] if o['src'].startswith('ei:')}
        for ei in sorted(cands, key=lambda s: int(s[3:])):
            theirs = by_src[ei]
            best = None
            for a in mine:
                for b in theirs:
                    if a['nk'] != b['nk']:
                        continue
                    if b['body'] == 'ireland-local':
                        if a['ar'] != b['ar']:
                            continue
                        gap = abs(at[a['date']] - at[b['date']])
                        link = area_link(a, b) if gap == 1 else None
                        near = gap == 1
                    elif b['body'] in NATIONAL:
                        near = abs(a['year'] - b['year']) <= 5
                        link = 'county-constituency' if in_county(b['cons'], a['ar']) else None
                    else:
                        continue
                    pm = bool(a['pt']) and a['pt'] == b['pt']
                    score = (b['body'] == 'ireland-local', near, link is not None, pm, link == 'same-lea', -abs(a['year'] - b['year']))
                    if best is None or score > best[0]:
                        best = (score, dict(near=near, link=link, party=pm, a=a, b=b))
            if best is None:
                continue
            ev = best[1]
            a = ev['a']
            ie_pid = {r['pid'] for r in by_src[ie]}
            ei_pid = {r['pid'] for r in theirs}
            years = [r['year'] for r in mine] + [r['year'] for r in theirs if r['body'] == 'ireland-local' and r['ar'] == a['ar']
                                                   or r['body'] in NATIONAL and in_county(r['cons'], a['ar'])]
            lo, hi = min(years) - 5, max(years) + 5
            namesakes = sorted({o['src'] or 'no-id:p' + o['pid'] for o in loc_by[(a['ar'], a['nk'])] + nat_by[a['nk']]
                                if o['src'] not in (ie, ei) and o['pid'] not in ie_pid | ei_pid and lo <= o['year'] <= hi
                                and (o['body'] == 'ireland-local' or in_county(o['cons'], a['ar']))})
            why = []
            if not ev['near']:
                why.append('not consecutive elections' if ev['b']['body'] == 'ireland-local' else 'more than five years apart')
            if ev['link'] is None:
                why.append('different electoral area' if ev['b']['body'] == 'ireland-local' else 'constituency outside the county')
            if not ev['party']:
                why.append('party differs')
            elif ev['link'] == 'county-constituency' and a['pt'] in NO_PARTY:
                why.append('Independent is not a party (council to Dail match)')
            if {r['key'] for r in by_src[ie]} & {r['key'] for r in theirs}:
                why.append('both ids in one election')
            if namesakes:
                why.append('namesake in the area: ' + ' '.join(namesakes))
            other = sorted({x['src'] for p in ie_pid for x in by_pid[p] if x['src'].startswith('ei:') and x['src'] != ei})
            if other and not ie_pid & ei_pid:
                why.append('the ie person already holds ' + ' '.join(other))
            if ei in relatives or any(ei in (v.get('relatives') or {}) for v in relatives.values()):
                why.append('ElectionsIreland names relatives')
            if SUFFIX.search(' '.join({r['name'] for r in by_src[ie] + theirs})):
                why.append('Snr, Jnr or a numeral in the name')
            span = [r['year'] for r in theirs]
            if ev['link'] == 'county-constituency' and max(span) - min(span) > 30:
                why.append('the ElectionsIreland id spans more than 30 years')
            pairs.append({'ie': ie, 'ei': ei, 'name': a['name'], 'council_area': a['ar'], 'link': ev['link'] or '',
                          'ie_evidence': row_text(a), 'ei_evidence': row_text(ev['b']),
                          'ie_years': ' '.join(sorted({r['date'][:4] for r in by_src[ie]})),
                          'ei_years': ' '.join(sorted({r['date'][:4] for r in theirs})),
                          'ie_persons': ' '.join(sorted(ie_pid)), 'ei_persons': ' '.join(sorted(ei_pid)),
                          'already_joined': bool(ie_pid & ei_pid), 'why': why, 'local': ev['b']['body'] == 'ireland-local'})
    # One ie id, one ElectionsIreland id: an ie id that matches two on the area evidence is ambiguous.
    plausible = collections.Counter(p['ie'] for p in pairs if p['link'] and 'not consecutive elections' not in p['why']
                                    and 'more than five years apart' not in p['why'])
    for p in pairs:
        if plausible[p['ie']] > 1:
            p['why'].append(f"the ie id matches {plausible[p['ie']]} ElectionsIreland ids")
    # Several ie ids for one ElectionsIreland id (IrelandElection.com's own duplicates) only if
    # none of them stood in the same election as another; one ie person joining two ei ids, never.
    ok = [p for p in pairs if not p['why']]
    by_ei = collections.defaultdict(list)
    for p in ok:
        by_ei[p['ei']].append(p)
    for ps in by_ei.values():
        keys = [{r['key'] for r in by_src[p['ie']]} for p in ps]
        if any(keys[i] & keys[j] for i in range(len(ps)) for j in range(i + 1, len(ps))):
            for p in ps:
                p['why'].append('several ie ids for this ElectionsIreland id stood in one election')
    held_ei = collections.defaultdict(set)
    for p in (p for p in pairs if not p['why']):
        for pid in p['ie_persons'].split():
            held_ei[pid].add(p['ei'])
            held_ei[pid] |= {x['src'] for x in by_pid[pid] if x['src'].startswith('ei:')}
    for p in pairs:
        if not p['why'] and any(len(held_ei[pid]) > 1 for pid in p['ie_persons'].split()):
            p['why'].append('the ie person would join two ElectionsIreland ids')
    return pairs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fresh', action='store_true', help='ignore the crosswalk on file')
    ap.add_argument('--review', default=os.path.join(REPO, 'tmp', 'ie-ei-crosswalk-review.csv'))
    ap.add_argument('--leads', help='a merge-leads CSV (new_ids, existing_ids columns) whose pairs are always reviewed')
    ap.add_argument('--found', default='2026-11-11')
    args = ap.parse_args()
    relatives = json.load(open(RELATIVES, encoding='utf-8')).get('persons') or {} if os.path.exists(RELATIVES) else {}
    pairs = find_pairs(scan(), relatives)
    on_file = {}
    if os.path.exists(OUT):
        with open(OUT, encoding='utf-8', newline='') as fh:
            on_file = {(r['ie'], r['ei']): r for r in csv.DictReader(fh)}
    kept = {} if args.fresh else dict(on_file)
    apply = dict(kept)
    for p in pairs:
        if not p['why'] and (p['ie'], p['ei']) not in apply:
            # A merge already made for the pair keeps its record (the id it retired), even --fresh.
            had = on_file.get((p['ie'], p['ei'])) or {}
            apply[(p['ie'], p['ei'])] = {**{k: p[k] for k in FIELDS if k in p}, 'found': had.get('found') or args.found,
                                         'keep': had.get('keep', ''), 'drop': had.get('drop', '')}
    for key, r in kept.items():
        now = next((p for p in pairs if (p['ie'], p['ei']) == key), None)
        if now and now['why']:
            print(f"  on file, now held: {key[0]} -> {key[1]} {r['name']}: {'; '.join(now['why'])}")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS, lineterminator='\n')
        w.writeheader()
        for k in sorted(apply, key=lambda k: (int(k[0][3:]), int(k[1][3:]))):
            w.writerow({f: apply[k].get(f, '') for f in FIELDS})
    leads = set()
    if args.leads:
        with open(args.leads, encoding='utf-8', newline='') as fh:
            leads = {(r['new_ids'], r['existing_ids']) for r in csv.DictReader(fh)}
    # The review: every held pair with some area evidence, and every listed lead.
    review = [p for p in pairs if p['why'] and (p['link'] or (p['ie'], p['ei']) in leads) and not p['already_joined']]
    os.makedirs(os.path.dirname(args.review), exist_ok=True)
    cols = ['ie', 'ei', 'name', 'council_area', 'link', 'ie_evidence', 'ei_evidence', 'ie_years', 'ei_years',
            'ie_persons', 'ei_persons', 'in_2024_leads', 'verdict', 'held_because']
    with open(args.review, 'w', encoding='utf-8', newline='\n') as fh:
        w = csv.DictWriter(fh, fieldnames=cols, lineterminator='\n')
        w.writeheader()
        for p in sorted(review, key=lambda p: (p['name'], p['ie'], p['ei'])):
            w.writerow({**{c: p.get(c, '') for c in cols}, 'in_2024_leads': 'yes' if (p['ie'], p['ei']) in leads else '',
                        'verdict': 'rejected' if any(w.startswith(REJECT) for w in p['why']) else 'held',
                        'held_because': '; '.join(p['why'])})
    new = [p for p in pairs if not p['why'] and not p['already_joined']]
    print(f"pairs sharing a name in one area: {len(pairs):,}")
    print(f"  crosswalk on file: {len(apply):,} pairs ({len(kept):,} kept from before)")
    print(f"  of which already one person: {sum(1 for p in pairs if not p['why'] and p['already_joined']):,}; "
          f"newly joined: {len(new):,} ({sum(1 for p in new if p['local']):,} council to council, "
          f"{sum(1 for p in new if not p['local']):,} council to Dail or European)")
    rejected = sum(1 for p in review if any(w.startswith(REJECT) for w in p['why']))
    print(f"  for review: {len(review):,}: {len(review) - rejected:,} held, {rejected:,} rejected (written to {args.review})")
    print(f"wrote {OUT}")


if __name__ == '__main__':
    main()
