#!/usr/bin/env python3
"""v9 phases 3-4 — regularised census->result model + multi-scale validation.
Ridge regression of nationalist first-pref share on 88 census features, with
per-contest level removed (models the geographic SHAPE). Validated leave-one-
contest-out, and across the nested scale chain DEA(80) -> council(11) -> NI(1)."""
import pandas as pd, numpy as np, json
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
REPO="/home/user/civgraph"
feat=pd.read_csv('dea_features.csv').set_index('area')
res=pd.read_csv('results_frame.csv')
dea=res[(res.scale=='dea')&(res.contest=='local')].copy()
# DEA->council map from the 2023 local file
lf=json.load(open(f"{REPO}/test/metadata/elections-test2/local-government-local-government-districts__2023-05-18.json"))
dea2council=lf['localBodyByConstituency']
common=[a for a in dea.area.unique() if a in feat.index]
print("DEA match: %d/%d areas have census features"%(len(common),dea.area.nunique()))
dea=dea[dea.area.isin(common)]
X_all=feat.loc[common]; scaler=StandardScaler().fit(X_all.values)
FEATS=X_all.columns.tolist()

def prep(sub):
    sub=sub.merge(feat,left_on='area',right_index=True)
    y=sub.nat_pct.values.astype(float)
    ymean=sub.groupby('contest_year')['nat_pct'].transform('mean').values  # per-contest level
    Xs=scaler.transform(sub[FEATS].values)
    return sub,Xs,y,ymean
dea['contest_year']=dea.contest+dea.year.astype(str)
sub,Xs,y,ymean=prep(dea)

# leave-one-contest-out CV
contests=sorted(dea.contest_year.unique())
preds=np.zeros(len(sub)); 
for c in contests:
    tr=sub.contest_year.values!=c; te=~tr
    m=Ridge(alpha=10.0).fit(Xs[tr],(y-ymean)[tr])
    preds[te]=m.predict(Xs[te])+ymean[te]
from numpy import corrcoef
r2=1-((preds-y)**2).sum()/((y-y.mean())**2).sum()
mae=np.abs(preds-y).mean()
print("Leave-one-contest-out (DEA level): R2=%.3f  MAE=%.2f pts  (n=%d)"%(r2,mae,len(y)))

# multi-scale: aggregate predicted vs actual to council(11) and NI(1), per contest
sub=sub.assign(pred=preds, council=sub.area.map(dea2council))
def agg(level):
    g=sub.groupby(['contest_year',level] if level else 'contest_year')
    a=g.apply(lambda d: pd.Series({'act':np.average(d.nat_pct,weights=d.total),'prd':np.average(d.pred,weights=d.total)}))
    return a
for lvl,name in [('council','council(11)'),(None,'NI(1)')]:
    a=agg(lvl); r=1-((a.prd-a.act)**2).sum()/((a.act-a.act.mean())**2).sum()
    print("  scale %-11s: R2=%.3f  max|err|=%.2f pts"%(name,r,(a.prd-a.act).abs().max()))

# full-data fit for the geographic gradient (used in phase 5)
mfull=Ridge(alpha=10.0).fit(Xs,y-ymean)
# save standardised coefficients (feature importance for the nationalist gradient)
coef=pd.Series(mfull.coef_,index=FEATS).sort_values(key=abs,ascending=False)
coef.to_csv('gradient_coefficients.csv',header=['std_coef'])
print("\nTop census predictors of nationalist share (|std coef|):")
for f,c in coef.head(12).items(): print("  %+6.2f  %s"%(c,f))
np.save(f'{__import__("os").path.dirname(__file__) or "."}/_scaler_mean.npy',scaler.mean_)
