#!/usr/bin/env python3
"""v9 phase 5 — project Irish-unity referendum result to Data Zone + demographic
breakdowns. The validated ridge nationalist-propensity (all 88 census attributes)
gives the geographic shape; a data-driven 2-point calibration re-maps it to the
unity poll's community rates + NI level (no free parameter); poststratified per DZ.
Breakdowns: pop-weighted projected unity by every census attribute category."""
import pandas as pd, numpy as np, json, csv, os
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
REPO="/home/user/civgraph"
feat_dea=pd.read_csv('dea_features.csv').set_index('area')
feat_dz=pd.read_csv('dz_features.csv').set_index('area')
FEATS=feat_dea.columns.tolist()
res=pd.read_csv('results_frame.csv'); dea=res[(res.scale=='dea')&(res.contest=='local')].copy()
dea=dea[dea.area.isin(feat_dea.index)]; dea['cy']=dea.contest+dea.year.astype(str)
sc=StandardScaler().fit(feat_dea.values)
ymean=dea.groupby('cy')['nat_pct'].transform('mean').values
m=Ridge(alpha=10.0).fit(sc.transform(feat_dea.loc[dea.area].values), dea.nat_pct.values-ymean)
nat_NI=dea.nat_pct.mean()
# nationalist propensity per DZ (all attributes), + NI baseline
p_nat=m.predict(sc.transform(feat_dz.values))+nat_NI
dz=pd.DataFrame({'area':feat_dz.index,'p_nat':p_nat}).set_index('area')
dz['cath']=feat_dz['rel__Catholic'].values/100
dz['prot']=feat_dz[[c for c in FEATS if c.startswith('rel__Protestant')][0]].values/100
dz['oth']=(feat_dz['rel__Other religions'].values+feat_dz['rel__None'].values)/100
pop=pd.read_csv(f"{REPO}/data/census/derived/ms-a01-dz.csv").set_index('GeographyCode')['AllUsualResidents']
dz['pop']=pop.reindex(dz.index).fillna(0).values
lt=json.load(open(f"{REPO}/analysis/border-poll-dry-run/v3/lucidtalk_unity_rates.json"))
DATES=['2021-01','2022-08','2024-02','2025-02']
os.makedirs('areas_unity',exist_ok=True); summary=[]
attr_cols={}
for c in FEATS: attr_cols.setdefault(c.split('__')[0],[]).append(c)
breakdowns={}
for date in DATES:
    r=lt[date]; rC,rP,rO,lvl=r['rate_C'],r['rate_P'],r['rate_O'],r['decided']
    comm=100*(rC/100*dz.cath+rP/100*dz.prot+rO/100*dz.oth)      # community-implied unity per DZ
    # data-driven 2-point map p_nat -> unity (captures how propensity relates to unity)
    b=np.polyfit(dz.p_nat, comm, 1)                              # [slope, intercept]
    unity=b[0]*dz.p_nat+b[1]
    # re-centre to poll NI level (pop-weighted)
    unity=unity + (lvl - np.average(unity,weights=dz['pop']))
    unity=unity.clip(1,99)
    with open(f"areas_unity/{date}_DZ21.csv","w",newline='') as fh:
        w=csv.writer(fh); w.writerow(['DZ21','catholic_bg_pct','proj_unity_pct','provenance'])
        for a,cc,uu in zip(dz.index,(dz.cath*100).round(1),unity.round(1)): w.writerow([a,cc,uu,'modelled'])
    q=np.percentile(unity,[10,50,90]); maj=100*np.average((unity>50),weights=dz['pop'])
    summary.append(dict(date=date,ni_level=round(float(np.average(unity,weights=dz['pop'])),1),
        dz_p10=round(q[0],1),dz_med=round(q[1],1),dz_p90=round(q[2],1),maj=round(maj,1)))
    # demographic breakdown: pop-weighted mean unity by each attribute category
    bd={}
    W=dz['pop'].values
    for attr,cols in attr_cols.items():
        for c in cols:
            share=feat_dz[c].reindex(dz.index).values/100
            wt=W*share
            if wt.sum()>0: bd[c]=round(float((unity.values*wt).sum()/wt.sum()),1)
    breakdowns[date]=bd
json.dump(breakdowns,open('breakdowns_unity.json','w'),indent=1)
json.dump({'method':'v9: validated multi-scale census->result ridge (all 88 attrs) gives geographic shape; 2-point calibration to the LucidTalk unity poll (community rates + NI level); poststratified per Data Zone. Poll dates all post-2021-Census -> 2021 attributes.','results':summary},open('summary_unity.json','w'),indent=1)
print(f"{'date':9}{'NI':>6}  DZ p10-med-p90   maj%")
for s in summary: print(f"{s['date']:9}{s['ni_level']:6.1f}  {s['dz_p10']:.1f}-{s['dz_med']:.1f}-{s['dz_p90']:.1f}  {s['maj']}")
print("\nSample breakdown (2024-02) — projected unity by national identity / passport:")
bd=breakdowns['2024-02']
for c in sorted(bd):
    if c.startswith(('natid__','pass__','irish__')): print("  %-52s %.1f"%(c,bd[c]))
