#!/usr/bin/env python3
"""v9 phase 40 — the DIRECT seat model, as a benchmark against the vote pipeline.

The structural pipeline goes census/poll -> vote shares -> nominations -> STV count
-> seats, and lands at 2.04 mean party-seat error per area. A direct model skips the
middle: features -> seats, targeting the discontinuity head on.

The case FOR direct: STV is a discontinuous function of votes, so structural errors
get amplified exactly where they matter (near quota). And the pipeline's own
decomposition shows the count is nearly right -- perfect votes in gives 0.64 -- so
three quarters of the error is added upstream of the count.

The case AGAINST direct: seats are a LOW-INFORMATION target. There are 294
area-contests, i.e. 294 observations of a multi-output count, against ~4,400
candidacies and 1,723 transfer events available to the structural layers.

One feature is likely to decide it: SEAT PERSISTENCE. A DEA that elected 2 Sinn Fein
last time very probably elects 2 again. Seat counts are far more autocorrelated than
vote shares, and the vote pipeline dilutes that signal by routing it through shares
and a quota calculation. If the direct model wins, this is probably why.

Seats are allocated by largest-remainder over the predicted expectations so the
per-area total is always exactly right -- a constraint the structural pipeline only
satisfies because the count enforces it.
"""
import os, sys, json, collections, importlib.util
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, os.path.join(HERE, path))
    m = importlib.util.module_from_spec(spec)
    sys.modules[mod] = m
    spec.loader.exec_module(m)
    return m


pm = _load('pm17', '17_party_model.py')
p37 = _load('p37', '37_contest_type.py')
p38 = _load('p38', '38_forecast_v4.py')
PARTIES = pm.PARTIES


def load_seats():
    f = pd.read_csv(os.path.join(HERE, 'party_results_frame.csv'))
    f['cy'] = f.contest + f.year.astype(str)
    f['akey'] = np.where(f.scale == 'dea', f.area, f.area.str.upper().str.strip())
    return f


def build(scale):
    """Design matrix for the direct model: census + seat persistence + shares."""
    S, stood, X, meta, feats = pm.build(scale)
    frame = load_seats()
    fr = frame[frame.scale == scale]
    seats = fr.pivot_table(index=['cy', 'akey'], columns='party',
                           values='seats_won', aggfunc='first')[PARTIES]
    tot = fr.groupby(['cy', 'akey']).seats_total.first()

    # predicted shares from the current best pipeline (leave-one-contest-out)
    P, _, meta2 = p38.predict(scale)
    keys = [tuple(k.split('||')) for k in meta2.index]
    shares = pd.DataFrame(P, index=pd.MultiIndex.from_tuples(keys), columns=PARTIES)

    rows = []
    for (cy, ak) in shares.index:
        if (cy, ak) not in seats.index:
            continue
        ctype = ''.join(ch for ch in cy if not ch.isdigit())
        # seat persistence: this area's seats in OTHER contests of the same type
        prior = [seats.loc[(c, ak)] for (c, a2) in seats.index
                 if a2 == ak and c != cy
                 and ''.join(ch for ch in c if not ch.isdigit()) == ctype]
        pri = (np.mean([p.values for p in prior], axis=0) if prior
               else np.zeros(len(PARTIES)))
        rows.append({'cy': cy, 'akey': ak, 'ctype': ctype,
                     'seats_total': float(tot.loc[(cy, ak)]),
                     'share': shares.loc[(cy, ak)].values,
                     'prior_seats': pri,
                     'y': seats.loc[(cy, ak)].values.astype(float),
                     'has_prior': float(bool(prior))})
    return rows


def largest_remainder(exp, total):
    """Allocate `total` integer seats over expectations `exp`."""
    exp = np.clip(exp, 0, None)
    if exp.sum() <= 0:
        return np.zeros(len(exp), dtype=int)
    q = exp * total / exp.sum()
    base = np.floor(q).astype(int)
    rem = total - base.sum()
    if rem > 0:
        order = np.argsort(-(q - base))
        for i in order[:rem]:
            base[i] += 1
    return base


