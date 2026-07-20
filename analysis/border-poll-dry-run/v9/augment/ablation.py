#!/usr/bin/env python3
"""Measure the lift from Tier-1 (deprivation, contest-structure) and Tier-2 (NILT
brexvote) additions, vs the 88-feature census baseline, for the EU-ref and the
elections."""
import pandas as pd, numpy as np, os
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
V="/home/user/civgraph/analysis/border-poll-dry-run/v9"; A=f"{V}/augment"
res=pd.read_csv(f"{V}/results_frame.csv")
conf=pd.read_csv(f"{V}/constituency_features.csv"); conf['con']=conf['con'].str.upper(); conf=conf.set_index('con')
deaf=pd.read_csv(f"{V}/dea_features.csv").set_index('area')
dep=pd.read_csv(f"{A}/deprivation_constituency.csv"); dep['con']=dep['con'].str.upper(); dep=dep.set_index('con')
DEP=dep.columns.tolist()
stru=pd.read_csv(f"{A}/structure.csv")
CEN=[c for c in conf.columns]
def R2MAE(a,p):
    a=np.asarray(a,float);p=np.asarray(p,float)
    return 1-((p-a)**2).sum()/((a-a.mean())**2).sum(), np.abs(p-a).mean()

def add_feats(frame, base_feat, key_upper, extra_con=None, stru_rows=None):
    """attach feature columns to a results subframe; returns X df + list of cols present"""
    f=base_feat
    if extra_con is not None: f=f.join(extra_con)
    frame=frame.copy(); frame['k']=frame.area.str.upper() if key_upper else frame.area
    m=frame.merge(f,left_on='k',right_index=True)
    return m

# ---------------- EU-REF (constituency, leave-one-AREA-out) ----------------
print("="*74); print("EU-REFERENDUM 2016 — constituency (leave-one-area-out)"); print("="*74)
eu=res[res.contest=='euref'].copy()
struct_eu=stru[(stru.contest=='euref')].copy(); struct_eu['area']=struct_eu['area'].str.upper()
struct_eu=struct_eu.set_index('area')['str__turnout']
def loo(m,cols):
    X=StandardScaler().fit_transform(m[cols].values); y=m.remain_pct.values; p=np.zeros(len(y))
    for i in range(len(y)):
        tr=np.arange(len(y))!=i; p[i]=Ridge(alpha=10).fit(X[tr],y[tr]).predict(X[i:i+1])[0]
    return R2MAE(y,p)
mEU=add_feats(eu,conf,True,extra_con=dep)
mEU=mEU.merge(struct_eu.rename('str__turnout'),left_on='k',right_index=True)
brex=pd.read_csv(f"{A}/nilt_brexvote_pred.csv"); brex['con']=brex['con'].str.upper(); brex=brex.set_index('con')
mEU=mEU.merge(brex,left_on='k',right_index=True)
sets={'census 88 (baseline)':CEN,'+ deprivation':CEN+DEP,'+ deprivation + turnout':CEN+DEP+['str__turnout'],
      '+ dep+turnout+brexvote':CEN+DEP+['str__turnout','nilt_brexvote_remain_pred']}
for name,cols in sets.items():
    r2,mae=loo(mEU,cols); print(f"  {name:34s} R2={r2:.3f}  MAE={mae:.2f}  ({len(cols)} feats)")
# NILT brexvote poststrat standalone (no fitting)
r2,mae=R2MAE(mEU.remain_pct, mEU.nilt_brexvote_remain_pred)
print(f"  {'NILT brexvote poststrat (standalone)':34s} R2={r2:.3f}  MAE={mae:.2f}  (survey, religion-only)")

# ---------------- ELECTIONS (leave-one-contest-out) ----------------
def loco(sub, feat, key_upper, cols):
    sub=sub.copy(); sub['cy']=sub.contest+sub.year.astype(str); sub['k']=sub.area.str.upper() if key_upper else sub.area
    sub=sub.merge(feat,left_on='k',right_index=True)
    y=sub.nat_pct.values; lvl=sub.groupby('cy')['nat_pct'].transform('mean').values
    X=StandardScaler().fit_transform(sub[cols].values); p=np.zeros(len(sub))
    for c in sub.cy.unique():
        te=sub.cy.values==c
        p[te]=Ridge(alpha=10).fit(X[~te],(y-lvl)[~te]).predict(X[te])+lvl[te]
    return sub.assign(pred=p)
