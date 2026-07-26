#!/usr/bin/env python3
"""v9 phase 55 — deprivation on all three census geographies, and the 2005/2010 recovery.

Phase 30 brought NIMDM-2017 (Small Area) onto DZ2021 with an inline centroid join.
That left two things on the floor:

  1. The centroid join reached only 2,840 of 3,780 Data Zones. Phase 52's areal
     weights reach 3,780/3,780, so the same source now covers every Data Zone.
  2. NIMDM 2005 and NIMDM 2010 sat unused in data/census/derived/ because they are
     published on OUTPUT AREAS (5,022 units, OA2001) and the model had no OA crosswalk.
     It does now. That turns a single 2017 snapshot into a 2005/2010/2017 series, which
     is the difference between "how deprived is this area" and "which way is it moving".

Apportionment. 2005 and 2010 publish SCORES; 2017 as held here publishes only ranks,
so ranks are converted to percentiles (100 = most deprived) before aggregating. Income
and Employment scores are proportions of the resident population, so they are carried
across as counts (score x population, summed, divided by summed population). Composite
indices (EDM/MDM) are not proportions of anything and are carried as population-
weighted means, which is the defensible default rather than a correct one.

Weights are the phase-52 areal weights multiplied by the source unit's own population
(2001 census KS01 for OA2001; 2021 for SA2011), so a Data Zone drawing from a large
and a small OA is not pulled equally by both.
"""
import os, re, sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(HERE, "..", "..", ".."))
DER = os.path.join(REPO, 'data', 'census', 'derived')
OACODE = re.compile(r'^\d{2}[A-Z]{2}\d{6}$')


def oa_pop():
    d = pd.read_csv(os.path.join(DER, 'oa2001-census-2001.csv')).set_index('OA_CODE')
    return d.total_pop.astype(float)


def sa_pop():
    p = pd.read_csv(os.path.join(DER, 'census-2011-sa.csv'))
    col = 'AllUsualResidents' if 'AllUsualResidents' in p.columns else p.columns[1]
    return p.set_index('SA2011')[col].astype(float)


def carry(src, srccol, wfile, sid, tid, popser, prop_cols, mean_cols):
    """Areal+population weighted transfer of deprivation measures onto `tid`."""
    w = pd.read_csv(os.path.join(DER, wfile))
    w['pw'] = w.weight * w[sid].map(popser).fillna(0.0)
    m = w.merge(src.rename(columns={srccol: sid}), on=sid, how='left')
    m = m[m.pw > 0]
    out = {}
    g = m.groupby(tid)
    denom = g.pw.sum()
    for c in prop_cols + mean_cols:
        if c not in m.columns:
            continue
        v = pd.to_numeric(m[c], errors='coerce')
        out[c] = (m.pw * v).groupby(m[tid]).sum() / denom
    r = pd.DataFrame(out)
    r['_pop'] = denom
    return r


def rank_to_pct(s):
    """NIMDM rank 1 = most deprived -> percentile where 100 = most deprived."""
    v = pd.to_numeric(s, errors='coerce')
    return 100.0 * (1.0 - (v - 1) / (v.max() - 1))


