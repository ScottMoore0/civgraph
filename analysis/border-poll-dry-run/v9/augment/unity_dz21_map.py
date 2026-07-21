#!/usr/bin/env python3
"""(a) DZ-level unity Yes-share map, poststratifying a NILT Yes-of-decided propensity onto the 2021
Data-Zone MRP frame. (b) Two frames: the raked religion x identity x age frame (2,189 DZs) and a
religion x age-only frame (3,266 DZs, fuller coverage). The map SHAPE (which areas lean Yes) is the
robust output; the NI level is re-centred to a stated ~45% topline (2019 is a low base)."""
import os, subprocess, gzip, csv, json, collections
import numpy as np, pandas as pd, pyreadstat
from sklearn.linear_model import LogisticRegression
V="analysis/border-poll-dry-run/v9"; D="data/census/derived"
FTB="https://data.civgraph.net/data/census/nisra-ftb"
RA=f"{D}/dz21-religion-age-2021.csv.gz"; RI=f"{D}/dz21-religion-natid-2021.csv.gz"
SAV="data/surveys/nilt/raw/2019_nilt19w1.sav"; TOPLINE=45.0
def ensure(path,url):
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path),exist_ok=True)
        subprocess.run(["curl","-sL","--max-time","120",url,"-o",path],check=True)
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
# --- margins ---
relage=collections.defaultdict(lambda:collections.defaultdict(float)); dzlabel={}
with gzip.open(RA,'rt') as f:
    rd=csv.reader(f);next(rd)
    for row in rd:
        a=cage(row[3])
        if a is None: continue
        dzlabel[row[0]]=row[1]
        try:n=float(row[-1])
        except:continue
        relage[row[0]][(crel(row[5]),a)]+=n
relid=collections.defaultdict(lambda:collections.defaultdict(float))
with gzip.open(RI,'rt') as f:
    rd=csv.reader(f);next(rd)
    for row in rd:
        try:n=float(row[-1])
        except:continue
        relid[row[0]][(crel(row[5]),cid(row[3]))]+=n
# frame A: raked religion x identity x age (identity _|_ age | religion)
frameA=collections.defaultdict(dict)
for dz in set(relage)&set(relid):
    idsh={}
    for r in ['C','P','N']:
        t=sum(relid[dz].get((r,i),0) for i in IDS)
        idsh[r]={i:(relid[dz].get((r,i),0)/t if t>0 else (1.0 if i=='British' else 0)) for i in IDS}
    for (r,a),n in relage[dz].items():
        for i in IDS:
            v=n*idsh[r][i]
            if v>0: frameA[dz][(r,i,a)]=v
# frame B: religion x age (fuller coverage)
frameB={dz:dict(cc) for dz,cc in relage.items()}
print(f"frame A (identity): {len(frameA)} DZs   frame B (religion x age): {len(frameB)} DZs")

# --- NILT Yes-of-decided propensity ---
df,m=pyreadstat.read_sav(SAV,encoding='latin1')
c={x.lower():x for x in m.column_names};L=lambda v:m.variable_value_labels.get(c[v],{})
w=df[c['wtfactor']].fillna(0).values
def scode(var,mp,d=None):
    lab=L(var);x=df[c[var]].values;o=np.array([d]*len(x),dtype=object)
    for i,v in enumerate(x):
        s=str(lab.get(v,'')).lower()
        for k,val in mp.items():
            if k in s:o[i]=val;break
    return o
ref=df[c['refunify']].values;refL=L('refunify')
dirn=np.array(['Y' if str(refL.get(v,'')).lower().startswith('yes') else 'N' if str(refL.get(v,'')).lower().startswith('no') else 'X' for v in ref])
rel=scode('religcat',{'catholic':'C','protestant':'P','no relig':'N','none':'N'},'O')
idv=scode('ninatid',{'northern irish':'NI','british':'British','irish':'Irish','ulster':'British','other':'Other'},None)
def amap(v):
    import re;s=str(L('ragecat').get(v,'')).lower();n=re.findall(r'(\d+)',s)
    if not n:return None
    lo=int(n[0]);return '18-24' if lo<25 else '25-34' if lo<35 else '35-44' if lo<45 else '45-54' if lo<55 else '55-64' if lo<65 else '65+'
