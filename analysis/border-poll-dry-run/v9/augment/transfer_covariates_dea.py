"""DEA-level transfer covariates from the post-2014 local-government STV elections (2014/2019/2023,
current 80-DEA geography). Same single-source elimination extraction as transfer_covariates.py."""
import json,glob,os,collections,numpy as np,pandas as pd
V="analysis/border-poll-dry-run/v9"; BASE='test/metadata/elections-test2'
import importlib.util
spec=importlib.util.spec_from_file_location("tc",f"{V}/augment/transfer_covariates.py")
# reuse bloc() + elim_flows() without running the module's main body: re-declare minimal copies
def bloc(p):
    p=(p or '').lower()
    if any(k in p for k in['dup','democratic unionist']):return('U','DUP')
    if 'uup' in p or 'ulster unionist' in p:return('U','UUP')
    if 'progressive unionist' in p or p=='pup':return('U','PUP')
    if 'traditional unionist' in p or 'tuv' in p:return('U','TUV')
    if 'uk unionist' in p or 'ukup' in p:return('U','UKUP')
    if 'independent unionist' in p or 'united unionist' in p:return('U','IndU')
    if 'sdlp' in p or 'social democratic' in p:return('N','SDLP')
    if 'sinn' in p:return('N','SF')
    if 'aont' in p:return('N','Aontu')
    if 'independent nationalist' in p or 'irsp' in p:return('N','IndN')
    if 'alliance' in p:return('C','Alliance')
    if 'green' in p:return('C','Green')
    if 'people before profit' in p or p=='pbp':return('O','PBP')
    return('O','Other')
def elim_flows(res):
    party={c['name']:c['party'] for c in res.get('candidates',[])}
    perc=collections.defaultdict(lambda:{'src':[],'dst':[]})
    for c in res.get('candidates',[]):
        for ct in c.get('counts',[]):
            t=ct.get('transfers') or 0;n=ct.get('count')
            if t<-0.5:perc[n]['src'].append((c['name'],t,ct.get('status')))
            elif t>0.5:perc[n]['dst'].append((c['name'],t))
    out=[]
    for n in sorted(perc):
        s=perc[n]['src']
        if len(s)!=1:continue
        name,tr,status=s[0]
        if status=='Elected':continue
        dst={}
        for dn,a in perc[n]['dst']:dst[party[dn]]=dst.get(party[dn],0)+a
        nontrans=max(0.0,-tr-sum(dst.values()))
        out.append((party[name],dst,nontrans,-tr))
    return out
agg=collections.defaultdict(lambda:collections.defaultdict(float))
for f in sorted(glob.glob(f"{BASE}/local-government-local-government-districts__201[49]*.json"))+[f"{BASE}/local-government-local-government-districts__2023-05-18.json"]:
    if not os.path.exists(f):continue
    d=json.load(open(f))
    for res in d.get('results',[]):
        dea=res['constituency'].strip().upper()
        for sp,dst,nt,parcel in elim_flows(res):
            sb,_=bloc(sp)
            if sb not in('U','N'):continue
            agg[dea][f'{sb}_parcel']+=parcel;agg[dea][f'{sb}_nt']+=nt
            for dp,a in dst.items():
                tb=bloc(dp)[0];tgt='U' if tb=='U' else 'N' if tb=='N' else 'C'
                agg[dea][f'{sb}_to_{tgt}']+=a
rows=[]
for dea,a in agg.items():
    utr=a.get('U_parcel',0)-a.get('U_nt',0);ntr=a.get('N_parcel',0)-a.get('N_nt',0)
    MIN=500.0  # need a real transferable base; ratios on tiny bases are noise
    uo=min(100,round(100*(a.get('U_to_C',0)+a.get('U_to_N',0))/utr,1)) if a.get('U_parcel',0)>=MIN and utr>0 else np.nan
    no=min(100,round(100*(a.get('N_to_C',0)+a.get('N_to_U',0))/ntr,1)) if a.get('N_parcel',0)>=MIN and ntr>0 else np.nan
    rows.append({'dea':dea,'u_openness':uo,
      'u_plump':round(100*a.get('U_nt',0)/a['U_parcel'],1) if a.get('U_parcel',0)>=MIN else np.nan,
      'n_openness':no,'u_base':int(a.get('U_parcel',0))})
dea=pd.DataFrame(rows).set_index('dea').sort_values('u_openness')
dea.to_csv(f"{V}/augment/transfer_covariates_dea.csv")
print(f"DEA-level transfer covariates: {len(dea)} DEAs (pooled local 2014/2019/2023)")
print("hardest-unionist DEAs (lowest u_openness):");print(dea.dropna(subset=['u_openness']).head(6).to_string())
print("softest-unionist DEAs:");print(dea.dropna(subset=['u_openness']).tail(6).to_string())
print("wrote transfer_covariates_dea.csv")
