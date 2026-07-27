#!/usr/bin/env python3
"""Build a NAME layer beside the person layer, and stamp name_id on every candidacy.

WHY. One layer was doing two jobs, and both branches of the resulting false choice are
visibly wrong in the person registry:

    merge on name    -> "Austin Stack", 1918-2024, six candidacies: several men fused
    refuse to merge  -> "Cahir Healy" as 15 separate persons: one man shattered

Neither is a judgement about identity; both are artefacts. A name is what was written on
a ballot. A person is who stood. They are many-to-many, and once that is said out loud
Austin Stack is simply ONE NAME ATTESTED FOR SEVERAL PERSONS, which needs no decision.

STRUCTURE
    names           one per distinct ballot string, with its tokens
    tokens          name fragments; 4,536 of them against 11,076 strings
    attestations    name_id <-> person_id, many-to-many, with evidence

NORMALISATION POLICY, and it is a real choice. "Sean T O'Kelly" and "Sean T. O'Kelly"
get TWO name ids and ONE person. The string is what appeared on a ballot; flattening
punctuation at the name layer would recreate the same conflation one level down, which
is the thing this layer exists to stop. `normalised` is carried for matching, not as
identity.

TOKENS ARE ASSOCIATIVE, NEVER IDENTIFYING. 'Ian' is linked to Ian Paisley and to 300
other people; it does not pick him out. Only the surname token approaches identifying
force, and only sometimes. The link type is recorded so nothing downstream mistakes one
for the other.

A candidacy may now carry a confident name_id with a NULL person_id. That is the honest
state for the 639 currently-ambiguous candidacies: we know exactly what was written, and
we do not know who it was.

Output: data/elections/persons/name_registry.json, alias_candidates.csv
"""
import os, re, sys, json, glob, csv, argparse, collections, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')
OUT = os.path.join(REPO, 'data', 'elections', 'persons')
REG = os.path.join(OUT, 'name_registry.json')
ALIAS = os.path.join(OUT, 'alias_candidates.csv')

PARTICLES = {'de', 'la', 'le', 'van', 'von', 'mac', 'mc', 'ni', 'ui', 'o', 'jr', 'snr',
             'sr', 'jnr'}


def norm(s):
    t = unicodedata.normalize('NFKD', str(s or '').strip())
    t = ''.join(c for c in t if not unicodedata.combining(c))
    t = t.lower().replace('’', "'").replace('‘', "'")
    return re.sub(r'\s+', ' ', re.sub(r"[^a-z0-9 ]+", ' ', t)).strip()


def slug(s):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', norm(s))).strip('-') or 'x'


