import json, numpy as np, pandas as pd
from collections import defaultdict
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
D="test/metadata/elections-test2"; V="analysis/border-poll-dry-run/v9"
def cat(p):
    d={'DUP':'DUP','UUP':'UUP','Sinn Féin':'SF','SDLP':'SDLP','Alliance':'Alliance','Green':'Green','TUV':'TUV'}
    return d.get(p, 'IndOther' if p in ('Independent','Independent Other','Independent Unionist') else 'Other')
j=json.load(open(f"{D}/northern-ireland-assembly__2016-05-05.json"))
by=defaultdict(lambda:defaultdict(float))
for c in j['mainLikeCandidateSummary']: by[c['constituency']][cat(c['party'])]+=float(c.get('firstPrefs') or 0)
P=pd.DataFrame({con.upper():{k:100*v/sum(d.values()) for k,v in d.items()} for con,d in by.items()}).T.fillna(0)
P['moderate']=P.get('Alliance',0)+P.get('Green',0)+P.get('IndOther',0)
res=pd.read_csv(f"{V}/results_frame.csv"); eu=res[res.contest=='euref'].copy(); eu['k']=eu.area.str.upper()
cf=pd.read_csv(f"{V}/constituency_features.csv"); cf['con']=cf['con'].str.upper(); cf=cf.set_index('con')
m=eu.set_index('k').join(P).join(cf); y=m.remain_pct.values
def loo(cols,a=5):
    X=StandardScaler().fit_transform(m[cols].values); p=np.zeros(len(y))
    for i in range(len(y)):
        tr=np.arange(len(y))!=i; p[i]=Ridge(alpha=a).fit(X[tr],y[tr]).predict(X[i:i+1])[0]
    return 1-((p-y)**2).sum()/((y-y.mean())**2).sum(), np.abs(p-y).mean()
print("LEAN models for EU-ref Remain (leave-one-area-out):")
for name,cols in [('Catholic% only',['rel__Catholic']),
                  ('Catholic% + moderate-vote share',['rel__Catholic','moderate']),
                  ('Catholic% + all party shares',['rel__Catholic']+[c for c in P.columns if c!='moderate']),
                  ('full census 88 (for reference)',list(cf.columns))]:
    r2,mae=loo(cols); print(f"  {name:34s} R2={r2:.3f}  MAE={mae:.2f}")
