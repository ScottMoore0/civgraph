#!/usr/bin/env python3
"""v4 stage 2 (vectorised): poststratify NILT-MRP onto DZ religion×age frame,
blend with LucidTalk (house-corrected); per-date DZ maps + demographic breakdowns."""
import pickle, gzip, csv, json, math, os, glob, numpy as np
from collections import defaultdict
SD="/tmp/claude-0/-home-user-civgraph/ea760a88-7de6-5e08-940a-d3a6d280325e/scratchpad"
REPO="/home/user/civgraph"
OUT=f"{SD}/out4"; os.makedirs(f"{OUT}/areas",exist_ok=True); os.makedirs(f"{OUT}/breakdowns",exist_ok=True)
M=pickle.load(open(f"{SD}/mrp_model.pkl","rb")); clf=M['clf']; enc=M['enc']; ra=M['ra']; ageoh=M['ageoh']
AGES=['18-24','25-34','35-44','45-54','55-64','65+']; GRPS=['Catholic','Protestant','Other/None']
SEXW={'Male':0.49,'Female':0.51}; YEARS=[2021,2022,2024,2025]
def _p(g,a,s,year):
    xc=enc.transform([[g,a,s]])[0]; rm=ra.transform([[g]])[0]; am=ageoh.transform([[a]])[0]
    it=[rm[i]*am[j] for i in range(len(rm)) for j in range(len(am))]
    return clf.predict_proba(np.concatenate([xc,[year-2022],it]).reshape(1,-1))[0,1]
PRED={}; CELL={}   # precompute 3*6*2*4 predictions once
for y in YEARS:
    for g in GRPS:
        for a in AGES:
            for s in ('Male','Female'): PRED[(g,a,s,y)]=_p(g,a,s,y)
            CELL[(g,a,y)]=SEXW['Male']*PRED[(g,a,'Male',y)]+SEXW['Female']*PRED[(g,a,'Female',y)]
def logit(p): p=min(max(p,1e-6),1-1e-6); return math.log(p/(1-p))
def inv(x): return 1/(1+math.exp(-x))
def cage(l):
    l=l.lower()
    if '0-15' in l: return None
    if '16-24' in l: return '18-24'
    for b in ('25-34','35-44','45-54','55-64'):
        if b in l: return b
    return '65+'
def cgrp(l):
    l=l.lower(); return 'Catholic' if l.startswith('catholic') else 'Protestant' if l.startswith('protestant') else 'Other/None'

# DZ religion×age voting-age frame
dz=defaultdict(lambda: defaultdict(float)); dzlab={}; dzcath=defaultdict(float); ni_cell=defaultdict(float)
for r in csv.DictReader(gzip.open(f"{SD}/dzassoc_AGE_BAND_AGG7_A.csv.gz",'rt')):
    a=cage(r['Age - 7 Categories A Label'])
    if a is None: continue
    g=cgrp(r['Religion or Religion Brought Up In Label']); n=float(r['Count'] or 0); code=r['Census 2021 Data Zone Code']
    dzlab[code]=r['Census 2021 Data Zone Label']; dz[code][(g,a)]+=n; ni_cell[(g,a)]+=n
    if g=='Catholic': dzcath[code]+=n
# preload attribute crosstabs
XT={}
for f in glob.glob(f"{SD}/xtab/*.csv.gz"):
    comp=defaultdict(lambda: defaultdict(float))
    for r in csv.DictReader(gzip.open(f,'rt')):
        c=list(r.values()); comp[c[3]][cgrp(c[5])]+=float(c[6] or 0)
    XT[os.path.basename(f)[:-7]]=comp
lt=json.load(open(f"{REPO}/analysis/border-poll-dry-run/v3/lucidtalk_unity_rates.json")); HOUSE=2.9
DATES=[("2021-01",2021),("2022-08",2022),("2024-02",2024),("2025-02",2025)]

def ni_at(shift,year):
    n=d=0
    for (g,a),c in ni_cell.items(): n+=c*inv(logit(CELL[(g,a,year)])+shift); d+=c
    return n/d*100
