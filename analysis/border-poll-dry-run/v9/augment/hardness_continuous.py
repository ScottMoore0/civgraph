#!/usr/bin/env python3
"""Continuous hardness score, folding in the ACCEPTANCE items (FUTURE1/2 — would you accept
the other outcome) and the PERSUASION battery (UIHCARE/UIEU/UIECON — what would move your
vote) on top of identity strength and Brexit-movability. NILT 2019 (the wave carrying all).

hardness in [0,1] (0 = maximally soft/persuadable, 1 = maximally hard/locked) =
  weighted mean of available signals, each mapped to [0,1]:
   - identity strength  (UNINATST): very=1, fairly=.66, not-very=.33, neither/none=0
   - acceptance of OTHER outcome (Yes->FUTURE2 accept-UK, No->FUTURE1 accept-UI):
       almost impossible=1, could-live-with=.5, happily-accept=0
   - persuasion resistance (UI battery): share answering 'no difference' (unmovable)
   - Brexit resistance (UNIRFAV): 'no difference'=1, moved=0
This produces a continuous attribute; the 5 bins are just its quantiles crossed with direction."""
import pyreadstat, numpy as np, pandas as pd, json
V="analysis/border-poll-dry-run/v9"
df,m=pyreadstat.read_sav('data/surveys/nilt/raw/2019_nilt19w1.sav',encoding='latin1')
c={x.lower():x for x in m.column_names}; L=lambda v:m.variable_value_labels.get(c[v],{})
w=df[c['wtfactor']].fillna(0).values
def code(var,mapping,default=np.nan):
    lab=L(var); x=df[c[var]].values; out=np.full(len(x),default,float)
    for i,v in enumerate(x):
        s=str(lab.get(v,'')).lower()
        for key,val in mapping.items():
            if key in s: out[i]=val; break
    return out
strength=code('uninatst',{'very strong':1,'fairly strong':.66,'not very':.33,'neither':0,'none':0})
acc_ui =code('future1',{'impossible':1,'could live':.5,'happily':0})   # accept a united Ireland (for No voters)
acc_uk =code('future2',{'impossible':1,'could live':.5,'happily':0})   # accept staying in UK (for Yes voters)
def battery_resist():
    items=['uihcare','uieu','uiecon']; present=[i for i in items if i in c]
    R=np.full(len(df),np.nan)
    stacks=[]
    for it in present:
        lab=L(it); x=df[c[it]].values
        s=np.array([1.0 if 'no difference' in str(lab.get(v,'')).lower() else (0.0 if ('encourage' in str(lab.get(v,'')).lower() or 'discourage' in str(lab.get(v,'')).lower()) else np.nan) for v in x])
        stacks.append(s)
    M=np.vstack(stacks); return np.nanmean(M,axis=0)
resist=battery_resist()
brexit=code('unirfav',{'no difference':1,'more in favour':0,'less in favour':0})
ref=df[c['refunify']].values; refL=L('refunify')
direction=np.array([ 'Y' if str(refL.get(v,'')).lower().startswith('yes') else 'N' if str(refL.get(v,'')).lower().startswith('no') else 'U' for v in ref])
# acceptance of the OTHER outcome, by direction
accept=np.where(direction=='Y',acc_uk, np.where(direction=='N',acc_ui, np.nan))
# combine (weighted mean over available components)
W={'strength':.35,'accept':.35,'resist':.20,'brexit':.10}
comp=np.vstack([strength,accept,resist,brexit]); wt=np.array([W['strength'],W['accept'],W['resist'],W['brexit']])[:,None]
mask=~np.isnan(comp)
hard=np.nansum(np.where(mask,comp*wt,0),axis=0)/np.where(mask.any(0),np.nansum(np.where(mask,wt,0),axis=0),np.nan)
ok=~np.isnan(hard)
print("Continuous hardness score (0=soft ... 1=hard), NILT 2019, weighted quantiles:")
q=np.quantile(hard[ok],[.1,.25,.5,.75,.9]); print("  deciles/quartiles:",{p:round(v,2) for p,v in zip(['p10','p25','p50','p75','p90'],q)})
for d,lab in [('N','No / pro-UK'),('U','Undecided'),('Y','Yes / pro-unity')]:
    s=ok&(direction==d);
    if s.sum(): print(f"  {lab:16s} mean hardness {np.average(hard[s],weights=w[s]):.2f}  (n={int(s.sum())})  softest 25%%<{np.quantile(hard[s],.25):.2f}")
# refinement: within No voters, the acceptance item splits hard vs soft that strength alone missed
No=ok&(direction=='N')
print("\nAmong NO voters: how the ACCEPTANCE item refines hardness")
for a,lab in [(1,'would find UI almost impossible (HARD)'),(0.5,'could live with UI'),(0,'would happily accept UI (SOFT)')]:
    s=No&(acc_ui==a)
    if s.sum(): print(f"  {lab:42s} {100*w[s].sum()/w[No].sum():4.1f}% of No voters, mean hardness {np.average(hard[s],weights=w[s]):.2f}")
# poststratify mean hardness by religion -> continuous area softness
rel=code('religcat',{'catholic':0,'protestant':1,'no relig':2,'none':2})
grp={0:'C',1:'P',2:'N'}
hbyrel={grp[k]:np.average(hard[ok&(rel==k)],weights=w[ok&(rel==k)]) for k in [0,1,2] if (ok&(rel==k)).sum()>30}
print("\nMean hardness by community (continuous):",{k:round(v,2) for k,v in hbyrel.items()})
cf=pd.read_csv(f"{V}/constituency_features.csv"); cf['con']=cf['con'].str.upper(); cf=cf.set_index('con')
comp2=pd.DataFrame({'C':cf['rel__Catholic'],'P':cf[[x for x in cf if x.startswith('rel__Protestant')]].sum(axis=1),
                    'N':cf[[x for x in cf if x.startswith('rel__Other') or x=='rel__None']].sum(axis=1)}); comp2=comp2.div(comp2.sum(axis=1),axis=0)
area_hard=(comp2['C']*hbyrel['C']+comp2['P']*hbyrel['P']+comp2['N']*hbyrel['N'])
pd.DataFrame({'mean_hardness':area_hard.round(3),'mean_softness':(1-area_hard).round(3)}).sort_values('mean_softness',ascending=False).to_csv(f"{V}/augment/hardness_continuous_constituency.csv")
print("\nSoftest (most persuadable) constituencies, continuous:")
print((1-area_hard).sort_values(ascending=False).head(4).round(3).to_string())
print("Hardest (most locked):"); print((1-area_hard).sort_values().head(3).round(3).to_string())
