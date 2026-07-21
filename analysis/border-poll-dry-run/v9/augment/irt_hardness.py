#!/usr/bin/env python3
"""(a) Latent-trait hardness model. Treats the four hardness indicators as noisy
measurements of one latent 'constitutional hardness' trait and fits a 1-factor model
(FactorAnalysis, the linear approximation to a graded-response IRT). This LEARNS the item
weights from their covariance (instead of the hand-set .35/.35/.20/.10) and gives each
respondent a score WITH a standard error (fewer items answered -> larger SE)."""
import pyreadstat, numpy as np, pandas as pd
from sklearn.decomposition import FactorAnalysis
V="analysis/border-poll-dry-run/v9"
df,m=pyreadstat.read_sav('data/surveys/nilt/raw/2019_nilt19w1.sav',encoding='latin1')
c={x.lower():x for x in m.column_names}; Lb=lambda v:m.variable_value_labels.get(c[v],{})
w=df[c['wtfactor']].fillna(0).values
def code(var,mp):
    lab=Lb(var); x=df[c[var]].values; o=np.full(len(x),np.nan)
    for i,v in enumerate(x):
        s=str(lab.get(v,'')).lower()
        for k,val in mp.items():
            if k in s: o[i]=val; break
    return o
strength=code('uninatst',{'very strong':1,'fairly strong':.66,'not very':.33,'neither':0,'none':0})
ref=df[c['refunify']].values; refL=Lb('refunify')
dirn=np.array(['Y' if str(refL.get(v,'')).lower().startswith('yes') else 'N' if str(refL.get(v,'')).lower().startswith('no') else 'U' for v in ref])
acc_ui=code('future1',{'impossible':1,'could live':.5,'happily':0})
acc_uk=code('future2',{'impossible':1,'could live':.5,'happily':0})
accept=np.where(dirn=='Y',acc_uk,np.where(dirn=='N',acc_ui,np.nan))
def resist(items):
    S=[]
    for it in items:
        if it not in c: continue
        lab=Lb(it); x=df[c[it]].values
        S.append(np.array([1.0 if 'no difference' in str(lab.get(v,'')).lower() else (0.0 if ('encourage' in str(lab.get(v,'')).lower() or 'discourage' in str(lab.get(v,'')).lower()) else np.nan) for v in x]))
    return np.nanmean(np.vstack(S),axis=0)
persuade=resist(['uihcare','uieu','uiecon'])
brexit=code('unirfav',{'no difference':1,'more in favour':0,'less in favour':0})
ITEMS=['strength','accept','persuade','brexit']
X=np.vstack([strength,accept,persuade,brexit]).T
ans=~np.isnan(X)                                            # answered mask
keep=ans.sum(1)>=2                                          # need >=2 items
X,ans,ww,dd=X[keep],ans[keep],w[keep],dirn[keep]
# standardize per item (using answered), mean-impute for the FA fit
mu=np.nanmean(X,0); sd=np.nanstd(X,0); sd=np.where(sd==0,1,sd); Z=(X-mu)/sd
Zi=np.nan_to_num(np.where(ans,Z,0.0))
fa=FactorAnalysis(n_components=1,random_state=0).fit(Zi)
Ld=fa.components_[0]; psi=np.maximum(fa.noise_variance_,0.05)   # loadings, item noise (floor uniqueness -> no Heywood)
print("(a) LEARNED item loadings on the latent hardness factor (was fixed .35/.35/.20/.10):")
for it,l,p in zip(ITEMS,Ld,psi): print(f"    {it:10s} loading {l:+.2f}   uniqueness {p:.2f}")
# per-person posterior mean + variance using ONLY answered items (unit-variance factor prior)
score=np.zeros(len(Z)); var=np.zeros(len(Z))
for i in range(len(Z)):
    j=ans[i]; L=Ld[j]; ps=psi[j]; x=Z[i,j]
    prec=1.0+np.sum(L*L/ps); score[i]=np.sum(L/ps*x)/prec; var[i]=1.0/prec
sd_score=np.sqrt(var)
# orient so higher = harder (loadings should be +; flip if needed)
if np.corrcoef(score, np.where(ans[:,0],Z[:,0],0))[0,1]<0: score=-score
hard=(score-score.min())/(score.max()-score.min())         # to [0,1]
se=sd_score/ (score.max()-score.min())
print(f"\n  per-person hardness: mean {np.average(hard,weights=ww):.2f}; median SE {np.median(se):.2f}")
print(f"  SE by #items answered: 2 items {np.median(se[ans.sum(1)==2]):.2f}  |  4 items {np.median(se[ans.sum(1)==4]):.2f}  (more items -> tighter)")
# compare to the fixed-weight composite
fixed=np.nansum(np.where(ans,X*np.array([.35,.35,.20,.10]),0),1)/np.nansum(np.where(ans,np.array([.35,.35,.20,.10]),0),1)
print(f"  corr(IRT score, fixed-weight composite) = {np.corrcoef(hard,fixed)[0,1]:.2f}")
for d,lab in [('N','No/pro-UK'),('U','Undecided'),('Y','Yes/pro-unity')]:
    s=dd==d
    if s.sum(): print(f"    {lab:14s} mean hardness {np.average(hard[s],weights=ww[s]):.2f} +/- {np.median(se[s]):.2f}")
pd.DataFrame({'direction':dd,'hardness':hard.round(3),'se':se.round(3),'n_items':ans.sum(1)}).to_csv(f"{V}/augment/irt_hardness_scores.csv",index=False)
pd.Series(dict(zip(ITEMS,Ld.round(3)))).to_csv(f"{V}/augment/irt_loadings.csv")
print("\nwrote irt_hardness_scores.csv + irt_loadings.csv")
