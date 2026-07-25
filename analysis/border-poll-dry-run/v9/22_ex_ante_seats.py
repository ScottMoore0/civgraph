#!/usr/bin/env python3
"""v9 phase 22 — fully EX ANTE seat projection.

Phases 19-20 required the real candidate list. Phase 21 predicts it. This runs the
whole chain with nothing observed from the contest itself:

    census -> predicted party share -> predicted nominations -> STV count -> seats

and compares against the same contest projected with the REAL candidate list, so
the cost of predicting nominations is isolated rather than buried in the total.

    D1  predicted shares + REAL candidate counts      (= phase 20 stage C)
    D2  predicted shares + PREDICTED candidate counts (fully ex ante)
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
nom = _load('nom21', '21_nomination_model.py')
pm = _load('pm17', '17_party_model.py')

GROUPS = [('local', 'dea', [2014, 2019, 2023]),
          ('assembly', 'constituency', [2016, 2017, 2022])]


def predicted_shares(scale):
    S, stood, X, meta, feats = pm.build(scale)
    P = pm.cv_share(S, stood, X, meta, meta.council.values)
    out = {}
    for k, row in zip(meta.index, P):
        cy, area = k.split('||')
        out[(cy, area)] = dict(zip(pm.PARTIES, row))
    return out


def predicted_nominations():
    """Leave-one-council-out predicted candidate counts, keyed (cy, area, party)."""
    from sklearn.ensemble import GradientBoostingRegressor
    from sklearn.preprocessing import StandardScaler
    df = nom.build_frame()
    ps = {}
    for scale in ['dea', 'constituency']:
        S, stood, X, meta, feats = pm.build(scale)
        P = pm.cv_share(S, stood, X, meta, meta.council.values)
        for k, row in zip(meta.index, P):
            cy, area = k.split('||')
            for p, v in zip(pm.PARTIES, row):
                ps[(cy, area, p)] = v
    df['cy'] = df.contest + df.year.astype(str)
    df['area_key'] = np.where(df.scale == 'dea', df.area, df.area.str.upper())
    df['pred_share'] = [ps.get((a, b, c), np.nan) for a, b, c in
                        zip(df.cy, df.area_key, df.party)]
    d = df.dropna(subset=['lag_n', 'pred_share']).copy()
    d['exp_q'] = d.pred_share * (d.seats + 1) / 100.0
    d2c = nom.councils()
    d['council'] = d.area.map(d2c).fillna(d.area)
    pf = pd.get_dummies(d.party, prefix='p')
    X = pd.concat([d[['exp_q', 'seats', 'lag_n', 'lag_exp_quotas']].fillna(0), pf],
                  axis=1).values.astype(float)
    y = d.n_cand.values.astype(float)
    g = d.council.values
    pred = np.zeros(len(y))
    for gg in sorted(set(g)):
        te = g == gg; tr = ~te
        sc = StandardScaler().fit(X[tr])
        m = GradientBoostingRegressor(n_estimators=200, max_depth=3, random_state=0)
        m.fit(sc.transform(X[tr]), y[tr])
        pred[te] = m.predict(sc.transform(X[te]))
    pred = np.clip(np.round(pred), 0, None).astype(int)
    return {(cy, ak, p): int(n) for cy, ak, p, n in
            zip(d.cy, d.area_key, d.party, pred)}


def main():
    nomp = predicted_nominations()
    rows = []
    for contest, scale, years in GROUPS:
        pred = predicted_shares(scale)
        for year in years:
            fn = [f for f in stv.CONTESTS if f[0] == contest and f[1] == year][0][2]
            for c in stv.load_contest(contest, year, fn):
                cy = f"{contest}{year}"
                ak = c['area'] if scale == 'dea' else c['area'].upper()
                ps = pred.get((cy, ak))
                if not ps:
                    continue
                actual = collections.Counter(c['parties'][i] for i in c['actual'])

                # D1 — real candidate list
                el1, _, _ = stv.project_seats(c['names'], c['parties'], ps,
                                              c['seats'], c['valid'])
                s1 = collections.Counter(c['parties'][i] for i in el1)

                # D2 — synthetic candidate list from PREDICTED nominations
                names2, parties2 = [], []
                for p in pm.PARTIES:
                    k = nomp.get((cy, ak, p))
                    if k is None:
                        k = 1 if ps.get(p, 0) > 100.0 / (c['seats'] + 1) else 0
                    for j in range(int(k)):
                        names2.append(f"{p} {j+1}")
                        parties2.append(p)
                s2 = None
                if names2 and len(names2) >= c['seats']:
                    el2, _, _ = stv.project_seats(names2, parties2, ps,
                                                  c['seats'], c['valid'])
                    s2 = collections.Counter(parties2[i] for i in el2)

                def err(sim):
                    if sim is None:
                        return np.nan
                    return sum((actual - sim).values()) + sum((sim - actual).values())
                rows.append({'contest': contest, 'year': year, 'area': c['area'],
                             'seats': c['seats'], 'errD1': err(s1), 'errD2': err(s2),
                             'n_real': len(c['names']), 'n_pred': len(names2)})
    df = pd.DataFrame(rows).dropna(subset=['errD2'])
    df.to_csv(os.path.join(HERE, 'ex_ante_seats_report.csv'), index=False)
    print("\n" + "=" * 70)
    print("FULLY EX ANTE SEAT PROJECTION")
    print(f"  areas scored: {len(df)}   seats: {int(df.seats.sum())}\n")
    print(f"  {'stage':46} {'mean err':>9} {'exact':>8}")
    print(f"  {'D1  predicted shares + REAL candidate list':46} "
          f"{df.errD1.mean():9.2f} {100*(df.errD1==0).mean():7.1f}%")
    print(f"  {'D2  predicted shares + PREDICTED nominations':46} "
          f"{df.errD2.mean():9.2f} {100*(df.errD2==0).mean():7.1f}%")
    print(f"\n  cost of predicting nominations (D2-D1): "
          f"{df.errD2.mean()-df.errD1.mean():+.2f} seats/area")
    print(f"  candidate-count total: real {int(df.n_real.sum())}, "
          f"predicted {int(df.n_pred.sum())} "
          f"({100*(df.n_pred.sum()-df.n_real.sum())/df.n_real.sum():+.1f}%)")
    print("\n  by contest (mean party-seat error):")
    print(f"  {'contest':16} {'D1':>7} {'D2':>7}")
    for (co, yr), g in df.groupby(['contest', 'year']):
        print(f"  {co+str(yr):16} {g.errD1.mean():7.2f} {g.errD2.mean():7.2f}")


if __name__ == '__main__':
    main()
