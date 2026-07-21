#!/usr/bin/env python3
"""Widen the NILT->census bridge to the CELL level using the 2011 multivariate table
LC2201 (National Identity x Religion) at Small-Area geography. The margin's defining trait is
NATIONAL IDENTITY (soft pro-UK = Protestant who identifies 'Northern Irish', not 'British only').
NILT carries NINATID (British/Irish/Northern-Irish/Other) — the SAME question as the census — so
we can now match on religion x national-identity jointly, instead of a constituency multiplier.

Method: fit weighted logistic margin ~ religion x national-identity in NILT, poststratify onto each
Small Area's LC2201 religion x identity cell counts. Vintage/geography caveat: LC2011 is 2011 on
2011 Small Areas (identity geography is fairly stable, but this is not 2021 DZ)."""
import pyreadstat, numpy as np, pandas as pd, csv
from sklearn.linear_model import LogisticRegression
V="analysis/border-poll-dry-run/v9"
SG="data/census/2011/census-2011-local-characteristic-tables-statistical-geographies"
df,m=pyreadstat.read_sav('data/surveys/nilt/raw/2019_nilt19w1.sav',encoding='latin1')
c={x.lower():x for x in m.column_names};L=lambda v:m.variable_value_labels.get(c[v],{})
w=df[c['wtfactor']].fillna(0).values
def code(var,mp,d=np.nan):
    lab=L(var);x=df[c[var]].values;o=np.full(len(x),d,float)
    for i,v in enumerate(x):
        s=str(lab.get(v,'')).lower()
        for k,val in mp.items():
            if k in s:o[i]=val;break
    return o
# margin mask
strength=code('uninatst',{'very strong':1,'fairly strong':.66,'not very':.33,'neither':0,'none':0})
acc_ui=code('future1',{'impossible':1,'could live':.5,'happily':0});acc_uk=code('future2',{'impossible':1,'could live':.5,'happily':0})
def battery():
    S=[]
    for it in [i for i in ['uihcare','uieu','uiecon'] if i in c]:
        lab=L(it);x=df[c[it]].values
        S.append(np.array([1.0 if 'no difference' in str(lab.get(v,'')).lower() else (0.0 if 'courage' in str(lab.get(v,'')).lower() else np.nan) for v in x]))
    return np.nanmean(np.vstack(S),0)
resist=battery();brexit=code('unirfav',{'no difference':1,'more in favour':0,'less in favour':0})
ref=df[c['refunify']].values;refL=L('refunify')
dirn=np.array(['Y' if str(refL.get(v,'')).lower().startswith('yes') else 'N' if str(refL.get(v,'')).lower().startswith('no') else 'U' if v==8 else 'X' for v in ref])
accept=np.where(dirn=='Y',acc_uk,np.where(dirn=='N',acc_ui,np.nan))
wt=np.array([.35,.35,.20,.10])[:,None];comp=np.vstack([strength,accept,resist,brexit]);mk=~np.isnan(comp)
hard=np.nansum(np.where(mk,comp*wt,0),0)/np.where(mk.any(0),np.nansum(np.where(mk,wt,0),0),np.nan)
soft=1-hard;soft=np.where(np.isnan(soft),np.nanmedian(soft),soft)
uni=np.isin(dirn,['Y','N','U'])&(w>0);tier=np.where(dirn=='Y',2,np.where(dirn=='U',1,0)).astype(float)
o=np.argsort(-(tier+soft));o=o[uni[o]];cum=np.cumsum(w[o])/w[o].sum()
inCo=np.zeros(len(df),bool);inCo[o[cum<=0.5+1e-9]]=True
inA=np.zeros(len(df),bool);inA[o[cum<=0.45]]=True;inB=inCo&~inA

# shared bridge vars: religion(C/P/N) x national identity(British/Irish/NI/Other) -- SAME as census
def scode(var,mp,d=None):
    lab=L(var);x=df[c[var]].values;o=np.array([d]*len(x),dtype=object)
    for i,v in enumerate(x):
        s=str(lab.get(v,'')).lower()
        for k,val in mp.items():
            if k in s:o[i]=val;break
    return o
