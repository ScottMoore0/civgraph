#!/usr/bin/env python3
"""v10 — multi-axis temporal projection. Keeps v9's rich static geography (88-attr
ridge, averaged over dates), and replaces v9's religion-only temporal component with
a between-poll delta averaged across FIVE measured subgroup dimensions the polls
report: religion, age, gender, social grade, region. So two Data Zones with the same
static level but different age/region/social-grade composition now change by different
amounts between polls (multi-axis), driven by the polls' measured subgroup movements."""
import csv, json, glob, os, re
import pandas as pd, numpy as np
V=os.path.dirname(os.path.abspath(__file__))  # was a hardcoded /home/user path from another environment
SP=os.environ.get("SCRATCHPAD", V)  # dz_region.json etc. live alongside this script
DATES=['2021-01','2022-08','2024-02','2025-02']
OUTLVL={r['date']:r['output_ni'] for r in json.load(open(f"{V}/summary_output.json"))['results']}

# ---------- 1. static shape S_DZ = mean of v9 per-date projection ----------
areas={d:pd.read_csv(f"{V}/areas_output/{d}_DZ21.csv").set_index('DZ21')['proj_unity_pct'] for d in DATES}
S=pd.concat(areas,axis=1).mean(axis=1)                      # date-invariant rich geography
feat=pd.read_csv(f"{V}/dz_features.csv").set_index('area')
pop=pd.read_csv(os.path.join(V, "..", "..", "..", "data", "census", "derived", "ms-a01-dz.csv")).set_index('GeographyCode')['AllUsualResidents']
pop=pop.reindex(S.index).fillna(0)
region=json.load(open(f"{SP}/dz_region.json"))

# ---------- 2. poll rates by (dim,cat,date), harmonised ----------
def is_ui(s):return 'united ireland' in s.lower()
def is_uk(s):return 'united kingdom' in s.lower()
REG={'belfast':'Belfast','east':'East','north':'North','south':'South','west':'West'}
def coarse_age(cat):
    n=re.findall(r'(\d+)',cat)
    if not n: return None
    lo=int(n[0])
    if lo<25:return '18-24'
    if lo<45:return '25-44'
    if lo<65:return '45-64'
    return '65+'
def poll_rates(path):
    r=list(csv.DictReader(open(path)))
    from collections import defaultdict
    resp=defaultdict(set)
    for x in r: resp[x['Measure']].add(x['Response'])
    m=[mm for mm,rs in resp.items() if any(is_ui(s) for s in rs) and any(is_uk(s) for s in rs)][0]
    cell=defaultdict(lambda:{'ui':None,'uk':None})
    for x in r:
        if x['Measure']!=m or x['Statistic']!='percent': continue
        dim=x['Breakdown Dimension']; cat=x['Breakdown Category']
        if cat.lower() in REG: dim,cat='Region',REG[cat.lower()]
        if is_ui(x['Response']): cell[(dim,cat)]['ui']=float(x['Value'])
        elif is_uk(x['Response']): cell[(dim,cat)]['uk']=float(x['Value'])
    dec={}
    for (dim,cat),v in cell.items():
        if v['ui'] and v['uk']: dec[(dim,cat)]=100*v['ui']/(v['ui']+v['uk'])
    # harmonise into dim -> {cat: rate}
    out={'Religion':{},'Age':{},'Gender':{},'SocialGrade':{},'Region':{}}
    agebuf={}
    for (dim,cat),val in dec.items():
        if dim=='Religion':
            g='C' if cat.startswith('Catholic') else 'P' if cat.startswith('Protestant') else 'O'
            out['Religion'][g]=val
        elif dim=='Age':
            cb=coarse_age(cat)
            if cb: agebuf.setdefault(cb,[]).append(val)
        elif dim=='Gender': out['Gender'][cat]=val
        elif dim=='SocialGrade' and cat in ('ABC1','C2DE'): out['SocialGrade'][cat]=val
        elif dim=='Region' and cat in REG.values(): out['Region'][cat]=val
    out['Age']={k:np.mean(v) for k,v in agebuf.items()}
    return out
PR={d:poll_rates(f"{SP}/sp_{d}.csv") for d in DATES}
# reference = mean over dates, per (dim,cat)
DIMS=['Religion','Age','Gender','SocialGrade','Region']
REF={dim:{} for dim in DIMS}
for dim in DIMS:
    cats=set().union(*[set(PR[d][dim]) for d in DATES])
    for c in cats:
        vals=[PR[d][dim][c] for d in DATES if c in PR[d][dim]]
        if vals: REF[dim][c]=np.mean(vals)

