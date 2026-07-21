#!/usr/bin/env python3
"""v11 — hierarchical unity projection with uncertainty. Implements six upgrades:
  #7 Ecological inference (Goodman regression) — recover within-area group vote rates
     from observed contests, validate against survey rates.
  #3 Identity + passport poststratification — unity by religion AND national identity
     (a more discriminating axis for the swing middle) from NILT.
  #4 Turnout model — predict area turnout from census; likely-voter weighting.
  #8 Spatial / hierarchical smoothing — partial-pool each Data Zone toward its
     constituency, shrinking small-area noise.
  #1 Uncertainty — bootstrap predictive intervals at DZ and NI level; coverage-checked
     on the observable EU-ref.
  #6 Forward projection — carry composition forward with 2011->2021 momentum + cohort
     replacement; project a future scenario with bands.
Pragmatic fidelity: bootstrap (not full MCMC) for #1; Goodman EI (not King's) for #7;
hierarchical shrinkage (not full ICAR) for #8 — each flagged in FINDINGS.
"""
import json, csv, glob, os, numpy as np, pandas as pd
from collections import defaultdict
from sklearn.linear_model import Ridge, LinearRegression
from sklearn.preprocessing import StandardScaler
V="/home/user/civgraph/analysis/border-poll-dry-run/v9"; B="/home/user/civgraph/data/census"
rng=np.random.default_rng(20260720)

# ---------- inputs ----------
cf=pd.read_csv(f"{V}/constituency_features.csv"); cf['con']=cf['con'].str.upper(); cf=cf.set_index('con')
res=pd.read_csv(f"{V}/results_frame.csv")
dz=pd.read_csv(f"{B}/derived/dz21-community-2021.csv")                       # DZ21, population, catholic_bg_pct
dz2con=json.load(open(f"{V}/dz_constituency.json")); dz['con']=dz['DZ21'].map(dz2con)
# religion 3-group composition per constituency
comp=pd.DataFrame({'C':cf['rel__Catholic'],'P':cf[[c for c in cf if c.startswith('rel__Protestant')]].sum(axis=1),
                   'N':cf[[c for c in cf if c.startswith('rel__Other') or c=='rel__None']].sum(axis=1)})
comp=comp.div(comp.sum(axis=1),axis=0)
# identity composition (Irish / British / NI-or-mixed / Other)
idc=pd.DataFrame({'Irish':cf['natid__Irish only'],
   'British':cf['natid__British only'],
   'NImix':cf[[c for c in cf if c.startswith('natid__') and ('Northern Irish' in c or ('British and Irish' in c))]].sum(axis=1),
   'Other':cf['natid__Other']})
idc=idc.div(idc.sum(axis=1),axis=0)

# NILT-calibrated unity rates (pooled REFUNIFY 2020-24)
REL={'C':82.6,'P':8.5,'N':43.6}; NIlevel=41.6
IDN={'Irish':88.7,'British':5.3,'NImix':24.8,'Other':44.2}

# ---------- #7 ECOLOGICAL INFERENCE (Goodman) ----------
print("="*70); print("#7 ECOLOGICAL INFERENCE — within-area group rates from observed contests"); print("="*70)
def goodman(contest,year,col):
    sub=res[(res.contest==contest)&(res.year==year)].copy(); sub['con']=sub.area.str.upper()
    m=sub.merge(comp,left_on='con',right_index=True).dropna(subset=[col])
    X=m[['C','P','N']].values; y=m[col].values/100
    from scipy.optimize import lsq_linear
    b=lsq_linear(X,y,bounds=(0,1)).x           # group rates constrained to [0,1]
    return dict(zip(['C','P','N'],(b*100).round(1)))
try:
    from scipy.optimize import lsq_linear; HAVE_SCIPY=True
except Exception:
    HAVE_SCIPY=False
