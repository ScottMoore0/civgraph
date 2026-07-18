#!/usr/bin/env python3
"""DRY RUN: project United Ireland (Border Poll) referendum results to
Small Area (2011) / Data Zone (2021), broken down by all census demographics,
one week after each LucidTalk unity-VI poll.

Method (transparent dry run):
  1. From each LucidTalk poll's Religion crosstab, derive the DECIDED unity
     share per community-background group g: rate_g = UI_g/(UI_g+UK_g).
  2. Poststratify onto census community-background composition per area:
       UI_decided(area) = Σ_g comp_g(area)·rate_g
  3. Calibrate: single logit shift so the population-weighted NI decided-UI
     equals the poll's NI headline decided-UI (rake to the observed marginal).
  4. Demographic breakdowns: for every 2021 census attribute A with cats k,
     UI(k) = Σ_g P(g|k)·rate_g  using NISRA religion×A crosstabs.
Community background is the dominant driver; this dry run models it explicitly
and uses the census for the geographic + demographic distribution. DK reported
as a band. Small-area/DZ estimates are model-carried (no sub-constituency
ground truth) — flagged provenance=modelled.
"""
import csv, gzip, glob, json, os, math, re
from collections import defaultdict

SD="/tmp/claude-0/-home-user-civgraph/ea760a88-7de6-5e08-940a-d3a6d280325e/scratchpad"
REPO="/home/user/civgraph"
OUT=f"{SD}/out"; os.makedirs(OUT, exist_ok=True)
os.makedirs(f"{OUT}/areas", exist_ok=True)
os.makedirs(f"{OUT}/breakdowns", exist_ok=True)

def logit(p): p=min(max(p,1e-6),1-1e-6); return math.log(p/(1-p))
def inv(x): return 1/(1+math.exp(-x))

# ---------------------------------------------------------------- poll rates
# Re-extract UI/UK by religion + headline for each unity-VI poll.
def is_dk(r): return "DON'T KNOW" in r.upper() or 'UNDECIDED' in r.upper()
def make_tests(code):
    # 2021+ spreadsheet polls: responses are "Part of a UNITED IRELAND"/"...UNITED KINGDOM".
    # 2016 tracker: the border-poll VI uses REMAIN (in UK) / LEAVE (the UK) = united Ireland.
    if '2016' in code:
        return (lambda r:'LEAVE' in r.upper(), lambda r:'REMAIN' in r.upper())
    return (lambda r:'UNITED IRELAND' in r.upper(), lambda r:'UNITED KINGDOM' in r.upper())

POLL_META={  # code -> (label, iso poll month, census era, "one week after" ref)
 "2016-09__LTSeptTrackerPollResults-MainReport": ("Sep 2016","2016-09","2011"),
 "2021-01-spreadsheet": ("Jan 2021","2021-01","2021"),
 "2021-05-spreadsheet": ("May 2021","2021-05","2021"),
 "2022-08-spreadsheet": ("Aug 2022","2022-08","2021"),
 "2024-02-spreadsheet": ("Feb 2024","2024-02","2021"),
 "2025-02-spreadsheet": ("Feb 2025","2025-02","2021"),
}
viM=re.compile(r'(how would you vote|would you vote)', re.I)
ctx=re.compile(r'border poll|referendum|constitutional position', re.I)

def cat_group(c):
    c=c.lower()
    if 'catholic' in c and 'mixed' not in c: return 'C'
    if 'protestant' in c and 'mixed' not in c: return 'P'
    if 'no religion' in c or c.strip()=='none': return 'O'
    return None  # skip mixed/other/pnts for rate estimation (small/ambiguous)

