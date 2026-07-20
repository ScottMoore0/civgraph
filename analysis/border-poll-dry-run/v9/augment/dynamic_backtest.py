#!/usr/bin/env python3
"""Group-B test: does DYNAMIC demography (inter-censal 2011->2021 change) add signal
beyond the static census? Two engineered, low-dimensional features per constituency:
  pop_growth   = % population change 2011->2021        (net births-deaths+migration)
  cath_moment  = Catholic-background %  2021 minus 2011 (composition momentum)
Both are the NET effect of births/deaths/migration at census geography -- the trajectory
a single static census cannot see. Same inner-CV guard as the party-lag test: adopt the
block only on a robust >=3% held-out improvement, else recover the census baseline exactly.
Elections use leave-one-contest-out; the EU-ref uses leave-one-area-out.

Caveat: the 2011->2021 delta partly POSTDATES the 2016-19 targets, so for those this is a
momentum-*association* test (its leakage-clean home is FORWARD unity projection); Assembly
2022 is the one target for which the momentum is genuinely prior. Flagged, not hidden."""
import json, csv, numpy as np, pandas as pd, os
from datetime import date
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
V="/home/user/civgraph/analysis/border-poll-dry-run/v9"; B="/home/user/civgraph/data/census"
# --- 2011 constituency (ASSEMBLY AREAS: KS212 pop + Catholic-bg %) ---
AA=f"{B}/2011/census-2011-key-statistics-tables-administrative-geographies (1)/ASSEMBLY AREAS/KS212NIDATA0.CSV"
lut={r['CODE']:r['NAME'].upper() for r in csv.DictReader(open(
  f"{B}/2011/census-2011-key-statistics-tables-statistical-geographies/All_Geographies_Code_Files/Assembly_Areas_(AA).csv"))}
k11=pd.read_csv(AA).set_index('GeographyCode')
d11=pd.DataFrame({'pop11':k11['KS212NI0001'],'cath11':k11['KS212NI0006']}); d11.index=[lut[c] for c in d11.index]
# --- 2021 constituency (DZ community-bg aggregated via DZ->constituency) ---
dz=pd.read_csv(f"{B}/derived/dz21-community-2021.csv")
dz2con=json.load(open(f"{V}/dz_constituency.json")); dz['con']=dz['DZ21'].map(dz2con)
g=dz.dropna(subset=['con']).groupby('con')
d21=pd.DataFrame({'pop21':g['population'].sum(),
                  'cath21':g.apply(lambda x:np.average(x['catholic_bg_pct'],weights=x['population']))})
dyn=d11.join(d21)
dyn['dyn__pop_growth']=(dyn['pop21']-dyn['pop11'])/dyn['pop11']*100
dyn['dyn__cath_moment']=dyn['cath21']-dyn['cath11']
DYN=['dyn__pop_growth','dyn__cath_moment']
print("Inter-censal 2011->2021 dynamics by constituency (sorted by Catholic momentum):")
print(dyn[['pop_growth' if False else 'dyn__pop_growth','dyn__cath_moment']].round(1)
      .rename(columns={'dyn__pop_growth':'pop_growth%','dyn__cath_moment':'cath_momentum_pp'})
      .sort_values('cath_momentum_pp',ascending=False).head(4).to_string())

# --- backtest harness (mirror lag_backtest) ---
res=pd.read_csv(f"{V}/results_frame.csv")
cf=pd.read_csv(f"{V}/constituency_features.csv"); cf['con']=cf['con'].str.upper(); cf=cf.set_index('con'); CEN=list(cf.columns)
TARGETS=[('assembly',2016,'nat_pct'),('assembly',2017,'nat_pct'),('assembly',2022,'nat_pct'),
         ('westminster',2017,'nat_pct'),('westminster',2019,'nat_pct'),('euref',2016,'remain_pct')]
rows=[]
for contest,year,tcol in TARGETS:
    sub=res[(res.contest==contest)&(res.year==year)].copy(); sub['area']=sub.area.str.upper()
    for _,r in sub.iterrows():
        a=r['area']
        if a in cf.index and a in dyn.index and pd.notna(r[tcol]):
            rows.append(dict(key=f"{contest}{year}",area=a,y=r[tcol]))
