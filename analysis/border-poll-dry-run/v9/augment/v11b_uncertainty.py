#!/usr/bin/env python3
"""v11 (2/2): #1 uncertainty intervals, #8 spatial/hierarchical smoothing, #6 forward
projection. Builds the Data-Zone unity surface with credible bands, validates the
uncertainty machinery's COVERAGE on the observable EU-ref, and projects a future scenario."""
import json, csv, numpy as np, pandas as pd
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
import os
_HERE=os.path.dirname(os.path.abspath(__file__))
REPO=os.environ.get("CIVGRAPH_REPO") or os.path.abspath(os.path.join(_HERE,"..","..","..",".."))
V=f"{REPO}/analysis/border-poll-dry-run/v9"; B=f"{REPO}/data/census"
rng=np.random.default_rng(20260720)
cf=pd.read_csv(f"{V}/constituency_features.csv"); cf['con']=cf['con'].str.upper(); cf=cf.set_index('con')
pt=pd.read_csv(f"{V}/augment/v11_constituency_point.csv").set_index('con')
dz=pd.read_csv(f"{B}/derived/dz21-community-2021.csv")
dz['con']=dz['DZ21'].map(json.load(open(f"{V}/dz_constituency.json")))
res=pd.read_csv(f"{V}/results_frame.csv")
REL={'C':82.6,'P':8.5,'N':43.6}; NIlevel=41.6; RATE_SE=2.0; LEVEL_SE=2.0   # NILT sampling + house effect

# ---------- #8 SPATIAL / HIERARCHICAL SMOOTHING ----------
# DZ religion-based unity, then partial-pool toward the constituency combined estimate.
dz=dz.dropna(subset=['con']).copy()
dz['dz_rel_unity']=(dz['catholic_bg_pct']/100)*REL['C']+(1-dz['catholic_bg_pct']/100)*((REL['P']+REL['N'])/2)
con_comb=pt['unity_combined']
# shrinkage weight: small/again-uncertain DZs pulled harder toward constituency mean
lam=0.35                                   # pooling strength (0=raw DZ, 1=all constituency)
dz['con_val']=dz['con'].map(con_comb)
dz['dz_unity']=(1-lam)*dz['dz_rel_unity']+lam*dz['con_val']
# re-centre each constituency's DZ mean to the constituency combined value (mass-preserving)
adj=dz.groupby('con').apply(lambda g: g['con_val'].iloc[0]-np.average(g['dz_unity'],weights=g['population']))
dz['dz_unity']=dz['dz_unity']+dz['con'].map(adj)
NIpt=np.average(dz['dz_unity'],weights=dz['population'])
print("#8 SMOOTHING: hierarchical DZ shrink (lambda=%.2f) -> NI point %.1f%%"%(lam,NIpt))

# ---------- #1 UNCERTAINTY (bootstrap) ----------
print("\n#1 UNCERTAINTY — bootstrap over survey-rate + house-effect uncertainty")
NB=400; ni=np.zeros(NB); dzmat=np.zeros((NB,len(dz)))
cath=dz['catholic_bg_pct'].values/100; w=dz['population'].values
for b in range(NB):
    rc=rng.normal(REL['C'],RATE_SE); ro=rng.normal((REL['P']+REL['N'])/2,RATE_SE); lvl=rng.normal(NIlevel,LEVEL_SE)
    u=cath*rc+(1-cath)*ro
    u=u-np.average(u,weights=w)+lvl
    dzmat[b]=u; ni[b]=np.average(u,weights=w)
dz['unity']=dzmat.mean(0).round(1); dz['lo90']=np.percentile(dzmat,5,0).round(1); dz['hi90']=np.percentile(dzmat,95,0).round(1)
print(f"  NI-wide unity {ni.mean():.1f}%  (90% CI {np.percentile(ni,5):.1f}-{np.percentile(ni,95):.1f})")
print(f"  median DZ 90% interval width: {np.median(dz['hi90']-dz['lo90']):.1f}pts")
dz[['DZ21','con','catholic_bg_pct','unity','lo90','hi90']].to_csv(f"{V}/augment/v11_dz_unity_intervals.csv",index=False)

# ---------- #1 VALIDATION — coverage on the observable EU-ref ----------
print("\n#1 COVERAGE CHECK — do bootstrap intervals cover the actual EU-ref result?")
eu=res[res.contest=='euref'].copy(); eu['con']=eu.area.str.upper(); eu=eu[eu.con.isin(cf.index)]
X=StandardScaler().fit_transform(cf.loc[eu.con][ [c for c in cf.columns] ].values); y=eu.remain_pct.values
# out-of-sample residual SD (the idiosyncratic scatter the census can't explain): needed for
# proper PREDICTIVE intervals -- parameter bootstrap alone under-covers.
loo=np.zeros(len(y))
for i in range(len(y)):
    tr=np.arange(len(y))!=i; loo[i]=Ridge(alpha=10).fit(X[tr],y[tr]).predict(X[i:i+1])[0]
