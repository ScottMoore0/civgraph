#!/usr/bin/env python3
"""Feasibility demo: segment unity voting intention by HARDNESS, not just direction.
Combines REFUNIFY (direction) x UNINATID (identity direction) x UNINATST (identity
strength) into a 5-band persuadability typology. NILT also carries FUTURE1/FUTURE2
(would you ACCEPT the other outcome), the Brexit-movability items (UNIRLIKL/UNIRFAV)
and a persuasion battery (UIHCARE/UIABORTN/UIEU/UIECON) -- further hardness signals."""
import pyreadstat, numpy as np
from collections import defaultdict
df,m=pyreadstat.read_sav('data/surveys/nilt/raw/2019_nilt19w1.sav',encoding='latin1')
c={x.lower():x for x in m.column_names}; L=lambda v:m.variable_value_labels.get(c[v],{})
w=df[c['wtfactor']].fillna(0).values; tot=w.sum()
ref,st,idn=df[c['refunify']].values,df[c['uninatst']].values,df[c['uninatid']].values
rL,sL,iL=L('refunify'),L('uninatst'),L('uninatid')
def band(r,s,d):
    rl,sl,dl=str(rL.get(r,'')).lower(),str(sL.get(s,'')).lower(),str(iL.get(d,'')).lower()
    strong=('very strong' in sl) or ('fairly strong' in sl)
    if rl.startswith('yes'): return 'HARD unity' if ('national' in dl and strong) else 'SOFT unity'
    if rl.startswith('no'):  return 'HARD union' if ('unionist' in dl and strong) else 'SOFT union'
    return 'UNDECIDED'
b=defaultdict(float)
for i in range(len(df)): b[band(ref[i],st[i],idn[i])]+=w[i]
for k in ['HARD union','SOFT union','UNDECIDED','SOFT unity','HARD unity']:
    print(f'{k:12s} {100*b[k]/tot:5.1f}%')
print(f'HARD {100*(b["HARD unity"]+b["HARD union"])/tot:.0f}%  PERSUADABLE {100*(b["SOFT unity"]+b["SOFT union"]+b["UNDECIDED"])/tot:.0f}%')
