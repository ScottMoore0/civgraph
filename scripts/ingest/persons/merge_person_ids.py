#!/usr/bin/env python3
"""Merge the SAFE classes of split person ids found by audit_person_ids.py.

Only classes with a known mechanical cause are touched, never a judgement about who
someone is.

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
         from 2014, standing for the same party, AND the earlier council must be the later one
         or lie within it (ni-council-geography.json, from the boundary maps). A party match is not proof, but a
         continuing councillor who also changed party is rare enough to leave alone.
  Wiki:  a disambiguated Wikipedia title identifies one person by construction.
  Stray: one side curated, the other a derived id with exactly ONE candidacy, same name,
         same party, in a year inside or beside that curated career. "Independent" is not
         a party, and a stray the source filed under its own person id in an election the
         curated career also stood in is someone else.
  Seat:  two derived ids, same party, same constituency, same body, careers that do not
         overlap, one to ten years apart, and no Jr/Snr/numeral in either name. The gaps
         cluster on four and five years, which is an election cycle and the shape of one
         career rather than two people sharing a name, a party and a seat.
  Bio:   pairs listed in person_id_confirmed_merges.csv: one Wikipedia biography names a
         constituency (or council) of EACH id, in one of that id's years, as somewhere the
         person stood or sat. Written by scripts/ingest/persons/find_split_persons.py, which records the
         article and both pieces of evidence.
  Crosswalk: pairs listed in ie-ei-crosswalk.csv: an IrelandElection.com person id and an
         ElectionsIreland one for the same councillor (same name, council and electoral area at
         consecutive elections for the same party, or the council and a constituency of its
         county within five years). Written by scripts/ingest/persons/build_ie_ei_crosswalk.py,
         which records both rows.

Parties are compared ignoring case, accents and punctuation ("Workers' Party" is "Workers
Party"), so a spelling difference between source systems no longer blocks LGR-2014.

No class joins two people ElectionsIreland's own pages tell apart: ids it names as father
and son (or any relatives), or files as a Snr and a Jnr (ei_relatives.py). Pairs are joined
evidence first, and the test is made against everything already joined on either side, so
a row with no id of its own cannot carry a father into his son's career: the 1992 Dublin
West Brian Lenihan, joined to Snr on his biography, is not then joined to Jnr on the seat.

Merges keep the LOWER personId, preferring the curated 1-100011 block, and carry the
other id's aliases, match keys and source ids across. Every merge is recorded.

Usage:  python scripts/ingest/persons/merge_person_ids.py [--check]
"""
import os, re, sys, json, glob, csv, argparse, collections, unicodedata

import display_names
import ei_relatives
import person_lifespans

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
# Record build paths (scripts/records/paths.py): the legacy locations unless CIVGRAPH_BUILD_DIR is set.
_RP = __import__('runpy').run_path(os.path.join(REPO, 'scripts', 'records', 'paths.py'))
# render/, not test/: the directory was renamed and these constants were not.
# Every one of these scripts globbed an empty path and did nothing, silently.
META = _RP['ELECTION_BUNDLE_DIR']
PERS = os.path.join(REPO, 'data', 'elections', 'persons')
REG = os.path.join(PERS, 'person_registry.json')
LOG = os.path.join(PERS, 'person_id_merges.csv')
FORUM = 'northern-ireland-forum-for-political-dialogue__1996-05-30'
# A Wikipedia disambiguator, e.g. "Frederick Thompson (Northern Irish politician)".
# Tested against displayName, not the match key: matchkey() strips punctuation, so by
# the time a name is a key the brackets are gone and the qualifier is indistinguishable
# from someone actually named "... Northern Irish Politician".
DISAMBIGUATED = re.compile(r'\([^)]*\bpolitician\b[^)]*\)', re.I)
# Jr / Snr / a regnal numeral: the one way SAME-SEAT-SEQUENCE below could fuse a father
# and son who held the same seat for the same party.
SUCCESSOR_SUFFIX = re.compile(r'\b(jn?r|jun|junior|sn?r|sen|senior|[IVX]{2,})\b', re.I)
# Pairs one Wikipedia biography shows to be the same person; see find_split_persons.py.
CONFIRMED = os.path.join(PERS, 'person_id_confirmed_merges.csv')
# IrelandElection.com person ids that are ElectionsIreland ones; see build_ie_ei_crosswalk.py.
IE_EI_CROSSWALK = os.path.join(PERS, 'ie-ei-crosswalk.csv')


