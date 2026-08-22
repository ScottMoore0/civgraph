"""(a) 30-year behavioural time series: NI-wide unionist & nationalist transfer OPENNESS per STV
election, 1993-2023 (local + Assembly + European), pooling across all sub-geographies (boundary
changes are irrelevant at NI level). Shows whether cross-community transfer willingness -- the
tribalism/softening signal -- has moved over three decades.
NOTE: pre-2014 local results ARE digitised but carry first-preferences only (Count_Number=1, no
Transfers); count-by-count transfer detail exists only from 2014 locals + 1998 Assembly onward.
So the effective transfer coverage is Assembly 1998-2022 + local 2014-2023, not a true 1993 start."""
import json,glob,os,collections,numpy as np,pandas as pd
BASE='render/metadata/elections-test2'; V="analysis/border-poll-dry-run/v9"
def bloc(p):
    p=(p or '').lower()
    if any(k in p for k in['dup','democratic unionist','uup','ulster unionist','progressive unionist','traditional unionist','uk unionist','ukup','independent unionist','united unionist','vanguard','ulster democ']):return 'U'
    if any(k in p for k in['sdlp','social democratic','sinn','aont','independent nationalist','irsp']):return 'N'
    if 'alliance' in p or 'green' in p or 'women' in p:return 'C'
    return 'O'
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
        dst=collections.defaultdict(float)
        for dn,a in perc[n]['dst']:dst[bloc(party[dn])]+=a
        recv=sum(dst.values())
        if -tr>0 and recv<=-tr*1.02: out.append((bloc(party[name]),dict(dst),max(0.0,-tr-recv),-tr))
    return out
def openness(f):
    d=json.load(open(f)); a=collections.defaultdict(float)
    for res in d.get('results',[]):
        for sb,dst,nt,parcel in elim_flows(res):
            if sb not in('U','N'):continue
            a[f'{sb}_p']+=parcel; a[f'{sb}_nt']+=nt
            for db,amt in dst.items(): a[f'{sb}_to_{db}']+=amt
    def op(b):
        tr=a.get(f'{b}_p',0)-a.get(f'{b}_nt',0)
        cross=a.get(f'{b}_to_C',0)+a.get(f'{b}_to_{"N" if b=="U" else "U"}',0)
        return round(100*cross/tr,1) if tr>500 else np.nan
    return op('U'),op('N'),int(a.get('U_p',0)),int(a.get('N_p',0))
rows=[]
for pat,typ in [('local-government-local-government-districts__*','local'),
                ('northern-ireland-assembly__*','Assembly'),('european-parliament__*','European')]:
    for f in sorted(glob.glob(f"{BASE}/{pat}.json")):
        yr=int(os.path.basename(f).split('__')[1][:4])
        if yr<1973: continue
        uo,no,ub,nb=openness(f)
        rows.append({'year':yr,'contest':typ,'u_openness':uo,'n_openness':no})
ts=pd.DataFrame(rows).sort_values(['year','contest'])
ts.to_csv(f"{V}/augment/transfer_openness_timeseries.csv",index=False)
print("NI-wide transfer OPENNESS by STV election, 1973-2023 (higher = more cross-community/less tribal):")
print(ts.to_string(index=False))
# decade means
for lo,hi,lab in [(1973,1998,'1973-1998'),(1999,2008,'1999-2008'),(2009,2018,'2009-2018'),(2019,2024,'2019-2024')]:
    s=ts[(ts.year>=lo)&(ts.year<=hi)]
    print(f"  {lab}: unionist openness {s['u_openness'].mean():.1f}%  nationalist {s['n_openness'].mean():.1f}%")
print("wrote transfer_openness_timeseries.csv")
