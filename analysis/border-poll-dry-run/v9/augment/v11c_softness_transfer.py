"""(v11c) Wire the transfer-openness covariate into the v11 Data-Zone softness/uncertainty layer.
v11b treated all Protestants as maximally HARD (softness 0). But STV transfers show Protestant areas
vary sharply -- North Down unionists transfer openly (u_openness 19%), North Antrim's do not (4%).
So we replace the flat Protestant softness with a TRANSFER-DERIVED one: p_soft(constituency) scaled
from that seat's revealed unionist openness. Catholic/None softness unchanged. The uncertainty band
then reflects revealed movability, not just religion -- narrower where unionism is tribal (North
Antrim), wider where it is open (North Down)."""
import json, numpy as np, pandas as pd
V="analysis/border-poll-dry-run/v9"
dz=pd.read_csv("data/census/derived/dz21-community-2021.csv")
dzc=json.load(open(f"{V}/dz_constituency.json"))
cf=pd.read_csv(f"{V}/constituency_features.csv"); cf['con']=cf['con'].str.upper()
tc=pd.read_csv(f"{V}/augment/transfer_covariates_constituency.csv"); tc['con']=tc['con'].str.upper()
# Protestant share of non-Catholics per constituency
pn=cf.set_index('con')[[x for x in cf if x.startswith('rel__Protestant')]].sum(axis=1)
nn=cf.set_index('con')[[x for x in cf if x.startswith('rel__Other') or x=='rel__None']].sum(axis=1)
pshare=(pn/(pn+nn))
# transfer-derived Protestant softness: openness (4..~20 among unionist seats) -> [0.05..1.0]
op=tc.set_index('con')['u_openness']
p_soft=(op/20.0).clip(0.05,1.0)
NONE_SOFT=0.83
dz['con']=dz['DZ21'].map(dzc); dz['cath']=dz['catholic_bg_pct']/100
dz['pshare']=dz['con'].map(pshare).fillna(pshare.mean())
dz['p_soft']=dz['con'].map(p_soft)
p_soft_mean=float(p_soft.mean()); dz['p_soft']=dz['p_soft'].fillna(p_soft_mean)
# softness: Catholic 1.0, None 0.83, Protestant = transfer-derived (was 0.0 in v11b)
dz['soft_v11c']=dz['cath']*1.0+(1-dz['cath'])*(dz['pshare']*dz['p_soft']+(1-dz['pshare'])*NONE_SOFT)
dz['soft_v11b']=dz['cath']*1.0+(1-dz['cath'])*(dz['pshare']*0.0     +(1-dz['pshare'])*NONE_SOFT)
SAMP,SWING=2.0,7.0
for tag in ('v11b','v11c'):
    dz[f'sig_{tag}']=np.sqrt(SAMP**2+(dz[f'soft_{tag}']*SWING)**2)
    dz[f'band_{tag}']=(2*1.64*dz[f'sig_{tag}']).round(1)
dz[['DZ21','con','catholic_bg_pct','p_soft','soft_v11b','soft_v11c','band_v11b','band_v11c']].dropna(subset=['con']).round(3).to_csv(f"{V}/augment/v11c_dz_softness_transfer.csv",index=False)

print("Transfer-derived Protestant softness by seat (was flat 0.0 in v11b):")
print("  hardest (tribal unionism -> stays ~0):",{c:round(p_soft[c],2) for c in p_soft.nsmallest(4).index})
print("  softest (open unionism -> raised):    ",{c:round(p_soft[c],2) for c in p_soft.nlargest(4).index})
def seat(con):
    s=dz[dz['con']==con]
    return (100*s['catholic_bg_pct'].mean()/100, s['band_v11b'].mean(), s['band_v11c'].mean())
print("\nEffect on the Yes-share uncertainty band (avg DZ 90% width, pts):")
print(f"{'seat':<14}{'Cath%':>6}{'v11b band':>11}{'v11c band':>11}{'change':>9}")
for con in ['NORTH ANTRIM','NORTH DOWN','EAST ANTRIM','STRANGFORD','BELFAST EAST']:
    s=dz[dz['con']==con]
    if len(s):
        b,c=s['band_v11b'].mean(),s['band_v11c'].mean()
        print(f"{con:<14}{s['catholic_bg_pct'].mean():6.0f}{b:11.1f}{c:11.1f}{c-b:+9.1f}")
print("\n-> North Antrim (hard, tribal) barely widens; North Down/East Antrim (open unionism) widen most:")
print("   the band now reflects REVEALED movability, not just religion. Two ~85% Protestant seats")
print("   are no longer treated identically. wrote v11c_dz_softness_transfer.csv")
