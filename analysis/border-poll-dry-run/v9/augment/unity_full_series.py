"""Fully continuous 1989->2025 unity level on ONE Data-Zone pipeline. Three eras, one machinery
(poststratify a per-wave propensity onto the 2021 DZ religion[xage] frame), harmonised to the
border-poll REFUNIFY(Yes) scale:
  1989-1996  NISA         community reunify rates x DZ religion            + 4.9 offset
  1998-2018  NILT const.  reunify-of-decided propensity (religion x age)   + 4.9 offset
  2019-2025  NILT REFUNIFY yes-of-decided propensity (religion x age)      + 0.0 (already border-poll)
The +4.9pt is the documented within-NILT constitutional->border-poll bridge."""
import os, glob, gzip, csv, collections, re, numpy as np, pandas as pd, pyreadstat
from sklearn.linear_model import LogisticRegression
V="analysis/border-poll-dry-run/v9"; H=f"{V}/hist"; OFFSET=4.9
RA=f"data/census/derived/dz21-religion-age-2021.csv.gz"
def crel(s): s=s.lower(); return 'C' if 'catholic' in s else 'P' if 'protestant' in s else 'N'
def cage(s):
    if '65' in s: return '65+'
    n=re.findall(r'(\d+)',s);
    if not n: return None
    lo=int(n[0]); return None if lo<16 else '18-24' if lo<25 else '25-34' if lo<35 else '35-44' if lo<45 else '45-54' if lo<55 else '55-64' if lo<65 else '65+'
AGES=['18-24','25-34','35-44','45-54','55-64','65+']
# DZ religion x age frame (+ religion-only shares for NISA)
frame=collections.defaultdict(lambda:collections.defaultdict(float)); rel=collections.defaultdict(lambda:collections.defaultdict(float))
with gzip.open(RA,'rt') as f:
    rd=csv.reader(f); next(rd)
    for r in rd:
        a=cage(r[3]);
        if a is None: continue
        try:n=float(r[-1])
        except:continue
        frame[r[0]][(crel(r[5]),a)]+=n; rel[r[0]][crel(r[5])]+=n
dzpop={d:sum(c.values()) for d,c in frame.items()}
DZ=[d for d in frame if dzpop[d]>=50]
W=np.array([dzpop[d] for d in DZ])

def amap(s):
    s=str(s).lower(); n=re.findall(r'(\d+)',s)
    if not n:return None
    lo=int(n[0]); return None if lo<18 else '18-24' if lo<25 else '25-34' if lo<35 else '35-44' if lo<45 else '45-54' if lo<55 else '55-64' if lo<65 else '65+'
def nilt_level(path):
    for enc in ('utf-8','latin1'):
        try: df,m=pyreadstat.read_sav(path,encoding=enc); break
        except: df=None
    if df is None: return None
    c={x.lower():x for x in m.column_names}; L=lambda v:m.variable_value_labels.get(c[v],{})
    if 'religcat' not in c or 'ragecat' not in c: return None
    wv=next((k for k in ('wtfactor','wtnew','weight') if k in c),None)
    w=df[c[wv]].fillna(0).values if wv else np.ones(len(df))
    if 'refunify' in c:                                     # border-poll question
        lab=L('refunify'); x=df[c['refunify']].values; off=0.0
        yes=np.array([1 if str(lab.get(v,'')).lower().startswith('yes') else 0 if str(lab.get(v,'')).lower().startswith('no') else -1 for v in x])
    else:
        cv=next((k for k in ('nirelnd2','nireland','nirelnd') if k in c),None)
        if not cv: return None
        lab=L(cv); x=df[c[cv]].values; off=OFFSET
        yes=np.array([1 if 'reunif' in str(lab.get(v,'')).lower() else 0 if ('united kingdom' in str(lab.get(v,'')).lower() or 'remain' in str(lab.get(v,'')).lower()) else -1 for v in x])
    R=np.array([crel(str(L('religcat').get(v,''))) if str(L('religcat').get(v,'')).strip() else 'O' for v in df[c['religcat']].values])
    A=np.array([amap(L('ragecat').get(v,'')) for v in df[c['ragecat']].values],dtype=object)
    ok=(yes>=0)&(w>0)&np.isin(R,['C','P','N'])&(A!=None)
    if ok.sum()<200: return None
    def F(r,a): return [[1.0 if r[j]=='P' else 0,1.0 if r[j]=='N' else 0]+[1.0 if a[j]==k else 0 for k in AGES[1:]] for j in range(len(r))]
    clf=LogisticRegression(C=1.0,max_iter=4000).fit(np.array(F(R[ok],A[ok])),yes[ok],sample_weight=w[ok])
    pm={(rr,aa):clf.predict_proba(np.array(F([rr],[aa])))[0,1] for rr in ['C','P','N'] for aa in AGES}
    lv=np.array([100*sum(pm[k]*n for k,n in frame[d].items())/dzpop[d] for d in DZ])
    return float(np.average(lv,weights=W))+off, ('REFUNIFY' if off==0 else 'NILT-const')

rows=[]
# NISA era
nisa=pd.read_csv(f"{H}/nisa_reunify.csv")
for _,n in nisa.iterrows():
    lv=np.array([ (rel[d].get('C',0)*n['reunify_catholic']+rel[d].get('P',0)*n['reunify_protestant']+rel[d].get('N',0)*n['reunify_none'])/dzpop[d] for d in DZ])
    rows.append({'wave':int(n['year']),'source':'NISA','ni_yes':round(float(np.average(lv,weights=W))+OFFSET,1)})
# NILT era 1998-2025
for p in sorted(glob.glob("data/surveys/nilt/raw/*.sav")):
    yr=int(os.path.basename(p)[:4])
    if yr<1998: continue
    r=nilt_level(p)
    if r is None: continue
    lv,src=r; rows.append({'wave':yr,'source':src,'ni_yes':round(lv,1)})
s=pd.DataFrame(rows).sort_values('wave').drop_duplicates('wave')
s['smooth']=s['ni_yes'].rolling(3,center=True,min_periods=1).mean().round(1)
print("Continuous 1989-2025 unity NI level (one DZ pipeline, harmonised REFUNIFY scale):")
print(s.to_string(index=False))
print(f"\n  span: {s['ni_yes'].iloc[0]:.0f}% ({int(s['wave'].iloc[0])}) -> {s['ni_yes'].iloc[-1]:.0f}% ({int(s['wave'].iloc[-1])})")
print(f"  era means: NISA {s[s.source=='NISA']['ni_yes'].mean():.1f}  NILT-const {s[s.source=='NILT-const']['ni_yes'].mean():.1f}  REFUNIFY {s[s.source=='REFUNIFY']['ni_yes'].mean():.1f}")
s.to_csv(f"{V}/augment/unity_ni_series_full_1989_2025.csv",index=False)
print("wrote unity_ni_series_full_1989_2025.csv")
