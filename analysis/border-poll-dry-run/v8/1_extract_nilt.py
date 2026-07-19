import pyreadstat, glob, os, re, csv
SD="/tmp/claude-0/-home-user-civgraph/ea760a88-7de6-5e08-940a-d3a6d280325e/scratchpad"
def read(f):
    for enc in (None,'latin1','WINDOWS-1252'):
        try: return pyreadstat.read_sav(f, **({} if enc is None else {'encoding':enc}))
        except Exception: continue
    return None,None
def pick(cols,names,L,pat):
    for v in cols:
        if v.upper() in names: return v
    for v in cols:
        if re.search(pat,L.get(v,''),re.I): return v
    return None
def cb_group(lab):
    l=str(lab).lower()
    if 'catholic' in l: return 'C'
    if 'protestant' in l: return 'P'
    if any(k in l for k in ('no relig','none','other')): return 'O'
    return None
def unity_kind(lab):
    l=str(lab).lower().strip()
    # explicit UK/remain
    if l.startswith('no') or 'should not' in l or 'not unify' in l or 'remain part' in l \
       or 'united kingdom' in l or 'remain in the uk' in l or 'part of the uk' in l or 'stay in the uk' in l:
        return 'K'
    if any(k in l for k in ('reunif','unify','united ireland','rest of ireland','join the republic','leave the uk')):
        return 'U'
    if l.startswith('yes'): return 'U'
    return None
def age_band(val,lab):
    l=str(lab).lower()
    for a,b,band in [(0,24,'18-24'),(25,34,'25-34'),(35,44,'35-44'),(45,54,'45-54'),(55,64,'55-64')]:
        pass
    # try label first
    m=re.findall(r'(\d{2})',l)
    if 'under' in l or '18-24' in l or '16-24' in l: return '18-24'
    if m:
        lo=int(m[0])
        if lo<25:return '18-24'
        if lo<35:return '25-34'
        if lo<45:return '35-44'
        if lo<55:return '45-54'
        if lo<65:return '55-64'
        return '65+'
    try:
        v=float(val)
        if v<25:return '18-24'
        if v<35:return '25-34'
        if v<45:return '35-44'
        if v<55:return '45-54'
        if v<65:return '55-64'
        if v<200:return '65+'
    except: pass
    return None
def sex_of(val,lab):
    l=str(lab).lower()
    if 'male' in l and 'female' not in l: return 'M'
    if 'female' in l: return 'F'
    try:
        v=int(val)
        return 'M' if v==1 else 'F' if v==2 else None
    except: return None

out=[]
for f in sorted(glob.glob(f"{SD}/nilt/*.sav")):
    yr=int(os.path.basename(f)[:4]); df,meta=read(f)
    if df is None: print("FAIL",yr); continue
    L={v:str(meta.column_names_to_labels.get(v,'') or '') for v in meta.column_names}
    vl=meta.variable_value_labels; cols=list(df.columns)
    wtv=pick(cols,{'WTFACTOR','WEIGHT','WT'},L,r'^weight|grossing')
    relv=pick(cols,{'FAMRCODE'},L,r'religion brought up|community background') or pick(cols,{'RELIGCAT','RELIGION'},L,r'religion')
    agev=pick(cols,{'RAGECAT','RAGEGRP','RAGE'},L,r'age group|age band|^age$|age of resp')
    sexv=pick(cols,{'RSEX','S1RSEX','RESP_SEX'},L,r'^sex$|respondent.*sex|gender')
    prefv=pick(cols,{'NIRELND2','NIRELAND','NIRELND','NIRELND3'},L,r'long.?term policy')
    refv=pick(cols,{'REFUNIFY','BORDPOLL'},L,r'referendum tomorrow|border ?poll')
    for src,var in [('nilt_pref',prefv),('nilt_ref',refv)]:
        if not var or var not in df.columns: continue
        labs=vl.get(var,{}); rl=vl.get(relv,{}) if relv else {}; al=vl.get(agev,{}) if agev else {}; sl=vl.get(sexv,{}) if sexv else {}
        for _,r in df[[c for c in [var,relv,agev,sexv,wtv] if c]].iterrows():
            k=unity_kind(labs.get(r[var],r[var]))
            if k is None: continue
            cb=cb_group(rl.get(r[relv],r[relv])) if relv else None
            ab=age_band(r[agev],al.get(r[agev],'')) if agev else None
            sx=sex_of(r[sexv],sl.get(r[sexv],'')) if sexv else None
            w=r[wtv] if wtv and r[wtv]==r[wtv] else 1.0
            out.append([yr,src,cb,ab,sx,1 if k=='U' else 0, round(float(w),4)])
with open(f"{SD}/nilt_individual.csv","w",newline='') as fh:
    w=csv.writer(fh); w.writerow(['year','source','community','age_band','sex','unity','weight']); w.writerows(out)
print("rows:",len(out))
# sanity: weighted unity by source/year (a few)
import collections
agg=collections.defaultdict(lambda:[0.0,0.0])
for yr,src,cb,ab,sx,u,w in out:
    agg[(yr,src)][0]+=w*u; agg[(yr,src)][1]+=w
print("year  source      n_wtd  unity%")
for (yr,src),(uw,tw) in sorted(agg.items()):
    print(f"{yr}  {src:10} {tw:7.0f}  {100*uw/tw:5.1f}")