def crosswalk_pairs(obs):
    """{frozenset((pid, pid)): row} for each ie-ei-crosswalk.csv row: every person holding a
    candidacy with the row's IrelandElection.com id ("ie:") is paired with the person holding
    its ElectionsIreland id ("ei:") nearest it in time. The ids are found on the stamped
    candidacies, so a rebuild that renumbers or re-splits either side cannot lose the pair; an
    ElectionsIreland id split into eras (John Quinn, ei:802, 1923-27 and 1991-99) gives the ie
    person to the era it belongs to, not both."""
    if not os.path.exists(IE_EI_CROSSWALK):
        return {}
    holders = collections.defaultdict(set)
    for pid, xs in obs.items():
        for x in xs:
            if x['src']:
                holders[x['src']].add(pid)
    span = {pid: (min(x['y'] for x in xs), max(x['y'] for x in xs)) for pid, xs in obs.items()}

    def distance(a, b):
        (alo, ahi), (blo, bhi) = span[a], span[b]
        return max(0, blo - ahi, alo - bhi)
    out = {}
    with open(IE_EI_CROSSWALK, encoding='utf-8', newline='') as fh:
        for r in csv.DictReader(fh):
            eis = holders.get(r['ei'].strip()) or set()
            if not eis:
                continue
            for a in holders.get(r['ie'].strip()) or ():
                if a in eis:
                    continue
                b = min(eis, key=lambda p: (distance(a, p), p))
                out[frozenset((a, b))] = r
    return out


def confirmed_pairs(ents):
    """{frozenset((pid, pid)): row} for each confirmed pair, found by the stable keys the
    row records (source person ids, candidacy ids, or the name for rows with neither) so
    that a registry rebuild that renumbers or re-splits a person cannot lose the pair."""
    if not os.path.exists(CONFIRMED):
        return {}
    index = collections.defaultdict(set)
    for pid, e in ents.items():
        for k in list(e.get('sourcePersonIds') or []) + list(e.get('sourceIds') or []):
            index[k].add(pid)
        named = list(e.get('nameKeyedRows') or [])
        if e.get('keyedBy') == 'name':
            named += e.get('matchKeys') or []
        for m in named:
            index[f'name:{m}'].add(pid)

    def resolve(keys):
        pids = set()
        for k in (x.strip() for x in keys.split(' ; ')):
            if k:
                pids |= index.get(k, set())
        return pids

    out = {}
    with open(CONFIRMED, encoding='utf-8', newline='') as fh:
        for r in csv.DictReader(fh):
            # Every entity now holding a row of either half is the one person: a rebuild
            # may have regrouped the rows (Philip James Woods stood in two Belfast seats in
            # 1925, and the rebuild will not join groups that share an election).
            pids = resolve(r.get('keep_keys') or '') | resolve(r.get('drop_keys') or '')
            if not pids:
                pids = {p for p in (int(r['keep']), int(r['drop'])) if p in ents}
            if len(pids) < 2:
                continue
            lead = min(pids)
            for p in pids - {lead}:
                out[frozenset((lead, p))] = r
    return out


def crosswalk_redirects(xwalk, merges, final, ents):
    """Keep every person id a crosswalk merge retired answering, at every later rebuild.

    The merge log is rewritten by each pass that merges, and the next registry rebuild keeps a
    crosswalk join itself (both ids are on the prior person), so the pass that retired an id
    -- often a public person page, a 1985 councillor's -- is not repeated and its row would
    leave the log, and the old address would stop redirecting. So the first merge of each pair
    is recorded in ie-ei-crosswalk.csv (keep, drop), and every log written carries a row for
    each recorded drop that is still merged away. Returns those rows."""
    if not os.path.exists(IE_EI_CROSSWALK):
        return []
    with open(IE_EI_CROSSWALK, encoding='utf-8', newline='') as fh:
        reader = csv.DictReader(fh)
        fields = list(reader.fieldnames or [])
        table = list(reader)
    for f in ('keep', 'drop'):
        if f not in fields:
            fields.append(f)
    by_ids = {(r['ie'], r['ei']): r for r in table}
    for m in merges:
        if m['class'] != 'IE-EI-CROSSWALK':
            continue
        xw = xwalk.get(frozenset((m['keep'], m['drop'])))
        r = xw and by_ids.get((xw['ie'], xw['ei']))
        if r is not None and not r.get('drop'):
            r['keep'], r['drop'] = str(final.get(m['keep'], m['keep'])), str(m['drop'])
    with open(IE_EI_CROSSWALK, 'w', encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=fields, lineterminator='\n')
        w.writeheader()
        w.writerows({f: r.get(f) or '' for f in fields} for r in table)
    absorbed = {}
    for pid, e in ents.items():
        for d in e.get('mergedFrom') or []:
            absorbed[int(d)] = pid
    logged = {int(m['drop']) for m in merges}
    holders = {}
    for pid, e in ents.items():
        for s in e.get('sourcePersonIds') or []:
            holders.setdefault(s, set()).add(pid)
    out = []
    for r in table:
        if not r.get('drop') or not r['drop'].isdigit():
            continue
        drop, keep = int(r['drop']), int(r['keep'])
        if drop in ents or drop in logged:
            continue
        while keep not in ents and keep in absorbed and absorbed[keep] != keep:
            keep = absorbed[keep]
        if keep not in ents:
            # The recorded keep was itself joined into another person by a merge the registry now
            # holds by itself (so no mergedFrom names it): the pair's ids lead to the person instead.
            keep = next(iter(holders.get(r['ei'], set()) & holders.get(r['ie'], set())), keep)
        if keep not in ents:
            continue
        logged.add(drop)
        out.append({'class': 'IE-EI-CROSSWALK', 'keep': keep, 'drop': drop, 'name': ents[keep]['displayName'],
                    'keep_years': f"{ents[keep].get('firstYear')}-{ents[keep].get('lastYear')}", 'drop_years': '',
                    'evidence': f"{r['ie']} = {r['ei']}: {r['ie_evidence']} / {r['ei_evidence']} (retired {r['found']})"})
    return out


