#!/usr/bin/env python3
"""The minimum winning coalition for Irish unity: the 50%+1 most-pro-unity people.

Rank every NILT-2019 respondent on a UNITY-PROXIMITY axis = direction tier (Yes > Don't-know >
No) then continuous SOFTNESS within tier (soft = closest to flipping toward unity). Walk down
from the top accumulating weighted population until 50%+1. Split that coalition into:
  Part A = the pro-unity core (would already vote Yes)
  Part B = the recruited margin (don't-know / pro-UK, softest first)
and profile each by community, age, national identity, class, urban/rural, party. Geography by
poststratifying per-community inclusion rates onto the 2021 census DZ/constituency composition.

Level note: NILT-2019 is the only wave carrying the hardness battery; its raw Yes base is well
below today's ~45% topline, so we report BOTH (i) the honest 2019-base split and (ii) the
today-~45%-base split (same ordering, shallower recruit depth)."""
import pyreadstat, numpy as np, pandas as pd, json
V="analysis/border-poll-dry-run/v9"
df,m=pyreadstat.read_sav('data/surveys/nilt/raw/2019_nilt19w1.sav',encoding='latin1')
c={x.lower():x for x in m.column_names}; L=lambda v:m.variable_value_labels.get(c[v],{})
w=df[c['wtfactor']].fillna(0).values

def code(var,mapping,default=np.nan):
    lab=L(var); x=df[c[var]].values; out=np.full(len(x),default,float)
    for i,v in enumerate(x):
        s=str(lab.get(v,'')).lower()
        for key,val in mapping.items():
            if key in s: out[i]=val; break
    return out
def lab_of(var):
    lab=L(var); x=df[c[var]].values
    return np.array([str(lab.get(v,'NA')) for v in x])

# ---- continuous softness (1 - hardness), same composite as hardness_continuous.py ----
strength=code('uninatst',{'very strong':1,'fairly strong':.66,'not very':.33,'neither':0,'none':0})
acc_ui =code('future1',{'impossible':1,'could live':.5,'happily':0})
acc_uk =code('future2',{'impossible':1,'could live':.5,'happily':0})
def battery():
    items=[i for i in ['uihcare','uieu','uiecon'] if i in c]; S=[]
    for it in items:
        lab=L(it); x=df[c[it]].values
        S.append(np.array([1.0 if 'no difference' in str(lab.get(v,'')).lower()
                           else (0.0 if ('encourage' in str(lab.get(v,'')).lower() or 'discourage' in str(lab.get(v,'')).lower()) else np.nan) for v in x]))
    return np.nanmean(np.vstack(S),axis=0)
resist=battery()
brexit=code('unirfav',{'no difference':1,'more in favour':0,'less in favour':0})
ref=df[c['refunify']].values; refL=L('refunify')
direction=np.array(['Y' if str(refL.get(v,'')).lower().startswith('yes')
                    else 'N' if str(refL.get(v,'')).lower().startswith('no')
                    else 'U' if v==8 else 'X' for v in ref])   # U = don't-know; X = won't/can't vote -> excluded
accept=np.where(direction=='Y',acc_uk,np.where(direction=='N',acc_ui,np.nan))
W={'strength':.35,'accept':.35,'resist':.20,'brexit':.10}
comp=np.vstack([strength,accept,resist,brexit]); wt=np.array(list(W.values()))[:,None]
mask=~np.isnan(comp)
hard=np.nansum(np.where(mask,comp*wt,0),0)/np.where(mask.any(0),np.nansum(np.where(mask,wt,0),0),np.nan)
soft=1-hard
# a soft respondent with no items answered -> impute median softness so they still rank sensibly
soft=np.where(np.isnan(soft),np.nanmedian(soft),soft)

# ---- universe: those who would vote / are undecided (Yes, No, Don't-know) ----
uni=np.isin(direction,['Y','N','U']) & (w>0)
excl_share=100*w[~uni & (w>0)].sum()/w[w>0].sum()

# ---- unity-proximity ranking: tier (Y=2,U=1,N=0) then softness within ----
tier=np.where(direction=='Y',2,np.where(direction=='U',1,0)).astype(float)
key=tier+soft            # strict tiers (soft in [0,1]); Yes above DK above No, soft-first within
order=np.argsort(-key)
o=order[uni[order]]      # ranked indices, valid universe only
ww=w[o]; dd=direction[o]; ss=soft[o]
cum=np.cumsum(ww)/ww.sum()          # cumulative population fraction from the top

yes_base=100*w[uni&(direction=='Y')].sum()/w[uni].sum()
print(f"NILT-2019 valid universe (Yes/No/DK). Excluded (won't/can't vote): {excl_share:.1f}% of all.")
print(f"  raw shares in universe:  Yes {yes_base:.1f}%  DK {100*w[uni&(direction=='U')].sum()/w[uni].sum():.1f}%  No {100*w[uni&(direction=='N')].sum()/w[uni].sum():.1f}%\n")

def profile(idx_mask, name):
    """weighted demographic composition of a boolean mask over the ranked arrays o."""
    W=ww[idx_mask]; tot=W.sum()
    if tot<=0: print(f"  [{name}: empty]"); return {}
    oi=o[idx_mask]
    out={'_n':int(idx_mask.sum()),'_popshare':100*tot/w[uni].sum()}
    for var,short in [('religcat','community'),('ragecat','age'),('uninatid','identity'),
                      ('highqual2','education'),('urbrur','urb'),('polpart2','party')]:
        lb=lab_of(var)[oi]; s=pd.Series(W).groupby(lb).sum(); s=100*s/s.sum()
        out[short]={k:round(v,1) for k,v in s.sort_values(ascending=False).items() if v>=3 and 'refus' not in k.lower() and 'no answer' not in k.lower() and 'not answ' not in k.lower()}
    # direction mix
    dm=pd.Series(W).groupby(dd[idx_mask]).sum(); dm=100*dm/dm.sum()
    out['direction']={k:round(v,1) for k,v in dm.items()}
    out['mean_softness']=round(float(np.average(ss[idx_mask],weights=W)),3)
    return out

