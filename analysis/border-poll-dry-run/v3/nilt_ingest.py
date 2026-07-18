#!/usr/bin/env python3
"""Ingest all NILT waves -> harmonised constitutional time series.
Two metrics:
  A. NIRELND / NIRELND2  (long-run constitutional preference, 1998-2025)
     reunify vs remain-UK  ->  'preference' unity share.
  B. REFUNIFY / BORDPOLL  (direct border-poll vote intention, 2017/2019-2025)
     Yes/No  ->  'referendum' unity share (comparable to LucidTalk).
Weighted (WTFACTOR); overall + by community background (FAMRCODE/RELIGCAT).
Provenance: survey-microdata (NILT).
"""
import pyreadstat, glob, os, re, json
SD="/tmp/claude-0/-home-user-civgraph/ea760a88-7de6-5e08-940a-d3a6d280325e/scratchpad"
def read(f):
    for enc in (None,'latin1','WINDOWS-1252'):
        try:
            kw={} if enc is None else {'encoding':enc}
            return pyreadstat.read_sav(f, **kw)
        except Exception: continue
    return None,None
def pick(cols, names, labs, L, labpat):
    for v in cols:
        if v.upper() in names: return v
    for v in cols:
        if re.search(labpat, L.get(v,''), re.I): return v
    return None
def cb_group(lab):
    l=str(lab).lower()
    if 'catholic' in l: return 'C'
    if 'protestant' in l: return 'P'
    if 'no religion' in l or 'none' in l or 'other' in l or 'no relig' in l: return 'O'
    return None
def unity_kind(lab):
    l=str(lab).lower()
    if any(k in l for k in ('reunif','unify','rest of ireland','united ireland')) and 'not' not in l.split('unif')[0][-6:]:
        # 'Yes, should unify' -> U ; but 'No, should not unify' must be UK
        if l.startswith('no') or 'should not' in l or 'not unify' in l: return 'K'
        return 'U'
    if l.startswith('no'): return 'K'
    if 'remain part of' in l or 'united kingdom' in l or 'remain in the uk' in l or 'part of the uk' in l: return 'K'
    return None  # independent / other / DK / not-vote

series=[]
for f in sorted(glob.glob(f"{SD}/nilt/*.sav")):
    yr=int(os.path.basename(f)[:4])
    df,meta=read(f)
    if df is None: continue
    L={v:str(meta.column_names_to_labels.get(v,'') or '') for v in meta.column_names}
    vl=meta.variable_value_labels
    cols=list(df.columns)
    wtv=pick(cols,{'WTFACTOR','WEIGHT','WT'},None,L,r'^weight')
    w=df[wtv] if wtv else None
    relv=pick(cols,{'FAMRCODE'},None,L,r'religion brought up') or pick(cols,{'RELIGCAT','RELIGION'},None,L,r'religion')
    conv=pick(cols,{'NIRELND2','NIRELND','NIRELAND','NIRELND3'},None,L,r'long.?term policy')
    refv=pick(cols,{'REFUNIFY','BORDPOLL'},None,L,r'referendum tomorrow|vote if there was a referendum')
    def rates(var):
        if not var or var not in df.columns: return None
        labs=vl.get(var,{})
        sub=df[[var]].copy(); sub['w']=(w if w is not None else 1.0)
        sub=sub.dropna(subset=[var])
        sub['k']=sub[var].map(lambda c: unity_kind(labs.get(c,c)))
        sub['g']=sub[var].map(lambda c: c)  # keep
        tot=sub['w'].sum()
        U=sub[sub['k']=='U']['w'].sum(); K=sub[sub['k']=='K']['w'].sum()
        dec = U/(U+K)*100 if (U+K)>0 else None
        # by community background
        bycb={}
        if relv and relv in df.columns:
            rl=vl.get(relv,{})
            s2=df[[var,relv]].copy(); s2['w']=(w if w is not None else 1.0); s2=s2.dropna(subset=[var,relv])
            s2['k']=s2[var].map(lambda c: unity_kind(labs.get(c,c)))
            s2['cb']=s2[relv].map(lambda c: cb_group(rl.get(c,c)))
            for g in ('C','P','O'):
                gg=s2[s2['cb']==g]; U2=gg[gg['k']=='U']['w'].sum(); K2=gg[gg['k']=='K']['w'].sum()
                bycb[g]= round(U2/(U2+K2)*100,1) if (U2+K2)>0 else None
        return dict(n=int(len(sub)), decided_unity=round(dec,1) if dec else None,
                    U_pct=round(U/tot*100,1), K_pct=round(K/tot*100,1), by_cb=bycb)
    rec=dict(year=yr, n=int(len(df)), weight=bool(wtv), relv=relv)
    pref=rates(conv); ref=rates(refv)
    rec['preference']=pref; rec['referendum']=ref
    series.append(rec)

series.sort(key=lambda r:r['year'])
json.dump(series, open(f"{SD}/nilt_series.json","w"), indent=1)
print("=== NILT constitutional time series (weighted) ===")
print(f"{'yr':4s} {'n':>5} | {'PREF reunify(dec)':>17} {'C':>5}{'P':>5}{'O':>5} | {'REFERENDUM Yes(dec)':>19} {'C':>5}{'P':>5}{'O':>5}")
for r in series:
    p=r['preference'] or {}; f=r['referendum'] or {}
    pcb=p.get('by_cb',{}); fcb=f.get('by_cb',{})
    def s(x): return f"{x}" if x is not None else "  -"
    print(f"{r['year']:<4d} {r['n']:5d} | {s(p.get('decided_unity')):>17} {s(pcb.get('C')):>5}{s(pcb.get('P')):>5}{s(pcb.get('O')):>5} | {s(f.get('decided_unity')):>19} {s(fcb.get('C')):>5}{s(fcb.get('P')):>5}{s(fcb.get('O')):>5}")
print(f"\nwaves ingested: {len(series)}   -> nilt_series.json")