polls={}
for code,(label,month,era) in POLL_META.items():
    f=f"{SD}/lt/{code}.csv.gz"
    is_ui,is_uk=make_tests(code)
    byM=defaultdict(list); has_ui=defaultdict(bool)
    with gzip.open(f,'rt') as fh:
        for row in csv.DictReader(fh):
            if viM.search(row['Measure']) and ctx.search(row['Measure']) and (is_ui(row['Response']) or is_uk(row['Response']) or is_dk(row['Response'])):
                byM[row['Measure']].append(row)
                if is_ui(row['Response']): has_ui[row['Measure']]=True
    # only measures that actually carry a unity ("United Ireland"/"Leave") response
    cand={k:v for k,v in byM.items() if has_ui[k]}
    m=max(cand,key=lambda k:len(cand[k]))
    rows=byM[m]
    def val(dim,cat,test):
        v=[float(r['Value']) for r in rows if r['Breakdown Dimension']==dim and r['Breakdown Category']==cat and r['Unit']=='%' and test(r['Response'])]
        return v[0] if v else None
    # headline
    hUI,hUK,hDK=val('Total','Total',is_ui),val('Total','Total',is_uk),val('Total','Total',is_dk)
    if hUI is None:  # 2016 has only religion crosstab, no Total row -> derive later
        hUI=hUK=None
    # group rates (decided UI share)
    relcats=sorted(set(r['Breakdown Category'] for r in rows if r['Breakdown Dimension']=='Religion'))
    grate={}
    for c in relcats:
        g=cat_group(c)
        if not g: continue
        ui=val('Religion',c,is_ui); uk=val('Religion',c,is_uk)
        if ui and uk and (ui+uk)>0: grate.setdefault(g, ui/(ui+uk))
    polls[code]=dict(label=label,month=month,era=era,measure=m[:80],
                     hUI=hUI,hUK=hUK,hDK=hDK,grate=grate,rows=rows,val=None)

# ---------------------------------------------------------------- census frames
# 2011 SA composition (Catholic/Protestant background %, Other=residual)
sa=[]
with open(f"{REPO}/data/census/derived/census-2011-sa.csv") as fh:
    for r in csv.DictReader(fh):
        pop=float(r['AllUsualResidents'] or 0)
        c=float(r['Catholic_background_pct'] or 0)/100
        p=float(r['Protestant_background_pct'] or 0)/100
        o=max(0.0,1-c-p)
        sa.append((r['SA2011'], r['Geography'], pop, {'C':c,'P':p,'O':o}))

# 2021 DZ composition from community background counts
dz_counts=defaultdict(lambda: defaultdict(float)); dz_label={}
with gzip.open(f"{SD}/dz_relig.csv.gz",'rt') as fh:
    for r in csv.DictReader(fh):
        code=r['Census 2021 Data Zone Code']; dz_label[code]=r['Census 2021 Data Zone Label']
        lab=r['Religion or Religion Brought Up In Label'].lower()
        cnt=float(r['Count'] or 0)
        g='C' if lab.startswith('catholic') else 'P' if lab.startswith('protestant') else 'O'
        dz_counts[code][g]+=cnt
dz=[]
for code,g in dz_counts.items():
    tot=sum(g.values())
    if tot<=0: continue
    dz.append((code, dz_label[code], tot, {k:g[k]/tot for k in ('C','P','O')}))

def frame(era): return sa if era=='2011' else dz

# ---------------------------------------------------------------- project
def project(rec):
    era=rec['era']; areas=frame(era)
    gr=dict(rec['grate'])
    gr.setdefault('O', 0.40)   # prior for Other/None where poll lacks the cell
    gr.setdefault('C', 0.85); gr.setdefault('P', 0.09)
    # headline decided-UI target
    if rec['hUI'] and rec['hUK']:
        target=rec['hUI']/(rec['hUI']+rec['hUK'])
    else:  # derive from population-weighted raw poststratification (2016)
        num=den=0
        for _,_,pop,comp in areas:
            num+=pop*sum(comp[g]*gr[g] for g in 'CPO'); den+=pop
        target=num/den
    # calibrate: solve one logit shift delta so pop-weighted NI decided-UI == target
    den=sum(pop for _,_,pop,_ in areas)
    def ni_for(delta):
        grc={g:inv(logit(gr[g])+delta) for g in 'CPO'}
        return sum(pop*sum(comp[g]*grc[g] for g in 'CPO') for _,_,pop,comp in areas)/den
    lo,hi=-8.0,8.0
    for _ in range(60):
        mid=(lo+hi)/2
        if ni_for(mid)<target: lo=mid
        else: hi=mid
    delta=(lo+hi)/2
    grc={g:inv(logit(gr[g])+delta) for g in 'CPO'}
    # per-area calibrated
    rows=[]
    for code,lab,pop,comp in areas:
        ui=sum(comp[g]*grc[g] for g in 'CPO')
        rows.append((code,lab,pop,comp['C'],comp['P'],comp['O'],ui))
    ni=sum(pop*ui for _,_,pop,_,_,_,ui in rows)/sum(r[2] for r in rows)
    return grc,rows,ni,target,rec.get('hDK')

