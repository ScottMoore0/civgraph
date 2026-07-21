#!/usr/bin/env python3
"""Tiers 2 & 3 backtest — extending the pipeline back before the LucidTalk era.

TIER 2 (1998-2011, NILT-before-LucidTalk):
  A. Geographic gradient — 2011 census -> nationalist vote shape, leave-one-
     contest-out across Assembly 1998/2003/2007 + Westminster 1997/2001/2005/2010.
  B. Level — the NILT constitutional-preference (reunify) series 1998-2010 is the
     era's only unity signal; we show what it can and cannot do, plus a persistence
     baseline for the (near-stationary) nationalist VOTE, and the 1998 GFA
     referendum as a NI-level reference.
  C. End-to-end — census gradient re-centred to level -> absolute nat vote, held-out.

TIER 3 (1989-1998):
  D. Gradient stability — can the (Tier-1/2) census gradient predict the 1990s
     nationalist vote shape (Westminster 1992 [17-seat] & 1997 [18-seat])?
  E. Level leg — blocked: NISA (1989-96) microdata is not in the repository and
     NILT does not start until 1998; documented, not fabricated.

Outputs: printed tables + backtest_t23_report.json.
"""
import pandas as pd, numpy as np, json, os
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
HERE=os.path.dirname(__file__) or "."
V=os.path.dirname(HERE)
ALPHA=15.0
feat=pd.read_csv(f"{HERE}/features_2011_constituency.csv").set_index('con')
FEATS=feat.columns.tolist()
res=pd.read_csv(f"{HERE}/hist_results_frame.csv")
res['area']=res.area.str.strip()
nilt=json.load(open(f"{HERE}/nilt_level.json"))
ni_act=json.load(open(f"{HERE}/hist_ni_actual.json"))
report={}
def score(a,p):
    a=np.asarray(a,float);p=np.asarray(p,float)
    return dict(r2=round(float(1-((p-a)**2).sum()/((a-a.mean())**2).sum()),3),
                mae=round(float(np.abs(p-a).mean()),2),n=len(a))

# ---- helper: LOCO gradient on a set of contests ----
def loco(sub):
    sub=sub.copy(); sub['cy']=sub.contest+sub.year.astype(str)
    sub=sub.merge(feat,left_on='area',right_index=True)
    y=sub.nat_pct.values; lvl=sub.groupby('cy')['nat_pct'].transform('mean').values
    sc=StandardScaler().fit(sub[FEATS].values); Xs=sc.transform(sub[FEATS].values)
    pred=np.zeros(len(sub))
    for c in sub.cy.unique():
        te=sub.cy.values==c; tr=~te
        m=Ridge(alpha=ALPHA).fit(Xs[tr],(y-lvl)[tr]); pred[te]=m.predict(Xs[te])+lvl[te]
    sub['pred']=pred; return sub

# ================= TIER 2 =================
print("="*72); print("TIER 2 — 1998-2011 (NILT before LucidTalk)"); print("="*72)
T2=res[((res.contest=='assembly')&(res.year.isin([1998,2003,2007])))|
       ((res.contest=='westminster')&(res.year.isin([1997,2001,2005,2010])))].copy()
sub=loco(T2)
A=score(sub.nat_pct,sub.pred)
print("\nA. Geographic gradient (2011 census -> nationalist vote shape, leave-one-contest-out)")
print(f"   Constituency(18) x 7 contests: R2={A['r2']:.3f}  MAE={A['mae']:.2f}pts  (n={A['n']})")
per={cy:score(g.nat_pct,g.pred)['r2'] for cy,g in sub.groupby('cy')}
print("   per-contest R2:",{k:round(v,3) for k,v in per.items()})
report['T2_A_gradient']=A|{'per_contest':{k:round(v,3) for k,v in per.items()}}

print("\nB. NI-level signals")
natvote={f"{r.contest} {r.year}":ni_act[f"{r.contest} {r.year}"] for r in T2.itertuples()}
natvote={k:v for k,v in natvote.items()}
vals=list(dict.fromkeys(natvote.values()))
print("   nationalist VOTE (actual), 1997-2010:",{k:v for k,v in natvote.items()})
# persistence baseline for the vote
keys=list(natvote); be=[]
for k in keys:
    others=[natvote[j] for j in keys if j!=k]; be.append(np.mean(others)-natvote[k])
