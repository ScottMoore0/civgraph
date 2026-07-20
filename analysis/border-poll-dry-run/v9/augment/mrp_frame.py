#!/usr/bin/env python3
"""Full-coverage MRP poststratification frame at 2021 Data Zone, built by RAKING (as the NISRA
disclosure regime requires). The high-dimensional joints are blocked at DZ: the religion x
national-identity x age 3-way is released for only ~112 DZs, and the 4-way (+sex) for almost none.
But the 2-way MARGINS are widely released -- religion x age (3,266 DZs) and religion x identity
(2,197 DZs). So we synthesise the religion x identity x age joint per DZ under the standard raking
assumption identity _|_ age | religion (closed-form: T[r,i,a] = relXage[r,a] * idshare[i|r]),
lifting coverage from 112 to ~2,197 DZs. Sex and tenure are documented as non-affecting for the
margin (nested-CV null) and omitted to preserve coverage.

Self-healing: fetches census tables from R2 and NILT from ARK if the churned container wiped them."""
import os, urllib.request, gzip, csv, json, collections
import numpy as np, pandas as pd, pyreadstat
from sklearn.linear_model import LogisticRegression
V="analysis/border-poll-dry-run/v9"; D="data/census/derived"
FTB="https://data.civgraph.net/data/census/nisra-ftb"
RA=f"{D}/dz21-religion-age-2021.csv.gz"; RI=f"{D}/dz21-religion-natid-2021.csv.gz"
SAV="data/surveys/nilt/raw/2019_nilt19w1.sav"
def ensure(path,url):
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path),exist_ok=True); urllib.request.urlretrieve(url,path)
ensure(RA,f"{FTB}/PEOPLE__DZ21~AGE_BAND_AGG11~RELIGION_BELONG_TO_OR_BROUGHT_UP_IN_DVO.csv.gz")
ensure(RI,f"{FTB}/PEOPLE__DZ21~NAT_ID_BASIC~RELIGION_BELONG_TO_OR_BROUGHT_UP_IN_DVO.csv.gz")
ensure(SAV,"https://www.ark.ac.uk/nilt/2019/nilt19w1.sav")

def crel(s): s=s.lower(); return 'C' if 'catholic' in s else 'P' if 'protestant' in s else 'N'
def cid(s):
    s=s.lower(); return 'British' if s=='british only' else 'Irish' if s=='irish only' else 'Other' if s=='other' else 'NI'
def cage(s):
    import re
    if '65' in s: return '65+'
    n=re.findall(r'(\d+)',s); lo=int(n[0])
    return None if lo<16 else '18-24' if lo<25 else '25-34' if lo<35 else '35-44' if lo<45 else '45-54' if lo<55 else '55-64' if lo<65 else '65+'
AGES=['18-24','25-34','35-44','45-54','55-64','65+']; IDS=['British','Irish','NI','Other']

# --- margins per DZ ---
relage=collections.defaultdict(lambda:collections.defaultdict(float)); dzlabel={}
# 2-way layout: DZ code, DZ label, <var1> code, <var1> label, religion code, religion label, Count
with gzip.open(RA,'rt') as f:
    rd=csv.reader(f);next(rd)
    for row in rd:
        a=cage(row[3])                       # Age label at col 3
        if a is None: continue
        dzlabel[row[0]]=row[1]
        try:n=float(row[-1])
        except:continue
        relage[row[0]][(crel(row[5]),a)]+=n  # Religion label at col 5
relid=collections.defaultdict(lambda:collections.defaultdict(float))
with gzip.open(RI,'rt') as f:
    rd=csv.reader(f);next(rd)
    for row in rd:
        try:n=float(row[-1])
        except:continue
        relid[row[0]][(crel(row[5]),cid(row[3]))]+=n  # Religion col 5, Identity col 3
# --- raked joint T[dz][(r,i,a)] = relage[r,a] * idshare[i|r] ---
frame=collections.defaultdict(dict)
for dz in set(relage)&set(relid):
    idsh={}
    for r in ['C','P','N']:
        tot=sum(relid[dz].get((r,i),0) for i in IDS)
        idsh[r]={i:(relid[dz].get((r,i),0)/tot if tot>0 else (1.0 if i=='British' else 0)) for i in IDS}
    for (r,a),n in relage[dz].items():
        for i in IDS:
            v=n*idsh[r][i]
            if v>0: frame[dz][(r,i,a)]=v
