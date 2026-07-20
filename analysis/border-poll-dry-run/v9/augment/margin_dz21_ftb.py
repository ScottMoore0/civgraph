#!/usr/bin/env python3
"""THE definitive margin map: poststratify onto the real 2021 Data-Zone 3-way census cross-tab
(religion x national-identity x age) harvested from NISRA's Cantabular Flexible Table Builder
(147,492-table corpus on R2). No vintage gap (2021, not 2011), no Small-Area proxy (real DZ21),
and national identity enters at the cell level with the full 8-category breakdown."""
import pyreadstat, numpy as np, pandas as pd, gzip, csv, json
from sklearn.linear_model import LogisticRegression
import os,urllib.request
TAB="data/census/derived/dz21-religion-natid-age-2021.csv.gz"
if not os.path.exists(TAB):
    urllib.request.urlretrieve("https://data.civgraph.net/data/census/nisra-ftb/PEOPLE__DZ21~AGE_BAND_AGG11~NAT_ID_BASIC~RELIGION_BELONG_TO_OR_BROUGHT_UP_IN_DVO.csv.gz",TAB)
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
    Sx=[]
    for it in [i for i in ['uihcare','uieu','uiecon'] if i in c]:
        lab=L(it);x=df[c[it]].values
        Sx.append(np.array([1.0 if 'no difference' in str(lab.get(v,'')).lower() else (0.0 if 'courage' in str(lab.get(v,'')).lower() else np.nan) for v in x]))
    return np.nanmean(np.vstack(Sx),0)
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

# NILT predictors mapped to the census categories
rel=scode('religcat',{'catholic':'C','protestant':'P','no relig':'N','none':'N'},'O')
idv=scode('ninatid',{'northern irish':'NI','british':'British','irish':'Irish','ulster':'British','other':'Other'},None)
AGES=['18-24','25-34','35-44','45-54','55-64','65+']
def amap(v):
    s=str(L('ragecat').get(v,'')).lower();import re;n=re.findall(r'(\d+)',s)
    if not n:return None
    lo=int(n[0]);return '18-24' if lo<25 else '25-34' if lo<35 else '35-44' if lo<45 else '45-54' if lo<55 else '55-64' if lo<65 else '65+'
age=np.array([amap(v) for v in df[c['ragecat']].values],dtype=object)
IDS=['British','Irish','NI','Other']
def feats(r,i,a):
    out=[]
    for rr,ii,aa in zip(r,i,a):
        row=[1.0 if rr=='P' else 0,1.0 if rr=='N' else 0,
             1.0 if ii=='Irish' else 0,1.0 if ii=='NI' else 0,1.0 if ii=='Other' else 0]
        row+=[1.0 if aa==k else 0 for k in AGES[1:]]
        row+=[1.0 if (rr=='P' and ii=='NI') else 0]
        out.append(row)
    return np.array(out)
good=uni&np.isin(rel,['C','P','N'])&np.array([x in IDS for x in idv])&(age!=None)
clf=LogisticRegression(C=1.0,max_iter=4000).fit(feats(rel[good],idv[good],age[good]),inB[good].astype(int),sample_weight=w[good])
def prop(r,i,a):return clf.predict_proba(feats([r],[i],[a]))[0,1]
print(f"Fit {good.sum()} respondents, {inB[good].sum()} margin. Learned propensity (Protestant, by identity x age, %):")
print("           "+"  ".join(f"{a:>6}" for a in AGES))
for i in ['British','NI','Irish']:
    print(f"  P {i:7s}: "+"  ".join(f"{100*prop('P',i,a):6.1f}" for a in AGES))

# --- census 2021 DZ cell frame: religion x identity(collapsed 4) x age(6) ---
def cid(lbl):
    s=lbl.lower()
    if s=='british only':return 'British'
    if s=='irish only':return 'Irish'
    if s=='other':return 'Other'
    return 'NI'   # Northern Irish only + all mixed/non-exclusive
def crel(lbl):
    s=lbl.lower();return 'C' if 'catholic' in s else 'P' if 'protestant' in s else 'N'
def cage(lbl):
    import re;n=re.findall(r'(\d+)',lbl)
    if '65' in lbl:return '65+'
    lo=int(n[0])
    if lo<16:return None
    return '18-24' if lo<25 else '25-34' if lo<35 else '35-44' if lo<45 else '45-54' if lo<55 else '55-64' if lo<65 else '65+'
from collections import defaultdict
dzcell=defaultdict(lambda:defaultdict(float)); dzlabel={}
with gzip.open(TAB,"rt") as f:
    rd=csv.reader(f);h=next(rd)
    for row in rd:
        dz=row[0];dzlabel[dz]=row[1];a=cage(row[3])
        if a is None:continue
        i=cid(row[5]);r=crel(row[7])
        try:n=float(row[8] or 0)
        except:n=0
        dzcell[dz][(r,i,a)]+=n
# precompute propensity per cell
cells=set((r,i,a) for r in ['C','P','N'] for i in IDS for a in AGES)
pm={k:prop(*k) for k in cells}
rows=[]
for dz,cc in dzcell.items():
    pop=sum(cc.values())
    if pop<50:continue
    marg=sum(pm[k]*n for k,n in cc.items())
    protNI=sum(n for k,n in cc.items() if k[0]=='P' and k[1]=='NI')
    old65=sum(n for k,n in cc.items() if k[2]=='65+')
    prot=sum(n for k,n in cc.items() if k[0]=='P')
    rows.append((dz,dzlabel[dz],100*marg/pop,pop,100*prot/pop,100*old65/pop,100*protNI/pop))
mr=pd.DataFrame(rows,columns=['DZ21','label','margin_rate','pop','prot_pct','old65_pct','protNI_pct']).set_index('DZ21')
dzcon=json.load(open(f"{V}/dz_constituency.json"));mr['con']=mr.index.map(dzcon)
top=mr.sort_values('margin_rate',ascending=False).head(20).round(2)
pd.set_option('display.width',210)
print("\n=== TOP-20 DATA ZONES (2021, real DZ21) by margin prevalence ===")
print(top.reset_index()[['DZ21','label','con','pop','prot_pct','old65_pct','margin_rate']].to_string(index=False))
print("\nconstituencies:",top['con'].value_counts().to_dict())
mr.sort_values('margin_rate',ascending=False).head(60).to_csv(f"{V}/augment/margin_top_dz21_2021.csv")
print(f"\nNI margin-rate range across DZs: {mr['margin_rate'].min():.1f}% - {mr['margin_rate'].max():.1f}%  (mean {np.average(mr['margin_rate'],weights=mr['pop']):.1f}%)")
print("wrote margin_top_dz21_2021.csv")