def tokens(s):
    out = []
    for t in re.split(r"[^A-Za-zÀ-ſ']+", str(s or '')):
        if len(t) > 1:
            out.append(t)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()

    obs = collections.defaultdict(list)
    for f in sorted(glob.glob(os.path.join(META, '*.json'))):
        d = json.load(open(f, encoding='utf-8'))
        yr = str(d.get('date') or '')[:4]
        for r in d.get('results') or []:
            for c in (r.get('candidates') or []):
                nm = (c.get('name') or '').strip()
                if not nm:
                    continue
                obs[nm].append({'pid': c.get('personId'), 'body': d.get('bodySlug') or '',
                                'y': int(yr) if yr.isdigit() else 0,
                                'party': (c.get('party') or '').strip(),
                                'con': str(r.get('constituency') or '').strip()})

    # --- name entities. Punctuation variants stay DISTINCT names, hence the suffix.
    used, names = set(), {}
    for nm in sorted(obs):
        base = 'n-' + slug(nm)
        nid, k = base, 2
        while nid in used:
            nid, k = f'{base}-{k}', k + 1
        used.add(nid)
        xs = obs[nm]
        pids = sorted({x['pid'] for x in xs if x['pid'] is not None})
        ys = [x['y'] for x in xs if x['y']]
        names[nm] = {
            'id': nid, 'string': nm, 'normalised': norm(nm), 'tokens': tokens(nm),
            'candidacies': len(xs), 'persons': pids,
            'firstYear': min(ys) if ys else None, 'lastYear': max(ys) if ys else None,
            'bodies': sorted({x['body'] for x in xs if x['body']}),
            'parties': sorted({x['party'] for x in xs if x['party']})[:6],
        }
        if len(pids) > 1:
            names[nm]['sharedByPersons'] = len(pids)
        if not pids:
            names[nm]['personUnknown'] = True

    # --- token entities. Associative only; never identifying.
    tk = collections.defaultdict(lambda: {'names': 0, 'candidacies': 0, 'persons': set()})
    for nm, e in names.items():
        for t in set(e['tokens']):
            tk[t]['names'] += 1
            tk[t]['candidacies'] += e['candidacies']
            tk[t]['persons'].update(e['persons'])
    toks = []
    for t, v in sorted(tk.items(), key=lambda kv: -kv[1]['candidacies']):
        toks.append({'id': 't-' + slug(t), 'token': t, 'names': v['names'],
                     'candidacies': v['candidacies'], 'persons': len(v['persons']),
                     'kind': 'particle' if t.lower() in PARTICLES else 'word',
                     'identifying': False})

    # --- attestations
    att = []
    for nm, e in names.items():
        by = collections.defaultdict(list)
        for x in obs[nm]:
            if x['pid'] is not None:
                by[x['pid']].append(x)
        for pid, xs in by.items():
            ys = [x['y'] for x in xs if x['y']]
            att.append({'nameId': e['id'], 'personId': pid, 'candidacies': len(xs),
                        'firstYear': min(ys) if ys else None,
                        'lastYear': max(ys) if ys else None,
                        'bodies': sorted({x['body'] for x in xs if x['body']})})

    # --- alias candidates. A CONTEXTUAL detector was tried first -- same forename,
    # party and constituency, consecutive non-overlapping careers -- and it was mostly
    # wrong: it chained "Robert Nixon -> Robert Babington -> Robert Campbell ->
    # Robert McCartney", four different UUP members of North Down who share a forename.
    # 562 candidates, a handful correct. Sharing a forename is simply common.
    #
    # What IS reliably detectable is a FORMATTING alias: two near-identical strings that
    # were split into different persons, e.g. "(Sir) Norman Stronge" / "Sir Norman
    # Stronge". That is high precision because the evidence is in the strings themselves.
    #
    # A true name CHANGE -- Deborah Armstrong becoming Deborah Erskine -- shares nothing
    # between the two strings and is NOT derivable from this data at any threshold. It
    # needs an external source. Recorded here rather than approximated.
    def _sim(a, b):
        ta, tb = set(norm(a).split()), set(norm(b).split())
        if not ta or not tb:
            return 0.0
        return len(ta & tb) / len(ta | tb)

    cand = []
    bykey = collections.defaultdict(list)
    for nm, e in names.items():
        if e['persons']:
            bykey[tuple(sorted(set(norm(nm).split())))[-1:]].append(nm)
    for _, group in bykey.items():
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                a, b = group[i], group[j]
                pa, pb = set(names[a]['persons']), set(names[b]['persons'])
                if pa & pb or norm(a) == norm(b):
                    continue
                sim = _sim(a, b)
                if sim < 0.6:
                    continue
                cand.append({'nameA': a, 'personA': sorted(pa)[0] if pa else '',
                             'yearsA': f"{names[a]['firstYear']}-{names[a]['lastYear']}",
                             'nameB': b, 'personB': sorted(pb)[0] if pb else '',
                             'yearsB': f"{names[b]['firstYear']}-{names[b]['lastYear']}",
                             'tokenOverlap': round(sim, 2),
                             'signal': 'near-identical strings split across persons '
                                       '(formatting alias, not a name change)'})
    cand.sort(key=lambda c: -c['tokenOverlap'])

    doc = {'schemaVersion': 1,
           'description': 'Names as first-class entities beside persons. A name is what '
                          'was written on a ballot; a person is who stood. Many-to-many.',
           'policy': {
               'punctuationVariants': 'Distinct names, same person. "Sean T O\'Kelly" and '
                                      '"Sean T. O\'Kelly" are two name ids.',
               'tokens': 'Associative only. "Ian" links to Ian Paisley and hundreds of '
                         'others; it does not identify him. identifying is always false.',
               'nullPerson': 'A candidacy may carry a confident nameId with a null '
                             'personId. That is the honest state, not a gap.'},
           'counts': {'names': len(names), 'tokens': len(toks),
                      'attestations': len(att),
                      'namesSharedBySeveralPersons': sum(1 for e in names.values()
                                                         if e.get('sharedByPersons')),
                      'namesWithNoKnownPerson': sum(1 for e in names.values()
                                                    if e.get('personUnknown'))},
           'names': sorted(names.values(), key=lambda e: e['id']),
           'tokens': toks,
           'attestations': sorted(att, key=lambda a: (a['nameId'], a['personId']))}

    print(f"names {len(names):,}   tokens {len(toks):,}   attestations {len(att):,}")
    print(f"  names shared by >1 person : {doc['counts']['namesSharedBySeveralPersons']:,}")
    print(f"  names with no known person: {doc['counts']['namesWithNoKnownPerson']:,}")
    print(f"  alias candidates (not applied): {len(cand):,}")
    for c in cand[:8]:
        print(f"     {c['tokenOverlap']:.2f}  {c['nameA'][:26]:26} {c['yearsA']:10} <-> "
              f"{c['nameB'][:26]:26} {c['yearsB']}")
    if args.check:
        print('\n--check: nothing written')
        return

    os.makedirs(OUT, exist_ok=True)
    json.dump(doc, open(REG, 'w', encoding='utf-8', newline='\n'),
              ensure_ascii=False, indent=1)
    if cand:
        with open(ALIAS, 'w', encoding='utf-8', newline='') as fh:
            w = csv.DictWriter(fh, fieldnames=list(cand[0].keys()))
            w.writeheader(); w.writerows(cand)

    # --- stamp name_id on every candidacy
    nid = {nm: e['id'] for nm, e in names.items()}
    changed = stamped = 0
    for f in sorted(glob.glob(os.path.join(META, '*.json'))):
        d = json.load(open(f, encoding='utf-8'))
        dirty = False
        for r in d.get('results') or []:
            for c in (r.get('candidates') or []):
                nm = (c.get('name') or '').strip()
                v = nid.get(nm)
                if nm and c.get('name_id') != v:
                    c['name_id'] = v
                    dirty = True
                if nm:
                    stamped += 1
        for c in (d.get('mainLikeCandidateSummary') or []):
            nm = (c.get('name') or '').strip()
            v = nid.get(nm)
            if nm and c.get('name_id') != v:
                c['name_id'] = v
                dirty = True
        if dirty:
            changed += 1
            with open(f, 'w', encoding='utf-8', newline='\n') as fh:
                json.dump(d, fh, ensure_ascii=False, indent=2)
                fh.write('\n')
    print(f"\n  stamped name_id on {stamped:,} candidacies across {changed} files")
    print(f"  wrote {REG}")
    if cand:
        print(f"  wrote {ALIAS}")


if __name__ == '__main__':
    main()
