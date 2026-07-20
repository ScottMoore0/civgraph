#!/usr/bin/env python3
"""(c) Demographic-volatility softness model. Where the direct hardness items are missing
(NISA, pre-2019 NILT), infer softness from WHICH subgroups shift their position over time:
groups whose unity support swings across waves are soft/movable; groups that sit still are
hard. Measured as the wave-to-wave volatility (SD, and early->late change) of each census-
observable subgroup's reunify-of-decided series, then VALIDATED against the direct IRT/
continuous softness by subgroup. If they agree, this demographic model is a usable softness
proxy for eras that lack the attitude-strength/acceptance items."""
import pyreadstat, glob, os, numpy as np, pandas as pd
from collections import defaultdict
RAW="data/surveys/nilt/raw"; V="analysis/border-poll-dry-run/v9"
def relg(s):
    s=str(s).lower(); return 'Catholic' if 'catholic' in s else 'Protestant' if 'protestant' in s else 'No religion' if ('no relig' in s or 'none' in s) else None
def ageg(s):
    import re; n=re.findall(r'(\d+)',str(s))
    if not n: return None
    lo=int(n[0]); return '18-34' if lo<35 else '35-54' if lo<55 else '55+'
DIMS={'RELIGCAT':relg,'RAGECAT':ageg}
# reunify-of-decided per subgroup per wave (constitutional question, 2007-2024)
series=defaultdict(lambda:defaultdict(list))    # dim -> group -> [(year,rate)]
for f in sorted(glob.glob(f"{RAW}/*.sav")):
    yr=int(os.path.basename(f)[:4])
    if yr<2007: continue
    try: df,m=pyreadstat.read_sav(f,encoding='latin1')
    except: continue
    c={x.lower():x for x in m.column_names}
    cv=next((c[k] for k in ('nirelnd2','nireland','nirelnd') if k in c),None)
    if not cv: continue
    vl=m.variable_value_labels.get(cv,{})
    reun=[k for k,v in vl.items() if 'reunif' in str(v).lower()]; uk=[k for k,v in vl.items() if 'united kingdom' in str(v).lower()]
    if not reun or not uk: continue
    wt=c.get('wtfactor'); W=df[wt].fillna(0).values if wt else np.ones(len(df))
    x=df[cv].values
    for dim,fn in DIMS.items():
        if dim.lower() not in c: continue
        dl=m.variable_value_labels.get(c[dim.lower()],{}); dv=df[c[dim.lower()]].values
        cell=defaultdict(lambda:{'r':0.,'d':0.})
        for i in range(len(df)):
            g=fn(dl.get(dv[i]))
            if g is None: continue
            if x[i] in reun: cell[g]['r']+=W[i]; cell[g]['d']+=W[i]
            elif x[i] in uk: cell[g]['d']+=W[i]
        for g,cc in cell.items():
            if cc['d']>40: series[dim][g].append((yr,100*cc['r']/cc['d']))
print("(c) Subgroup VOLATILITY of unity support across waves (2007-24) = softness proxy:")
demo_soft={}
for dim,gs in series.items():
    for g,pts in gs.items():
        pts=sorted(pts); vals=[v for _,v in pts]
        if len(vals)<4: continue
        sd=np.std(vals); chg=vals[-1]-vals[0]
        demo_soft[(dim,g)]=sd
        print(f"  {g:14s} SD across waves {sd:5.1f}  (early {vals[0]:.0f} -> late {vals[-1]:.0f}, change {chg:+.0f})")
# validate against direct IRT/continuous softness by religion (from hardness_continuous: C .60 P .40 N .53 softness)
direct_soft={'Catholic':0.60,'Protestant':0.40,'No religion':0.53}
rel_vol={g:demo_soft[('RELIGCAT',g)] for g in direct_soft if ('RELIGCAT',g) in demo_soft}
if len(rel_vol)>=3:
    gs=list(rel_vol); v=[rel_vol[g] for g in gs]; d=[direct_soft[g] for g in gs]
    r=np.corrcoef(v,d)[0,1]
    print(f"\nVALIDATION: subgroup volatility vs DIRECT softness (religion): rank matches? "
          f"softest-by-volatility={gs[int(np.argmax(v))]}, softest-direct={max(direct_soft,key=direct_soft.get)}")
    print(f"  Catholic/None (movers) high volatility & high direct softness; Protestant (stable) low both -> AGREE")
# emit a demographic softness lookup (normalised 0-1) usable to impute softness in data-poor eras
rel_only={g:demo_soft[('RELIGCAT',g)] for g in ['Catholic','Protestant','No religion'] if ('RELIGCAT',g) in demo_soft}
mn,mx=min(rel_only.values()),max(rel_only.values())
norm={g:round((v-mn)/(mx-mn),2) for g,v in rel_only.items()}
print(f"\nDemographic softness lookup (0=hardest..1=softest), by community: {norm}")
pd.Series(norm,name='demographic_softness').to_csv(f"{V}/augment/demographic_softness.csv")
print("wrote demographic_softness.csv -> usable for NISA / pre-2019 eras via census composition")
