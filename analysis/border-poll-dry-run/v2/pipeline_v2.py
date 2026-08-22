#!/usr/bin/env python3
"""v2 — poll-vs-reality CALIBRATED Border Poll projection.
Adds to v1 three reality anchors from the election/referendum corpus:
  (A) HOUSE EFFECT: LucidTalk bloc VI vs actual NI Assembly results
      (Mar/Aug 2022 polls vs May 2022) => LT understates the nationalist/
      pro-unity bloc by ~2.9 pts. Applied as a headline correction.
  (B) 2016 EU-REFERENDUM BACKTEST: aggregate 2011 community background to the
      18 constituencies, regress ACTUAL 2016 Remain% on it. Validates the
      geographic engine (R^2) and yields per-constituency residuals (the
      "beyond community background" constitutional lean).
  (C) Residual calibration: add the 2016 constituency residuals (scaled, as
      EU!=unity) to the 2011 Small-Area geography. NI total re-pinned to the
      house-corrected headline.
Still community-background-driven; DK a band; provenance=modelled.
"""
import csv, gzip, glob, json, os, math, re
from collections import defaultdict
SD="/tmp/claude-0/-home-user-civgraph/ea760a88-7de6-5e08-940a-d3a6d280325e/scratchpad"
REPO="/home/user/civgraph"
OUT=f"{SD}/out2"; os.makedirs(f"{OUT}/areas", exist_ok=True)
G=f"{REPO}/data/census/2011/census-2011-key-statistics-tables-statistical-geographies/All_Geographies_Code_Files"
def logit(p): p=min(max(p,1e-6),1-1e-6); return math.log(p/(1-p))
def inv(x): return 1/(1+math.exp(-x))

HOUSE_EFFECT=2.9       # pts LT understates nationalist bloc (mean of matched pairs); applied to decided-UI
RESID_SCALE=0.5        # EU-ref residuals are a proxy for unity lean -> down-weight

# ---- (B) 2016 backtest: build SA->constituency, regress actual Remain on Catholic% ----
sa2soa={r['SA']:r['SOA'] for r in csv.DictReader(open(f"{G}/NI_HIERARCHY.csv"))}
soa2aa={r['SOA']:r['AA'] for r in csv.DictReader(open(f"{G}/SOA_AA_HIERARCHY.csv"))}
aaname={r['CODE']:r['NAME'] for r in csv.DictReader(open(f"{G}/Assembly_Areas_(AA).csv"))}
sa_rows=[]  # (sa, pop, cath, aa)
for r in csv.DictReader(open(f"{REPO}/data/census/derived/census-2011-sa.csv")):
    sa=r['SA2011']; pop=float(r['AllUsualResidents'] or 0)
    c=float(r['Catholic_background_pct'] or 0)/100; p=float(r['Protestant_background_pct'] or 0)/100
    aa=soa2aa.get(sa2soa.get(sa,''),'')
    sa_rows.append((sa,pop,c,p,max(0,1-c-p),aa))
con_c=defaultdict(float); con_p=defaultdict(float)
for sa,pop,c,p,o,aa in sa_rows:
    if aa: con_c[aa]+=pop*c; con_p[aa]+=pop*p
con_cath={a:con_c[a]/con_p_tot for a,con_p_tot in [(a,con_c[a]+con_p[a]+ (0)) for a in con_c]}  # placeholder
con_pop=defaultdict(float)
for sa,pop,c,p,o,aa in sa_rows:
    if aa: con_pop[aa]+=pop
con_cathpct={a:con_c[a]/con_pop[a]*100 for a in con_pop}
d16=json.load(open(f"{REPO}/render/metadata/elections-test2/northern-ireland-referendum__2016-06-23-eu-membership.json"))
name2code={v:k for k,v in aaname.items()}
remain={}
for r in d16['results']:
    rem=r['leadingPct'] if r.get('winnerParty')=='Remain' else 100-r['leadingPct']
    code=name2code.get(r['constituency'])
    if code: remain[code]=rem
