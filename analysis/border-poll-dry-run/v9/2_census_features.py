#!/usr/bin/env python3
"""v9 phase 2 — census feature matrices at DEA14 (train) and DZ21 (project).
Fetch high-value FTB univariate tables from R2, build per-area category shares.
"""
import io,gzip,subprocess,csv,os
BASE="https://data.civgraph.net/data/census/nisra-ftb"
ATTRS=['RELIGION_BELONG_TO_OR_BROUGHT_UP_IN_DVO','NAT_ID_BASIC','PASSPORTS_HELD_BASIC',
 'IRISH_SKILLS_INTERMEDIATE','HH_TENURE_AGG8_PERS','NSSEC_FLAT_AGG10','HIGHEST_QUALIFICATION',
 'ECONOMIC_ACTIVITY_AGG9','AGE_BAND_AGG7_A','UR_SEX','HEALTH_IN_GENERAL','COB_BASIC']
SHORT={'RELIGION_BELONG_TO_OR_BROUGHT_UP_IN_DVO':'rel','NAT_ID_BASIC':'natid','PASSPORTS_HELD_BASIC':'pass',
 'IRISH_SKILLS_INTERMEDIATE':'irish','HH_TENURE_AGG8_PERS':'ten','NSSEC_FLAT_AGG10':'nssec',
 'HIGHEST_QUALIFICATION':'qual','ECONOMIC_ACTIVITY_AGG9':'econ','AGE_BAND_AGG7_A':'age','UR_SEX':'sex',
 'HEALTH_IN_GENERAL':'hlth','COB_BASIC':'cob'}
def fetch(geo,var):
    raw=subprocess.run(["curl","-fsSL",f"{BASE}/PEOPLE__{geo}~{var}.csv.gz"],capture_output=True).stdout
    return list(csv.reader(io.StringIO(gzip.decompress(raw).decode('utf-8'))))
def build(geo,key_col):
    # per area: {feature_col: share}
    area_tot={}; feat={}  # feat[area][col]=count
    cols=[]
    for var in ATTRS:
        rows=fetch(geo,var); hdr=rows[0]
        # columns: <geo> Code,<geo> Label, <var> Code,<var> Label, Count  (may have extra)
        # find count col (last), area code (col 0), category label (2nd-last before count or the label col)
        ci_count=len(hdr)-1
        ci_area=key_col; ci_catlabel=len(hdr)-2
        for r in rows[1:]:
            if len(r)<=ci_count: continue
            area=r[ci_area]; cat=r[ci_catlabel].strip()
            try: n=float(r[ci_count] or 0)
            except: continue
            col=f"{SHORT[var]}__{cat}"[:60]
            feat.setdefault(area,{}).setdefault(col,0.0); feat[area][col]+=n
            if col not in cols: cols.append(col)
    # normalise each attribute-block to share within area (each var's cats sum to area pop)
    # simpler: normalise each column by the area's total for THAT var's block
    varblocks={}
    for c in cols:
        varblocks.setdefault(c.split('__')[0],[]).append(c)
    out={}
    for area,d in feat.items():
        row={}
        for vb,ccols in varblocks.items():
            tot=sum(d.get(c,0) for c in ccols)
            for c in ccols: row[c]=round(100*d.get(c,0)/tot,3) if tot>0 else 0.0
        out[area]=row
    return out,cols
for geo,fn,kc in [('DEA14','dea_features.csv',1),('DZ21','dz_features.csv',0)]:
    out,cols=build(geo,kc)
    with open(fn,'w',newline='') as fh:
        w=csv.writer(fh); w.writerow(['area']+cols)
        for area,row in sorted(out.items()): w.writerow([area]+[row.get(c,0.0) for c in cols])
    print(f"{geo}: {len(out)} areas, {len(cols)} feature columns -> {fn}")
