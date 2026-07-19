#!/usr/bin/env python3
"""v9 phase 8 — BACKTEST.

Treats the whole pipeline as a predictor and scores it against known outcomes:
elections (local / Assembly / Westminster) and the 2016 EU referendum, at three
spatial levels. It separates the two skills the model actually has and tests
each honestly, then combines them end-to-end.

  A. GEOGRAPHIC GRADIENT (NISRA census -> within-NI spatial shape)
     Leave-one-contest-out ridge, per-contest level removed. Answers: given the
     NI-wide level, how well does the census predict the area pattern?
       - DEA(80):        local 2014/2019/2023
       - Constituency(18): Assembly 2016/17/22 + Westminster 2017/19/24
  B. EU-REF TRANSFER — census can't be leave-one-out on a single contest, so the
     2016 Remain shape is predicted two ways: (i) transfer from the nationalist
     gradient, (ii) an in-sample census fit (upper bound, labelled as such).
  C. NI-WIDE LEVEL (LucidTalk / NILT poll -> topline). Poll nationalist-bloc VI
     vs actual, per poll-paired contest. Plus the census-only baseline, which has
     no time signal and must guess the level from the training mean — quantifying
     why a poll input is required at all.
  D. END-TO-END — census gradient re-centred to the poll-implied level, scored in
     ABSOLUTE terms (no per-contest demeaning), the true input->output test.

Outputs: printed tables + backtest_report.json.
"""
import pandas as pd, numpy as np, json, os
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

HERE=os.path.dirname(__file__) or "."
res=pd.read_csv(f"{HERE}/results_frame.csv")
deaf=pd.read_csv(f"{HERE}/dea_features.csv").set_index('area')
conf=pd.read_csv(f"{HERE}/constituency_features.csv").set_index('con')
conf.index=conf.index.str.upper()
FEATS=[c for c in deaf.columns]
ALPHA=10.0
report={'levels':{}}

def loco_gradient(sub, feat, weightcol='total', target='nat_pct'):
    """Leave-one-contest-out ridge on per-contest-demeaned target -> shape skill.
    Returns per-row predictions (absolute, level added back) and the merged frame."""
    sub=sub.copy()
    sub['cy']=sub.contest+sub.year.astype(str)
    sub=sub.merge(feat,left_index=False,right_index=True,left_on='key')
    y=sub[target].values.astype(float)
    lvl=sub.groupby('cy')[target].transform('mean').values
    sc=StandardScaler().fit(sub[FEATS].values)
    Xs=sc.transform(sub[FEATS].values)
    pred=np.zeros(len(sub))
    for c in sub.cy.unique():
        te=sub.cy.values==c; tr=~te
        m=Ridge(alpha=ALPHA).fit(Xs[tr],(y-lvl)[tr])
        pred[te]=m.predict(Xs[te])+lvl[te]
    sub['pred']=pred
    return sub

def score(a,p):
    a=np.asarray(a,float);p=np.asarray(p,float)
    r2=1-((p-a)**2).sum()/((a-a.mean())**2).sum()
    return dict(r2=round(float(r2),3),mae=round(float(np.abs(p-a).mean()),2),n=len(a))

# ---------------- A. geographic gradient ----------------
print("="*70); print("A. GEOGRAPHIC GRADIENT — census -> within-NI shape (leave-one-contest-out)"); print("="*70)
A={}
# DEA
dea=res[(res.scale=='dea')&(res.contest=='local')].copy(); dea['key']=dea.area
dea=dea[dea.area.isin(deaf.index)]
sub=loco_gradient(dea,deaf)
A['DEA_local']=score(sub.nat_pct,sub.pred)
per=sub.groupby('cy').apply(lambda d:score(d.nat_pct,d.pred)['r2']).to_dict()
print(f"DEA(80)  local 2014/19/23     : R2={A['DEA_local']['r2']:.3f}  MAE={A['DEA_local']['mae']:.2f}pts  (n={A['DEA_local']['n']})")
print("   per-contest R2:", {k:round(v,3) for k,v in per.items()})
# Constituency (nationalist bloc: assembly + westminster)
con=res[(res.scale=='constituency')&(res.contest.isin(['assembly','westminster']))].copy()
con['key']=con.area.str.upper()
con=con[con.key.isin(conf.index)]
subc=loco_gradient(con,conf)
A['CON_nat']=score(subc.nat_pct,subc.pred)
perc=subc.groupby('cy').apply(lambda d:score(d.nat_pct,d.pred)['r2']).to_dict()
print(f"Con(18)  Assembly+Westminster : R2={A['CON_nat']['r2']:.3f}  MAE={A['CON_nat']['mae']:.2f}pts  (n={A['CON_nat']['n']})")
print("   per-contest R2:", {k:round(v,3) for k,v in perc.items()})
report['A_geographic_gradient']=A

