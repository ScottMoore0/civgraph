#!/usr/bin/env python3
"""Extends lag_backtest.py to (i) Westminster 2024 (2024 boundaries; 17/18 seats
name-match PC2008, Belfast South & Mid Down dropped) and (ii) DEA-level local elections
2019 & 2023 (lag = the strictly-previous local election's party composition at each DEA).
Same engineered lag + inner-CV guard (adopt lag only on a >=3% robust improvement).
Pre-2014 locals (26-council geography) are NOT reconciled -- documented, low value."""
import json, numpy as np, pandas as pd, os
from collections import defaultdict
from datetime import date
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
D="/home/user/civgraph/render/metadata/elections-test2"; V="/home/user/civgraph/analysis/border-poll-dry-run/v9"
def cat(p):
    d={'DUP':'DUP','UUP':'UUP','Sinn Féin':'SF','SDLP':'SDLP','Alliance':'Alliance','Green':'Green','TUV':'TUV'}
    if p in d: return d[p]
    if p=='Independent Nationalist': return 'IndN'
    if p in ('Independent','Independent Other','Independent Unionist'): return 'IndO'
    return 'Other'
def agg(fn):
    j=json.load(open(f"{D}/{fn}.json")); by=defaultdict(lambda:defaultdict(float))
    for c in j['mainLikeCandidateSummary']: by[c['constituency'].upper()][cat(c['party'])]+=float(c.get('firstPrefs') or 0)
    o={}
    for con,d in by.items():
        t=sum(d.values()) or 1
        o[con]=dict(moderate=100*(d.get('Alliance',0)+d.get('Green',0)+d.get('IndO',0))/t,
                    hardunion=100*(d.get('DUP',0)+d.get('TUV',0))/t,uup=100*d.get('UUP',0)/t,
                    nat=100*(d.get('SF',0)+d.get('SDLP',0)+d.get('IndN',0))/t)
    return pd.DataFrame(o).T
MARGIN=0.03
def fp(tr,te,cols,al=10):
    sc=StandardScaler().fit(tr[cols].values); return Ridge(alpha=al).fit(sc.transform(tr[cols].values),tr['t'].values).predict(sc.transform(te[cols].values))
def mae(a,p): return float(np.abs(np.asarray(a)-np.asarray(p)).mean())
def r2(a,p): a=np.asarray(a);p=np.asarray(p); return float(1-((p-a)**2).sum()/((a-a.mean())**2).sum())
res=pd.read_csv(f"{V}/results_frame.csv")

def run(feat, CEN, targets, keyfmt, tcol_default='nat_pct'):
    rows=[]
    for key,dt,tcol,priors in targets:
        contest,year=key.rsplit('_',1) if '_' in key else (''.join(c for c in key if not c.isdigit()),int(''.join(c for c in key if c.isdigit())))
        sub=res[(res.contest==contest)&(res.year==int(year))].copy(); sub['area']=sub.area.str.upper()
        SH={nm:agg(fn) for nm,fn,gy in priors}
        for _,r in sub.iterrows():
            a=r['area']
            if a not in feat.index or pd.isna(r[tcol]): continue
            rec=dict(key=key,area=a,y=r[tcol])
            ok=True
            for nm,fn,gy in priors:
                if a not in SH[nm].index: ok=False; break
                for k in ['moderate','hardunion','uup','nat']: rec[f'{nm}_{k}']=SH[nm].loc[a,k]
                rec[f'gap_{nm}']=gy
            if ok: rows.append(rec)
    df=pd.DataFrame(rows).merge(feat,left_on='area',right_index=True)
    LAG=[c for c in df.columns if any(c.startswith(p[0]+'_') for t in targets for p in t[3]) or c.startswith('gap_')]
    LAG=[c for c in df.columns if c.split('_')[0] in [p[0] for t in targets for p in t[3]] or c.startswith('gap_')]
    df['lvl']=df.groupby('key')['y'].transform('mean'); df['t']=df['y']-df['lvl']
    def sel(tr,groups):
        e={0:[],1:[]}
        for g in groups:
            itr=tr[tr.key!=g]; ite=tr[tr.key==g]
            if len(ite)<1 or len(itr)<3: continue
            e[0].append(mae(ite['t'].values,fp(itr,ite,CEN))); e[1].append(mae(ite['t'].values,fp(itr,ite,CEN+LAG)))
        return 1 if (e[1] and np.mean(e[1])<np.mean(e[0])*(1-MARGIN)) else 0
    keys=[t[0] for t in targets]; out=[]
    for ko in keys:
        tr=df[df.key!=ko]; te=df[df.key==ko]
        if len(te)==0: continue
        pc=fp(tr,te,CEN); s=sel(tr,[k for k in keys if k!=ko]); pl=fp(tr,te,CEN+LAG); ch=pl if s else pc; a=te['t'].values
        out.append(dict(contest=ko,used='+lag' if s else 'census',base_r2=r2(a,pc),base_mae=mae(a,pc),final_r2=r2(a,ch),final_mae=mae(a,ch)))
    return pd.DataFrame(out)

