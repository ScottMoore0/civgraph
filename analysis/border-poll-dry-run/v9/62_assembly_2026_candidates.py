#!/usr/bin/env python3
"""v9 phase 62 — the 2026 Assembly projection rebuilt with REAL candidates.

Supersedes phase 60's candidate handling. Phase 60 invented anonymous placeholders
("DUP 1", "DUP 2") from quota arithmetic and split each party's vote EQUALLY between
them. That discarded the two things that decide marginal seats under STV: who is
actually standing, and the personal vote an incumbent carries.

WHAT CHANGES

1. A real roster. The 90 MLAs elected in 2022, with the 13 co-options applied and the
   six 2027 retirements removed, mapped onto 2023 boundaries (BELFAST SOUTH ->
   BELFAST SOUTH AND MID DOWN is the only rename).

2. Incumbency, estimated rather than assumed. Across the 47 party slates in 2017 and
   2022 that ran BOTH a sitting MLA and a newcomer, the incumbent took 1.214x an equal
   split and the newcomer 0.788x -- an incumbent polls about 1.54x a running mate. Those
   weights are applied here. This is only measurable because phase 62's person registry
   put a stable personId on every candidacy; before that, matching a 2017 candidate to a
   2022 one was name-guessing.

3. A party runs at least its own incumbents. The quota rule sets the slate size, but a
   party with three sitting MLAs does not nominate two.

4. Doug Beattie stands as an Independent Unionist in Upper Bann, per instruction. He
   took 5,199 of the UUP's 8,566 first preferences there in 2022 -- 60.7% of the party's
   vote -- so that fraction of the projected UUP share in Upper Bann moves with him.
   A sitting MLA leaving a party takes a personal vote, not nothing and not everything.

WHAT STILL IS NOT MODELLED. Newcomers are still anonymous, so a high-profile new
candidate is indistinguishable from a paper one. Vote management within a party (parties
steering supporters between running mates geographically) is not represented. And the
retirement of an incumbent is modelled only as the loss of the premium -- the seat is not
otherwise penalised, though in reality an open seat is more volatile than that implies.
"""
import os, sys, json, importlib.util, collections
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
META = os.path.join(REPO, 'test', 'metadata', 'elections-test2')
SEATS = 5
INC_W, NEW_W = 1.214, 0.788        # measured over 47 mixed slates, 2017 + 2022
RENAME = {'BELFAST SOUTH': 'BELFAST SOUTH AND MID DOWN'}


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, os.path.join(HERE, path))
    m = importlib.util.module_from_spec(spec)
    sys.modules[mod] = m
    spec.loader.exec_module(m)
    return m


p60 = _load('p60', '60_assembly_2026_projection.py')
stv = _load('stv19', '19_stv_simulator.py')
pm = sys.modules['pm17']
PARTIES = pm.PARTIES


def roster():
    """Who is actually standing: 2022 winners + co-options - retirements."""
    d = json.load(open(os.path.join(META, 'northern-ireland-assembly__2022-05-05.json'),
                       encoding='utf-8'))
    mem = []
    for r in d['results']:
        con = str(r['constituency']).upper().strip()
        con = RENAME.get(con, con)
        for c in (r.get('candidates') or []):
            if c.get('elected'):
                mem.append({'name': (c.get('name') or '').strip(),
                            'party': (c.get('party') or '').strip(), 'con': con})
    m = json.load(open(os.path.join(HERE, 'assembly7_membership.json'), encoding='utf-8'))
    for co in m['coOptions']:
        con = RENAME.get(co['constituency'], co['constituency'])
        hit = next((x for x in mem if x['name'] == co['departed'] and x['con'] == con), None)
        if hit is None:
            print(f"    WARNING co-option unmatched: {co['departed']} ({con})")
            continue
        hit['name'] = co['coOptee']
        hit['party'] = co.get('coOpteeParty', hit['party'])
    gone = {(r['member'], RENAME.get(r['constituency'], r['constituency']))
            for r in m['notSeekingReElection2027']}
    kept, dropped = [], []
    for x in mem:
        (dropped if (x['name'], x['con']) in gone else kept).append(x)
    # Beattie now sits, and stands, as an independent unionist
    for x in kept:
        if x['name'] == 'Doug Beattie':
            x['party'] = 'Independent'
            x['beattie'] = True
    norm = {'Independent Unionist': 'Independent', 'Independent Nationalist': 'Independent'}
    for x in kept:
        x['party'] = norm.get(x['party'], x['party'])
    return kept, dropped