# ---------- 3. DZ composition per dimension (shares, 0-1) ----------
def col(name): return feat[name].reindex(S.index).fillna(0).values/100
comp={}
# religion
comp['Religion']={'C':col('rel__Catholic'),
  'P':col([c for c in feat.columns if c.startswith('rel__Protestant')][0]),
  'O':col('rel__Other religions')+col('rel__None')}
# age -> coarse (voting age)
comp['Age']={'18-24':col('age__16-24 years'),
  '25-44':col('age__25-34 years')+col('age__35-44 years'),
  '45-64':col('age__45-54 years')+col('age__55-64 years'),
  '65+':col('age__65+ years')}
# gender
comp['Gender']={'Male':col('sex__Male'),'Female':col('sex__Female')}
# social grade from NS-SEC
abc1=[c for c in feat.columns if c.startswith(('nssec__L1,','nssec__L4,','nssec__L7'))]
c2de=[c for c in feat.columns if c.startswith(('nssec__L8,','nssec__L10','nssec__L12','nssec__L13','nssec__L14'))]
comp['SocialGrade']={'ABC1':sum(col(c) for c in abc1),'C2DE':sum(col(c) for c in c2de)}
# region (indicator) - DZ->constituency->LucidTalk region (dz_region.json, PC2008-based)
comp['Region']={rg:np.array([1.0 if region.get(dz)==rg else 0.0 for dz in S.index]) for rg in ['Belfast','East','North','South','West']}
# renormalise each dim's shares to sum to 1 per DZ
for dim in DIMS:
    tot=sum(comp[dim].values()); tot=np.where(tot>0,tot,1)
    comp[dim]={c:v/tot for c,v in comp[dim].items()}

# ---------- 4. temporal delta per date, averaged across dimensions ----------
def dim_expect(dim,rates):
    e=np.zeros(len(S)); w=np.zeros(len(S))
    for c,share in comp[dim].items():
        if c in rates: e+=share*rates[c]; w+=share
    return np.where(w>0,e/w,np.nan)
proj={}; deltas={}
for d in DATES:
    ds=[]
    for dim in DIMS:
        et=dim_expect(dim,PR[d][dim]); er=dim_expect(dim,REF[dim])
        ds.append(et-er)
    D=np.nanmean(np.vstack(ds),axis=0)
    U=S.values+D
    U=U+(OUTLVL[d]-np.average(U,weights=pop.values))       # re-centre to output level
    proj[d]=np.clip(U,1,99); deltas[d]=D

# ---------- 5. write + verify ----------
os.makedirs(f"{V}/areas_multiaxis",exist_ok=True)
cath=col('rel__Catholic')*100
for d in DATES:
    with open(f"{V}/areas_multiaxis/{d}_DZ21.csv","w",newline='') as fh:
        w=csv.writer(fh); w.writerow(['DZ21','catholic_bg_pct','proj_unity_pct','provenance'])
        for a,cc,uu in zip(S.index,cath.round(1),proj[d].round(1)): w.writerow([a,cc,uu,'modelled'])
M=pd.DataFrame(proj,index=S.index)
print("Rank correlation between consecutive dates (was 1.000 in v9):")
for i in range(len(DATES)-1):
    print(f"  {DATES[i]} vs {DATES[i+1]}: {M[DATES[i]].corr(M[DATES[i+1]],method='spearman'):.4f}")
print("\nDoes the CHANGE now vary by non-religion axes? corr(delta, region/age share):")
ch=M[DATES[-1]]-M[DATES[0]]
for dim,cats in [('Region',['West','East']),('Age',['18-24'])]:
    for c in cats:
        s=comp[dim][c]; print(f"  corr(2021->2025 change, {dim}:{c} share) = {np.corrcoef(ch.values,s)[0,1]:+.2f}")
print("\nNI levels (pop-wtd):",{d:round(float(np.average(proj[d],weights=pop.values)),1) for d in DATES})
json.dump({'method':'v10 multi-axis temporal: v9 static geography + between-poll delta averaged over religion/age/gender/social-grade/region measured crosstabs','dims':DIMS,
  'ni':{d:round(float(np.average(proj[d],weights=pop.values)),1) for d in DATES}},open(f"{V}/summary_multiaxis.json","w"),indent=1)