# ---------------- B. EU-ref transfer ----------------
print("\n"+"="*70); print("B. 2016 EU-REFERENDUM (Remain) — constituency shape"); print("="*70)
eu=res[res.contest=='euref'].copy(); eu['key']=eu.area.str.upper()
eu=eu[eu.key.isin(conf.index)].merge(conf,left_on='key',right_index=True)
sc=StandardScaler().fit(conf.loc[subc.key.unique()][FEATS].values) if False else StandardScaler().fit(conf[FEATS].values)
# (i) transfer: nationalist gradient trained on ALL nat constituency contests, applied to Remain shape
ntr=con.merge(conf,left_on='key',right_index=True)
scn=StandardScaler().fit(ntr[FEATS].values)
yy=ntr.nat_pct.values-ntr.groupby(ntr.contest+ntr.year.astype(str)).nat_pct.transform('mean').values
mg=Ridge(alpha=ALPHA).fit(scn.transform(ntr[FEATS].values),yy)
eu_shape=mg.predict(scn.transform(eu[FEATS].values))
eu_pred_transfer=eu_shape - np.average(eu_shape,weights=eu.total) + np.average(eu.remain_pct,weights=eu.total)
B={'transfer_from_nat_gradient':score(eu.remain_pct,eu_pred_transfer)}
# correlation of the two shapes
B['corr_remain_vs_natgradient']=round(float(np.corrcoef(eu.remain_pct,eu_shape)[0,1]),3)
# (ii) honest generalisation: leave-one-AREA-out CV on euref alone (single contest,
#      so no leave-one-contest-out possible). In-sample R2 is meaningless with 88
#      features / 18 points, so we do NOT report it.
Xe=StandardScaler().fit_transform(eu[FEATS].values); ye=eu.remain_pct.values
loo=np.zeros(len(ye))
for i in range(len(ye)):
    tr=np.arange(len(ye))!=i
    loo[i]=Ridge(alpha=ALPHA).fit(Xe[tr],ye[tr]).predict(Xe[i:i+1])[0]
B['leave_one_area_out_cv']=score(ye,loo)
print(f"Transfer (nationalist gradient -> Remain shape): R2={B['transfer_from_nat_gradient']['r2']:.3f}  MAE={B['transfer_from_nat_gradient']['mae']:.2f}pts")
print(f"   corr(Remain shape, nationalist shape) = {B['corr_remain_vs_natgradient']:+.3f}  (direction agrees, magnitude wrong:")
print( "   pro-Remain unionist seats — Belfast S/E, North Down, Strangford — break the level link)")
print(f"Census leave-one-AREA-out CV (18 pts)      : R2={B['leave_one_area_out_cv']['r2']:.3f}  MAE={B['leave_one_area_out_cv']['mae']:.2f}pts")
report['B_euref']=B

# ---------------- C. NI-wide level from polls ----------------
print("\n"+"="*70); print("C. NI-WIDE LEVEL — poll nationalist-bloc VI vs actual"); print("="*70)
vi=json.load(open(f"{HERE}/../v6/lucidtalk_vi_primary.json"))
def nat_from_vi(d):  # nationalist bloc = SF + SDLP + Aontú
    return round(d.get('Sinn Féin',0)+d.get('SDLP',0)+d.get('Aontú',0),1)
actual_ni={}
resx=res.copy(); resx['cy']=resx.contest+' '+resx.year.astype(str)
for cy,g in resx.groupby('cy'):
    col='remain_pct' if g.contest.iloc[0]=='euref' else 'nat_pct'
    actual_ni[cy]=round(float(np.average(g[col].dropna(),weights=g.loc[g[col].notna(),'total'])),2)
pairs=[('2017-assembly','assembly 2017'),('2022-assembly','assembly 2022'),('2024-westminster','westminster 2024')]
C={'contests':[]}
errs=[]
for vk,ck in pairs:
    p=nat_from_vi(vi['contests'][vk]); a=actual_ni[ck]; errs.append(p-a)
    C['contests'].append(dict(contest=ck,poll_nat=p,actual_nat=a,error=round(p-a,2)))
    print(f"  {ck:18s}: LucidTalk nat-bloc {p:5.1f}  vs actual {a:5.1f}  -> err {p-a:+.2f}")
