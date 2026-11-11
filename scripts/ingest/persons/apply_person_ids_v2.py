#!/usr/bin/env python3
"""Write `personId` onto every candidacy from data/elections/persons/person_registry.json.

This is the fix, not the registry itself. The browse builder already reads
`candidate.personId` and only falls back to `name:<slugified name>` when it is absent --
which it always was. Populating it means a name correction changes a person's label
instead of silently creating a new person and orphaning the old.

RESOLUTION ORDER, strongest evidence first:
  1. `sourcePersonId` -- the person as the SOURCE names them, harvested back off the
     ElectionsIreland result pages by scripts/ingest/electionsireland/harvest_ei_candidate_ids.py. This is the
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

A LIFE IS A LIMIT ON EVERY RUNG. Each rung's choice is checked against the life the person's
page shows (person_lifespans.py: History of Parliament, Wikidata, a reference work, at their
own precision, the rule check:person-lifespans applies). Where a rung offers several entities
(an id split into eras, a source id shared by two people), those alive and 18 or over at the
contest are preferred. A choice resting on weak evidence -- a name, or a name-and-party
candidacy id ("William Stewart|") -- that falls outside the life is not made: the row is left
unstamped (`outside-life`), as an unmatched name is. A choice resting on the row's own evidence
(an official id, a source person id, a source system's candidacy id) is kept and listed in
tmp/person-lifespan-apply.csv for review, never dropped silently.

A name shared by two entities is left unresolved rather than guessed. That is the same
conservatism the registry is built on: an unresolved candidacy is visible, a wrongly
attributed one is not.
"""
import os, re, sys, json, glob, argparse, collections, unicodedata

from generated_json import dump_generated_json
import person_lifespans
from build_person_registry_v2 import council_area, label_blanked_identity_keys, check_label_blanked_used

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
# Record build paths (scripts/records/paths.py): the legacy locations unless CIVGRAPH_BUILD_DIR is set.
_RP = __import__('runpy').run_path(os.path.join(REPO, 'scripts', 'records', 'paths.py'))
# The election metadata the rest of the build actually reads. This pointed at
# `test/metadata/elections-test2` for a long time, a directory that does not exist:
# the glob matched nothing, no candidacy was ever stamped, and the only symptom was a
# ZeroDivisionError on the summary line below, which says nothing about paths. So it is
# an argument with a default now, and an empty match is a hard error rather than a
# silent no-op. build-elections-sqlite.mjs reads the same directory.
DEFAULT_META = _RP['ELECTION_BUNDLE_DIR']
REG = os.path.join(REPO, 'data', 'elections', 'persons', 'person_registry.json')
LIFE_REPORT = os.path.join(REPO, 'tmp', 'person-lifespan-apply.csv')
# Rungs whose choice rests on a name, not on the row's own evidence: a choice of theirs outside
# the person's life is not made. by-name-id is the by-id rung on a name-and-party candidacy id.
WEAK_RUNGS = {'by-name-id', 'by-name-local', 'by-name', 'by-name-group', 'by-name-modern'}


