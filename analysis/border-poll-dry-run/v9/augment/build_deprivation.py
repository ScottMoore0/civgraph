#!/usr/bin/env python3
"""Aggregate NIMDM-2017 deprivation (small-area ranks) to the 18 constituencies,
population-weighted, via SA -> SOA -> AA. Orthogonal to the census religion/age
profile and a classic Brexit/turnout correlate. Transferable to the unity goal
(a future referendum still has deprivation)."""
import pandas as pd, os
B="/home/user/civgraph"
GC=f"{B}/data/census/2011/census-2011-key-statistics-tables-statistical-geographies/All_Geographies_Code_Files"
nimdm=pd.read_csv(f"{B}/data/census/derived/nimdm-2017-sa.csv")            # SA2011, MDM_rank, Income_rank, Employment_rank
hier=pd.read_csv(f"{GC}/NI_HIERARCHY.csv")[['SA','SOA']]                   # SA -> SOA
soa_aa=pd.read_csv(f"{GC}/SOA_AA_HIERARCHY.csv")                           # SOA -> AA(N06...)
lut=pd.read_csv(f"{GC}/Assembly_Areas_(AA).csv").set_index('CODE')['NAME'] # N06 -> name
pop=pd.read_csv(f"{B}/data/census/derived/census-2011-sa.csv")[['SA2011','AllUsualResidents']]
df=(nimdm.merge(hier,left_on='SA2011',right_on='SA')
        .merge(soa_aa,on='SOA').merge(pop,on='SA2011'))
df['con']=df['AA'].map(lut)
# population-weighted mean SA rank per constituency (lower rank = MORE deprived)
def wavg(g,col): return (g[col]*g['AllUsualResidents']).sum()/g['AllUsualResidents'].sum()
rows=[]
for con,g in df.groupby('con'):
    rows.append(dict(con=con,
        dep__mdm_rank=round(wavg(g,'MDM_rank'),0),
        dep__income_rank=round(wavg(g,'Income_rank'),0),
        dep__employment_rank=round(wavg(g,'Employment_rank'),0)))
out=pd.DataFrame(rows).set_index('con').sort_index()
out.to_csv(f"{os.path.dirname(__file__)}/deprivation_constituency.csv")
print("deprivation (pop-wtd mean SA rank; lower=more deprived), by constituency:")
print(out['dep__mdm_rank'].sort_values().to_string())
print("\n(3 features x 18 constituencies)")
