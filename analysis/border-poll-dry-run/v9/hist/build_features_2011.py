#!/usr/bin/env python3
"""Tier-2/3 census features: 2011 Census at the 18 Assembly/Westminster
constituencies (ASSEMBLY AREAS geography, codes N06000001-18). Takes the
percentage columns of the politically-relevant KS tables. Real NISRA data —
the era-appropriate census for the 1998-2010 (Tier 2) contests, and used as the
gradient-stability probe for the 1990s (Tier 3)."""
import pandas as pd, glob, os, csv
B="/home/user/civgraph/data/census/2011"
ADMIN=f"{B}/census-2011-key-statistics-tables-administrative-geographies (1)/ASSEMBLY AREAS"
TABLES={'KS102NI':'age','KS202NI':'natid','KS206NI':'passport','KS207NI':'lang',
        'KS211NI':'rel','KS212NI':'relbup','KS301NI':'health','KS401NI':'tenure',
        'KS501NI':'qual','KS601NI':'econ','KS611NI':'nssec','KS101NI':'sex'}
lut=dict((r['CODE'],r['NAME']) for r in csv.DictReader(open(
  f"{B}/census-2011-key-statistics-tables-statistical-geographies/All_Geographies_Code_Files/Assembly_Areas_(AA).csv")))
def desc_for(tbl):
    f=glob.glob(f"{B}/**/{tbl}DESC0.CSV",recursive=True)
    d=pd.read_csv(f[0])
    return d
cols_out={}
feat=pd.DataFrame(index=list(lut.keys()))
for tbl,pfx in TABLES.items():
    data=pd.read_csv(f"{ADMIN}/{tbl}DATA0.CSV").set_index('GeographyCode')
    d=desc_for(tbl)
    pct=d[d.ColumnVariableMeasurementUnit.str.lower().str.contains('percent')]
    for _,r in pct.iterrows():
        code=r['ColumnVariableCode']; desc=r['ColumnVariableDescription']
        if code in data.columns:
            name=f"{pfx}__{desc.split(':',1)[-1].strip()[:40]}"
            feat[name]=data[code].reindex(feat.index)
feat.index=[lut[c] for c in feat.index]
feat.index.name='con'
feat=feat.dropna(axis=1,how='all')
feat.to_csv(f"{os.path.dirname(__file__)}/features_2011_constituency.csv")
print("2011 constituency features:",feat.shape,"(18 constituencies x %d %%-features)"%feat.shape[1])
print("sample cols:",list(feat.columns[:8]))
print("Catholic religion range: %.1f - %.1f"%(feat[[c for c in feat if c.startswith('rel__Catholic')][0]].min(),
                                               feat[[c for c in feat if c.startswith('rel__Catholic')][0]].max()))
