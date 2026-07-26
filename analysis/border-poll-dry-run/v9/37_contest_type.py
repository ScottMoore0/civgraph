#!/usr/bin/env python3
"""v9 phase 37 — make the model contest-type aware.

Two open items turn out to be the same problem.

  (1) The blend should be applied per CONTEST TYPE, not per scale: persistence lifts
      Westminster 2024 by 22 pts but slightly hurts Assembly, where the poll level
      already supplies what persistence carries.
  (2) Adding Westminster 2010/2015 appeared to COST a little on Assembly seats. They
      are perfectly good Westminster elections -- the problem is not the data.

The common cause: the constituency model pools Assembly and Westminster rows into
ONE ridge and treats contest type purely as a LEVEL to be removed. But the
census -> vote RELATIONSHIP differs by type, not just its level:

    Westminster is FPTP  -> tactical voting, pacts, small parties squeezed
    Assembly is STV      -> sincere first preferences, small parties viable

So Alliance and the Greens convert demography into votes differently under the two
systems. Pooling forces one mapping to serve both, and adding Westminster rows drags
that shared mapping toward FPTP behaviour -- which is why more (good) data made
Assembly predictions worse.

Tested here:
    pooled   one ridge over all constituency contests          (current)
    typed    one ridge per contest type                        (the fix)
    +blend   per-type blend weights on top of the typed model
"""
import os, sys, collections, importlib.util
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, os.path.join(HERE, path))
    m = importlib.util.module_from_spec(spec)
    sys.modules[mod] = m
    spec.loader.exec_module(m)
    return m


pm = _load('pm17', '17_party_model.py')
bl = _load('bl29', '29_blend_census_persistence.py')
p33 = _load('p33', '33_persistence_v2.py')
fc = _load('fc31', '31_forecast.py')
stv = _load('stv19', '19_stv_simulator.py')
PARTIES = pm.PARTIES


def ctype(cy):
    return ''.join(ch for ch in cy if not ch.isdigit())


def census_pred(S, stood, X, meta, holdout, typed):
    """Shape prediction for `holdout`; typed=True trains only on the same type."""
    cy = meta.contest_year.values
    Y = pm.clr(S)
    te = cy == holdout
    tr = ~te
    if typed:
        tr = tr & np.array([ctype(c) == ctype(holdout) for c in cy])
        if tr.sum() < 20:
            tr = ~te
    sc = StandardScaler().fit(X[tr])
    P = np.zeros_like(Y)
    for j in range(Y.shape[1]):
        ctr = pd.Series(Y[tr, j]).groupby(cy[tr]).transform('mean').values
        m = Ridge(alpha=pm.ALPHA).fit(sc.transform(X[tr]), Y[tr, j] - ctr)
        lvl = Y[tr, j].mean()
        P[te, j] = m.predict(sc.transform(X[te])) + lvl
    return pm.inv_clr(P, stood)


def run(scale, typed, use_poll=True, blend_types=()):
    S, stood, X, meta, feats = pm.build(scale)
    cy = meta.contest_year.values
    contests = sorted(set(cy))
    out = np.zeros_like(S)
    for c in contests:
        sel = cy == c
        C = census_pred(S, stood, X, meta, c, typed)
        if use_poll:
            pv = fc.calibrated_poll(c)
            if pv is not None:
                cur = np.average(C[sel], axis=0, weights=meta.valid_poll.values[sel])
                tgt = np.array([pv[p] for p in PARTIES])
                C = C.copy()
                C[sel] = bl.renorm(C[sel] * np.where(cur > 1e-6,
                                                     tgt / np.maximum(cur, 1e-6), 1.0))
        pred = C[sel]
        if ctype(c) in blend_types:
            Pp, srcs = p33.persistence_v2(scale, S, stood, meta, c)
            w = bl.fit_weights(S, stood, X, meta, [t for t in contests if t != c])
            pred = bl.renorm(np.clip(w * pred + (1 - w) * Pp.values, 0, None))
        out[sel] = pred
    return out, S, meta


def tvd(P, S):
    return 0.5 * np.abs(P - S).sum(axis=1)


def by_type(P, S, meta):
    cy = meta.contest_year.values
    res = {}
    for t in sorted({ctype(c) for c in cy}):
        sel = np.array([ctype(c) == t for c in cy])
        res[t] = np.median(tvd(P[sel], S[sel]))
    return res


def main():
    print("=" * 76)
    print("CONTEST-TYPE AWARENESS")
    print("\nCONSTITUENCY — does pooling Assembly with Westminster hurt?")
    print(f"  {'variant':44} {'overall':>8}  by type")
    for lab, typed, bt in [('pooled ridge (current)', False, ()),
                           ('pooled + blend on westminster', False, ('westminster',)),
                           ('TYPED ridge (per contest type)', True, ()),
                           ('TYPED + blend on westminster', True, ('westminster',)),
                           ('TYPED + blend on both types', True, ('westminster', 'assembly'))]:
        P, S, meta = run('constituency', typed, blend_types=bt)
        bt_ = by_type(P, S, meta)
        print(f"  {lab:44} {np.median(tvd(P, S)):8.2f}  "
              + "  ".join(f"{k}={v:.2f}" for k, v in bt_.items()))

    print("\nDEA — single contest type, so typing should be a no-op")
    for lab, typed, bt in [('pooled (current)', False, ()),
                           ('pooled + blend', False, ('local',)),
                           ('typed + blend', True, ('local',))]:
        P, S, meta = run('dea', typed, blend_types=bt)
        print(f"  {lab:44} {np.median(tvd(P, S)):8.2f}")

    # ---- Westminster winner accuracy under the best constituency config ----
    print("\nWESTMINSTER winner accuracy")
    for lab, typed, bt in [('pooled, no blend', False, ()),
                           ('pooled + blend', False, ('westminster',)),
                           ('TYPED + blend', True, ('westminster',))]:
        P, S, meta = run('constituency', typed, blend_types=bt)
        cy = meta.contest_year.values
        parts = []
        for c in ['westminster2010', 'westminster2015', 'westminster2017',
                  'westminster2019', 'westminster2024']:
            sel = cy == c
            if not sel.any():
                continue
            ok = sum(1 for i in np.where(sel)[0]
                     if int(np.argmax(P[i])) == int(np.argmax(S[i])))
            parts.append(f"{c[-4:]} {100*ok/sel.sum():.0f}%")
        print(f"  {lab:44} " + "  ".join(parts))

    # ---- seats under the best configuration ----
    print("\nSEATS under TYPED + per-type blend")
    lut = {}
    for scale, typed, bt in [('dea', True, ('local',)),
                             ('constituency', True, ('westminster',))]:
        P, S, meta = run(scale, typed, blend_types=bt)
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
            actual = collections.Counter(cd['parties'][i] for i in cd['actual'])
            el, _, _ = stv.project_seats(cd['names'], cd['parties'], ps,
                                         cd['seats'], cd['valid'])
            sim = collections.Counter(cd['parties'][i] for i in el)
            rows.append({'contest': contest, 'year': year, 'seats': cd['seats'],
                         'err': sum((actual - sim).values()) + sum((sim - actual).values())})
    df = pd.DataFrame(rows)
    print(f"  areas {len(df)}  seats {int(df.seats.sum())}  "
          f"mean err {df.err.mean():.2f}  exact {100*(df.err==0).mean():.1f}%")
    for (c, y), g in df.groupby(['contest', 'year']):
        print(f"    {c+str(y):16} {g.err.mean():6.2f}")
    df.to_csv(os.path.join(HERE, 'contest_type_seats.csv'), index=False)


if __name__ == '__main__':
    main()
