#!/usr/bin/env python3
"""v9 phases 3-4 — regularised census->result model + multi-scale validation.
Ridge regression of nationalist first-pref share on 88 census features, with
per-contest level removed (models the geographic SHAPE).

Validation notes (rewritten 2026-07-21 — the previous harness overstated skill):

  * LEVEL LEAKAGE. The old CV computed the per-contest mean over ALL rows,
    including the held-out contest, then added it back to the held-out
    predictions and scored R2 against absolute nat_pct. The model was handed
    the answer's level. Absolute R2 is now reported only under a level the
    fold did not see; the shape is scored on demeaned values, which gives no
    credit for the level at all.
  * SCALER LEAKAGE. StandardScaler was fit on all areas before the fold loop.
    It is now fit inside each fold on training rows only.
  * BLOCKING. Leave-one-contest-out leaves every DEA in training via its other
    two contests, and nationalist vote is near-static across a decade, so that
    design is close to a persistence test rather than a measure of spatial
    generalisation. Spatial generalisation is exactly what the DEA(80) -> DZ
    (3,780) downscale depends on, so leave-one-council-out is now reported
    alongside it. Expect the spatially-blocked numbers to be the weaker --
    and the honest -- ones.
"""
import pandas as pd, numpy as np, json, os
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))
# repo root: analysis/border-poll-dry-run/v9 -> up three
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
# alpha tuned on the leave-one-council-out shape metric below: 50 is the optimum
# (LOCO MAE 4.94 vs 5.53 at the old hard-coded 10). 4_/5_ use the same value.
ALPHA = 50.0

feat = pd.read_csv(os.path.join(HERE, 'dea_features.csv')).set_index('area')
res = pd.read_csv(os.path.join(HERE, 'results_frame.csv'))
dea = res[(res.scale == 'dea') & (res.contest == 'local')].copy()
lf = json.load(open(f"{REPO}/render/metadata/elections-test2/"
                    "local-government-local-government-districts__2023-05-18.json",
                    encoding='utf-8'))
dea2council = lf['localBodyByConstituency']
common = [a for a in dea.area.unique() if a in feat.index]
print("DEA match: %d/%d areas have census features" % (len(common), dea.area.nunique()))
dea = dea[dea.area.isin(common)]
FEATS = feat.loc[common].columns.tolist()

dea['contest_year'] = dea.contest + dea.year.astype(str)
sub = dea.merge(feat, left_on='area', right_index=True).reset_index(drop=True)
sub['council'] = sub.area.map(dea2council)
X = sub[FEATS].values.astype(float)
y = sub.nat_pct.values.astype(float)
cy = sub.contest_year.values
w = sub.total.values.astype(float)


def fold_fit(tr, te):
    """Scaler AND ridge fit on training rows only. Returns the shape prediction
    (centred: it predicts y minus the contest level), never a level."""
    sc = StandardScaler().fit(X[tr])
    ctr = pd.Series(y[tr]).groupby(cy[tr]).transform('mean').values  # training levels only
    m = Ridge(alpha=ALPHA).fit(sc.transform(X[tr]), y[tr] - ctr)
    return m.predict(sc.transform(X[te]))


def r2(pred, act):
    return 1 - ((pred - act) ** 2).sum() / ((act - act.mean()) ** 2).sum()


def run_cv(groups, name, level):
    """level='none'  -> score SHAPE only, on values demeaned by the true
                        contest mean. No level credit; this is the number that
                        says whether the census explains WHERE the vote is.
       level='train' -> absolute score, contest level taken from the TRAINING
                        areas of that same contest. Valid only when the fold
                        holds out areas (the contest is still observed).
       level='other' -> absolute score, level taken from the held-out contest's
                        nearest observed sibling contests (persistence). Valid
                        when the fold holds out a whole contest."""
    shp = np.zeros(len(y)); lvl = np.zeros(len(y))
    for g in sorted(set(groups)):
        te = groups == g; tr = ~te
        shp[te] = fold_fit(tr, te)
        if level == 'train':
            for c in set(cy[te]):                       # same contest, training areas
                sel = te & (cy == c); src = tr & (cy == c)
                lvl[sel] = np.average(y[src], weights=w[src]) if src.any() else y[tr].mean()
        elif level == 'other':
            for c in set(cy[te]):                       # other contests (persistence)
                sel = te & (cy == c); src = cy != c
                lvl[sel] = np.average(y[src], weights=w[src])
    if level == 'none':
        act = y - pd.Series(y).groupby(cy).transform('mean').values
        print("  %-28s SHAPE  R2=%+.3f  MAE=%.2f pts  (n=%d)"
              % (name, r2(shp, act), np.abs(shp - act).mean(), len(y)))
        return shp
    pred = shp + lvl
    print("  %-28s ABS    R2=%+.3f  MAE=%.2f pts  (n=%d)"
          % (name, r2(pred, y), np.abs(pred - y).mean(), len(y)))
    return pred


print("\n=== Shape: does the census explain WHERE the vote is? (no level credit) ===")
run_cv(cy, "leave-one-contest-out", 'none')
shape_sp = run_cv(sub.council.values, "leave-one-COUNCIL-out", 'none')

print("\n=== Absolute, with a level the fold did not see ===")
run_cv(cy, "leave-one-contest-out", 'other')
pred_sp = run_cv(sub.council.values, "leave-one-COUNCIL-out", 'train')

print("\n=== Baselines ===")
cmean = pd.Series(y).groupby(cy).transform('mean').values
print("  %-28s ABS    R2=%+.3f  MAE=%.2f pts" % ("contest mean (no model)", r2(cmean, y),
                                                 np.abs(cmean - y).mean()))
amean = pd.Series(y).groupby(sub.area.values).transform('mean').values
print("  %-28s ABS    R2=%+.3f  MAE=%.2f pts  <- the bar a shape model must clear"
      % ("area persistence", r2(amean, y), np.abs(amean - y).mean()))

# multi-scale aggregation, on the SPATIALLY-blocked predictions
print("\n=== Multi-scale (leave-one-council-out predictions) ===")
agg = sub.assign(pred=pred_sp)
for lvl_name, keys in [('council(11)', ['contest_year', 'council']), ('NI(1)', ['contest_year'])]:
    a = agg.groupby(keys).apply(
        lambda d: pd.Series({'act': np.average(d.nat_pct, weights=d.total),
                             'prd': np.average(d.pred, weights=d.total)}), include_groups=False)
    print("  scale %-11s: R2=%+.3f  max|err|=%.2f pts"
          % (lvl_name, r2(a.prd.values, a.act.values), (a.prd - a.act).abs().max()))
print("  (aggregation cannot add validation -- it averages the same errors)")

# full-data fit for the geographic gradient (used in phase 5)
scaler = StandardScaler().fit(X)
mfull = Ridge(alpha=ALPHA).fit(scaler.transform(X),
                               y - pd.Series(y).groupby(cy).transform('mean').values)
coef = pd.Series(mfull.coef_, index=FEATS).sort_values(key=abs, ascending=False)
coef.to_csv(os.path.join(HERE, 'gradient_coefficients.csv'), header=['std_coef'])
print("\nTop census predictors of nationalist share (|std coef|):")
for f, c in coef.head(12).items():
    print("  %+6.2f  %s" % (c, f))
np.save(os.path.join(HERE, '_scaler_mean.npy'), scaler.mean_)
