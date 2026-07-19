#!/usr/bin/env python3
"""v9 phase 5 (corrected) — the NI level is now a COMPUTED OUTPUT of the survey
inputs, not the LucidTalk topline echoed back.

  output_level = w_LT*LucidTalk_unity + w_NILT*NILT_unity + house_effect
    w_LT, w_NILT : inverse-variance weights from measured survey reliability
                   (LucidTalk 0.76 / NILT 0.24; sigma_LT~1.0, sigma_NILT~1.8).
    house_effect : learned from real elections/EU-ref (v6). Central ~0 on the
                   constitutional metric (party-VI bloc measure is ~unbiased);
                   the 2016 EU referendum gives a +-2.0 referendum envelope
                   (sign-ambiguous for unity).

Because NILT and LucidTalk disagree (up to 6 pts), the output differs from either
poll. Geography from the validated census->result ridge; demographics follow."""
import pandas as pd, numpy as np, json, csv, os
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
REPO="/home/user/civgraph"
W_LT,W_NILT=0.76,0.24; ENVELOPE=2.04
# --- survey inputs ---
lt=json.load(open(f"{REPO}/analysis/border-poll-dry-run/v3/lucidtalk_unity_rates.json"))
nd=pd.read_csv(f"{REPO}/analysis/border-poll-dry-run/v8/nilt_individual.csv")
nd=nd[(nd.source=='nilt_ref')&(nd.year!=2017)]
niltdec={int(y):100*(g.unity*g.weight).sum()/g.weight.sum() for y,g in nd.groupby('year')}
DATES={'2021-01':2021,'2022-08':2022,'2024-02':2024,'2025-02':2025}
# --- census->result ridge (validated engine) ---
fd=pd.read_csv('dea_features.csv').set_index('area'); fz=pd.read_csv('dz_features.csv').set_index('area')
FE=fd.columns.tolist(); res=pd.read_csv('results_frame.csv')
dea=res[(res.scale=='dea')&(res.contest=='local')].copy(); dea=dea[dea.area.isin(fd.index)]; dea['cy']=dea.contest+dea.year.astype(str)
sc=StandardScaler().fit(fd.values); ym=dea.groupby('cy')['nat_pct'].transform('mean').values
m=Ridge(alpha=10).fit(sc.transform(fd.loc[dea.area].values),dea.nat_pct.values-ym)
p_nat=m.predict(sc.transform(fz.values))+dea.nat_pct.mean()
dz=pd.DataFrame(index=fz.index); dz['p_nat']=p_nat
dz['cath']=fz['rel__Catholic'].values/100
dz['prot']=fz[[c for c in FE if c.startswith('rel__Protestant')][0]].values/100
dz['oth']=(fz['rel__Other religions'].values+fz['rel__None'].values)/100
dz['pop']=pd.read_csv(f"{REPO}/data/census/derived/ms-a01-dz.csv").set_index('GeographyCode')['AllUsualResidents'].reindex(dz.index).fillna(0).values
attr_cols={};  [attr_cols.setdefault(c.split('__')[0],[]).append(c) for c in FE]
os.makedirs('areas_output',exist_ok=True); summary=[]; breakdowns={}
for date,yr in DATES.items():
    r=lt[date]; LT=r['decided']; NILT=niltdec[yr]
    out_level=round(W_LT*LT+W_NILT*NILT,1)                       # <-- COMPUTED OUTPUT (not the poll)
    comm=100*(r['rate_C']/100*dz.cath+r['rate_P']/100*dz.prot+r['rate_O']/100*dz.oth)  # LucidTalk community shape (input)
    b=np.polyfit(dz.p_nat,comm,1); unity=b[0]*dz.p_nat+b[1]
    unity=unity+(out_level-np.average(unity,weights=dz['pop'])); unity=unity.clip(1,99)  # centre on OUTPUT level
    with open(f"areas_output/{date}_DZ21.csv","w",newline='') as fh:
        w=csv.writer(fh); w.writerow(['DZ21','catholic_bg_pct','proj_unity_pct','provenance'])
        for a,cc,uu in zip(dz.index,(dz.cath*100).round(1),unity.round(1)): w.writerow([a,cc,uu,'modelled'])
    q=np.percentile(unity,[10,50,90]); maj=100*np.average(unity>50,weights=dz['pop'])
    summary.append(dict(date=date,input_lucidtalk=LT,input_nilt=round(NILT,1),
        output_ni=out_level,output_low=round(out_level-ENVELOPE,1),output_high=round(out_level+ENVELOPE,1),
        dz_p10=round(q[0],1),dz_med=round(q[1],1),dz_p90=round(q[2],1),maj=round(maj,1)))
    bd={}
    for c in FE:
        share=fz[c].reindex(dz.index).values/100; wt=dz['pop'].values*share
        if wt.sum()>0: bd[c]=round(float((unity.values*wt).sum()/wt.sum()),1)
    breakdowns[date]=bd
json.dump(breakdowns,open('breakdowns_output.json','w'),indent=1)
json.dump({'method':'NI level = inverse-variance combination of LucidTalk + NILT unity (0.76/0.24 measured reliability) + election-calibrated house effect (central ~0, EU-ref +-2 envelope). Output computed from the survey inputs, NOT the poll topline. Geography from validated census->result ridge; demographics follow.','weights':{'LucidTalk':W_LT,'NILT':W_NILT},'results':summary},open('summary_output.json','w'),indent=1)
print(f"{'date':9}{'LT_in':>6}{'NILT_in':>8} | {'OUTPUT':>7}{'band':>13} | DZ med  maj%")
for s in summary: print(f"{s['date']:9}{s['input_lucidtalk']:6}{s['input_nilt']:8} | {s['output_ni']:7}  [{s['output_low']},{s['output_high']}] | {s['dz_med']:5}  {s['maj']}")
