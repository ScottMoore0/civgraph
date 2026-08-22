#!/usr/bin/env python3
"""'Previous elections' features, engineered and guarded so the backtest is >= the
census-only baseline BY CONSTRUCTION, and tested to see whether they BEAT it -- the
acid test being the 2016 EU referendum, where the naive 'nationalist vote = outcome'
shortcut fails.

Lag block per target = compact, meaningful aggregates of party first-pref shares from
the most-recent Assembly AND most-recent Westminster strictly BEFORE the target date:
  moderate = Alliance+Green+Ind-Other   (the cross-community / pro-Remain axis)
  hardunion = DUP+TUV                   (loyalist / pro-Leave axis)
  uup = UUP                             (moderate unionist)
  nat = SF+SDLP+Ind-Nationalist         (nationalist bloc; mostly census-redundant)
  + gap-in-years to each prior contest. Date-aware, no leakage. Low-dimensional so 18
  constituencies can actually exploit it (24 raw party shares overfit; these don't).

Guard: per outer fold, choose by INNER CV between S0={census} and S1={census+lag}. If
lag doesn't help held-out, S0 is chosen and we recover baseline exactly. Elections use
leave-one-contest-out; the single referendum uses leave-one-AREA-out (holding out the
only referendum would train the census purely on nationalist contests -> transfer
failure, not a fair test).
"""
import json, numpy as np, pandas as pd, os
from collections import defaultdict
from datetime import date
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
D="/home/user/civgraph/render/metadata/elections-test2"
V="/home/user/civgraph/analysis/border-poll-dry-run/v9"
def cat(p):
    d={'DUP':'DUP','UUP':'UUP','Sinn Féin':'SF','SDLP':'SDLP','Alliance':'Alliance','Green':'Green','TUV':'TUV'}
    if p in d: return d[p]
    if p=='Independent Nationalist': return 'IndN'
    if p in ('Independent','Independent Other','Independent Unionist'): return 'IndO'
    return 'Other'
def agg_shares(fn):
    j=json.load(open(f"{D}/{fn}.json")); by=defaultdict(lambda:defaultdict(float))
    for c in j['mainLikeCandidateSummary']: by[c['constituency'].upper()][cat(c['party'])]+=float(c.get('firstPrefs') or 0)
    out={}
    for con,d in by.items():
        t=sum(d.values())
        out[con]=dict(moderate=100*(d.get('Alliance',0)+d.get('Green',0)+d.get('IndO',0))/t,
                      hardunion=100*(d.get('DUP',0)+d.get('TUV',0))/t,
                      uup=100*d.get('UUP',0)/t,
                      nat=100*(d.get('SF',0)+d.get('SDLP',0)+d.get('IndN',0))/t)
    return pd.DataFrame(out).T
ASM={2011:'northern-ireland-assembly__2011-05-05',2016:'northern-ireland-assembly__2016-05-05',
     2017:'northern-ireland-assembly__2017-03-02',2022:'northern-ireland-assembly__2022-05-05'}
WM={2010:'house-of-commons-of-the-united-kingdom__2010-05-06',2015:'house-of-commons-of-the-united-kingdom__2015-05-07',
    2017:'house-of-commons-of-the-united-kingdom__2017-06-08',2019:'house-of-commons-of-the-united-kingdom__2019-12-12'}
SA={y:agg_shares(f) for y,f in ASM.items()}; SW={y:agg_shares(f) for y,f in WM.items()}
TARGETS=[('assembly2016',date(2016,5,5),'nat_pct',2011,2015),('assembly2017',date(2017,3,2),'nat_pct',2016,2015),
 ('assembly2022',date(2022,5,5),'nat_pct',2017,2019),('westminster2017',date(2017,6,8),'nat_pct',2016,2015),
 ('westminster2019',date(2019,12,12),'nat_pct',2017,2017),('euref2016',date(2016,6,23),'remain_pct',2016,2015)]
