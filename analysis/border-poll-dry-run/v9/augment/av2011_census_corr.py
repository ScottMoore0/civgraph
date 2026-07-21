#!/usr/bin/env python3
"""2011 AV referendum vs NISRA census, done properly with the real geography:
  - TURNOUT at constituency level (n=18, real per-constituency turnout supplied) x census features.
  - YES/NO at counting-area level (n=8), with each count centre's census composition aggregated
    from its constituent constituencies, electorate-weighted (mapping supplied).
Per instruction: turnout from the constituency table, Yes/No proportions from the counting-area table.
(AV polling day was 5 May 2011 -- the SAME day as the NI Assembly election -- so turnout tracks
Assembly-election turnout, i.e. HIGHER in nationalist areas: the opposite of the 2016 EU ref.)"""
import numpy as np, pandas as pd
V="analysis/border-poll-dry-run/v9"
cf=pd.read_csv(f"{V}/constituency_features.csv"); cf['con']=cf['con'].str.upper().str.strip()
def col(frag):
    m=[x for x in cf.columns if frag.lower() in x.lower()]; return cf[m].sum(axis=1)
feat=pd.DataFrame({'con':cf['con'],
    'catholic_bg':cf['rel__Catholic'],'irish_identity':col('natid__Irish only'),
    'no_religion':cf['rel__None'],'uk_passport':col('pass__United Kingdom only'),
    'owner_occ':col('ten__Owner occupied'),'social_rent':col('ten__Social rented'),
    'higher_nssec':col('L1'),'no_quals':col('No qualification')}).set_index('con')

# per-constituency: eligible + AV turnout% (supplied)
CON=pd.DataFrame([
 ('BELFAST EAST',60508,53.9),('BELFAST NORTH',67370,50.5),('BELFAST SOUTH',61118,53.0),('BELFAST WEST',61267,57.6),
 ('EAST ANTRIM',61317,47.8),('NORTH ANTRIM',73977,55.2),('SOUTH ANTRIM',61905,48.6),('NORTH DOWN',61823,45.9),
 ('SOUTH DOWN',72694,58.2),('FERMANAGH AND SOUTH TYRONE',69492,69.8),('FOYLE',68371,57.7),('LAGAN VALLEY',68808,51.8),
 ('EAST LONDONDERRY',64752,54.1),('MID ULSTER',65816,65.6),('NEWRY AND ARMAGH',76213,61.9),('STRANGFORD',64689,49.0),
 ('WEST TYRONE',62482,64.2),('UPPER BANN',76364,55.9)],columns=['con','eligible','turnout']).set_index('con')

# ---- (1) TURNOUT vs census, constituency level (n=18) ----
t=CON.join(feat)
cvars=list(feat.columns)
print("="*66); print("AV 2011 TURNOUT vs census — constituency (n=18, real join)"); print("="*66)
for v,r in sorted([(v,np.corrcoef(t['turnout'],t[v])[0,1]) for v in cvars],key=lambda x:-abs(x[1])):
    print(f"   {v:15s} r = {r:+.2f}")
print(f"   highest turnout: {t.nlargest(3,'turnout').index.tolist()}")
print(f"   lowest  turnout: {t.nsmallest(3,'turnout').index.tolist()}")

# ---- (2) YES/NO vs census, counting-area level (n=8), census aggregated from constituencies ----
AREA={'Ballymena':['NORTH ANTRIM','MID ULSTER'],'Banbridge 1':['SOUTH DOWN','NEWRY AND ARMAGH'],
 'Banbridge 2':['UPPER BANN','LAGAN VALLEY'],'Belfast':['BELFAST SOUTH','BELFAST WEST'],
 'Londonderry':['FOYLE','EAST LONDONDERRY'],'Newtownabbey':['BELFAST NORTH','EAST ANTRIM','SOUTH ANTRIM'],
 'Newtownards':['BELFAST EAST','NORTH DOWN','STRANGFORD'],'Omagh':['FERMANAGH AND SOUTH TYRONE','WEST TYRONE']}
YES={'Ballymena':42.0,'Banbridge 1':45.8,'Banbridge 2':40.4,'Belfast':59.7,'Londonderry':50.0,
 'Newtownabbey':39.4,'Newtownards':30.6,'Omagh':46.7}
rows=[]
for area,cons in AREA.items():
    wtot=CON.loc[cons,'eligible'].sum()
    agg={v:float((feat.loc[cons,v]*CON.loc[cons,'eligible']).sum()/wtot) for v in cvars}
    rows.append({'area':area,'yes':YES[area],'electorate':int(wtot),**agg})
av=pd.DataFrame(rows)
print("\n"+"="*66); print("AV 2011 YES vs census — counting area (n=8, census aggregated real)"); print("="*66)
print(av[['area','yes','catholic_bg','irish_identity','uk_passport']].round(1).to_string(index=False))
print("\n   Yes% correlations:")
for v,r in sorted([(v,np.corrcoef(av['yes'],av[v])[0,1]) for v in cvars],key=lambda x:-abs(x[1])):
    print(f"   {v:15s} r = {r:+.2f}")
av.round(2).to_csv(f"{V}/augment/avref2011_census_corr.csv",index=False)
t.round(2).to_csv(f"{V}/augment/avref2011_turnout_census.csv")
print("\nwrote avref2011_census_corr.csv (Yes n=8), avref2011_turnout_census.csv (turnout n=18)")
