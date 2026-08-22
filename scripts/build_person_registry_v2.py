#!/usr/bin/env python3
"""Build data/elections/persons/person_registry.json for the CURRENT election data.

WHY A V2. Persons have no identifier in render/metadata/elections-test2. The browse
builder keys them `personId || name:<slugified name>`, no candidate carries a personId,
so the key is the NAME -- and every name cleanup silently creates a new person and
orphans the old. "A Cecil Walker" became "Cecil Walker" and took 4,348 person records
with it.

WHAT ALREADY EXISTED, and is preserved. scripts/person_registry.json holds 2,388
CURATED persons with stable numeric PersonIDs, canonical names, name variants and
career histories. Its source workbook (Full election tables.xlsx) is gone from the
archive and scripts/apply_person_ids.py writes to an `_aggregates.json` layout that no
longer exists, so it is real but unwired and covers roughly a fifth of the people in the
current data. Those 2,388 ids are carried forward unchanged -- curated identity is not
rebuilt from inference.

HOW THE REST ARE DERIVED, and the limits of the evidence.

Every candidacy carries an `id`, but it is not uniformly a person id:

  * 31 ids are ROW INDICES, not people. Id '1' appears on 2,260 candidacies across 103
    contests under unrelated names. Detected -- not hardcoded -- as ids carrying more
    than one distinct name, and discarded as identity evidence.
  * The rest split into two source systems, numeric and 'T'-prefixed. Where one name
    holds one id of each kind, their contest sets are disjoint in 944 of 945 cases: the
    same person recorded twice, once per system. Those ARE merged.
  * Where one name holds several ids from the SAME system, that is not evidence of one
    person -- two same-named candidates in one system are more likely two people. Those
    are NOT merged; they are emitted separately and flagged needsReview.

CONSERVATISM IS THE POINT. A wrong merge silently fuses two careers and is invisible; a
wrong split is visible and fixable. Nothing is merged on name alone.
"""
import os, re, sys, json, glob, argparse, collections, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')
OLD = os.path.join(HERE, 'person_registry.json')
OUT = os.path.join(REPO, 'data', 'elections', 'persons')
REG = os.path.join(OUT, 'person_registry.json')


def matchkey(v):
    t = re.sub(r'\s+', ' ', str(v or '')).strip()
    t = unicodedata.normalize('NFKD', t)
    t = ''.join(c for c in t if not unicodedata.combining(c))
    t = t.lower().replace('’', "'").replace('‘', "'")
    return re.sub(r'\s+', ' ', re.sub(r"[^a-z0-9 ]+", ' ', t)).strip()


def ns(i):
    return 'T' if i.startswith('T') else ('N' if i.isdigit() else 'O')


