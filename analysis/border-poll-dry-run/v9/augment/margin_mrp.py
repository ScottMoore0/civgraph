#!/usr/bin/env python3
"""Upgrade the margin's DZ map from religion-only to a proper MULTIVARIATE poststratification,
using the census 3-way table (religion x age x sex) at Data Zone level that we already hold.

Why this is the right ceiling: the margin is an ATTITUDINAL construct that only exists in NILT
(no geography); the census has rich cross-tabs but NO attitudes; there is no key linking an NILT
person to a census record. So the two can only be fused through the attributes they SHARE. Here we
use every attribute shared by NILT and the census-at-DZ: religion x age x sex. (Identity, tenure,
class are not published at DZ, so they enter only as a constituency-level refinement.)

Method (MRP-lite): fit a weighted logistic model of margin membership on religion+age+sex in NILT,
then poststratify its predictions onto each DZ's census religion x age x sex cell counts."""
import pyreadstat, numpy as np, pandas as pd, json, gzip, re
from sklearn.linear_model import LogisticRegression
V="analysis/border-poll-dry-run/v9"
df,m=pyreadstat.read_sav('data/surveys/nilt/raw/2019_nilt19w1.sav',encoding='latin1')
c={x.lower():x for x in m.column_names}; L=lambda v:m.variable_value_labels.get(c[v],{})
w=df[c['wtfactor']].fillna(0).values
def code(var,mp,d=np.nan):
    lab=L(var);x=df[c[var]].values;o=np.full(len(x),d,float)
    for i,v in enumerate(x):
        s=str(lab.get(v,'')).lower()
        for k,val in mp.items():
            if k in s:o[i]=val;break
    return o
# ---- margin mask (same construction) ----
strength=code('uninatst',{'very strong':1,'fairly strong':.66,'not very':.33,'neither':0,'none':0})
acc_ui=code('future1',{'impossible':1,'could live':.5,'happily':0});acc_uk=code('future2',{'impossible':1,'could live':.5,'happily':0})
def battery():
    S=[]
    for it in [i for i in ['uihcare','uieu','uiecon'] if i in c]:
        lab=L(it);x=df[c[it]].values
        S.append(np.array([1.0 if 'no difference' in str(lab.get(v,'')).lower() else (0.0 if 'courage' in str(lab.get(v,'')).lower() else np.nan) for v in x]))
    return np.nanmean(np.vstack(S),0)
resist=battery();brexit=code('unirfav',{'no difference':1,'more in favour':0,'less in favour':0})
ref=df[c['refunify']].values;refL=L('refunify')
direction=np.array(['Y' if str(refL.get(v,'')).lower().startswith('yes') else 'N' if str(refL.get(v,'')).lower().startswith('no') else 'U' if v==8 else 'X' for v in ref])
accept=np.where(direction=='Y',acc_uk,np.where(direction=='N',acc_ui,np.nan))
wt=np.array([.35,.35,.20,.10])[:,None];comp=np.vstack([strength,accept,resist,brexit]);mask=~np.isnan(comp)
hard=np.nansum(np.where(mask,comp*wt,0),0)/np.where(mask.any(0),np.nansum(np.where(mask,wt,0),0),np.nan)
soft=1-hard;soft=np.where(np.isnan(soft),np.nanmedian(soft),soft)
uni=np.isin(direction,['Y','N','U'])&(w>0)
tier=np.where(direction=='Y',2,np.where(direction=='U',1,0)).astype(float);key=tier+soft
o=np.argsort(-key);o=o[uni[o]];cum=np.cumsum(w[o])/w[o].sum()
inCo=np.zeros(len(df),bool);inCo[o[cum<=0.5+1e-9]]=True
inA=np.zeros(len(df),bool);inA[o[cum<=0.45]]=True
inB=inCo&~inA                                                       # margin

# ---- shared attributes: religion, age(6), sex ----
def scode(var,mp,d=None):
    lab=L(var);x=df[c[var]].values;o=np.array([d]*len(x),dtype=object)
    for i,v in enumerate(x):
        s=str(lab.get(v,'')).lower()
        for k,val in mp.items():
            if k in s:o[i]=val;break
    return o
relN=scode('religcat',{'catholic':'C','protestant':'P','no relig':'N','none':'N'},'O')
def agemap(s):
    n=re.findall(r'(\d+)',str(s));
    if not n: return None
    lo=int(n[0])
    if lo<18: return None
    return '18-24' if lo<25 else '25-34' if lo<35 else '35-44' if lo<45 else '45-54' if lo<55 else '55-64' if lo<65 else '65+'
ageN=np.array([agemap(L('ragecat').get(v,'')) for v in df[c['ragecat']].values],dtype=object)
sexN=np.array(['M' if str(L('rsex').get(v,'')).lower().startswith('male') else 'F' if str(L('rsex').get(v,'')).lower().startswith('female') else None for v in df[c['rsex']].values],dtype=object)
AGES=['18-24','25-34','35-44','45-54','55-64','65+']
def feats(rel,age,sex):
    X=[]
    for r,a,s in zip(rel,age,sex):
        row=[1.0 if r=='P' else 0,1.0 if r=='N' else 0]            # religion (C baseline)
        row+=[1.0 if a==k else 0 for k in AGES[1:]]                 # age (18-24 baseline)
        row+=[1.0 if s=='M' else 0]                                 # sex (F baseline)
        old=1.0 if a=='65+' else 0
        row+=[old*(1.0 if r=='P' else 0)]                           # Protestant x 65+ interaction
        X.append(row)
    return np.array(X)
