#!/usr/bin/env python3
"""v9 phase 48 — directional softness, and the softness-weighted 46-seat ranking.

Phase 45 ranked the 2022 Assembly seats by the raw VOTES needed to flip them. That
treats every vote as equally movable, which is exactly the assumption the question
rejects: a voter on a knife-edge between DUP and TUV is soft in one direction and
completely hard against Sinn Fein. Softness is directional, not scalar.

The directional measure is observable. LucidTalk's Assembly voting-intention question
is crossed by PastVote, giving P(current VI = Y | 2022 vote = X) directly -- including
`Non-Voters at the 2022 NIA election`, so both abstention channels are covered. Counts
are pooled across the cached poll series for sample size.

The re-ranking metric. If a seat needs V votes moved from donor D to challenger C, and
only a fraction p of D's voters ever move to C, then roughly V/p of D's voters must be
reached to yield them. That "voters to reach" figure is the honest cost, and it is
what separates a numerically cheap but directionally implausible flip (DUP -> SDLP)
from a cheap and plausible one (Alliance -> SDLP).

The five constituencies phase 45 excluded are handled explicitly rather than dropped:
the engine need not reproduce the whole elected set, only the LOCAL contest that
decides the marginal seat -- donor elected and challenger not, at zero swing. Where
that weaker condition holds the swing estimate is usable and is reported with a
confidence flag.
"""
import os, sys, csv, io, glob, json, collections, importlib.util
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '_lt_cache')


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, os.path.join(HERE, path))
    m = importlib.util.module_from_spec(spec)
    sys.modules[mod] = m
    spec.loader.exec_module(m)
    return m


stv = _load('stv19', '19_stv_simulator.py')
c45 = _load('c45', '45_counterfactual_46.py')

PAST2P = {'DUP': 'DUP', 'Sinn Fein': 'Sinn Féin', 'UUP': 'UUP', 'SDLP': 'SDLP',
          'Alliance': 'Alliance', 'TUV': 'TUV', 'Green': 'Green', 'PBP': 'PBP',
          'Aontu': 'Aontú', 'Non-Voters at the 2022 NIA election': 'DidNotVote'}
ADMIN = ("don't know", "dont know", "not sure", "wouldn't vote", "wouldnt vote",
         "would not vote", "will not vote", "undecided", "refused", "none")


def canon_resp(s):
    r = (s or '').lower().strip()
    if r == 'sf' or 'sinn f' in r:
        return 'Sinn Féin'
    for k, v in [('dup', 'DUP'), ('uup', 'UUP'), ('sdlp', 'SDLP'),
                 ('alliance', 'Alliance'), ('tuv', 'TUV'), ('green', 'Green'),
                 ('people before profit', 'PBP'), ('pbp', 'PBP'), ('aont', 'Aontú')]:
        if r.startswith(k) or k in r:
            return v
    if any(a in r for a in ADMIN):
        return 'DidNotVote'
    return 'Other'


def switching_matrix():
    """Pooled P(current VI | 2022 vote) from the cached LucidTalk series."""
    num = collections.defaultdict(float)
    for f in sorted(glob.glob(os.path.join(CACHE, '*.csv'))):
        rows = list(csv.DictReader(io.StringIO(open(f, encoding='utf-8').read())))
        meas = [m for m in {x['Measure'] for x in rows}
                if 'held tomorrow' in m.lower() and 'assembly' in m.lower()]
        if not meas:
            continue
        m = sorted(meas, key=len)[0]
        for x in rows:
            if (x['Measure'] != m or x['Breakdown Dimension'] != 'PastVote'
                    or x['Statistic'] != 'count'):
                continue
            src = PAST2P.get((x['Breakdown Category'] or '').strip())
            if not src:
                continue
            dst = canon_resp(x.get('Response Label') or x.get('Response'))
            try:
                num[(src, dst)] += float(x['Value'])
            except (TypeError, ValueError):
                continue
    srcs = sorted({s for s, _ in num})
    M = {}
    for s in srcs:
        tot = sum(v for (ss, _), v in num.items() if ss == s)
        if tot > 0:
            M[s] = {d: v / tot for (ss, d), v in num.items() if ss == s and v > 0}
    return M, num


