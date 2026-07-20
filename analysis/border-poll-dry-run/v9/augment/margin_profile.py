#!/usr/bin/env python3
"""Deep profile of the PIVOTAL MARGIN (the soft pro-UK ~5%+1 that turns 45% -> 50%+1 for unity).
Part 1: full NILT-2019 attribute vector (margin vs core vs whole electorate).
Part 2: top-20 Data Zones where the margin is most prevalent, ranked with an IDENTITY refinement
        (census national-identity by constituency) so the ranking points at SOFT suburban unionism,
        not the hardest-Protestant rural DZs that pure religion would surface.
Census-2021 attributes attached at DZ where available (religion background, older-Protestant share,
density, household size) + constituency identity context. NIMDM and rich ward tables are NOT
cleanly joinable to 2021 DZs (no crosswalk), so deprivation is reported directionally only."""
import pyreadstat, numpy as np, pandas as pd, json, gzip, re
V="analysis/border-poll-dry-run/v9"
df,m=pyreadstat.read_sav('data/surveys/nilt/raw/2019_nilt19w1.sav',encoding='latin1')
c={x.lower():x for x in m.column_names}; L=lambda v:m.variable_value_labels.get(c[v],{})
w=df[c['wtfactor']].fillna(0).values
def code(var,mp,d=np.nan):
    lab=L(var); x=df[c[var]].values; o=np.full(len(x),d,float)
    for i,v in enumerate(x):
        s=str(lab.get(v,'')).lower()
        for k,val in mp.items():
            if k in s: o[i]=val;break
    return o
def labs(var):
    lab=L(var); x=df[c[var]].values; return np.array([str(lab.get(v,'NA')) for v in x])

# ---- softness composite + direction (same as coalition_50plus1) ----
strength=code('uninatst',{'very strong':1,'fairly strong':.66,'not very':.33,'neither':0,'none':0})
acc_ui=code('future1',{'impossible':1,'could live':.5,'happily':0}); acc_uk=code('future2',{'impossible':1,'could live':.5,'happily':0})
def battery():
    S=[]
    for it in [i for i in ['uihcare','uieu','uiecon'] if i in c]:
        lab=L(it);x=df[c[it]].values
        S.append(np.array([1.0 if 'no difference' in str(lab.get(v,'')).lower() else (0.0 if ('courage' in str(lab.get(v,'')).lower()) else np.nan) for v in x]))
    return np.nanmean(np.vstack(S),0)
resist=battery(); brexit=code('unirfav',{'no difference':1,'more in favour':0,'less in favour':0})
ref=df[c['refunify']].values; refL=L('refunify')
direction=np.array(['Y' if str(refL.get(v,'')).lower().startswith('yes') else 'N' if str(refL.get(v,'')).lower().startswith('no') else 'U' if v==8 else 'X' for v in ref])
accept=np.where(direction=='Y',acc_uk,np.where(direction=='N',acc_ui,np.nan))
wt=np.array([.35,.35,.20,.10])[:,None]; comp=np.vstack([strength,accept,resist,brexit]); mask=~np.isnan(comp)
hard=np.nansum(np.where(mask,comp*wt,0),0)/np.where(mask.any(0),np.nansum(np.where(mask,wt,0),0),np.nan)
soft=1-hard; soft=np.where(np.isnan(soft),np.nanmedian(soft),soft)
uni=np.isin(direction,['Y','N','U'])&(w>0)
tier=np.where(direction=='Y',2,np.where(direction=='U',1,0)).astype(float); key=tier+soft
o=np.argsort(-key); o=o[uni[o]]; cum=np.cumsum(w[o])/w[o].sum()
inCo=np.zeros(len(df),bool); inCo[o[cum<=0.5+1e-9]]=True
inA =np.zeros(len(df),bool); inA[o[cum<=0.45]]=True                    # pro-unity core (top 45%)
inB =inCo&~inA                                                         # recruited margin (45->50)

# ================= PART 1: NILT attribute vector =================
VARS=[('religcat','Community background'),('ragecat','Age'),('rsex','Sex'),
      ('uninatid','National identity'),('uninatst','Identity strength'),
      ('highqual2','Highest qualification'),('nssecresp08','Social class (NS-SeC)'),
      ('hhldinc3','Household income band'),('urbrur','Urban / rural'),('placeliv','Type of area'),
      ('polpart2','Party identification')]
def dist(mask,var):
    sel=mask&uni; W=w[sel]; lb=labs(var)[sel]
    s=pd.Series(W).groupby(lb).sum(); s=100*s/s.sum()
    s=s[[i for i in s.index if not any(b in i.lower() for b in ['refus','no answer','not answ','skip','na'])]]
    return {k:round(v,1) for k,v in s.sort_values(ascending=False).head(6).items()}
print("="*82); print("PART 1 — the MARGIN's attribute profile (NILT-2019), vs pro-unity core & electorate")
print("="*82)
for var,lab in VARS:
    if var not in c: continue
    print(f"\n### {lab}  [{var}]")
    print(f"   MARGIN : {dist(inB,var)}")
    print(f"   core   : {dist(inA,var)}")
    print(f"   all    : {dist(uni,var)}")
# attitude items — show the margin is the soft/movable pro-UK
print("\n### Constitutional 'hardness' items (margin should read SOFT/movable):")
print(f"   margin mean softness {np.average(soft[inB&uni],weights=w[inB&uni]):.2f}  vs core {np.average(soft[inA&uni],weights=w[inA&uni]):.2f}  vs electorate {np.average(soft[uni],weights=w[uni]):.2f}")
for it,nm in [('future1','accept a united Ireland'),('unirfav','Brexit moved constitutional view')]:
    if it in c: print(f"   {nm:34s}: margin {dist(inB,it)}")