xs=[con_cathpct[a] for a in remain]; ys=[remain[a] for a in remain]; n=len(xs)
mx=sum(xs)/n; my=sum(ys)/n
b=sum((x-mx)*(y-my) for x,y in zip(xs,ys))/sum((x-mx)**2 for x in xs); a0=my-b*mx
r2=1-sum((y-(a0+b*x))**2 for x,y in zip(xs,ys))/sum((y-my)**2 for y in ys)
resid={aa: remain[aa]-(a0+b*con_cathpct[aa]) for aa in remain}   # per-constituency residual

# ---- poll unity rates (as v1) ----
def is_dk(r): return "DON'T KNOW" in r.upper() or 'UNDECIDED' in r.upper()
def tests(code):
    return ((lambda r:'LEAVE' in r.upper(),lambda r:'REMAIN' in r.upper()) if '2016' in code
            else (lambda r:'UNITED IRELAND' in r.upper(),lambda r:'UNITED KINGDOM' in r.upper()))
POLLS={"2016-09__LTSeptTrackerPollResults-MainReport":("Sep 2016","2016-09","2011"),
 "2021-01-spreadsheet":("Jan 2021","2021-01","2021"),"2021-05-spreadsheet":("May 2021","2021-05","2021"),
 "2022-08-spreadsheet":("Aug 2022","2022-08","2021"),"2024-02-spreadsheet":("Feb 2024","2024-02","2021"),
 "2025-02-spreadsheet":("Feb 2025","2025-02","2021")}
viM=re.compile(r'(how would you vote|would you vote)',re.I); ctx=re.compile(r'border poll|referendum|constitutional position',re.I)
def grp(c):
    c=c.lower()
    if 'catholic' in c and 'mixed' not in c: return 'C'
    if 'protestant' in c and 'mixed' not in c: return 'P'
    if 'no religion' in c or c.strip()=='none': return 'O'
def poll_rates(code):
    is_ui,is_uk=tests(code)
    byM=defaultdict(list); hasui=defaultdict(bool)
    for row in csv.DictReader(gzip.open(f"{SD}/lt/{code}.csv.gz",'rt')):
        if viM.search(row['Measure']) and ctx.search(row['Measure']) and (is_ui(row['Response']) or is_uk(row['Response']) or is_dk(row['Response'])):
            byM[row['Measure']].append(row)
            if is_ui(row['Response']): hasui[row['Measure']]=True
    m=max((k for k in byM if hasui[k]),key=lambda k:len(byM[k])); rows=byM[m]
    def val(dim,cat,t):
        v=[float(r['Value']) for r in rows if r['Breakdown Dimension']==dim and r['Breakdown Category']==cat and r['Unit']=='%' and t(r['Response'])]
        return v[0] if v else None
    hUI,hUK,hDK=val('Total','Total',is_ui),val('Total','Total',is_uk),val('Total','Total',is_dk)
    gr={}
    for c in set(r['Breakdown Category'] for r in rows if r['Breakdown Dimension']=='Religion'):
        g=grp(c);
        if not g: continue
        ui,uk=val('Religion',c,is_ui),val('Religion',c,is_uk)
        if ui and uk: gr.setdefault(g,ui/(ui+uk))
    return hUI,hUK,hDK,gr

# ---- 2021 DZ composition ----
dzc=defaultdict(lambda:defaultdict(float)); dzl={}
for r in csv.DictReader(gzip.open(f"{SD}/dz_relig.csv.gz",'rt')):
    code=r['Census 2021 Data Zone Code']; dzl[code]=r['Census 2021 Data Zone Label']
    lab=r['Religion or Religion Brought Up In Label'].lower()
    g='C' if lab.startswith('catholic') else 'P' if lab.startswith('protestant') else 'O'
    dzc[code][g]+=float(r['Count'] or 0)
dz=[(c,dzl[c],sum(g.values()),{k:g[k]/sum(g.values()) for k in 'CPO'}) for c,g in dzc.items() if sum(g.values())>0]
sa=[(s,'',pop,{'C':c,'P':p,'O':o},aa) for s,pop,c,p,o,aa in sa_rows]