def main():
    print("=" * 74)
    print("DIRECT SEAT MODEL vs THE VOTE PIPELINE")
    allrows = []
    for scale in ['dea', 'constituency']:
        allrows += [dict(r, scale=scale) for r in build(scale)]
    df = pd.DataFrame(allrows)
    # STV contests only, so the comparison matches the pipeline's seat scoring
    df = df[df.ctype.isin(['local', 'assembly'])].reset_index(drop=True)
    print(f"  area-contests: {len(df)}   seats: {int(df.seats_total.sum())}")

    Xs = np.vstack([np.concatenate([r['share'], r['prior_seats'],
                                    [r['seats_total'], r['has_prior']]])
                    for _, r in df.iterrows()])
    Y = np.vstack(df.y.values)
    cy = df.cy.values

    # leave-one-contest-out
    pred_exp = np.zeros_like(Y, dtype=float)
    for c in sorted(set(cy)):
        te = cy == c
        tr = ~te
        sc = StandardScaler().fit(Xs[tr])
        for j in range(len(PARTIES)):
            m = GradientBoostingRegressor(n_estimators=150, max_depth=3, random_state=0)
            m.fit(sc.transform(Xs[tr]), Y[tr, j])
            pred_exp[te, j] = m.predict(sc.transform(Xs[te]))

    # allocate to the exact seat total per area
    pred = np.zeros_like(Y, dtype=int)
    for i in range(len(df)):
        pred[i] = largest_remainder(pred_exp[i], int(df.seats_total.iloc[i]))

    err = np.abs(pred - Y).sum(axis=1)
    print(f"\n  {'model':44} {'mean err':>9} {'exact':>8}")
    print(f"  {'DIRECT seats (GBM + seat persistence)':44} "
          f"{err.mean():9.2f} {100*(err==0).mean():7.1f}%")

    # the structural pipeline, scored on exactly these rows
    v4 = pd.read_csv(os.path.join(HERE, 'forecast_v4_seats.csv'))
    print(f"  {'STRUCTURAL pipeline (phase 38)':44} "
          f"{v4.err.mean():9.2f} {100*(v4.err==0).mean():7.1f}%")

    # ablation: how much is seat persistence doing?
    print("\n  ablation — direct model without seat persistence:")
    Xs2 = np.vstack([np.concatenate([r['share'], [r['seats_total']]])
                     for _, r in df.iterrows()])
    p2 = np.zeros_like(Y, dtype=float)
    for c in sorted(set(cy)):
        te = cy == c; tr = ~te
        sc = StandardScaler().fit(Xs2[tr])
        for j in range(len(PARTIES)):
            m = GradientBoostingRegressor(n_estimators=150, max_depth=3, random_state=0)
            m.fit(sc.transform(Xs2[tr]), Y[tr, j])
            p2[te, j] = m.predict(sc.transform(Xs2[te]))
    pr2 = np.zeros_like(Y, dtype=int)
    for i in range(len(df)):
        pr2[i] = largest_remainder(p2[i], int(df.seats_total.iloc[i]))
    e2 = np.abs(pr2 - Y).sum(axis=1)
    print(f"  {'  shares + seats_total only':44} {e2.mean():9.2f} {100*(e2==0).mean():7.1f}%")

    print("\n  by contest:")
    df['err'] = err
    for c, g in df.groupby('cy'):
        print(f"    {c:18} {g.err.mean():6.2f}")

    # NI-wide seat totals
    print("\n  NI-wide seat totals by party (all STV contests):")
    act = Y.sum(axis=0); prd = pred.sum(axis=0)
    for j, p in enumerate(PARTIES):
        if act[j] or prd[j]:
            print(f"    {p:14} actual {int(act[j]):4}  direct {int(prd[j]):4}  "
                  f"{int(prd[j]-act[j]):+4}")
    print(f"    total abs error: {int(np.abs(prd-act).sum())}")
    df.drop(columns=['share', 'prior_seats', 'y']).to_csv(
        os.path.join(HERE, 'direct_seats_report.csv'), index=False)


if __name__ == '__main__':
    main()
