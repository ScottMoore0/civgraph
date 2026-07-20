import json, numpy as np, pandas as pd
from collections import defaultdict
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
D="test/metadata/elections-test2"
V="analysis/border-poll-dry-run/v9"
# party-category first-pref shares from an election JSON, by constituency
NATP={'Sinn Féin','SDLP',"Workers' Party",'Independent Nationalist','Aontú'}
def cat(p):
    if p in ('DUP',): return 'DUP'
    if p in ('UUP',): return 'UUP'
    if p=='Sinn Féin': return 'SF'
    if p=='SDLP': return 'SDLP'
    if p=='Alliance': return 'Alliance'
    if p=='Green': return 'Green'
    if p in ('TUV',): return 'TUV'
    if p in ('PBP','People Before Profit'): return 'PBP'
    if p=='Independent Unionist': return 'IndUnionist'
    if p=='Independent Nationalist': return 'IndNat'
    if p in ('Independent','Independent Other'): return 'IndOther'
    return 'Other'
def party_shares(fn):
    j=json.load(open(f"{D}/{fn}.json"))
    by=defaultdict(lambda:defaultdict(float))
    for c in j['mainLikeCandidateSummary']:
        by[c['constituency']][cat(c['party'])]+=float(c.get('firstPrefs') or 0)
    rows={}
    for con,d in by.items():
        t=sum(d.values())
        rows[con.upper()]={f'pty__{k}':100*v/t for k,v in d.items()}
    return pd.DataFrame(rows).T.fillna(0)
# most recent election before 23 Jun 2016 EU-ref = 2016 Assembly (5 May 2016)
P=party_shares('northern-ireland-assembly__2016-05-05')
res=pd.read_csv(f"{V}/results_frame.csv"); eu=res[res.contest=='euref'].copy(); eu['k']=eu.area.str.upper()
cf=pd.read_csv(f"{V}/constituency_features.csv"); cf['con']=cf['con'].str.upper(); cf=cf.set_index('con')
CEN=list(cf.columns); PTY=list(P.columns)
m=eu.merge(cf,left_on='k',right_index=True).merge(P,left_on='k',right_index=True)
y=m.remain_pct.values
def loo(cols,alpha=5):
    X=StandardScaler().fit_transform(m[cols].values); p=np.zeros(len(y))
    for i in range(len(y)):
        tr=np.arange(len(y))!=i; p[i]=Ridge(alpha=alpha).fit(X[tr],y[tr]).predict(X[i:i+1])[0]
    return 1-((p-y)**2).sum()/((y-y.mean())**2).sum(), np.abs(p-y).mean()
print("EU-REF 2016 — adding 2016-Assembly party first-pref shares (leave-one-area-out)")
for name,cols in [('census 88 (baseline)',CEN),('party shares only',PTY),
                  ('census + party shares',CEN+PTY)]:
    r2,mae=loo(cols); print(f"  {name:26s} R2={r2:.3f}  MAE={mae:.2f}  ({len(cols)} feats)")
# which party shares correlate with Remain?
print("\ncorr(party first-pref share, Remain%):")
for c in PTY:
    r=np.corrcoef(m[c],y)[0,1]
    if abs(r)>0.3: print(f"   {c:16s} {r:+.2f}")