def carried_rows(prior, merges, ents):
    """The rows of the merge log on file that a pass writing a new log must keep.

    The registry build starts each re-stamp with no merged ids, so the first merge pass logs every
    id it retires. A later pass of the same loop rewrote the log with its own merges only: when the
    crosswalk pairs of c10-merge-leads made a second pass join three people the first had put in
    the same seat (John McGuinness, Harry Blaney, Thomas Brennan), the first pass's rows left the
    log, and the ids they retired stayed in their survivors' mergedFrom with nothing to redirect
    them. A row is kept where its drop is still in a live person's mergedFrom and this pass has not
    logged it, with that person as its keep. Pure: returns the rows."""
    absorbed = {}
    for pid, e in ents.items():
        for d in e.get('mergedFrom') or []:
            absorbed[int(d)] = pid
    logged = {int(m['drop']) for m in merges}
    out = []
    for r in prior:
        drop = str(r.get('drop') or '').strip()
        if not drop.isdigit() or int(drop) in ents or int(drop) in logged or int(drop) not in absorbed:
            continue
        logged.add(int(drop))
        out.append({**r, 'keep': absorbed[int(drop)], 'drop': int(drop)})
    return out


def party_of(c):
    """A candidate's party, as a comparison key: "Workers' Party" and "Workers Party", or
    "Sinn Féin" and "Sinn Fein", are one party. "No party recorded" (before 1832) is none,
    so it is never evidence that two candidates are one man."""
    p = (c.get('party') or '').strip()
    if p == 'No party recorded':
        return ''
    p = ''.join(ch for ch in unicodedata.normalize('NFKD', p) if not unicodedata.combining(ch))
    return re.sub(r'\s+', ' ', re.sub(r"[^a-z0-9 ]+", '', p.lower())).strip()

# Standing without a party is not a party two candidates can share. Matched on it,
# STRAY-INTO-CURATED put a Laois-Offaly independent of 2002 and a Kilkenny one of 2019
# (ElectionsIreland's John Kelly 6 and John Kelly 10) into the Sinn Fein MLA for Mid Ulster.
NO_PARTY = {'', 'independent', 'ind', 'non party', 'nonparty'}

# Which pre-2014 councils each 2014 council took over, from the boundary maps (ni-council-geography.json).
GEOGRAPHY = os.path.join(PERS, 'ni-council-geography.json')
_OVERLAP = json.load(open(GEOGRAPHY, encoding='utf-8'))['overlap'] if os.path.exists(GEOGRAPHY) else {}


def same_ground(before, after):
    """True when a council of the earlier career is a council of the later one or lies within it. Unknown
    councils (no localBody) are not evidence either way and pass."""
    before, after = {c for c in before if c}, {c for c in after if c}
    if not before or not after:
        return True
    return any(b == a or b in _OVERLAP.get(a, ()) for b in before for a in after)


