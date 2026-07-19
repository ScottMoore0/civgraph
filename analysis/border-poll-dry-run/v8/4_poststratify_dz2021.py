import pandas as pd, json, csv, os, gzip
REPO="/home/user/civgraph"
FR=f"{REPO}/data/census/derived/dz21-religion-age-sex-2021.csv.gz"
GRPS=['C','P','O']; AGES=['18-24','25-34','35-44','45-54','55-64','65+']; SEX=['M','F']
RELMAP={'Catholic':'C','Protestant and Other Christian (including Christian related)':'P','None':'O','Other religions':'O'}
# 19-cat age label -> (my band, voting-age weight)
AGEMAP={'15-19 years':('18-24',0.4),'20-24 years':('18-24',1.0),'25-29 years':('25-34',1.0),'30-34 years':('25-34',1.0),
 '35-39 years':('35-44',1.0),'40-44 years':('35-44',1.0),'45-49 years':('45-54',1.0),'50-54 years':('45-54',1.0),
 '55-59 years':('55-64',1.0),'60-64 years':('55-64',1.0),'65-69 years':('65+',1.0),'70-74 years':('65+',1.0),
 '75-79 years':('65+',1.0),'80-84 years':('65+',1.0),'85-89 years':('65+',1.0),'90+ years':('65+',1.0)}
SEXMAP={'Male':'M','Female':'F'}
df=pd.read_csv(FR)
df.columns=['dz','dzlab','agecode','age','relcode','rel','sexcode','sex','count']
df['g']=df.rel.map(RELMAP); df['s']=df.sex.map(SEXMAP)
am=df.age.map(AGEMAP); df['a']=am.map(lambda x:x[0] if isinstance(x,tuple) else None); df['w']=am.map(lambda x:x[1] if isinstance(x,tuple) else 0.0)
df=df.dropna(subset=['g','a','s']); df['n']=df['count']*df['w']
cell=df.groupby(['dz','g','a','s'])['n'].sum().reset_index()

M=json.load(open('model_fit.json'))['cell_predictions']
os.makedirs('areas_dz2021_full',exist_ok=True)
YEARS=['2021-01','2022-08','2024-02','2025-02']
summary=[]
for date in YEARS:
    P=M[date]
    cell['rate']=cell.apply(lambda r:P[f"{r.g}|{r.a}|{r.s}"]['glm'],axis=1)
    cell['u']=cell['n']*cell['rate']
    dz=cell.groupby('dz').agg(u=('u','sum'),t=('n','sum')).reset_index()
    dz['unity']=100*dz.u/dz.t
    # catholic bg per dz
    cbg=cell[cell.g=='C'].groupby('dz')['n'].sum().reindex(dz.dz).fillna(0).values
    dz['cath']=100*cbg/dz.t.values
    dz=dz.sort_values('dz')
    with open(f"areas_dz2021_full/{date}_DZ21.csv","w",newline='') as fh:
        w=csv.writer(fh);w.writerow(['DZ21','catholic_bg_pct','proj_unity_pct','provenance'])
        for _,r in dz.iterrows(): w.writerow([r.dz,round(r.cath,1),round(r.unity,1),'modelled'])
    ni=100*dz.u.sum()/dz.t.sum()
    q=dz.unity.quantile([.1,.5,.9]).round(1)
    summary.append(dict(date=date,ni_level=round(ni,1),dz_p10=float(q[.1]),dz_med=float(q[.5]),dz_p90=float(q[.9]),
        maj=round(100*(dz.unity>50).mean(),1),ni_cath=round(100*cell[cell.g=='C'].n.sum()/cell.n.sum(),1)))
json.dump({'frame':'data/census/derived/dz21-religion-age-sex-2021.csv.gz (real NISRA FTB 3-way joint)',
    'r2_source':'data.civgraph.net/data/census/nisra-ftb/PEOPLE__DZ21~AGE_BAND_5YR~RELIGION_BELONG_TO_OR_BROUGHT_UP_IN_DVO~UR_SEX.csv.gz',
    'results':summary},open('summary_dz2021_full.json','w'),indent=1)
print(f"{'date':9}{'NI':>6}{'DZ p10-med-p90':>18}{'maj%':>7}  NIcath%")
for s in summary: print(f"{s['date']:9}{s['ni_level']:6.1f}  {s['dz_p10']:.1f}-{s['dz_med']:.1f}-{s['dz_p90']:.1f}  {s['maj']:6.1f}  {s['ni_cath']}")
