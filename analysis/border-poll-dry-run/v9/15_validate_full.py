#!/usr/bin/env python3
"""v9 phase 15 — validate the FULL LPS valuation/era features against real results.

Same harness as 3_fit_validate.py and 11_: identical folds, identical ridge,
identical leakage guards. Leave-one-COUNCIL-out SHAPE MAE is the deciding metric.

Feature sets compared:
    census          88 census features (the incumbent)
    census+lpsf     census + LPS valuation/era/form features
    lpsf            LPS valuation/era/form alone
    census+addr     census + the phase-10 address-gazetteer features (for contrast)
    census+all      census + valuation/era + address

Pre-registered bar: LOCO shape MAE must improve by >= 0.30 pts.

Usage: python 15_validate_full.py
"""
import pandas as pd, numpy as np, json, os
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ALPHA = 50.0
L = os.path.join(HERE, 'lps')

census = pd.read_csv(os.path.join(HERE, 'dea_features.csv')).set_index('area')
lpsf = pd.read_csv(os.path.join(L, 'lps_full_dea.csv')).set_index('area')
addr = pd.read_csv(os.path.join(L, 'lps_features_dea.csv')).set_index('area')
nd = pd.read_csv(os.path.join(L, 'nd_features_dea.csv')).set_index('area')
for c in ['nd_n', 'nd_nav_total', 'nd_nav_mean', 'nd_nav_median', 'nd_inst_n',
          'nd_n_catholic', 'nd_n_protestant', 'nd_n_institutional']:
    if c in nd.columns:
        nd[c] = np.log1p(nd[c])

for df, cols in [(lpsf, ['lpsf_n', 'lpsf_cv_median', 'lpsf_size_median', 'lpsf_density']),
                 (addr, ['lps_n_properties', 'lps_spread_m', 'lps_nn_density', 'lps_pc_sectors'])]:
    for c in cols:
        if c in df.columns:
            df[c] = np.log1p(df[c])

# drop zero-variance columns (a band absent from the data adds nothing)
lpsf = lpsf.loc[:, lpsf.std() > 0]
addr = addr.loc[:, addr.std() > 0]
nd = nd.loc[:, nd.std() > 0]

res = pd.read_csv(os.path.join(HERE, 'results_frame.csv'))
dea = res[(res.scale == 'dea') & (res.contest == 'local')].copy()
lf = json.load(open(f"{REPO}/render/metadata/elections-test2/"
                    "local-government-local-government-districts__2023-05-18.json",
                    encoding='utf-8'))
dea2council = lf['localBodyByConstituency']

feat = census.join(lpsf, how='inner').join(addr, how='inner').join(nd, how='inner')
common = [a for a in dea.area.unique() if a in feat.index]
print("DEA match: %d areas" % len(common))
dea = dea[dea.area.isin(common)]

CF = census.columns.tolist()
LF = lpsf.columns.tolist()
AF = addr.columns.tolist()
NF = nd.columns.tolist()
print("features: census=%d  lps_valuation=%d  lps_address=%d  nondomestic=%d"
      % (len(CF), len(LF), len(AF), len(NF)))

dea['contest_year'] = dea.contest + dea.year.astype(str)
sub = dea.merge(feat, left_on='area', right_index=True).reset_index(drop=True)
sub['council'] = sub.area.map(dea2council)
y = sub.nat_pct.values.astype(float)
cy = sub.contest_year.values
w = sub.total.values.astype(float)


def r2(pred, act):
    return 1 - ((pred - act) ** 2).sum() / ((act - act.mean()) ** 2).sum()


def run_cv(X, groups, level='none'):
    shp = np.zeros(len(y)); lvl = np.zeros(len(y))
    for g in sorted(set(groups)):
        te = groups == g; tr = ~te
        sc = StandardScaler().fit(X[tr])
        ctr = pd.Series(y[tr]).groupby(cy[tr]).transform('mean').values
        m = Ridge(alpha=ALPHA).fit(sc.transform(X[tr]), y[tr] - ctr)
        shp[te] = m.predict(sc.transform(X[te]))
        if level == 'train':
            for c in set(cy[te]):
                sel = te & (cy == c); src = tr & (cy == c)
                lvl[sel] = np.average(y[src], weights=w[src]) if src.any() else y[tr].mean()
    if level == 'none':
        act = y - pd.Series(y).groupby(cy).transform('mean').values
        return r2(shp, act), np.abs(shp - act).mean(), shp
    pred = shp + lvl
    return r2(pred, y), np.abs(pred - y).mean(), pred


SETS = {'census': CF, 'census+lpsf': CF + LF, 'lpsf': LF,
        'census+nd': CF + NF, 'nd': NF,
        'census+lpsf+nd': CF + LF + NF,
        'census+addr': CF + AF, 'census+all': CF + LF + AF + NF}

print("\n=== SHAPE, leave-one-CONTEST-out (weak design) ===")
for k, f in SETS.items():
    r, mae, _ = run_cv(sub[f].values.astype(float), cy)
    print("  %-13s (%3d)  R2=%+.3f  MAE=%.2f" % (k, len(f), r, mae))

print("\n=== SHAPE, leave-one-COUNCIL-out  <-- DECIDING METRIC ===")
base = None
for k, f in SETS.items():
    r, mae, _ = run_cv(sub[f].values.astype(float), sub.council.values)
    if k == 'census':
        base = mae
    d = "" if k == 'census' else "   delta=%+.2f" % (mae - base)
    print("  %-13s (%3d)  R2=%+.3f  MAE=%.2f%s" % (k, len(f), r, mae, d))

print("\n=== Greedy forward selection from the LPS valuation set ===")
gr = sub.council.values


def loco(fs):
    return run_cv(sub[fs].values.astype(float), gr)[1]


b = loco(CF)
print("  census baseline           MAE=%.2f" % b)
CAND = LF + NF
singles = sorted(((loco(CF + [f]), f) for f in CAND))
print("  best 6 single additions:")
for mae, f in singles[:6]:
    print("    %-22s MAE=%.2f  (%+.2f)" % (f, mae, mae - b))

chosen, cur = [], b
while True:
    cand = sorted(((loco(CF + chosen + [f]), f) for f in CAND if f not in chosen))
    if not cand or cand[0][0] >= cur - 1e-9:
        break
    cur, f = cand[0]
    chosen.append(f)
    print("  + %-22s MAE=%.2f  (%+.2f vs baseline)" % (f, cur, cur - b))
print("  selected: %s -> %.2f (%+.2f)" % (chosen or 'NONE', cur, cur - b))

print("\n=== LPS valuation coefficients in the joint model ===")
Xj = sub[CF + LF].values.astype(float)
sc = StandardScaler().fit(Xj)
mj = Ridge(alpha=ALPHA).fit(sc.transform(Xj),
                            y - pd.Series(y).groupby(cy).transform('mean').values)
co = pd.Series(mj.coef_, index=CF + LF)
for f, c in co[LF].sort_values(key=abs, ascending=False).items():
    print("  %+6.3f  %s" % (c, f))

json.dump({'selected': chosen, 'loco_mae_census': b, 'loco_mae_selected': cur},
          open(os.path.join(HERE, 'lps_full_validation.json'), 'w'), indent=1)
print("\nwrote lps_full_validation.json")
