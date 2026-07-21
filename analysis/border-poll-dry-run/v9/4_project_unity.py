#!/usr/bin/env python3
"""v9 phase 5 — project Irish-unity referendum result to Data Zone + demographic
breakdowns. The validated ridge nationalist-propensity (all 88 census attributes)
gives the geographic shape; a data-driven 2-point calibration re-maps it to the
unity poll's community rates + NI level; poststratified per DZ.

Corrections in this revision (see _poststrat.py for rationale):
  * weight by ELIGIBLE ELECTORATE x turnout, not AllUsualResidents (children
    and non-voters no longer carry weight);
  * bounded re-centre so the clipped NI mean actually equals the poll level;
  * nat_NI is vote-weighted, ALPHA is a named constant.
The re-centring target is the poll's ADULT attitude level; a separate
turnout-adjusted result line shows where differential turnout moves it.
"""
import pandas as pd, numpy as np, json, csv, os
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
from _poststrat import REPO, elig_weight, turnout_weight, recentre_clip

# Tuned by leave-one-council-out (the honest spatial CV in 3_fit_validate.py):
# alpha 10 -> LOCO shape MAE 5.53; alpha 50 -> 4.94 (peak, ~11% better). The old
# hard-coded 10 was under-regularised for spatial generalisation, which is exactly
# what the DEA->DZ downscale needs.
ALPHA = 50.0
feat_dea = pd.read_csv('dea_features.csv').set_index('area')
feat_dz = pd.read_csv('dz_features.csv').set_index('area')
FEATS = feat_dea.columns.tolist()
res = pd.read_csv('results_frame.csv')
dea = res[(res.scale == 'dea') & (res.contest == 'local')].copy()
dea = dea[dea.area.isin(feat_dea.index)]
dea['cy'] = dea.contest + dea.year.astype(str)
sc = StandardScaler().fit(feat_dea.values)
ymean = dea.groupby('cy')['nat_pct'].transform('mean').values
m = Ridge(alpha=ALPHA).fit(sc.transform(feat_dea.loc[dea.area].values), dea.nat_pct.values - ymean)
nat_NI = np.average(dea.nat_pct.values, weights=dea.total.values)   # vote-weighted, not a bare mean
# nationalist propensity per DZ (all attributes), + NI baseline
p_nat = m.predict(sc.transform(feat_dz.values)) + nat_NI
dz = pd.DataFrame({'area': feat_dz.index, 'p_nat': p_nat}).set_index('area')
dz['cath'] = feat_dz['rel__Catholic'].values / 100
dz['prot'] = feat_dz[[c for c in FEATS if c.startswith('rel__Protestant')][0]].values / 100
dz['oth'] = (feat_dz['rel__Other religions'].values + feat_dz['rel__None'].values) / 100
pop = pd.read_csv(f"{REPO}/data/census/derived/ms-a01-dz.csv").set_index('GeographyCode')['AllUsualResidents']
dz['pop'] = pop.reindex(dz.index).fillna(0).values
# Two weights, kept distinct:
#   w_adult = voting-age residents          -> re-centre to the poll's ADULT level
#   w_voter = voting-age x census turnout   -> read the turnout-adjusted RESULT
# The gap between them IS the differential-turnout effect on the headline.
adult, _, diag = elig_weight(feat_dz, pop, apply_turnout=False)
turn, turn_r2 = turnout_weight(feat_dz)
dz['w_adult'] = adult.reindex(dz.index).values
dz['w_voter'] = (adult * turn.reindex(adult.index)).reindex(dz.index).values
print(f"electorate weight: voting-age pop {diag['voting_age_pop']:,.0f} "
      f"({diag['voting_age_share']}% of {diag['resident_pop']:,.0f} residents); "
      f"turnout LOO R2={None if turn_r2 != turn_r2 else round(turn_r2, 2)}")
