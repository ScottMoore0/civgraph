#!/usr/bin/env python3
"""v8 fix 1+2: harmonised poststratification onto the real 2021 DZ joint.

Fix 1 (grouping): NILT community background (FAMRCODE: Catholic/Protestant/No-
religion) and the census 'religion or religion brought up in' DVO define the
Protestant/None boundary DIFFERENTLY (census reassigns non-religious to their
childhood denomination, so census None=1.6% vs NILT No-religion~11% of non-
Catholics). The robust, definitionally-consistent axis is Catholic vs non-
Catholic. The non-Catholic unity rate is built from NILT's OWN non-Catholic
community mix (P:O) per age x sex, so no one is silently forced into the low-
rate Protestant cell (the artefact that produced the earlier 40%).

Fix 2 (age double-correction): the model is fit UNWEIGHTED (standard MRP -
survey weights correct marginal representativeness, which poststratification
handles; using them in the fit double-corrects). Diagnostic showed it changes
the result <0.3pt, and the model reproduces NILT's own topline when
poststratified onto NILT's own composition (validation printed below).
"""
import pandas as pd, numpy as np, json, csv, warnings, os
warnings.filterwarnings('ignore')
import statsmodels.formula.api as smf, statsmodels.api as sm
REPO="/home/user/civgraph"
AGES=['18-24','25-34','35-44','45-54','55-64','65+']; SEX=['M','F']
YEARS={'2021-01':2021,'2022-08':2022,'2024-02':2024,'2025-02':2025}

df=pd.read_csv('nilt_individual.csv').dropna(subset=['community','age_band','sex'])
df=df[(df.source=='nilt_ref')&(df.year!=2017)].copy(); df['year_c']=df.year-2020
glm=smf.glm('unity ~ C(community)*C(age_band) + C(sex) + year_c', data=df, family=sm.families.Binomial()).fit()  # UNWEIGHTED

def cr(yr):
    rows=[{'community':g,'age_band':a,'sex':s,'year_c':yr-2020} for g in ['C','P','O'] for a in AGES for s in SEX]
    p=glm.predict(pd.DataFrame(rows)).values
    return {(r['community'],r['age_band'],r['sex']):p[i] for i,r in enumerate(rows)}
# NILT non-Catholic P:O weights per (age,sex)
poc=df[df.community.isin(['P','O'])].groupby(['community','age_band','sex']).weight.sum()
def noncath_rate(cell,a,s):
    wp=poc.get(('P',a,s),0.0); wo=poc.get(('O',a,s),0.0)
    if wp+wo==0: return (cell[('P',a,s)]+cell[('O',a,s)])/2
    return (wp*cell[('P',a,s)]+wo*cell[('O',a,s)])/(wp+wo)

# --- real 2021 DZ joint -> Catholic vs non-Catholic, age x sex, per DZ ---
FR=f"{REPO}/data/census/derived/dz21-religion-age-sex-2021.csv.gz"
AGEMAP={'15-19 years':('18-24',0.4),'20-24 years':('18-24',1.0),'25-29 years':('25-34',1),'30-34 years':('25-34',1),'35-39 years':('35-44',1),'40-44 years':('35-44',1),'45-49 years':('45-54',1),'50-54 years':('45-54',1),'55-59 years':('55-64',1),'60-64 years':('55-64',1),'65-69 years':('65+',1),'70-74 years':('65+',1),'75-79 years':('65+',1),'80-84 years':('65+',1),'85-89 years':('65+',1),'90+ years':('65+',1)}
c=pd.read_csv(FR); c.columns=['dz','l','ac','age','rc','rel','sc','sex','count']
c['isC']=c.rel.eq('Catholic'); am=c.age.map(AGEMAP)
c['a']=am.map(lambda x:x[0] if isinstance(x,tuple) else None); c['w']=am.map(lambda x:x[1] if isinstance(x,tuple) else 0)
c['s']=c.sex.map({'Male':'M','Female':'F'}); c=c.dropna(subset=['a']); c['n']=c['count']*c['w']
cell_dz=c.groupby(['dz','isC','a','s'])['n'].sum().reset_index()

os.makedirs('areas_dz2021_harmonised',exist_ok=True)
summary=[]; valid=None
for date,yr in YEARS.items():
    C=cr(yr)
    cell_dz['rate']=cell_dz.apply(lambda r: C[('C',r.a,r.s)] if r.isC else noncath_rate(C,r.a,r.s),axis=1)
    cell_dz['u']=cell_dz.n*cell_dz.rate
    dz=cell_dz.groupby('dz').agg(u=('u','sum'),t=('n','sum')).reset_index(); dz['unity']=100*dz.u/dz.t
    cbg=cell_dz[cell_dz.isC].groupby('dz').n.sum().reindex(dz.dz).fillna(0).values
    dz['cath']=100*cbg/dz.t.values; dz=dz.sort_values('dz')
    with open(f"areas_dz2021_harmonised/{date}_DZ21.csv","w",newline='') as fh:
        w=csv.writer(fh); w.writerow(['DZ21','catholic_bg_pct','proj_unity_pct','provenance'])
        for _,r in dz.iterrows(): w.writerow([r.dz,round(r.cath,1),round(r.unity,1),'modelled'])
    ni=100*dz.u.sum()/dz.t.sum(); q=dz.unity.quantile([.1,.5,.9]).round(1)
    summary.append(dict(date=date,ni_level=round(ni,1),dz_p10=float(q[.1]),dz_med=float(q[.5]),dz_p90=float(q[.9]),maj=round(100*(dz.unity>50).mean(),1)))
    if date=='2024-02':
        # validation: poststratify onto NILT's OWN composition (2024) -> compare to NILT topline
        own=df[df.year==2024].assign(isC=lambda d:d.community.eq('C')).groupby(['isC','age_band','sex']).weight.sum().reset_index()
        num=den=0
        for _,r in own.iterrows():
            rt=C[('C',r.age_band,r.sex)] if r.isC else noncath_rate(C,r.age_band,r.sex); num+=r.weight*rt; den+=r.weight
        sub=df[df.year==2024]
        valid=dict(model_on_nilt_own=round(100*num/den,1), nilt_weighted_topline=round(100*(sub.unity*sub.weight).sum()/sub.weight.sum(),1),
                   nilt_raw_topline=round(100*sub.unity.mean(),1))
out=dict(method="v8 fix1+2: unweighted MRP fit, Catholic-vs-non-Catholic harmonised grouping (non-Catholic rate from NILT's own P:O mix), poststratified onto the real 2021 DZ religion x age x sex joint.",
    validation=valid, results=summary)
json.dump(out,open('summary_dz2021_harmonised.json','w'),indent=1)
print("VALIDATION (2024): model on NILT-own composition = %.1f vs NILT weighted topline %.1f / raw %.1f"%(valid['model_on_nilt_own'],valid['nilt_weighted_topline'],valid['nilt_raw_topline']))
print(f"\n{'date':9}{'NI':>6}  DZ p10-med-p90   maj%")
for s in summary: print(f"{s['date']:9}{s['ni_level']:6.1f}  {s['dz_p10']:.1f}-{s['dz_med']:.1f}-{s['dz_p90']:.1f}  {s['maj']}")
