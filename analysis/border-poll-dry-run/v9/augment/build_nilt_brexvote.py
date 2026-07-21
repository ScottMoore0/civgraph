#!/usr/bin/env python3
"""Tier-2 survey signal: NILT 2016 'brexvote' (how did you vote in the EU referendum),
weighted, by community background -> Remain rate for Catholic / Protestant / None.
Poststratify those onto each constituency's census religion composition -> an
INDEPENDENT (survey-anchored) Remain-by-constituency estimate, to compare/blend with
the census-only fit."""
import pyreadstat, numpy as np, pandas as pd, os, re
RAW="/home/user/civgraph/data/surveys/nilt/raw"
df,meta=pyreadstat.read_sav(f"{RAW}/2016_nilt16w1.sav",encoding='latin1')
cols={c.lower():c for c in meta.column_names}
bv=cols.get('brexvote'); rc=cols.get('religcat'); wt=cols.get('wtfactor')
lab=meta.variable_value_labels.get(bv,{})
print("brexvote labels:",lab)
rlab=meta.variable_value_labels.get(rc,{})
w=df[wt].fillna(0).values if wt else np.ones(len(df))
x=df[bv].values; r=df[rc].values
rem=[k for k,v in lab.items() if re.search(r'remain|stay',str(v),re.I)]
lev=[k for k,v in lab.items() if re.search(r'leave|withdraw',str(v),re.I)]
def grp(code):
    v=str(rlab.get(code,'')).lower()
    if 'catholic' in v: return 'C'
    if 'protestant' in v: return 'P'
    if 'no religion' in v or 'none' in v: return 'N'
    return None
rate={}
for g in ('C','P','N'):
    sel=np.array([grp(rr)==g for rr in r])
    isr=sel&np.isin(x,rem); isl=sel&np.isin(x,lev)
    d=w[isr].sum()+w[isl].sum()
    rate[g]=100*w[isr].sum()/d if d>0 else np.nan
print("NILT 2016 Remain%% by community background:",{k:round(v,1) for k,v in rate.items()})
# poststratify onto census religion composition per constituency
feat=pd.read_csv("/home/user/civgraph/analysis/border-poll-dry-run/v9/constituency_features.csv").set_index('con')
PROT=['natid__']  # placeholder not used
cath=feat['rel__Catholic']; prot=feat[[c for c in feat.columns if c.startswith('rel__Protestant')]].sum(axis=1)
none=feat[[c for c in feat.columns if c.startswith('rel__Other') or c=='rel__None']].sum(axis=1)
comp=pd.DataFrame({'C':cath,'P':prot,'N':none}); comp=comp.div(comp.sum(axis=1),axis=0)
pred=comp['C']*rate['C']+comp['P']*rate['P']+comp['N']*rate['N']
out=pd.DataFrame({'nilt_brexvote_remain_pred':pred.round(1)})
out.index.name='con'; out.to_csv(f"{os.path.dirname(__file__)}/nilt_brexvote_pred.csv")
print("wrote nilt_brexvote_pred.csv (survey-poststratified Remain by constituency)")