lt = json.load(open(f"{REPO}/analysis/border-poll-dry-run/v3/lucidtalk_unity_rates.json"))
DATES = ['2021-01', '2022-08', '2024-02', '2025-02']
os.makedirs('areas_unity', exist_ok=True)
summary = []
attr_cols = {}
for c in FEATS:
    attr_cols.setdefault(c.split('__')[0], []).append(c)
breakdowns = {}
WA = dz['w_adult'].values                                 # voting-age population
WV = dz['w_voter'].values                                 # likely voters (x turnout)
for date in DATES:
    r = lt[date]
    rC, rP, rO, lvl = r['rate_C'], r['rate_P'], r['rate_O'], r['decided']
    comm = 100 * (rC / 100 * dz.cath + rP / 100 * dz.prot + rO / 100 * dz.oth)  # community-implied unity per DZ
    # data-driven 2-point map p_nat -> unity (captures how propensity relates to unity)
    b = np.polyfit(dz.p_nat, comm, 1)                     # [slope, intercept]
    unity = b[0] * dz.p_nat + b[1]
    # re-centre to the poll's ADULT attitude level (voting-age weighted), bounded
    unity = pd.Series(recentre_clip(unity.values, WA, lvl), index=dz.index)
    # turnout-adjusted RESULT and the old all-resident read, for comparison
    result_level = float(np.average(unity.values, weights=WV))
    resident_level = float(np.average(unity.values, weights=dz['pop'].values))
    with open(f"areas_unity/{date}_DZ21.csv", "w", newline='') as fh:
        w = csv.writer(fh)
        w.writerow(['DZ21', 'catholic_bg_pct', 'proj_unity_pct', 'provenance'])
        for a, cc, uu in zip(dz.index, (dz.cath * 100).round(1), unity.round(1)):
            w.writerow([a, cc, uu, 'modelled'])
    q = np.percentile(unity, [10, 50, 90])
    maj = 100 * np.average((unity > 50), weights=WV)      # % of likely VOTERS in majority-Yes DZs
    summary.append(dict(date=date, ni_level=round(result_level, 1),
                        attitude=round(lvl, 1), resident_wtd=round(resident_level, 1),
                        dz_p10=round(q[0], 1), dz_med=round(q[1], 1), dz_p90=round(q[2], 1),
                        maj=round(maj, 1)))
    # demographic breakdown: likely-voter-weighted mean unity by each attribute category
    bd = {}
    for attr, cols in attr_cols.items():
        for c in cols:
            share = feat_dz[c].reindex(dz.index).values / 100
            wt = WV * share
            if wt.sum() > 0:
                bd[c] = round(float((unity.values * wt).sum() / wt.sum()), 1)
    breakdowns[date] = bd
json.dump(breakdowns, open('breakdowns_unity.json', 'w'), indent=1)
json.dump({'method': 'v9: validated multi-scale census->result ridge (all 88 attrs) gives geographic '
                     'shape; 2-point calibration to the LucidTalk unity poll (community rates + NI level); '
                     'poststratified per Data Zone weighted by eligible electorate x census-fitted turnout '
                     '(not resident population). ni_level is the turnout-adjusted result; resident_wtd is '
                     'the old all-resident read, kept for comparison. Poll dates post-2021-Census -> 2021 attrs.',
           'electorate': diag, 'results': summary},
          open('summary_unity.json', 'w'), indent=1)
print(f"{'date':9}{'attitude':>9}{'result':>7}{'resid':>7}  DZ p10-med-p90   voter-maj%")
for s in summary:
    print(f"{s['date']:9}{s['attitude']:9.1f}{s['ni_level']:7.1f}{s['resident_wtd']:7.1f}  "
          f"{s['dz_p10']:.1f}-{s['dz_med']:.1f}-{s['dz_p90']:.1f}  {s['maj']}")
print("attitude = poll's adult level (re-centre target); result = turnout-adjusted; "
      "resid = old all-resident read.")
print("\nSample breakdown (2024-02) — projected unity by national identity / passport:")
bd = breakdowns['2024-02']
for c in sorted(bd):
    if c.startswith(('natid__', 'pass__', 'irish__')):
        print("  %-52s %.1f" % (c, bd[c]))
