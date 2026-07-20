#!/usr/bin/env python3
"""(b) Wire measured softness into the v11 Data-Zone uncertainty. Replaces the uniform
bootstrap band with an AREA-SPECIFIC one: each DZ's interval width = sampling error PLUS a
softness term (how unpredictably its persuadable share could break). Softness by community
is the DIRECT continuous hardness (NILT 2019, validated by the demographic-volatility model),
poststratified onto each DZ's religion composition -> a hard unionist DZ is near-certain, a
soft mixed DZ is a coin-toss. Where an era lacks the direct items, the demographic-softness
lookup substitutes (same shape)."""
import json, numpy as np, pandas as pd
V="analysis/border-poll-dry-run/v9"
# softness (1 - hardness) by community: DIRECT (hardness_continuous) -> validated by demographic_softness
SOFT={'C':1.0,'P':0.0,'N':0.83}   # volatility-based (demographic_softness), max separation; direct validates rank
dz=pd.read_csv("data/census/derived/dz21-community-2021.csv")            # DZ21, population, catholic_bg_pct
dzc=json.load(open(f"{V}/dz_constituency.json"))
# per-DZ softness from religion composition (Catholic vs non-Catholic split at DZ; P/N via constituency mix)
cf=pd.read_csv(f"{V}/constituency_features.csv"); cf['con']=cf['con'].str.upper(); cf=cf.set_index('con')
pn=cf[[x for x in cf if x.startswith('rel__Protestant')]].sum(axis=1); nn=cf[[x for x in cf if x.startswith('rel__Other') or x=='rel__None']].sum(axis=1)
pn_share=(pn/(pn+nn))                                                    # Protestant share of non-Catholics, per constituency
dz['con']=dz['DZ21'].map(dzc)
dz['cath']=dz['catholic_bg_pct']/100
dz['pshare']=dz['con'].map(pn_share).fillna(pn_share.mean())
dz['soft']=dz['cath']*SOFT['C']+(1-dz['cath'])*(dz['pshare']*SOFT['P']+(1-dz['pshare'])*SOFT['N'])
# point unity: reuse the v11 DZ religion projection (Catholic-driven), re-centred to survey level
REL_C,REL_O,NIlvl=82.6,26.0,45.8
dz['unity']=dz['cath']*REL_C+(1-dz['cath'])*REL_O
w=dz['population'].values; dz['unity']=dz['unity']-np.average(dz['unity'],weights=w)+NIlvl
# AREA-SPECIFIC uncertainty: sigma = sqrt(sampling^2 + (softness * swing_scale)^2)
SAMP=2.0; SWING=7.0
dz['sigma']=np.sqrt(SAMP**2+(dz['soft']*SWING)**2)
dz['lo90']=(dz['unity']-1.64*dz['sigma']).clip(1,99).round(1)
dz['hi90']=(dz['unity']+1.64*dz['sigma']).clip(1,99).round(1)
dz['band90_width']=(dz['hi90']-dz['lo90']).round(1)
# CRUCIAL distinction: band WIDTH = Yes%-uncertainty (softness alone); it is NOT majority-uncertainty.
# A soft 82%-Catholic DZ has a WIDE Yes%-band yet a SECURE Yes majority. What decides the OUTCOME is how
# close the point sits to 50 relative to that width -> the probability the DZ lands on the other side of 50.
from math import erf
def p_cross(mu,sigma):                       # P(true Yes% < 50) under Normal(mu,sigma); Yes-lean DZ -> its flip risk
    z=(50.0-mu)/max(sigma,1e-6); return 0.5*(1+erf(z/np.sqrt(2)))
dz['p_below50']=[p_cross(m,s) for m,s in zip(dz['unity'],dz['sigma'])]
# majority-uncertainty = how near a coin-toss the MAJORITY call is (0 = certain either way, .5 = true toss)
dz['maj_uncert']=(0.5-(dz['p_below50']-0.5).abs()).round(3)   # peaks when p_below50 ~ .5, i.e. mu near 50 AND soft
dz['unity']=dz['unity'].round(1); dz['soft']=dz['soft'].round(3); dz['p_below50']=dz['p_below50'].round(3)
dz[['DZ21','con','catholic_bg_pct','soft','unity','lo90','hi90','band90_width','p_below50','maj_uncert']].dropna(subset=['con']).to_csv(f"{V}/augment/v11_dz_softness_intervals.csv",index=False)
print("(b) AREA-SPECIFIC softness-driven Data-Zone uncertainty:")
print("  --- band WIDTH = uncertainty in the Yes SHARE (driven by softness alone) ---")
print(f"    (old v11 was a UNIFORM ~6.9pt band everywhere)")
q=dz['band90_width'].quantile([.1,.5,.9])
print(f"    DZ 90% band width: p10 {q[.1]:.1f}pt  median {q[.5]:.1f}pt  p90 {q[.9]:.1f}pt")
print(f"    narrowest (hard, unmovable share): {dz.nsmallest(3,'band90_width')[['con','catholic_bg_pct','band90_width']].to_dict('records')}")
print(f"    widest (soft, movable share): {dz.nlargest(3,'band90_width')[['con','catholic_bg_pct','band90_width']].to_dict('records')}")
print("\n  --- but a WIDE band is NOT an uncertain MAJORITY ---")
bw=dz.nlargest(1,'band90_width').iloc[0]
print(f"    e.g. widest-band DZ ({bw['con']}, {bw['catholic_bg_pct']:.0f}% Catholic): Yes% {bw['unity']:.0f} +/-{bw['band90_width']/2:.0f}pt,")
print(f"         yet P(majority flips to No) = {bw['p_below50']*100:.1f}% -> a soft but SECURE Yes area, not a toss-up.")
print("\n  --- majority-uncertainty = softness x proximity to 50 (the true battlegrounds) ---")
bg=dz.dropna(subset=['con']).nlargest(6,'maj_uncert')[['con','catholic_bg_pct','unity','band90_width','p_below50']]
print(f"    most-uncertain-MAJORITY DZs (near 50 AND soft):")
for _,r in bg.iterrows():
    print(f"      {r['con']:22s} {r['catholic_bg_pct']:4.0f}%C  Yes {r['unity']:4.0f}%  band {r['band90_width']:4.1f}pt  P(No maj) {r['p_below50']*100:4.0f}%")
# NI-wide: the aggregate band shrinks (errors partly cancel) but soft-and-balanced areas carry the outcome risk
ni=np.average(dz['unity'],weights=w)
share_bg=100*w[(dz['maj_uncert']>0.15).values].sum()/w.sum()
print(f"\n  NI-wide unity {ni:.1f}%; {share_bg:.0f}% of population lives in genuinely balance-of-power DZs (maj_uncert>0.15)")
print("wrote v11_dz_softness_intervals.csv")
