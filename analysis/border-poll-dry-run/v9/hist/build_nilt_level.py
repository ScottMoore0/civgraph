#!/usr/bin/env python3
"""Tier-2 NI-level signal from NILT: weighted % preferring reunification (of those
expressing a UK-or-reunify preference) per wave 1998-2010, the constitutional-
preference question (nireland / NIRELAND / NIRELND2). This is NILT's analog of a
'unity poll' in the era before LucidTalk existed."""
import pyreadstat, glob, os, json, numpy as np
RAW="/home/user/civgraph/data/surveys/nilt/raw"
WAVES={'1998':'1998_nilt98w2','1999':'1999_nilt99w1','2000':'2000_nilt00w1','2001':'2001_nilt01w1',
       '2003':'2003_nilt03w1','2004':'2004_nilt04w2','2005':'2005_nilt05w1','2006':'2006_nilt06w3',
       '2007':'2007_nilt07w1','2008':'2008_nilt08w1','2010':'2010_nilt10w1'}
def find_const(meta):
    for c in meta.column_names:
        if c.lower() in ('nireland','nirelnd2','nirelnd'): return c
    return None
out={}
for yr,f in WAVES.items():
    df,meta=pyreadstat.read_sav(f"{RAW}/{f}.sav",encoding='latin1')
    v=find_const(meta)
    if not v: out[yr]=None; continue
    vl=meta.variable_value_labels.get(v,{})
    reun=[k for k,lab in vl.items() if 'reunif' in lab.lower()]
    uk=[k for k,lab in vl.items() if 'united kingdom' in lab.lower() or 'remain part of the uk' in lab.lower()]
    if not reun or not uk: out[yr]=None; continue
    reun=set(reun); uk=set(uk)
    wcol=next((c for c in meta.column_names if c.lower()=='wtfactor'),None)
    w=df[wcol].fillna(0).values if wcol else np.ones(len(df))
    x=df[v].values
    is_r=np.isin(x,list(reun)); is_u=np.isin(x,list(uk))
    decided=(is_r|is_u)
    reunify_pct=100*np.sum(w[is_r])/np.sum(w[decided]) if np.sum(w[decided])>0 else None
    # also share of full sample (incl DK) choosing reunify
    reunify_all=100*np.sum(w[is_r])/np.sum(w[~np.isnan(x)&(x>=0)]) if True else None
    out[yr]=dict(var=v,reunify_of_decided=round(float(reunify_pct),1),
                 reunify_of_all=round(float(reunify_all),1),n=int(decided.sum()))
json.dump(out,open(f"{os.path.dirname(__file__)}/nilt_level.json","w"),indent=1)
print("NILT constitutional preference (reunify), weighted:")
print("year  var        reunify%(decided)  reunify%(all)   n")
for yr,d in out.items():
    if d: print(f"{yr}  {d['var']:10s}  {d['reunify_of_decided']:6.1f}          {d['reunify_of_all']:6.1f}     {d['n']}")
    else: print(f"{yr}  (no usable constitutional item)")
