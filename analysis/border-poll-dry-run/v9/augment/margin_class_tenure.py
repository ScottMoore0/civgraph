#!/usr/bin/env python3
"""(2) Pull NS-SeC (class) and tenure into the margin bridge. NILT has NSSECRESP08 and TENSHT1;
the census has NS-SeC and tenure crossed with age/sex/each-other at Small Area (LC6105, LC4101,
LC6401). But NEITHER is crossed with religion in the census, so before doing an IPF synthesis we
test the decisive question: do class/tenure add discriminating power for the margin BEYOND
religion x identity x age? Nested cross-validated logistic models answer it; if the lift is
negligible, adding class/tenure via IPF cannot relocate the margin and we say so."""
import pyreadstat, numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import KFold
from sklearn.metrics import log_loss
V="analysis/border-poll-dry-run/v9"
df,m=pyreadstat.read_sav('data/surveys/nilt/raw/2019_nilt19w1.sav',encoding='latin1')
c={x.lower():x for x in m.column_names};L=lambda v:m.variable_value_labels.get(c[v],{})
w=df[c['wtfactor']].fillna(0).values
def code(var,mp,d=np.nan):
    lab=L(var);x=df[c[var]].values;o=np.full(len(x),d,float)
    for i,v in enumerate(x):
        s=str(lab.get(v,'')).lower()
        for k,val in mp.items():
            if k in s:o[i]=val;break
    return o
def scode(var,mp,d=None):
    lab=L(var);x=df[c[var]].values;o=np.array([d]*len(x),dtype=object)
    for i,v in enumerate(x):
        s=str(lab.get(v,'')).lower()
        for k,val in mp.items():
            if k in s:o[i]=val;break
    return o
# margin mask
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
dirn=np.array(['Y' if str(refL.get(v,'')).lower().startswith('yes') else 'N' if str(refL.get(v,'')).lower().startswith('no') else 'U' if v==8 else 'X' for v in ref])
accept=np.where(dirn=='Y',acc_uk,np.where(dirn=='N',acc_ui,np.nan))
wt=np.array([.35,.35,.20,.10])[:,None];comp=np.vstack([strength,accept,resist,brexit]);mk=~np.isnan(comp)
hard=np.nansum(np.where(mk,comp*wt,0),0)/np.where(mk.any(0),np.nansum(np.where(mk,wt,0),0),np.nan)
soft=1-hard;soft=np.where(np.isnan(soft),np.nanmedian(soft),soft)
uni=np.isin(dirn,['Y','N','U'])&(w>0);tier=np.where(dirn=='Y',2,np.where(dirn=='U',1,0)).astype(float)
o=np.argsort(-(tier+soft));o=o[uni[o]];cum=np.cumsum(w[o])/w[o].sum()
inCo=np.zeros(len(df),bool);inCo[o[cum<=0.5+1e-9]]=True
inA=np.zeros(len(df),bool);inA[o[cum<=0.45]]=True;inB=inCo&~inA

# encode predictors
rel=scode('religcat',{'catholic':'C','protestant':'P','no relig':'N','none':'N'},'O')
idv=scode('ninatid',{'northern irish':'NI','british':'British','irish':'Irish','ulster':'British','other':'Other'},None)
def agemap(v):
    s=str(L('ragecat').get(v,'')).lower();import re;n=re.findall(r'(\d+)',s)
    if not n:return None
    lo=int(n[0]);return 0 if lo<25 else 1 if lo<35 else 2 if lo<45 else 3 if lo<55 else 4 if lo<65 else 5