def main():
    print("=" * 78)
    print("PHASE 55 — deprivation across OA2001 / SA2011 / DZ2021, 2005-2010-2017")
    op, sp = oa_pop(), sa_pop()
    print(f"  weights: OA2001 pop {op.sum():,.0f}   SA2011 pop {sp.sum():,.0f}")

    # ---------------- NIMDM 2005 and 2010, native OA2001 ----------------
    n05 = pd.read_csv(os.path.join(DER, 'nimdm-2005-oa.csv'))
    n05 = n05[n05.code.astype(str).str.match(OACODE)]
    n05['dep_pct'] = rank_to_pct(n05.EDM_rank)
    n10 = pd.read_csv(os.path.join(DER, 'nimdm-2010-oa.csv'))
    n10 = n10[n10.code.astype(str).str.match(OACODE)]
    n10['dep_pct'] = rank_to_pct(n10.MDM_rank)
    print(f"  NIMDM 2005: {len(n05):,} OAs    NIMDM 2010: {len(n10):,} OAs")

    n17 = pd.read_csv(os.path.join(DER, 'nimdm-2017-sa.csv'))
    n17['dep_pct'] = rank_to_pct(n17.MDM_rank)
    n17['income_pct'] = rank_to_pct(n17.Income_rank)
    n17['employ_pct'] = rank_to_pct(n17.Employment_rank)
    print(f"  NIMDM 2017: {len(n17):,} SAs")

    specs = [
        ('2005', n05, 'code', op, ['Income_score', 'Employment_score'],
         ['EDM_score', 'dep_pct'], 'oa2001'),
        ('2010', n10, 'code', op, ['Income Deprivation_score', 'Employment Deprivation_score'],
         ['MDM_score', 'dep_pct'], 'oa2001'),
        ('2017', n17, 'SA2011', sp, [], ['dep_pct', 'income_pct', 'employ_pct'],
         'sa2011'),
    ]

    for tgt, tid in [('dz2021', 'DZ2021_cd'), ('sa2011', 'SA2011'),
                     ('oa2001', 'OA_CODE')]:
        frames = []
        for year, src, sidcol, popser, prop, mean, srcgeo in specs:
            if srcgeo == tgt:
                r = src.set_index(sidcol)[prop + mean].apply(
                    pd.to_numeric, errors='coerce')
                r.index.name = tid
            else:
                wf = f'{srcgeo}_to_{tgt}_weights.csv'
                if not os.path.exists(os.path.join(DER, wf)):
                    continue
                sid = 'OA_CODE' if srcgeo == 'oa2001' else 'SA2011'
                r = carry(src, sidcol, wf, sid, tid, popser, prop, mean)
                r = r.drop(columns=['_pop'], errors='ignore')
            r = r.add_prefix(f'nimdm{year}_')
            frames.append(r)
        if not frames:
            continue
        D = pd.concat(frames, axis=1)
        D.index.name = tid
        out = os.path.join(DER, f'deprivation-series-{tgt}.csv')
        D.to_csv(out)
        cov = {y: int(D[f'nimdm{y}_dep_pct'].notna().sum()) for y in
               ('2005', '2010', '2017') if f'nimdm{y}_dep_pct' in D.columns}
        print(f"\n  {tgt}: {D.shape[0]:,} units -> deprivation-series-{tgt}.csv")
        print(f"    coverage " + "  ".join(f"{y} {c:,}" for y, c in cov.items()))

    # ---------------- what the series buys: movement, not level ----------------
    D = pd.read_csv(os.path.join(DER, 'deprivation-series-dz2021.csv')).set_index('DZ2021_cd')
    ok = D[['nimdm2005_dep_pct', 'nimdm2010_dep_pct', 'nimdm2017_dep_pct']].dropna()
    print(f"\n  Data Zones with all three vintages: {len(ok):,}/3,780")
    c = ok.corr()
    print(f"    corr(2005,2010) {c.iloc[0,1]:.3f}   corr(2010,2017) {c.iloc[1,2]:.3f}"
          f"   corr(2005,2017) {c.iloc[0,2]:.3f}")
    delta = ok.nimdm2017_dep_pct - ok.nimdm2005_dep_pct
    print(f"    2005->2017 change in deprivation percentile: "
          f"sd {delta.std():.1f}, p10 {delta.quantile(.1):+.1f}, "
          f"p90 {delta.quantile(.9):+.1f}")
    print(f"    Data Zones moving >20 percentiles: {(delta.abs()>20).sum():,} "
          f"({100*(delta.abs()>20).mean():.1f}%)")
    print("    (a static 2017 snapshot cannot see any of this movement)")

    print("\n  phase 30 comparison: centroid join reached 2,840/3,780 Data Zones;")
    print(f"    areal weights reach {int(D['nimdm2017_dep_pct'].notna().sum()):,}/3,780")


if __name__ == '__main__':
    main()
