#!/usr/bin/env python3
"""Write `personId` onto every candidacy from data/elections/persons/person_registry.json.

This is the fix, not the registry itself. The browse builder already reads
`candidate.personId` and only falls back to `name:<slugified name>` when it is absent --
which it always was. Populating it means a name correction changes a person's label
instead of silently creating a new person and orphaning the old.

RESOLUTION ORDER, strongest evidence first:
  1. the candidacy's own `id`, where that id is a real person id and not a row index
  2. the normalised name, but only where it identifies exactly ONE registry entity

A name shared by two entities is left unresolved rather than guessed. That is the same
conservatism the registry is built on: an unresolved candidacy is visible, a wrongly
attributed one is not.
"""
import os, re, sys, json, glob, argparse, collections, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')
REG = os.path.join(REPO, 'data', 'elections', 'persons', 'person_registry.json')


def matchkey(v):
    t = re.sub(r'\s+', ' ', str(v or '')).strip()
    t = unicodedata.normalize('NFKD', t)
    t = ''.join(c for c in t if not unicodedata.combining(c))
    t = t.lower().replace('’', "'").replace('‘', "'")
    return re.sub(r'\s+', ' ', re.sub(r"[^a-z0-9 ]+", ' ', t)).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()

    doc = json.load(open(REG, encoding='utf-8'))
    by_srcid, name_hits = {}, collections.defaultdict(set)
    for e in doc['entities']:
        for s in e['sourceIds']:
            by_srcid[s] = e['personId']
        for m in e['matchKeys']:
            name_hits[m].add(e['personId'])
    by_name = {m: list(v)[0] for m, v in name_hits.items() if len(v) == 1}
    ambiguous = {m for m, v in name_hits.items() if len(v) > 1}

    stats = collections.Counter()
    changed = 0
    for path in sorted(glob.glob(os.path.join(META, '*.json'))):
        doc2 = json.load(open(path, encoding='utf-8'))
        dirty = False

        def stamp(c):
            nonlocal dirty
            cid = str(c.get('id') or '').strip()
            pid = by_srcid.get(cid)
            how = 'by-id' if pid else None
            if not pid:
                mk = matchkey(c.get('name') or '')
                if mk in by_name:
                    pid, how = by_name[mk], 'by-name'
                elif mk in ambiguous:
                    how = 'ambiguous-name'
                else:
                    how = 'unresolved'
            stats[how] += 1
            if c.get('personId') != pid:
                c['personId'] = pid
                dirty = True

        for r in doc2.get('results') or []:
            for c in (r.get('candidates') or []):
                if (c.get('name') or '').strip():
                    stamp(c)
        for c in (doc2.get('mainLikeCandidateSummary') or []):
            if (c.get('name') or '').strip():
                cid = str(c.get('id') or '').strip()
                pid = by_srcid.get(cid) or by_name.get(matchkey(c.get('name') or ''))
                if c.get('personId') != pid:
                    c['personId'] = pid
                    dirty = True
        if dirty:
            changed += 1
            if not args.check:
                with open(path, 'w', encoding='utf-8', newline='\n') as fh:
                    json.dump(doc2, fh, ensure_ascii=False, indent=2)
                    fh.write('\n')

    tot = sum(stats.values())
    print(f'{tot:,} named candidacies')
    for k in ('by-id', 'by-name', 'ambiguous-name', 'unresolved'):
        print(f'   {stats[k]:7,}  {k}')
    res = stats['by-id'] + stats['by-name']
    print(f'   resolved {res:,}/{tot:,} ({100*res/tot:.1f}%)')
    print(f'   ambiguous names (shared by >1 entity): {len(ambiguous):,}')
    print(f"\nfiles {'that would change' if args.check else 'written'}: {changed}")


if __name__ == '__main__':
    main()
