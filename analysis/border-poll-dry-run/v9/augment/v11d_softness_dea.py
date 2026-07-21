"""(a) DZ->DEA crosswalk (from DZ label stems, 80/80 exact) + v11d: wire the DEA-level transfer
openness (finer than the 18 constituencies) into the DZ softness/uncertainty layer. Falls back to
constituency openness where a DEA's unionist base was too small to measure."""
import gzip,csv,json,re,numpy as np,pandas as pd
V="analysis/border-poll-dry-run/v9"
# 1) build + emit DZ->DEA crosswalk
lab={}
with gzip.open('data/census/derived/dz21-religion-natid-age-2021.csv.gz','rt') as f:
    r=csv.reader(f);next(r)
    for row in r: lab[row[0]]=row[1]
def stem(l): return re.sub(r'_[A-Z]\d+$','',l).replace('_',' ').strip().upper()
dz_dea={dz:stem(l) for dz,l in lab.items()}
json.dump(dz_dea,open(f"{V}/dz_dea.json","w"))
print(f"emitted dz_dea.json ({len(dz_dea)} DZs -> {len(set(dz_dea.values()))} DEAs)")
# 2) inputs
dz=pd.read_csv("data/census/derived/dz21-community-2021.csv")
dzc=json.load(open(f"{V}/dz_constituency.json"))
cf=pd.read_csv(f"{V}/constituency_features.csv"); cf['con']=cf['con'].str.upper()
tdea=pd.read_csv(f"{V}/augment/transfer_covariates_dea.csv"); tdea['dea']=tdea['dea'].str.upper()
tcon=pd.read_csv(f"{V}/augment/transfer_covariates_constituency.csv"); tcon['con']=tcon['con'].str.upper()
pn=cf.set_index('con')[[x for x in cf if x.startswith('rel__Protestant')]].sum(axis=1)
nn=cf.set_index('con')[[x for x in cf if x.startswith('rel__Other') or x=='rel__None']].sum(axis=1)
pshare=(pn/(pn+nn))
op_dea=tdea.set_index('dea')['u_openness']; op_con=tcon.set_index('con')['u_openness']
def psoft_from_open(o): return np.clip(o/20.0,0.05,1.0)
dz['dea']=dz['DZ21'].map(dz_dea); dz['con']=dz['DZ21'].map(dzc); dz['cath']=dz['catholic_bg_pct']/100
dz['pshare']=dz['con'].map(pshare).fillna(pshare.mean())
# DEA openness, fallback to constituency, then mean
o=dz['dea'].map(op_dea)
o=o.fillna(dz['con'].map(op_con)); o=o.fillna(op_con.mean())
dz['p_soft']=psoft_from_open(o)
NONE,SAMP,SWING=0.83,2.0,7.0
dz['soft']=dz['cath']*1.0+(1-dz['cath'])*(dz['pshare']*dz['p_soft']+(1-dz['pshare'])*NONE)
dz['band_v11d']=(2*1.64*np.sqrt(SAMP**2+(dz['soft']*SWING)**2)).round(1)
dz[['DZ21','dea','con','catholic_bg_pct','p_soft','soft','band_v11d']].dropna(subset=['dea']).round(3).to_csv(f"{V}/augment/v11d_dz_softness_dea.csv",index=False)
# demonstrate the granularity GAIN: within-constituency DEA variation the constituency layer couldn't see
print("\nWithin-constituency variation now visible at DEA level (unionist openness, band):")
for con in ['NORTH DOWN','EAST ANTRIM','STRANGFORD']:
    sub=dz[dz['con']==con].groupby('dea').agg(open=('p_soft','mean'),band=('band_v11d','mean'),cath=('catholic_bg_pct','mean'))
    sub=sub.dropna()
    if len(sub)>1:
        hi=sub['band'].idxmax(); lo=sub['band'].idxmin()
        print(f"  {con}: DEAs span band {sub['band'].min():.1f}-{sub['band'].max():.1f}pt  (hardest {lo} {sub.loc[lo,'band']:.1f}, softest {hi} {sub.loc[hi,'band']:.1f})")
print("wrote dz_dea.json, v11d_dz_softness_dea.csv")
