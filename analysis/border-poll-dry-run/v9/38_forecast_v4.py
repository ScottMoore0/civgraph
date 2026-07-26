#!/usr/bin/env python3
"""v9 phase 38 — forecaster v4: the ASYMMETRIC configuration, as the default.

Phase 37 established that the right treatment differs by contest type, and that no
single switch expresses it:

  Assembly     TYPED ridge (trained on Assembly rows only) + blend
               -> 11.42 -> 10.13 TVD. Assembly has 54 rows of its own and gains more
                  from a clean STV-only mapping than it loses in sample size.
  Westminster  POOLED ridge (Assembly rows included) + blend
               -> typing costs it 14.12 -> 16.34. Westminster alone is 90 rows and
                  cannot afford to lose the Assembly sample, even though pooling
                  mixes FPTP with STV.
  local/DEA    POOLED + blend (one contest type, so typing is a no-op)

That asymmetry is not elegant, but it is what the data says: the cost of the wrong
pooling assumption and the cost of a small sample fall differently on the two types.

This makes that configuration the default rather than a comparison, and scores it
end to end.
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
bl = _load('bl29', '29_blend_census_persistence.py')
p33 = _load('p33', '33_persistence_v2.py')
fc = _load('fc31', '31_forecast.py')
p37 = _load('p37', '37_contest_type.py')
stv = _load('stv19', '19_stv_simulator.py')
PARTIES = pm.PARTIES

# the asymmetric policy, per contest type
POLICY = {
    'assembly':    dict(typed=True,  blend=True),
    'westminster': dict(typed=False, blend=True),
    'local':       dict(typed=False, blend=True),
}


def predict(scale):
    S, stood, X, meta, feats = pm.build(scale)
    cy = meta.contest_year.values
    contests = sorted(set(cy))
    out = np.zeros_like(S)
    for c in contests:
        pol = POLICY.get(p37.ctype(c), dict(typed=False, blend=True))
        sel = cy == c
        C = p37.census_pred(S, stood, X, meta, c, pol['typed'])
        pv = fc.calibrated_poll(c)
        if pv is not None:
            cur = np.average(C[sel], axis=0, weights=meta.valid_poll.values[sel])
            tgt = np.array([pv[p] for p in PARTIES])
            C = C.copy()
            C[sel] = bl.renorm(C[sel] * np.where(cur > 1e-6,
                                                 tgt / np.maximum(cur, 1e-6), 1.0))
        pred = C[sel]
        if pol['blend']:
            Pp, _ = p33.persistence_v2(scale, S, stood, meta, c)
            w = bl.fit_weights(S, stood, X, meta, [t for t in contests if t != c])
            pred = bl.renorm(np.clip(w * pred + (1 - w) * Pp.values, 0, None))
        out[sel] = pred
    return out, S, meta


def main():
    print("=" * 74)
    print("FORECASTER v4 — asymmetric per-contest-type configuration")
    for t, p in POLICY.items():
        print(f"  {t:12} ridge={'typed' if p['typed'] else 'pooled':6} "
              f"blend={'on' if p['blend'] else 'off'}")

    lut, store = {}, {}
    for scale in ['dea', 'constituency']:
        P, S, meta = predict(scale)
        store[scale] = (P, S, meta)
        cy = meta.contest_year.values
        print(f"\n{scale.upper()}  share TVD median: overall "
              f"{np.median(p37.tvd(P, S)):.2f}")
        for t in sorted({p37.ctype(c) for c in cy}):
            s = np.array([p37.ctype(c) == t for c in cy])
            print(f"    {t:14} {np.median(p37.tvd(P[s], S[s])):.2f}")
        d = {}
        for k, row in zip(meta.index, P):
            c, a = k.split('||')
            d[(c, a)] = dict(zip(PARTIES, row))
        lut[scale] = d

    # Westminster winners
    P, S, meta = store['constituency']
    cy = meta.contest_year.values
    print("\n  Westminster winner accuracy:")
    tot = ok_all = 0
    for c in sorted({x for x in set(cy) if p37.ctype(x) == 'westminster'}):
        sel = cy == c
        ok = sum(1 for i in np.where(sel)[0]
                 if int(np.argmax(P[i])) == int(np.argmax(S[i])))
        tot += sel.sum(); ok_all += ok
        print(f"    {c:18} {100*ok/sel.sum():5.1f}%")
    print(f"    {'MEAN':18} {100*ok_all/tot:5.1f}%")

    # seats
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
    df.to_csv(os.path.join(HERE, 'forecast_v4_seats.csv'), index=False)
    print(f"\n  SEATS: areas {len(df)}  seats {int(df.seats.sum())}  "
          f"mean err {df.err.mean():.2f}  exact {100*(df.err==0).mean():.1f}%")
    for (c, y), g in df.groupby(['contest', 'year']):
        print(f"    {c+str(y):16} {g.err.mean():6.2f}")


if __name__ == '__main__':
    main()