good=uni&(ageN!=None)&(sexN!=None)&np.isin(relN,['C','P','N'])
Xtr=feats(relN[good],ageN[good],sexN[good]); ytr=inB[good].astype(int); wtr=w[good]
clf=LogisticRegression(C=1.0,max_iter=2000).fit(Xtr,ytr,sample_weight=wtr)
print(f"MRP propensity model: fit on {good.sum()} respondents, {ytr.sum()} in margin.")
# what the model learned (margin propensity by cell)
def prop(rel,age,sex): return clf.predict_proba(feats([rel],[age],[sex]))[0,1]
print("  learned margin propensity by cell (higher = more pivotal-margin):")
for r in ['P','N','C']:
    row=" ".join(f"{a}:{100*prop(r,a,'M'):4.1f}" for a in AGES)
    print(f"    {r} male : {row}")
print(f"  -> strongest cell: older Protestant male {100*prop('P','65+','M'):.1f}%  vs young Catholic {100*prop('C','18-24','F'):.1f}%")

# ---- census DZ poststrat frame: religion x age x sex counts ----
def relgrp(s):
    s=str(s).lower()
    return 'C' if 'catholic' in s else 'P' if 'protestant' in s else 'N' if ('none'==s or 'no relig' in s) else 'O'
cells={}
with gzip.open('data/census/derived/dz21-religion-age-sex-2021.csv.gz','rt') as f:
    hdr=f.readline().rstrip('\n').split(',');ci={h:i for i,h in enumerate(hdr)}
    D=ci['Census 2021 Data Zone Code'];A=ci['Age - 19 Categories Label'];R=ci['Religion or Religion Brought Up In Label'];S=ci['Sex Label'];N=ci['Count']
    for line in f:
        p=line.rstrip('\n').split(',')
        if len(p)<=N: continue
        a=agemap(p[A])
        if a is None: continue
        r=relgrp(p[R]); r='N' if r=='O' else r                      # other-religions -> no-religion rate
        s='M' if p[S].lower().startswith('m') else 'F'
        try:n=float(p[N] or 0)
        except:n=0
        cells.setdefault(p[D],{}).setdefault((r,a,s),0.0)
        cells[p[D]][(r,a,s)]+=n
# predict per unique cell once
uniq=sorted({k for d in cells.values() for k in d})
pmap={k:prop(k[0],k[1],k[2]) for k in uniq}
rows=[]
for dz,cc in cells.items():
    pop=sum(cc.values());
    if pop<50: continue
    marg=sum(pmap[k]*n for k,n in cc.items())
    protpop=sum(n for k,n in cc.items() if k[0]=='P'); old65=sum(n for k,n in cc.items() if k[1]=='65+')
    rows.append((dz,100*marg/pop,100*protpop/pop,100*old65/pop))
mr=pd.DataFrame(rows,columns=['DZ21','mrp_rate','prot_pct','old65_pct']).set_index('DZ21')

# constituency identity refinement (stack on top, Protestant softness)
dzcon=json.load(open(f"{V}/dz_constituency.json"))
cf=pd.read_csv(f"{V}/constituency_features.csv");cf['con']=cf['con'].str.upper()
nat=cf[[x for x in cf.columns if x.startswith('natid__')]];nat.index=cf['con']
soft_id=nat[[x for x in nat.columns if ('Northern Irish only' in x) or (' and ' in x)]].sum(1)/nat.sum(1)
softmult=(soft_id/soft_id.mean()).clip(0.3,2.2)
mr['con']=pd.Series(dzcon);mr=mr[mr['con'].notna()]
mr['softmult']=mr['con'].map(softmult).fillna(1.0);mr['soft_id_pct']=(100*mr['con'].map(soft_id)).round(1)
mr['mrp_id_rate']=mr['mrp_rate']*(0.5+0.5*mr['softmult'])            # half-weight the identity tilt on the whole rate
mr=mr.round(2)

prev=pd.read_csv(f"{V}/augment/margin_top20_datazones.csv")['DZ21'].tolist()
for col,lab in [('mrp_rate','age x sex x religion MRP (census 3-way, no identity)'),
                ('mrp_id_rate','MRP + constituency-identity refinement (fullest)')]:
    top=mr.sort_values(col,ascending=False).head(20)
    print(f"\n=== TOP-20 by {lab} ===")
    print(top.reset_index()[['DZ21','con','prot_pct','old65_pct','soft_id_pct',col]].to_string(index=False))
    print("  constituencies:",top['con'].value_counts().to_dict())
    print(f"  overlap with religion-only top-20: {len(set(top.index)&set(prev))}/20")
mr.sort_values('mrp_id_rate',ascending=False).head(40).to_csv(f"{V}/augment/margin_top20_mrp.csv")
print("\nwrote margin_top20_mrp.csv")
