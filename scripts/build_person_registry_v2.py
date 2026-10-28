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

import ei_relatives

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))
# render/, not test/: the directory was renamed and these constants were not.
# Every one of these scripts globbed an empty path and did nothing, silently.
META = os.path.join(REPO, 'render', 'metadata', 'elections-test2')
OLD = os.path.join(HERE, 'person_registry.json')
OUT = os.path.join(REPO, 'data', 'elections', 'persons')
REG = os.path.join(OUT, 'person_registry.json')
CROSSWALK = os.path.join(OUT, 'official-person-crosswalk.json')



def party_of(c):
    """A candidate's party; "No party recorded" (before 1832) is none, so it is never
    evidence that two candidates are one man."""
    p = (c.get('party') or '').strip()
    return '' if p == 'No party recorded' else p

def matchkey(v):
    t = re.sub(r'\s+', ' ', str(v or '')).strip()
    t = unicodedata.normalize('NFKD', t)
    t = ''.join(c for c in t if not unicodedata.combining(c))
    t = t.lower().replace('’', "'").replace('‘', "'")
    return re.sub(r'\s+', ' ', re.sub(r"[^a-z0-9 ]+", ' ', t)).strip()


def ns(i):
    # A council-specific id ('T3551993284-castlereagh', split from an id the import shared across
    # councils) stays in its source system, so it never reads as a second system's one id for the name.
    m = re.match(r'^(T?\d+)-[a-z0-9-]+$', i)
    i = m.group(1) if m else i
    return 'T' if i.startswith('T') else ('N' if i.isdigit() else 'O')


_crosswalk = None


def official_ids(c):
    """A candidacy's official person ids, with the Wikidata item that holds them
    ("wikidata:Q..."), so ids of one person in two systems meet in one key."""
    global _crosswalk
    if _crosswalk is None:
        _crosswalk = json.load(open(CROSSWALK, encoding='utf-8')).get('ids', {}) if os.path.exists(CROSSWALK) else {}
    offs = set(c.get('officialPersonIds') or [])
    offs |= {'wikidata:' + _crosswalk[o] for o in offs if o in _crosswalk}
    return tuple(sorted(offs))


def council_area(council):
    """The county a Republic council belongs to: "Cork City Council" and "Cork County Council"
    are one area, as are Dublin's city and county councils, so a councillor who moves between
    a city and its county stays one person."""
    c = re.sub(r'\s+', ' ', str(council or '')).strip()
    if re.search(r'Fingal|South Dublin|D[uú]n Laoghaire|Dublin', c, re.I):
        return 'dublin'
    c = re.sub(r'\([^)]*\)|\b(North|South) Riding\b', ' ', c)  # Tipperary's two ridings are one county
    c = re.sub(r'\b(City and County|County|City|Borough|Town|Urban District|Corporation)\b.*$', '', c, flags=re.I).strip()
    return matchkey(c)