# ================= PART 2: top-20 Data Zones, identity-refined =================
# per-community margin rate (share of that community that is pivotal margin), from NILT
rel=code('religcat',{'catholic':0,'protestant':1,'no relig':2,'none':2}); grp={0:'C',1:'P',2:'N'}
mrate={}
for k,g in grp.items():
    sel=uni&(rel==k)
    if w[sel].sum()>0: mrate[g]=100*w[sel&inB].sum()/w[sel].sum()
print("\n"+"="*82); print("PART 2 — top-20 Data Zones by margin prevalence (identity-refined)")
print("="*82)
print(f"per-community margin rate (NILT): C {mrate.get('C',0):.1f}%  P {mrate.get('P',0):.1f}%  N {mrate.get('N',0):.1f}%")

# per-DZ religion-background shares + older-Protestant share from the DZ religion x age x sex table
def relgrp(s):
    s=str(s).lower()
    if 'catholic' in s: return 'C'
    if any(x in s for x in['presby','ireland','methodist','christian','protestant','brethren','baptist','pentecost','elim','free']): return 'P'
    if 'no relig' in s or s=='none' or 'not stated' in s: return 'N'
    return 'O'
rows=[]
with gzip.open('data/census/derived/dz21-religion-age-sex-2021.csv.gz','rt') as f:
    hdr=f.readline().rstrip('\n').split(',')
    ci={h:i for i,h in enumerate(hdr)}
    dzc=ci['Census 2021 Data Zone Code']; agc=ci['Age - 19 Categories Label']; rgc=ci['Religion or Religion Brought Up In Label']; cnt=ci['Count']
    for line in f:
        p=line.rstrip('\n').split(',')
        if len(p)<=cnt: continue
        try: n=float(p[cnt] or 0)
        except: n=0
        rows.append((p[dzc],relgrp(p[rgc]),1 if re.search(r'6[5-9]|7[0-9]|8[0-9]|9[0-9]|\b65|75|85|and over|100',p[agc]) else 0,n))
rz=pd.DataFrame(rows,columns=['DZ21','rg','old','n'])
tot=rz.groupby('DZ21')['n'].sum().rename('pop')
byrg=rz.pivot_table(index='DZ21',columns='rg',values='n',aggfunc='sum',fill_value=0)
oldP=rz[(rz.rg=='P')&(rz.old==1)].groupby('DZ21')['n'].sum().rename('oldP')
dz=byrg.join(tot).join(oldP).fillna(0)
for gcol in ['C','P','N','O']:
    if gcol not in dz: dz[gcol]=0.0
dz['Cs']=dz['C']/dz['pop']; dz['Ps']=dz['P']/dz['pop']; dz['Ns']=(dz['N']+dz['O'])/dz['pop']
dz['oldP_share']=(100*dz['oldP']/dz['pop']).round(1)
dz['prot_bg_pct']=(100*dz['Ps']).round(1); dz['cath_bg_pct']=(100*dz['Cs']).round(1)

# constituency soft-identity share (census national identity) -> Protestant softness multiplier
dzcon=json.load(open(f"{V}/dz_constituency.json"))
cf=pd.read_csv(f"{V}/constituency_features.csv"); cf['con']=cf['con'].str.upper()
nat=cf[[x for x in cf.columns if x.startswith('natid__')]].copy(); nat.index=cf['con']
natt=nat.sum(axis=1)
soft_id=nat[[x for x in nat.columns if ('Northern Irish only' in x) or (' and ' in x)]].sum(axis=1)/natt   # NI-only + all mixed = non-exclusive middle
softmult=(soft_id/soft_id.mean()).clip(0.3,2.2)
dz['con']=pd.Series(dzcon); dz=dz[dz['con'].notna()]
dz['softmult']=dz['con'].map(softmult).fillna(1.0)
dz['soft_id_pct']=(100*dz['con'].map(soft_id)).round(1)
dens=pd.read_csv('data/census/derived/ms-a14-dz.csv'); dens=dens.set_index('GeographyCode')['PopulationDensity']
dz['density']=dz.index.map(dens)
# margin prevalence: Catholic/None flat; Protestant scaled by area identity-softness
dz['recruit_naive']=(dz['Cs']*mrate.get('C',0)+dz['Ps']*mrate.get('P',0)+dz['Ns']*mrate.get('N',0))
dz['recruit_refined']=(dz['Cs']*mrate.get('C',0)+dz['Ps']*mrate.get('P',0)*dz['softmult']+dz['Ns']*mrate.get('N',0))
dz=dz[dz['pop']>=50]
top=dz.sort_values('recruit_refined',ascending=False).head(20)
out=top.reset_index()[['DZ21','con','pop','cath_bg_pct','prot_bg_pct','oldP_share','soft_id_pct','density','recruit_naive','recruit_refined']].round(2)
out.to_csv(f"{V}/augment/margin_top20_datazones.csv",index=False)
pd.options.display.width=200; pd.options.display.max_columns=20
print("\nTop-20 DZs (identity-refined) — where the pivotal soft-pro-UK margin is most prevalent:")
print(out.to_string(index=False))
print("\nconstituencies represented in the top-20:", out['con'].value_counts().to_dict())
# how much the identity refinement moves things vs naive religion-only
naive_top=set(dz.sort_values('recruit_naive',ascending=False).head(20).index)
print(f"overlap of identity-refined top-20 with naive religion-only top-20: {len(naive_top & set(top.index))}/20")
json.dump({'margin_community_rate':mrate,'top20':out.to_dict('records')},open(f"{V}/augment/margin_profile.json","w"),indent=1,default=str)
print("\nwrote margin_top20_datazones.csv, margin_profile.json")
