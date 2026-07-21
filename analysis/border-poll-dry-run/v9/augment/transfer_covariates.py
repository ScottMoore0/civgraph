"""Integrate STV transfers as a revealed-behaviour SECOND-DIMENSION covariate layer.
Pools the 7 NI Assembly elections (1998-2022). For each constituency-contest it walks the count
sheet, keeps only SINGLE-SOURCE stages (party-attributable; bulk multi-eliminations are skipped),
derives the non-transferable parcel as the residual (parcel - sum of destination gains), and
aggregates ELIMINATION flows by source-bloc -> destination-bloc. Per constituency it emits:
  plumping (nontransferable share), within-bloc cohesion, cross-bloc/centre OPENNESS = softness signal.
Vote-value units (fractional WIGM); flows are blended/conditional (documented limits). Validated on
North Antrim (unionist->DUP cohesion = hard unionism) and correlated with the survey softness surface."""
import json, glob, os, collections, numpy as np, pandas as pd
BASE='test/metadata/elections-test2'; V="analysis/border-poll-dry-run/v9"
def bloc(p):
    p=(p or '').lower()
    if any(k in p for k in['dup','democratic unionist']):return('U','DUP')
    if 'uup' in p or 'ulster unionist' in p:return('U','UUP')
    if 'progressive unionist' in p or p=='pup':return('U','PUP')
    if 'uk unionist' in p or 'ukup' in p:return('U','UKUP')
    if 'traditional unionist' in p or 'tuv' in p:return('U','TUV')
    if 'ulster democ' in p or p=='udp':return('U','UDP')
    if 'independent unionist' in p or 'united unionist' in p:return('U','IndU')
    if 'conservative' in p:return('U','Con')
    if 'sdlp' in p or 'social democratic' in p:return('N','SDLP')
    if 'sinn' in p:return('N','SF')
    if 'aont' in p:return('N','Aontu')
    if 'independent nationalist' in p or 'irsp' in p or 'irish repub' in p:return('N','IndN')
    if 'alliance' in p:return('C','Alliance')
    if 'green' in p:return('C','Green')
    if 'women' in p:return('C','NIWC')
    return('O','Other')

def elim_flows(res):
    """single-source ELIMINATION events -> (src_party, {dest_party:amt}, nontransferable, parcel)."""
    party={c['name']:c['party'] for c in res.get('candidates',[])}
    perc=collections.defaultdict(lambda:{'src':[],'dst':[]})
    for c in res.get('candidates',[]):
        for ct in c.get('counts',[]):
            t=ct.get('transfers') or 0; n=ct.get('count')
            if t<-0.5: perc[n]['src'].append((c['name'],t,ct.get('status')))
            elif t>0.5: perc[n]['dst'].append((c['name'],t))
    out=[]
    for n in sorted(perc):
        s=perc[n]['src']
        if len(s)!=1: continue                          # single-source only (skip bulk)
        name,tr,status=s[0]
        if status=='Elected': continue                  # skip surplus transfers; keep eliminations
        parcel=-tr; dst={}
        for dn,a in perc[n]['dst']: dst[party[dn]]=dst.get(party[dn],0)+a
        received=sum(dst.values()); nontrans=max(0.0,parcel-received)
        out.append((party[name],dst,nontrans,parcel))
    return out

# pool 7 Assembly elections
agg=collections.defaultdict(lambda:collections.defaultdict(float))   # con -> metric -> value
na_detail=collections.defaultdict(float)
for f in sorted(glob.glob(f"{BASE}/northern-ireland-assembly__*.json")):
    d=json.load(open(f)); yr=os.path.basename(f).split('__')[1][:4]
    for res in d.get('results',[]):
        con=res['constituency'].strip().upper()
        for src_party,dst,nontrans,parcel in elim_flows(res):
            sb,_=bloc(src_party)
            if sb not in ('U','N'): continue
            agg[con][f'{sb}_parcel']+=parcel; agg[con][f'{sb}_nontrans']+=nontrans
            for dp,a in dst.items():
                db,dcode=bloc(dp)
                tgt='U' if db=='U' else 'N' if db=='N' else 'C'
                agg[con][f'{sb}_to_{tgt}']+=a
                if con=='NORTH ANTRIM' and sb=='U': na_detail[dcode]+=a
rows=[]
for con,a in agg.items():
    def rate(num,den): return round(100*a.get(num,0)/a[den],1) if a.get(den,0)>0 else np.nan
    u_tr=a.get('U_parcel',0)-a.get('U_nontrans',0); n_tr=a.get('N_parcel',0)-a.get('N_nontrans',0)
    r={'con':con,
       'u_plump':rate('U_nontrans','U_parcel'),
       'u_cohesion':round(100*a.get('U_to_U',0)/u_tr,1) if u_tr>0 else np.nan,
       'u_openness':round(100*(a.get('U_to_C',0)+a.get('U_to_N',0))/u_tr,1) if u_tr>0 else np.nan,
       'n_plump':rate('N_nontrans','N_parcel'),
       'n_openness':round(100*(a.get('N_to_C',0)+a.get('N_to_U',0))/n_tr,1) if n_tr>0 else np.nan}
    # transfer-softness index: share of ALL transferable unionist+nationalist votes leaving the tribe
    tot_tr=u_tr+n_tr; cross=a.get('U_to_C',0)+a.get('U_to_N',0)+a.get('N_to_C',0)+a.get('N_to_U',0)
    r['transfer_softness']=round(100*cross/tot_tr,1) if tot_tr>0 else np.nan
    rows.append(r)
tc=pd.DataFrame(rows).set_index('con').sort_values('transfer_softness',ascending=False)
tc.to_csv(f"{V}/augment/transfer_covariates_constituency.csv")
print(f"Pooled 7 Assembly elections -> transfer covariates for {len(tc)} constituencies\n")
print("SOFTEST (most cross-tribe transferring):");print(tc[['transfer_softness','u_openness','u_plump']].head(4).to_string())
print("HARDEST (most tribal/plumping):");print(tc[['transfer_softness','u_openness','u_plump']].tail(4).to_string())

# --- North Antrim validation: where do unionist votes go? ---
tot=sum(na_detail.values())
print("\nNORTH ANTRIM unionist ELIMINATION transfers, by destination party (single-source stages):")
for p,a in sorted(na_detail.items(),key=lambda x:-x[1]):
    if a>0: print(f"   -> {p:9s} {100*a/tot:5.1f}%")
print(f"   unionist transfer-softness rank: {list(tc.index).index('NORTH ANTRIM')+1} of {len(tc)} (1=softest)")

# --- integrate: correlate with survey softness surface if present ---
import os
for surv in ['hardness_continuous_constituency.csv','persuadability_constituency.csv']:
    p=f"{V}/augment/{surv}"
    if os.path.exists(p):
        s=pd.read_csv(p); s.columns=[c.strip() for c in s.columns]
        key=[c for c in s.columns if 'con' in c.lower()][0]; s[key]=s[key].str.upper()
        m=tc.reset_index().merge(s,left_on='con',right_on=key)
        num=[c for c in s.columns if s[c].dtype!=object and c!=key]
        if num:
            best=max(num,key=lambda c:abs(np.corrcoef(m['transfer_softness'],m[c])[0,1]) if m[c].notna().all() else 0)
            r=np.corrcoef(m['transfer_softness'],m[best])[0,1]
            print(f"\nINTEGRATION: transfer_softness vs survey '{best}' ({surv}): r={r:+.2f} (n={len(m)})")
        break
print("\nwrote transfer_covariates_constituency.csv")
