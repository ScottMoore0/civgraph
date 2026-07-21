"""(b) Third independent read: pool the European STV contests (NI-wide) and compare the NI-level
unionist openness against the Assembly-pooled and local-pooled reads. If the three contest types
agree, the transfer-openness signal is robust and not a single-election artifact."""
import json,glob,os,collections,numpy as np
BASE='test/metadata/elections-test2'; V="analysis/border-poll-dry-run/v9"
def bloc(p):
    p=(p or '').lower()
    if any(k in p for k in['dup','democratic unionist']):return 'U'
    if 'uup' in p or 'ulster unionist' in p:return 'U'
    if 'progressive unionist' in p or p=='pup':return 'U'
    if 'traditional unionist' in p or 'tuv' in p:return 'U'
    if 'uk unionist' in p or 'ukup' in p:return 'U'
    if 'independent unionist' in p or 'united unionist' in p:return 'U'
    if 'sdlp' in p or 'social democratic' in p:return 'N'
    if 'sinn' in p:return 'N'
    if 'aont' in p:return 'N'
    if 'alliance' in p:return 'C'
    if 'green' in p:return 'C'
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
        recv=sum(dst.values()); nt=max(0.0,-tr-recv)
        if -tr>0 and recv<= -tr*1.02: out.append((bloc(party[name]),dict(dst),nt,-tr))
    return out
def ni_openness(files):
    a=collections.defaultdict(float)
    for f in files:
        if not os.path.exists(f):continue
        d=json.load(open(f))
        for res in d.get('results',[]):
            for sb,dst,nt,parcel in elim_flows(res):
                if sb!='U':continue
                a['parcel']+=parcel; a['nt']+=nt
                for db,amt in dst.items(): a[f'to_{db}']+=amt
    tr=a['parcel']-a['nt']
    return (100*(a.get('to_C',0)+a.get('to_N',0))/tr if tr>0 else np.nan,
            100*a.get('to_U',0)/tr if tr>0 else np.nan, 100*a['nt']/a['parcel'] if a['parcel']>0 else np.nan, a['parcel'])
euro=sorted(glob.glob(f"{BASE}/european-parliament__*.json"))
euro=[f for f in euro if int(os.path.basename(f).split('__')[1][:4])>=1994]
asm=sorted(glob.glob(f"{BASE}/northern-ireland-assembly__*.json"))
loc=[f for f in sorted(glob.glob(f"{BASE}/local-government-local-government-districts__*.json")) if int(os.path.basename(f).split('__')[1][:4])>=2014]
print("NI-wide UNIONIST transfer behaviour — three independent contest types (pooled):")
print(f"{'contest type':<26}{'openness%':>10}{'within-U%':>11}{'plump%':>9}{'base':>10}")
for name,files in [('European (6, 1994-2019)',euro),('Assembly (7, 1998-2022)',asm),('Local (3, 2014-2023)',loc)]:
    o,u,pl,base=ni_openness(files)
    print(f"  {name:<24}{o:>10.1f}{u:>11.1f}{pl:>9.1f}{int(base):>10}")
print("\n-> if the openness reads agree, the signal is contest-robust (not an artifact of one election type)")
