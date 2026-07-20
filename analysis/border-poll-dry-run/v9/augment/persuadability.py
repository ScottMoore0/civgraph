#!/usr/bin/env python3
"""Persuadable-middle map + area-specific uncertainty.

Builds a 5-band persuadability typology per NILT respondent (2019-2021, the waves with the
identity-STRENGTH item UNINATST) -- HARD union / SOFT union / UNDECIDED / SOFT unity / HARD
unity -- then computes the band mix by community background (census-observable) and
poststratifies onto each constituency's religion composition. Output per area: the five band
shares, the PERSUADABLE share, a Yes-lean, and an area-specific uncertainty width driven by
how soft the area is (a 60%-hard area is near-certain; a 60%-soft area is a coin-toss).
Propagated to Data Zones."""
import pyreadstat, glob, os, json, numpy as np, pandas as pd
from collections import defaultdict
RAW="data/surveys/nilt/raw"; V="analysis/border-poll-dry-run/v9"
BANDS=['HARD union','SOFT union','UNDECIDED','SOFT unity','HARD unity']
def relgrp(s):
    s=str(s).lower()
    return 'C' if 'catholic' in s else 'P' if 'protestant' in s else 'N' if ('no relig' in s or 'none' in s) else None
# ---- per-respondent bands, band-mix by religion, pooled 2019-2021 ----
agg=defaultdict(lambda:defaultdict(float))    # religion -> band -> weight
for f in sorted(glob.glob(f"{RAW}/*.sav")):
    yr=int(os.path.basename(f)[:4])
    if yr not in (2019,2020,2021): continue
    df,m=pyreadstat.read_sav(f,encoding='latin1'); c={x.lower():x for x in m.column_names}
    if not all(k in c for k in ('refunify','uninatst','uninatid','religcat','wtfactor')): continue
    rL,sL,iL=(m.variable_value_labels.get(c[v],{}) for v in ('refunify','uninatst','uninatid'))
    reL=m.variable_value_labels.get(c['religcat'],{})
    w=df[c['wtfactor']].fillna(0).values
    ref,st,idn,rel=(df[c[v]].values for v in ('refunify','uninatst','uninatid','religcat'))
    for i in range(len(df)):
        g=relgrp(reL.get(rel[i]))
        if g is None: continue
        rl,sl,dl=str(rL.get(ref[i],'')).lower(),str(sL.get(st[i],'')).lower(),str(iL.get(idn[i],'')).lower()
        strong=('very strong' in sl) or ('fairly strong' in sl)
        if rl.startswith('yes'): band='HARD unity' if ('national' in dl and strong) else 'SOFT unity'
        elif rl.startswith('no'): band='HARD union' if ('unionist' in dl and strong) else 'SOFT union'
        else: band='UNDECIDED'
        agg[g][band]+=w[i]
rate={g:{b:100*agg[g].get(b,0)/sum(agg[g].values()) for b in BANDS} for g in agg}
print("Band mix by community background (NILT 2019-21, weighted %):")
print(f"{'':10}"+''.join(f"{b[:9]:>11}" for b in BANDS))
for g in ['C','P','N']:
    print(f"{g:10}"+''.join(f"{rate[g][b]:>11.1f}" for b in BANDS))

# ---- poststratify onto constituency religion composition ----
cf=pd.read_csv(f"{V}/constituency_features.csv"); cf['con']=cf['con'].str.upper(); cf=cf.set_index('con')
comp=pd.DataFrame({'C':cf['rel__Catholic'],'P':cf[[x for x in cf if x.startswith('rel__Protestant')]].sum(axis=1),
                   'N':cf[[x for x in cf if x.startswith('rel__Other') or x=='rel__None']].sum(axis=1)})
comp=comp.div(comp.sum(axis=1),axis=0)
out={}
for con in cf.index:
    mix={b:sum(comp.loc[con,g]*rate[g][b] for g in ['C','P','N']) for b in BANDS}
    persuadable=mix['SOFT union']+mix['UNDECIDED']+mix['SOFT unity']
    yes_lean=mix['HARD unity']+mix['SOFT unity']            # current Yes (of everyone incl undecided base)
    # of-decided-ish lean and a persuadable-driven uncertainty half-width
    dec=mix['HARD unity']+mix['SOFT unity']+mix['HARD union']+mix['SOFT union']
    dec_yes=100*(mix['HARD unity']+mix['SOFT unity'])/dec if dec>0 else np.nan   # Yes% of those with a lean
    battle=persuadable*(1-abs(dec_yes-50)/50)                                    # soft AND balanced
    out[con]=dict(**{b:round(mix[b],1) for b in BANDS},persuadable=round(persuadable,1),
                  dec_yes=round(dec_yes,1),battleground=round(battle,1),
                  swing_halfwidth=round(0.5*persuadable*0.6,1))
P=pd.DataFrame(out).T
P.index.name='con'; P.sort_values('battleground',ascending=False).to_csv(f"{V}/augment/persuadability_constituency.csv")
print("\nGenuine BATTLEGROUNDS (high soft AND balanced lean):")
print(P.sort_values('battleground',ascending=False)[['persuadable','dec_yes','HARD union','HARD unity','battleground']].head(5).to_string())
print("\nSoft but Yes-LEANING (persuadable, not balanced):")
print(P.sort_values('persuadable',ascending=False)[['persuadable','dec_yes']].head(4).to_string())
print("\nLOCKED unionist (least persuadable):")
print(P.sort_values('persuadable')[['persuadable','dec_yes','HARD union']].head(4).to_string())
print(f"\nNI persuadable share (con mean): {P['persuadable'].mean():.0f}%  -> area outcomes hinge on how a ~half-soft electorate breaks")

# ---- propagate persuadable share to Data Zones ----
dz=pd.read_csv("data/census/derived/dz21-community-2021.csv"); dz['con']=dz['DZ21'].map(json.load(open(f"{V}/dz_constituency.json")))
dz['persuadable']=dz['con'].map(P['persuadable']); dz['swing_halfwidth']=dz['con'].map(P['swing_halfwidth'])
dz[['DZ21','con','catholic_bg_pct','persuadable','swing_halfwidth']].dropna().to_csv(f"{V}/augment/persuadability_dz.csv",index=False)
print(f"wrote persuadability_constituency.csv + persuadability_dz.csv ({dz['persuadable'].notna().sum()} DZs)")
