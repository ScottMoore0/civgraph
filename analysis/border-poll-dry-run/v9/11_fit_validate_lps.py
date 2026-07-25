#!/usr/bin/env python3
"""v9 phase 11 — does the LPS address dataset add anything the census does not?

Runs the EXACT validation harness of 3_fit_validate.py (same folds, same ridge,
same leakage guards) over three feature sets:

    census        88 census features                      (the incumbent)
    census+lps    88 census + the LPS address features    (the candidate)
    lps           LPS address features alone              (diagnostic)

The metric that decides is leave-one-COUNCIL-out SHAPE MAE. Leave-one-contest-out
keeps every DEA in training via its other contests and so is close to a persistence
test; spatial blocking is what the DEA(80) -> DZ(3,780) downscale actually relies on.

Pre-registered bar (set before the run, in the feasibility assessment):
    ship only if LOCO shape MAE improves by >= 0.3 pts AND the council/NI
    scale-stability check does not degrade.

Note on family C: the address lexicons are a religion proxy by construction, so
their correlation with census religion is NOT evidence. This script is the only
test that counts, because real election results are an outcome neither the census
nor the lexicon was built from.
"""
import pandas as pd, numpy as np, json, os
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ALPHA = 50.0

census = pd.read_csv(os.path.join(HERE, 'dea_features.csv')).set_index('area')
lps = pd.read_csv(os.path.join(HERE, 'lps', 'lps_features_dea.csv')).set_index('area')
# scale-free versions of the count/density columns so ridge sees comparable units
lps = lps.copy()
for c in ['lps_n_properties', 'lps_spread_m', 'lps_nn_density', 'lps_pc_sectors']:
    if c in lps.columns:
        lps[c] = np.log1p(lps[c])

res = pd.read_csv(os.path.join(HERE, 'results_frame.csv'))
dea = res[(res.scale == 'dea') & (res.contest == 'local')].copy()
lf = json.load(open(f"{REPO}/test/metadata/elections-test2/"
                    "local-government-local-government-districts__2023-05-18.json",
                    encoding='utf-8'))
dea2council = lf['localBodyByConstituency']

common = [a for a in dea.area.unique() if a in census.index and a in lps.index]
print("DEA match: %d areas with census AND LPS features" % len(common))
dea = dea[dea.area.isin(common)]

CENSUS_F = census.loc[common].columns.tolist()
LPS_F = lps.loc[common].columns.tolist()
feat_all = census.join(lps, how='inner')

dea['contest_year'] = dea.contest + dea.year.astype(str)
sub = dea.merge(feat_all, left_on='area', right_index=True).reset_index(drop=True)
sub['council'] = sub.area.map(dea2council)
y = sub.nat_pct.values.astype(float)
cy = sub.contest_year.values
w = sub.total.values.astype(float)


def r2(pred, act):
    return 1 - ((pred - act) ** 2).sum() / ((act - act.mean()) ** 2).sum()


def fold_fit(X, tr, te):
    sc = StandardScaler().fit(X[tr])
    ctr = pd.Series(y[tr]).groupby(cy[tr]).transform('mean').values
    m = Ridge(alpha=ALPHA).fit(sc.transform(X[tr]), y[tr] - ctr)
    return m.predict(sc.transform(X[te]))


def run_cv(X, groups, level):
    shp = np.zeros(len(y)); lvl = np.zeros(len(y))
    for g in sorted(set(groups)):
        te = groups == g; tr = ~te
        shp[te] = fold_fit(X, tr, te)
        if level == 'train':
            for c in set(cy[te]):
                sel = te & (cy == c); src = tr & (cy == c)
                lvl[sel] = np.average(y[src], weights=w[src]) if src.any() else y[tr].mean()
        elif level == 'other':
            for c in set(cy[te]):
                sel = te & (cy == c); src = cy != c
                lvl[sel] = np.average(y[src], weights=w[src])
    if level == 'none':
        act = y - pd.Series(y).groupby(cy).transform('mean').values
        return r2(shp, act), np.abs(shp - act).mean(), shp
    pred = shp + lvl
    return r2(pred, y), np.abs(pred - y).mean(), pred


SETS = {'census': CENSUS_F, 'census+lps': CENSUS_F + LPS_F, 'lps': LPS_F}
X = {k: sub[v].values.astype(float) for k, v in SETS.items()}