relN=scode('religcat',{'catholic':'C','protestant':'P','no relig':'N','none':'N'},'O')
idN =scode('ninatid',{'northern irish':'NI','british':'British','irish':'Irish','ulster':'British','other':'Other'},None)
IDS=['British','Irish','NI','Other']
def feats(rel,idv):
    X=[]
    for r,i in zip(rel,idv):
        X.append([1.0 if r=='P' else 0,1.0 if r=='N' else 0,
                  1.0 if i=='Irish' else 0,1.0 if i=='NI' else 0,1.0 if i=='Other' else 0,
                  (1.0 if r=='P' and i=='NI' else 0),(1.0 if r=='P' and i=='British' else 0)])
    return np.array(X)
good=uni&np.isin(relN,['C','P','N'])&np.array([x in IDS for x in idN])
clf=LogisticRegression(C=1.0,max_iter=3000).fit(feats(relN[good],idN[good]),inB[good].astype(int),sample_weight=w[good])
def prop(r,i):return clf.predict_proba(feats([r],[i]))[0,1]
print(f"Widened bridge: religion x national-identity. Fit {good.sum()} resp, {inB[good].sum()} margin.")
print("  learned margin propensity by cell (%):")
print("            British  Irish   NI    Other")
for r in ['P','N','C']:
    print(f"    {r}   "+"  ".join(f"{100*prop(r,i):5.1f}" for i in IDS))
print(f"  -> Protestant 'Northern Irish' {100*prop('P','NI'):.1f}%  vs Protestant 'British only' {100*prop('P','British'):.1f}%  (identity splits soft from hard unionism)")

# LC2201 small-area cells: religion{C,P,N} x identity{British,Irish,NI,Other}
# column code -> row index (row[0]=GeographyCode). British block b=6, Irish 11, NI 16, Other 21; +1 Cath,+2 Prot,+3 None/Other-total
BLK={'British':6,'Irish':11,'NI':16,'Other':21}
recs=[]
with open(f"{SG}/SMALL AREAS/LC2201NIDATA0.CSV") as f:
    rd=csv.reader(f);hdr=next(rd)
    for row in rd:
        sa=row[0];v=[float(x) if x else 0 for x in row[1:]]           # v[k-1] == code 000k
        cell={}
        for idv,b in BLK.items():
            cell[('C',idv)]=v[b]      # code b+1 -> v index b
            cell[('P',idv)]=v[b+1]    # b+2 -> v[b+1]
            cell[('N',idv)]=v[b+2]    # b+3 -> v[b+2]
        pop=sum(cell.values())
        if pop<40:continue
        marg=sum(prop(r,i)*n for (r,i),n in cell.items())
        protNI=cell[('P','NI')]; protBr=cell[('P','British')]
        recs.append((sa,100*marg/pop,pop,100*protNI/pop,100*protBr/pop,
                     100*sum(cell[('P',i)] for i in IDS)/pop))
sa=pd.DataFrame(recs,columns=['SA','margin_rate','pop','protNI_pct','protBrit_pct','prot_pct']).set_index('SA')
# SA -> LGD name
hi=pd.read_csv(f"{SG}/All_Geographies_Code_Files/NI_HIERARCHY.csv",dtype=str)
sacol=[x for x in hi.columns if 'SA' in x.upper()][0]; lgdcol=[x for x in hi.columns if 'LGD' in x.upper()][0]
lgdnames=pd.read_csv(f"{SG}/All_Geographies_Code_Files/District_Council_(LGD).csv",dtype=str)
lgmap=dict(zip(lgdnames.iloc[:,0],lgdnames.iloc[:,1]))
sa2lgd=dict(zip(hi[sacol],hi[lgdcol].map(lambda x:lgmap.get(x,x))))
sa['council']=sa.index.map(sa2lgd)
top=sa.sort_values('margin_rate',ascending=False).head(20).round(2)
pd.set_option('display.width',200)
print("\n=== TOP-20 Small Areas by margin prevalence (identity x religion, cell-level) ===")
print(top.reset_index()[['SA','council','pop','prot_pct','protNI_pct','protBrit_pct','margin_rate']].to_string(index=False))
print("\ncouncils represented:",top['council'].value_counts().to_dict())
sa.sort_values('margin_rate',ascending=False).head(50).to_csv(f"{V}/augment/margin_top_smallareas.csv")
print("wrote margin_top_smallareas.csv")
