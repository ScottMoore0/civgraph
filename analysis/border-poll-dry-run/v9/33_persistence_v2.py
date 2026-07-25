#!/usr/bin/env python3
"""v9 phase 33 — persistence v2: same-contest-type, boundary-bridged by notionals.

Two defects in the persistence used up to now, both diagnosed in earlier phases and
fixed here together because they have the same cure.

1. CROSS-TYPE MIXING. Persistence averaged a constituency's shares over ALL other
   contests, mixing Assembly (STV) with Westminster (FPTP). Those systems produce
   systematically different distributions -- tactical voting and pacts under FPTP,
   sincere first preferences and viable small parties under STV -- so the average is
   biased, not merely noisy. That is why the blend LOST at constituency (14.19 vs
   13.53 for census alone) while winning at DEA, where all three contests are local
   elections of one type.

2. BOUNDARY CHANGES. Westminster 2024 runs on the 2023 review, so none of its
   constituencies existed at any prior contest and persistence was undefined --
   phase 32 showed supplying it lifts 2024 winner accuracy 55.6% -> 77.8%.

persistence_v2(target) = mean over prior contests OF THE SAME TYPE, each expressed
on the target's own boundary vintage: the actual result where the vintage matches,
the phase-32 notional where it does not.

DEA needs neither fix: local 2014/2019/2023 are one contest type on one DEA vintage,
which is exactly why the blend already worked there.
"""
import os, sys, json, importlib.util
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
n32 = _load('n32', '32_dz_notional.py')
PARTIES = pm.PARTIES
VINTAGE = n32.VINTAGE

_MOSAIC = {}


def mosaic(contest_year):
    if contest_year not in _MOSAIC:
        r = n32.dz_mosaic(contest_year)
        _MOSAIC[contest_year] = r
    return _MOSAIC[contest_year]


def actual_on(contest_year, vintage, S, meta):
    """That contest's result expressed on `vintage` boundaries."""
    cy = meta.contest_year.values
    sel = cy == contest_year
    if not sel.any():
        return None
    if VINTAGE.get(contest_year) == vintage:
        return pd.DataFrame(S[sel], index=[n32._n(a) for a in meta.area.values[sel]],
                            columns=PARTIES)
    r = mosaic(contest_year)
    if r is None:
        return None
    mo, w, _, _ = r
    return n32.aggregate_to(mo, w, vintage, mo.index.tolist())


def persistence_v2(scale, S, stood, meta, target_cy):
    """Area x party persistence for `target_cy`, same-type and vintage-matched."""
    cy = meta.contest_year.values
    sel = cy == target_cy
    areas = [n32._n(a) if scale != 'dea' else a for a in meta.area.values[sel]]
    ttype = ''.join(ch for ch in target_cy if not ch.isdigit())
    others = [c for c in sorted(set(cy))
              if c != target_cy and ''.join(ch for ch in c if not ch.isdigit()) == ttype]
    if scale == 'dea':
        # one type, one vintage: plain same-type mean over the other contests
        acc, n = np.zeros((len(areas), len(PARTIES))), np.zeros(len(areas))
        for c in others:
            s2 = cy == c
            src = pd.DataFrame(S[s2], index=list(meta.area.values[s2]), columns=PARTIES)
            for i, a in enumerate(areas):
                if a in src.index:
                    acc[i] += src.loc[a].values
                    n[i] += 1
        out = np.where(n[:, None] > 0, acc / np.maximum(n[:, None], 1),
                       S[sel].mean(axis=0))
        return pd.DataFrame(out, index=areas, columns=PARTIES), others
    v = VINTAGE.get(target_cy)
    frames = []
    for c in others:
        f = actual_on(c, v, S, meta)
        if f is not None:
            frames.append(f.reindex(areas))
    if not frames:
        return pd.DataFrame(np.repeat(S[sel].mean(axis=0)[None, :], len(areas), axis=0),
                            index=areas, columns=PARTIES), []
    stack = np.stack([f.values for f in frames])
    out = np.nanmean(stack, axis=0)
    bad = ~np.isfinite(out).all(axis=1)
    if bad.any():
        out[bad] = S[sel].mean(axis=0)
    return pd.DataFrame(out, index=areas, columns=PARTIES), others


def renorm(M):
    s = M.sum(axis=1, keepdims=True)
    return 100.0 * np.divide(M, s, out=np.zeros_like(M), where=s > 0)


def evaluate(scale):
    S, stood, X, meta, feats = pm.build(scale)
    cy = meta.contest_year.values
    contests = sorted(set(cy))
    bl = _load('bl29', '29_blend_census_persistence.py')
    predC = np.zeros_like(S); predP1 = np.zeros_like(S)
    predP2 = np.zeros_like(S); predB = np.zeros_like(S)
    for c in contests:
        sel = cy == c
        C = bl.census_loco(S, stood, X, meta, c)
        P1 = bl.persistence(S, meta, exclude_cy=c)          # old: all types
        P2, used = persistence_v2(scale, S, stood, meta, c)  # new
        w = bl.fit_weights(S, stood, X, meta, [t for t in contests if t != c])
        predC[sel] = C[sel]
        predP1[sel] = P1[sel]
        predP2[sel] = P2.values
        predB[sel] = renorm(np.clip(w * C[sel] + (1 - w) * P2.values, 0, None))
        if scale != 'dea':
            print(f"    {c:16} same-type sources: {used}")

    def tvd(P):
        return 0.5 * np.abs(P - S).sum(axis=1)
    print(f"\n  {'method':34} {'TVD med':>8} {'TVD mean':>9}")
    for lab, P in [('census', predC), ('persistence v1 (all types)', predP1),
                   ('persistence v2 (same type+notional)', predP2),
                   ('BLEND census + persistence v2', predB)]:
        print(f"  {lab:34} {np.median(tvd(P)):8.2f} {tvd(P).mean():9.2f}")
    return predB, S, meta


def main():
    for sc in ['constituency', 'dea']:
        print(f"\n{'='*74}\n{sc.upper()}")
        evaluate(sc)


if __name__ == '__main__':
    main()