print("\n=== SHAPE, leave-one-CONTEST-out (weak design: near-persistence) ===")
for k in SETS:
    r, mae, _ = run_cv(X[k], cy, 'none')
    print("  %-12s (%3d feats)  R2=%+.3f  MAE=%.2f pts" % (k, len(SETS[k]), r, mae))

print("\n=== SHAPE, leave-one-COUNCIL-out  <-- THE DECIDING METRIC ===")
base_mae = None; preds = {}
for k in SETS:
    r, mae, shp = run_cv(X[k], sub.council.values, 'none')
    if k == 'census':
        base_mae = mae
    delta = "" if k == 'census' else "   delta MAE = %+.2f pts" % (mae - base_mae)
    print("  %-12s (%3d feats)  R2=%+.3f  MAE=%.2f pts%s" % (k, len(SETS[k]), r, mae, delta))

print("\n=== ABSOLUTE, leave-one-COUNCIL-out (level from training areas) ===")
for k in SETS:
    r, mae, pred = run_cv(X[k], sub.council.values, 'train')
    preds[k] = pred
    print("  %-12s  R2=%+.3f  MAE=%.2f pts" % (k, r, mae))

print("\n=== Multi-scale stability (leave-one-council-out predictions) ===")
for k in ['census', 'census+lps']:
    agg = sub.assign(pred=preds[k])
    out = []
    for name, keys in [('council(11)', ['contest_year', 'council']), ('NI(1)', ['contest_year'])]:
        a = agg.groupby(keys).apply(
            lambda d: pd.Series({'act': np.average(d.nat_pct, weights=d.total),
                                 'prd': np.average(d.pred, weights=d.total)}),
            include_groups=False)
        out.append("%s R2=%+.3f max|err|=%.2f" % (name, r2(a.prd.values, a.act.values),
                                                  (a.prd - a.act).abs().max()))
    print("  %-12s  %s" % (k, "   ".join(out)))

# Which LPS features earn their place, net of the census?
print("\n=== LPS coefficients in the joint model (std units, full-data fit) ===")
Xj = X['census+lps']
sc = StandardScaler().fit(Xj)
mj = Ridge(alpha=ALPHA).fit(sc.transform(Xj),
                            y - pd.Series(y).groupby(cy).transform('mean').values)
coefs = pd.Series(mj.coef_, index=SETS['census+lps'])
lc = coefs[LPS_F].sort_values(key=abs, ascending=False)
for f, c in lc.items():
    print("  %+6.3f  %s" % (c, f))
print("\n  largest |LPS coef| = %.3f vs largest |census coef| = %.3f"
      % (lc.abs().max(), coefs[CENSUS_F].abs().max()))

json.dump({'lps_coefficients': lc.to_dict()},
          open(os.path.join(HERE, 'lps_validation.json'), 'w'), indent=1)
print("\nwrote lps_validation.json")

# ---------------------------------------------------------------------------
# Is the degradation just dimensionality (18 features on 80 training rows), or
# do the LPS features carry no usable signal at all? Greedy forward selection on
# the SAME spatially-blocked metric answers it. If even the single best LPS
# feature cannot beat the census baseline, the answer is "no usable signal".
print("\n=== Greedy forward selection of LPS features (leave-one-council-out shape MAE) ===")
gr = sub.council.values


def loco_mae(feats):
    return run_cv(sub[feats].values.astype(float), gr, 'none')[1]


base = loco_mae(CENSUS_F)
print("  census baseline                       MAE=%.2f" % base)
singles = sorted(((loco_mae(CENSUS_F + [f]), f) for f in LPS_F))
print("  best 5 single additions:")
for mae, f in singles[:5]:
    print("    %-24s MAE=%.2f  (%+.2f)" % (f, mae, mae - base))

chosen, cur = [], base
while True:
    cand = sorted(((loco_mae(CENSUS_F + chosen + [f]), f)
                   for f in LPS_F if f not in chosen))
    if not cand or cand[0][0] >= cur - 1e-9:
        break
    cur, f = cand[0]
    chosen.append(f)
    print("  + %-24s MAE=%.2f  (%+.2f vs baseline)" % (f, cur, cur - base))
if chosen:
    print("  selected: %s  -> MAE %.2f (%+.2f vs census-only)" % (chosen, cur, cur - base))
else:
    print("  NOTHING SELECTED: no LPS feature improves the spatially-blocked metric.")
