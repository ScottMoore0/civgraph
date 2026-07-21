#!/usr/bin/env python3
"""Census-shape backtest for the PRE-NILT era: does the 1991 census community-background gradient
predict the nationalist vote across NI's 26 legacy Local Government Districts in the 1989, 1993 and
1997 local elections? This is the shape half of the pipeline (no survey needed), extended back to
1989 on the era-matched geography (26 districts) and era-matched census (1991), which the existing
2014-2024 backtest never reached.

Catholic% by district is extracted from the 1991 Census Religion Report (Table 2, Roman Catholic
per cent). Nationalist vote share = (SDLP + Sinn Fein first-prefs) / all first-prefs per district."""
import json, glob, os, re, collections
import numpy as np

# 1991 Census Religion Report Table 2 (Roman Catholic %) by the 26 LGDs.
# Sourced from the parsed structured table (scripts/parse_1991_religion_lgd.py, validated:
# parsed RC% == this literal, exactly). The literal is retained as a standalone fallback.
_CATH91_LITERAL={'antrim':31.7,'ards':11.3,'armagh':45.4,'ballymena':18.3,'ballymoney':30.2,'banbridge':27.6,
 'belfast':39.0,'carrickfergus':6.9,'castlereagh':9.4,'coleraine':22.4,'cookstown':53.2,'craigavon':40.1,
 'derry':69.5,'down':56.0,'dungannon':55.7,'fermanagh':54.9,'larne':22.1,'limavady':51.7,'lisburn':26.9,
 'magherafelt':58.9,'moyle':52.2,'newry and mourne':71.8,'newtownabbey':13.0,'north down':9.0,
 'omagh':64.3,'strabane':61.8}
def _load_cath91():
    import csv
    for p in ('data/census/derived/religion-1991-lgd.csv',
              os.path.join(os.path.dirname(__file__), '../../../../data/census/derived/religion-1991-lgd.csv')):
        if os.path.exists(p):
            d={r['lgd'].lower():float(r['catholic_pct']) for r in csv.DictReader(open(p))
               if r['lgd']!='NORTHERN IRELAND'}
            if len(d)==26: return d
    return _CATH91_LITERAL
CATH91=_load_cath91()
def norm(s):
    s=str(s).lower().strip()
    s=s.replace('londonderry','derry').replace('city of ','').replace('&','and')
    s=re.sub(r'\s+',' ',s)
    return s
def bloc(party):
    p=str(party).lower()
    if 'sdlp' in p or 'social democratic' in p or 'sinn' in p or 'irish independence' in p: return 'nat'
    return 'oth'

files={1989:'local-government-local-government-districts__1989-05-17.json',
       1993:'local-government-local-government-districts__1993-05-19.json',
       1997:'local-government-local-government-districts__1997-05-21.json'}
BASE='test/metadata/elections-test2'
rows=[]
for yr,fn in files.items():
    p=os.path.join(BASE,fn)
    if not os.path.exists(p): print(f"[{yr}] missing"); continue
    d=json.load(open(p))
    agg=collections.defaultdict(lambda:collections.defaultdict(float))
    for r in d.get('results',[]):
        for c in (r.get('candidates') or []):
            lb=norm(c.get('localBody') or c.get('district') or r.get('localBody') or '')
            fp=c.get('firstPrefs') or 0
            if lb: agg[lb][bloc(c.get('party'))]+=fp
    for lb,b in agg.items():
        tot=b['nat']+b['oth']
        if tot<500: continue
        if lb not in CATH91:
            # try loose match
            m=[k for k in CATH91 if k in lb or lb in k]
            if len(m)==1: lb=m[0]
            else: continue
        rows.append({'year':yr,'district':lb,'cath91':CATH91[lb],'nat_pct':100*b['nat']/tot,'votes':tot})
import pandas as pd
df=pd.DataFrame(rows)
print(f"matched {df['district'].nunique()} districts across {sorted(df['year'].unique())} ({len(df)} district-contests)\n")
# per-year and pooled correlation of nationalist vote with 1991 Catholic background
for yr in sorted(df['year'].unique()):
    s=df[df.year==yr]
    r=np.corrcoef(s['cath91'],s['nat_pct'])[0,1]
    print(f"  {yr} local: r(1991 Catholic%, nationalist vote%) = {r:+.3f}   (n={len(s)} districts)")
r_all=np.corrcoef(df['cath91'],df['nat_pct'])[0,1]
print(f"  POOLED: r = {r_all:+.3f}  (R2={r_all**2:.3f}, n={len(df)})")
# shape skill: predict nationalist% from Catholic% (level removed per year), report MAE
df['yhat']=np.nan
for yr in df['year'].unique():
    m=df.year==yr; x=df.loc[m,'cath91']; y=df.loc[m,'nat_pct']
    b1=np.polyfit(x,y,1); df.loc[m,'yhat']=np.polyval(b1,x)
mae=np.mean(np.abs(df['nat_pct']-df['yhat']))
print(f"\n  within-year linear fit (Catholic%% -> nationalist%%): MAE = {mae:.1f} pts")
print(f"  slope pooled ~ {np.polyfit(df['cath91'],df['nat_pct'],1)[0]:.2f} nat-pts per Catholic-pt")
# biggest residuals (where community background under/over-predicts the nationalist vote)
df['resid']=df['nat_pct']-df['yhat']
print("\n  largest positive residuals (more nationalist than 1991 religion predicts):")
for _,x in df.reindex(df['resid'].abs().sort_values(ascending=False).index).head(5).iterrows():
    print(f"    {x['district']:16s} {int(x['year'])}  Cath {x['cath91']:.0f}%  nat {x['nat_pct']:.0f}%  resid {x['resid']:+.0f}")
df.round(2).to_csv("analysis/border-poll-dry-run/v9/hist/backtest_councils_1989.csv",index=False)
print("\nwrote backtest_councils_1989.csv")
