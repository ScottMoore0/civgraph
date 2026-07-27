#!/usr/bin/env python3
"""Find person ids that are probably wrong, and say why.

Two opposite failure modes, both real in the current registry:

  OVER-MERGE   distinct people fused into one id. Happens where a candidacy's `id` is a
               row index rather than a person, so the registry falls back to keying on
               the NAME -- and every "Michael Collins" in the archive becomes one man
               with a 106-year career.
  UNDER-MERGE  one person split across ids. Happens where the same person appears under
               two source systems, or two name spellings, without the evidence to join
               them safely.

Signals used, strongest first. Each is a reason to LOOK, not a correction to apply
blindly -- a long career can be genuine and two people really can share a name.

  span            career longer than anyone plausibly has
  era-gap         candidacies cluster in eras separated by a long silence
  jurisdiction    one id active in both NI and Irish bodies
  split           two ids sharing a match key with compatible, non-overlapping careers

Output: data/elections/persons/person_id_corrections.csv
"""
import os, sys, json, glob, collections, csv

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')
REG = os.path.join(REPO, 'data', 'elections', 'persons', 'person_registry.json')
OUT = os.path.join(REPO, 'data', 'elections', 'persons', 'person_id_corrections.csv')

MAX_CAREER = 45          # years; longer than this is implausible for one candidate
MAX_GAP = 25             # years of silence that suggests two different people
NI = {'house-of-commons-of-the-united-kingdom', 'northern-ireland-assembly',
      'local-government', 'european-parliament', 'parliament-of-northern-ireland',
      'northern-ireland-constitutional-convention',
      'northern-ireland-forum-for-political-dialogue'}
ROI = {'dail-eireann', 'ireland-european', 'ireland-president'}


def main():
    reg = json.load(open(REG, encoding='utf-8'))
    ents = {e['personId']: e for e in reg['entities']}

    obs = collections.defaultdict(list)
    for f in sorted(glob.glob(os.path.join(META, '*.json'))):
        d = json.load(open(f, encoding='utf-8'))
        body = d.get('bodySlug') or ''
        yr = str(d.get('date') or '')[:4]
        for r in d.get('results') or []:
            for c in (r.get('candidates') or []):
                pid = c.get('personId')
                if pid is None or not yr.isdigit():
                    continue
                obs[pid].append({'y': int(yr), 'body': body,
                                 'name': (c.get('name') or '').strip(),
                                 'party': (c.get('party') or '').strip(),
                                 'con': str(r.get('constituency') or '')})

    rows = []
    for pid, xs in obs.items():
        e = ents.get(pid)
        if not e:
            continue
        ys = sorted(x['y'] for x in xs)
        span = ys[-1] - ys[0]
        gaps = [(ys[i + 1] - ys[i], ys[i], ys[i + 1]) for i in range(len(ys) - 1)]
        big = max(gaps, key=lambda t: t[0]) if gaps else (0, 0, 0)
        bodies = {x['body'] for x in xs}
        ni, roi = bool(bodies & NI), bool(bodies & ROI)
        reasons, sev = [], 0
        if span > MAX_CAREER:
            reasons.append(f'span {span}y'); sev += 3 + span // 20
        if big[0] > MAX_GAP:
            reasons.append(f'gap {big[0]}y ({big[1]}->{big[2]})'); sev += 2
        if ni and roi:
            reasons.append('NI+RoI bodies'); sev += 2
        if not reasons:
            continue
        rows.append({'personId': pid, 'name': e['displayName'], 'kind': 'OVER-MERGE',
                     'keyedBy': e['keyedBy'], 'candidacies': len(xs),
                     'firstYear': ys[0], 'lastYear': ys[-1], 'span': span,
                     'largest_gap': big[0], 'bodies': len(bodies),
                     'parties': ' / '.join(sorted({x['party'] for x in xs})[:4]),
                     'severity': sev, 'reasons': '; '.join(reasons)})

    # UNDER-MERGE: ids sharing a match key whose careers do not overlap
    bykey = collections.defaultdict(list)
    for e in reg['entities']:
        for m in e['matchKeys']:
            bykey[m].append(e)
    for m, es in bykey.items():
        if len(es) < 2:
            continue
        es = sorted(es, key=lambda x: (x.get('firstYear') or 0))
        for i in range(len(es) - 1):
            a, b = es[i], es[i + 1]
            if not (a.get('lastYear') and b.get('firstYear')):
                continue
            gap = b['firstYear'] - a['lastYear']
            if 0 <= gap <= 10 and a['personId'] != b['personId']:
                rows.append({'personId': f"{a['personId']}+{b['personId']}",
                             'name': a['displayName'], 'kind': 'UNDER-MERGE',
                             'keyedBy': f"{a['keyedBy']}/{b['keyedBy']}",
                             'candidacies': a['candidacies'] + b['candidacies'],
                             'firstYear': a.get('firstYear'), 'lastYear': b.get('lastYear'),
                             'span': (b.get('lastYear') or 0) - (a.get('firstYear') or 0),
                             'largest_gap': gap, 'bodies': '',
                             'parties': ' / '.join(sorted(set((a.get('parties') or []) +
                                                             (b.get('parties') or [])))[:4]),
                             'severity': 4 if gap <= 5 else 2,
                             'reasons': f'same name, careers {a["firstYear"]}-{a["lastYear"]} '
                                        f'then {b["firstYear"]}-{b["lastYear"]}, gap {gap}y'})

    rows.sort(key=lambda r: (-r['severity'], -int(r['span'] or 0)))
    with open(OUT, 'w', encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)

    over = [r for r in rows if r['kind'] == 'OVER-MERGE']
    under = [r for r in rows if r['kind'] == 'UNDER-MERGE']
    print(f"{len(rows):,} ids flagged for correction  "
          f"(over-merge {len(over):,}, under-merge {len(under):,})")
    kb = collections.Counter(r['keyedBy'] for r in over)
    print(f"  over-merges by keying: {dict(kb)}")
    print(f"\n  worst OVER-MERGES (distinct people probably fused):")
    print(f"    {'id':>7} {'name':26} {'span':>5} {'cands':>5} {'key':>5}  reasons")
    for r in over[:14]:
        print(f"    {r['personId']:>7} {r['name'][:26]:26} {r['span']:5} {r['candidacies']:5} "
              f"{r['keyedBy']:>5}  {r['reasons']}")
    print(f"\n  strongest UNDER-MERGES (one person probably split):")
    for r in under[:10]:
        print(f"    {str(r['personId']):>15} {r['name'][:26]:26}  {r['reasons']}")
    print(f"\n  wrote {OUT}")


if __name__ == '__main__':
    main()