def name_keyed_id(cid):
    """A candidacy id that is a name and party ("William Stewart|", "Henry Wilson|UUP"), which
    the pre-1918 Westminster and pre-1973 NI council imports use for want of a source id: as
    weak as the name itself."""
    return '|' in str(cid or '')


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
    # Registered non-candidates (non-candidate-persons.json) stood in no election: no candidacy
    # may ever be stamped with one, so they take no part in any rung.
    entities = [e for e in doc['entities'] if e.get('keyedBy') != 'registered']
    # An id can belong to more than one entity when the registry split an implausible
    # career at a long silence; each half records its `era`, and a contest's year picks it.
    by_person, by_srcid, name_hits = collections.defaultdict(list), collections.defaultdict(list), collections.defaultdict(set)
    local_names = collections.defaultdict(set)
    for e in entities:
        era = e.get('era') or [0, 9999]
        for s in e.get('sourcePersonIds') or []:
            by_person[s].append((era[0], era[1], e['personId']))
        for s in e['sourceIds']:
            by_srcid[s].append((era[0], era[1], e['personId']))
        # A council-area person (see local_area below) is found by name only in his own area and
        # years, never by the name rungs every other contest uses.
        for m in e['matchKeys']:
            (local_names if e.get('localArea') else name_hits)[m].add(e['personId'])

    def pick(options, year):
        if not options:
            return None
        if len(options) == 1:
            return options[0][2]
        # The narrowest era holding the year: a person split off by official id or lifespan
        # has the years of his own rows, the rest of the id keeps [0, 9999].
        holding = [o for o in options if o[0] <= year <= o[1]]
        if holding:
            return min(holding, key=lambda o: (o[1] - o[0], o[2]))[2]
        return min(options, key=lambda o: min(abs(year - o[0]), abs(year - o[1])))[2]

    explicit_era = {e['personId']: tuple(e['era']) for e in entities
                    if e.get('era') and str(e.get('eraReason') or '').startswith(('split by its official', 'rows of a name'))}

    def narrow(pids, year):
        """Entities of one name, less those split off for years that do not hold this one."""
        pids = set(pids)
        held = {p for p in pids if p in explicit_era and explicit_era[p][0] <= year <= explicit_era[p][1]}
        if held:
            return held
        return {p for p in pids if p not in explicit_era} or pids

    # An official person id (Oireachtas, NI Assembly, UK Parliament, Democracy Club) names
    # exactly one person, and decides before anything else.
    by_official = collections.defaultdict(set)
    for e in entities:
        for o in e.get('officialPersonIds') or []:
            by_official[o].add(e['personId'])

    by_name = {m: list(v)[0] for m, v in name_hits.items() if len(v) == 1}
    ambiguous = {m for m, v in name_hits.items() if len(v) > 1}
    without_source = collections.defaultdict(set)
    for e in entities:
        # Name-keyed entities only. A candidacy reaches this rung only when it has no usable
        # candidacy id, and the registry puts exactly those rows in the group keyed by the
        # name; an id-keyed entity of the same name (a 1992 Westminster Daniel O'Leary beside
        # a 1973 Dail one) is a different group and must not make the name look ambiguous.
        if e.get('keyedBy') == 'name' and not (e.get('sourcePersonIds') or []):
            for m in e['matchKeys']:
                without_source[m].add(e['personId'])
        # A name-keyed entity merge_person_ids.py joined to a sourced career (Dan Breen's
        # 1922 row to his ElectionsIreland id) carries a source id now, but still holds
        # the rows of its name that have none.
        for m in e.get('nameKeyedRows') or []:
            without_source[m].add(e['personId'])
    by_name_group = {m: next(iter(v)) for m, v in without_source.items() if len(v) == 1 and m in ambiguous}
    span = {e['personId']: (e.get('firstYear') or 0, e.get('lastYear') or 9999) for e in entities}
    # The registry keeps a Republic councillor's id-less rows to his council area: a name there
    # can be several people, one per area and run of years, told apart by where and when.
    local_area = {e['personId']: (e['localArea'], tuple(e['era'])) for e in entities if e.get('localArea')}
    councils = {}

    def area_of(result):
        sf = result.get('sourceFile')
        if not sf:
            return ''
        if sf not in councils:
            try:
                councils[sf] = council_area(json.load(open(os.path.join(REPO, sf), encoding='utf-8')).get('council') or '')
            except (OSError, ValueError):
                councils[sf] = ''
        return councils[sf]

    def modern_for(mk):
        return [p for p in name_hits.get(mk, ()) if span.get(p, (0, 9999))[1] >= 1918]

    # A row whose label was blanked under the printed-label rule keeps the candidacy id it had
    # before as its identity key, exactly as the registry build groups it (see
    # label_blanked_identity_keys in build_person_registry_v2.py).
    blanked, blanked_used = label_blanked_identity_keys(), set()

    def identity_id(c, constituency):
        k = (doc2.get('key'), str(constituency or ''), c.get('name') or '')
        if k in blanked:
            blanked_used.add(k)
            return blanked[k]
        return str(c.get('id') or '').strip()

    life_book = person_lifespans.load()
    by_pid = {e['personId']: e for e in entities}
    lives = {}

    def life_of(pid):
        if pid not in lives:
            e = by_pid.get(pid) or {}
            lives[pid] = life_book.life(e.get('sourcePersonIds') or [], e.get('officialPersonIds') or [], pid)
        return lives[pid]

    def outside_life(pid, when):
        return life_book.outside(when, life_of(pid), pid) if pid is not None else None

    life_rows = []

    def note_life(action, pid, why, c, constituency, how, when):
        life = life_of(pid) or {}
        life_rows.append([action, pid, why, how, doc2.get('key'), constituency or '', c.get('name') or '', when,
                          c.get('sourcePersonId') or '', ' '.join(c.get('officialPersonIds') or []),
                          life.get('born') or '', life.get('died') or '', life.get('source') or ''])

    stats = collections.Counter()
    changed = 0
    for path in files:
        doc2 = json.load(open(path, encoding='utf-8'))
        dirty = False
        date = str(doc2.get('date') or '')
        year = int(date[:4]) if date[:4].isdigit() else 0

        local_contest = doc2.get('bodySlug') == 'ireland-local'
        here = {'area': ''}

        def alive(options):
            """The (lo, hi, pid) options whose person was alive and 18 at the contest, or all of
            them where none was (the caller decides what a choice outside the life means)."""
            ok = [o for o in options if not outside_life(o[2], date)]
            return ok or options

        def stamp(c, constituency):
            nonlocal dirty
            spid = str(c.get('sourcePersonId') or '').strip()
            owners = {p for o in c.get('officialPersonIds') or [] for p in by_official.get(o, ())}
            pid = next(iter(owners)) if len(owners) == 1 else None
            how = 'by-official-id' if pid else None
            if not pid:
                pid = pick(alive(by_person.get(spid, [])), year) if spid else None
                how = 'by-source-person' if pid else None
            if not pid:
                cid = identity_id(c, constituency)
                pid = pick(alive(by_srcid.get(cid, [])), year)
                how = ('by-name-id' if name_keyed_id(cid) else 'by-id') if pid else None
            if not pid and local_contest:
                mk = matchkey(c.get('name') or '')
                mine = [p for p in local_names.get(mk, ()) if p in local_area
                        and local_area[p][0] == here['area'] and local_area[p][1][0] <= year <= local_area[p][1][1]]
                if len(mine) == 1:
                    pid, how = mine[0], 'by-name-local'
            if not pid:
                mk = matchkey(c.get('name') or '')
                # A name made ambiguous only by a split-off person (official id, lifespan) still
                # names one person in a year outside that split.
                split_name = mk in ambiguous and any(p in explicit_era for p in name_hits.get(mk, ()))
                narrowed = narrow(name_hits.get(mk, ()), year) if split_name else set()
                if len(narrowed) == 1:
                    pid, how = next(iter(narrowed)), 'by-name'
                elif mk in by_name:
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
            why = outside_life(pid, date)
            if why and how in WEAK_RUNGS:
                note_life('vetoed', pid, why, c, constituency, how, date)
                pid, how = None, 'outside-life'
            elif why:
                note_life('kept', pid, why, c, constituency, how, date)
            if how == 'by-name-id':
                how = 'by-id'
            stats[how] += 1
            if c.get('personId') != pid:
                c['personId'] = pid
                dirty = True

        # Referendum options are not people: strip any personId rather than stamp one.
        referendum = str(doc2.get('contestType') or '') == 'referendum'
        for r in doc2.get('results') or []:
            here['area'] = area_of(r) if local_contest else ''
            for c in (r.get('candidates') or []):
                if referendum:
                    if c.pop('personId', None) is not None:
                        dirty = True
                elif (c.get('name') or '').strip():
                    stamp(c, r.get('constituency'))
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
                cid = identity_id(c, c.get('constituency'))
                spid = str(c.get('sourcePersonId') or '').strip()
                mk = matchkey(c.get('name') or '')
                own = stamped.get((str(c.get('constituency') or '').strip(), (c.get('name') or '').strip()), set())
                pid = (next(iter(own)) if len(own) == 1 and None not in own else None) or (
                       (pick(alive(by_person.get(spid, [])), year) if spid else None) or pick(alive(by_srcid.get(cid, [])), year)
                       or by_name.get(mk) or (by_name_group.get(mk) if not spid else None))
                # The candidacy above's veto, for a summary row stamped on its own fields: never a
                # person who was dead or under 18, on a name or a name-and-party id.
                if pid is not None and not own and not spid and outside_life(pid, date) \
                        and (not cid or name_keyed_id(cid) or not by_srcid.get(cid)):
                    pid = None
                if c.get('personId') != pid:
                    c['personId'] = pid
                    dirty = True
        if dirty:
            changed += 1
            if not args.check:
                dump_generated_json(path, doc2)

    check_label_blanked_used(blanked, blanked_used)
    os.makedirs(os.path.dirname(LIFE_REPORT), exist_ok=True)
    import csv
    with open(LIFE_REPORT, 'w', encoding='utf-8', newline='') as fh:
        w = csv.writer(fh, lineterminator='\n')
        w.writerow(['action', 'personId', 'kind', 'rung', 'election', 'constituency', 'name', 'date', 'sourcePersonId',
                    'officialIds', 'born', 'died', 'lifeSource'])
        w.writerows(life_rows)
    tot = sum(stats.values())
    print(f'{tot:,} named candidacies')
    for k in ('by-official-id', 'by-source-person', 'by-id', 'by-name-local', 'by-name', 'by-name-group', 'ambiguous-name', 'unresolved', 'outside-life'):
        print(f'   {stats[k]:7,}  {k}')
    kept = sum(1 for r in life_rows if r[0] == 'kept')
    print(f'   lifespan veto: {len(life_rows) - kept:,} weak match(es) left unstamped, {kept:,} kept on their own '
          f'evidence for review ({os.path.relpath(LIFE_REPORT, REPO)})')
    res = stats['by-official-id'] + stats['by-source-person'] + stats['by-id'] + stats['by-name-local'] + stats['by-name'] + stats['by-name-group']
    print(f'   resolved {res:,}/{tot:,} ({100*res/tot:.1f}%)')
    print(f'   ambiguous names (shared by >1 entity): {len(ambiguous):,}')
    print(f"\nfiles {'that would change' if args.check else 'written'}: {changed}")


if __name__ == '__main__':
    main()
