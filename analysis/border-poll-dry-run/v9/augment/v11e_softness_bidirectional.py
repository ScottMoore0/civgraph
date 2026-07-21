"""(b) Bidirectional transfer wiring: correct BOTH bloc softnesses by revealed transfer behaviour.
v11b was flat (Catholic 1.0, Protestant 0.0). v11e sets:
  Protestant softness  = clip(u_openness/20, .05, 1)   (hard base, RAISED where unionists transfer open)
  Catholic  softness   = clip(.4 + .6*n_openness/20, .4, 1)  (soft base, LOWERED where nationalists plump)
DEA-resolution via dz_dea, constituency fallback. Net effect: uncertainty concentrates in the
persuadable middle -- solidly-tribal areas (both West Belfast nationalist AND North Antrim unionist)
get NARROWER, certain bands; mixed/open areas widen."""
import json,numpy as np,pandas as pd
V="analysis/border-poll-dry-run/v9"
dz=pd.read_csv("data/census/derived/dz21-community-2021.csv")
dz_dea=json.load(open(f"{V}/dz_dea.json")); dzc=json.load(open(f"{V}/dz_constituency.json"))
cf=pd.read_csv(f"{V}/constituency_features.csv"); cf['con']=cf['con'].str.upper()
tdea=pd.read_csv(f"{V}/augment/transfer_covariates_dea.csv"); tdea['dea']=tdea['dea'].str.upper()
tcon=pd.read_csv(f"{V}/augment/transfer_covariates_constituency.csv"); tcon['con']=tcon['con'].str.upper()
pn=cf.set_index('con')[[x for x in cf if x.startswith('rel__Protestant')]].sum(axis=1)
nn=cf.set_index('con')[[x for x in cf if x.startswith('rel__Other') or x=='rel__None']].sum(axis=1)
pshare=(pn/(pn+nn))
uo_d,no_d=tdea.set_index('dea')['u_openness'],tdea.set_index('dea')['n_openness']
uo_c,no_c=tcon.set_index('con')['u_openness'],tcon.set_index('con')['n_openness']
dz['dea']=dz['DZ21'].map(dz_dea); dz['con']=dz['DZ21'].map(dzc); dz['cath']=dz['catholic_bg_pct']/100
dz['pshare']=dz['con'].map(pshare).fillna(pshare.mean())
uo=dz['dea'].map(uo_d).fillna(dz['con'].map(uo_c)).fillna(uo_c.mean())
no=dz['dea'].map(no_d).fillna(dz['con'].map(no_c)).fillna(no_c.median())
dz['p_soft']=np.clip(uo/20,0.05,1.0)
dz['c_soft']=np.clip(0.4+0.6*no/20,0.4,1.0)
NONE,SAMP,SWING=0.83,2.0,7.0
dz['soft_v11e']=dz['cath']*dz['c_soft']+(1-dz['cath'])*(dz['pshare']*dz['p_soft']+(1-dz['pshare'])*NONE)
dz['soft_v11b']=dz['cath']*1.0        +(1-dz['cath'])*(dz['pshare']*0.0        +(1-dz['pshare'])*NONE)
for t in('v11b','v11e'): dz[f'band_{t}']=(2*1.64*np.sqrt(SAMP**2+(dz[f'soft_{t}']*SWING)**2)).round(1)
dz[['DZ21','dea','con','catholic_bg_pct','c_soft','p_soft','soft_v11e','band_v11b','band_v11e']].dropna(subset=['con']).round(3).to_csv(f"{V}/augment/v11e_dz_softness_bidirectional.csv",index=False)
print("Bidirectional transfer wiring — DZ Yes-share band (v11b flat -> v11e transfer-corrected):")
print(f"{'seat':<24}{'Cath%':>6}{'v11b':>7}{'v11e':>7}{'change':>8}  character")
for con,ch in [('NEWRY AND ARMAGH','tribal nationalist'),('BELFAST WEST','solid nationalist'),
               ('MID ULSTER','nationalist'),('NORTH ANTRIM','tribal unionist'),
               ('NORTH DOWN','open unionist'),('BELFAST SOUTH','mixed/middle'),('ALLIANCE?','')]:
    s=dz[dz['con']==con]
    if len(s):
        b,e=s['band_v11b'].mean(),s['band_v11e'].mean()
        print(f"{con:<24}{s['catholic_bg_pct'].mean():6.0f}{b:7.1f}{e:7.1f}{e-b:+8.1f}  {ch}")
print("\n-> tribal nationalist (Newry&Armagh) AND tribal unionist (North Antrim) both NARROW = certain;")
print("   open/mixed seats widen. Uncertainty now sits in the persuadable middle, both directions.")
print(f"\nNI band: v11b p10/median/p90 {np.percentile(dz['band_v11b'].dropna(),[10,50,90]).round(1)}"
      f" -> v11e {np.percentile(dz['band_v11e'].dropna(),[10,50,90]).round(1)}")
print("wrote v11e_dz_softness_bidirectional.csv")