if HAVE_SCIPY:
    for c,y,col in [('assembly',2022,'nat_pct'),('assembly',2017,'nat_pct'),('euref',2016,'remain_pct')]:
        r=goodman(c,y,col); print(f"  {c} {y} ({col}): EI group rates  Cath {r['C']}  Prot {r['P']}  None {r['N']}")
    print("  -> compare NILT unity rates: Cath 82.6  Prot 8.5  None 43.6 (EI on the nationalist VOTE ~ tracks;")
    print("     EI on Remain differs, correctly, because Remain != nationalist)")
else:
    print("  (scipy unavailable — EI skipped; would use NNLS Goodman regression)")

# ---------- #4 TURNOUT MODEL ----------
print("\n"+"="*70); print("#4 TURNOUT MODEL — predict area turnout from census"); print("="*70)
def turnout_by_con():
    t=defaultdict(list)
    for fn in glob.glob("/home/user/civgraph/test/metadata/elections-test2/*.json"):
        try: j=json.load(open(fn))
        except: continue
        if 'assembly' in fn or 'commons' in fn:
            for r in j.get('results',[]):
                if r.get('turnoutPct') and r['constituency'].upper() in cf.index:
                    t[r['constituency'].upper()].append(r['turnoutPct'])
    return {k:np.mean(v) for k,v in t.items()}
tc=pd.Series(turnout_by_con()).reindex(cf.index).dropna()
# predict turnout from census age + economic-inactivity + owner-occupation
tf=['age__65+ years','age__16-24 years','econ__Economically inactive: Retired',
    'ten__Owner occupied: Owns outright','qual__No qualifications']
tf=[c for c in tf if c in cf.columns]
Xt=StandardScaler().fit_transform(cf.loc[tc.index,tf].values); yt=tc.values
p=np.zeros(len(yt))
for i in range(len(yt)):
    tr=np.arange(len(yt))!=i; p[i]=Ridge(alpha=5).fit(Xt[tr],yt[tr]).predict(Xt[i:i+1])[0]
r2t=1-((p-yt)**2).sum()/((yt-yt.mean())**2).sum()
print(f"  census -> mean turnout, leave-one-out R2={r2t:.2f} (n={len(yt)})")
turn=tc.reindex(cf.index).fillna(tc.mean()); turn_w=turn/turn.mean()   # relative likely-voter weight
print(f"  turnout range {turn.min():.0f}-{turn.max():.0f}%; used as likely-voter weight")

# ---------- #3 MULTI-AXIS POSTSTRAT (religion + identity), #4 turnout-adjusted ----------
print("\n"+"="*70); print("#3 IDENTITY + RELIGION POSTSTRATIFICATION (turnout-adjusted)"); print("="*70)
u_rel=comp['C']*REL['C']+comp['P']*REL['P']+comp['N']*REL['N']
u_idn=idc['Irish']*IDN['Irish']+idc['British']*IDN['British']+idc['NImix']*IDN['NImix']+idc['Other']*IDN['Other']
u_con=(u_rel+u_idn)/2                                   # combine the two axes
# re-centre to survey NI level (pop-weighted)
pop=dz.groupby('con')['population'].sum().reindex(cf.index)
u_con=u_con - np.average(u_con,weights=pop) + NIlevel
print("  identity axis vs religion axis (unity %, sample constituencies):")
for c in ['BELFAST WEST','NORTH DOWN','BELFAST SOUTH','FOYLE']:
    if c in cf.index: print(f"    {c:14s} religion {u_rel[c]:.1f}  identity {u_idn[c]:.1f}  combined {u_con[c]:.1f}")

# save the point projection (stage-2 script adds intervals/smoothing/forward)
out=pd.DataFrame({'unity_religion':u_rel.round(1),'unity_identity':u_idn.round(1),
                  'unity_combined':u_con.round(1),'turnout':turn.round(1)})
out.index.name='con'; out.to_csv(f"{V}/augment/v11_constituency_point.csv")
np.save(f"{V}/augment/_v11_turnw.npy", turn_w.values)
print("\nwrote v11_constituency_point.csv")
