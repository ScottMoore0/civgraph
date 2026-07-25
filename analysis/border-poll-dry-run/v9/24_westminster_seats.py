#!/usr/bin/env python3
"""v9 phase 24 — Westminster (FPTP) seat prediction.

Mechanically the easy case: one seat per constituency, winner is whoever leads on
first preferences. No transfers, no quota, no nomination model needed — a party's
candidate count is irrelevant to who wins under FPTP.

The difficulty is entirely in the SHARE model, and Westminster is where it is
weakest (phase 17: NI-wide max error 7.0-7.3 pts in 2017/2019 vs 2.8 for Assembly).
The reason is electoral pacts: in 2017 and 2019 unionist parties stood aside for
one another in several seats, and nationalists did likewise in 2024. A pact is a
party decision that suppresses a share to zero for reasons no demographic model
can see, and it changes the winner in exactly the marginal seats that decide the
NI seat count.

Scored three ways, because for FPTP the seat is what matters, not the share:
    winner accuracy  fraction of constituencies whose winner is predicted
    seat totals      per-party NI seat counts, actual vs predicted
    margin error     error on the winner's lead over second place
"""
import os, sys, json, collections, importlib.util
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, os.path.join(HERE, path))
    m = importlib.util.module_from_spec(spec)
    sys.modules[mod] = m
    spec.loader.exec_module(m)
    return m


pm = _load('pm17', '17_party_model.py')

YEARS = [2017, 2019, 2024]


def main():
    S, stood, X, meta, feats = pm.build('constituency')
    P = pm.cv_share(S, stood, X, meta, meta.council.values)
    idx = {k: i for i, k in enumerate(meta.index)}

    rows = []
    for i, (key, m) in enumerate(zip(meta.index, meta.itertuples())):
        if m.contest != 'westminster':
            continue
        act = dict(zip(pm.PARTIES, S[i]))
        prd = dict(zip(pm.PARTIES, P[i]))
        aw = max(act, key=act.get)
        pw = max(prd, key=prd.get)
        a_sorted = sorted(act.values(), reverse=True)
        p_sorted = sorted(prd.values(), reverse=True)
        rows.append({'year': m.year, 'area': m.area, 'actual': aw, 'pred': pw,
                     'correct': int(aw == pw),
                     'act_margin': a_sorted[0] - a_sorted[1],
                     'pred_margin': p_sorted[0] - p_sorted[1]})
    df = pd.DataFrame(rows)
    df.to_csv(os.path.join(HERE, 'westminster_seats_report.csv'), index=False)

    print("\n" + "=" * 66)
    print("WESTMINSTER (FPTP) SEAT PREDICTION — leave-one-constituency-out")
    print(f"\n  {'year':6} {'seats':>6} {'winner acc':>11} {'margin MAE':>11}")
    for y, g in df.groupby('year'):
        print(f"  {y:<6} {len(g):6} {100*g.correct.mean():10.1f}% "
              f"{np.abs(g.act_margin-g.pred_margin).mean():10.1f}")
    print(f"  {'ALL':6} {len(df):6} {100*df.correct.mean():10.1f}% "
          f"{np.abs(df.act_margin-df.pred_margin).mean():10.1f}")

    print("\n  NI seat totals by party:")
    for y, g in df.groupby('year'):
        a = collections.Counter(g.actual)
        p = collections.Counter(g.pred)
        parts = sorted(set(a) | set(p), key=lambda k: -a[k])
        print(f"\n    {y}   " + "  ".join(f"{k}:{a[k]}->{p[k]}" for k in parts))
        print(f"           total abs seat error: "
              f"{sum(abs(a[k]-p[k]) for k in set(a)|set(p))} of {len(g)}")

    print("\n  misses (predicted winner != actual):")
    for _, r in df[df.correct == 0].iterrows():
        print(f"    {r.year} {r.area:32} actual {r.actual:12} -> pred {r.pred:12} "
              f"(actual margin {r.act_margin:4.1f} pts)")
    close = df[df.act_margin < 5]
    print(f"\n  marginal seats (actual margin < 5 pts): {len(close)}, "
          f"winner accuracy {100*close.correct.mean() if len(close) else float('nan'):.1f}%")
    safe = df[df.act_margin >= 15]
    print(f"  safe seats (margin >= 15 pts):          {len(safe)}, "
          f"winner accuracy {100*safe.correct.mean() if len(safe) else float('nan'):.1f}%")


if __name__ == '__main__':
    main()
