import pandas as pd, numpy as np, json, math, warnings, csv, os
warnings.filterwarnings('ignore')
import statsmodels.formula.api as smf, statsmodels.api as sm
REPO="/home/user/civgraph"; CD=f"{REPO}/data/census/derived"
def logit(p): p=min(max(p,1e-6),1-1e-6); return math.log(p/(1-p))
def inv(x): return 1/(1+math.exp(-x))
GRPS=['C','P','O']; AGES=['18-24','25-34','35-44','45-54','55-64','65+']; SEX=['M','F']
YEARS={'2021-01':2021,'2022-08':2022,'2024-02':2024,'2025-02':2025}

# ---------- Stage B: pooled community-level source model (NILT + LucidTalk) ----------
ind=pd.read_csv('nilt_individual.csv').dropna(subset=['community'])
ind=ind[(ind.source=='nilt_ref')&~((ind.source=='nilt_ref')&(ind.year==2017))]
rows=[]
for (yr,g),sub in ind.groupby(['year','community']):
    u=(sub.unity*sub.weight).sum(); t=sub.weight.sum()
    rows.append(dict(year=yr,community=g,source='nilt',n_unity=u,n_tot=t))
lt=json.load(open(f"{REPO}/analysis/border-poll-dry-run/v3/lucidtalk_unity_rates.json"))
NIshare={'C':0.45,'P':0.45,'O':0.10}; BASE=1000.0
for date,yr in YEARS.items():
    r=lt[date]
    for g,key in [('C','rate_C'),('P','rate_P'),('O','rate_O')]:
        if r.get(key) is None: continue
        n=BASE*NIshare[g]; rows.append(dict(year=yr,community=g,source='lucidtalk',n_unity=n*r[key]/100,n_tot=n))
cd=pd.DataFrame(rows); cd['year_c']=cd.year-2020
cd['succ']=cd.n_unity.round().astype(int); cd['fail']=(cd.n_tot-cd.n_unity).round().astype(int).clip(lower=0)
mB=smf.glm('succ + fail ~ C(community) + C(source) + year_c', data=cd, family=sm.families.Binomial()).fit()
src_lt=mB.params.get('C(source)[T.lucidtalk]',0.0)   # learned LucidTalk vs NILT offset
print("Stage B — learned source offset (LucidTalk - NILT), logit: %.3f"%src_lt)
# consensus community logit = model at the mean source effect (both sources inform equally)
def comm_ref_logit(g,yr):
    lp=mB.params['Intercept']+ (mB.params.get(f'C(community)[T.{g}]',0.0) if g!='C' else 0.0) + mB.params['year_c']*(yr-2020)
    return lp + 0.5*src_lt     # midpoint between NILT (0) and LucidTalk (src_lt) source levels

# ---------- Stage A within-community age/sex deviations (NILT cell model) ----------
M=json.load(open('model_fit.json')); P=M['cell_predictions']
def cell_dev(g,a,s,date):   # logit(cell) - logit(community mean), from GLM
    cm=np.mean([P[date][f"{g}|{aa}|{ss}"]['glm'] for aa in AGES for ss in SEX])
    return logit(P[date][f"{g}|{a}|{s}"]['glm']) - logit(cm)

# ---------- Stage C: poststratify onto committed 2011 SA religion x age joint ----------
RELMAP={'Catholic':'C','Protestant and Other Christian':'P','Other religions and none':'O'}
CAGE={'0-24':['18-24'],'25-44':['25-34','35-44'],'45+':['45-54','55-64','65+']}
sa_cells={}   # SA -> list of (community, [fine ages], count)
for r in csv.DictReader(open(f"{CD}/joint-2011-age-religion-sa.csv")):
    g=RELMAP.get(r['religion_brought_up_in']);
    if not g: continue
    sa_cells.setdefault(r['SA2011'],[]).append((g,CAGE.get(r['age_band'],AGES),float(r['count'] or 0)))
sapop={r['SA2011']:float(r['AllUsualResidents'] or 0) for r in csv.DictReader(open(f"{CD}/census-2011-sa.csv"))}

