#!/usr/bin/env python3
"""Joint level+area estimation, one process per poll date. Instead of fixing the NI level and
deriving area shape from a fixed 2019 model, we fit the Yes-of-decided propensity on EACH NILT wave
(2019-2025 -- real unity polls at distinct dates) and poststratify onto the 2021 census frame. The
NI-wide level AND the Data-Zone variation both fall out of the SAME wave's data -- no re-centring.
Because the demographic gradient of Yes shifts over time (Brexit), each date gets its own gradient,
so a DZ's estimate moves with both composition and the era's attitudes. Emits the time series and the
latest-wave DZ map (the current data-driven estimate)."""
import os, glob, gzip, csv, json, collections
import numpy as np, pandas as pd, pyreadstat
from sklearn.linear_model import LogisticRegression
V="analysis/border-poll-dry-run/v9"; D="data/census/derived"
RA=f"{D}/dz21-religion-age-2021.csv.gz"
def crel(s): s=s.lower(); return 'C' if 'catholic' in s else 'P' if 'protestant' in s else 'N'
def cage(s):
    import re
    if '65' in s: return '65+'
    n=re.findall(r'(\d+)',s); lo=int(n[0])
    return None if lo<16 else '18-24' if lo<25 else '25-34' if lo<35 else '35-44' if lo<45 else '45-54' if lo<55 else '55-64' if lo<65 else '65+'
AGES=['18-24','25-34','35-44','45-54','55-64','65+']
# census religion x age frame (3,266 DZs)
frame=collections.defaultdict(lambda:collections.defaultdict(float)); dzlabel={}
with gzip.open(RA,'rt') as f:
    rd=csv.reader(f);next(rd)
    for row in rd:
        a=cage(row[3])
        if a is None: continue
        dzlabel[row[0]]=row[1]
        try:n=float(row[-1])
        except:continue
        frame[row[0]][(crel(row[5]),a)]+=n
dzcon=json.load(open(f"{V}/dz_constituency.json"))

def amap_lab(s):
    import re;s=str(s).lower();n=re.findall(r'(\d+)',s)
    if not n:return None
    lo=int(n[0]);return None if lo<18 else '18-24' if lo<25 else '25-34' if lo<35 else '35-44' if lo<45 else '45-54' if lo<55 else '55-64' if lo<65 else '65+'
def wave_yes_model(path):
    for enc in ('utf-8','latin1'):
        try: df,m=pyreadstat.read_sav(path,encoding=enc); break
        except: df=None
    if df is None: return None
    c={x.lower():x for x in m.column_names}
    Lb=lambda v:m.variable_value_labels.get(c[v],{})
    wv=next((k for k in ('wtfactor','wtnew','weight') if k in c),None)
    w=df[c[wv]].fillna(0).values if wv else np.ones(len(df))
    # unity question: REFUNIFY (Yes/No) preferred; else constitutional reunify vs UK
    uq=next((k for k in ('refunify',) if k in c),None)
    if uq:
        lab=Lb(uq);x=df[c[uq]].values
        yes=np.array([1 if str(lab.get(v,'')).lower().startswith('yes') else 0 if str(lab.get(v,'')).lower().startswith('no') else -1 for v in x])
    else:
        cv=next((k for k in ('nirelnd2','nireland','nirelnd') if k in c),None)
        if not cv: return None
        lab=Lb(cv);x=df[c[cv]].values
        def cls(v):
            s=str(lab.get(v,'')).lower()
            return 1 if 'reunif' in s else 0 if 'united kingdom' in s or 'remain part' in s else -1
        yes=np.array([cls(v) for v in x])
    if 'religcat' not in c or 'ragecat' not in c: return None
    rel=np.array([crel(str(Lb('religcat').get(v,''))) if str(Lb('religcat').get(v,'')).strip() else 'O' for v in df[c['religcat']].values])
    age=np.array([amap_lab(Lb('ragecat').get(v,'')) for v in df[c['ragecat']].values],dtype=object)
    dec=(yes>=0)&(w>0)&np.isin(rel,['C','P','N'])&(age!=None)
    if dec.sum()<200: return None
    def F(r,a): return [[1.0 if r[j]=='P' else 0,1.0 if r[j]=='N' else 0]+[1.0 if a[j]==k else 0 for k in AGES[1:]] for j in range(len(r))]
    clf=LogisticRegression(C=1.0,max_iter=4000).fit(np.array(F(rel[dec],age[dec])),yes[dec],sample_weight=w[dec])
    pm={(r,a):clf.predict_proba(np.array(F([r],[a])))[0,1] for r in ['C','P','N'] for a in AGES}
    raw=100*np.average(yes[dec],weights=w[dec])
    return pm,raw,int(dec.sum())

rows=[]; lastmap=None; lastyr=None
for path in sorted(glob.glob("data/surveys/nilt/raw/*.sav")):
    yr=int(os.path.basename(path)[:4])
    if yr<2019: continue
    r=wave_yes_model(path)
    if r is None: continue
    pm,raw,n=r
    # poststratify onto the census frame -> per-DZ Yes-of-decided (level+shape jointly)
    recs=[]
    for dz,cc in frame.items():
        pop=sum(cc.values())
        if pop<50: continue
        recs.append((dz,100*sum(pm[k]*v for k,v in cc.items())/pop,pop))
    d=pd.DataFrame(recs,columns=['DZ21','yes','pop']).set_index('DZ21')
    ni=np.average(d['yes'],weights=d['pop'])
    majpop=100*d.loc[d['yes']>50,'pop'].sum()/d['pop'].sum()
    rows.append({'wave':yr,'n_decided':n,'nilt_raw_yes':round(raw,1),'poststrat_ni_yes':round(ni,1),
                 'dzs_over50':int((d['yes']>50).sum()),'pop_in_majYes_pct':round(majpop,1)})
    lastmap,lastyr=d,yr
ts=pd.DataFrame(rows)
print("Joint level+area by poll date (NILT wave); level and map both from the SAME wave, no re-centring:")
print(ts.to_string(index=False))
# 3-wave smoothing (pool adjacent polls) for the current anchor
ts['smoothed_ni_yes']=ts['poststrat_ni_yes'].rolling(3,center=True,min_periods=1).mean().round(1)
print("\n3-wave-smoothed poststrat NI Yes (pooling adjacent polls):",dict(zip(ts['wave'],ts['smoothed_ni_yes'])))
ts.to_csv(f"{V}/augment/unity_timeseries_dz.csv",index=False)
# latest-wave DZ map (data-driven current estimate)
lastmap['con']=lastmap.index.map(dzcon); lastmap['label']=lastmap.index.map(dzlabel)
lastmap[['label','con','yes','pop']].round(2).to_csv(f"{V}/augment/unity_yes_dz21_{lastyr}.csv")
con=lastmap.dropna(subset=['con']).groupby('con').apply(lambda g:np.average(g['yes'],weights=g['pop']),include_groups=False).sort_values(ascending=False).round(1)
print(f"\n=== {lastyr} data-driven DZ map (NI {np.average(lastmap['yes'],weights=lastmap['pop']):.1f}%) ===")
print("  constituency Yes top:",dict(con.head(4)),"bottom:",dict(con.tail(4)))
print(f"  DZs>50% Yes: {(lastmap['yes']>50).sum()}/{len(lastmap)}")
print(f"wrote unity_timeseries_dz.csv, unity_yes_dz21_{lastyr}.csv")
