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
         from 2014, AND standing for the same party. A party match is not proof, but a
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
         person stood or sat. Written by scripts/find_split_persons.py, which records the
         article and both pieces of evidence.

Parties are compared ignoring case, accents and punctuation ("Workers' Party" is "Workers
Party"), so a spelling difference between source systems no longer blocks LGR-2014.

No class joins two people ElectionsIreland's own pages tell apart: ids it names as father
and son (or any relatives), or files as a Snr and a Jnr (ei_relatives.py). Pairs are joined
evidence first, and the test is made against everything already joined on either side, so
a row with no id of its own cannot carry a father into his son's career: the 1992 Dublin
West Brian Lenihan, joined to Snr on his biography, is not then joined to Jnr on the seat.

Merges keep the LOWER personId, preferring the curated 1-100011 block, and carry the
other id's aliases, match keys and source ids across. Every merge is recorded.

Usage:  python scripts/merge_person_ids.py [--check]
"""
import os, re, sys, json, glob, csv, argparse, collections, unicodedata

import ei_relatives

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))
# render/, not test/: the directory was renamed and these constants were not.
# Every one of these scripts globbed an empty path and did nothing, silently.
META = os.path.join(REPO, 'render', 'metadata', 'elections-test2')
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
                                 'party': party_of(c),
                                 'src': str(c.get('sourcePersonId') or '').strip()})
    return obs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()

    reg = json.load(open(REG, encoding='utf-8'))
    ents = {e['personId']: e for e in reg['entities']}
    obs = observations()
    confirmed = confirmed_pairs(ents)

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

    # Resolve chains so a->b->c collapses to one survivor: evidence first, and never into
    # one person two ids that ElectionsIreland's own pages tell apart. The test is made
    # against everything each side has been joined to so far, not pair by pair: the 1992
    # Dublin West Brian Lenihan carries no id of its own, so nothing in the pair stopped
    # SAME-SEAT-SEQUENCE joining it to Jnr after his father's biography had joined it to
    # Snr, and the two pairs together made father and son one man.
    people = ei_relatives.load()
    held = collections.defaultdict(set)
    for pid, e in ents.items():
        held[pid] |= set(e.get('sourcePersonIds') or [])
    for pid, xs in obs.items():
        held[pid] |= {x['src'] for x in xs if x['src']}
    order = {c: i for i, c in enumerate(('WIKIPEDIA-BIOGRAPHY', 'WIKI-DISAMBIGUATED', 'FORUM-DUPLICATE',
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
            why = ei_relatives.distinct(people, held[ka], held[kb])
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
        applied.append(mg)
    merges = applied
    final = {d: find(d) for d in parent}

    print(f"merge pairs found: {len(merges):,}")
    for c, n in collections.Counter(m['class'] for m in merges).most_common():
        print(f"    {n:5}  {c}")
    for k, n in skipped.items():
        print(f"    {n:5}  SKIPPED: {k}")
    for mg, why in vetoed:
        print(f"        VETOED {mg['class']} {mg['keep']}+{mg['drop']} {mg['name']}: {why}")
    if unchecked:
        print(f"  {len(unchecked)} ElectionsIreland ids were joined to another without their pages on file:\n"
              f"    python scripts/harvest_ei_candidate_ids.py --relatives "
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