def scan():
    rows = []
    councils = {}
    def council_of(source_file):
        if not source_file:
            return ''
        if source_file not in councils:
            try:
                councils[source_file] = json.load(open(os.path.join(REPO, source_file), encoding='utf-8')).get('council') or ''
            except (OSError, ValueError):
                councils[source_file] = ''
        return councils[source_file]
    for f in sorted(glob.glob(os.path.join(META, '*.json'))):
        d = json.load(open(f, encoding='utf-8'))
        # Referendum options ("Yes", "No") are not people. Registered as two, they carried
        # 1,207 candidacies each across 87 years and headed every over-merge report.
        if str(d.get('contestType') or '') == 'referendum':
            continue
        yr = str(d.get('date') or '')[:4]
        for r in d.get('results') or []:
            area = council_area(council_of(r.get('sourceFile'))) if d.get('bodySlug') == 'ireland-local' else ''
            for c in (r.get('candidates') or []):
                nm = (c.get('name') or '').strip()
                if not nm:
                    continue
                rows.append({'id': str(c.get('id') or '').strip(), 'name': nm, 'area': area,
                             'cons': str(r.get('constituency') or ''),
                             'src': str(c.get('sourcePersonId') or '').strip(),
                             'key': d.get('key'), 'body': d.get('bodySlug'),
                             'year': int(yr) if yr.isdigit() else 0,
                             'party': party_of(c),
                             'off': official_ids(c)})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()
    if os.path.exists(REG) and not args.force:
        sys.exit(f'{REG} exists; it is the hand-edited source of truth. --force to rebuild.')

    # The registry this run replaces. Its ids are load-bearing: they are stamped into
    # render/metadata/elections-test2, carried into the browse indexes and D1, and they
    # appear in person URLs. Rebuilding from scratch would renumber everybody, so every
    # group that still corresponds to a person already in the registry keeps that
    # person's id. Only groups that genuinely changed -- a fused career split apart, a
    # split career joined -- see new numbers, and a retired id is never handed out again.
    prev = {}
    prev_max = 0
    if os.path.exists(REG):
        old_reg = json.load(open(REG, encoding='utf-8'))
        for e in old_reg.get('entities') or []:
            prev[e['personId']] = e
            prev_max = max(prev_max, int(e['personId']))
    prev_by_person = collections.defaultdict(set)
    prev_by_source = collections.defaultdict(set)
    prev_by_key = collections.defaultdict(set)
    prev_by_official = collections.defaultdict(set)
    prev_by_namerows = collections.defaultdict(set)
    for pid, e in prev.items():
        for sp in e.get('sourcePersonIds') or []:
            prev_by_person[sp].add(pid)
        for sid in e.get('sourceIds') or []:
            prev_by_source[sid].add(pid)
        for mk in e.get('matchKeys') or []:
            prev_by_key[mk].add(pid)
        for mk in e.get('nameKeyedRows') or []:
            prev_by_namerows[mk].add(pid)
        for o in e.get('officialPersonIds') or []:
            prev_by_official[o].add(pid)

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

    # Three keys, strongest first.
    #
    #   src   the person as the SOURCE names them. ElectionsIreland links every
    #         candidate to candidate.cfm?ID=<n> and that id is the person: it follows
    #         Seamus Pattison from 1961 to 1997, and the two Jim Gibbonses of
    #         Carlow-Kilkenny hold ids of their own. This is the only key in the set
    #         that is evidence rather than inference, and it is the only one that can
    #         separate two people who share a name.
    #   id    the candidacy id, where it is not a row index.
    #   name  the fallback, and the cause of both failure modes the audit reports.
    groups = collections.defaultdict(list)
    for r in rows:
        if r['src']:
            k = ('src', r['src'])
        elif r['id'] and r['id'] not in bad_ids:
            k = ('id', r['id'])
        else:
            k = ('name', matchkey(r['name']))
        groups[k].append(r)

    # A COUNCILLOR'S NAME DOES NOT TRAVEL. Most rows of the 1974, 1979 and 1985 Republic local
    # elections carry no id, so they fell into the group of their bare name, beside every
    # namesake on record: a Naas councillor of 1974-85 with the Cumann na nGaedheal TD John
    # O'Neill of 1927 (61 such careers in a trial build, 25 to 63 years apart). A local row with
    # no id stays with others of its name only where they are in the same council area (a
    # county, its city with it) and within 15 years of one of them; the rows of a name that
    # chain together that way are one person, and any other local rows of the name are others.
    # Rows of other bodies with no id keep their name group as before, without the local rows.
    LOCAL_GAP = 15
    AREA_WORDS = {'dublin': ('dublin', 'dun laoghaire', 'fingal', 'rathdown'), 'laois': ('laois', 'leix', 'laoighis'),
                  'offaly': ('offaly',), 'tipperary': ('tipperary',)}
    local_splits = 0
    for k in [k for k in groups if k[0] == 'name']:
        local = [r for r in groups[k] if r['body'] == 'ireland-local']
        if not local:
            continue
        rest = [r for r in groups[k] if r['body'] != 'ireland-local']
        clusters = []
        for r in sorted(local, key=lambda r: (r['area'], r['year'])):
            home = next((cl for cl in clusters if cl[0]['area'] == r['area'] and r['area']
                         and any(abs((x['year'] or 0) - (r['year'] or 0)) <= LOCAL_GAP for x in cl)), None)
            if home is None:
                clusters.append([r])
            else:
                home.append(r)
        # A run of local rows is the same person as the name's other rows (a TD's Dail career,
        # say) where one of those is in a constituency named for the same county and within 15
        # years: Beverley Cooper Flynn, Mayo county councillor in 1999 and TD for Mayo.
        def same_county(row, area):
            words = AREA_WORDS.get(area, (area,))
            cons = matchkey(row['cons'])
            return bool(area) and any(re.search(r'(^| )%s( |$)' % re.escape(w), cons) for w in words)
        joined = [cl for cl in clusters if any(same_county(x, cl[0]['area']) and abs((x['year'] or 0) - (r['year'] or 0)) <= LOCAL_GAP
                                               for x in rest for r in cl)]
        rest = rest + [r for cl in joined for r in cl]
        clusters = [cl for cl in clusters if cl not in joined]
        if not clusters:
            continue
        if not rest and len(clusters) == 1:
            continue
        del groups[k]
        if rest:
            groups[k] = rest
        for cl in clusters:
            yrs = sorted({r['year'] for r in cl if r['year']})
            groups[k + ('local:%s:%d-%d' % (cl[0]['area'] or 'unknown', yrs[0] if yrs else 0, yrs[-1] if yrs else 0),)] = cl
        local_splits += 1

    # IMPLAUSIBLE CAREERS ARE SPLIT AT THEIR LONGEST SILENCE. An id -- the source's own
    # person id or a candidacy id -- that spans more than 60 years with a gap of 25 or more
    # is not one career: John Hanna, Belfast Labour at Stormont in 1921, is not the UUP
    # councillor of 1989-2011, and William Graham, Independent Unionist in 1929, is not the
    # UUP candidate of 1997-2011. Measured on the data, this rule separates exactly those
    # four Northern Ireland ids and the source-asserted ones with the same shape, and
    # nothing else. It is still a rule, not a proof, and it only ever splits: a wrong split
    # is visible and fixable, a wrong merge is neither. Each half keeps the id and records
    # its years as `era`, which the stamper uses to pick the right half for a contest.
    MAX_PLAUSIBLE_SPAN, MIN_SILENCE = 60, 25
    career_splits = []
    for k in [k for k in groups if k[0] in ('src', 'id')]:
        yrs = sorted({r['year'] for r in groups[k] if r['year']})
        if len(yrs) < 2 or yrs[-1] - yrs[0] <= MAX_PLAUSIBLE_SPAN:
            continue
        gap, last_before, first_after = max((yrs[i + 1] - yrs[i], yrs[i], yrs[i + 1]) for i in range(len(yrs) - 1))
        if gap < MIN_SILENCE:
            continue
        early = [r for r in groups[k] if (r['year'] or 0) <= last_before]
        late = [r for r in groups[k] if (r['year'] or 0) >= first_after]
        del groups[k]
        groups[k + ('%d-%d' % (yrs[0], last_before),)] = early
        groups[k + ('%d-%d' % (first_after, yrs[-1]),)] = late
        career_splits.append((k, last_before, first_after))

    # OFFICIAL IDS DECIDE. The Houses of the Oireachtas, the NI Assembly, the UK Parliament
    # and Democracy Club each give a person one id (data/elections/persons/
    # official-person-ids.json, carried on candidacies as officialPersonIds). They are the
    # strongest evidence in the data, stronger than ElectionsIreland's ids, which fuse some
    # namesakes (two Patrick O'Reillys of Cavan share ei:1986):
    #   a group holding two ids of one system is two people, and is split by the id, each
    #     row without an id going with the id-holding rows nearest it in time and body;
    #   groups holding the same id are one person, and are joined, unless that would put
    #     two ids of one system together or the groups stood in the same contest.
    # Split halves are keyed (src, id, 'official:<id>') so the prior-join pass below leaves
    # them apart; each half records the years it covers as its `era`.
    def off_by_system(offs):
        out = collections.defaultdict(set)
        for o in offs:
            out[o.split(':', 1)[0]].add(o)
        return out

    # Wikidata ties one person's ids in different systems together (data/elections/persons/
    # official-person-crosswalk.json): Roy Beggs Sr is UK Parliament 646, his son NI Assembly 8
    # and Democracy Club 7132, and nothing in the ids alone says those are two men.
    crosswalk, lifespans = {}, {}
    if os.path.exists(CROSSWALK):
        _cw = json.load(open(CROSSWALK, encoding='utf-8'))
        crosswalk, lifespans = _cw.get('ids') or {}, _cw.get('people') or {}

    def outside_life(offs, year):
        """True when Wikidata's dates for the person these ids name rule the year out:
        before he turned 18 (the youngest anyone may stand, for a council) or after his death."""
        if not year:
            return False
        for o in offs:
            if not o.startswith('wikidata:'):
                continue
            life = lifespans.get(o[9:]) or {}
            born, died = str(life.get('born') or '')[:4], str(life.get('died') or '')[:4]
            if (born.isdigit() and year < int(born) + 18) or (died.isdigit() and year > int(died)):
                return True
        return False

    def conflicts(a, b):
        sa, sb = off_by_system(a), off_by_system(b)
        if any(sa[s] and sb[s] and sa[s].isdisjoint(sb[s]) for s in sa):
            return True
        qa = {crosswalk[o] for o in a if o in crosswalk}
        qb = {crosswalk[o] for o in b if o in crosswalk}
        return bool(qa and qb and qa.isdisjoint(qb))

    # A group whose official ids name two people is split. Rows sharing an id are one person;
    # those pieces are then joined, nearest in time first, wherever no id (or Wikidata) says
    # they are two people: Mark Durkan's Assembly rows (AIMS 32) join his Westminster rows
    # (UK Parliament 1594), not his nephew's (AIMS 287). Rows with no id go to the piece
    # nearest them in time, in the same body where there is one.
    official_splits = 0
    for k in list(groups):
        v = groups[k]
        offs = {o for r in v for o in r['off']}
        if len(offs) < 2:
            continue
        pieces = []
        for r in v:
            if not r['off']:
                continue
            hit = [pc for pc in pieces if pc['ids'] & set(r['off'])]
            merged_pc = {'ids': set(r['off']), 'rows': [r]}
            for pc in hit:
                merged_pc['ids'] |= pc['ids']
                merged_pc['rows'] += pc['rows']
                pieces.remove(pc)
            pieces.append(merged_pc)
        if not any(conflicts(a['ids'], b['ids']) for i, a in enumerate(pieces) for b in pieces[i + 1:]):
            continue
        def years(pc):
            ys = [r['year'] for r in pc['rows'] if r['year']] or [0]
            return min(ys), max(ys)
        while True:
            best = None
            for i, a in enumerate(pieces):
                for b in pieces[i + 1:]:
                    if conflicts(a['ids'], b['ids']):
                        continue
                    (a0, a1), (b0, b1) = years(a), years(b)
                    gap = max(0, max(a0, b0) - min(a1, b1))
                    if best is None or gap < best[0]:
                        best = (gap, a, b)
            if best is None:
                break
            _, a, b = best
            a['ids'] |= b['ids']
            a['rows'] += b['rows']
            pieces.remove(b)
        if len(pieces) < 2:
            continue
        for r in v:
            if r['off']:
                continue
            def distance(pc):
                # Never a person Wikidata's dates rule out (the 1982 Assembly's Roy Beggs is the
                # father: the son was 20, which allows it, but the father is not ruled out and the
                # name and body decide). Then the piece whose rows go by this row's exact name
                # ("Roy Beggs", not "Roy Beggs Jr"), one in the same body, the nearest in time.
                same_name = sum(1 for x in pc['rows'] if x['name'] == r['name']) / len(pc['rows'])
                same_body = [x for x in pc['rows'] if x['body'] == r['body']]
                near = same_body or pc['rows']
                # Nor a piece already standing in this contest: one person is one candidacy
                # (the losing Patrick O'Reilly of Cavan 1951 is not the one elected beside him).
                same_contest = any(x['key'] == r['key'] for x in pc['rows'])
                return (same_contest, outside_life(pc['ids'], r['year']), -same_name, 0 if same_body else 1,
                        min(abs((x['year'] or 0) - (r['year'] or 0)) for x in near), -len(pc['rows']))
            min(pieces, key=distance)['rows'].append(r)
        # A candidacy id the source put on both people (Mark H. Durkan's 2016 Foyle row carries
        # his uncle's 16260) stays with the piece that holds most of its rows. Elsewhere it is
        # dropped, or it would carry the uncle's other ids and prior joins into the nephew.
        holders = collections.defaultdict(collections.Counter)
        for i, pc in enumerate(pieces):
            for r in pc['rows']:
                if r['id']:
                    holders[r['id']][i] += 1
        for i, pc in enumerate(pieces):
            for j, r in enumerate(pc['rows']):
                if r['id'] and len(holders[r['id']]) > 1 and holders[r['id']].most_common(1)[0][0] != i:
                    pc['rows'][j] = dict(r, id='')
        del groups[k]
        for pc in pieces:
            groups[k[:2] + ('official:' + min(pc['ids']),)] = pc['rows']
        official_splits += 1

    official_joins = 0
    by_official = collections.defaultdict(list)
    for k, v in groups.items():
        for o in {o for r in v for o in r['off']}:
            by_official[o].append(k)
    for o, keys in sorted(by_official.items()):
        keys = [k for k in dict.fromkeys(keys) if k in groups]
        if len(keys) < 2:
            continue
        keys.sort(key=lambda k: (-len(groups[k]), str(k)))
        lead = keys[0]
        for k in keys[1:]:
            if k not in groups or lead not in groups:
                continue
            lead_offs = {x for r in groups[lead] for x in r['off']}
            their_offs = {x for r in groups[k] for x in r['off']}
            if conflicts(lead_offs, their_offs):
                continue
            if {r['key'] for r in groups[lead]} & {r['key'] for r in groups[k]}:
                continue
            groups[lead].extend(groups.pop(k))
            for oo in their_offs:
                by_official[oo] = [lead if x == k else x for x in by_official[oo]]
            official_joins += 1
    # A LIFE IS A LIMIT. Where a group's official ids name one person whose dates Wikidata
    # gives, a row of that group falling before he was 18 or after his death is someone else:
    # the 1927 Cumann na nGaedheal TD John O'Neill is not the Naas councillor of 1974-99. Such
    # rows, having no official id of their own, become a group of their own.
    outside_life_rows = 0
    for k in list(groups):
        v = groups[k]
        qids = {o for r in v for o in r['off'] if o.startswith('wikidata:')}
        if len(qids) != 1:
            continue
        out = [r for r in v if not r['off'] and outside_life(qids, r['year'])]
        if not out:
            continue
        groups[k] = [r for r in v if r not in out]
        groups[k[:2] + ('outside-life',)] = out
        outside_life_rows += len(out)
    print(f'official ids: {official_splits:,} group(s) split, {official_joins:,} join(s); '
          f'{outside_life_rows:,} row(s) outside the life of the person their group names')

    # NOTHING IS FOLDED IN ON A NAME. An earlier version of this pulled name-keyed
    # groups into a src group wherever exactly one src group answered to that name and
    # the two had never shared a contest, on the theory that it was one person whose
    # other contests had not been harvested. It merged a Northern Ireland local-
    # government Seamus Doyle into a Dail Seamus Doyle and produced 231 source-keyed
    # people with hundred-year careers -- the precise defect the ids were harvested to
    # cure, reintroduced with a longer reach. A person whose contests are only partly
    # harvested is left split, because a split is visible and fixable and a wrong merge
    # is neither.

    # A NAME DOES NOT CARRY A MAN ACROSS A GENERATION. The 1885-1910 Westminster results
    # have no candidate ids; each row's id is its name and party, a system of its own, so
    # the one-per-system join below put 23 of them into modern people: a West Cork Daniel
    # O'Leary of 1910 with a Belfast North one of 1992, Sir Daniel Dixon (died 1907) with a
    # Stormont candidate of 1950. A group lying wholly before 1918 is not joined to one that
    # begins 25 years or more after it ends. No group without pre-1918 rows is affected.
    def across_a_generation(vs):
        spans = sorted((min(ys), max(ys)) for ys in ([r['year'] for r in v if r['year']] for v in vs) if ys)
        return any(a[1] < 1918 and b[0] - a[1] >= MIN_SILENCE for a, b in zip(spans, spans[1:]))

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
            if not set.intersection(*[{r['key'] for r in groups[k]} for k in keys]) \
                    and not across_a_generation([groups[k] for k in keys]):
                for k in keys[1:]:
                    merges[k] = keys[0]
                continue
        review.append(nm)
    review = set(review)

    merged = collections.defaultdict(list)
    for k, v in groups.items():
        merged[merges.get(k, k)].extend(v)

    # Keep the joins the prior registry made. merge_person_ids.py joins groups this build
    # keeps apart -- a councillor's local-government ids with his Assembly id (Declan
    # O'Loan, 81112), or one TD's two ElectionsIreland ids -- and the registry records the
    # result. Rebuilt without them, one half reclaimed the id, the other was renumbered,
    # and the merge pass, which tests only its own classes, did not find the pair again.
    # So groups whose strongest source evidence names the same prior person are one group
    # again, unless they stood in the same contest or one is half of a split career.
    def strongest_prior(v):
        persons = {r['src'] for r in v if r['src']}
        sources = {r['id'] for r in v if r['id'] and r['id'] not in bad_ids}
        prior = set().union(*[prev_by_person.get(s, set()) for s in persons],
                            *[prev_by_source.get(s, set()) for s in sources])
        best, best_score = None, (0, 0)
        for pid in sorted(prior):
            e = prev[pid]
            score = (len(set(e.get('sourcePersonIds') or []) & persons),
                     len(set(e.get('sourceIds') or []) & sources))
            if score > best_score:
                best, best_score = pid, score
        return best

    by_prior = collections.defaultdict(list)
    for k, v in merged.items():
        if len(k) > 2:
            continue
        pid = strongest_prior(v)
        if pid is None and k[0] == 'name' and len(prev_by_namerows.get(k[1], ())) == 1:
            # Rows with no usable id that merge_person_ids.py joined to a sourced career on
            # a Wikipedia biography's evidence (Dan Breen's 1922 Dail row and his
            # ElectionsIreland id): the prior entity recorded them as nameKeyedRows, and the
            # join is kept like any other prior join.
            pid = next(iter(prev_by_namerows[k[1]]))
        if pid is not None:
            by_prior[pid].append(k)
    rejoined = 0
    name_joined = collections.defaultdict(set)
    ei_people = ei_relatives.load()
    for pid, keys in by_prior.items():
        if len(keys) < 2:
            continue
        keys.sort(key=lambda k: (-len(merged[k]), str(k)))
        lead = keys[0]
        contests = {r['key'] for r in merged[lead]}
        # A prior join the source now contradicts is not kept. Two groups naming different
        # source persons were one prior person only because they shared a name and party --
        # Sir William Verner, 1st Baronet (1832-59) and his grandson the 3rd (1880), before
        # their Wikipedia articles told them apart. A join the prior entity recorded between
        # the two source ids (one TD's two ElectionsIreland ids) names both, and stays.
        prior_persons = set(prev[pid].get('sourcePersonIds') or [])
        for k in keys[1:]:
            theirs = {r['key'] for r in merged[k]}
            if contests & theirs:
                continue
            ours_src = {r['src'] for r in merged[lead] if r['src']}
            their_src = {r['src'] for r in merged[k] if r['src']}
            if ours_src and their_src and ours_src.isdisjoint(their_src) \
                    and not (ours_src & prior_persons and their_src & prior_persons):
                continue
            # Nor one the source's own pages contradict, however it was made: the ids of a
            # father and son (ei_relatives.py) are two people even where a prior registry
            # recorded them as one.
            if ei_relatives.distinct(ei_people, ours_src, their_src):
                continue
            if conflicts({o for r in merged[lead] for o in r['off']}, {o for r in merged[k] for o in r['off']}):
                continue
            contests |= theirs
            merged[lead].extend(merged.pop(k))
            for g in (lead, k):
                if g[0] == 'name':
                    name_joined[lead].add(g[1])
            rejoined += 1
    print(f'prior joins kept            : {rejoined:,}')

    next_id = max(next_id, prev_max + 1)

    def reclaim(person_ids, source_ids, match_keys, claimed):
        """The id this group already had, if it still clearly belongs to it.

        Groups are visited largest first, so where a fused career has been split the
        larger half keeps the number and the smaller half is issued a new one. An id is
        handed out at most once."""
        best, best_score = None, (0, 0, 0)
        seen = set()
        for sp in person_ids:
            seen |= prev_by_person.get(sp, set())
        for sid in source_ids:
            seen |= prev_by_source.get(sid, set())
        for mk in match_keys:
            seen |= prev_by_key.get(mk, set())
        for pid in sorted(seen):
            if pid in claimed:
                continue
            e = prev[pid]
            score = (len(set(e.get('sourcePersonIds') or []) & set(person_ids)),
                     len(set(e.get('sourceIds') or []) & set(source_ids)),
                     len(set(e.get('matchKeys') or []) & set(match_keys)))
            if score > best_score:
                best, best_score = pid, score
        return best if best_score > (0, 0, 0) else None

    # Reclaim by evidence first, not in visiting order. Visiting largest group first let a
    # group that shared only a NAME with a prior entity take its id before the group
    # holding that entity's own source ids got there: once the RoI local elections gave an
    # ElectionsIreland Mick Murphy an eighth candidacy, it took the curated 33264 by name and
    # the curated career was renumbered; a second Tom Campbell took 116687 from the one whose
    # candidate id it was. So every group first claims the prior id its source evidence points
    # to -- source person ids, then candidate ids, and where a fused career has been split the
    # larger half. Names decide only what evidence leaves unclaimed.
    # Two halves of a split career carry the same source ids, so evidence ties between them and
    # size alone decided which kept the prior id -- and the two Sean Lynches of ei:1879 (a TD
    # of 1937-48, a Drumlish councillor of 1991-2009) swapped numbers when one half grew. The
    # prior entity's own career span settles it: the id stays with the half whose years it held.
    def span_fit(pid, v):
        e = prev[pid]
        lo, hi = e.get('firstYear'), e.get('lastYear')
        yrs = [r['year'] for r in v if r['year']]
        if not yrs or lo is None or hi is None:
            return 0.0
        return sum(1 for y in yrs if lo <= y <= hi) / len(yrs)

    evidence = []
    for k, v in merged.items():
        persons = {r['src'] for r in v if r['src']}
        sources = {r['id'] for r in v if r['id'] and r['id'] not in bad_ids}
        # An official person id is evidence too: half of a career split by its official ids
        # often has no source id of its own, and without this got a new number on every build
        # (Andrew Wilson, democracyclub:69384).
        offs = {o for r in v for o in r['off']}
        prior = set()
        for sp in persons:
            prior |= prev_by_person.get(sp, set())
        for sid in sources:
            prior |= prev_by_source.get(sid, set())
        for o in offs:
            prior |= prev_by_official.get(o, set())
        for pid in prior:
            e = prev[pid]
            score = (len(set(e.get('sourcePersonIds') or []) & persons) + len(set(e.get('officialPersonIds') or []) & offs),
                     len(set(e.get('sourceIds') or []) & sources), 0)
            evidence.append((score, span_fit(pid, v), len(v), -pid, str(k), k, pid))
        # A name-keyed group has no source evidence, but the prior name-keyed entity under
        # its name is still its own. Without this, a larger RoI local group of the same name
        # visited first took the id by name: Thomas Kelly of the 1922 Dail lost 113101.
        if k[0] == 'name':
            for pid in prev_by_key.get(k[1], set()):
                if prev[pid].get('keyedBy') == 'name':
                    evidence.append(((0, 0, 1), span_fit(pid, v), len(v), -pid, str(k), k, pid))
    by_evidence = {}
    for score, _fit, _size, _neg, _sk, k, pid in sorted(evidence, key=lambda t: t[:5], reverse=True):
        if k in by_evidence or pid in by_evidence.values():
            continue
        by_evidence[k] = pid
    curated_by_pid = {pid: p for pid, p in curated.values()}

    entities, matched, reclaimed, seen_pid = [], 0, 0, set(by_evidence.values())
    for k, v in sorted(merged.items(), key=lambda kv: (-len(kv[1]), str(kv[0]))):
        names = sorted({r['name'] for r in v}, key=lambda s: (-len(s), s))
        mks = {matchkey(n) for n in names}
        hit = next((curated[m] for m in mks if m in curated), None)
        if k in by_evidence:
            owned = by_evidence[k]
            hit = (owned, curated_by_pid[owned]) if owned in curated_by_pid else None
        if hit and (hit[0] not in seen_pid or by_evidence.get(k) == hit[0]):
            pid, cur = hit
            seen_pid.add(pid)
            matched += 1
            disp = cur.get('canonicalName') or names[0]
            names = sorted(set(names) | set(cur.get('nameVariants') or []),
                           key=lambda s: (-len(s), s))
            prov, src = False, 'curated (Full election tables.xlsx, carried forward)'
        else:
            group_sources = sorted({r['id'] for r in v if r['id'] and r['id'] not in bad_ids})
            group_persons = sorted({r['src'] for r in v if r['src']})
            kept = by_evidence.get(k)
            if kept is None:
                kept = reclaim(group_persons, group_sources, mks, seen_pid)
            if kept is not None:
                # The name the person already goes by, while the group still uses it. Picking
                # afresh (longest, then alphabetical) put "Sean Tubridy" for "Seán Tubridy"
                # once a merge's evidence let the rebuild make the join itself; a name the
                # data no longer uses still gives way.
                had = prev[kept].get('displayName')
                pid, disp = kept, (had if had in names else names[0])
                seen_pid.add(pid)
                reclaimed += 1
            else:
                pid, disp = next_id, names[0]
                next_id += 1
            prov, src = True, 'derived from candidate ids in render/metadata/elections-test2'
            if k[0] == 'src':
                src = f"keyed on the source's own candidate id ({k[1]})"
        yrs = [r['year'] for r in v if r['year']]
        e = {'id': f'p{pid}', 'personId': pid, 'displayName': disp,
             'aliases': names, 'matchKeys': sorted(mks),
             'sourceIds': sorted({r['id'] for r in v if r['id'] and r['id'] not in bad_ids}),
             'sourcePersonIds': sorted({r['src'] for r in v if r['src']}),
             'officialPersonIds': sorted({o for r in v for o in r['off']}),
             'candidacies': len(v), 'contests': len({r['key'] for r in v}),
             'firstYear': min(yrs) if yrs else None, 'lastYear': max(yrs) if yrs else None,
             'bodies': sorted({r['body'] for r in v if r['body']}),
             'parties': sorted({r['party'] for r in v if r['party']})[:6],
             'keyedBy': k[0], 'provenance': src, 'provisional': prov}
        if len(k) > 2 and k[2] == 'outside-life':
            e['era'] = [min(yrs), max(yrs)] if yrs else [0, 9999]
            e['eraReason'] = ('rows of a name or id whose official person, by the dates Wikidata '
                              'gives, was under 18 or dead at the time')
        elif len(k) > 2 and str(k[2]).startswith('official:'):
            e['era'] = [min(yrs), max(yrs)] if yrs else [0, 9999]
            e['eraReason'] = (f'split by its official person id ({k[2][9:]}): the source id it '
                              'shares is held by another person with another official id')
        elif len(k) > 2 and str(k[2]).startswith('local:'):
            _, area, years = k[2].split(':')
            e['era'] = [int(y) for y in years.split('-')]
            e['localArea'] = area
            e['eraReason'] = ('rows of a name with no id in one council area, none more than 15 '
                              'years from another; namesakes elsewhere are other people')
        elif len(k) > 2:
            lo, hi = (int(x) for x in k[2].split('-'))
            e['era'] = [lo, hi]
            e['eraReason'] = ('split from a career spanning more than 60 years at a gap of 25 '
                              'or more; the same id continues in the other era')
        if name_joined.get(k):
            e['nameKeyedRows'] = sorted(name_joined[k])
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
    print(f'implausible careers split   : {len(career_splits)}')
    print(f'councillor names split      : {local_splits} (local rows with no id, by council area and 15-year chains)')
    for k, a, b in career_splits:
        print(f'    {k[0]} {k[1]}: split between {a} and {b}')
    print(f'cross-system merges applied : {len(merges):,}')
    print(f'same-name splits flagged    : {len(review):,}')
    print(f'persons emitted             : {len(entities):,}')
    print(f'  matched to curated registry: {matched:,} of 2,388 curated')
    print(f'  newly derived (provisional): {sum(1 for e in entities if e["provisional"]):,}')
    print(f'  ids carried from prior build: {reclaimed:,}')
    print(f'  keyed by SOURCE person id  : {sum(1 for e in entities if e["keyedBy"]=="src"):,}')
    print(f'  keyed by candidate id      : {sum(1 for e in entities if e["keyedBy"]=="id"):,}')
    print(f'  keyed by name only         : {sum(1 for e in entities if e["keyedBy"]=="name"):,}')
    print(f'  flagged needsReview        : {sum(1 for e in entities if e.get("needsReview")):,}')
    print(f'\nwrote {REG}')


if __name__ == '__main__':
    main()
