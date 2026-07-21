"""Wire the NISA level anchor into the modern DZ pipeline: run NISA 1989-96 through the SAME
poststratification the 2019-2025 NILT waves use, so the pre-NILT era gets Data-Zone unity maps and
NI levels on one consistent basis.

  SHAPE  = NISA community-specific reunify rates (Catholic/Protestant/None) poststratified onto each
           DZ's religion composition (2021 census frame, as the modern pipeline uses).
  LEVEL  = NISA overall reunify + the documented +4.9pt constitutional->border-poll harmonisation
           offset (within-NILT bridge), putting NISA on the same REFUNIFY(Yes) scale as 2019-2025.
Then stitch NISA (1989-96) + NILT (2019-2025) into one continuous NI series."""
import gzip, csv, collections, numpy as np, pandas as pd
V="analysis/border-poll-dry-run/v9"; H=f"{V}/hist"
OFFSET=4.9   # constitutional-preference -> border-poll REFUNIFY (within-NILT, +4.9pt SD1.3)

# DZ religion composition from the MRP frame
comp=collections.defaultdict(lambda:collections.defaultdict(float))
with gzip.open(f"{V}/augment/mrp_frame_dz21.csv.gz","rt") as f:
    for r in csv.DictReader(f): comp[r['DZ21']][r['religion']]+=float(r['count'])
dz=pd.DataFrame([{'DZ21':k,'C':v.get('C',0),'P':v.get('P',0),'N':v.get('N',0),
                  'pop':sum(v.values())} for k,v in comp.items()])
dz=dz[dz['pop']>=50].copy()
for c in 'CPN': dz[c+'s']=dz[c]/dz['pop']

nisa=pd.read_csv(f"{H}/nisa_reunify.csv")
rows=[]; maps={}
for _,n in nisa.iterrows():
    yr=int(n['year'])
    # per-DZ poststratified reunify (community rates x DZ religion composition)
    raw=dz['Cs']*n['reunify_catholic']+dz['Ps']*n['reunify_protestant']+dz['Ns']*n['reunify_none']
    raw_ni=np.average(raw,weights=dz['pop'])
    harm_ni=n['reunify_overall']+OFFSET                      # harmonised NI level (REFUNIFY scale)
    dz_yes=(raw-raw_ni+harm_ni)                              # anchor DZ shape to harmonised NI level
    rows.append({'wave':yr,'source':'NISA','ni_reunify_raw':round(n['reunify_overall'],1),
                 'ni_yes_harmonised':round(harm_ni,1),
                 'dzs_over50':int((dz_yes>50).sum()),
                 'pop_in_majYes_pct':round(100*dz.loc[dz_yes>50,'pop'].sum()/dz['pop'].sum(),1)})
    if yr in (1989,1996):
        maps[yr]=dz.assign(yes=dz_yes.round(1))[['DZ21','yes','pop']].copy()
nisa_series=pd.DataFrame(rows)

# stitch with the modern NILT DZ series (2019-2025)
nilt=pd.read_csv(f"{V}/augment/unity_timeseries_dz.csv")[['wave','poststrat_ni_yes']]
nilt=nilt.rename(columns={'poststrat_ni_yes':'ni_yes_harmonised'}); nilt['source']='NILT'
series=pd.concat([nisa_series[['wave','source','ni_yes_harmonised']],nilt],ignore_index=True).sort_values('wave')

print("Continuous NI unity level — NISA wired through the modern DZ poststratification:")
print(nisa_series[['wave','ni_reunify_raw','ni_yes_harmonised','dzs_over50','pop_in_majYes_pct']].to_string(index=False))
print("\nStitched NI series (NISA 1989-96 + gap + NILT 2019-25), harmonised REFUNIFY scale:")
print(series.to_string(index=False))
print(f"\n  NISA-era (2021 composition): DZs>50% Yes {nisa_series['dzs_over50'].min()}-{nisa_series['dzs_over50'].max()} of {len(dz)};")
print(f"  pop in majority-Yes DZ {nisa_series['pop_in_majYes_pct'].min():.0f}-{nisa_series['pop_in_majYes_pct'].max():.0f}% (vs ~40% in 2024-25).")
for yr,m in maps.items():
    m.round(2).to_csv(f"{V}/augment/unity_yes_dz21_{yr}_nisa.csv",index=False)
nisa_series.to_csv(f"{V}/augment/nisa_dz_series.csv",index=False)
series.to_csv(f"{V}/augment/unity_ni_series_1989_2025.csv",index=False)
print("\nCAVEAT: NISA run on the 2021 frame isolates ATTITUDE (fixed modern composition); the actual")
print("1989-96 level on 1991 composition was a few points lower. Offset +4.9 carries ~+-8pt band.")
print("wrote nisa_dz_series.csv, unity_ni_series_1989_2025.csv, unity_yes_dz21_{1989,1996}_nisa.csv")