age=np.array([amap(v) for v in df[c['ragecat']].values],dtype=object)
dec=np.isin(dirn,['Y','N'])&(w>0)&np.isin(rel,['C','P','N'])&(age!=None)
yes=(dirn=='Y').astype(int)
def fA(r,i,a):
    return [[1.0 if r[j]=='P' else 0,1.0 if r[j]=='N' else 0,1.0 if i[j]=='Irish' else 0,1.0 if i[j]=='NI' else 0,1.0 if i[j]=='Other' else 0]+[1.0 if a[j]==k else 0 for k in AGES[1:]] for j in range(len(r))]
def fB(r,a):
    return [[1.0 if r[j]=='P' else 0,1.0 if r[j]=='N' else 0]+[1.0 if a[j]==k else 0 for k in AGES[1:]] for j in range(len(r))]
gA=dec&np.array([x in IDS for x in idv])
cA=LogisticRegression(C=1.0,max_iter=4000).fit(np.array(fA(rel[gA],idv[gA],age[gA])),yes[gA],sample_weight=w[gA])
cB=LogisticRegression(C=1.0,max_iter=4000).fit(np.array(fB(rel[dec],age[dec])),yes[dec],sample_weight=w[dec])
pA={(r,i,a):cA.predict_proba(np.array(fA([r],[i],[a])))[0,1] for r in ['C','P','N'] for i in IDS for a in AGES}
pB={(r,a):cB.predict_proba(np.array(fB([r],[a])))[0,1] for r in ['C','P','N'] for a in AGES}

def poststrat(frame,pm,key):
    rows=[]
    for dz,cc in frame.items():
        pop=sum(cc.values())
        if pop<50: continue
        yesr=sum(pm[key(k)]*n for k,n in cc.items())/pop
        rows.append((dz,dzlabel.get(dz),100*yesr,pop))
    d=pd.DataFrame(rows,columns=['DZ21','label','yes_raw','pop']).set_index('DZ21')
    shift=TOPLINE-np.average(d['yes_raw'],weights=d['pop'])
    d['yes']=( d['yes_raw']+shift ).clip(0,100).round(1)      # re-centre to topline, preserve shape
    return d,shift
dA,sA=poststrat(frameA,pA,lambda k:k)
dB,sB=poststrat(frameB,pB,lambda k:k)
dzcon=json.load(open(f"{V}/dz_constituency.json"))
for d in (dA,dB): d['con']=d.index.map(dzcon)
print(f"\n2019 poststratified NI Yes-of-decided: A {np.average(dA['yes_raw'],weights=dA['pop']):.1f}%  B {np.average(dB['yes_raw'],weights=dB['pop']):.1f}%  (re-centred to {TOPLINE:.0f}%)")

for name,d in [("A religion x identity x age (2,189 DZs)",dA),("B religion x age (3,266 DZs)",dB)]:
    majY=100*d.loc[d['yes']>50,'pop'].sum()/d['pop'].sum()
    print(f"\n=== {name} — re-centred to {TOPLINE:.0f}% ===")
    print(f"  DZs > 50% Yes: {(d['yes']>50).sum()}/{len(d)}  ({majY:.0f}% of population lives in a majority-Yes DZ)")
    print(f"  highest-Yes DZs:  "+", ".join(f"{r.label}({r.yes:.0f})" for r in d.nlargest(5,'yes').itertuples()))
    print(f"  lowest-Yes DZs:   "+", ".join(f"{r.label}({r.yes:.0f})" for r in d.nsmallest(5,'yes').itertuples()))
# constituency aggregate (frame B, fuller coverage)
con=dB.dropna(subset=['con']).groupby('con').apply(lambda g:np.average(g['yes'],weights=g['pop'])).sort_values(ascending=False).round(1)
print("\nConstituency Yes-share (frame B, re-centred):")
print("  top:   ",dict(con.head(5))); print("  bottom:",dict(con.tail(5)))
dA[['label','con','yes_raw','yes','pop']].round(2).to_csv(f"{V}/augment/unity_yes_dz21_identity.csv")
dB[['label','con','yes_raw','yes','pop']].round(2).to_csv(f"{V}/augment/unity_yes_dz21_relage.csv")
print("\nwrote unity_yes_dz21_identity.csv (2,189 DZs), unity_yes_dz21_relage.csv (3,266 DZs)")