age=np.array([agemap(v) for v in df[c['ragecat']].values],dtype=object)
sex=np.array([1.0 if str(L('rsex').get(v,'')).lower().startswith('m') else 0.0 for v in df[c['rsex']].values])
nssec=scode('nssecresp08',{'1.1':'1','1.2':'1','2 lower':'2','3 interm':'3','4 small':'4','5 lower':'5','6 semi':'6','7 rout':'7','never worked':'8','8 never':'8'},None)
ten=scode('tensht1',{'own it outright':'own','mortgage':'own','co-ownership':'own','private landlord':'prent','housing executive':'srent','housing association':'srent','employer':'prent','relative':'prent','rent-free':'prent','other':None,'squat':None},None)
NS=['1','2','3','4','5','6','7','8'];TE=['own','srent','prent']
def build(mask_extra):
    rows=[]
    for i in range(len(df)):
        r=[1.0 if rel[i]=='P' else 0,1.0 if rel[i]=='N' else 0,
           1.0 if idv[i]=='Irish' else 0,1.0 if idv[i]=='NI' else 0,1.0 if idv[i]=='Other' else 0]
        r+=[1.0 if age[i]==k else 0 for k in [1,2,3,4,5]]+[sex[i]]
        if 'nssec' in mask_extra: r+=[1.0 if nssec[i]==k else 0 for k in NS[1:]]
        if 'ten' in mask_extra:   r+=[1.0 if ten[i]==k else 0 for k in TE[1:]]
        rows.append(r)
    return np.array(rows,float)
base_ok=uni&np.isin(rel,['C','P','N'])&np.array([x in ['British','Irish','NI','Other'] for x in idv])&(age!=None)
def cvll(Xall,ok):
    X=Xall[ok];y=inB[ok].astype(int);ww=w[ok]
    kf=KFold(5,shuffle=True,random_state=0);ll=[]
    for tr,te in kf.split(X):
        cl=LogisticRegression(C=1.0,max_iter=3000).fit(X[tr],y[tr],sample_weight=ww[tr])
        p=cl.predict_proba(X[te])[:,1]
        ll.append(log_loss(y[te],p,labels=[0,1],sample_weight=ww[te]))
    return np.mean(ll)
X0=build([]);X1=build(['nssec']);X2=build(['nssec','ten'])
ok=base_ok&(nssec!=None)&(ten!=None)                       # common non-missing sample for fair nesting
print(f"Nested margin-propensity models (5-fold CV log-loss, lower=better), n={ok.sum()}, margin={inB[ok].sum()}:")
l0=cvll(X0,ok);l1=cvll(X1,ok);l2=cvll(X2,ok)
print(f"  M0  religion+identity+age+sex            : {l0:.4f}")
print(f"  M1  + NS-SeC (class)                     : {l1:.4f}   (delta {l1-l0:+.4f})")
print(f"  M2  + NS-SeC + tenure                    : {l2:.4f}   (delta {l2-l0:+.4f})")
print("  (a NEGATIVE delta = the added variable improves out-of-sample fit; ~0 or positive = no lift)")

# margin class & tenure profile (weighted)
def dist(mask,arr,order):
    sel=mask&uni&(arr!=None);W=w[sel];s=pd.Series(W).groupby(arr[sel]).sum();s=100*s/s.sum()
    return {k:round(s.get(k,0),1) for k in order}
NSlab={'1':'1 Higher mgmt/prof','2':'2 Lower mgmt/prof','3':'3 Intermediate','4':'4 Small employer/own-acct','5':'5 Lower supervisory','6':'6 Semi-routine','7':'7 Routine','8':'8 Never worked/LTU'}
print("\nMargin NS-SeC profile vs core vs electorate:")
for m_,nm in [(inB,'MARGIN'),(inA,'core'),(uni,'all')]:
    d=dist(m_,nssec,NS);print(f"  {nm:7s}: "+"  ".join(f"{NSlab[k].split()[0]}:{d[k]}" for k in NS))
print("Margin tenure profile vs core vs electorate:")
for m_,nm in [(inB,'MARGIN'),(inA,'core'),(uni,'all')]:
    d=dist(m_,ten,TE);print(f"  {nm:7s}: own {d['own']}  social-rent {d['srent']}  private-rent {d['prent']}")
print("\nInterpretation printed above; class/tenure lift is the delta CV log-loss.")
