import pyreadstat, glob, os, numpy as np, pandas as pd
from collections import defaultdict
RAW="data/surveys/nilt/raw"
def load(yr):
    for enc in ('latin1','utf-8'):
        try: return pyreadstat.read_sav(f"{RAW}/{yr}",encoding=enc)
        except: continue
    return None,None
def lab(meta,var): return meta.variable_value_labels.get(var,{})
def norm_uninat(s):
    s=str(s).lower()
    if 'unionist' in s and 'not' not in s: return 'Unionist'
    if 'nationalist' in s: return 'Nationalist'
    if 'neither' in s: return 'Neither'
    return None
def norm_rel(s):
    s=str(s).lower()
    if 'catholic' in s: return 'Catholic'
    if 'protestant' in s: return 'Protestant'
    if 'no relig' in s or 'none' in s: return 'No religion'
    return 'Other'
def norm_party(s):
    s=str(s).lower()
    for p,g in [('dup','DUP/unionist'),('ulster unionist','DUP/unionist'),('uup','DUP/unionist'),('tuv','DUP/unionist'),
                ('sinn','SF/SDLP'),('sdlp','SF/SDLP'),('alliance','Alliance/Green'),('green','Alliance/Green'),
                ('none','None/other'),('other','None/other')]:
        if p in s: return g
    return 'None/other'
DIMS={'UNINATID':norm_uninat,'RELIGCAT':norm_rel,'POLPART2':norm_party,'RAGECAT':lambda s:str(s)[:22],'URBRUR':lambda s:str(s)[:16]}

def tally(years, qvar):
    agg=defaultdict(lambda:defaultdict(lambda:{'y':0.,'d':0.}))
    for f in years:
        df,m=load(f)
        if df is None: continue
        cols={c.lower():c for c in m.column_names}
        qc=cols.get(qvar.lower())
        if not qc: continue
        vl=lab(m,qc)
        if qvar=='REFUNIFY':
            yes=[k for k,v in vl.items() if str(v).lower().startswith('yes')]; no=[k for k,v in vl.items() if str(v).lower().startswith('no')]
        else:
            yes=[k for k,v in vl.items() if 'reunif' in str(v).lower()]; no=[k for k,v in vl.items() if 'united kingdom' in str(v).lower()]
        if not yes or not no: continue
        wt=cols.get('wtfactor'); W=df[wt].fillna(0).values if wt else np.ones(len(df))
        x=df[qc].values
        for dim,fn in DIMS.items():
            dc=cols.get(dim.lower())
            if not dc: continue
            dl=lab(m,dc)
            for i in range(len(df)):
                g=fn(dl.get(df[dc].values[i]))
                if g is None: continue
                cell=agg[dim][g]
                if x[i] in yes: cell['y']+=W[i]; cell['d']+=W[i]
                elif x[i] in no: cell['d']+=W[i]
    return {dim:{g:(100*c['y']/c['d'],c['d']) for g,c in gs.items() if c['d']>60} for dim,gs in agg.items()}

allw=sorted(glob.glob(f"{RAW}/*.sav"))
recent=[f for f in allw if int(os.path.basename(f)[:4])>=2020]
early=[f for f in allw if 2007<=int(os.path.basename(f)[:4])<=2012]
late=[f for f in allw if int(os.path.basename(f)[:4])>=2019]
NOW=tally([os.path.basename(f) for f in recent],'REFUNIFY')     # current Yes-of-decided
E=tally([os.path.basename(f) for f in early],'NIRELND2')        # constitutional reunify, early
L=tally([os.path.basename(f) for f in late],'NIRELND2')         # constitutional reunify, late
print("SUBGROUP unity support (Yes-of-decided) + CHANGE (constitutional reunify, 2007-12 -> 2019-24)")
print(f"{'dimension / group':30s}{'NOW %':>8}{'early':>8}{'late':>8}{'Δ':>8}")
for dim in DIMS:
    print(f"-- {dim} --")
    rows=[]
    for g in set(list(NOW.get(dim,{}))+list(E.get(dim,{}))+list(L.get(dim,{}))):
        now=NOW.get(dim,{}).get(g,(np.nan,0))[0]; e=E.get(dim,{}).get(g,(np.nan,0))[0]; l=L.get(dim,{}).get(g,(np.nan,0))[0]
        rows.append((g,now,e,l,(l-e) if not (np.isnan(l) or np.isnan(e)) else np.nan))
    for g,now,e,l,dd in sorted(rows,key=lambda r:-(r[1] if not np.isnan(r[1]) else -1)):
        print(f"  {g:26s}{now:>8.0f}{e:>8.0f}{l:>8.0f}{dd:>+8.0f}")
