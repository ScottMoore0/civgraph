#!/usr/bin/env python3
"""Fold the (guard-validated) party-composition signal into the unity projection.

Census religion gives a unity geography that treats every non-Catholic identically.
Party composition adds the MIDDLE GROUND: NILT says Alliance supporters are ~44% pro-unity
and 'no party' ~31% -- movable, and invisible to census religion. We build a party-implied
unity per constituency and blend it with the census-religion one as SHAPES (deviations from
the NI mean), re-centred to the survey NI level, then push the per-constituency correction
down to Data Zones. Damping w is capped so the enrichment can only refine, not dominate."""
import pyreadstat, numpy as np, pandas as pd, os, json
RAW="/home/user/civgraph/data/surveys/nilt/raw"; V="/home/user/civgraph/analysis/border-poll-dry-run/v9"
byparty=json.load(open(f"{V}/augment/unity_by_party.json"))
# unity by religion (Cath/Prot/None), pooled REFUNIFY 2020-2024, weighted
agg={}; niY=niD=0.0
for w in ['2020_nilt20w1','2021_nilt21w1','2022_nilt22w1','2023_nilt23w1','2024_nilt24w1']:
    df,m=pyreadstat.read_sav(f"{RAW}/{w}.sav",encoding='latin1'); cols={c.lower():c for c in m.column_names}
    rv=cols.get('refunify'); rc=cols.get('religcat'); wt=cols.get('wtfactor')
    if not rv or not rc: continue
    rlab=m.variable_value_labels.get(rv,{}); clab=m.variable_value_labels.get(rc,{})
    yes=[k for k,v in rlab.items() if 'yes' in str(v).lower()]; no=[k for k,v in rlab.items() if str(v).lower().startswith('no')]
    W=df[wt].fillna(0).values
    for i in range(len(df)):
        cl=str(clab.get(df[rc].values[i],'')).lower()
        g='C' if 'catholic' in cl else 'P' if 'protestant' in cl else 'N' if ('no relig' in cl or 'none' in cl) else None
        r=df[rv].values[i]
        if r in yes: niY+=W[i]; niD+=W[i]
        elif r in no: niD+=W[i]
        if g is None: continue
        a=agg.setdefault(g,{'y':0.,'d':0.})
        if r in yes: a['y']+=W[i]; a['d']+=W[i]
        elif r in no: a['d']+=W[i]
relrate={g:100*a['y']/a['d'] for g,a in agg.items()}
NIlevel=100*niY/niD
print(f"NILT unity-by-religion: Cath {relrate['C']:.1f}  Prot {relrate['P']:.1f}  None {relrate['N']:.1f}   | NI Yes-of-decided {NIlevel:.1f}%")

# constituency religion + party composition
cf=pd.read_csv(f"{V}/constituency_features.csv"); cf['con']=cf['con'].str.upper(); cf=cf.set_index('con')
comp=pd.DataFrame({'C':cf['rel__Catholic'],
   'P':cf[[c for c in cf if c.startswith('rel__Protestant')]].sum(axis=1),
   'N':cf[[c for c in cf if c.startswith('rel__Other') or c=='rel__None']].sum(axis=1)})
comp=comp.div(comp.sum(axis=1),axis=0)
census_u=comp['C']*relrate['C']+comp['P']*relrate['P']+comp['N']*relrate['N']
# party composition from most recent election (2022 Assembly)
import json as J
from collections import defaultdict
j=J.load(open(f"{V.replace('/analysis/border-poll-dry-run/v9','')}/render/metadata/elections-test2/northern-ireland-assembly__2022-05-05.json"))
pv=defaultdict(lambda:defaultdict(float))
def pcat(p):
    d={'DUP':'DUP','UUP':'UUP','Sinn Féin':'SF','SDLP':'SDLP','Alliance':'Alliance','Green':'Green','TUV':'TUV'}
    return d.get(p,'None/Other')
for c in j['mainLikeCandidateSummary']: pv[c['constituency'].upper()][pcat(c['party'])]+=float(c.get('firstPrefs') or 0)
prate={'DUP':byparty['DUP'],'UUP':byparty['UUP'],'TUV':byparty.get('TUV',byparty['DUP']),'SF':byparty['SF'],
       'SDLP':byparty['SDLP'],'Alliance':byparty['Alliance'],'Green':byparty['Green'],'None/Other':byparty['None/Other']}
party_u={}
for con,d in pv.items():
    t=sum(d.values()); party_u[con]=sum(d[p]/t*prate[p] for p in d)
party_u=pd.Series(party_u).reindex(cf.index)
# blend as shapes, re-centre to survey NI level; damping w capped at 0.5
w=0.5
cs=census_u-census_u.mean(); ps=party_u-party_u.mean()
enriched_shape=cs+w*(ps-cs)
enriched=enriched_shape - enriched_shape.mean() + NIlevel
census_proj=cs - cs.mean() + NIlevel
out=pd.DataFrame({'catholic_pct':cf['rel__Catholic'].round(1),'census_unity':census_proj.round(1),
   'party_unity':(ps-ps.mean()+NIlevel).round(1),'enriched_unity':enriched.round(1),
   'correction':(enriched-census_proj).round(1)}).sort_values('correction')
out.to_csv(f"{V}/augment/unity_enriched_constituency.csv")
print("\nMiddle-ground movers (largest party-composition corrections vs census-religion):")
mv=out.reindex(out.correction.abs().sort_values(ascending=False).index).head(6)
print(mv.to_string())
print(f"\nNI level held at survey {NIlevel:.1f}% (mean enriched {enriched.mean():.1f}). Damping w={w}.")
