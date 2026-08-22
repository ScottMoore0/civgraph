#!/usr/bin/env python3
"""Shared poststratification helpers for the unity projection (phases 4/5).

Two corrections live here so 4_ and 5_ stay in sync:

  * ELIGIBLE ELECTORATE, not resident population. The old pipeline weighted
    every Data Zone by AllUsualResidents -- every man, woman and child. A border
    poll is decided by the electorate, and the poll level it is re-centred onto
    is an *adult* attitude measure, so children must not carry weight. The
    youngest Data Zones are also the most Catholic, so weighting by all
    residents systematically over-weighted the most pro-unity areas.
    elig_weight() strips the under-16 band (the only clean sub-voting-age cut in
    the AGE_BAND_AGG7 census block; it leaves 16-17 year-olds in, a ~2-3% uniform
    overcount that barely moves the *relative* weights) and multiplies by a
    census-fitted turnout propensity so the weight is likely-voters, not just
    voting-age heads.

  * BOUNDED RE-CENTRE. The old code re-centred unity to the poll level and THEN
    clipped to [1,99], so wherever the clip bit (near-0 / near-100 Data Zones)
    the pop-weighted mean no longer equalled the level it was just set to.
    recentre_clip() solves for the shift whose *clipped* weighted mean hits the
    target, so the reported NI level and the projection are consistent.
"""
import os, json, glob
import numpy as np, pandas as pd
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))

# census predictors of turnout (older / more owner-occupied / higher-qualified
# areas turn out more) -- the same short list validated at LOO R2=0.45 in v11.
TURNOUT_FEATS = ['age__65+ years', 'age__16-24 years',
                 'econ__Economically inactive: Retired',
                 'ten__Owner occupied: Owns outright', 'qual__No qualifications']


def _resolve(cols, wanted):
    """Match a wanted feature name against the actual (comma-truncated) headers."""
    out = []
    for w in wanted:
        hit = next((c for c in cols if c == w or c.startswith(w[:28])), None)
        if hit:
            out.append(hit)
    return out


def turnout_weight(dz_feat):
    """Relative likely-voter weight per Data Zone, mean 1.0.

    Fits turnout ~ census on the 18 constituencies (the only geography where
    turnout is observed), then applies the fitted gradient to Data-Zone census
    features. Returns a Series aligned to dz_feat.index, plus the LOO R2 the fit
    achieved (for honest logging). Falls back to uniform 1.0 if the
    constituency turnout can't be assembled.
    """
    try:
        cf = pd.read_csv(os.path.join(HERE, 'constituency_features.csv'))
        cf['con'] = cf['con'].str.upper()
        cf = cf.set_index('con')
        turn = {}
        for f in glob.glob(f"{REPO}/render/metadata/elections-test2/"
                           "northern-ireland-assembly__*.json") + \
                 glob.glob(f"{REPO}/render/metadata/elections-test2/"
                           "northern-ireland-house-of-commons__*.json"):
            try:
                j = json.load(open(f, encoding='utf-8'))
            except Exception:
                continue
            for r in j.get('results', []):
                c = (r.get('constituency') or '').upper()
                if r.get('turnoutPct') and c in cf.index:
                    turn.setdefault(c, []).append(r['turnoutPct'])
        tc = pd.Series({k: np.mean(v) for k, v in turn.items()}).reindex(cf.index).dropna()
        feats = _resolve(cf.columns.tolist(), TURNOUT_FEATS)
        if len(tc) < 8 or len(feats) < 3:
            raise ValueError("insufficient turnout observations/features")
        sc = StandardScaler().fit(cf.loc[tc.index, feats].values)
        y = tc.values
        # leave-one-out R2, honest reporting only
        p = np.zeros(len(y))
        Xc = sc.transform(cf.loc[tc.index, feats].values)
        for i in range(len(y)):
            tr = np.arange(len(y)) != i
            p[i] = Ridge(alpha=5).fit(Xc[tr], y[tr]).predict(Xc[i:i + 1])[0]
        r2 = 1 - ((p - y) ** 2).sum() / ((y - y.mean()) ** 2).sum()
        model = Ridge(alpha=5).fit(Xc, y)
        dz_pred = model.predict(sc.transform(dz_feat[feats].values))
        # The ridge is fit on 18 constituencies spanning turnout ~57-78%; on the
        # 3,780 Data Zones it extrapolates, and a handful of extreme DZs fall
        # below 0. Turnout is a rate in [0,100] -- clip to a plausible band
        # (well outside the observed constituency range) before normalising so
        # no Data Zone carries a negative or absurd likely-voter weight.
        dz_pred = np.clip(dz_pred, 35.0, 90.0)
        w = pd.Series(dz_pred, index=dz_feat.index)
        return w / w.mean(), r2
    except Exception as e:
        print(f"  ! turnout model unavailable ({e}); using uniform turnout")
        return pd.Series(1.0, index=dz_feat.index), float('nan')


def elig_weight(dz_feat, pop, apply_turnout=True):
    """Likely-voter weight per Data Zone = voting-age residents x turnout.

    dz_feat : Data-Zone feature frame (needs the age__ share columns).
    pop     : Series of AllUsualResidents indexed by Data Zone.
    Returns (weight Series, turnout R2, diagnostics dict).
    """
    child = next((c for c in dz_feat.columns if c.startswith('age__0-15')), None)
    if child is None:
        raise KeyError("age__0-15 share column not found; cannot derive voting-age population")
    resid = pop.reindex(dz_feat.index).fillna(0.0)
    voting_age = resid * (1 - dz_feat[child].values / 100.0)   # 16+ residents
    if apply_turnout:
        tw, r2 = turnout_weight(dz_feat)
        w = voting_age * tw.reindex(dz_feat.index).values
    else:
        r2 = float('nan')
        w = voting_age
    diag = {
        'resident_pop': float(resid.sum()),
        'voting_age_pop': float(voting_age.sum()),
        'voting_age_share': round(100 * voting_age.sum() / resid.sum(), 1),
        'turnout_loo_r2': None if r2 != r2 else round(r2, 2),
    }
    return pd.Series(w, index=dz_feat.index), r2, diag


def recentre_clip(unity, weight, target, lo=1.0, hi=99.0, iters=40):
    """Shift `unity` by a scalar so that clip(unity+shift,[lo,hi]) has weighted
    mean == target, then return the clipped result. Bisection on the shift; the
    clipped weighted mean is monotone in the shift, so this converges. Replaces
    the old shift-then-clip, which left the mean off-target wherever the clip bit.
    """
    u = np.asarray(unity, float)
    w = np.asarray(weight, float)
    if w.sum() <= 0:
        w = np.ones_like(u)

    def wmean(s):
        return np.average(np.clip(u + s, lo, hi), weights=w)

    s_lo, s_hi = lo - hi, hi - lo          # brackets: enough to peg every point to a bound
    if wmean(s_lo) > target:
        return np.clip(u + s_lo, lo, hi)
    if wmean(s_hi) < target:
        return np.clip(u + s_hi, lo, hi)
    for _ in range(iters):
        mid = (s_lo + s_hi) / 2
        if wmean(mid) < target:
            s_lo = mid
        else:
            s_hi = mid
    return np.clip(u + (s_lo + s_hi) / 2, lo, hi)