# euref
eu_poll=vi['eu']['lucidtalk_decided_remain']; eu_act=vi['eu']['actual_remain']
C['contests'].append(dict(contest='euref 2016',poll_nat=eu_poll,actual_nat=eu_act,error=round(eu_poll-eu_act,2)))
errs.append(eu_poll-eu_act)
print(f"  {'euref 2016':18s}: LucidTalk Remain   {eu_poll:5.1f}  vs actual {eu_act:5.1f}  -> err {eu_poll-eu_act:+.2f}")
C['poll_MAE']=round(float(np.mean(np.abs(errs))),2)
C['poll_mean_error']=round(float(np.mean(errs)),2)
print(f"  -> poll level  MAE={C['poll_MAE']:.2f}pts  mean(signed)={C['poll_mean_error']:+.2f}pts (house effect: understates nationalists)")
# "persistence" baseline: no time signal -> guess level = mean of the OTHER contests.
# This is what a census-only model must fall back to (census is static; it cannot
# generate a time-varying level). For the NATIONALIST FIRST-PREF vote it is a strong
# baseline BECAUSE that vote barely moves (37-41% across a decade).
natcontests={k:v for k,v in actual_ni.items() if not k.startswith('euref')}
base_err=[]
for cy,a in natcontests.items():
    others=[v for k,v in natcontests.items() if k!=cy]
    base_err.append(np.mean(others)-a)
C['persistence_level_MAE']=round(float(np.mean(np.abs(base_err))),2)
C['nat_vote_range']=[round(float(min(natcontests.values())),1),round(float(max(natcontests.values())),1)]
print(f"  persistence baseline (guess = mean of other contests): MAE={C['persistence_level_MAE']:.2f}pts")
print(f"  FINDING: nationalist first-pref vote is near-STATIONARY ({C['nat_vote_range'][0]}-{C['nat_vote_range'][1]}%),")
print(f"           so persistence ({C['persistence_level_MAE']:.2f}) actually beats the house-biased poll ({C['poll_MAE']:.2f}).")
print( "           This does NOT transfer to the unity question, which is non-stationary and")
print( "           has no past referendum to persist from — there the poll is the only level signal.")
report['C_ni_level']=C

# ---------------- D. end-to-end absolute ----------------
print("\n"+"="*70); print("D. END-TO-END — poll level + census gradient, ABSOLUTE area prediction"); print("="*70)
# for each poll-paired constituency contest: level from poll, shape from gradient trained on the OTHER contests
D={'contests':[]}
allrows_a=[];allrows_p=[]
poll_level={'assembly 2017':nat_from_vi(vi['contests']['2017-assembly']),
            'assembly 2022':nat_from_vi(vi['contests']['2022-assembly']),
            'westminster 2024':nat_from_vi(vi['contests']['2024-westminster'])}
for cy,lvl in poll_level.items():
    contest,year=cy.split(); year=int(year)
    tgt=con[(con.contest==contest)&(con.year==year)].merge(conf,left_on='key',right_index=True)
    tr=con[~((con.contest==contest)&(con.year==year))].merge(conf,left_on='key',right_index=True)
    sctr=StandardScaler().fit(tr[FEATS].values)
    ytr=tr.nat_pct.values-tr.groupby(tr.contest+tr.year.astype(str)).nat_pct.transform('mean').values
    m=Ridge(alpha=ALPHA).fit(sctr.transform(tr[FEATS].values),ytr)
    shape=m.predict(sctr.transform(tgt[FEATS].values))
    pred=shape-np.average(shape,weights=tgt.total)+lvl   # re-centre to POLL level (not actual)
    s=score(tgt.nat_pct,pred); D['contests'].append(dict(contest=cy,poll_level=lvl,**s))
    allrows_a+=list(tgt.nat_pct.values);allrows_p+=list(pred)
    print(f"  {cy:18s}: level={lvl:.1f}(poll)  area R2={s['r2']:.3f}  MAE={s['mae']:.2f}pts")
D['pooled']=score(allrows_a,allrows_p)
print(f"  POOLED absolute (poll level + gradient): R2={D['pooled']['r2']:.3f}  MAE={D['pooled']['mae']:.2f}pts")
report['D_end_to_end']=D

json.dump(report,open(f"{HERE}/backtest_report.json","w"),indent=1)
print("\nwrote backtest_report.json")