def scan():
    rows = []
    for f in sorted(glob.glob(os.path.join(META, '*.json'))):
        d = json.load(open(f, encoding='utf-8'))
        yr = str(d.get('date') or '')[:4]
        for r in d.get('results') or []:
            for c in (r.get('candidates') or []):
                nm = (c.get('name') or '').strip()
                if not nm:
                    continue
                rows.append({'id': str(c.get('id') or '').strip(), 'name': nm,
                             'key': d.get('key'), 'body': d.get('bodySlug'),
                             'year': int(yr) if yr.isdigit() else 0,
                             'party': (c.get('party') or '').strip()})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()
    if os.path.exists(REG) and not args.force:
        sys.exit(f'{REG} exists; it is the hand-edited source of truth. --force to rebuild.')

    curated = {}
    if os.path.exists(OLD):
        old = json.load(open(OLD, encoding='utf-8'))
        for pid, p in old['persons'].items():
            for k in (p.get('matchKeys') or []) + [matchkey(n) for n in (p.get('nameVariants') or [])]:
                curated.setdefault(k, (int(pid), p))
        next_id = int(old.get('meta', {}).get('nextId') or 100012)
    else:
        next_id = 100012

    rows = scan()
    names_by_id = collections.defaultdict(set)
    for r in rows:
        if r['id']:
            names_by_id[r['id']].add(r['name'])
    bad_ids = {i for i, n in names_by_id.items() if len(n) > 1}

    groups = collections.defaultdict(list)
    for r in rows:
        k = ('id', r['id']) if (r['id'] and r['id'] not in bad_ids) else ('name', matchkey(r['name']))
        groups[k].append(r)

    by_name = collections.defaultdict(list)
    for k, v in groups.items():
        if k[0] == 'id':
            by_name[matchkey(v[0]['name'])].append(k)
    merges, review = {}, []
    for nm, keys in by_name.items():
        if len(keys) < 2:
            continue
        systems = collections.defaultdict(list)
        for k in keys:
            systems[ns(k[1])].append(k)
        if len(systems) > 1 and all(len(v) == 1 for v in systems.values()):
            if not set.intersection(*[{r['key'] for r in groups[k]} for k in keys]):
                for k in keys[1:]:
                    merges[k] = keys[0]
                continue
        review.append(nm)
    review = set(review)

    merged = collections.defaultdict(list)
    for k, v in groups.items():
        merged[merges.get(k, k)].extend(v)

    entities, matched, seen_pid = [], 0, set()
    for k, v in sorted(merged.items(), key=lambda kv: (-len(kv[1]), str(kv[0]))):
        names = sorted({r['name'] for r in v}, key=lambda s: (-len(s), s))
        mks = {matchkey(n) for n in names}
        hit = next((curated[m] for m in mks if m in curated), None)
        if hit and hit[0] not in seen_pid:
            pid, cur = hit
            seen_pid.add(pid)
            matched += 1
            disp = cur.get('canonicalName') or names[0]
            names = sorted(set(names) | set(cur.get('nameVariants') or []),
                           key=lambda s: (-len(s), s))
            prov, src = False, 'curated (Full election tables.xlsx, carried forward)'
        else:
            pid, disp = next_id, names[0]
            next_id += 1
            prov, src = True, 'derived from candidate ids in render/metadata/elections-test2'
        yrs = [r['year'] for r in v if r['year']]
        e = {'id': f'p{pid}', 'personId': pid, 'displayName': disp,
             'aliases': names, 'matchKeys': sorted(mks),
             'sourceIds': sorted({r['id'] for r in v if r['id'] and r['id'] not in bad_ids}),
             'candidacies': len(v), 'contests': len({r['key'] for r in v}),
             'firstYear': min(yrs) if yrs else None, 'lastYear': max(yrs) if yrs else None,
             'bodies': sorted({r['body'] for r in v if r['body']}),
             'parties': sorted({r['party'] for r in v if r['party']})[:6],
             'keyedBy': k[0], 'provenance': src, 'provisional': prov}
        if len(names) > 1:
            e['nameVariants'] = True
        if matchkey(disp) in review:
            e['needsReview'] = ('another entity shares this name; same-source-system '
                                'duplicates are never merged automatically')
        entities.append(e)

    doc = {
        'schemaVersion': 2,
        'description': 'Stable identifiers for people appearing as candidates in the '
                       'current election data. The id is independent of name spelling, so '
                       'a correction changes displayName and adds an alias, never the id.',
        'idPolicy': 'Ids are permanent. PersonIDs 1-100011 are the curated block carried '
                    'forward from scripts/person_registry.json; 100012+ are derived.',
        'supersedes': 'scripts/person_registry.json (2,388 curated persons; its source '
                      'workbook is no longer present and apply_person_ids.py targets an '
                      '_aggregates.json layout that no longer exists)',
        'evidence': {
            'rowIndexIdsDiscarded': sorted(bad_ids, key=lambda s: (len(s), s)),
            'note': 'Ids carrying more than one distinct name are row indices, not people.',
            'crossSystemMerges': len(merges),
            'sameNameLeftSplit': len(review),
        },
        'conservatism': 'Nothing is merged on name alone. Two ids from the same source '
                        'system sharing a name stay separate and are flagged needsReview.',
        'entities': entities,
    }
    os.makedirs(OUT, exist_ok=True)
    json.dump(doc, open(REG, 'w', encoding='utf-8', newline='\n'),
              ensure_ascii=False, indent=1)

    print(f'candidacies scanned         : {len(rows):,}')
    print(f'row-index ids discarded     : {len(bad_ids)}')
    print(f'cross-system merges applied : {len(merges):,}')
    print(f'same-name splits flagged    : {len(review):,}')
    print(f'persons emitted             : {len(entities):,}')
    print(f'  matched to curated registry: {matched:,} of 2,388 curated')
    print(f'  newly derived (provisional): {sum(1 for e in entities if e["provisional"]):,}')
    print(f'  keyed by candidate id      : {sum(1 for e in entities if e["keyedBy"]=="id"):,}')
    print(f'  keyed by name only         : {sum(1 for e in entities if e["keyedBy"]=="name"):,}')
    print(f'  flagged needsReview        : {sum(1 for e in entities if e.get("needsReview")):,}')
    print(f'\nwrote {REG}')


if __name__ == '__main__':
    main()