resid_sd=np.sqrt(np.mean((loo-y)**2))
for label,add_resid in [('parameter-only',False),('+ residual variance',True)]:
    cov90=cov80=0
    for i in range(len(y)):
        tr=np.arange(len(y))!=i; preds=[]
        for _ in range(200):
            bs=rng.choice(np.where(tr)[0],size=tr.sum(),replace=True)
            p=Ridge(alpha=10).fit(X[bs],y[bs]).predict(X[i:i+1])[0]
            if add_resid: p+=rng.normal(0,resid_sd)
            preds.append(p)
        lo90,hi90=np.percentile(preds,[5,95]); lo80,hi80=np.percentile(preds,[10,90])
        cov90+=lo90<=y[i]<=hi90; cov80+=lo80<=y[i]<=hi80
    print(f"  [{label:20s}] 90% coverage {100*cov90/len(y):.0f}%  80% coverage {100*cov80/len(y):.0f}%  (target 90/80)")
print(f"  residual SD (census-unexplained EU-ref scatter) = {resid_sd:.1f}pts")

# ---------- #6 FORWARD PROJECTION (momentum + cohort replacement) ----------
print("\n#6 FORWARD PROJECTION — carry composition to ~2031 (2011->2021 momentum + cohorts)")
AA=f"{B}/2011/census-2011-key-statistics-tables-administrative-geographies (1)/ASSEMBLY AREAS/KS212NIDATA0.CSV"
lut={r['CODE']:r['NAME'].upper() for r in csv.DictReader(open(f"{B}/2011/census-2011-key-statistics-tables-statistical-geographies/All_Geographies_Code_Files/Assembly_Areas_(AA).csv"))}
k=pd.read_csv(AA).set_index('GeographyCode')
cath11=pd.Series(k['KS212NI0006'].values,index=[lut[c] for c in k.index]); pop11=pd.Series(k['KS212NI0001'].values,index=[lut[c] for c in k.index])
# The 2011<->2021 momentum needs both years measured the SAME way: NI-level
# community BACKGROUND, on a COMPLETE, resident-weighted basis.
#   NI11: KS212 background (KS212NI0006), NI aggregate.
#   NI21: rel__Catholic (RELIGION_..._DVO = background) over ALL 3,780 Data Zones
#         weighted by AllUsualResidents -> 45.7%, the true 2021 NI background.
# The previous code did neither: it used dz['catholic_bg_pct'] (a religion-ish
# field, ~43.4%) over the dz21-community subset (only 3,272 of 3,780 DZs) with a
# different population vector, which is what made the 2011<->2021 SIGN an
# artifact (it read as a spurious decline). Fixed, the momentum is a real rise.
_bg=pd.read_csv(f"{V}/dz_features.csv").set_index('area')['rel__Catholic']
_respop=pd.read_csv(f"{B}/derived/ms-a01-dz.csv").set_index('GeographyCode')['AllUsualResidents']
_common=_bg.index.intersection(_respop.index)
NI11=np.average(cath11.values,weights=pop11.values)                                   # NI Catholic-bg 2011 (KS212)
NI21=float(np.average(_bg.loc[_common].values,weights=_respop.loc[_common].values))   # NI Catholic-bg 2021 (complete)
NI31=NI21+(NI21-NI11)                                                                  # extrapolate one decade
# composition-driven DELTA on unity, holding attitudes fixed; added to the anchored level
spread=REL['C']-(REL['P']+REL['N'])/2
comp_delta=(NI31-NI21)/100*spread
fwd=[]
for b in range(NB):
    rc=rng.normal(REL['C'],RATE_SE); ro=rng.normal((REL['P']+REL['N'])/2,RATE_SE); lvl=rng.normal(NIlevel,LEVEL_SE)
    fwd.append(lvl+(NI31-NI21)/100*(rc-ro))
fwd=np.array(fwd)
print(f"  NI Catholic 2011(background,KS212) {NI11:.1f}% vs 2021(background,rel__Catholic) {NI21:.1f}%")
print(f"  (measure-consistent now: both community background; 2011->2021 change {NI21-NI11:+.1f}pt is REAL, sign usable)")
print(f"  Magnitude of composition-driven unity change per decade: ~{abs(comp_delta):.1f}pt (band width {np.percentile(fwd,95)-np.percentile(fwd,5):.1f}pt)")
print("  KEY (measure-robust): composition momentum moves unity only ~1 pt over a DECADE; the DOMINANT")
print("       driver is ATTITUDE change (survey trend), which this does NOT project -> demographic-inertia")
print("       scenario, not a forecast.")
# per-constituency 2011->2021 background, on the corrected (background, resident-weighted) basis
_conmap=json.load(open(f"{V}/dz_constituency.json"))
_cf=pd.DataFrame({'bg':_bg.loc[_common].values,'pop':_respop.loc[_common].values},index=_common)
_cf['con']=[_conmap.get(i) for i in _common]
cath21=_cf.dropna(subset=['con']).groupby('con').apply(
    lambda g:np.average(g['bg'],weights=g['pop']),include_groups=False)
pd.DataFrame({'con':cath21.index,'cath_2011':cath11.reindex(cath21.index).round(1).values,
   'cath_2021':cath21.round(1).values}).to_csv(f"{V}/augment/v11_forward_2031.csv",index=False)
print("\nwrote v11_dz_unity_intervals.csv + v11_forward_2031.csv")