# ---- COALITION at today's ~45% base (headline) ----
BASE=45.0
inA = cum<=BASE/100                       # Part A: pro-unity bloc (today) = softest-first top 45%
inB = (cum>BASE/100)&(cum<=0.50+1e-9)      # Part B: recruited margin, 45 -> 50%+1
inCo= cum<=0.50+1e-9                        # whole coalition
partA=profile(inA,"A: pro-unity core (top 45%)")
partB=profile(inB,"B: recruited margin (45->50%+1)")
coal =profile(inCo,"coalition 50%+1")

# ---- ALSO the honest 2019-base split (Part A' = actually-Yes; Part B' = DK/No inside 50%+1) ----
inYes = inCo & (dd=='Y'); inRecruit = inCo & (dd!='Y')
A2=profile(inYes,"A' actually-Yes in coalition"); B2=profile(inRecruit,"B' DK/No recruited in coalition")

def show(name,p):
    print(f"### {name}   (n={p['_n']}, {p['_popshare']:.1f}% of population, mean softness {p['mean_softness']})")
    print(f"    direction mix: {p['direction']}")
    for k in ['community','age','identity','education','urb','party']:
        print(f"    {k:10s}: {p[k]}")
    print()

print("="*78)
print("HEADLINE — coalition built to today's ~45% pro-unity base")
print("="*78)
show("COALITION 50%+1",coal)
show("PART A  pro-unity bloc (the ~45%)",partA)
show("PART B  recruited margin (the ~5pp of softest don't-know/pro-UK)",partB)
print("="*78)
print("PROVENANCE — same coalition split by ACTUAL 2019 vote (honest base)")
print("="*78)
show("A' already-Yes",A2); show("B' recruited (DK/No)",B2)

# ---- GEOGRAPHY: per-community inclusion rates -> poststratify onto census ----
relcode=code('religcat',{'catholic':0,'protestant':1,'no relig':2,'none':2})
grp={0:'C',1:'P',2:'N'}
# recompute inclusion at the individual level keyed back to df rows
inCo_full=np.zeros(len(df),bool); inCo_full[o[inCo]]=True
inB_full =np.zeros(len(df),bool); inB_full[o[inB]]=True
rates={}
for k,g in grp.items():
    sel=uni&(relcode==k)
    if w[sel].sum()<=0: continue
    rates[g]={'coal':100*w[sel&inCo_full].sum()/w[sel].sum(),
              'recruit':100*w[sel&inB_full].sum()/w[sel].sum()}
print("Per-community rates (share of that community inside the coalition / inside the recruited margin):")
for g in ['C','P','N']:
    if g in rates: print(f"  {g}: in-coalition {rates[g]['coal']:.0f}%   recruited-margin {rates[g]['recruit']:.1f}%")

# poststratify onto constituency composition
cf=pd.read_csv(f"{V}/constituency_features.csv"); cf['con']=cf['con'].str.upper(); cf=cf.set_index('con')
comp2=pd.DataFrame({'C':cf['rel__Catholic'],
                    'P':cf[[x for x in cf if x.startswith('rel__Protestant')]].sum(axis=1),
                    'N':cf[[x for x in cf if x.startswith('rel__Other') or x=='rel__None']].sum(axis=1)})
comp2=comp2.div(comp2.sum(axis=1),axis=0)
rC=rates.get('C',{}).get('coal',0);rP=rates.get('P',{}).get('coal',0);rN=rates.get('N',{}).get('coal',0)
rcC=rates.get('C',{}).get('recruit',0);rcP=rates.get('P',{}).get('recruit',0);rcN=rates.get('N',{}).get('recruit',0)
geo=pd.DataFrame({
  'coal_rate':(comp2['C']*rC+comp2['P']*rP+comp2['N']*rN),          # % of the seat inside the coalition
  'recruit_rate':(comp2['C']*rcC+comp2['P']*rcP+comp2['N']*rcN),    # % of the seat that is recruited-margin
  'cath_bg':(100*comp2['C']).round(0)})
geo['recruit_share_of_coal']=(100*geo['recruit_rate']/geo['coal_rate']).round(1)  # how much of the local coalition is 'borrowed'
geo=geo.round(1).sort_values('coal_rate',ascending=False)
geo.to_csv(f"{V}/augment/coalition_geography_constituency.csv")
print("\nGEOGRAPHY (poststratified to constituency):")
print("  where the COALITION is densest (highest % of residents inside 50%+1):")
print(geo[['cath_bg','coal_rate','recruit_rate','recruit_share_of_coal']].head(6).to_string())
print("  where the RECRUITED MARGIN matters most (highest recruits as share of local coalition = least secure):")
print(geo.sort_values('recruit_share_of_coal',ascending=False)[['cath_bg','coal_rate','recruit_rate','recruit_share_of_coal']].head(6).to_string())

json.dump({'yes_base_2019':round(yes_base,1),'partA':partA,'partB':partB,'coalition':coal,
           'A_yes':A2,'B_recruited':B2,'community_rates':rates},
          open(f"{V}/augment/coalition_50plus1.json","w"),indent=1,default=str)
print("\nwrote coalition_50plus1.json, coalition_geography_constituency.csv")
