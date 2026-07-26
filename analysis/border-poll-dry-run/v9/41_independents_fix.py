#!/usr/bin/env python3
"""v9 phase 41 — fix independents in the structural pipeline.

The gap: the pipeline projects ~13 of 62 actual independent seats across the STV
contests. The seat-persistence signal in phase 40 got 62 of 62 NI-wide. A ~5x
under-projection with a known cause.

Why the census cannot do it: census features describe the ELECTORATE; an
independent's vote is a property of the CANDIDATE. But `personId` is stable across
contests, so a candidate's own history is recoverable -- and phase 34 established
two things that shape this fix:

  * incumbency beats defection: a sitting independent averages 12.25% where a fresh
    party defector averages 6.77%
  * the SIMPLE estimator wins: prior_share used directly (MAE 4.27, r=0.520) beats a
    GBM on the full feature set (4.38, r=0.370), which overfits on 289 rows

So this uses prior share and incumbency, not a learned model, and concentrates the
vote at CANDIDATE level. Concentration is the point: aggregating to an area total and
letting the count split it evenly across independents destroys exactly the mass that
wins a quota. One strong independent elects; three weak ones do not.
"""
import os, sys, collections, importlib.util
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, os.path.join(HERE, path))
    m = importlib.util.module_from_spec(spec)
    sys.modules[mod] = m
    spec.loader.exec_module(m)
    return m


pm = _load('pm17', '17_party_model.py')
p38 = _load('p38', '38_forecast_v4.py')
stv = _load('stv19', '19_stv_simulator.py')
ind34 = _load('ind34', '34_independents.py')
PARTIES = pm.PARTIES
IND = ind34.IND

# contest-order -> pipeline contest key
ORD2CY = {2011: 'assembly2011', 2014: 'local2014', 2015: 'westminster2015',
          2016: 'assembly2016', 2017: 'assembly2017', 2019: 'local2019',
          2022: 'assembly2022', 2023: 'local2023', 2024: 'westminster2024'}
# decay applied to a prior share when the candidate was NOT elected last time; an
# unelected independent's support is much less durable than an incumbent's
DECAY_UNELECTED = 0.75
NO_HISTORY = 3.0   # first-time independent: the observed mean for that class is 4.67


def candidate_estimates():
    """(contest_key, area, name) -> predicted personal first-preference share."""
    df = ind34.load()
    hist = collections.defaultdict(list)
    for r in df.sort_values('order').itertuples():
        hist[r.pid].append(r)
    out = {}
    for r in df[df.is_ind].itertuples():
        prior = [h for h in hist[r.pid] if h.order < r.order]
        if prior:
            last = prior[-1]
            est = last.share if last.elected else last.share * DECAY_UNELECTED
        else:
            est = NO_HISTORY
        cyk = ORD2CY.get(int(r.order))
        if cyk:
            out[(cyk, r.area, r.name)] = max(est, 0.1)
    return out


def run(use_fix):
    est = candidate_estimates() if use_fix else {}
    lut = {}
    for scale in ['dea', 'constituency']:
        P, S, meta = p38.predict(scale)
        d = {}
        for k, row in zip(meta.index, P):
            c, a = k.split('||')
            d[(c, a)] = dict(zip(PARTIES, row))
        lut[scale] = d
    rows = []
    for contest, year, fn in stv.CONTESTS:
        cyk = f"{contest}{year}"
        scale = 'dea' if contest == 'local' else 'constituency'
        for cd in stv.load_contest(contest, year, fn):
            ak = cd['area'] if scale == 'dea' else cd['area'].upper()
            ps = lut[scale].get((cyk, ak))
            if not ps:
                continue
            per = collections.Counter(cd['parties'])
            fp = []
            for nm, pty in zip(cd['names'], cd['parties']):
                v = None
                if use_fix and pty in IND:
                    v = est.get((cyk, cd['area'], nm))
                if v is None:
                    v = ps.get(pty, 0.0) / per[pty]
                fp.append(cd['valid'] * v / 100.0)
            actual = collections.Counter(cd['parties'][i] for i in cd['actual'])
            el, _, _ = stv.run_stv(cd['names'], cd['parties'], fp, cd['seats'], cd['valid'])
            sim = collections.Counter(cd['parties'][i] for i in el)
            rows.append({'contest': contest, 'year': year, 'area': cd['area'],
                         'seats': cd['seats'],
                         'err': sum((actual - sim).values()) + sum((sim - actual).values()),
                         'ind_act': sum(v for k, v in actual.items() if 'Independent' in k),
                         'ind_sim': sum(v for k, v in sim.items() if 'Independent' in k)})
    return pd.DataFrame(rows)


def main():
    print("=" * 70)
    print("INDEPENDENTS FIX — candidate-level prior share + incumbency")
    print(f"  {'variant':38} {'seat err':>9} {'exact':>8} {'inds':>12}")
    for lab, fix in [('baseline (party share, even split)', False),
                     ('FIX (candidate history, concentrated)', True)]:
        df = run(fix)
        print(f"  {lab:38} {df.err.mean():9.2f} {100*(df.err==0).mean():7.1f}% "
              f"{int(df.ind_sim.sum()):5} / {int(df.ind_act.sum()):<5}")
        if fix:
            df.to_csv(os.path.join(HERE, 'independents_fix_seats.csv'), index=False)
            print("\n  by contest (independents projected / actual):")
            for (c, y), g in df.groupby(['contest', 'year']):
                print(f"    {c+str(y):16} err {g.err.mean():5.2f}   "
                      f"inds {int(g.ind_sim.sum()):3} / {int(g.ind_act.sum()):<3}")


if __name__ == '__main__':
    main()
