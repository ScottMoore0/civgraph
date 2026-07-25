#!/usr/bin/env python3
"""v9 phase 29 — per-party blend of the census model and area persistence.

Neither predictor wins everywhere. Per-party MAE on share (DEA, current model):

    persistence wins   DUP 3.37 vs 6.10, SF 5.03 vs 6.48, SDLP 3.70 vs 5.17
    census wins        Alliance 2.90 vs 4.42, Other 1.61 vs 3.64, TUV 1.69 vs 2.43,
                       Aontu 0.25 vs 0.91

The split is structural: persistence needs a history to persist, so it fails for
new parties (Aontu, founded 2019) and for parties whose support is moving
(Alliance, TUV). Entrenched parties with sitting councillors are strongly
autocorrelated, and incumbency is invisible to the census. So blend per party:

    share_p = w_p * census_p + (1 - w_p) * persistence_p

A METHODOLOGICAL POINT THAT DECIDES THE DESIGN. The headline persistence baseline
in phase 17 is computed as "this area's mean share in other contests" regardless of
fold. Under leave-one-COUNCIL-out that is leakage: the fold removes every contest
for that council, so those other contests are held-out data. Persistence is
therefore NOT legitimately available under LOCO, and its 15.56 there is optimistic.

Under leave-one-CONTEST-out it IS legitimate -- the area's other contests are in
training -- and that is also the situation of a real forecast, where the previous
election result is known. So the blend is evaluated leave-one-contest-out, and the
weights are fitted by an inner leave-one-contest-out on the training contests only,
so no held-out contest helps choose its own weight.
"""
import os, sys, importlib.util
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
PARTIES = pm.PARTIES


def persistence(S, meta, exclude_cy):
    """Area's mean share across contests other than `exclude_cy`."""
    areas = meta.area.values
    cy = meta.contest_year.values
    P = np.zeros_like(S)
    for i, a in enumerate(areas):
        sel = (areas == a) & (cy != cy[i]) & (cy != exclude_cy)
        P[i] = S[sel].mean(axis=0) if sel.any() else S[cy != exclude_cy].mean(axis=0)
    return P


def census_loco(S, stood, X, meta, holdout):
    """Census prediction with `holdout` contest excluded from training."""
    cy = meta.contest_year.values
    groups = np.where(cy == holdout, 'HOLD', 'TRAIN')
    return pm.cv_share(S, stood, X, meta, groups)


def fit_weights(S, stood, X, meta, train_cys):
    """Per-party w in [0,1], chosen on the training contests by inner LOCO."""
    cy = meta.contest_year.values
    num = np.zeros(len(PARTIES)); den = np.zeros(len(PARTIES))
    for t in train_cys:
        sel = cy == t
        if not sel.any():
            continue
        C = census_loco(S, stood, X, meta, t)
        Pp = persistence(S, meta, exclude_cy=None)
        # only rows of contest t, and only where persistence is defined
        for j in range(len(PARTIES)):
            c, p, a = C[sel, j], Pp[sel, j], S[sel, j]
            d = c - p
            ok = np.isfinite(d)
            if ok.sum() < 5 or np.allclose(d[ok], 0):
                continue
            # least squares for w: minimise || (p + w*(c-p)) - a ||
            num[j] += float(np.dot(d[ok], (a - p)[ok]))
            den[j] += float(np.dot(d[ok], d[ok]))
    w = np.where(den > 0, num / np.maximum(den, 1e-9), 1.0)
    return np.clip(w, 0.0, 1.0)


def renorm(M):
    s = M.sum(axis=1, keepdims=True)
    return 100.0 * np.divide(M, s, out=np.zeros_like(M), where=s > 0)


def run(scale):
    S, stood, X, meta, feats = pm.build(scale)
    cy = meta.contest_year.values
    contests = sorted(set(cy))
    print(f"\n{'='*70}\n{scale.upper()}  {len(meta)} area-contests, {len(contests)} contests")

    predC = np.zeros_like(S); predP = np.zeros_like(S); predB = np.zeros_like(S)
    W = {}
    for c in contests:
        sel = cy == c
        train = [t for t in contests if t != c]
        C = census_loco(S, stood, X, meta, c)
        Pp = persistence(S, meta, exclude_cy=c)
        w = fit_weights(S, stood, X, meta, train)
        W[c] = w
        B = renorm(np.clip(w * C + (1 - w) * Pp, 0, None))
        predC[sel], predP[sel], predB[sel] = C[sel], Pp[sel], B[sel]

    def tvd(P):
        return 0.5 * np.abs(P - S).sum(axis=1)
    print(f"  {'method':22} {'TVD med':>8} {'TVD mean':>9}")
    for lab, P in [('census', predC), ('persistence', predP), ('BLEND', predB)]:
        print(f"  {lab:22} {np.median(tvd(P)):8.2f} {tvd(P).mean():9.2f}")

    print(f"\n  per-party MAE and fitted weight (w=1 -> all census)")
    print(f"  {'party':12} {'census':>7} {'persist':>8} {'blend':>7} {'w':>6}")
    wm = np.mean([W[c] for c in contests], axis=0)
    for j, p in enumerate(PARTIES):
        print(f"  {p:12} {np.abs(predC[:,j]-S[:,j]).mean():7.2f} "
              f"{np.abs(predP[:,j]-S[:,j]).mean():8.2f} "
              f"{np.abs(predB[:,j]-S[:,j]).mean():7.2f} {wm[j]:6.2f}")
    return predB, S, meta


def main():
    for sc in ['dea', 'constituency']:
        run(sc)


if __name__ == '__main__':
    main()