def observations():
    # A row label-blanked-identity-keys.csv lists is held by the key it declares, which outranks
    # its ElectionsIreland or IrelandElection id (build_person_registry_v2.declared_identity): the
    # crosswalk must not pair the Mayo TD Ó Móráin with the Galway councillor through Castlebar rows
    # that still carry the councillor's IrelandElection id.
    from build_person_registry_v2 import declared_identity, label_blanked_identity_keys
    blanked = label_blanked_identity_keys()
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
                src = str(c.get('sourcePersonId') or '').strip()
                bk = (key, str(r.get('constituency') or ''), c.get('name') or '')
                if bk in blanked:
                    src = declared_identity(blanked[bk], '', src)[1]
                obs[pid].append({'key': key, 'body': body, 'con': con, 'council': str(r.get('localBody') or '').strip(),
                                 'y': int(yr) if yr.isdigit() else 0,
                                 'date': str(d.get('date') or ''),
                                 'party': party_of(c),
                                 'src': src,
                                 'off': list(c.get('officialPersonIds') or [])})
    return obs


def write_json_retrying(path, doc, attempts=40):
    """Write via a temporary file and swap it in, retrying briefly if Windows holds the target.

    Opening person_registry.json for writing straight after the previous step wrote it failed
    with "[Errno 22] Invalid argument" on most runs -- a scanner or sync client holding the
    new file -- and the shell wrapper then waited five seconds and re-ran the whole script.
    """
    import time
    tmp = f'{path}.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1)
    for attempt in range(attempts):
        try:
            os.replace(tmp, path)
            return
        except OSError:
            if attempt == attempts - 1:
                raise
            time.sleep(0.25)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()

    reg = json.load(open(REG, encoding='utf-8'))
    ents = {e['personId']: e for e in reg['entities']}
    obs = observations()
    confirmed = confirmed_pairs(ents)
    xwalk = crosswalk_pairs(obs)

    bykey = collections.defaultdict(list)
    for e in reg['entities']:
        if e.get('keyedBy') == 'registered':   # non-candidates are never merged by name
            continue
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
                            # The same party is not enough: the earlier council must be the later one or
                            # lie within it (Newry and Mourne's Brendan Curran is not Banbridge's).
                            early, late = (la, lb) if ea <= 2011 and sb >= 2014 else (lb, la)
                            ground = same_ground({x['council'] for x in early if x['y'] <= 2011}, {x['council'] for x in late if x['y'] >= 2014})
                            if pa & pb and ground:
                                cls = 'LGR-2014'
                            elif not ground:
                                skipped['LGR-2014 different council'] += 1
                            else:
                                skipped['LGR-2014 party mismatch'] += 1
                # --- The same seat, the same party, consecutive elections
                #
                # Two DERIVED ids under one name, standing for the SAME party in the SAME
                # constituency of the SAME body, with careers that do not overlap and a gap
                # of one to ten years. John Maginnis is 104503 in 1959 and 105598 in 1964,
                # same seat, same party: one man at consecutive elections, split because the
                # two rows reached the registry under different ids.
                #
                # The gaps corroborate it. Across the 850 pairs this matches they cluster on
                # 4 years (286) and 5 (118) -- election cycles -- which is the shape of one
                # career, not of two people who happen to share a name, a party and a seat.
                #
                # A same-named successor in the same seat is the way this could be wrong, so
                # anything carrying Jr, Snr or a numeral is excluded. None currently are.
                if cls is None and a > 100011 and b > 100011:
                    pa = {x['party'] for x in oa if x['party']}
                    pb = {x['party'] for x in ob if x['party']}
                    ca = {x['con'].upper() for x in oa if x['con']}
                    cb = {x['con'].upper() for x in ob if x['con']}
                    ba = {x['body'] for x in oa}
                    bb = {x['body'] for x in ob}
                    ya = (min(x['y'] for x in oa), max(x['y'] for x in oa))
                    yb = (min(x['y'] for x in ob), max(x['y'] for x in ob))
                    if ya[1] < yb[0] or yb[1] < ya[0]:
                        gap = yb[0] - ya[1] if ya[1] < yb[0] else ya[0] - yb[1]
                        named = f"{ents[a]['displayName']} {ents[b]['displayName']}"
                        # Two different Wikipedia articles are two men, whatever the seat:
                        # Thomas Knox, 2nd Earl of Ranfurly (Dungannon to 1837) and his son
                        # the 3rd (from 1838) were joined by this rule before it looked.
                        wa = {s for s in ents[a].get('sourcePersonIds') or [] if s.startswith('wikipedia:')}
                        wb = {s for s in ents[b].get('sourcePersonIds') or [] if s.startswith('wikipedia:')}
                        if wa and wb and wa.isdisjoint(wb):
                            skipped['SAME-SEAT-SEQUENCE: two Wikipedia articles'] += 1
                        elif (pa & pb and ca & cb and ba & bb and 0 < gap <= 10
                                and not SUCCESSOR_SUFFIX.search(named)):
                            cls = 'SAME-SEAT-SEQUENCE'


                # --- A single stray candidacy falling inside a curated career
                #
                # person_registry carries 2,388 CURATED ids below 100012, hand-verified,
                # and derives the rest. audit_person_ids flags 1,093 probable under-merges;
                # its own header calls that a screen rather than a proof, and most of them
                # are two derived ids where nothing says which way to go.
                #
                # This is the subset where something does. One side is curated. The other
                # is a derived id with EXACTLY ONE candidacy, under the same name, for the
                # same party, in a year inside that curated career or immediately beside
                # it. For those to be two people you would need two same-named candidates
                # in one party with overlapping careers, one of whom stood exactly once.
                #
                # A weaker bar than this is already accepted: LGR-2014 above merges on a
                # party match alone. Every merge is written to person_id_merges.csv, so a
                # wrong one is visible and reversible rather than silent.
                if cls is None:
                    lo_hi = [(min(x['y'] for x in o), max(x['y'] for x in o)) for o in (oa, ob)]
                    for cur, stray, (lo, hi) in ((a, b, lo_hi[0]), (b, a, lo_hi[1])):
                        if cur > 100011 or stray <= 100011:
                            continue
                        stray_obs = obs.get(stray, [])
                        if len(stray_obs) != 1:
                            continue
                        cur_obs = obs.get(cur, [])
                        parties = {x['party'] for x in cur_obs if x['party']}
                        year = stray_obs[0]['y']
                        party = stray_obs[0]['party']
                        if not (lo - 1 <= year <= hi + 1):
                            continue
                        # The party is the only thing besides the name, so it has to be one.
                        if party in NO_PARTY or party not in parties:
                            continue
                        # A man can stand twice in one election (Jack Beattie fought Belfast
                        # Central and Pottinger in 1953), but the source then files him once.
                        # ElectionsIreland filed Michael Kennedy 1 (Longford-Westmeath) and
                        # Michael Kennedy 2 (Tipperary) in June 1927, and Michael Pat Murphy
                        # (Cork South-West) and Michael Murphy 3 (Limerick West) in 1969,
                        # under ids of their own: two people each time.
                        mine = stray_obs[0]['src']
                        if mine and any(x['key'] == stray_obs[0]['key'] and x['src'] and x['src'] != mine
                                        for x in cur_obs):
                            skipped['STRAY-INTO-CURATED: another source id in the same election'] += 1
                            continue
                        cls = 'STRAY-INTO-CURATED'
                        break

                # --- Wikipedia-disambiguated title: the qualifier IS the mechanism
                #
                # A name like "Frederick Thompson (Northern Irish politician)" is a
                # Wikipedia article title, and a disambiguated title identifies exactly
                # one person by construction -- disambiguating is what the qualifier is
                # for. So two ids sharing a disambiguated title were matched to the same
                # article and are the same person. That is a mechanical cause, not a
                # judgement about who someone is, which is the bar this script sets.
                #
                # This is NOT a general same-name rule. A bare shared name proves
                # nothing, and the registry is right to keep those apart. The qualifier
                # is the whole evidence, so the test requires it.
                if cls is None and DISAMBIGUATED.search(ents[a].get('displayName') or '') \
                        and DISAMBIGUATED.search(ents[b].get('displayName') or ''):
                    cls = 'WIKI-DISAMBIGUATED'
                # --- One Wikipedia biography covers both halves
                #
                # person_id_confirmed_merges.csv lists pairs where a single Wikipedia article
                # about a person with this name says, in one sentence or one infobox office,
                # that they stood for or held a constituency of EACH id in one of that id's
                # years (Ian Paisley: Bannside 1969-70 at Stormont, North Antrim from 1970).
                # The article and both pieces of evidence are recorded with every pair.
                evidence = ''
                hit = confirmed.get(frozenset((a, b)))
                if hit:
                    evidence = f"{hit['article']}: {hit['evidence_keep']} / {hit['evidence_drop']}"
                    if cls is None:
                        cls = 'WIKIPEDIA-BIOGRAPHY'
                # --- One councillor under an IrelandElection.com id and an ElectionsIreland id
                #
                # ie-ei-crosswalk.csv (build_ie_ei_crosswalk.py): the same name, council and
                # electoral area at consecutive elections for the same party, or the council and
                # a constituency of its county within five years for the same party.
                xw = xwalk.get(frozenset((a, b)))
                if xw and cls is None:
                    cls = 'IE-EI-CROSSWALK'
                    evidence = f"{xw['ie']} = {xw['ei']}: {xw['ie_evidence']} / {xw['ei_evidence']}"
                if cls is None:
                    continue
                keep, drop = (a, b) if a < b else (b, a)
                merges.append({'class': cls, 'keep': keep, 'drop': drop,
                               'name': ents[keep]['displayName'],
                               'keep_years': f"{ents[keep].get('firstYear')}-{ents[keep].get('lastYear')}",
                               'drop_years': f"{ents[drop].get('firstYear')}-{ents[drop].get('lastYear')}",
                               'evidence': evidence})
                seen.add((a, b))
    # A confirmed pair whose names no longer share a match key is still one person.
    for pair, hit in confirmed.items():
        a, b = sorted(pair)
        if (a, b) in seen or a not in ents or b not in ents:
            continue
        merges.append({'class': 'WIKIPEDIA-BIOGRAPHY', 'keep': a, 'drop': b,
                       'name': ents[a]['displayName'],
                       'keep_years': f"{ents[a].get('firstYear')}-{ents[a].get('lastYear')}",
                       'drop_years': f"{ents[b].get('firstYear')}-{ents[b].get('lastYear')}",
                       'evidence': f"{hit['article']}: {hit['evidence_keep']} / {hit['evidence_drop']}"})
        seen.add((a, b))
    # So is a crosswalk pair, whatever its names (Davy and David Daniels).
    for pair, xw in xwalk.items():
        a, b = sorted(pair)
        if (a, b) in seen or a not in ents or b not in ents:
            continue
        merges.append({'class': 'IE-EI-CROSSWALK', 'keep': a, 'drop': b,
                       'name': ents[a]['displayName'],
                       'keep_years': f"{ents[a].get('firstYear')}-{ents[a].get('lastYear')}",
                       'drop_years': f"{ents[b].get('firstYear')}-{ents[b].get('lastYear')}",
                       'evidence': f"{xw['ie']} = {xw['ei']}: {xw['ie_evidence']} / {xw['ei_evidence']}"})
        seen.add((a, b))

    # Resolve chains so a->b->c collapses to one survivor: evidence first, and never into
    # one person two ids that ElectionsIreland's own pages tell apart. The test is made
    # against everything each side has been joined to so far, not pair by pair: the 1992
    # Dublin West Brian Lenihan carries no id of its own, so nothing in the pair stopped
    # SAME-SEAT-SEQUENCE joining it to Jnr after his father's biography had joined it to
    # Snr, and the two pairs together made father and son one man.
    people = ei_relatives.load()
    overrides = ei_relatives.load_overrides(CONFIRMED)
    held = collections.defaultdict(set)
    for pid, e in ents.items():
        held[pid] |= set(e.get('sourcePersonIds') or [])
    for pid, xs in obs.items():
        held[pid] |= {x['src'] for x in xs if x['src']}
        held[pid] |= {o for x in xs for o in x.get('off') or []}
    for pid, e in ents.items():
        held[pid] |= set(e.get('officialPersonIds') or [])

    crosswalk_path = os.path.join(REPO, 'data', 'elections', 'persons', 'official-person-crosswalk.json')
    _cw = json.load(open(crosswalk_path, encoding='utf-8')) if os.path.exists(crosswalk_path) else {}
    crosswalk, lifespans = _cw.get('ids', {}), _cw.get('people', {})
    years = collections.defaultdict(set)
    dates = collections.defaultdict(set)
    for pid, xs in obs.items():
        years[pid] |= {x['y'] for x in xs if x['y']}
        dates[pid] |= {x['date'] for x in xs if x.get('date')}
    life_book = person_lifespans.load()

    def life_conflict(ka, kb):
        # Nor is a man who was under 18, or dead, when the other side stood: the Larne council
        # seats Roy Beggs held from 1977 are not his son's, born 1962, though the son later sat
        # for the same area for the same party.
        for side, other in ((ka, kb), (kb, ka)):
            for q in {s[9:] for s in held[side] if s.startswith('wikidata:')}:
                life = lifespans.get(q) or {}
                born, died = str(life.get('born') or '')[:4], str(life.get('died') or '')[:4]
                bad = [y for y in years[other] if (born.isdigit() and y < int(born) + 18) or (died.isdigit() and y > int(died))]
                if bad:
                    return f'{life.get("name", q)} ({q}) could not have stood in {min(bad)}'
            # The life the person page shows (History of Parliament, Wikidata, a reference work;
            # person_lifespans.py), at its own precision: the same rule as check:person-lifespans.
            life = life_book.life(held[side], held[side], side)
            bad = sorted(d for d in dates[other] if life_book.outside(d, life, side))
            if bad:
                return f'person {side} (born {life.get("born") or "?"}, died {life.get("died") or "?"}, {life.get("source")}) could not have stood on {bad[0]}'
        return None

    def official_conflict(a, b):
        # Two ids of one official system (Oireachtas, NI Assembly, UK Parliament, Democracy
        # Club) are two people, whatever else the pair has in common; so are ids Wikidata
        # gives to two different people.
        for system in ('oireachtas', 'niassembly', 'ukparliament', 'democracyclub'):
            x = {s for s in a if s.startswith(system + ':')}
            y = {s for s in b if s.startswith(system + ':')}
            if x and y and x.isdisjoint(y):
                return f'different {system} ids ({", ".join(sorted(x | y))})'
        # Wikidata items held directly (official-person-ids.json system "wikidata") count too.
        qa = {crosswalk[s] for s in a if s in crosswalk} | {s[9:] for s in a if s.startswith('wikidata:')}
        qb = {crosswalk[s] for s in b if s in crosswalk} | {s[9:] for s in b if s.startswith('wikidata:')}
        if qa and qb and qa.isdisjoint(qb):
            return f'Wikidata names two people ({", ".join(sorted(qa | qb))})'
        return None
    order = {c: i for i, c in enumerate(('WIKIPEDIA-BIOGRAPHY', 'IE-EI-CROSSWALK', 'WIKI-DISAMBIGUATED', 'FORUM-DUPLICATE',
                                         'LGR-2014', 'SAME-SEAT-SEQUENCE', 'STRAY-INTO-CURATED'))}
    parent = {}
    def find(x):
        while parent.get(x, x) != x:
            x = parent[x]
        return x
    applied, vetoed, unchecked = [], [], set()
    for mg in sorted(merges, key=lambda m: (order.get(m['class'], len(order)), m['keep'], m['drop'])):
        ka, kb = find(mg['keep']), find(mg['drop'])
        if ka != kb:
            # A confirmed pair declared one man over these vetoes (override_vetoes; John Beirne)
            # is joined over them, and only that pair (ei_relatives.load_overrides).
            official = None if ei_relatives.overridden(overrides, 'official-ids', held[ka], held[kb])                 else official_conflict(held[ka], held[kb])
            why = ei_relatives.distinct(people, held[ka], held[kb], overrides) or official or life_conflict(ka, kb)
            if why:
                vetoed.append((mg, why))
                continue
            ours = {s for s in held[ka] if s.startswith('ei:')}
            theirs = {s for s in held[kb] if s.startswith('ei:')}
            if ours and theirs and ours.isdisjoint(theirs):
                unchecked |= {s for s in ours | theirs if s not in people}
            lo, hi = min(ka, kb), max(ka, kb)
            parent[hi] = lo
            held[lo] |= held.pop(hi, set())
            years[lo] |= years.pop(hi, set())
            dates[lo] |= dates.pop(hi, set())
        applied.append(mg)
    merges = applied
    final = {d: find(d) for d in parent}
    # Two people joined through a third: one group merged into both (Tracy McElhinney's 2024 row
    # into her 2009-16 id 110892 and her 2014-19 id 129522) makes one of the two a drop too, but no
    # pair names it as one. The log is what makes a merged-away id answer with its survivor, so
    # each such id gets its own row, with the class of the pair that joined it.
    named_drops = {m['drop'] for m in merges}
    for m in list(merges):
        for side in (m['keep'], m['drop']):
            if side not in named_drops and final.get(side, side) != side:
                named_drops.add(side)
                merges.append({**m, 'keep': final[side], 'drop': side, 'keep_years': '',
                               'drop_years': m['keep_years'] if side == m['keep'] else m['drop_years'],
                               'evidence': f"joined to {final[side]} through {m['drop'] if side == m['keep'] else m['keep']}"
                               + (f"; {m['evidence']}" if m.get('evidence') else '')})

    print(f"merge pairs found: {len(merges):,}")
    for c, n in collections.Counter(m['class'] for m in merges).most_common():
        print(f"    {n:5}  {c}")
    for k, n in skipped.items():
        print(f"    {n:5}  SKIPPED: {k}")
    for mg, why in vetoed:
        print(f"        VETOED {mg['class']} {mg['keep']}+{mg['drop']} {mg['name']}: {why}")
    if unchecked:
        print(f"  {len(unchecked)} ElectionsIreland ids were joined to another without their pages on file:\n"
              f"    python scripts/ingest/electionsireland/harvest_ei_candidate_ids.py --relatives "
              + ' '.join(s.split(':')[1] for s in sorted(unchecked, key=lambda s: int(s.split(':')[1]))))
    print(f"  distinct ids to retire: {len(final):,}")
    if args.check:
        print("\n--check: nothing written")
        return
    if not merges:
        # The loop has converged. Writing now would replace the last pass's merge log with
        # an empty one, and there is no header to write it with.
        print("\n  nothing to merge: registry and merge log left as they are")
        return

    for drop, keep in final.items():
        if drop == keep:
            continue
        de, ke = ents.get(drop), ents.get(keep)
        if not de or not ke:
            continue
        # Rows with no usable id (most 1918-1922 Dail rows) reach a person only by name,
        # through the one name-keyed entity of that name with no source id. Joined to a
        # sourced career, the entity gains a source id and would stop answering to the
        # name: nameKeyedRows keeps it answering (apply_person_ids_v2.py), and keeps the
        # join when the registry is rebuilt (build_person_registry_v2.py).
        named = set(ke.get('nameKeyedRows') or []) | set(de.get('nameKeyedRows') or [])
        for e in (ke, de):
            if e.get('keyedBy') == 'name':
                named |= set(e['matchKeys'])
        if named:
            ke['nameKeyedRows'] = sorted(named)
        ke['aliases'] = sorted(set(ke['aliases']) | set(de['aliases']), key=lambda s: (-len(s), s))
        ke['matchKeys'] = sorted(set(ke['matchKeys']) | set(de['matchKeys']))
        ke['sourceIds'] = sorted(set(ke['sourceIds']) | set(de['sourceIds']))
        # The source's own person ids (ElectionsIreland, Wikipedia) are what
        # apply_person_ids_v2.py resolves first: a candidacy carrying the dropped id's
        # "ei:" id would otherwise match no entity and lose its personId.
        ke['sourcePersonIds'] = sorted(set(ke.get('sourcePersonIds') or []) | set(de.get('sourcePersonIds') or []))
        ke['officialPersonIds'] = sorted(set(ke.get('officialPersonIds') or []) | set(de.get('officialPersonIds') or []))
        for f in ('bodies', 'parties'):
            if ke.get(f) is not None or de.get(f) is not None:
                ke[f] = sorted(set(ke.get(f) or []) | set(de.get(f) or []))
        if de.get('nameVariants'):
            ke['nameVariants'] = True
        ke['contests'] = (ke.get('contests') or 0) + (de.get('contests') or 0)
        ke['candidacies'] = ke['candidacies'] + de['candidacies']
        for f, fn in (('firstYear', min), ('lastYear', max)):
            vs = [x for x in (ke.get(f), de.get(f)) if x]
            if vs:
                ke[f] = fn(vs)
        ke['mergedFrom'] = sorted(set(ke.get('mergedFrom', []) + [drop]))
        ents.pop(drop, None)
    # A survivor keeps the name its page shows (display-names.csv), whichever side it came from.
    chosen_names = display_names.load()
    for e in ents.values():
        display_names.apply(e, chosen_names)
    reg['entities'] = sorted(ents.values(), key=lambda e: e['personId'])
    reg.setdefault('corrections', {})['mergedIds'] = len(final)
    reg['corrections']['classes'] = dict(collections.Counter(m['class'] for m in merges))
    reg['corrections']['note'] = ('Only the two mechanically-caused classes were merged; '
                                  'see scripts/ingest/persons/merge_person_ids.py for the tests applied.')
    write_json_retrying(REG, reg)
    merges += crosswalk_redirects(xwalk, merges, final, ents)
    if os.path.exists(LOG):
        with open(LOG, encoding='utf-8', newline='') as fh:
            merges += carried_rows(list(csv.DictReader(fh)), merges, ents)
    with open(LOG, 'w', encoding='utf-8', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=list(merges[0].keys()))
        w.writeheader(); w.writerows(merges)
    print(f"\n  entities {len(reg['entities']):,} (was {len(reg['entities']) + len(final):,})")
    print(f"  wrote {REG}\n  wrote {LOG}")
    print("  NEXT: python scripts/ingest/persons/apply_person_ids_v2.py && node scripts/build/build-browse-indexes.mjs")


if __name__ == '__main__':
    main()
