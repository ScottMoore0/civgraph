#!/usr/bin/env python3
"""Calibrate unity preference by party support, from NILT (pooled 2020-2024, the waves
carrying REFUNIFY, the actual Yes/No border-poll question), weighted. This is the bridge
that lets party composition inform the UNITY geography: it says how likely each party's
supporters are to vote for a united Ireland -- crucially quantifying the persuadable
MIDDLE (Alliance and 'no party' supporters) that census religion cannot see."""
import pyreadstat, numpy as np, os, json
RAW="/home/user/civgraph/data/surveys/nilt/raw"
WAVES=['2020_nilt20w1','2021_nilt21w1','2022_nilt22w1','2023_nilt23w1','2024_nilt24w1']
def grp(lab):
    l=str(lab).lower()
    if 'dup' in l or 'democratic unionist' in l: return 'DUP'
    if 'ulster unionist' in l or l=='uup': return 'UUP'
    if 'traditional unionist' in l or 'tuv' in l: return 'TUV'
    if 'sinn' in l: return 'SF'
    if 'sdlp' in l or 'social democratic' in l: return 'SDLP'
    if 'alliance' in l: return 'Alliance'
    if 'green' in l: return 'Green'
    if 'people before profit' in l or 'pbp' in l: return 'PBP'
    if 'none' in l or 'no party' in l or "don't" in l or 'other' in l or 'not' in l: return 'None/Other'
    return None
agg={}
for w in WAVES:
    df,m=pyreadstat.read_sav(f"{RAW}/{w}.sav",encoding='latin1')
    cols={c.lower():c for c in m.column_names}
    pv=cols.get('polpart2') or cols.get('polparty'); rv=cols.get('refunify'); wt=cols.get('wtfactor')
    if not pv or not rv: continue
    plab=m.variable_value_labels.get(pv,{}); rlab=m.variable_value_labels.get(rv,{})
    yes=[k for k,v in rlab.items() if 'yes' in str(v).lower()]; no=[k for k,v in rlab.items() if str(v).lower().startswith('no')]
    W=df[wt].fillna(0).values if wt else np.ones(len(df))
    for i in range(len(df)):
        g=grp(plab.get(df[pv].values[i])); r=df[rv].values[i]
        if g is None: continue
        a=agg.setdefault(g,{'yes':0.0,'dec':0.0})
        if r in yes: a['yes']+=W[i]; a['dec']+=W[i]
        elif r in no: a['dec']+=W[i]
rate={g:100*a['yes']/a['dec'] for g,a in agg.items() if a['dec']>50}
order=['SF','SDLP','Green','Alliance','None/Other','UUP','DUP','TUV','PBP']
print("Unity (Yes) support by party support -- NILT REFUNIFY pooled 2020-2024, weighted:")
for g in order:
    if g in rate: print(f"  {g:12s} {rate[g]:5.1f}%  (n_dec~{agg[g]['dec']:.0f})")
json.dump(rate,open(f"{os.path.dirname(__file__)}/unity_by_party.json","w"),indent=1)
print("\nThe persuadable middle: Alliance %.1f%%, None/Other %.1f%% -- the swing census religion can't see."%(
    rate.get('Alliance',float('nan')),rate.get('None/Other',float('nan'))))
