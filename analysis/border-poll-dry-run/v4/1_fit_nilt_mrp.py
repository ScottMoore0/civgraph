#!/usr/bin/env python3
"""v4 stage 1: pooled individual-level MRP regression on NILT REFUNIFY waves."""
import pyreadstat, glob, os, re, json, numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import OneHotEncoder
SD="/tmp/claude-0/-home-user-civgraph/ea760a88-7de6-5e08-940a-d3a6d280325e/scratchpad"
def read(f):
    for enc in (None,'latin1','WINDOWS-1252'):
        try: return pyreadstat.read_sav(f, **({} if enc is None else {'encoding':enc}))
        except Exception: pass
    return None,None
def relig(lab):
    l=str(lab).lower()
    if 'catholic' in l: return 'Catholic'
    if 'protestant' in l: return 'Protestant'
    return 'Other/None'
def ageband(lab):
    l=str(lab).lower(); m=re.findall(r'\d+', l)
    if not m: return None
    a=int(m[0])
    if a<25: return '18-24'
    if a<35: return '25-34'
    if a<45: return '35-44'
    if a<55: return '45-54'
    if a<65: return '55-64'
    return '65+'
def sex(lab):
    l=str(lab).lower(); return 'Female' if 'female' in l or l=='f' else ('Male' if 'male' in l or l=='m' else None)
def unity(lab):
    l=str(lab).lower()
    if l.startswith('yes') or ('unify' in l and 'not' not in l and 'should not' not in l): return 1
    if l.startswith('no') or 'should not' in l or 'not unify' in l: return 0
    return None  # DK / won't vote / ineligible / other

rows=[]
for f in sorted(glob.glob(f"{SD}/nilt/*.sav")):
    yr=int(os.path.basename(f)[:4]); df,meta=read(f)
    if df is None or 'REFUNIFY' not in df.columns: continue
    vl=meta.variable_value_labels
    relv='FAMRCODE' if 'FAMRCODE' in df.columns else ('RELIGCAT' if 'RELIGCAT' in df.columns else None)
    agev='RAGECAT' if 'RAGECAT' in df.columns else None
    sexv='RSEX' if 'RSEX' in df.columns else None
    wtv='WTFACTOR' if 'WTFACTOR' in df.columns else None
    for _,r in df.iterrows():
        u=unity(vl.get('REFUNIFY',{}).get(r['REFUNIFY'], r['REFUNIFY']))
        if u is None: continue
        rr=relig(vl.get(relv,{}).get(r[relv], r[relv])) if relv else None
        aa=ageband(vl.get(agev,{}).get(r[agev], r[agev])) if agev else None
        ss=sex(vl.get(sexv,{}).get(r[sexv], r[sexv])) if sexv else None
        w=float(r[wtv]) if wtv and pd.notna(r[wtv]) else 1.0
        if rr and aa and ss: rows.append((yr,rr,aa,ss,u,w))
D=pd.DataFrame(rows, columns=['year','relig','age','sex','unity','w'])
print(f"pooled NILT decided-vote records: {len(D)}  (waves {sorted(D.year.unique())})")
print("weighted decided-unity by year:")
for y,g in D.groupby('year'):
    print(f"   {y}: {np.average(g.unity, weights=g.w)*100:.1f}%  (n={len(g)})")

# design matrix: one-hot(relig,age,sex) + centered year + relig*age interaction
D['yr_c']=D.year-2022
enc=OneHotEncoder(drop='first', sparse_output=False)
X_cat=enc.fit_transform(D[['relig','age','sex']])
cat_names=list(enc.get_feature_names_out(['relig','age','sex']))
# interactions relig x age
ra=OneHotEncoder(sparse_output=False).fit(D[['relig']])
ageoh=OneHotEncoder(sparse_output=False).fit(D[['age']])
inter=[]; inter_names=[]
Rm=ra.transform(D[['relig']]); Am=ageoh.transform(D[['age']])
for i,rn in enumerate(ra.get_feature_names_out(['relig'])):
    for j,an in enumerate(ageoh.get_feature_names_out(['age'])):
        inter.append((Rm[:,i]*Am[:,j])); inter_names.append(f"{rn}*{an}")
X=np.column_stack([X_cat, D['yr_c'].values.reshape(-1,1)]+inter)
names=cat_names+['yr_c']+inter_names
clf=LogisticRegression(C=1.0, max_iter=2000)
clf.fit(X, D.unity, sample_weight=D.w)
# save model bits
import pickle
pickle.dump(dict(clf=clf,enc=enc,ra=ra,ageoh=ageoh,cat_names=cat_names,names=names),
            open(f"{SD}/mrp_model.pkl","wb"))
# sanity: predicted decided-unity by relig x age at year 2024
def predict(relig_v, age_v, sex_v, year):
    xc=enc.transform([[relig_v,age_v,sex_v]])[0]
    rm=ra.transform([[relig_v]])[0]; am=ageoh.transform([[age_v]])[0]
    it=[rm[i]*am[j] for i in range(len(rm)) for j in range(len(am))]
    x=np.concatenate([xc,[year-2022],it]).reshape(1,-1)
    return clf.predict_proba(x)[0,1]
print("\nfitted P(unity|decided) by religion×age (sex=Female, 2024):")
for rl in ('Catholic','Protestant','Other/None'):
    print("  "+rl.ljust(12)+" "+"  ".join(f"{a}:{predict(rl,a,'Female',2024)*100:4.0f}" for a in ('18-24','25-34','35-44','45-54','55-64','65+')))
