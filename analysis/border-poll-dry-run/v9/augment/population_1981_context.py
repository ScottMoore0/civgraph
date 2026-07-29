#!/usr/bin/env python3
"""Land the 1981 ward census on the model's Data-Zone frame as long-run population context.

The model's census inputs began at 1991. This reaches twenty years further back, using
data/census/derived/dz21-census-1981.csv (built by
scripts/census/build_1981_ward1972_dz_frame.py from the 1972-ward figures in the printed
1981 Preliminary Report).

WHAT THIS ADDS THAT 1991 CANNOT. 1991 gives a level. This gives the preceding movement:
whether a place was filling or emptying across the 1970s. Those are different signals, and
the 1970s is when the movement was largest -- 298 of the 526 wards lost population while
Craigavon's Brownlow grew 264%. A Data Zone sitting inside a ward that lost a third of its
people in one decade has a history that its 1991 level does not record.

THE TWO COVARIATES, AND WHY ONLY THESE TWO

  pop_change_7181    The 1971->1981 change of the containing 1972 ward. Safe to difference
                     because both years are printed against the SAME ward boundaries, so
                     the change is demographic, not cartographic.

  log_density_ratio_8121  log(2021 DZ density / 1981 ward density). Density is the only
                     defensible cross-vintage comparison: counts are not, because the 1991
                     frame carries 1984-ward totals and this one carries 1972-ward totals,
                     two different partitions, so their difference measures the 1984
                     boundary revision. Logged because the ratio spans orders of magnitude
                     and is multiplicative in character.

TWO CAVEATS THAT ARE NOT SMALL

  Resolution. The value on a Data Zone is its containing 1972 ward's value, so every DZ
  inside one ward shares a number. 1,251 of the 3,780 Data Zones straddle a 1972 ward
  boundary with no ward covering 90% of them -- a third of the frame -- so the assignment
  is a genuine approximation, not a lookup. Wards are coarser than Data Zones; this is
  the next best thing, not an equivalent.

  Ecological. Any relationship found here is between PLACES, not people. That a ward which
  emptied in the 1970s now reads as more Catholic says nothing about who moved.

Output: dz21_population_1981_context.csv
"""
import os
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__)) or '.'
V = os.path.dirname(HERE)
ROOT = os.path.abspath(f'{V}/../../..')

f81 = pd.read_csv(f'{ROOT}/data/census/derived/dz21-census-1981.csv')
f21 = pd.read_csv(f'{V}/dz_features.csv')
pop = pd.read_csv(f'{ROOT}/data/census/derived/ms-a01-dz.csv') \
        .set_index('GeographyCode')['AllUsualResidents']

catcol = next(c for c in f21.columns if c.startswith('rel__Catholic'))

m = f81.merge(f21, left_on='DZ2021_cd', right_on='area', how='inner').copy()
if len(m) != len(f81):
    print(f'  NOTE: {len(f81) - len(m)} Data Zones in the 1981 frame are absent from '
          f'dz_features.csv and are dropped')

m['pop_2021'] = m['DZ2021_cd'].map(pop)
m['dz_density_2021'] = m['pop_2021'] / (m['dz_area_ha'] / 100.0)
m['pop_change_7181'] = m['ward_pop_change_pct']

# Both densities are strictly positive in practice; guard anyway so a zero cannot poison
# the column with -inf.
ok = (m['dz_density_2021'] > 0) & (m['ward_pop_density_1981'] > 0)
m['log_density_ratio_8121'] = np.where(
    ok, np.log(m['dz_density_2021'] / m['ward_pop_density_1981']), np.nan).round(4)

out = m[['DZ2021_cd', 'DZ2021_nm', 'ward_key', 'ward_pop_1971', 'ward_pop_1981',
         'pop_change_7181', 'ward_pop_density_1981', 'dz_density_2021',
         'log_density_ratio_8121', 'ward_male_pct_1981']].copy()
out['dz_density_2021'] = out['dz_density_2021'].round(1)
out.to_csv(f'{HERE}/dz21_population_1981_context.csv', index=False)

# ---- what the new covariate actually looks like against the model's outcome side
n = len(m)
print(f'  {n:,} Data Zones carry 1981 ward context')
print(f'  1971->81 ward change: median {m["pop_change_7181"].median():+.1f}%   '
      f'{(m["pop_change_7181"] < 0).sum():,} DZs sit in a ward that lost population')

# Pearson AND Spearman, because they disagree here and the disagreement is the finding.
# pop_change_7181 runs from -73% to +264%, so a handful of new-town wards dominate the
# squared deviations and flatten Pearson to near zero. The rank correlation, which those
# outliers cannot distort, is what matches the monotone quartile table below. Reporting
# only Pearson would have understated a real gradient; only Spearman, overstated its
# linearity.
print(f'\n  correlation with 2021 Catholic share ({catcol[:34]}):')
for k in ['pop_change_7181', 'log_density_ratio_8121']:
    pear = m[k].corr(m[catcol])
    spear = m[k].corr(m[catcol], method='spearman')
    print(f'    {k:24} pearson {pear:+.3f}   spearman {spear:+.3f}')

q = pd.qcut(m['pop_change_7181'], 4, labels=['Q1 emptied', 'Q2', 'Q3', 'Q4 grew'])
tab = m.groupby(q, observed=True).agg(
    dzs=('DZ2021_cd', 'size'),
    change_7181=('pop_change_7181', 'median'),
    catholic_2021=(catcol, 'mean'),
    pop_2021=('pop_2021', 'sum'))
print('\n  2021 Catholic share by 1970s population trajectory of the containing ward:')
print(f"    {'quartile':12} {'DZs':>5} {'1971-81':>9} {'Cath 2021':>10} {'pop 2021':>10}")
for k, v in tab.iterrows():
    print(f"    {str(k):12} {int(v['dzs']):5} {v['change_7181']:+8.1f}% "
          f"{v['catholic_2021']:9.1f}% {int(v['pop_2021']):10,}")

print(f'\n  wrote {HERE}/dz21_population_1981_context.csv')
print('  Relationships are between places, not people; and the value on each DZ is its '
      'containing 1972 ward\'s.')