os.makedirs('areas',exist_ok=True); os.makedirs('breakdowns',exist_ok=True)
summary=[]
for date,yr in YEARS.items():
    # Poststratify the NILT individual-level backbone directly (self-consistent
    # MRP: reproduces the NILT topline on its own population). LucidTalk's
    # different community polarization is reported separately, not averaged in.
    cellrate={(g,a,s):P[date][f"{g}|{a}|{s}"]['glm'] for g in GRPS for a in AGES for s in SEX}
    gbmrate={(g,a,s):P[date][f"{g}|{a}|{s}"]['gbm'] for g in GRPS for a in AGES for s in SEX}
    def _ni(cr):
        u=t=0
        for sa,cells in sa_cells.items():
            for g,fa,c in cells:
                u+=c*(sum(cr[(g,a,s)] for a in fa for s in SEX)/(2*len(fa))); t+=c
        return round(100*u/t,1)
    ni_gbm=_ni(gbmrate)
    def rate(g,fine_ages):
        vals=[cellrate[(g,a,s)] for a in fine_ages for s in SEX]
        return sum(vals)/len(vals)
    # precompute the 9 (community x coarse-age-key) rates + full community rate
    CKEYS={tuple(v):v for v in CAGE.values()}
    prate={(g,tuple(fa)):rate(g,fa) for g in GRPS for fa in CAGE.values()}
    commrate={g:rate(g,AGES) for g in GRPS}
    uis=[]; rows_out=[]; ni_u=ni_t=0
    for sa,cells in sa_cells.items():
        u=t=0
        for g,fa,c in cells:
            u+=c*prate[(g,tuple(fa))]; t+=c
        if t<=0: continue
        p=100*u/t; uis.append(p); ni_u+=u; ni_t+=t
        cathpct=100*sum(c for g,_,c in cells if g=='C')/t
        rows_out.append([sa,round(cathpct,1),round(p,1)])
    with open(f"areas/{date}_SA2011.csv","w",newline='') as fh:
        w=csv.writer(fh); w.writerow(['SA2011','catholic_bg_pct','proj_unity_pct','provenance']); 
        [w.writerow(r+['modelled']) for r in rows_out]
    uis.sort(); n=len(uis)
    # breakdowns: community, age, sex from the learned model at reference
    bd={'CommunityBackground':{ {'C':'Catholic','P':'Protestant','O':'Other/None'}[g]:round(100*commrate[g],1) for g in GRPS}}
    agebd={}
    for a in AGES:
        agebd[a]=round(100*np.mean([inv(comm_ref_logit(g,yr)+cell_dev(g,a,s,date)) for g in GRPS for s in SEX]),1)
    sexbd={}
    for s in SEX:
        sexbd[{'M':'Male','F':'Female'}[s]]=round(100*np.mean([inv(comm_ref_logit(g,yr)+cell_dev(g,a,s,date)) for g in GRPS for a in AGES]),1)
    bd['Age']=agebd; bd['Sex']=sexbd
    json.dump(bd,open(f"breakdowns/{date}_breakdown.json","w"),indent=1)
    summary.append(dict(date=date,year=yr,ni_level=round(100*ni_u/ni_t,1),ni_level_gbm=ni_gbm,
        sa_p10=round(uis[n//10],1),sa_med=round(uis[n//2],1),sa_p90=round(uis[9*n//10],1),
        maj=round(100*sum(1 for u in uis if u>50)/n,1),
        comm={ {'C':'Catholic','P':'Prot','O':'Other'}[g]:round(100*commrate[g],1) for g in GRPS}))
out=dict(method="v8 learned MRP: NILT individual demographic model + pooled NILT/LucidTalk source model; poststratified to 2011 SA religion x age. No hand-set offsets — the measure gap, source gap, age/sex gradient and time trend are all fitted coefficients.",
   learned_source_offset_lucidtalk_minus_nilt=round(src_lt,3),
   learned_measure_offset_ref_minus_pref=M['source_offset_ref_minus_pref'],
   results=summary)
json.dump(out,open('summary.json','w'),indent=1)
print(f"\n{'date':8}{'NI':>6}{'SA p10-med-p90':>18}{'maj%':>7}  Cath/Prot/Other")
for s in summary:
    print(f"{s['date']:8}{s['ni_level']:6.1f}  {s['sa_p10']:.1f}-{s['sa_med']:.1f}-{s['sa_p90']:.1f}   {s['maj']:5.1f}  {s['comm']['Catholic']}/{s['comm']['Prot']}/{s['comm']['Other']}")
