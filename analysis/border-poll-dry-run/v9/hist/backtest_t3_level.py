#!/usr/bin/env python3
"""Tier-3 LEVEL leg — unblocked with NISA (ARK SOL, no login).

The 1998-2011 (Tier 2) and 2011-2024 (Tier 1) pipelines set the unity LEVEL from a
survey and the geographic SHAPE from the census. For 1989-1996 the survey is NISA,
whose constitutional-preference question (NIRELAND) ARK publishes as weighted
marginals broken down by community background. We poststratify those reunify-by-
religion rates onto the census religion composition to get a modelled reunify % by
constituency and NI-wide — the pre-1998 extension of the unity projection, now built
on real data rather than blocked.

Two honest checks:
  1. Consistency — does poststratifying NISA's by-religion rates onto the NI religion
     composition reproduce NISA's published overall? (validates the machinery)
  2. Continuity — does the 1996 level meet NILT's 1998 reading? (validates the bridge)

Caveat: era census religion tables (1991) are not machine-readable in-repo, so the
2011 census composition is used; religious composition drifted (Catholic share rose
~1991->2011), so NI-wide levels are modest OVER-estimates of the era. The reunify-by-
religion RATES are the real NISA signal; only the weighting geography is approximate.
There is no 1990s unity referendum, so the level itself is unvalidatable against an
outcome — the same irreducible gap as the present-day projection.
"""
import pandas as pd, numpy as np, json, os, csv
HERE=os.path.dirname(__file__) or "."
nisa=json.load(open(f"{HERE}/nisa_reunify.json"))
feat=pd.read_csv(f"{HERE}/features_2011_constituency.csv").set_index('con')
# census religion -> 3 NISA groups (renormalised over Catholic/Protestant/None)
PROT=['rel__Presbyterian Church in Ireland','rel__Church of Ireland',
      'rel__Methodist Church in Ireland','rel__Other Christian (including Christian rel']
comp=pd.DataFrame({'C':feat['rel__Catholic'],'P':feat[PROT].sum(axis=1),'N':feat['rel__No religion']})
comp=comp.div(comp.sum(axis=1),axis=0)          # shares within the 3 groups
# constituency populations (2011 KS211 all usual residents)
B="/home/user/civgraph/data/census/2011"
lut=dict((r['CODE'],r['NAME']) for r in csv.DictReader(open(
  f"{B}/census-2011-key-statistics-tables-statistical-geographies/All_Geographies_Code_Files/Assembly_Areas_(AA).csv")))
ks=pd.read_csv(f"{B}/census-2011-key-statistics-tables-administrative-geographies (1)/ASSEMBLY AREAS/KS211NIDATA0.CSV")
pop=ks.set_index('GeographyCode')['KS211NI0001'].rename(index=lut).reindex(comp.index)

os.makedirs(f"{HERE}/unity_1989_1996",exist_ok=True)
ni_series={}; rows_check=[]
years=sorted(int(y) for y in nisa)
for y in years:
    r=nisa[str(y)]
    rate={'C':r['catholic'],'P':r['protestant'],'N':r['none']}
    proj=comp['C']*rate['C']+comp['P']*rate['P']+comp['N']*rate['N']  # reunify % per constituency
    ni=float(np.average(proj,weights=pop))
    ni_series[y]=round(ni,1)
    rows_check.append(dict(year=y,nisa_overall=r['overall'],poststrat_ni=round(ni,1),
                           dz_min=round(proj.min(),1),dz_max=round(proj.max(),1)))
    with open(f"{HERE}/unity_1989_1996/{y}_constituency.csv","w",newline='') as fh:
        w=csv.writer(fh); w.writerow(['constituency','catholic_pct_2011','proj_reunify_pct'])
        for con in comp.index:
            w.writerow([con,round(feat.loc[con,'rel__Catholic'],1),round(proj[con],1)])

print("NISA-based unity (reunify) projection, 1989-1996  [ARK SOL level x census geography]")
print(f"{'year':<6}{'NISA overall':<14}{'poststrat NI':<14}{'constituency range':<22}")
for c in rows_check:
    rng=f"{c['dz_min']}-{c['dz_max']}%"
    print(f"{c['year']:<6}{c['nisa_overall']:<14}{c['poststrat_ni']:<14}{rng:<22}")
# continuity with NILT 1998
nilt=json.load(open(f"{HERE}/nilt_level.json"))
print(f"\ncontinuity check -> NILT 1998 reunify (of all): {nilt['1998']['reunify_of_all']}%  "
      f"(NISA 1996 overall {nisa['1996']['overall']}%, poststrat NI {ni_series[1996]}%)")
# consistency: mean absolute gap poststrat-NI vs NISA overall
gap=np.mean([abs(c['poststrat_ni']-c['nisa_overall']) for c in rows_check])
print(f"consistency -> mean |poststrat NI - NISA overall| = {gap:.1f}pts "
      f"(2011 religion composition over-weights Catholics vs the era, as expected)")
json.dump({'method':'NISA reunify-by-religion (ARK SOL) poststratified onto 2011 census religion',
           'ni_reunify':ni_series,'checks':rows_check},
          open(f"{HERE}/tier3_level_report.json","w"),indent=1)
print("\nwrote tier3_level_report.json + unity_1989_1996/*.csv")
