#!/usr/bin/env python3
"""Write `personId` onto every candidacy from data/elections/persons/person_registry.json.

This is the fix, not the registry itself. The browse builder already reads
`candidate.personId` and only falls back to `name:<slugified name>` when it is absent --
which it always was. Populating it means a name correction changes a person's label
instead of silently creating a new person and orphaning the old.

RESOLUTION ORDER, strongest evidence first:
  1. `sourcePersonId` -- the person as the SOURCE names them, harvested back off the
     ElectionsIreland result pages by scripts/harvest_ei_candidate_ids.py. This is the
     only rung of the ladder that is evidence rather than inference, and the only one
     that can tell two people who share a name apart.
  2. the candidacy's own `id`, where that id is a real person id and not a row index
  3. the normalised name, but only where it identifies exactly ONE registry entity
  4. a name shared by several entities, resolved to the ONE of them that carries no
     source person id -- and only for a candidacy that has none itself. This mirrors
     how the registry grouped the row rather than guessing: a row with neither a source
     id nor a usable candidacy id was grouped by its name, into the entity keyed by that
     name. Left unstamped, such a candidacy (Austin Stack, Laois 2024, detached from the
     1920s TD's id on the source's own dates) reached browse keyed by bare name and took
     the bare-name URL, so an old /austin-stack link opened the wrong man.

A name shared by two entities is left unresolved rather than guessed. That is the same
conservatism the registry is built on: an unresolved candidacy is visible, a wrongly
attributed one is not.
"""
import os, re, sys, json, glob, argparse, collections, unicodedata