def main():
    print("=" * 78)
    print("DIRECTIONAL SOFTNESS — P(current VI | 2022 vote), pooled LucidTalk series")
    M, raw = switching_matrix()
    order = ['DUP', 'UUP', 'TUV', 'Alliance', 'Green', 'SDLP', 'Sinn Féin',
             'PBP', 'Aontú', 'DidNotVote']
    cols = ['Sinn Féin', 'SDLP', 'PBP', 'Aontú', 'Alliance', 'DUP', 'UUP',
            'TUV', 'DidNotVote']
    print(f"\n  {'from \\\\ to':12}" + ''.join(f"{c[:9]:>10}" for c in cols))
    for s in order:
        if s not in M:
            continue
        print(f"  {s:12}" + ''.join(f"{100*M[s].get(c,0):9.1f}%" for c in cols))
    BLOC = ['Sinn Féin', 'SDLP', 'PBP', 'Aontú']
    print(f"\n  {'from':14} {'-> pro-unity bloc':>18} {'-> did not vote':>17}   n")
    for s in order:
        if s not in M:
            continue
        tot = sum(v for (ss, _), v in raw.items() if ss == s)
        print(f"  {s:14} {100*sum(M[s].get(b,0) for b in BLOC):17.1f}% "
              f"{100*M[s].get('DidNotVote',0):16.1f}%   {tot:.0f}")
    # encoding= is NOT optional here: the party names contain non-ASCII
    # ("Sinn Fein", "Aontu") and the platform default is cp1252 on Windows. The
    # same omission broke 6_ and 8_ earlier in this workstream.
    json.dump({k: v for k, v in M.items()},
              open(os.path.join(HERE, 'switching_matrix.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)

    # ---------------- softness-weighted seat ranking ----------------
    print("\n" + "=" * 78)
    print("SOFTNESS-WEIGHTED RANKING of the 2022 seats")
    contests = stv.load_contest('assembly', 2022, c45.FILE)
    rows = []
    for cd in contests:
        el, quota, _ = stv.run_stv(cd['names'], cd['parties'], cd['fp'],
                                   cd['seats'], cd['valid'])
        exact = set(el) == cd['actual']
        donors = [i for i in cd['actual']
                  if cd['parties'][i] in c45.UNIONIST | c45.NONALIGNED]
        chall = [i for i in range(len(cd['names']))
                 if i not in cd['actual'] and cd['parties'][i] in c45.BLOC]
        best = None
        for d in donors:
            # weaker sufficient condition than full-set reproduction: at zero swing
            # the donor must be elected and the challenger not, in the SIMULATION
            if d not in el:
                continue
            for c in chall:
                if c in el:
                    continue
                x = c45.flips_needed(cd, d, c)
                if x is None:
                    continue
                dp, cp = cd['parties'][d], cd['parties'][c]
                p = M.get(dp, {}).get(cp, 0.0)
                votes = x * cd['valid']
                reach = votes / p if p > 0 else np.inf
                if best is None or reach < best[0]:
                    best = (reach, votes, x, d, c, p)
        if best is None:
            continue
        reach, votes, x, d, c, p = best
        rows.append({'area': cd['area'], 'votes': votes, 'swing_pct': 100 * x,
                     'p_switch': 100 * p, 'voters_to_reach': reach,
                     'donor': f"{cd['names'][d]} ({cd['parties'][d]})",
                     'gains': f"{cd['names'][c]} ({cd['parties'][c]})",
                     'donor_party': cd['parties'][d], 'gain_party': cd['parties'][c],
                     'exact_baseline': exact})
    df = pd.DataFrame(rows)
    df['rank_votes'] = df.votes.rank().astype(int)
    df = df.sort_values('voters_to_reach').reset_index(drop=True)
    df.to_csv(os.path.join(HERE, 'softness_ranked_seats.csv'), index=False)

    print(f"\n  {'#':>2} {'constituency':26} {'votes':>7} {'p(sw)':>6} "
          f"{'reach':>9} {'was':>4}  transition")
    for i, r in df.iterrows():
        flag = '' if r.exact_baseline else ' ~'
        print(f"  {i+1:2} {r.area:26} {r.votes:7.0f} {r.p_switch:5.1f}% "
              f"{r.voters_to_reach:9.0f} {r.rank_votes:4}{flag}  "
              f"{r.donor_party} -> {r.gain_party}")
    print("\n  ~ = engine did not reproduce the full elected set; the marginal-seat")
    print("      condition held, so the estimate is usable but lower confidence")
    top = df.head(10)
    print(f"\n  TOP TEN by voters-to-reach: {top.voters_to_reach.sum():,.0f} voters")
    print(f"    taken from: " + ", ".join(f"{k} {v}" for k, v in
                                          collections.Counter(top.donor_party).most_common()))
    moved = set(df.head(10).area) ^ set(df.nsmallest(10, 'votes').area)
    print(f"    seats that ENTER or LEAVE the top ten vs the raw-votes ranking: "
          f"{sorted(moved) if moved else 'none'}")


if __name__ == '__main__':
    main()
