#!/usr/bin/env python3
"""Cross-era harmonised unity level series, ~1989-2025 -- so unity can be projected back
through the NILT era (1998-2012, no LucidTalk) and the NISA era (1989-96, no NILT).

The problem: each era's level is a DIFFERENT survey question on a DIFFERENT scale --
LucidTalk REFUNIFY (2012+, direct border-poll), NILT constitutional preference (1998+,
runs ~15pt below the vote), NISA (1989-96, same lineage as NILT). To compare across eras
they must be on one scale.

The fix: NILT carries BOTH REFUNIFY *and* the constitutional question in 2020-2024, in the
same respondents -> a clean within-survey offset (border-poll minus constitutional). Apply
it to NILT 1998-2019 and (bridged) to NISA -> a border-poll-EQUIVALENT unity % for every
year. Uncertainty widens backwards: sampling error + offset error + (pre-2012) no direct
poll + (pre-1998) NISA bridge.
"""
import pyreadstat, glob, os, json, re, numpy as np, pandas as pd
RAW="data/surveys/nilt/raw"; V="analysis/border-poll-dry-run/v9"
def wavg_pct(vals, w, sel_num, sel_den):
    d=w[sel_den].sum(); return (100*w[sel_num].sum()/d) if d>0 else np.nan, int(sel_den.sum())
rows=[]
for f in sorted(glob.glob(f"{RAW}/*.sav")):
    yr=int(os.path.basename(f)[:4])
    df=meta=None
    for enc in ('latin1','utf-8','cp1252'):
        try: df,meta=pyreadstat.read_sav(f,encoding=enc); break
        except Exception: continue
    if df is None: continue
    cols={c.lower():c for c in meta.column_names}
    wt=cols.get('wtfactor'); w=df[wt].fillna(0).values if wt else np.ones(len(df))
    rec={'year':yr}
    # constitutional preference reunify-of-decided
    cv=next((cols[c] for c in ('nireland','nirelnd2','nirelnd') if c in cols),None)
    if cv:
        vl=meta.variable_value_labels.get(cv,{})
        reun=[k for k,v in vl.items() if 'reunif' in str(v).lower()]
        uk=[k for k,v in vl.items() if 'united kingdom' in str(v).lower() or 'remain part of the uk' in str(v).lower()]
        if reun and uk:
            x=df[cv].values; isr=np.isin(x,reun); isu=np.isin(x,uk)
            rec['const_reunify'],rec['n_const']=wavg_pct(x,w,isr,isr|isu)
    # REFUNIFY yes-of-decided (2020+)
    rv=cols.get('refunify')
    if rv:
        vl=meta.variable_value_labels.get(rv,{})
        yes=[k for k,v in vl.items() if str(v).lower().startswith('yes')]
        no=[k for k,v in vl.items() if str(v).lower().startswith('no')]
        if yes and no:
            x=df[rv].values; iy=np.isin(x,yes); inn=np.isin(x,no)
            rec['refunify'],rec['n_ref']=wavg_pct(x,w,iy,iy|inn)
    rows.append(rec)
N=pd.DataFrame(rows).set_index('year').sort_index()

# ---- within-NILT offset (border-poll minus constitutional), 2020-2024 ----
ov=N.dropna(subset=['refunify','const_reunify'])
offset=(ov['refunify']-ov['const_reunify']); OFF=offset.mean(); OFF_SD=offset.std()
print("Within-NILT offset (REFUNIFY yes - constitutional reunify), same respondents:")
for y,r in ov.iterrows(): print(f"  {y}: REFUNIFY {r['refunify']:.1f}  const {r['const_reunify']:.1f}  offset {r['refunify']-r['const_reunify']:+.1f}")
print(f"  mean offset = {OFF:+.1f}pt (SD {OFF_SD:.1f}) -> constitutional preference understates a border-poll Yes by ~{OFF:.0f}pt\n")

# ---- harmonise NILT to border-poll-equivalent ----
N['bp_equiv']=N['const_reunify']+OFF
N.loc[N['refunify'].notna(),'bp_equiv']=N['refunify']            # use direct where available

# ---- LucidTalk decided-unity (2012+); house-effect-corrected onto the NILT scale ----
lt=json.load(open(f"{V}/../v3/lucidtalk_unity_rates.json"))
LTraw={int(k[:4]):v['decided'] for k,v in lt.items() if v.get('decided')}
# LucidTalk (online panel) house effect vs NILT REFUNIFY (random sample), on overlap years
he=[LTraw[y]-N.loc[y,'refunify'] for y in LTraw if y in N.index and pd.notna(N.loc[y,'refunify'])]
HE=np.mean(he) if he else 0.0
print(f"LucidTalk house effect vs NILT REFUNIFY (overlap n={len(he)}): {HE:+.1f}pt -> LucidTalk corrected onto NILT scale")
LT={y:v-HE for y,v in LTraw.items()}      # corrected to NILT random-sample scale
# ---- NISA (1989-96) reunify -> of-decided approx (~/0.95) + offset bridge ----
nisa=json.load(open(f"{V}/hist/nisa_reunify.json"))
NISA={int(y):(d['overall']/0.95) for y,d in nisa.items()}       # of-all -> ~of-decided

# ---- assemble series ----
def band(level, extra):  # sampling + offset + era penalty
    return np.sqrt(2.0**2 + extra**2)
series=[]
for y in range(1989,2026):
    if y in N.index and pd.notna(N.loc[y,'refunify']): lvl,src,unc=N.loc[y,'refunify'],'NILT REFUNIFY (direct)',2.5
    elif y in LT:                     lvl,src,unc=LT[y],'LucidTalk (corrected)',2.5
    elif y in N.index and pd.notna(N.loc[y,'bp_equiv']): lvl,src,unc=N.loc[y,'bp_equiv'],'NILT const.+offset',band(0,OFF_SD+1.5)
    elif y in NISA:                   lvl,src,unc=NISA[y]+OFF,'NISA+offset (bridged)',band(0,OFF_SD+3.5)
    else: continue
    series.append(dict(year=y,unity_bp_equiv=round(lvl,1),lo=round(lvl-1.64*unc,1),hi=round(lvl+1.64*unc,1),source=src))
S=pd.DataFrame(series)
S.to_csv(f"{V}/augment/unity_timeseries.csv",index=False)
print("Harmonised border-poll-equivalent unity %, ~1989-2025 (90% band):")
print(f"{'yr':5}{'unity%':>8}{'90% band':>14}   source")
for _,r in S.iterrows(): print(f"{r.year:<5}{r.unity_bp_equiv:>7.1f}  {f'{r.lo:.0f}-{r.hi:.0f}':>10}   {r.source}")
# validation: does harmonised NILT match LucidTalk on the 2012-2024 overlap?
ovl=[(y,N.loc[y,'bp_equiv'],LT[y]) for y in LT if y in N.index and pd.notna(N.loc[y,'bp_equiv']) and pd.isna(N.loc[y,'refunify'])]
if ovl:
    err=np.mean([abs(a-b) for _,a,b in ovl])
    print(f"\nVALIDATION: harmonised NILT-const+offset vs LucidTalk on overlap -> mean abs diff {err:.1f}pt")
print("\nwrote unity_timeseries.csv")