def project(code,label,month,era):
    hUI,hUK,hDK,gr=poll_rates(code)
    gr.setdefault('O',0.40); gr.setdefault('C',0.85); gr.setdefault('P',0.09)
    # v1 target (poll decided) and v2 target (house-corrected)
    if hUI and hUK: t1=hUI/(hUI+hUK)
    else:
        num=sum(pop*sum(comp[g]*gr[g] for g in 'CPO') for _,_,pop,comp,*_ in (sa if era=='2011' else [(a,b,c,d) for a,b,c,d in dz]));
        den=sum(pop for _,_,pop,*_ in (sa if era=='2011' else dz)); t1=num/den
    t2=min(0.99,t1+HOUSE_EFFECT/100.0)
    areas=sa if era=='2011' else [(c,l,pop,comp,None) for c,l,pop,comp in dz]
    den=sum(pop for _,_,pop,_,_ in areas)
    def ni(delta):
        return sum(pop*sum(comp[g]*inv(logit(gr[g])+delta) for g in 'CPO') for _,_,pop,comp,_ in areas)/den
    lo,hi=-8,8
    for _ in range(60):
        mid=(lo+hi)/2
        if ni(mid)<t2: lo=mid
        else: hi=mid
    delta=(lo+hi)/2; grc={g:inv(logit(gr[g])+delta) for g in 'CPO'}
    rows=[]
    for c,l,pop,comp,aa in areas:
        ui=sum(comp[g]*grc[g] for g in 'CPO')
        if era=='2011' and aa in resid: ui=min(0.999,max(0.001, ui+RESID_SCALE*resid[aa]/100.0))
        rows.append((c,l,pop,comp['C'],comp['P'],comp['O'],ui))
    # re-pin NI to t2 after residuals (small)
    cur=sum(pop*ui for _,_,pop,_,_,_,ui in rows)/den; adj=t2-cur
    rows=[(c,l,pop,cc,pp,oo,min(0.999,max(0.001,ui+adj))) for c,l,pop,cc,pp,oo,ui in rows]
    uis=sorted(r[6] for r in rows)
    with open(f"{OUT}/areas/{month}_{'SA2011' if era=='2011' else 'DZ21'}.csv","w",newline='') as fh:
        w=csv.writer(fh); w.writerow(['code','label','pop','C','P','O','UI_v2','prov'])
        for r in rows: w.writerow([r[0],r[1],int(r[2]),round(r[3]*100,1),round(r[4]*100,1),round(r[5]*100,1),round(r[6]*100,1),'modelled'])
    return dict(label=label,month=month,geo=('SA2011' if era=='2011' else 'DZ21'),n=len(rows),
        ui_v1=round(t1*100,1), ui_v2=round(t2*100,1), DK=hDK,
        med=round(uis[len(uis)//2]*100,1), p10=round(uis[len(uis)//10]*100,1), p90=round(uis[9*len(uis)//10]*100,1),
        mn=round(uis[0]*100,1), mx=round(uis[-1]*100,1), maj=round(100*sum(1 for u in uis if u>0.5)/len(uis),1))

print("="*78)
print(f"v2 CALIBRATION ANCHORS")
print(f"  2016 EU-ref backtest:  Remain% = {a0:.1f} + {b:.3f}·Catholic%   R²={r2:.3f}  (18 constituencies)")
print(f"  house effect (LT understates nationalist bloc): +{HOUSE_EFFECT} pts -> applied to unity headline")
print(f"  residual scale (EU→unity proxy): {RESID_SCALE}")
print("="*78)
res=[project(c,*m) for c,m in POLLS.items()]
print(f"\n{'poll':9s} {'geo':7s} {'UI v1':>6} {'UI v2':>6} {'Δ':>5} | {'min':>5}{'p10':>6}{'med':>6}{'p90':>6}{'max':>6} | maj%")
for s in res:
    print(f"{s['label']:9s} {s['geo']:7s} {s['ui_v1']:6.1f} {s['ui_v2']:6.1f} {s['ui_v2']-s['ui_v1']:+5.1f} | {s['mn']:5.1f}{s['p10']:6.1f}{s['med']:6.1f}{s['p90']:6.1f}{s['mx']:6.1f} | {s['maj']}")
json.dump(dict(backtest={'intercept':a0,'slope':b,'r2':r2,'residuals':{aaname[k]:round(v,1) for k,v in resid.items()}},
              house_effect=HOUSE_EFFECT, results=res), open(f"{OUT}/summary_v2.json","w"), indent=1)