from generated_json import dump_generated_json

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))
# The election metadata the rest of the build actually reads. This pointed at
# `test/metadata/elections-test2` for a long time, a directory that does not exist:
# the glob matched nothing, no candidacy was ever stamped, and the only symptom was a
# ZeroDivisionError on the summary line below, which says nothing about paths. So it is
# an argument with a default now, and an empty match is a hard error rather than a
# silent no-op. build-elections-sqlite.mjs reads the same directory.
DEFAULT_META = os.path.join(REPO, 'render', 'metadata', 'elections-test2')
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
    ap.add_argument('--meta', default=DEFAULT_META,
                    help='directory of election metadata JSON (default: render/metadata/elections-test2)')
    args = ap.parse_args()
    meta = args.meta

    files = sorted(glob.glob(os.path.join(meta, '*.json')))
    if not files:
        sys.exit(f'FAIL: no election JSON found in {meta}\n'
                 '  Nothing would be stamped. Check the path rather than the data:\n'
                 '  the live metadata lives in render/metadata/elections-test2.')

    doc = json.load(open(REG, encoding='utf-8'))
    # An id can belong to more than one entity when the registry split an implausible
    # career at a long silence; each half records its `era`, and a contest's year picks it.
    by_person, by_srcid, name_hits = collections.defaultdict(list), collections.defaultdict(list), collections.defaultdict(set)
    for e in doc['entities']:
        era = e.get('era') or [0, 9999]
        for s in e.get('sourcePersonIds') or []:
            by_person[s].append((era[0], era[1], e['personId']))
        for s in e['sourceIds']:
            by_srcid[s].append((era[0], era[1], e['personId']))
        for m in e['matchKeys']:
            name_hits[m].add(e['personId'])

    def pick(options, year):
        if not options:
            return None
        if len(options) == 1:
            return options[0][2]
        for lo, hi, pid in options:
            if lo <= year <= hi:
                return pid
        return min(options, key=lambda o: min(abs(year - o[0]), abs(year - o[1])))[2]

    by_name = {m: list(v)[0] for m, v in name_hits.items() if len(v) == 1}
    ambiguous = {m for m, v in name_hits.items() if len(v) > 1}
    without_source = collections.defaultdict(set)
    for e in doc['entities']:
        # Name-keyed entities only. A candidacy reaches this rung only when it has no usable
        # candidacy id, and the registry puts exactly those rows in the group keyed by the
        # name; an id-keyed entity of the same name (a 1992 Westminster Daniel O'Leary beside
        # a 1973 Dail one) is a different group and must not make the name look ambiguous.
        if e.get('keyedBy') == 'name' and not (e.get('sourcePersonIds') or []):
            for m in e['matchKeys']:
                without_source[m].add(e['personId'])
    by_name_group = {m: next(iter(v)) for m, v in without_source.items() if len(v) == 1 and m in ambiguous}
    span = {e['personId']: (e.get('firstYear') or 0, e.get('lastYear') or 9999) for e in doc['entities']}

    def modern_for(mk):
        return [p for p in name_hits.get(mk, ()) if span.get(p, (0, 9999))[1] >= 1918]

    stats = collections.Counter()
    changed = 0
    for path in files:
        doc2 = json.load(open(path, encoding='utf-8'))
        dirty = False
        date = str(doc2.get('date') or '')
        year = int(date[:4]) if date[:4].isdigit() else 0

        def stamp(c):
            nonlocal dirty
            spid = str(c.get('sourcePersonId') or '').strip()
            pid = pick(by_person.get(spid, []), year) if spid else None
            how = 'by-source-person' if pid else None
            if not pid:
                cid = str(c.get('id') or '').strip()
                pid = pick(by_srcid.get(cid, []), year)
                how = 'by-id' if pid else None
            if not pid:
                mk = matchkey(c.get('name') or '')
                if mk in by_name:
                    pid, how = by_name[mk], 'by-name'
                elif mk in by_name_group and not spid:
                    pid, how = by_name_group[mk], 'by-name-group'
                elif mk in ambiguous and year >= 1918 and len(modern_for(mk)) == 1:
                    # The 1832-1918 Westminster results added namesakes -- a James Cosgrave
                    # of 1914, a William Browne of 1841 -- to names that were unique among the
                    # post-1918 records, and made them ambiguous. A post-1918 contest takes
                    # the one post-1918 person of that name, exactly as it did before; a name
                    # shared among post-1918 people stays unresolved, as it always has.
                    pid, how = modern_for(mk)[0], 'by-name-modern'
                elif mk in ambiguous:
                    how = 'ambiguous-name'
                else:
                    how = 'unresolved'
            stats[how] += 1
            if c.get('personId') != pid:
                c['personId'] = pid
                dirty = True

        # Referendum options are not people: strip any personId rather than stamp one.
        referendum = str(doc2.get('contestType') or '') == 'referendum'
        for r in doc2.get('results') or []:
            for c in (r.get('candidates') or []):
                if referendum:
                    if c.pop('personId', None) is not None:
                        dirty = True
                elif (c.get('name') or '').strip():
                    stamp(c)
        # A summary row restates a candidacy stamped just above, so it takes that stamp.
        # Re-derived from the summary row's own fields, 25 rows carried an id their own
        # candidacy did not.
        stamped = collections.defaultdict(set)
        for r in doc2.get('results') or []:
            for c in (r.get('candidates') or []):
                stamped[(str(r.get('constituency') or '').strip(), (c.get('name') or '').strip())].add(c.get('personId'))
        for c in (doc2.get('mainLikeCandidateSummary') or []):
            if referendum:
                if c.pop('personId', None) is not None:
                    dirty = True
                continue
            if (c.get('name') or '').strip():
                cid = str(c.get('id') or '').strip()
                spid = str(c.get('sourcePersonId') or '').strip()
                mk = matchkey(c.get('name') or '')
                own = stamped.get((str(c.get('constituency') or '').strip(), (c.get('name') or '').strip()), set())
                pid = (next(iter(own)) if len(own) == 1 and None not in own else None) or (
                       (pick(by_person.get(spid, []), year) if spid else None) or pick(by_srcid.get(cid, []), year) or by_name.get(mk)
                       or (by_name_group.get(mk) if not spid else None))
                if c.get('personId') != pid:
                    c['personId'] = pid
                    dirty = True
        if dirty:
            changed += 1
            if not args.check:
                dump_generated_json(path, doc2)

    tot = sum(stats.values())
    print(f'{tot:,} named candidacies')
    for k in ('by-source-person', 'by-id', 'by-name', 'by-name-group', 'ambiguous-name', 'unresolved'):
        print(f'   {stats[k]:7,}  {k}')
    res = stats['by-source-person'] + stats['by-id'] + stats['by-name'] + stats['by-name-group']
    print(f'   resolved {res:,}/{tot:,} ({100*res/tot:.1f}%)')
    print(f'   ambiguous names (shared by >1 entity): {len(ambiguous):,}')
    print(f"\nfiles {'that would change' if args.check else 'written'}: {changed}")


if __name__ == '__main__':
    main()