df=pd.DataFrame(rows).merge(cf,left_on='area',right_index=True).merge(dyn[DYN],left_on='area',right_index=True)
df['lvl']=df.groupby('key')['y'].transform('mean'); df['t']=df['y']-df['lvl']
MARGIN=0.03
def fp(tr,te,cols,al=10):
    s=StandardScaler().fit(tr[cols].values); return Ridge(alpha=al).fit(s.transform(tr[cols].values),tr['t'].values).predict(s.transform(te[cols].values))
def mae(a,p): return float(np.abs(np.asarray(a)-np.asarray(p)).mean())
def r2(a,p): a=np.asarray(a);p=np.asarray(p); return float(1-((p-a)**2).sum()/((a-a.mean())**2).sum())
def sel(tr,groups):
    e={0:[],1:[]}
    for gg in groups:
        itr=tr[tr.key!=gg]; ite=tr[tr.key==gg]
        if len(ite)<1 or len(itr)<3: continue
        e[0].append(mae(ite['t'].values,fp(itr,ite,CEN))); e[1].append(mae(ite['t'].values,fp(itr,ite,CEN+DYN)))
    return 1 if (e[1] and np.mean(e[1])<np.mean(e[0])*(1-MARGIN)) else 0
out=[]; elec=[f"{c}{y}" for c,y,_ in TARGETS if c!='euref']
for ko in elec:
    tr=df[(df.key!=ko)&(df.key!='euref2016')]; te=df[df.key==ko]
    pc=fp(tr,te,CEN); s=sel(tr,[k for k in elec if k!=ko]); pl=fp(tr,te,CEN+DYN); ch=pl if s else pc; a=te['t'].values
    out.append(dict(contest=ko,scheme='LOCO',used='+dyn' if s else 'census',base_r2=r2(a,pc),base_mae=mae(a,pc),final_r2=r2(a,ch),final_mae=mae(a,ch)))
eu=df[df.key=='euref2016'].reset_index(drop=True)
pc=np.array([fp(eu.drop(i),eu.iloc[[i]],CEN)[0] for i in range(len(eu))])
pl=np.array([fp(eu.drop(i),eu.iloc[[i]],CEN+DYN)[0] for i in range(len(eu))])
a=eu['t'].values; s=1 if mae(a,pl)<mae(a,pc)*(1-MARGIN) else 0; ch=pl if s else pc
out.append(dict(contest='euref2016',scheme='LOAO',used='+dyn' if s else 'census',base_r2=r2(a,pc),base_mae=mae(a,pc),final_r2=r2(a,ch),final_mae=mae(a,ch)))
R=pd.DataFrame(out)
print("\ncensus baseline vs census + dynamic-demography block (guarded):")
print(f"{'contest':15s}{'scheme':7s}{'chose':8s}{'base R2/MAE':>15}{'final R2/MAE':>16}")
for _,r in R.iterrows(): print(f"{r.contest:15s}{r.scheme:7s}{r.used:8s}{r.base_r2:7.3f}/{r.base_mae:4.2f}  {r.final_r2:7.3f}/{r.final_mae:4.2f}")
el=R[R.scheme=='LOCO']; e=R[R.contest=='euref2016'].iloc[0]
print(f"\nELECTIONS pooled MAE: base {el.base_mae.mean():.3f} -> final {el.final_mae.mean():.3f}")
print(f"EU-REF: base R2 {e.base_r2:.3f} -> final {e.final_r2:.3f} (chose {e.used})")
print(f"Any contest worse than baseline? {(R.final_mae>R.base_mae+1e-6).any()}")
# correlation of dynamics with the vote residual (do they carry ANY signal?)
for tcol,lab in [('assembly2022','Assembly 2022 nat')]:
    sub=df[df.key==tcol]
    print(f"\ncorr(cath_momentum, {lab} vote) = {np.corrcoef(sub['dyn__cath_moment'],sub['y'])[0,1]:+.2f}; corr(pop_growth,..) = {np.corrcoef(sub['dyn__pop_growth'],sub['y'])[0,1]:+.2f}")
R.to_csv(f"{os.path.dirname(__file__)}/dynamic_backtest_report.csv",index=False)