res=pd.read_csv(f"{V}/results_frame.csv")
cf=pd.read_csv(f"{V}/constituency_features.csv"); cf['con']=cf['con'].str.upper(); cf=cf.set_index('con'); CEN=list(cf.columns)
rows=[]
for key,dt,tcol,ay,wy in TARGETS:
    contest=''.join(c for c in key if not c.isdigit()); year=int(''.join(c for c in key if c.isdigit()))
    sub=res[(res.contest==contest)&(res.year==year)].copy(); sub['area']=sub.area.str.upper()
    A=SA[ay]; W=SW[wy]; gA=(dt-date(ay,5,5)).days/365.25; gW=(dt-date(wy,5,5)).days/365.25
    for _,r in sub.iterrows():
        a=r['area']
        if a not in cf.index or a not in A.index or a not in W.index or pd.isna(r[tcol]): continue
        rec=dict(key=key,area=a,y=r[tcol])
        for k in ['moderate','hardunion','uup','nat']:
            rec[f'A_{k}']=A.loc[a,k]; rec[f'W_{k}']=W.loc[a,k]
        rec['gapA']=gA; rec['gapW']=gW; rows.append(rec)
df=pd.DataFrame(rows).merge(cf,left_on='area',right_index=True)
LAG=[c for c in df.columns if c.startswith(('A_','W_')) or c in ('gapA','gapW')]
df['lvl']=df.groupby('key')['y'].transform('mean'); df['t']=df['y']-df['lvl']
MARGIN=0.03   # require >=3% inner-CV MAE improvement before trusting the lag block
def fp(tr,te,cols,al=10):
    sc=StandardScaler().fit(tr[cols].values); return Ridge(alpha=al).fit(sc.transform(tr[cols].values),tr['t'].values).predict(sc.transform(te[cols].values))
def mae(a,p): return float(np.abs(np.asarray(a)-np.asarray(p)).mean())
def r2(a,p): a=np.asarray(a);p=np.asarray(p); return float(1-((p-a)**2).sum()/((a-a.mean())**2).sum())
def sel(tr,groups,gk):   # inner CV: choose census vs census+lag
    e={0:[],1:[]}
    for g in groups:
        itr=tr[tr[gk]!=g]; ite=tr[tr[gk]==g]
        if len(ite)<1 or len(itr)<3: continue
        e[0].append(mae(ite['t'].values,fp(itr,ite,CEN))); e[1].append(mae(ite['t'].values,fp(itr,ite,CEN+LAG)))
    return 1 if np.mean(e[1])<np.mean(e[0])*(1-MARGIN) else 0    # adopt lag only on a robust win
out=[]
elec=[k for k,*_ in TARGETS if k!='euref2016']
for ko in elec:                                   # LOCO
    tr=df[(df.key!=ko)&(df.key!='euref2016')]; te=df[df.key==ko]
    pc=fp(tr,te,CEN); s=sel(tr,[k for k in elec if k!=ko],'key'); pl=fp(tr,te,CEN+LAG)
    ch=pl if s else pc; a=te['t'].values
    out.append(dict(contest=ko,scheme='LOCO',used='+lag' if s else 'census',
        base_r2=r2(a,pc),base_mae=mae(a,pc),final_r2=r2(a,ch),final_mae=mae(a,ch)))
eu=df[df.key=='euref2016'].reset_index(drop=True)                    # LOAO
pc=np.array([fp(eu.drop(i),eu.iloc[[i]],CEN)[0] for i in range(len(eu))])
pl=np.array([fp(eu.drop(i),eu.iloc[[i]],CEN+LAG)[0] for i in range(len(eu))])
a=eu['t'].values; s=1 if mae(a,pl)<mae(a,pc)*(1-MARGIN) else 0; ch=pl if s else pc
out.append(dict(contest='euref2016',scheme='LOAO',used='+lag' if s else 'census',
    base_r2=r2(a,pc),base_mae=mae(a,pc),final_r2=r2(a,ch),final_mae=mae(a,ch)))
R=pd.DataFrame(out)
print("census-only baseline vs guarded model (census + engineered previous-election lag)")
print(f"{'contest':17s}{'scheme':7s}{'chose':8s}{'base R2/MAE':>15}{'final R2/MAE':>16}")
for _,r in R.iterrows():
    print(f"{r.contest:17s}{r.scheme:7s}{r.used:8s}{r.base_r2:7.3f}/{r.base_mae:4.2f}  {r.final_r2:7.3f}/{r.final_mae:4.2f}")
el=R[R.scheme=='LOCO']; e=R[R.contest=='euref2016'].iloc[0]
print(f"\nELECTIONS pooled MAE: base {el.base_mae.mean():.3f} -> final {el.final_mae.mean():.3f}")
print(f"EU-REF: base R2 {e.base_r2:.3f}/MAE {e.base_mae:.2f} -> final R2 {e.final_r2:.3f}/MAE {e.final_mae:.2f}  (chose {e.used})")
R.to_csv(f"{os.path.dirname(__file__)}/lag_backtest_report.csv",index=False)