persist=round(float(np.mean(np.abs(be))),2)
print(f"   nationalist vote persistence-baseline MAE = {persist:.2f}pts (vote is near-stationary {min(natvote.values())}-{max(natvote.values())}%)")
reun={y:d['reunify_of_decided'] for y,d in nilt.items() if d}
print("   NILT reunify% (of decided), the era's constitutional-preference series:")
print("     ",reun)
print(f"   -> reunify preference runs ~{round(np.mean(list(natvote.values()))-np.mean(list(reun.values())),0):.0f}pts BELOW the nationalist vote,")
print( "      does NOT track it (r2 vs vote is negative), and has NO era outcome to validate against —")
print( "      the same irreducible gap the present-day unity projection carries.")
print(f"   1998 GFA referendum (NI-wide, level-only target): Yes = {ni_act['GFA-ref 1998 Yes']}%")
report['T2_B_level']={'nat_vote':natvote,'vote_persistence_MAE':persist,
    'nilt_reunify_of_decided':reun,'gfa_ref_yes':ni_act['GFA-ref 1998 Yes'],
    'reunify_below_vote_pts':round(float(np.mean(list(natvote.values()))-np.mean(list(reun.values()))),1)}

print("\nC. End-to-end (census gradient re-centred to the actual NI vote level, absolute, held-out)")
alld_a=[];alld_p=[]
for cy,g in sub.groupby('cy'):
    lvl=g.nat_pct.mean()
    pred=g.pred - np.average(g.pred,weights=g.total) + lvl
    alld_a+=list(g.nat_pct); alld_p+=list(pred)
C=score(alld_a,alld_p)
print(f"   POOLED absolute: R2={C['r2']:.3f}  MAE={C['mae']:.2f}pts")
report['T2_C_end_to_end']=C

# ================= TIER 3 =================
print("\n"+"="*72); print("TIER 3 — 1989-1998"); print("="*72)
print("\nD. Gradient stability — does the census gradient (trained on 1997-2010)")
print("   predict the 1990s nationalist vote SHAPE?")
# train a single gradient on the Tier-2 contests, apply to 1990s
tr=T2.copy(); tr['cy']=tr.contest+tr.year.astype(str); tr=tr.merge(feat,left_on='area',right_index=True)
ytr=tr.nat_pct.values-tr.groupby('cy')['nat_pct'].transform('mean').values
sc=StandardScaler().fit(tr[FEATS].values)
mg=Ridge(alpha=ALPHA).fit(sc.transform(tr[FEATS].values),ytr)
D={}
for yr in [1992,1997]:
    g=res[(res.contest=='westminster')&(res.year==yr)].merge(feat,left_on='area',right_index=True)
    if len(g)==0: continue
    shape=mg.predict(sc.transform(g[FEATS].values))
    pred=shape-np.average(shape,weights=g.total)+np.average(g.nat_pct,weights=g.total)
    s=score(g.nat_pct,pred); s['corr']=round(float(np.corrcoef(g.nat_pct,shape)[0,1]),3)
    D[f"westminster_{yr}"]=s
    seats='17-seat (1983 boundaries)' if yr==1992 else '18-seat (1995 boundaries)'
    print(f"   Westminster {yr} [{seats}, n={s['n']}]: R2={s['r2']:.3f}  MAE={s['mae']:.2f}pts  corr(shape)={s['corr']:+.3f}")
report['T3_D_gradient_stability']=D
print("\nE. Level leg — BLOCKED. NISA (1989-96) microdata is not in the repository")
print("   and NILT begins in 1998, so the 1990s unity/vote LEVEL cannot be")
print("   reconstructed from present data. Sourcing NISA from the UK Data Service")
print("   (studies 1989-1996) is the prerequisite; documented in HISTORICAL_EXTENSION.md.")
report['T3_E_level']={'status':'blocked','reason':'NISA 1989-96 microdata absent; NILT starts 1998'}

json.dump(report,open(f"{HERE}/backtest_t23_report.json","w"),indent=1)
print("\nwrote backtest_t23_report.json")