summary=[]
for date,year in DATES:
    nilt_ni=ni_at(0,year)
    lt_ni=(lt[date]['decided']+HOUSE) if lt.get(date) and lt[date].get('decided') else None
    blend=round((nilt_ni+lt_ni)/2,1) if lt_ni else round(nilt_ni,1)
    lo,hi=-6,6
    for _ in range(50):
        m=(lo+hi)/2; lo,hi=(m,hi) if ni_at(m,year)<blend else (lo,m)
    shift=(lo+hi)/2
    uis=[]
    with open(f"{OUT}/areas/{date}_DZ21.csv","w",newline='') as fh:
        w=csv.writer(fh); w.writerow(['DZ21','label','catholic_bg_pct','proj_unity_pct','provenance'])
        for code,cells in dz.items():
            tot=sum(cells.values())
            if tot<=0: continue
            u=sum(c*inv(logit(CELL[(g,a,year)])+shift) for (g,a),c in cells.items())/tot*100
            uis.append(u); w.writerow([code,dzlab[code],round(dzcath[code]/tot*100,1),round(u,1),'modelled'])
    uis.sort()
    # calibrated religion-marginal rates
    rr={}
    for g in GRPS:
        num=den=0
        for a in AGES: c=ni_cell[(g,a)]; num+=c*inv(logit(CELL[(g,a,year)])+shift); den+=c
        rr[g]=num/den
    agerate={}
    for a in AGES:
        num=den=0
        for g in GRPS: c=ni_cell[(g,a)]; num+=c*inv(logit(CELL[(g,a,year)])+shift); den+=c
        agerate[a]=round(num/den*100,1)
    sexrate={}
    for s in ('Male','Female'):
        num=den=0
        for g in GRPS:
            for a in AGES: c=ni_cell[(g,a)]; num+=c*inv(logit(PRED[(g,a,s,year)])+shift); den+=c
        sexrate[s]=round(num/den*100,1)
    bd={'CommunityBackground':{g:round(rr[g]*100,1) for g in GRPS},'Age':agerate,'Sex':sexrate}
    for attr,comp in XT.items():
        res={}
        for k,gc in comp.items():
            t=sum(gc.values())
            if t>0: res[k]=round(sum(gc[g]/t*rr[g] for g in GRPS)*100,1)
        bd[attr]=res
    json.dump(bd, open(f"{OUT}/breakdowns/{date}_breakdown.json","w"), indent=1)
    summary.append(dict(date=date,year=year,nilt_mrp_ni=round(nilt_ni,1),lt_corrected=round(lt_ni,1) if lt_ni else None,
        blend=blend, dz_min=round(uis[0],1),dz_p10=round(uis[len(uis)//10],1),dz_med=round(uis[len(uis)//2],1),
        dz_p90=round(uis[9*len(uis)//10],1),dz_max=round(uis[-1],1),maj=round(100*sum(1 for u in uis if u>50)/len(uis),1),
        relig={g:round(rr[g]*100,1) for g in GRPS}, age=agerate, sex=sexrate))
json.dump(summary, open(f"{OUT}/summary.json","w"), indent=1)
print("date      NILT-MRP  LT+2.9  BLEND | DZ p10–med–p90  maj% | Cath Prot Oth | 18-24..65+")
for s in summary:
    a=s['age']
    print(f"{s['date']}   {s['nilt_mrp_ni']:6.1f}  {s['lt_corrected']:6.1f}  {s['blend']:5.1f} | {s['dz_p10']:.0f}–{s['dz_med']:.0f}–{s['dz_p90']:.0f}  {s['maj']:5.0f} | {s['relig']['Catholic']:.0f}  {s['relig']['Protestant']:.0f}  {s['relig']['Other/None']:.0f} | {a['18-24']:.0f} {a['25-34']:.0f} {a['35-44']:.0f} {a['45-54']:.0f} {a['55-64']:.0f} {a['65+']:.0f}")
