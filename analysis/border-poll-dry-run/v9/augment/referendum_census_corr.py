#!/usr/bin/env python3
"""Descriptive: how NISRA census composition relates to referendum turnout and Yes/No.
Not a backtest -- just correlations, for context. Three referendums, very different data depth:
  - 2011 AV: 8 counting areas (turnout + Yes); census composition approximate -> indicative only.
  - 1998 GFA: NI-wide only (Yes 71.1, turnout 81.1); no sub-NI Yes/No exists -> structural note.
  - 2016 EU: 18 constituencies (turnout + Remain), real join to constituency census features -> the
    rigorous version of exactly this question."""
import numpy as np, pandas as pd
V="analysis/border-poll-dry-run/v9"

# ---------------- 2016 EU referendum (n=18, real census join) ----------------
eu=pd.DataFrame([r.split('|') for r in """Belfast East|66.2|48.6
Belfast North|57.4|50.36
Belfast South|66.9|69.49
Belfast West|48.9|74.06
East Antrim|65|44.8
East Londonderry|59.7|52.03
Fermanagh and South Tyrone|67.8|58.56
Foyle|57.2|78.26
Lagan Valley|66.3|46.9
Mid Ulster|61.6|60.39
Newry and Armagh|63.9|63.14
North Antrim|64.7|37.8
North Down|67.3|52.36
South Antrim|63.1|49.4
South Down|62.2|67.24
Strangford|64.2|44.5
Upper Bann|63.6|47.4
West Tyrone|61.7|66.85""".splitlines()],columns=['con','turnout','remain'])
eu['turnout']=eu['turnout'].astype(float); eu['remain']=eu['remain'].astype(float)
eu['con']=eu['con'].str.upper()
cf=pd.read_csv(f"{V}/constituency_features.csv"); cf['con']=cf['con'].str.upper()
# interpretable census composites
def col(df,frag):
    m=[x for x in df.columns if frag.lower() in x.lower()]; return df[m].sum(axis=1) if m else pd.Series(0,index=df.index)
feat=pd.DataFrame({'con':cf['con']})
feat['catholic_bg']=cf['rel__Catholic']
feat['irish_identity']=col(cf,'natid__Irish only')
feat['no_religion']=cf['rel__None']
feat['uk_passport']=col(cf,'pass__United Kingdom only')
feat['owner_occ']=col(cf,'ten__Owner occupied')
feat['social_rent']=col(cf,'ten__Social rented')
feat['higher_nssec']=col(cf,'L1') # L1/L2/L3 higher managerial/prof (ABC1 proxy)
feat['degree']=col(cf,'Level 4') if any('level 4' in x.lower() for x in cf.columns) else col(cf,'degree')
feat['no_quals']=col(cf,'No qualification')
feat['age65']=col(cf,'age__65') if any('age__65' in x.lower() for x in cf.columns) else pd.Series(np.nan,index=cf.index)
m=eu.merge(feat,on='con')
print("="*70); print("2016 EU REFERENDUM — census correlates (n=18 constituencies, REAL join)")
print("="*70)
census_vars=[c for c in feat.columns if c!='con' and m[c].notna().all() and m[c].std()>0]
def corrs(target):
    out=[(v,np.corrcoef(m[target],m[v])[0,1]) for v in census_vars]
    return sorted(out,key=lambda x:-abs(x[1]))
print("\nREMAIN % vs census composition (Pearson r):")
for v,r in corrs('remain'): print(f"   {v:16s} r = {r:+.2f}")
print("\nTURNOUT % vs census composition (Pearson r):")
for v,r in corrs('turnout'): print(f"   {v:16s} r = {r:+.2f}")
print(f"\n   corr(Remain, turnout) = {np.corrcoef(m['remain'],m['turnout'])[0,1]:+.2f}")
print(f"   highest Remain: {m.nlargest(3,'remain')['con'].tolist()}  lowest: {m.nsmallest(3,'remain')['con'].tolist()}")
print(f"   highest turnout: {m.nlargest(3,'turnout')['con'].tolist()}  lowest: {m.nsmallest(3,'turnout')['con'].tolist()}")
m.round(2).to_csv(f"{V}/augment/euref2016_census_corr.csv",index=False)

# ---------------- 2011 AV referendum (n=8 counting areas, APPROX composition) ----------------
print("\n"+"="*70); print("2011 AV REFERENDUM — 8 counting areas (turnout + Yes); composition APPROX")
print("="*70)
av=pd.DataFrame([
 ("Ballymena",60.1,42.0,24),("Banbridge 1",60.4,45.8,42),("Banbridge 2",53.7,40.4,44),
 ("Belfast",55.3,59.7,42),("Londonderry",55.3,50.0,55),("Newtownabbey",50.3,39.4,22),
 ("Newtownards",48.7,30.6,14),("Omagh",67.1,46.7,60)],
 columns=['area','turnout','yes','cath_approx'])
print(av.to_string(index=False))
print(f"\n  corr(Yes, approx Catholic%)  = {np.corrcoef(av['yes'],av['cath_approx'])[0,1]:+.2f}  (n=8; Belfast is an urban outlier)")
print(f"  corr(turnout, approx Catholic%)= {np.corrcoef(av['turnout'],av['cath_approx'])[0,1]:+.2f}")
print(f"  corr(turnout, Yes)           = {np.corrcoef(av['turnout'],av['yes'])[0,1]:+.2f}")
print("  NB: Catholic% here is an INDICATIVE estimate per count-centre (no clean census join to")
print("      the 8 AV counting areas); n=8 so these are directional, not inferential.")
av.to_csv(f"{V}/augment/avref2011_areas.csv",index=False)

# ---------------- 1998 GFA referendum (NI-wide only) ----------------
print("\n"+"="*70); print("1998 GFA REFERENDUM — NI-wide only")
print("="*70)
print("  NI-wide: Yes 71.1%, turnout 81.1% (electorate 1,175,403). No constituency Yes/No breakdown")
print("  exists in the data (it was declared NI-wide). Structural reason a census correlation of the")
print("  Yes vote would be near-null even with the data: the Yes was CROSS-COMMUNITY -- ~96% of")
print("  Catholics AND a majority (~55%) of Protestants voted Yes -- so it did not split on the")
print("  religion axis the census measures. Turnout by constituency (demographically structured)")
print("  WOULD correlate, but constituency turnout for 1998 is not in the repo.")
print("\nwrote euref2016_census_corr.csv, avref2011_areas.csv")
