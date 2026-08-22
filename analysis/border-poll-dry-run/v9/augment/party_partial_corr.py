import json, numpy as np, pandas as pd
from collections import defaultdict
D="render/metadata/elections-test2"; V="analysis/border-poll-dry-run/v9"
def cat(p):
    d={'DUP':'DUP','UUP':'UUP','Sinn Féin':'SF','SDLP':'SDLP','Alliance':'Alliance','Green':'Green','TUV':'TUV'}
    if p in d: return d[p]
    if p=='Independent Unionist': return 'IndUnionist'
    if p in ('Independent','Independent Other'): return 'IndOther'
    return 'Other'
j=json.load(open(f"{D}/northern-ireland-assembly__2016-05-05.json"))
by=defaultdict(lambda:defaultdict(float))
for c in j['mainLikeCandidateSummary']: by[c['constituency']][cat(c['party'])]+=float(c.get('firstPrefs') or 0)
P=pd.DataFrame({con.upper():{f'{k}':100*v/sum(d.values()) for k,v in d.items()} for con,d in by.items()}).T.fillna(0)
res=pd.read_csv(f"{V}/results_frame.csv"); eu=res[res.contest=='euref'].copy(); eu['k']=eu.area.str.upper()
cf=pd.read_csv(f"{V}/constituency_features.csv"); cf['con']=cf['con'].str.upper(); cf=cf.set_index('con')
m=eu.set_index('k').join(P).join(cf['rel__Catholic'])
y=m.remain_pct.values; cathv=m['rel__Catholic'].values
def resid(v):  # residual after removing linear Catholic% effect
    b=np.polyfit(cathv,v,1); return v-np.polyval(b,cathv)
ry=resid(y)
print("Partial corr with Remain, controlling for Catholic%% (isolates the cross-cutting signal):")
for p in ['Alliance','Green','UUP','IndUnionist','IndOther','DUP','TUV','SF','SDLP']:
    if p in m: 
        rp=resid(m[p].values); print(f"   {p:12s} raw r={np.corrcoef(m[p],y)[0,1]:+.2f}   partial r={np.corrcoef(rp,ry)[0,1]:+.2f}")
# combined moderate/liberal bloc
mod=(m.get('Alliance',0)+m.get('Green',0)+m.get('IndOther',0)).values
print(f"\n   Alliance+Green+IndOther:  raw r={np.corrcoef(mod,y)[0,1]:+.2f}   partial r={np.corrcoef(resid(mod),ry)[0,1]:+.2f}")
# does moderate bloc explain the census residual for North Down / Belfast South?
print("\nCensus-model miss vs moderate-vote (the affluent-Remain seats):")
for seat in ['NORTH DOWN','BELFAST SOUTH','BELFAST EAST','STRANGFORD']:
    if seat in m.index:
        r=m.loc[seat]; print(f"   {seat:14s} Remain={r['remain_pct']:.0f}  Catholic={r['rel__Catholic']:.0f}  Alliance+Green+Ind={r.get('Alliance',0)+r.get('Green',0)+r.get('IndOther',0):.0f}")