# ---- Constituency incl Westminster 2024 ----
cf=pd.read_csv(f"{V}/constituency_features.csv"); cf['con']=cf['con'].str.upper(); cf=cf.set_index('con'); CEN=list(cf.columns)
CT=[('assembly_2016',0,'nat_pct',[('A',' ',0)]),]  # placeholder replaced below
CT=[
 ('assembly_2016',None,'nat_pct',[('A','northern-ireland-assembly__2011-05-05',5.0),('W','house-of-commons-of-the-united-kingdom__2015-05-07',1.0)]),
 ('assembly_2017',None,'nat_pct',[('A','northern-ireland-assembly__2016-05-05',0.8),('W','house-of-commons-of-the-united-kingdom__2015-05-07',1.8)]),
 ('assembly_2022',None,'nat_pct',[('A','northern-ireland-assembly__2017-03-02',5.2),('W','house-of-commons-of-the-united-kingdom__2019-12-12',2.4)]),
 ('westminster_2017',None,'nat_pct',[('A','northern-ireland-assembly__2017-03-02',0.3),('W','house-of-commons-of-the-united-kingdom__2015-05-07',2.1)]),
 ('westminster_2019',None,'nat_pct',[('A','northern-ireland-assembly__2017-03-02',2.8),('W','house-of-commons-of-the-united-kingdom__2017-06-08',2.5)]),
 ('westminster_2024',None,'nat_pct',[('A','northern-ireland-assembly__2022-05-05',2.2),('W','house-of-commons-of-the-united-kingdom__2019-12-12',4.6)]),
]
Rc=run(cf,CEN,CT,None)
# ---- DEA local 2019 & 2023 ----
deaf=pd.read_csv(f"{V}/dea_features.csv").set_index("area"); deaf.index=deaf.index.str.upper(); DCEN=list(deaf.columns)
DT=[
 ('local_2019',None,'nat_pct',[('L','local-government-local-government-districts__2014-05-22',5.0)]),
 ('local_2023',None,'nat_pct',[('L','local-government-local-government-districts__2019-05-02',4.0)]),
]
Rd=run(deaf,DCEN,DT,None)
print("EXTENDED guarded lag backtest (census baseline vs census+previous-election lag)")
print(f"{'contest':17s}{'chose':8s}{'base R2/MAE':>15}{'final R2/MAE':>16}")
for _,r in pd.concat([Rc,Rd]).iterrows():
    print(f"{r.contest:17s}{r.used:8s}{r.base_r2:7.3f}/{r.base_mae:4.2f}  {r.final_r2:7.3f}/{r.final_mae:4.2f}")
allR=pd.concat([Rc,Rd])
print(f"\nAny contest where final worse than base? {(allR.final_mae>allR.base_mae+1e-6).any()}")
print("Westminster 2024:",Rc[Rc.contest=='westminster_2024'][['used','base_r2','final_r2']].to_dict('records'))
allR.to_csv(f"{os.path.dirname(__file__)}/lag_backtest_full_report.csv",index=False)