# ---------------------------------------------------------------- demographic breakdowns via census
def load_xtab(attr):
    """NI-level P(g|k) for a religion×attribute LGD table -> {cat: {C,P,O}}"""
    f=f"{SD}/xtab/{attr}.csv.gz"
    if not os.path.exists(f): return None
    cats=defaultdict(lambda: defaultdict(float))
    with gzip.open(f,'rt') as fh:
        hdr=fh.readline().rstrip('\n').split(',')
        # columns: LGD code,LGD label, ATTRcode, ATTRlabel, RELcode, RELlabel, Count
        ai=[i for i,h in enumerate(hdr) if h.endswith('Label')]
        # attribute label = the non-religion, non-geography Label col
        rel_i=[i for i,h in enumerate(hdr) if 'Religion' in h and 'Label' in h][0]
        cat_i=[i for i in ai if i!=rel_i and 'Data Zone' not in hdr[i] and 'District' not in hdr[i]][0]
        fh.seek(0); next(fh)
        for line in csv.reader(fh):
            catlab=line[cat_i]; rellab=line[rel_i].lower(); cnt=float(line[-1] or 0)
            g='C' if rellab.startswith('catholic') else 'P' if rellab.startswith('protestant') else 'O'
            cats[catlab][g]+=cnt
    out={}
    for k,g in cats.items():
        t=sum(g.values())
        if t>0: out[k]={x:g[x]/t for x in 'CPO'}
    return out

XTABS=sorted(os.path.basename(x)[:-7] for x in glob.glob(f"{SD}/xtab/*.csv.gz"))

# ---------------------------------------------------------------- run all polls
summary=[]
for code,rec in polls.items():
    grc,rows,ni,target,hDK=project(rec)
    era=rec['era']; geo="SA2011" if era=='2011' else "DZ21"
    # write area projection
    with open(f"{OUT}/areas/{rec['month']}_{geo}.csv","w",newline='') as fh:
        w=csv.writer(fh); w.writerow([geo,'Label','Population','Catholic_bg','Protestant_bg','Other_None_bg','Proj_UI_decided_pct','provenance'])
        for code2,lab,pop,c,p,o,ui in rows:
            w.writerow([code2,lab,int(pop),round(c*100,1),round(p*100,1),round(o*100,1),round(ui*100,1),'modelled'])
    uis=sorted(r[6] for r in rows)
    # demographic breakdowns (poll-direct religion + census-derived all attrs)
    bd={'_group_rates':{g:round(grc[g]*100,1) for g in 'CPO'}}
    for attr in XTABS:
        comp=load_xtab(attr)
        if not comp: continue
        bd[attr]={k:round(sum(v[g]*grc[g] for g in 'CPO')*100,1) for k,v in comp.items()}
    json.dump(bd, open(f"{OUT}/breakdowns/{rec['month']}_breakdown.json","w"), indent=1)
    summary.append(dict(code=code,label=rec['label'],month=rec['month'],era=era,geo=geo,
        n_areas=len(rows), ni_decided=round(ni*100,1), target=round(target*100,1),
        DK=hDK, rate_C=round(grc['C']*100,1),rate_P=round(grc['P']*100,1),rate_O=round(grc['O']*100,1),
        ui_min=round(uis[0]*100,1), ui_p10=round(uis[len(uis)//10]*100,1),
        ui_med=round(uis[len(uis)//2]*100,1), ui_p90=round(uis[9*len(uis)//10]*100,1),
        ui_max=round(uis[-1]*100,1),
        pct_areas_majority_UI=round(100*sum(1 for u in uis if u>0.5)/len(uis),1)))
json.dump(summary, open(f"{OUT}/summary.json","w"), indent=1)

# ---------------------------------------------------------------- print report
print("="*78)
print("DRY RUN — projected United Ireland (Border Poll) result, decided voters")
print("="*78)
for s in summary:
    print(f"\n■ {s['label']}  (poll {s['month']}, {s['geo']} × {s['n_areas']} areas, one week after)")
    print(f"   NI headline projected UI (decided): {s['ni_decided']}%  UK: {round(100-s['ni_decided'],1)}%   [DK in poll: {s['DK']}%]")
    print(f"   group decided-UI rates:  Catholic {s['rate_C']}%  Protestant {s['rate_P']}%  Other/None {s['rate_O']}%")
    print(f"   {s['geo']} spread of UI%:  min {s['ui_min']} | p10 {s['ui_p10']} | median {s['ui_med']} | p90 {s['ui_p90']} | max {s['ui_max']}")
    print(f"   share of areas with majority-UI: {s['pct_areas_majority_UI']}%")
print("\nOutputs: areas/<month>_<geo>.csv (per-area UI%), breakdowns/<month>_breakdown.json (UI% by every census attribute)")
