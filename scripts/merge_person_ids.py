#!/usr/bin/env python3
"""Merge the two SAFE classes of split person ids found by audit_person_ids.py.

Only two classes are touched, both because they have a known mechanical cause rather
than needing a judgement about who someone is.

  FORUM-DUPLICATE   The 1996 Forum file carries a synthetic NI-wide top-up row that
                    repeats the same ballots as the 18 constituency rows, so a candidate
                    appears twice in ONE contest under two ids. Already documented in
                    phase 58 as a valid-poll double count; it splits identity too.

  LGR-2014          The 2014 local government reorganisation. That contest arrived from
                    a different source system with its own id namespace, cutting every
                    continuing councillor's career in two at 2011/2014.

The audit's test (same match key, careers within 10 years) is deliberately NOT reused --
it is a screen, not a proof. Each class is re-tested here on its own mechanism:

  Forum: both ids must appear in the SAME contest, and one of them in the synthetic
         NI-wide row. Two people of the same name in one contest is possible; the same
         person in a constituency row AND the all-NI row is what the file actually does.
  LGR:   both ids must be local-government, one ending by 2011 and the other starting
         from 2014, AND standing for the same party. A party match is not proof, but a
         continuing councillor who also changed party is rare enough to leave alone.

Merges keep the LOWER personId, preferring the curated 1-100011 block, and carry the
other id's aliases, match keys and source ids across. Every merge is recorded.

Usage:  python scripts/merge_person_ids.py [--check]
"""
import os, sys, json, glob, csv, argparse, collections

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')
PERS = os.path.join(REPO, 'data', 'elections', 'persons')
REG = os.path.join(PERS, 'person_registry.json')
LOG = os.path.join(PERS, 'person_id_merges.csv')
FORUM = 'northern-ireland-forum-for-political-dialogue__1996-05-30'


def observations():
    obs = collections.defaultdict(list)
    for f in sorted(glob.glob(os.path.join(META, '*.json'))):
        d = json.load(open(f, encoding='utf-8'))
        key, body = d.get('key'), d.get('bodySlug') or ''
        yr = str(d.get('date') or '')[:4]
        for r in d.get('results') or []:
            con = str(r.get('constituency') or '').strip()
            for c in (r.get('candidates') or []):
                pid = c.get('personId')
                if pid is None:
                    continue
                obs[pid].append({'key': key, 'body': body, 'con': con,
                                 'y': int(yr) if yr.isdigit() else 0,
                                 'party': (c.get('party') or '').strip()})
    return obs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()

    reg = json.load(open(REG, encoding='utf-8'))
    ents = {e['personId']: e for e in reg['entities']}
    obs = observations()

    bykey = collections.defaultdict(list)
    for e in reg['entities']:
        for m in e['matchKeys']:
            bykey[m].append(e['personId'])

    merges, skipped = [], collections.Counter()
    seen = set()
    for m, pids in bykey.items():
        pids = sorted(set(pids))
        if len(pids) < 2:
            continue
        for i in range(len(pids)):
            for j in range(i + 1, len(pids)):
                a, b = pids[i], pids[j]
                if (a, b) in seen:
                    continue
                oa, ob = obs.get(a, []), obs.get(b, [])
                if not oa or not ob:
                    continue
                cls = None
                # --- Forum duplicate: same contest, one on the synthetic NI-wide row
                fa = [x for x in oa if x['key'] == FORUM]
                fb = [x for x in ob if x['key'] == FORUM]
                if fa and fb:
                    cons = {x['con'].upper() for x in fa + fb}
                    if 'NORTHERN IRELAND' in cons and len(cons) > 1:
                        cls = 'FORUM-DUPLICATE'
                # --- 2014 local government reorganisation
                if cls is None:
                    la = [x for x in oa if x['body'] == 'local-government']
                    lb = [x for x in ob if x['body'] == 'local-government']
                    if la and lb:
                        ea, sb = max(x['y'] for x in la), min(x['y'] for x in lb)
                        eb, sa = max(x['y'] for x in lb), min(x['y'] for x in la)
                        pa = {x['party'] for x in la}
                        pb = {x['party'] for x in lb}
                        if (ea <= 2011 and sb >= 2014) or (eb <= 2011 and sa >= 2014):
                            if pa & pb:
                                cls = 'LGR-2014'
                            else:
                                skipped['LGR-2014 party mismatch'] += 1
                if cls is None:
                    continue
                keep, drop = (a, b) if a < b else (b, a)
                merges.append({'class': cls, 'keep': keep, 'drop': drop,
                               'name': ents[keep]['displayName'],
                               'keep_years': f"{ents[keep].get('firstYear')}-{ents[keep].get('lastYear')}",
                               'drop_years': f"{ents[drop].get('firstYear')}-{ents[drop].get('lastYear')}"})
                seen.add((a, b))

    # resolve chains so a->b->c collapses to one survivor
    parent = {}
    def find(x):
        while parent.get(x, x) != x:
            x = parent[x]
        return x
    for mg in merges:
        ka, kb = find(mg['keep']), find(mg['drop'])
        if ka != kb:
            lo, hi = min(ka, kb), max(ka, kb)
            parent[hi] = lo
    final = {d: find(d) for d in parent}

    print(f"merge pairs found: {len(merges):,}")
    for c, n in collections.Counter(m['class'] for m in merges).most_common():
        print(f"    {n:5}  {c}")
    for k, n in skipped.items():
        print(f"    {n:5}  SKIPPED: {k}")
    print(f"  distinct ids to retire: {len(final):,}")
    if args.check:
        print("\n--check: nothing written")
        return

    for drop, keep in final.items():
        if drop == keep:
            continue
        de, ke = ents.get(drop), ents.get(keep)
        if not de or not ke:
            continue
        ke['aliases'] = sorted(set(ke['aliases']) | set(de['aliases']), key=lambda s: (-len(s), s))
        ke['matchKeys'] = sorted(set(ke['matchKeys']) | set(de['matchKeys']))
        ke['sourceIds'] = sorted(set(ke['sourceIds']) | set(de['sourceIds']))
        ke['candidacies'] = ke['candidacies'] + de['candidacies']
        for f, fn in (('firstYear', min), ('lastYear', max)):
            vs = [x for x in (ke.get(f), de.get(f)) if x]
            if vs:
                ke[f] = fn(vs)
        ke['mergedFrom'] = sorted(set(ke.get('mergedFrom', []) + [drop]))
        ents.pop(drop, None)
    reg['entities'] = sorted(ents.values(), key=lambda e: e['personId'])
    reg.setdefault('corrections', {})['mergedIds'] = len(final)
    reg['corrections']['classes'] = dict(collections.Counter(m['class'] for m in merges))
    reg['corrections']['note'] = ('Only the two mechanically-caused classes were merged; '
                                  'see scripts/merge_person_ids.py for the tests applied.')
    json.dump(reg, open(REG, 'w', encoding='utf-8', newline='\n'), ensure_ascii=False, indent=1)
    with open(LOG, 'w', encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=list(merges[0].keys()))
        w.writeheader(); w.writerows(merges)
    print(f"\n  entities {len(reg['entities']):,} (was {len(reg['entities']) + len(final):,})")
    print(f"  wrote {REG}\n  wrote {LOG}")
    print("  NEXT: python scripts/apply_person_ids_v2.py && node scripts/build-browse-indexes.mjs")


if __name__ == '__main__':
    main()