print(f"raked frame coverage: {len(frame)} DZs (raw 3-way was 112)")
# emit reusable frame
with gzip.open(f"{V}/augment/mrp_frame_dz21.csv.gz",'wt',newline='') as f:
    wr=csv.writer(f); wr.writerow(['DZ21','religion','national_identity','age','count'])
    for dz,cc in frame.items():
        for (r,i,a),n in cc.items(): wr.writerow([dz,r,i,a,round(n,2)])

# --- NILT margin propensity: religion x identity x age ---
df,m=pyreadstat.read_sav(SAV,encoding='latin1')
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
strength=code('uninatst',{'very strong':1,'fairly strong':.66,'not very':.33,'neither':0,'none':0})
acc_ui=code('future1',{'impossible':1,'could live':.5,'happily':0});acc_uk=code('future2',{'impossible':1,'could live':.5,'happily':0})
Sx=[]
for it in [i for i in ['uihcare','uieu','uiecon'] if i in c]:
    lab=L(it);x=df[c[it]].values
    Sx.append(np.array([1.0 if 'no difference' in str(lab.get(v,'')).lower() else (0.0 if 'courage' in str(lab.get(v,'')).lower() else np.nan) for v in x]))
resist=np.nanmean(np.vstack(Sx),0);brexit=code('unirfav',{'no difference':1,'more in favour':0,'less in favour':0})
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
rel=scode('religcat',{'catholic':'C','protestant':'P','no relig':'N','none':'N'},'O')
idv=scode('ninatid',{'northern irish':'NI','british':'British','irish':'Irish','ulster':'British','other':'Other'},None)
def amap(v):
    import re;s=str(L('ragecat').get(v,'')).lower();n=re.findall(r'(\d+)',s)
    if not n:return None
    lo=int(n[0]);return '18-24' if lo<25 else '25-34' if lo<35 else '35-44' if lo<45 else '45-54' if lo<55 else '55-64' if lo<65 else '65+'
age=np.array([amap(v) for v in df[c['ragecat']].values],dtype=object)
def feats(r,i,a):
    out=[]
    for j in range(len(r)):
        out.append([1.0 if r[j]=='P' else 0,1.0 if r[j]=='N' else 0,
                    1.0 if i[j]=='Irish' else 0,1.0 if i[j]=='NI' else 0,1.0 if i[j]=='Other' else 0]
                   +[1.0 if a[j]==k else 0 for k in AGES[1:]]+[1.0 if (r[j]=='P' and i[j]=='NI') else 0])
    return np.array(out)
g=uni&np.isin(rel,['C','P','N'])&np.array([x in IDS for x in idv])&(age!=None)
clf=LogisticRegression(C=1.0,max_iter=4000).fit(feats(rel[g],idv[g],age[g]),inB[g].astype(int),sample_weight=w[g])
pm={(r,i,a):clf.predict_proba(feats([r],[i],[a]))[0,1] for r in ['C','P','N'] for i in IDS for a in AGES}

dzcon=json.load(open(f"{V}/dz_constituency.json")); rows=[]
for dz,cc in frame.items():
    pop=sum(cc.values())
    if pop<50: continue
    mg=sum(pm[k]*n for k,n in cc.items())
    old65=sum(n for (r,i,a),n in cc.items() if a=='65+'); prot=sum(n for (r,i,a),n in cc.items() if r=='P')
    rows.append((dz,dzlabel.get(dz),dzcon.get(dz),100*mg/pop,100*prot/pop,100*old65/pop,pop))
mr=pd.DataFrame(rows,columns=['DZ21','label','con','margin_rate','prot_pct','old65_pct','pop']).set_index('DZ21').round(2)
mr.sort_values('margin_rate',ascending=False).to_csv(f"{V}/augment/margin_top_dz21_mrp.csv")
top=mr.sort_values('margin_rate',ascending=False).head(20)
pd.set_option('display.width',200)
print(f"\n=== FULL-COVERAGE margin map: {len(mr)} DZs scored (was 112) ===")
print(top.reset_index()[['label','con','prot_pct','old65_pct','margin_rate']].to_string(index=False))
print("\nconstituencies in top-20:",top['con'].value_counts().to_dict())
print(f"NI margin range: {mr['margin_rate'].min():.1f}-{mr['margin_rate'].max():.1f}%  pop-wtd mean {np.average(mr['margin_rate'],weights=mr['pop']):.1f}%")
print("wrote mrp_frame_dz21.csv.gz, margin_top_dz21_mrp.csv")
