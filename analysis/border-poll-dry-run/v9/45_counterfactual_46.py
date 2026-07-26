#!/usr/bin/env python3
"""v9 phase 45 — counterfactual: which 2022 Assembly seats were closest to giving
SF + SDLP + PBP + Aontu a 46/90 majority?

Actual 2022 result for that bloc: Sinn Fein 27, SDLP 8, PBP 1, Aontu 0 = 36 seats.
A 46/90 majority therefore needs TEN more seats, taken from unionist (DUP, UUP, TUV,
PUP, Independent Unionist) or non-aligned (Alliance, Green) winners.

Method. For every constituency, for every pairing of

    a NON-bloc candidate who WON a seat   (the donor)
    a BLOC candidate who did NOT win      (the challenger)

binary-search the smallest transfer of first-preference votes from donor to
challenger that flips the seat when the full PR-STV count is re-run. The cheapest
such flip per constituency is that seat's "distance" from the bloc. Ranking those
distances across all 18 constituencies gives the ten most reachable seats.

The swing is expressed as a share of the constituency's valid poll, which is the
natural unit: "the bloc needed X% of the electorate to switch".

Engine caveat, stated plainly. The count engine reproduces the real 2022 elected set
in most but not all constituencies (94.4% seat accuracy on replay). Any constituency
whose baseline the engine cannot reproduce is FLAGGED and excluded from the ranking,
because a counterfactual built on a wrong baseline is meaningless.
"""
import os, sys, json, collections, importlib.util
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, os.path.join(HERE, path))
    m = importlib.util.module_from_spec(spec)
    sys.modules[mod] = m
    spec.loader.exec_module(m)
    return m


stv = _load('stv19', '19_stv_simulator.py')

BLOC = {'Sinn Féin', 'SDLP', 'PBP', 'Aontú'}
UNIONIST = {'DUP', 'UUP', 'TUV', 'PUP', 'Independent Unionist'}
NONALIGNED = {'Alliance', 'Green'}
FILE = 'northern-ireland-assembly__2022-05-05.json'


def flips_needed(cd, donor_i, chall_i, tol=1e-5):
    """Smallest share of the valid poll moved donor -> challenger that elects them.

    The search ceiling is the DONOR'S OWN first-preference vote -- you cannot move
    more votes off a candidate than they received. An earlier version used a flat
    0.35 of the valid poll as the ceiling, which exceeds any individual candidate's
    vote, so the cap check rejected every pairing and no flip was ever found.
    """
    base = np.asarray(cd['fp'], dtype=float)
    total = cd['valid']
    lo, hi = 0.0, base[donor_i] / total

    def wins(x):
        fp = base.copy()
        move = min(x * total, base[donor_i])
        fp[donor_i] -= move
        fp[chall_i] += move
        el, _, _ = stv.run_stv(cd['names'], cd['parties'], fp, cd['seats'], total)
        return chall_i in el
    if not wins(hi):
        return None
    while hi - lo > tol:
        mid = (lo + hi) / 2
        if wins(mid):
            hi = mid
        else:
            lo = mid
    return hi


def main():
    contests = stv.load_contest('assembly', 2022, FILE)
    print("=" * 78)
    print("COUNTERFACTUAL — the ten seats closest to an SF/SDLP/PBP/Aontu 46-seat majority")

    actual_bloc = 0
    for cd in contests:
        actual_bloc += sum(1 for i in cd['actual'] if cd['parties'][i] in BLOC)
    print(f"\n  actual bloc seats in 2022: {actual_bloc} of 90  -> needs "
          f"{46 - actual_bloc} more for 46")

    rows, skipped = [], []
    for cd in contests:
        # baseline check: does the engine reproduce the real elected set here?
        el, quota, _ = stv.run_stv(cd['names'], cd['parties'], cd['fp'],
                                   cd['seats'], cd['valid'])
        if set(el) != cd['actual']:
            skipped.append(cd['area'])
            continue
        donors = [i for i in cd['actual']
                  if cd['parties'][i] in UNIONIST | NONALIGNED]
        challengers = [i for i in range(len(cd['names']))
                       if i not in cd['actual'] and cd['parties'][i] in BLOC]
        best = None
        for d in donors:
            for c in challengers:
                x = flips_needed(cd, d, c)
                if x is None:
                    continue
                if best is None or x < best[0]:
                    best = (x, d, c)
        if best is None:
            continue
        x, d, c = best
        rows.append({'area': cd['area'], 'swing_pct': 100 * x,
                     'votes': x * cd['valid'],
                     'donor': f"{cd['names'][d]} ({cd['parties'][d]})",
                     'gains': f"{cd['names'][c]} ({cd['parties'][c]})",
                     'donor_party': cd['parties'][d], 'gain_party': cd['parties'][c],
                     'quota': quota, 'valid': cd['valid']})

    if skipped:
        print(f"\n  ! engine could not reproduce the actual result in "
              f"{len(skipped)} constituencies, excluded: {skipped}")

    df = pd.DataFrame(rows).sort_values('swing_pct').reset_index(drop=True)
    df.to_csv(os.path.join(HERE, 'counterfactual_46.csv'), index=False)

    print(f"\n  constituencies with a reachable bloc gain: {len(df)}")
    print(f"\n  {'#':>2}  {'constituency':26} {'swing':>7} {'votes':>7}  "
          f"{'seat taken from':34} {'won by'}")
    for i, r in df.iterrows():
        mark = '*' if i < (46 - actual_bloc) else ' '
        print(f"  {i+1:2}{mark} {r.area:26} {r.swing_pct:6.2f}% {r.votes:7.0f}  "
              f"{r.donor:34} {r.gains}")

    need = 46 - actual_bloc
    top = df.head(need)
    if len(top) >= need:
        print(f"\n  THE TEN CHEAPEST (marked *) deliver {actual_bloc + need} seats.")
        print(f"    largest swing required : {top.swing_pct.max():.2f}% "
              f"(in {top.iloc[-1].area})")
        print(f"    total votes to move    : {top.votes.sum():,.0f} across "
              f"{need} constituencies")
        print(f"    seats taken from       : "
              + ", ".join(f"{k} {v}" for k, v in
                          collections.Counter(top.donor_party).most_common()))
        print(f"    seats gained by        : "
              + ", ".join(f"{k} {v}" for k, v in
                          collections.Counter(top.gain_party).most_common()))
    else:
        print(f"\n  Only {len(df)} reachable gains found -- fewer than the {need} "
              f"needed. A 46-seat majority was NOT reachable by vote transfer alone.")


if __name__ == '__main__':
    main()