def main():
    print("=" * 92)
    print("PHASE 62 — 2026 Assembly projection with real candidates and measured incumbency")
    inc, dropped = roster()
    print(f"\n  roster: {len(inc)} incumbents standing, {len(dropped)} retiring")
    for x in dropped:
        print(f"     retiring  {x['name']:20} {x['party']:10} {x['con']}")

    poll, eff, corrected, n_asm = p60.ni_wide()
    shares, base, swing, w = p60.constituency_shares(corrected)
    lv, el = p60.assembly_levels(), p60.electorates()
    t_ratio = lv['a_turnout'] / lv['w_turnout']
    s_ratio = lv['a_spoiled'] / lv['w_spoiled']

    by_con = collections.defaultdict(lambda: collections.defaultdict(list))
    for x in inc:
        by_con[x['con']][x['party']].append(x)

    rows, cand_rows, seat_tot = [], [], collections.Counter()
    for area in shares.index:
        e = el[area]
        turnout = e['w_turnout'] * t_ratio
        total_poll = e['electorate'] * turnout / 100.0
        sp_pct = e['w_spoiled_pct'] * s_ratio
        spoiled = total_poll * sp_pct / 100.0
        valid = total_poll - spoiled
        sh = {p: float(shares.loc[area, p]) for p in PARTIES}

        # Beattie carries 60.7% of the UUP's Upper Bann vote with him
        if any(x.get('beattie') for x in by_con[area].get('Independent', [])):
            move = sh['UUP'] * 0.607
            sh['UUP'] -= move
            sh['Independent'] += move

        names, parties, fps = [], [], []
        for p in PARTIES:
            incs = by_con[area].get(p, [])
            k = max(p60.nominations(sh[p], SEATS), len(incs))
            if k == 0:
                continue
            wts = [INC_W] * len(incs) + [NEW_W] * (k - len(incs))
            tot_w = sum(wts) or 1.0
            for j in range(k):
                nm = incs[j]['name'] if j < len(incs) else f'{p} newcomer {j - len(incs) + 1}'
                v = valid * sh[p] / 100.0 * wts[j] / tot_w
                names.append(nm); parties.append(p); fps.append(v)
        elected, quota, _ = stv.run_stv(names, parties, fps, SEATS, valid=valid)
        won = collections.Counter(parties[i] for i in elected)
        for p, c in won.items():
            seat_tot[p] += c
        for i, nm in enumerate(names):
            cand_rows.append({'constituency': area, 'candidate': nm, 'party': parties[i],
                              'incumbent': nm in {x['name'] for x in inc},
                              'first_prefs': int(round(fps[i])),
                              'pct': round(100 * fps[i] / valid, 2),
                              'elected': i in elected})
        rows.append({'constituency': area, 'electorate': int(round(e['electorate'])),
                     'turnout_pct': round(turnout, 2), 'total_poll': int(round(total_poll)),
                     'spoiled': int(round(spoiled)), 'valid_poll': int(round(valid)),
                     'candidates': len(names), 'seats': SEATS, 'quota': int(quota),
                     **{f'fp_{p}': int(round(valid * sh[p] / 100.0)) for p in PARTIES},
                     **{f'pct_{p}': round(sh[p], 2) for p in PARTIES},
                     **{f'seats_{p}': won.get(p, 0) for p in PARTIES}})

    df = pd.DataFrame(rows).set_index('constituency')
    df.to_csv(os.path.join(HERE, 'assembly2026_projection.csv'))
    cd = pd.DataFrame(cand_rows)
    cd.to_csv(os.path.join(HERE, 'assembly2026_candidates.csv'), index=False)

    tot_v = df.valid_poll.sum()
    print(f"\n  {'constituency':28} {'valid':>8} {'cands':>6}  seats")
    for a, r in df.iterrows():
        s = ' '.join(f"{p[:3]}{r[f'seats_{p}']}" for p in PARTIES if r[f'seats_{p}'])
        print(f"  {a[:28]:28} {r.valid_poll:8,} {r.candidates:6}  {s}")
    print(f"\n  {'party':12} {'first prefs':>12} {'share':>7} {'seats':>6}")
    for p in PARTIES:
        fp = df[f'fp_{p}'].sum()
        if fp or seat_tot[p]:
            print(f"    {p:12} {fp:12,} {100*fp/tot_v:6.1f}% {seat_tot[p]:6}")
    print(f"    {'TOTAL':12} {tot_v:12,} {100:6.1f}% {sum(seat_tot.values()):6}")
    ie = cd[cd.incumbent & cd.elected].shape[0]
    it = cd[cd.incumbent].shape[0]
    print(f"\n  incumbents standing {it}, re-elected {ie} ({100*ie/it:.0f}%)")
    print(f"  wrote assembly2026_projection.csv, assembly2026_candidates.csv")


if __name__ == '__main__':
    main()
