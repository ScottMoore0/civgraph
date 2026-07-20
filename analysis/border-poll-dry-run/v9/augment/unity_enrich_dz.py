#!/usr/bin/env python3
"""Push the constituency-level party-composition correction down to Data Zones and write
the enriched DZ unity projection. Each DZ keeps its census-based value and receives its
constituency's correction (party composition is only observed at constituency level), then
the whole surface is re-centred to the survey NI level so the topline is unchanged."""
import json, pandas as pd, numpy as np, os
V="/home/user/civgraph/analysis/border-poll-dry-run/v9"
corr=pd.read_csv(f"{V}/augment/unity_enriched_constituency.csv",index_col=0)['correction']
dz2con=json.load(open(f"{V}/dz_constituency.json"))
DATE="2025-02"
dz=pd.read_csv(f"{V}/areas_output/{DATE}_DZ21.csv")
dz['con']=dz['DZ21'].map(dz2con)
dz['corr']=dz['con'].map(corr).fillna(0)
pop=pd.read_csv("/home/user/civgraph/data/census/derived/ms-a01-dz.csv").set_index('GeographyCode')['AllUsualResidents']
dz['pop']=dz['DZ21'].map(pop).fillna(0)
base_ni=np.average(dz['proj_unity_pct'],weights=dz['pop'])
enr=dz['proj_unity_pct']+dz['corr']
enr=enr - np.average(enr,weights=dz['pop']) + base_ni      # hold NI level
dz['enriched_unity_pct']=enr.clip(1,99).round(1)
dz['delta']=(dz['enriched_unity_pct']-dz['proj_unity_pct']).round(1)
dz[['DZ21','catholic_bg_pct','proj_unity_pct','enriched_unity_pct','delta','con']].to_csv(
    f"{V}/augment/unity_enriched_dz_{DATE}.csv",index=False)
print(f"Enriched DZ unity written ({len(dz)} Data Zones, {DATE}). NI level held at {base_ni:.1f}%.")
print("Largest upward shifts (middle-ground DZs):")
print(dz.sort_values('delta',ascending=False)[['DZ21','con','catholic_bg_pct','proj_unity_pct','enriched_unity_pct']].head(4).to_string(index=False))
print("Largest downward shifts (hardline DZs):")
print(dz.sort_values('delta')[['DZ21','con','catholic_bg_pct','proj_unity_pct','enriched_unity_pct']].head(4).to_string(index=False))
print(f"\nDZs shifted by >1pt: {(dz['delta'].abs()>1).sum()} / {len(dz)}  (max |delta| {dz['delta'].abs().max():.1f})")