def attach_struct(sub):
    s=stru.copy(); s['str__turnout']=pd.to_numeric(s['str__turnout'],errors='coerce')
    return sub.merge(s,on=['contest','year','area'],how='left')
STR=['str__turnout','str__n_nat_cands','str__n_uni_cands','str__n_total_cands','str__sf_sdlp_both','str__uni_single']

print("\n"+"="*74); print("CONSTITUENCY ELECTIONS — Assembly+Westminster (leave-one-contest-out)"); print("="*74)
con=res[(res.scale=='constituency')&(res.contest.isin(['assembly','westminster']))].copy()
con=con[con.area.str.upper().isin(conf.index)]
conx=attach_struct(con)
featC=conf.join(dep)
for name,cols in {'census 88 (baseline)':CEN,'+ deprivation':CEN+DEP}.items():
    s=loco(conx,featC,True,cols); 
    per={cy:R2MAE(g.nat_pct,g.pred)[1] for cy,g in s.groupby(s.contest+s.year.astype(str))}
    r2,mae=R2MAE(s.nat_pct,s.pred); print(f"  {name:26s} R2={r2:.3f}  MAE={mae:.2f}")
# + structure (fill NaN turnout with contest mean)
conx2=conx.copy()
for col in STR: conx2[col]=conx2[col].fillna(conx2.groupby(conx2.contest+conx2.year.astype(str))[col].transform('mean'))
featC2=conf.join(dep)
s=con.copy(); s['cy']=s.contest+s.year.astype(str); s['k']=s.area.str.upper()
s=s.merge(featC2,left_on='k',right_index=True).merge(conx2[['contest','year','area']+STR],on=['contest','year','area'])
y=s.nat_pct.values; lvl=s.groupby('cy')['nat_pct'].transform('mean').values
cols=CEN+DEP+STR; X=StandardScaler().fit_transform(s[cols].fillna(0).values); p=np.zeros(len(s))
for c in s.cy.unique():
    te=(s.cy.values==c); p[te]=Ridge(alpha=10).fit(X[~te],(y-lvl)[~te]).predict(X[te])+lvl[te]
r2,mae=R2MAE(y,p); print(f"  {'+ dep + structure':26s} R2={r2:.3f}  MAE={mae:.2f}")
perc={cy:R2MAE(g.nat_pct.values,p[s.cy.values==cy])[1] for cy,g in s.groupby('cy')}
print("     per-contest MAE (+dep+structure):",{k:round(v,2) for k,v in perc.items()})

print("\n"+"="*74); print("LOCAL ELECTIONS — DEA(80) (leave-one-contest-out)"); print("="*74)
dea=res[(res.scale=='dea')&(res.contest=='local')].copy(); dea=dea[dea.area.isin(deaf.index)]
deax=attach_struct(dea)
for col in ['str__turnout','str__n_nat_cands','str__n_uni_cands','str__n_total_cands','str__sf_sdlp_both','str__uni_single']:
    deax[col]=deax[col].fillna(deax.groupby(deax.contest+deax.year.astype(str))[col].transform('mean'))
s=loco(dea,deaf,False,CEN); r2,mae=R2MAE(s.nat_pct,s.pred); print(f"  {'census 88 (baseline)':26s} R2={r2:.3f}  MAE={mae:.2f}")
s2=dea.copy(); s2['cy']=s2.contest+s2.year.astype(str)
s2=s2.merge(deaf,left_on='area',right_index=True).merge(deax[['contest','year','area']+STR],on=['contest','year','area'])
y=s2.nat_pct.values; lvl=s2.groupby('cy')['nat_pct'].transform('mean').values
cols=CEN+STR; X=StandardScaler().fit_transform(s2[cols].fillna(0).values); p=np.zeros(len(s2))
for c in s2.cy.unique():
    te=(s2.cy.values==c); p[te]=Ridge(alpha=10).fit(X[~te],(y-lvl)[~te]).predict(X[te])+lvl[te]
r2,mae=R2MAE(y,p); print(f"  {'+ structure (turnout+cands)':26s} R2={r2:.3f}  MAE={mae:.2f}")
print("  (DEA deprivation not added: needs 2011-SA -> 2014-DEA ward-vintage reconciliation)")
